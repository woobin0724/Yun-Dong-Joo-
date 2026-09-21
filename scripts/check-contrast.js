#!/usr/bin/env node
/**
 * 색 대비 검사.
 *
 *   node scripts/check-contrast.js
 *
 * 디자인 토큰에서 실제로 겹쳐 쓰이는 조합을 뽑아 WCAG 대비를 잽니다.
 * 눈으로 "괜찮아 보인다"는 것과 실제로 읽히는 것은 다릅니다.
 *
 * 기준: 본문 4.5:1, 큰 글씨(18.66px 이상 굵게 / 24px 이상) 3:1, UI 경계 3:1.
 */
import fs from 'node:fs';

const css = fs.readFileSync('public/styles.css', 'utf8');

/** 해당 테마 블록에서 토큰 값을 읽는다. */
function tokens(themeSelector) {
  const start = css.indexOf(themeSelector);
  if (start === -1) throw new Error(`블록을 찾지 못했습니다: ${themeSelector}`);
  const block = css.slice(start, css.indexOf('}', start));
  const out = {};
  for (const [, name, value] of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

/** 반투명 색을 배경 위에 얹은 실제 색으로 만든다. */
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fgHex, bgHex) {
  const bg = parseHex(bgHex);
  const fg = over(parseHex(fgHex), bg);
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** [글자색, 배경색, 설명, 최소 기준] */
const PAIRS = [
  ['--ink', '--bg', '본문 글자 / 배경', 4.5],
  ['--ink', '--surface', '본문 글자 / 카드', 4.5],
  ['--ink', '--manuscript', '시 본문 / 원고지', 4.5],
  ['--ink-soft', '--bg', '보조 글자 / 배경', 4.5],
  ['--ink-soft', '--surface', '보조 글자 / 카드', 4.5],
  ['--ink-mute', '--bg', '흐린 글자 / 배경', 3.0],
  ['--star-ink', '--bg', '별빛 글자 / 배경', 4.5],
  ['--star-ink', '--surface', '별빛 글자 / 카드', 4.5],
  ['--star-ink', '--surface-2', '별빛 글자 / 알약', 4.5],
  ['--star-on-fill', '--star', '버튼 글자 / 버튼', 4.5],
  ['--leaf', '--bg', '완료 표시 / 배경', 4.5],
  ['--alert', '--bg', '오류 표시 / 배경', 4.5],
  ['--line-strong', '--bg', '테두리 / 배경', 1.5],
];

let failed = 0;
for (const [label, selector] of [
  ['밤 (dark)', ":root,\n:root[data-theme='dark'] {"],
  ['한지 (light)', ":root[data-theme='light'] {"],
]) {
  const t = tokens(selector);
  console.log(`\n${label}`);
  for (const [fg, bg, desc, min] of PAIRS) {
    if (!t[fg] || !t[bg]) { console.log(`  ?  ${desc} — 토큰 없음`); continue; }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(
      `  ${ok ? '✓' : '✗'}  ${desc.padEnd(22)} ${r.toFixed(2)}:1  (기준 ${min})`,
    );
  }
}

console.log(failed ? `\n${failed}개 조합이 기준에 못 미칩니다.` : '\n모든 조합이 기준을 넘습니다.');
process.exit(failed ? 1 : 0);
