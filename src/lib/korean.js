/**
 * 한국어 조사 자동 선택.
 * 앞 글자에 받침이 있는지에 따라 을/를, 은/는, 이/가, 과/와, 으로/로 를 고른다.
 */

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/** 조사를 붙일 때 방해가 되는 뒤쪽 문장부호·공백을 떼어 낸다. */
function stripTrailing(word) {
  return String(word ?? '').replace(/[\s.,!?…·—–\-:;"'”’」』）)\]}]+$/u, '');
}

/** 마지막 글자에 받침이 있으면 true. 한글이 아니면 null. */
export function hasFinalConsonant(word) {
  if (!word) return null;
  const cleaned = stripTrailing(word);
  const ch = cleaned.at(-1);
  if (!ch) return null;
  const code = ch.codePointAt(0);
  if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
    return (code - HANGUL_BASE) % 28 !== 0;
  }
  // 숫자·영문은 읽는 소리 기준으로 흔히 쓰이는 값을 따른다.
  const digitFinal = { 0: true, 1: true, 3: true, 6: true, 7: true, 8: true };
  if (/[0-9]/.test(ch)) return digitFinal[Number(ch)] ?? false;
  if (/[a-zA-Z]/.test(ch)) return /[lmnrLMNR]/.test(ch);
  return null;
}

function choose(word, withFinal, withoutFinal) {
  const final = hasFinalConsonant(word);
  if (final === null) return `${withFinal}(${withoutFinal})`;
  return final ? withFinal : withoutFinal;
}

/** 목적격 조사: 을/를 */
export const eulReul = (w) => choose(w, '을', '를');
/** 주제격 조사: 은/는 */
export const eunNeun = (w) => choose(w, '은', '는');
/** 주격 조사: 이/가 */
export const iGa = (w) => choose(w, '이', '가');
/** 접속 조사: 과/와 */
export const gwaWa = (w) => choose(w, '과', '와');
/** 방향 조사: 으로/로 (ㄹ 받침은 '로') */
export function euroRo(word) {
  const cleaned = stripTrailing(word);
  const ch = cleaned.at(-1);
  if (ch) {
    const code = ch.codePointAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST && (code - HANGUL_BASE) % 28 === 8) {
      return '로'; // ㄹ 받침
    }
  }
  return choose(word, '으로', '로');
}
/** 호격 조사: 아/야 */
export const aYa = (w) => choose(w, '아', '야');

/** `조사(제목, eulReul)` 형태로 붙여 쓰는 도우미. */
export function withParticle(word, particleFn) {
  return `${word}${particleFn(word)}`;
}
