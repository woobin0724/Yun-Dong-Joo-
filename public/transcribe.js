import { $, esc, num, api, toast, titled } from './core.js';
import { layout, caretCell, COLS } from './manuscript.js';

export { layout };

/**
 * 원고지 필사.
 *
 * ─────────────────────────────────────────────────────────────
 * 왜 칸마다 input 을 두지 않는가
 * ─────────────────────────────────────────────────────────────
 * 한 칸에 한 글자니까 칸마다 <input maxlength="1"> 을 두고 싶어진다.
 * 그렇게 하면 한글이 망가진다. "한" 을 치려면 ㅎ → 하 → 한 세 단계를
 * 거치는데, 칸이 한 글자에서 꽉 찼다고 판단해 다음 칸으로 넘겨 버리면
 * 조합이 끊겨 "ㅎ ㅏ ㄴ" 이 세 칸에 흩어진다. maxlength 는 조합 중인
 * 글자를 세지 않거나, 브라우저마다 다르게 센다.
 *
 * 그래서 글자를 받는 곳은 **보이지 않는 textarea 하나**다. 원고지 격자는
 * 그 값을 보고 다시 그리는 그림일 뿐이다. 조합은 textarea 안에서 평소처럼
 * 일어나고, 우리는 compositionstart / compositionend 로 "지금 조합 중" 인
 * 것만 알아내 그 칸에 표시를 남긴다.
 *
 * ─────────────────────────────────────────────────────────────
 * 칸 세는 규칙
 * ─────────────────────────────────────────────────────────────
 * 줄바꿈은 남은 칸을 비우고 다음 줄로 간다. 원고지에서 행을 바꾸는 것과 같다.
 * 글자는 코드 포인트로 센다([...str]). String.length 로 세면 이모지 하나가
 * 두 칸을 먹는다.
 */

// 한 줄 칸 수는 manuscript.js 한 곳에서 정합니다.

const state = {
  poem: null,
  composing: false,
  saved: false,
};

let onSaved = () => {};

// ───────────────────────── 격자 ─────────────────────────

function renderGrid() {
  const box = $('#tr-grid');
  const area = $('#tr-input');
  const text = area.value;
  const rows = layout(text);
  const caret = caretCell(text, area.selectionStart ?? text.length);

  // 빈 줄도 원고지에는 칸이 그려져 있다. 다만 여덟 줄을 늘 그려 두었더니
  // 빈 칸이 쓰는 자리를 화면 밖으로 밀었다. 적은 만큼 + 한 줄, 적어도 네 줄.
  const minRows = Math.max(4, rows.length + 1);
  while (rows.length < minRows) rows.push([]);

  box.style.setProperty('--cols', String(COLS));
  box.innerHTML = rows
    .map((row, r) => {
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        const ch = row[c];
        const isCaret = r === caret.row && c === caret.col;
        // 조합 중인 글자는 커서 바로 앞 칸이다. 테두리로 "아직 정해지지
        // 않음" 을 보인다. 색만 쓰면 색을 못 보는 사람에게 전달되지 않는다.
        const composing = state.composing && isCaretPrev(r, c, caret);
        cells.push(
          `<span class="tr-cell${isCaret ? ' is-caret' : ''}${
            composing ? ' is-composing' : ''
          }">${ch ? esc(ch) : ''}</span>`,
        );
      }
      return `<div class="tr-row">${cells.join('')}</div>`;
    })
    .join('');

  const chars = [...text.replace(/\n/g, '')].length;
  $('#tr-count').textContent = String(chars);
  $('#tr-save').disabled = chars < Number($('#tr-count').dataset.min || 10);
}

function isCaretPrev(r, c, caret) {
  if (caret.col === 0) return r === caret.row - 1 && c === COLS - 1;
  return r === caret.row && c === caret.col - 1;
}

// ───────────────────────── 열고 닫기 ─────────────────────────

export async function openTranscribe(poem) {
  state.poem = poem;
  state.saved = false;
  state.composing = false;

  $('#tr-title').textContent = `「${poem.title}」 옮겨 적기`;
  $('#tr-source').innerHTML = poem.stanzas
    .map((st) => `<p class="stanza">${st.map((l) => `<span class="line">${esc(l)}</span>`).join('')}</p>`)
    .join('');
  const area = $('#tr-input');
  area.value = '';
  $('#tr-done').hidden = true;
  $('#tr-work').hidden = false;

  $('#transcribe').hidden = false;
  document.body.dataset.lesson = 'open';
  renderGrid();
  area.focus();
}

function closeTranscribe() {
  $('#transcribe').hidden = true;
  delete document.body.dataset.lesson;
  state.poem = null;
}

// ───────────────────────── 그림으로 내보내기 ─────────────────────────

/**
 * 원고지를 그대로 그려 PNG 로 만든다.
 *
 * 화면을 캡처하는 것이 아니라 캔버스에 다시 그린다. 화면 캡처는 기기
 * 해상도와 테마에 휘둘리고, 어두운 화면에서 적은 사람은 검은 종이를
 * 받게 된다. 내보내는 종이는 늘 밝은 종이다.
 */
export function drawSheet(canvas, { text, title, cols = COLS, scale = 2 }) {
  const rows = layout(text, cols);
  while (rows.length && !rows.at(-1).length) rows.pop();
  if (!rows.length) rows.push([]);

  const cell = 44;
  const gap = 6;
  const pad = 36;
  const titleH = 54;
  const footH = 34;

  const w = pad * 2 + cols * cell + (cols - 1) * gap;
  const h = pad * 2 + titleH + rows.length * cell + (rows.length - 1) * gap + footH;

  canvas.width = w * scale;
  canvas.height = h * scale;
  const g = canvas.getContext('2d');
  g.scale(scale, scale);

  // 종이
  g.fillStyle = '#f1f1ec';
  g.fillRect(0, 0, w, h);

  // 제목
  g.fillStyle = '#23211e';
  g.font = '600 20px "Gowun Batang", serif';
  g.textBaseline = 'alphabetic';
  g.fillText(title, pad, pad + 22);
  g.fillStyle = '#625d52';
  g.font = '13px "IBM Plex Sans KR", sans-serif';
  g.fillText('윤동주', pad, pad + 42);

  // 칸
  const top = pad + titleH;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      const x = pad + c * (cell + gap);
      const y = top + r * (cell + gap);
      g.fillStyle = '#fafaf6';
      g.fillRect(x, y, cell, cell);
      g.strokeStyle = '#23211e2b';
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);

      const ch = rows[r][c];
      if (!ch) continue;
      g.fillStyle = '#23211e';
      g.font = '24px "Gowun Batang", serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, x + cell / 2, y + cell / 2 + 1);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    }
  }

  // 꼬리말. 누가 만든 그림인지 남겨 둔다.
  g.fillStyle = '#625d52';
  g.font = '12px "IBM Plex Sans KR", sans-serif';
  g.fillText('별 헤는 밤 — 원고지 필사', pad, h - pad + 8);

  return { width: w, height: h };
}

async function exportImage() {
  const canvas = document.createElement('canvas');
  // 글꼴이 아직 안 왔으면 캔버스가 기본 글꼴로 그려 버린다. 기다린다.
  if (document.fonts?.ready) await document.fonts.ready;
  drawSheet(canvas, { text: $('#tr-input').value, title: state.poem.title });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    toast('그림을 만들지 못했습니다.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // 파일 이름은 로마자로 짓습니다. 한글 이름("필사-서시.png")을 주면 시험한
  // Chromium 이 이름을 통째로 버리고 'download' 로 저장했습니다. ASCII 이름은
  // 그대로 지켜졌습니다. 작품 id 가 이미 로마자라 그것을 씁니다.
  const day = new Date().toISOString().slice(0, 10);
  a.download = `pilsa-${state.poem.id}-${day}.png`;
  // 문서에 붙이지 않은 링크는 download 이름을 무시하는 브라우저가 있다.
  // 그러면 파일이 그냥 'download' 로 떨어진다(실제로 그랬다).
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  // 바로 revoke 하면 느린 기기에서 내려받기가 끊긴다.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ───────────────────────── 저장 ─────────────────────────

async function save() {
  const text = $('#tr-input').value;
  let res;
  try {
    res = await api('/transcriptions', {
      method: 'POST',
      body: { poemId: state.poem.id, text },
    });
  } catch (err) {
    toast(err.message);
    return;
  }
  state.saved = true;
  onSaved();

  $('#tr-work').hidden = true;
  $('#tr-done').hidden = false;
  $('#tr-done-text').innerHTML =
    `${titled(state.poem.title)} ${num(res.chars)}자 옮겨 적었습니다.` +
    (res.points
      ? ` <b>+${res.points}점</b>`
      : ' 이 작품은 이미 적으신 적이 있어 점수는 더해지지 않습니다.');
}

// ───────────────────────── 붙이기 ─────────────────────────

export function mountTranscribe({ onSave } = {}) {
  if (onSave) onSaved = onSave;

  const area = $('#tr-input');

  // 조합 중인지 아닌지만 알면 된다. 조합 자체는 textarea 가 한다.
  area.addEventListener('compositionstart', () => {
    state.composing = true;
    renderGrid();
  });
  area.addEventListener('compositionend', () => {
    state.composing = false;
    renderGrid();
  });
  // input 은 조합 중에도 뜬다(isComposing: true). 그때도 다시 그려야
  // 글자가 만들어지는 과정이 칸 안에서 보인다.
  area.addEventListener('input', renderGrid);
  // 커서만 움직여도 들어갈 칸이 바뀐다.
  for (const ev of ['click', 'keyup', 'select', 'focus']) {
    area.addEventListener(ev, renderGrid);
  }


  $('#tr-close').addEventListener('click', closeTranscribe);
  $('#tr-save').addEventListener('click', save);
  $('#tr-export').addEventListener('click', exportImage);
  $('#tr-done-close').addEventListener('click', closeTranscribe);
  $('#tr-done-export').addEventListener('click', exportImage);

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#transcribe').hidden) closeTranscribe();
  });
}
