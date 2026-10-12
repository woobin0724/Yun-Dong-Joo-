import { eulReul, eunNeun, euroRo, iGa } from '/lib/korean.js';

export { eulReul, eunNeun, euroRo, iGa };

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

/**
 * 서버에 묻는다. 실패는 늘 한국어 문장을 가진 Error 로 던진다.
 * 브라우저가 주는 "Failed to fetch" 가 그대로 학생 화면에 뜨던 것을 막는다.
 * err.offline 이 true 면 네트워크가 끊긴 것이다.
 */
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    const err = new Error(
      navigator.onLine === false
        ? '인터넷에 연결되어 있지 않습니다. 연결되면 다시 해 주세요.'
        : '서버에 닿지 못했습니다. 잠시 뒤 다시 해 주세요.',
    );
    err.offline = true;
    throw err;
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (res.status === 503 && data?.error) {
    const err = new Error(data.error);
    err.offline = true;
    err.status = 503;
    throw err;
  }
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
  const box = $('#toasts');
  // 한 번에 둘까지만. 더 오면 가장 오래된 것을 치운다. 넷이 쌓여 하루를 끝낸
  // 화면을 덮은 적이 있다.
  while (box.children.length >= 2) box.firstElementChild.remove();
  box.append(el);
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

/** 「제목」 뒤에 맞는 조사를 붙입니다. 「서시」를 · 「길」을 */
export const titled = (title, particle = eulReul) => `「${esc(title)}」${particle(title)}`;

/**
 * 화면 하나를 불러온다. 실패하면 빈 화면으로 두지 않고 그 자리에 이유와 '다시 시도'
 * 를 그린다. 예전에는 네트워크가 끊기면 시집·「나」가 조용히 비어 버렸고,
 * 처리하지 않은 오류가 여덟 건 쌓였다.
 */
export async function guarded(load, { into, retry = load } = {}) {
  const slot = typeof into === 'string' ? $(into) : into;
  try {
    await load();
    if (slot) slot.querySelector(':scope > .load-failed')?.remove();
  } catch (err) {
    if (!slot) {
      toast(err.message);
      return;
    }
    slot.querySelector(':scope > .load-failed')?.remove();
    const box = document.createElement('div');
    box.className = 'load-failed';
    box.setAttribute('role', 'alert');
    box.innerHTML = `${icon('info')}<span></span><button class="btn btn-sm" type="button">다시 시도</button>`;
    box.querySelector('span').textContent = err.offline
      ? `${err.message}`
      : `불러오지 못했습니다. ${err.message}`;
    box.querySelector('button').addEventListener('click', () => guarded(retry, { into: slot, retry }));
    slot.prepend(box);
  }
}
