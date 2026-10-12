#!/usr/bin/env node
/**
 * 디자인 결정을 실제 화면 위에서 나란히 찍어 비교 이미지를 만든다.
 *
 *   node scripts/compare-design.js [저장폴더] [주소]
 *
 * 왜 이 스크립트가 필요한가
 *   색이나 글꼴을 고를 때 색 견본과 글꼴 견본만 보고 고르면 거의 틀린다.
 *   견본에서는 좋아 보이던 색이 실제 화면에서는 버튼 열 개에 동시에 깔리고,
 *   견본에서 단정하던 글꼴은 14px 보조 글자에서 뭉개진다. 그래서 가짜 화면이
 *   아니라 로그인하고 미션까지 받은 진짜 화면을 찍는다.
 *
 * 이미지 합치기는 브라우저로 한다. 이미지 라이브러리를 더 들이지 않으려고
 * 찍은 PNG 를 HTML 에 얹어 다시 한 장으로 찍는다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'screenshots/compare';
const BASE = process.argv[3] || 'http://127.0.0.1:3000';
const RAW = path.join(OUT, 'raw');

await fs.mkdir(RAW, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  locale: 'ko-KR',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// ── 로그인해서 실제 화면까지 들어간다 ──
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#gate:not([hidden])');
const handle = 'c' + Date.now().toString(36);
await page.click('#tab-signup');
await page.fill('#signup-form [name=handle]', handle);
await page.fill('#signup-form [name=displayName]', '한결');
await page.fill('#signup-form [name=pin]', '1234');
await page.click('#signup-form button[type=submit]');
// 미션은 이제 '오늘의 시' 화면에 있어 숨겨져 있다. 그려졌는지만 본다.
await page.waitForSelector('#mission-list .mission', { state: 'attached', timeout: 15000 });

// 처음 들어온 사람에게는 하루 목표를 묻는 화면이 지도 위를 덮는다.
// 고르면 곧장 첫 마디가 열리므로 그것도 닫고 지도로 돌아온다.
await page.waitForSelector('#onboard:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(300);
await page.click('#onboard-goals [data-goal="1"]');
await page.waitForSelector('#lesson:not([hidden])', { timeout: 10000 });
await page.click('#lesson-close');
await page.waitForTimeout(600);
await page.waitForTimeout(600);

/** 비교용으로만 받아 둔 글꼴 CSS. 없으면 현재 글꼴만 비교한다. */
const compareCssReachable = await page
  .evaluate(async () => (await fetch('/fonts/_compare/compare.css')).ok)
  .catch(() => false);

const FONTS = [
  { id: 'a-plex', label: 'ⓐ IBM Plex Sans KR (현재)', stack: null },
  { id: 'b-gothic', label: 'ⓑ Gothic A1', stack: "'Gothic A1', sans-serif" },
  { id: 'c-noto', label: 'ⓒ Noto Sans KR', stack: "'Noto Sans KR', sans-serif" },
].filter((f) => f.stack === null || compareCssReachable);

/** 화면 하나를 지정한 조건으로 찍는다. */
async function render({ file, view, accent = 'blue', theme = 'light', font = null, mascot = true, full = true }) {
  await page.evaluate(
    async ({ accent, theme, font, mascot, needsCss }) => {
      const root = document.documentElement;
      root.dataset.accent = accent;
      root.dataset.theme = theme;

      // 인주 레드는 고르지 않은 안이라 배포 CSS 에 없습니다. 비교할 때만
      // 여기서 넣습니다. 쓰지 않는 색을 모든 사용자에게 보내지 않으려고요.
      if (!document.getElementById('cmp-accent')) {
        const st = document.createElement('style');
        st.id = 'cmp-accent';
        st.textContent = `
          :root[data-accent='red'] {
            --accent: #a8261c; --accent-ink: #a8261c; --accent-deep: #71170f;
            --accent-soft: #a8261c14; --accent-line: #a8261c59;
            --on-accent: #ffffff; --rule-accent: #a8261c40;
          }
          :root[data-theme='dark'][data-accent='red'] {
            --accent: #f5a79d; --accent-ink: #f5a79d; --accent-deep: #b06f66;
            --accent-soft: #f5a79d1f; --accent-line: #f5a79d59;
            --on-accent: #141310; --rule-accent: #f5a79d40;
          }`;
        document.head.append(st);
      }

      if (needsCss && !document.getElementById('cmp-css')) {
        const link = document.createElement('link');
        link.id = 'cmp-css';
        link.rel = 'stylesheet';
        link.href = '/fonts/_compare/compare.css';
        document.head.append(link);
      }
      let style = document.getElementById('cmp-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'cmp-style';
        document.head.append(style);
      }
      style.textContent =
        (font ? `:root { --font-ui: ${font}; }` : '') +
        // "아예 없음" 안. display:none 이면 흐름에서 빠져 주변 여백이
        // 실제로 닫히므로, 요소를 지운 결과와 같은 배치가 나온다.
        (mascot ? '' : '.mascot, .boot > svg, .day-done svg.mascot { display: none !important; }');
      if (document.fonts) await document.fonts.ready;
    },
    { accent, theme, font: font?.stack ?? null, mascot, needsCss: compareCssReachable },
  );
  if (view) {
    await page.click(`.tab[data-view="${view}"]`);
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(RAW, `${file}.png`), fullPage: full });
  return `${file}.png`;
}

/** 찍은 PNG 들을 라벨과 함께 한 장으로 합친다. */
async function stitch(name, title, note, cells) {
  const w = 360;
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8">
<style>
  @font-face { font-family: 'Cmp'; src: local('IBM Plex Sans KR'), local('Noto Sans KR'), local('DejaVu Sans'); }
  body { margin: 0; padding: 28px; background: #e9e5db; font-family: 'IBM Plex Sans KR', 'Noto Sans KR', 'DejaVu Sans', sans-serif; color: #23211e; }
  h1 { margin: 0 0 6px; font-size: 22px; }
  .note { margin: 0 0 22px; font-size: 14px; color: #55504a; line-height: 1.7; max-width: ${w * cells.length + 20 * (cells.length - 1)}px; }
  .row { display: flex; gap: 20px; align-items: flex-start; }
  .cell { width: ${w}px; }
  .cap { margin-bottom: 8px; font-size: 15px; font-weight: 700; }
  .sub { font-size: 13px; font-weight: 400; color: #55504a; }
  img { display: block; width: ${w}px; border: 1px solid #23211e30; }
</style>
<h1>${title}</h1>
<p class="note">${note}</p>
<div class="row">${cells
    .map(
      (c) =>
        `<div class="cell"><div class="cap">${c.label}${
          c.sub ? `<div class="sub">${c.sub}</div>` : ''
        }</div><img src="raw/${c.file}"></div>`,
    )
    .join('')}</div>`;
  const file = path.join(OUT, `${name}.html`);
  await fs.writeFile(file, html);

  const p2 = await ctx.newPage();
  await p2.goto('file://' + path.resolve(file), { waitUntil: 'load' });
  await p2.waitForTimeout(400);
  const box = await p2.evaluate(() => {
    const d = document.documentElement;
    return { w: d.scrollWidth, h: d.scrollHeight };
  });
  await p2.setViewportSize({ width: box.w, height: Math.min(box.h, 20000) });
  await p2.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  await p2.close();
  console.log(`  ${name}.png — ${box.w}×${box.h}`);
}

// ═══ 1. 포인트 색 ═══
console.log('\n포인트 색 (잉크 블루 / 인주 레드)');
const colorCells = [];
for (const [accent, label] of [
  ['blue', 'ⓐ 잉크 블루 #17468a'],
  ['red', 'ⓑ 인주 레드 #a8261c'],
]) {
  colorCells.push({
    label,
    sub: '오늘 — 버튼·점수·진행이 모두 포인트 색입니다',
    file: await render({ file: `color-${accent}-today`, view: 'today', accent }),
  });
}
await stitch(
  'A-색-오늘',
  '결정 1 — 포인트 색 (배우는 화면)',
  '포인트 색이 가장 많이 깔리는 화면입니다. 채운 버튼, 점수 알약, 미션 점수, 탭 현재 위치가 모두 이 한 색입니다. ' +
    '둘 다 종이 위 대비는 통과합니다(블루 8.03:1, 레드 6.19:1). 보실 것은 읽히는지가 아니라 <b>양</b>입니다 — ' +
    '한 화면에 여섯 군데 깔렸을 때 레드는 경고처럼 보이기 쉽고, 블루는 가라앉아 눌러야 할 곳이 덜 두드러집니다.',
  colorCells,
);

const colorRead = [];
for (const [accent, label] of [
  ['blue', 'ⓐ 잉크 블루'],
  ['red', 'ⓑ 인주 레드'],
]) {
  await page.click('.tab[data-view="library"]');
  await page.waitForSelector('.poem-row');
  await page.locator('.poem-row').nth(3).click();
  await page.waitForTimeout(500);
  colorRead.push({
    label,
    sub: '시 읽기 — 원고지 좌측 괘선이 포인트 색입니다',
    file: await render({ file: `color-${accent}-poem`, view: null, accent, full: false }),
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
await stitch(
  'B-색-시읽기',
  '결정 1 — 포인트 색 (읽는 화면)',
  '읽는 화면에서 포인트 색이 쓰이는 곳은 원고지 왼쪽 여백선 하나뿐입니다. ' +
    '실제 원고지가 무슨 색인지는 출처로 확인하지 못했으므로, 어느 쪽이 \'진짜 원고지에 가깝다\'고 말씀드리지 않겠습니다. ' +
    '보실 것은 이것입니다 — 같은 한 색이 배우는 화면의 버튼과 이 여백선을 <b>동시에</b> 맡습니다. ' +
    '버튼으로 좋은 색이 종이 위 가는 선으로도 버티는지, 둘을 같이 보셔야 합니다.',
  colorRead,
);

// ═══ 2. UI 글꼴 ═══
if (FONTS.length > 1) {
  console.log('\nUI 글꼴');
  const fontCells = [];
  for (const font of FONTS) {
    fontCells.push({
      label: font.label,
      sub: '본문 16px · 보조 14px · 딱지 12px',
      file: await render({ file: `font-${font.id}`, view: 'today', font }),
    });
  }
  await stitch(
    'C-글꼴',
    '결정 2 — UI 글꼴',
    '시 본문은 Gowun Batang 그대로입니다. 바꾸는 것은 앱의 뼈대를 쓰는 글꼴입니다. ' +
      '세 후보 모두 SIL Open Font License 1.1 이고 Google Fonts 에서 받습니다. ' +
      '큰 제목이 아니라 <b>14px 보조 글자와 12px 딱지</b>를 보셔야 합니다. 거기서 뭉개지는 글꼴이 앱을 흐려 보이게 만듭니다.',
    fontCells,
  );
  await render({ file: 'font-reset', view: 'today', font: null });
} else {
  console.log('\nUI 글꼴 — 비교용 글꼴이 없어 건너뜁니다 (public/fonts/_compare/)');
}

// ═══ 3. 표식(마스코트) ═══
console.log('\n표식');
const mascotCells = [];
for (const [on, label, sub] of [
  [true, 'ⓐ 원고지 위 잉크 한 방울', '얼굴 없음. 기분 대신 쓰기의 상태로 구별합니다'],
  [false, 'ⓑ 아예 없음', '표식을 지우고 글과 숫자만 남깁니다'],
]) {
  mascotCells.push({
    label,
    sub,
    file: await render({ file: `mascot-${on ? 'drop' : 'none'}`, view: 'me', mascot: on }),
  });
}
await stitch(
  'D-표식',
  '결정 3 — 표식을 쓸지',
  '별을 의인화한 "별이"를 걷어냈습니다. ⓐ는 원고지에 떨어진 잉크 한 방울입니다. 얼굴을 붙이지 않았습니다 — ' +
    '얼굴을 붙이면 잉크 방울은 분장한 캐릭터가 되고, 별이를 지운 이유가 없어집니다. ' +
    '그래서 기분이 없고, 대신 쓰기의 상태(한 방울 / 번져 한 줄 / 세 방울 / 마른 방울)로 넷을 구별합니다. ' +
    'ⓑ는 표식을 아예 쓰지 않는 안입니다. 윤동주 본인의 얼굴은 어느 안에서도 캐릭터화하지 않습니다.',
  mascotCells,
);

// ═══ 4. 다크 — 밤의 원고지 ═══
console.log('\n밤의 원고지 (참고)');
await stitch(
  'E-다크',
  '참고 — 기본(종이)과 다크(밤의 원고지)',
  '기본 테마가 밝은 종이로 바뀌었습니다. 다크는 밤하늘 남색을 걷어내고 어두운 종이로 다시 잡았습니다. ' +
    '결정하실 것은 없고, 색을 고르실 때 두 테마에서 함께 보시라고 덧붙였습니다.',
  [
    { label: '종이 (기본)', file: await render({ file: 'theme-light', view: 'today', theme: 'light' }) },
    { label: '밤의 원고지', file: await render({ file: 'theme-dark', view: 'today', theme: 'dark' }) },
  ],
);

await browser.close();
console.log(`\n→ ${OUT}/`);
if (errors.length) {
  console.log('\n브라우저 오류:');
  for (const e of errors) console.log('  ' + e);
}
