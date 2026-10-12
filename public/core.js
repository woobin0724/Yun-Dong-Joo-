/* 별 헤는 밤 — 화면들이 함께 쓰는 것들.
   빌드 도구가 없으므로 표준 ES 모듈로 나눕니다. app.js 하나가 계속
   자라던 것을 여기서부터 쪼갭니다. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 사용자 입력이 섞이는 자리에는 반드시 이 함수를 거칩니다. */
export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

/** 인라인 스프라이트의 아이콘 하나를 꺼냅니다. */
export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}" /></svg>`;

export const mascot = (mood = 'default') =>
  `<svg class="mascot" viewBox="0 0 64 64" aria-hidden="true"><use href="#m-${mood}" /></svg>`;

export const num = (n) => Number(n || 0).toLocaleString('ko-KR');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.error?.message || data?.error || '문제가 생겼습니다.');
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export function toast(message, { tone = '', iconName = '', ms = 4000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (tone) el.dataset.tone = tone;
  el.innerHTML = iconName ? icon(iconName) : '';
  el.append(document.createTextNode(message)); // 텍스트는 노드로 붙여 주입을 막습니다
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

/** 시 한 편을 원고지 위에 놓습니다. 길과 시집이 같은 모양을 써야 합니다. */
export function poemBodyHtml(poem) {
  return poem.stanzas
    .map(
      (stanza) =>
        `<p class="stanza">${stanza.map((line) => `<span class="line">${esc(line)}</span>`).join('')}</p>`,
    )
    .join('');
}

/**
 * 시가 쓰인 날. 달력에 없는 날짜(예: 1941-09-31)는 '년 월' 까지만 보여 줍니다.
 * 오타인지 원고에 그렇게 적힌 것인지 확인하기 전까지는 없는 날을 그려 보일 수
 * 없습니다. 원본 데이터는 일부러 그대로 둡니다.
 */
export function formatWritten(written) {
  const [y, m, d] = String(written).split('-').map(Number);
  if (d) {
    const probe = new Date(Date.UTC(y, m - 1, d));
    const real = probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
    if (real) return `${y}년 ${m}월 ${d}일`;
    return `${y}년 ${m}월`; // 날짜가 달력에 없습니다 — 확인 전까지 숨깁니다
  }
  if (m) return `${y}년 ${m}월`;
  return `${y}년`;
}

/** 원고지 위에 놓인 시 한 편 — 제목·지은이·본문. */
export function poemHtml(poem) {
  const stanzas = poemBodyHtml(poem);
  return `
    <h2 class="poem-title">${esc(poem.title)}${
      poem.hanja ? `<span class="hanja">${esc(poem.hanja)}</span>` : ''
    }</h2>
    <p class="poem-byline">윤동주 · ${esc(formatWritten(poem.written))}</p>
    <div class="poem-body${poem.form === 'prose' ? ' is-prose' : ''}">${stanzas}</div>`;
}
