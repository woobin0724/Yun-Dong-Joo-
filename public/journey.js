import { $, $$, esc, icon, num, api, toast, poemHtml } from './core.js';

/**
 * 「동주의 길」 — 지도와 레슨.
 *
 * 화면 두 개가 들어 있습니다.
 *   지도   — 장과 마디, 그리고 큰 버튼 하나 '이어서 걷기'.
 *   레슨   — 마디 하나를 걷는 전체 화면. 걸음을 하나씩 넘깁니다.
 *
 * 레슨은 탭이 아니라 덮는 화면입니다. 한 번에 한 걸음만 보이는 것이
 * 이 화면의 전부라서, 탭바와 상단바가 같이 보이면 집중이 흩어집니다.
 */

const state = {
  map: null,
  lesson: null, // { nodeId, poem, steps, index, chapter }
  stepState: null, // 걸음 하나를 푸는 동안의 임시 상태
};

let onPointsChanged = () => {};

// ───────────────────────── 지도 ─────────────────────────

export async function loadJourney() {
  state.map = await api('/journey');
  renderMap();
}

function renderMap() {
  const map = state.map;
  if (!map) return;

  $('#path-progress').textContent = `${map.doneCount} / ${map.total} 마디`;
  const pct = map.total ? Math.round((map.doneCount / map.total) * 100) : 0;
  $('#path-meter > i').style.setProperty('--fill', String(pct / 100));
  $('#path-meter').setAttribute('aria-valuenow', String(pct));

  // 큰 버튼 하나. 이 화면에서 누를 것은 이것뿐입니다.
  const cta = $('#path-cta');
  if (map.finished) {
    cta.hidden = true;
    $('#path-end').hidden = false;
  } else {
    cta.hidden = false;
    $('#path-end').hidden = true;
    const next = findNode(map.next);
    cta.querySelector('.cta-label').textContent = map.doneCount ? '이어서 걷기' : '길에 들어서기';
    cta.querySelector('.cta-sub').textContent = next ? `「${next.title}」` : '';
    cta.dataset.node = map.next ?? '';
  }

  $('#chapter-note').innerHTML = noteHtml(map.chapterNote);
  const currentChapter = findNode(map.next)?.chapterId ?? null;
  $('#path-map').innerHTML = map.chapters.map((c) => chapterHtml(c, currentChapter)).join('');

  const unverified = map.unverifiedFacts;
  const warn = $('#path-unverified');
  warn.hidden = !unverified;
  if (unverified) {
    warn.innerHTML =
      icon('info') +
      `<span>장의 이야기 ${unverified}건이 아직 출처 대조 전입니다. ` +
      `확인되기 전까지는 비워 둡니다.</span>`;
  }

  for (const btn of $$('#path-map .node')) {
    btn.addEventListener('click', () => openLesson(btn.dataset.node));
  }
}

/** **굵게** 만 지원하는 아주 작은 변환. 본문은 모두 우리가 쓴 글입니다. */
function noteHtml(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function findNode(nodeId) {
  for (const c of state.map?.chapters ?? []) {
    const n = c.nodes.find((x) => x.id === nodeId);
    if (n) return n;
  }
  return null;
}

function chapterHtml(chapter, currentId) {
  const isCurrent = chapter.id === currentId;

  const nodes = chapter.nodes
    .map(
      (n) => `
      <button class="node" data-node="${esc(n.id)}" data-state="${n.state}"
              ${n.state === 'locked' ? 'disabled' : ''}
              aria-label="${esc(n.title)} — ${
                { done: '걸은 마디', open: '걸을 수 있는 마디', locked: '아직 잠긴 마디' }[n.state]
              }">
        <span class="node-mark">${
          n.state === 'done' ? icon('check') : n.state === 'locked' ? icon('lock') : icon('path')
        }</span>
        <span class="node-title">${esc(n.title)}</span>
      </button>`,
    )
    .join('');

  // 확인된 이야기만 적습니다. 확인 전이라는 말은 지도 맨 위에 한 번만
  // 띄웁니다. 장마다 같은 문장을 되풀이하면 여섯 번 사과하는 꼴이 됩니다.
  const story = chapter.factVerified
    ? `<p class="chapter-story">${esc(chapter.story)}</p>
       <p class="chapter-source">출처: ${esc(chapter.source.name)}</p>`
    : '';

  const head = `
    <span class="chapter-ord">${chapter.ord}</span>
    <span class="chapter-headings">
      <span class="chapter-place">${esc(chapter.place)}</span>
      <span class="chapter-hint">${esc(chapter.hint)}${
        chapter.years ? ` · ${esc(chapter.years)}` : ''
      }</span>
    </span>
    <span class="chapter-count">${
      chapter.empty ? '시 없음' : `${chapter.doneCount} / ${chapter.total}`
    }</span>`;

  // 읽을 시가 없는 장은 펼칠 것이 없으므로 접지 않습니다.
  if (chapter.empty) {
    return `
      <section class="chapter is-empty">
        <div class="chapter-head">${head}</div>
        ${story}
        <p class="chapter-empty">${
          chapter.id === 'fukuoka'
            ? '이 장에는 읽을 시가 없습니다. 남은 작품이 없다는 것이 이 길의 끝입니다.'
            : '이 무렵에 쓴 시가 아직 이 앱에 없습니다.'
        }</p>
      </section>`;
  }

  // 지금 걷는 장만 펼쳐 둡니다. 열아홉 마디를 한 줄로 늘어놓으면
  // 지도가 아니라 긴 목록이 되고, 내가 어디쯤인지 보이지 않습니다.
  return `
    <details class="chapter" ${isCurrent ? 'open' : ''}>
      <summary class="chapter-head">${head}</summary>
      ${story}
      <div class="node-list">${nodes}</div>
    </details>`;
}

// ───────────────────────── 레슨 ─────────────────────────

async function openLesson(nodeId) {
  if (!nodeId) return;
  let data;
  try {
    data = await api(`/journey/nodes/${encodeURIComponent(nodeId)}`);
  } catch (err) {
    toast(err.message, { tone: 'star' });
    return;
  }
  state.lesson = {
    nodeId,
    poem: data.poem,
    chapter: data.chapter,
    steps: data.lesson.steps,
    total: data.lesson.totalPoints,
    // 이미 푼 걸음이 있으면 거기서 이어 갑니다.
    index: Math.min(data.progress.stepsDone, data.lesson.steps.length - 1),
    earned: data.progress.score,
  };
  $('#lesson').hidden = false;
  document.body.dataset.lesson = 'open';
  renderStep();
  $('#lesson-close').focus();
}

function closeLesson() {
  $('#lesson').hidden = true;
  delete document.body.dataset.lesson;
  state.lesson = null;
  state.stepState = null;
  loadJourney();
}

function renderStep() {
  const L = state.lesson;
  const step = L.steps[L.index];

  $('#lesson-title').textContent = `「${L.poem.title}」`;
  const pct = Math.round((L.index / L.steps.length) * 100);
  $('#lesson-meter > i').style.setProperty('--fill', String(pct / 100));
  $('#lesson-meter').setAttribute('aria-valuenow', String(pct));
  $('#lesson-count').textContent = `${L.index + 1} / ${L.steps.length}`;

  $('#lesson-feedback').hidden = true;
  $('#lesson-feedback').className = 'lesson-feedback';

  const body = $('#lesson-body');
  body.innerHTML = BUILD[step.type](step, L);
  body.scrollTop = 0;

  const next = $('#lesson-next');
  next.textContent = '확인';
  next.disabled = true;
  next.dataset.mode = 'check';

  SETUP[step.type]?.(step, L);
}

/** 걸음 종류마다 화면을 그리는 함수. */
const BUILD = {
  'slow-read': (step) => `
    <p class="step-prompt">${esc(step.prompt)}</p>
    <div class="manuscript face-read" id="slow-sheet">
      <div class="poem-body" id="slow-stanza"></div>
    </div>
    <p class="step-note" id="slow-count"></p>`,

  cloze: (step) => `
    <p class="step-prompt">${esc(step.prompt)}</p>
    <div class="manuscript face-read">
      <div class="poem-body"><p class="stanza"><span class="line">${esc(step.line)}</span></p></div>
    </div>
    <div class="choices">${optionsHtml(step.options)}</div>`,

  diction: (step) => `
    <p class="step-prompt">${esc(step.prompt)}</p>
    <div class="choices">${optionsHtml(step.options)}</div>`,

  order: (step) => `
    <p class="step-prompt">${esc(step.prompt)}</p>
    <p class="step-note">위아래 화살표로 옮기세요.</p>
    <ol class="order-list" id="order-list">${step.lines
      .map(
        (line, i) => `
      <li class="order-row" data-i="${i}">
        <span class="order-text">${esc(line)}</span>
        <span class="order-moves">
          <button class="icon-btn" type="button" data-move="up" aria-label="위로">${icon('up')}</button>
          <button class="icon-btn" type="button" data-move="down" aria-label="아래로">${icon('down')}</button>
        </span>
      </li>`,
      )
      .join('')}</ol>`,

  feeling: (step) => `
    <p class="step-prompt">${esc(step.prompt)}</p>
    <p class="step-note">${esc(step.note)}</p>
    <div class="choices">${optionsHtml(step.options)}</div>`,

  response: (step, L) => `
    <p class="step-prompt">${esc(step.prompt)}</p>
    <details class="step-peek">
      <summary>시를 다시 보기</summary>
      <div class="manuscript face-read">${poemHtml(L.poem)}</div>
    </details>
    <textarea id="response-text" rows="5" maxlength="1000"
      placeholder="옮겨 적은 구절과, 왜 거기서 멈췄는지…"
      aria-label="한 줄 감상"></textarea>
    <p class="step-note"><span id="response-count">0</span> / ${step.minLength}자</p>`,
};

const optionsHtml = (options) =>
  options
    .map(
      (opt, i) =>
        `<button class="choice" type="button" data-choice="${i}" aria-pressed="false">${esc(opt)}</button>`,
    )
    .join('');

/** 그린 뒤에 이벤트를 붙이는 함수. */
const SETUP = {
  'slow-read'(step) {
    let seen = 0;
    const next = $('#lesson-next');
    const show = () => {
      $('#slow-stanza').innerHTML = `<p class="stanza">${step.stanzas[seen]
        .map((l) => `<span class="line">${esc(l)}</span>`)
        .join('')}</p>`;
      $('#slow-count').textContent = `${seen + 1}연 / ${step.stanzas.length}연`;
      next.disabled = true;
      next.textContent = seen + 1 < step.stanzas.length ? '다음 연' : '확인';
      // 연마다 머무는 시간. 다 읽기 전에 넘기지 못하게 막습니다.
      // 이것만은 브라우저가 지킵니다. 서버가 시간을 재면 느린 네트워크에서
      // 제대로 읽은 사람이 손해를 봅니다.
      setTimeout(() => {
        next.disabled = false;
      }, step.dwellMs[seen]);
    };
    show();
    state.stepState = {
      advance() {
        if (seen + 1 < step.stanzas.length) {
          seen += 1;
          show();
          return null; // 아직 제출하지 않습니다
        }
        return { stanzasSeen: step.stanzas.length };
      },
    };
  },

  cloze: setupChoice,
  diction: setupChoice,
  feeling: setupChoice,

  order(step) {
    const list = $('#order-list');
    const rows = () => [...list.children];
    const refresh = () => {
      rows().forEach((row, i) => {
        row.querySelector('[data-move="up"]').disabled = i === 0;
        row.querySelector('[data-move="down"]').disabled = i === rows().length - 1;
      });
      $('#lesson-next').disabled = false;
    };
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-move]');
      if (!btn) return;
      const row = btn.closest('.order-row');
      if (btn.dataset.move === 'up' && row.previousElementSibling) {
        row.parentNode.insertBefore(row, row.previousElementSibling);
      } else if (btn.dataset.move === 'down' && row.nextElementSibling) {
        row.parentNode.insertBefore(row.nextElementSibling, row);
      }
      refresh();
      // 옮긴 행에 초점을 남겨 둡니다. 안 그러면 키보드 사용자가 자리를 잃습니다.
      row.querySelector(`[data-move="${btn.dataset.move}"]`)?.focus();
    });
    refresh();
    state.stepState = {
      advance: () => ({ lines: rows().map((r) => r.querySelector('.order-text').textContent) }),
    };
  },

  response(step) {
    const box = $('#response-text');
    const count = $('#response-count');
    const next = $('#lesson-next');
    const sync = () => {
      const n = box.value.trim().length;
      count.textContent = String(n);
      count.parentElement.dataset.ok = n >= step.minLength ? 'true' : 'false';
      next.disabled = n < step.minLength;
    };
    box.addEventListener('input', sync);
    sync();
    box.focus();
    state.stepState = { advance: () => ({ text: box.value }) };
  },
};

function setupChoice() {
  let chosen = null;
  for (const btn of $$('#lesson-body .choice')) {
    btn.addEventListener('click', () => {
      for (const other of $$('#lesson-body .choice')) other.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      chosen = Number(btn.dataset.choice);
      $('#lesson-next').disabled = false;
    });
  }
  state.stepState = { advance: () => ({ choice: chosen }) };
}

// ───────────────────────── 걸음 제출 ─────────────────────────

async function onNext() {
  const L = state.lesson;
  if (!L) return;
  const next = $('#lesson-next');

  // 채점이 끝난 상태면 다음 걸음으로 넘어갑니다.
  if (next.dataset.mode === 'go') {
    if (L.index + 1 >= L.steps.length) return finishLesson();
    L.index += 1;
    renderStep();
    return;
  }

  const payload = state.stepState?.advance();
  if (payload === null) return; // 천천히 읽기 — 아직 연이 남았습니다

  next.disabled = true;
  let res;
  try {
    res = await api(`/journey/nodes/${encodeURIComponent(L.nodeId)}/steps/${L.index}`, {
      method: 'POST',
      body: payload,
    });
  } catch (err) {
    toast(err.message, { tone: 'star' });
    next.disabled = false;
    return;
  }

  L.earned = res.score;
  showFeedback(res);
  if (res.points) onPointsChanged();

  next.disabled = false;
  next.dataset.mode = 'go';
  next.textContent = L.index + 1 >= L.steps.length ? '마치기' : '계속';
}

function showFeedback(res) {
  const step = state.lesson.steps[state.lesson.index];
  const box = $('#lesson-feedback');
  box.hidden = false;

  // 고른 보기에 맞고 틀림을 표시합니다. 색만으로 알리지 않도록 CSS 가
  // ✓ / ✕ 표식을 함께 붙입니다.
  if (res.correct !== null && (step.type === 'cloze' || step.type === 'diction')) {
    for (const btn of $$('#lesson-body .choice')) {
      const i = Number(btn.dataset.choice);
      btn.disabled = true;
      if (i === res.reveal?.answer) btn.classList.add('is-correct');
      else if (btn.getAttribute('aria-pressed') === 'true') btn.classList.add('is-wrong');
    }
  }

  if (step.type === 'order' && res.reveal) {
    $('#order-list').innerHTML = res.reveal.lines
      .map((l) => `<li class="order-row is-answer"><span class="order-text">${esc(l)}</span></li>`)
      .join('');
  }

  if (step.type === 'feeling' && res.distribution) {
    box.classList.add('is-neutral');
    box.innerHTML = distributionHtml(res.distribution);
    return;
  }

  if (res.correct === true) {
    box.classList.add('is-ok');
    box.innerHTML = `${icon('check')}<span>맞았습니다. <b>+${res.points}</b></span>`;
  } else if (res.correct === false) {
    box.classList.add('is-no');
    box.innerHTML = `${icon('info')}<span>${esc(res.message)}</span>`;
  } else {
    // 채점하지 않는 걸음들. 한 가지 문구로 뭉뚱그리면 엉뚱한 말이 됩니다
    // (천천히 읽기에 "적어 주셔서 고맙습니다" 가 떴습니다).
    const NEUTRAL = {
      'slow-read': '끝까지 읽으셨습니다.',
      response: '적어 주셔서 고맙습니다.',
    };
    box.classList.add('is-neutral');
    box.innerHTML = `${icon('check')}<span>${NEUTRAL[step.type] ?? '다음으로 갑니다.'}${
      res.points ? ` <b>+${res.points}</b>` : ''
    }</span>`;
  }
}

function distributionHtml(dist) {
  const rows = dist.items
    .map(
      (item) => `
    <li class="dist-row">
      <span class="dist-label">${esc(item.label)}</span>
      <span class="dist-bar"><i style="--fill:${(item.percent / 100).toFixed(3)}"></i></span>
      <span class="dist-pct">${item.percent}%</span>
    </li>`,
    )
    .join('');
  return `
    <p class="dist-head">이 시를 읽은 ${num(dist.total)}명은 이렇게 짚었습니다.</p>
    <ul class="dist">${rows}</ul>
    ${
      dist.orphaned
        ? `<p class="step-note">보기가 바뀌어 집계에서 빠진 표 ${num(dist.orphaned)}개가 있습니다.</p>`
        : ''
    }`;
}

async function finishLesson() {
  const L = state.lesson;
  let res;
  try {
    res = await api(`/journey/nodes/${encodeURIComponent(L.nodeId)}/finish`, { method: 'POST' });
  } catch (err) {
    toast(err.message, { tone: 'star' });
    return;
  }
  onPointsChanged();

  $('#lesson-body').innerHTML = `
    <div class="lesson-done">
      <svg viewBox="0 0 64 64" class="mascot" aria-hidden="true"><use href="#m-happy" /></svg>
      <h3>「${esc(L.poem.title)}」을 걸었습니다.</h3>
      <p class="lesson-score">${num(res.score)}점</p>
      <p class="step-note">걸음 ${num(res.stepScore)}점 + 완주 ${num(res.bonus)}점</p>
      <p class="step-note">${
        res.finished
          ? '길의 끝까지 왔습니다.'
          : `${num(res.doneCount)} / ${num(res.total)} 마디`
      }</p>
    </div>`;
  $('#lesson-feedback').hidden = true;
  const next = $('#lesson-next');
  next.textContent = res.finished ? '지도로' : '다음 마디로';
  next.disabled = false;
  next.dataset.mode = 'done';
  next.onclick = () => {
    const goto = res.next;
    closeLesson();
    if (goto) setTimeout(() => openLesson(goto), 60);
  };
}

// ───────────────────────── 붙이기 ─────────────────────────

export function mountJourney({ onPoints } = {}) {
  if (onPoints) onPointsChanged = onPoints;

  $('#path-cta').addEventListener('click', (e) => openLesson(e.currentTarget.dataset.node));
  $('#lesson-close').addEventListener('click', closeLesson);
  $('#lesson-next').addEventListener('click', (e) => {
    // finishLesson 이 onclick 을 갈아끼우므로, 그때는 이 핸들러가 비켜 줍니다.
    if (e.currentTarget.dataset.mode === 'done') return;
    onNext();
  });

  // 레슨 중에는 Esc 로 빠져나갑니다. 진행은 걸음 단위로 저장돼 있어
  // 나갔다 들어와도 이어서 걷습니다.
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.lesson) closeLesson();
  });
}
