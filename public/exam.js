import { $, $$, esc, icon, num, api, toast } from './core.js';

/**
 * 시험 대비.
 *
 * 레슨과 다른 점 두 가지.
 *  - 한 문항은 한 번만 낸다. 답을 본 뒤 다시 내서 맞히는 길을 서버가 막는다.
 *  - 끝나면 몇 개를 맞혔는지보다 **오답 노트가 어떻게 바뀌었는지**를 먼저
 *    보여 준다. 시험 대비의 목적은 점수가 아니라 틀린 것을 줄이는 것이다.
 */

const state = { exam: null, index: 0, chosen: null, resolved: 0, added: 0, correct: 0 };
let onPoints = () => {};

export async function loadExamCard() {
  let s;
  try {
    s = await api('/exam');
  } catch {
    return;
  }
  const card = $('#exam-card');
  card.hidden = false;
  if (!s.ready) {
    card.innerHTML = `
      <div class="exam-card-text">
        <h3>시험 대비</h3>
        <p>길에서 시를 한 편 걸으면 열립니다. 걸어 본 시에서만 묻습니다.</p>
      </div>`;
    return;
  }
  card.innerHTML = `
    <div class="exam-card-text">
      <h3>시험 대비</h3>
      <p>${
        s.openMistakes
          ? `오답 노트에 <b>${num(s.openMistakes)}문제</b>가 있습니다. 그것부터 다시 냅니다.`
          : `걸어 본 시 ${num(s.walkedPoems)}편에서 묻습니다.`
      }</p>
    </div>
    <button class="btn" type="button" id="exam-start">풀기</button>`;
  $('#exam-start').addEventListener('click', startExam);
}

async function startExam() {
  let exam;
  try {
    exam = await api('/exam', { method: 'POST' });
  } catch (err) {
    toast(err.message);
    return;
  }
  Object.assign(state, { exam, index: 0, chosen: null, resolved: 0, added: 0, correct: 0 });
  $('#exam').hidden = false;
  document.body.dataset.lesson = 'open';
  renderItem();
  $('#exam-close').focus();
}

function closeExam() {
  $('#exam').hidden = true;
  delete document.body.dataset.lesson;
  state.exam = null;
  loadExamCard();
}

function renderItem() {
  const { exam, index } = state;
  const item = exam.items[index];
  const total = exam.items.length;
  $('#exam-meter > i').style.setProperty('--fill', String(index / total));
  $('#exam-count').textContent = `${index + 1} / ${total}`;
  $('#exam-feedback').hidden = true;
  $('#exam-feedback').className = 'lesson-feedback';
  state.chosen = null;

  const tag = item.fromMistakes ? `<span class="exam-tag">오답 노트</span>` : '';
  const head = `<p class="exam-source">${tag}「${esc(item.title)}」</p>
    <p class="step-prompt">${esc(item.prompt)}</p>`;

  let body = '';
  if (item.type === 'cloze') {
    body = `<div class="manuscript face-read"><div class="poem-body"><p class="stanza"><span class="line">${esc(item.line)}</span></p></div></div>`;
  }
  if (item.type === 'order') {
    body += `<ol class="order-list" id="exam-order">${item.lines
      .map(
        (l) => `<li class="order-row"><span class="order-text">${esc(l)}</span>
        <span class="order-moves">
          <button class="icon-btn" type="button" data-move="up" aria-label="위로">${icon('up')}</button>
          <button class="icon-btn" type="button" data-move="down" aria-label="아래로">${icon('down')}</button>
        </span></li>`,
      )
      .join('')}</ol>`;
  } else {
    body += `<div class="choices">${item.options
      .map((o, i) => `<button class="choice" type="button" data-choice="${i}" aria-pressed="false">${esc(o)}</button>`)
      .join('')}</div>`;
  }
  $('#exam-body').innerHTML = head + body;

  const next = $('#exam-next');
  next.textContent = '확인';
  next.dataset.mode = 'check';
  next.disabled = item.type !== 'order';

  if (item.type === 'order') {
    const list = $('#exam-order');
    const refresh = () =>
      [...list.children].forEach((row, i, all) => {
        row.querySelector('[data-move="up"]').disabled = i === 0;
        row.querySelector('[data-move="down"]').disabled = i === all.length - 1;
      });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-move]');
      if (!btn) return;
      const row = btn.closest('.order-row');
      if (btn.dataset.move === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      if (btn.dataset.move === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      refresh();
      row.querySelector(`[data-move="${btn.dataset.move}"]`)?.focus();
    });
    refresh();
  } else {
    for (const btn of $$('#exam-body .choice')) {
      btn.addEventListener('click', () => {
        for (const b of $$('#exam-body .choice')) b.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-pressed', 'true');
        state.chosen = Number(btn.dataset.choice);
        next.disabled = false;
      });
    }
  }
}

async function onNext() {
  const next = $('#exam-next');
  if (next.dataset.mode === 'go') {
    if (state.index + 1 >= state.exam.items.length) return renderSummary();
    state.index += 1;
    renderItem();
    return;
  }
  if (next.dataset.mode === 'done') return closeExam();

  const item = state.exam.items[state.index];
  const body =
    item.type === 'order'
      ? { lines: [...$('#exam-order').children].map((r) => r.querySelector('.order-text').textContent) }
      : { choice: state.chosen };

  next.disabled = true;
  let res;
  try {
    res = await api(`/exam/${state.exam.examId}/items/${state.index}`, { method: 'POST', body });
  } catch (err) {
    toast(err.message);
    next.disabled = false;
    return;
  }
  if (res.correct) state.correct += 1;
  if (res.resolvedMistake) state.resolved += 1;
  if (res.correct === false && !item.fromMistakes) state.added += 1;
  if (res.points) onPoints();

  // 결과 표시 — 레슨과 같은 모양. 색만으로 알리지 않도록 ✓/✕ 가 함께 붙는다.
  if (item.type === 'order') {
    $('#exam-order').innerHTML = res.reveal.lines
      .map((l) => `<li class="order-row is-answer"><span class="order-text">${esc(l)}</span></li>`)
      .join('');
  } else {
    for (const btn of $$('#exam-body .choice')) {
      const i = Number(btn.dataset.choice);
      btn.disabled = true;
      if (i === res.reveal?.answer) btn.classList.add('is-correct');
      else if (btn.getAttribute('aria-pressed') === 'true') btn.classList.add('is-wrong');
    }
  }
  const fb = $('#exam-feedback');
  fb.hidden = false;
  if (res.correct) {
    fb.classList.add('is-ok');
    fb.innerHTML = `${icon('check')}<span>${res.resolvedMistake ? '오답 노트에서 지웠습니다.' : '맞았습니다.'}${
      res.points ? ` <b>+${res.points}</b>` : ''
    }</span>`;
  } else {
    fb.classList.add('is-no');
    fb.innerHTML = `${icon('info')}<span>${esc(res.message || '시인이 놓은 차례는 이렇습니다.')}${
      item.fromMistakes ? ' 오답 노트에 그대로 남겨 둡니다.' : ' 오답 노트에 적어 둡니다.'
    }</span>`;
  }
  next.disabled = false;
  next.dataset.mode = 'go';
  next.textContent = state.index + 1 >= state.exam.items.length ? '결과 보기' : '다음';
}

function renderSummary() {
  const { exam, correct, resolved, added } = state;
  $('#exam-meter > i').style.setProperty('--fill', '1');
  $('#exam-feedback').hidden = true;
  $('#exam-body').innerHTML = `
    <div class="lesson-done">
      <h3>${num(exam.items.length)}문제 중 ${num(correct)}문제</h3>
      <ul class="exam-ledger">
        <li><span>오답 노트에서 지운 것</span><b>${num(resolved)}</b></li>
        <li><span>오답 노트에 새로 적은 것</span><b>${num(added)}</b></li>
      </ul>
      <p class="step-note">틀린 것은 다음 시험에 먼저 나옵니다.</p>
    </div>`;
  const next = $('#exam-next');
  next.textContent = '닫기';
  next.dataset.mode = 'done';
}

export function mountExam({ onPoints: cb } = {}) {
  if (cb) onPoints = cb;
  $('#exam-close').addEventListener('click', closeExam);
  $('#exam-next').addEventListener('click', onNext);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#exam').hidden) closeExam();
  });
}
