import crypto from 'node:crypto';

/** 문자열을 32비트 정수 시드로 바꾼다. */
export function seedFrom(str) {
  const hash = crypto.createHash('sha256').update(String(str)).digest();
  return hash.readUInt32BE(0);
}

/**
 * mulberry32 — 시드가 같으면 항상 같은 수열을 내는 작은 PRNG.
 * "오늘의 시"나 "오늘의 미션"처럼 하루 동안 모두에게 동일해야 하는 값을 뽑을 때 쓴다.
 */
export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : seedFrom(seed);
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 배열에서 하나 고른다. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** 원본을 건드리지 않고 섞은 새 배열을 준다 (Fisher–Yates). */
export function shuffled(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 중복 없이 n개를 고른다. */
export function sample(rng, arr, n) {
  return shuffled(rng, arr).slice(0, n);
}
