#!/usr/bin/env node
/**
 * 실제 브라우저로 앱을 돌아 보며 화면을 찍고, 눈으로 놓치기 쉬운 것을 점검한다.
 *
 *   node scripts/screenshot.js [저장폴더] [주소]
 *
 * 기본값: ./screenshots, http://127.0.0.1:3000
 *
 * 화면만 찍는 게 아니라 아래를 함께 확인하고, 문제가 있으면 종료 코드 1 을 돌려준다.
 *   - 콘솔 오류 (CSP 위반, 깨진 요청 …)
 *   - 터치 영역 44px 미만
 *   - 이름 없는 버튼 (스크린리더가 읽을 것이 없음)
 *   - 시 본문 글꼴이 실제로 적용됐는지
 */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'screenshots';
const BASE = process.argv[3] || 'http://127.0.0.1:3000';

await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({
  viewport: { width: 360, height: 780 }, // 가장 좁은 흔한 폰 기준
  deviceScaleFactor: 2,
  colorScheme: 'light',
  locale: 'ko-KR',
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

const shot = (name, fullPage = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
const setTheme = (theme) =>
  page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);

/** 지금 보이는 화면의 접근성을 점검한다. */
const audit = () =>
  page.evaluate(() => {
    const issues = [];
    const visible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

    // WCAG 2.5.5 는 44×44 를 요구한다. 이전 판은 가로를 24px 로 재고 있어서
    // 사실상 세로만 검사했다. 글 속에 섞인 링크는 가로를 줄일 수 없으므로
    // 거기만 세로를 본다.
    for (const el of document.querySelectorAll('button, select, input, textarea')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44)) {
        issues.push(
          `터치영역 ${Math.round(r.width)}×${Math.round(r.height)} (44×44 필요) — ` +
            `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent || '').trim().slice(0, 14)}"`,
        );
      }
    }
    for (const el of document.querySelectorAll('a[href]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 24) {
        issues.push(`링크 높이 ${Math.round(r.height)}px — a "${(el.textContent || '').trim().slice(0, 14)}"`);
      }
    }
    for (const el of document.querySelectorAll('button')) {
      if (!visible(el)) continue;
      if (!(el.getAttribute('aria-label') || el.textContent || '').trim()) {
        issues.push(`이름 없는 버튼 — .${el.className}`);
      }
    }
    for (const el of document.querySelectorAll('svg')) {
      if (!visible(el)) continue;
      if (!el.hasAttribute('aria-hidden') && !el.getAttribute('aria-label') && !el.querySelector('title')) {
        issues.push(`대체텍스트 없는 svg — 부모 .${el.parentElement?.className}`);
      }
    }
    return issues;
  });

const allIssues = new Set();
const collect = async (where) => {
  for (const issue of await audit()) allIssues.add(`[${where}] ${issue}`);
};

// ── 첫 화면 대기 ──
// 로그인 확인이 끝나기 전 상태를 잡으려면 응답을 잠깐 붙잡아 둬야 한다.
let delayedOnce = false;
await page.route('**/api/auth/me', async (route) => {
  if (!delayedOnce) {
    delayedOnce = true;
    await new Promise((r) => setTimeout(r, 900));
  }
  await route.continue();
});
await page.goto(BASE);
await page.waitForSelector('#boot:not([hidden])');
await shot('00-boot', false);
await page.waitForLoadState('networkidle'); // 요청이 끝난 뒤에 라우트를 걷는다
await page.unroute('**/api/auth/me');

// ── 로그인 화면 ──
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#gate:not([hidden])');
await page.waitForTimeout(500);
await shot('01-login-paper');
await collect('로그인');

await setTheme('dark');
await page.waitForTimeout(300);
await shot('02-login-night');
await setTheme('light');

// ── 가입 ──
const handle = 'u' + Date.now().toString(36);
await page.click('#tab-signup');
await page.fill('#signup-form [name=handle]', handle);
await page.fill('#signup-form [name=displayName]', '한결');
await page.fill('#signup-form [name=pin]', '1234');
await page.click('#signup-form button[type=submit]');
await page.waitForSelector('#mission-list .mission', { timeout: 10000 });

// 처음 들어온 사람에게는 하루 목표를 묻는 화면이 지도 위를 덮는다.
// 고르면 곧장 첫 마디가 열리므로 그것도 닫고 지도로 돌아온다.
await page.waitForSelector('#onboard:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(300);
await shot('03a-onboarding', false);
await collect('온보딩');
await page.click('#onboard-goals [data-goal="1"]');
await page.waitForSelector('#lesson:not([hidden])', { timeout: 10000 });
await page.click('#lesson-close');
await page.waitForTimeout(600);
await page.waitForTimeout(700);
await shot('03-today-paper');
await collect('오늘');

await setTheme('dark');
await page.waitForTimeout(300);
await shot('04-today-night');
await setTheme('light');

// ── 미션 풀기 ──
const check = page.locator('[data-act="check"]').first();
if (await check.count()) {
  await check.click();
  await page.waitForTimeout(900);
}
const choice = page.locator('.mission .choice').first();
if (await choice.count()) {
  await choice.click();
  await page.locator('[data-act="quiz"]').first().click();
  await page.waitForTimeout(900);
}
await shot('05-mission-feedback');

// ── 시집 ──
await page.click('.tab[data-view="library"]');
await page.waitForSelector('.poem-row');
await shot('06-library');
await collect('시집');
await page.locator('.poem-row').nth(3).click();
await page.waitForTimeout(600);
await shot('07-poem-sheet', false);
await page.keyboard.press('Escape');

// ── 방 ──
await page.click('.tab[data-view="room"]');
await page.waitForTimeout(400);
await collect('방(빈 상태)');
await page.fill('#create-room-form [name=name]', '3학년 2반');
await page.click('#create-room-form button');
await page.waitForSelector('#chat-log .msg', { timeout: 10000 });
await page.fill('#chat-input', '「자화상」의 우물 장면이 오래 남습니다.');
await page.click('#chat-form button');
await page.waitForTimeout(900);
await shot('08-room', false);
await collect('방');

// ── 랭킹 ──
await page.click('.tab[data-view="ranking"]');
await page.waitForTimeout(600);
await shot('09-ranking');
await collect('랭킹');

// ── 나 ──
await page.click('.tab[data-view="me"]');
// 도전과제는 이제 접혀 있어 보이지 않는다. 「나」의 첫 덩어리인 걸어온 길을 기다린다.
await page.waitForSelector('.walked-step');
await page.waitForTimeout(500);
await shot('10-me-paper');
await collect('나');
await setTheme('dark');
await page.waitForTimeout(300);
await shot('11-me-night');

// ── 레슨 ──
// 이번에 생긴 가장 큰 화면인데 탭이 없어서 위 순회에 잡히지 않는다.
await page.evaluate(() => {
  location.hash = '#path';
  dispatchEvent(new HashChangeEvent('hashchange'));
});
await page.waitForTimeout(500);
const cta = page.locator('#path-cta');
if ((await cta.count()) && (await cta.isVisible())) {
  await cta.click();
  await page.waitForSelector('#lesson:not([hidden])');
  await page.waitForTimeout(500);
  await shot('15-lesson-read', false);
  await collect('레슨(천천히 읽기)');

  const nextBtn = page.locator('#lesson-next');
  for (let guard = 0; guard < 20; guard++) {
    const kind = await page.evaluate(() => {
      if (document.querySelector('#lesson-body .lesson-done')) return 'done';
      if (document.querySelector('#slow-stanza')) return 'slow';
      if (document.querySelector('#order-list .order-moves')) return 'order';
      if (document.querySelector('#response-text')) return 'response';
      if (document.querySelector('#lesson-body .choice')) return 'choice';
      return '?';
    });
    if (kind === 'done' || kind === '?') break;

    if (kind === 'slow') {
      await page.waitForFunction(() => !document.querySelector('#lesson-next').disabled, {
        timeout: 25000,
      });
    } else if (kind === 'choice') {
      await page.locator('#lesson-body .choice').first().click();
    } else if (kind === 'order') {
      await page.locator('#order-list [data-move="down"]').first().click();
      await shot('16-lesson-order', false);
      await collect('레슨(행 순서)');
    } else {
      await page.fill('#response-text', '마지막 두 행에서 오래 멈췄습니다. 거기서 말이 끊기기 때문입니다.');
      await page.waitForTimeout(150);
      await shot('17-lesson-response', false);
      await collect('레슨(한 줄 감상)');
    }
    await nextBtn.click();
    await page.waitForTimeout(650);
    await collect(`레슨 결과(${kind})`);
    if (await page.evaluate(() => document.querySelector('#lesson-next')?.dataset.mode === 'go')) {
      await nextBtn.click();
      await page.waitForTimeout(550);
    }
  }
  await shot('18-lesson-done', false);
  await collect('레슨(마디 완료)');
  await page.evaluate(() => document.querySelector('#lesson-close')?.click());
  await page.waitForTimeout(600);
}


// ── 시험 대비 ──
await page.evaluate(() => {
  location.hash = '#path';
  dispatchEvent(new HashChangeEvent('hashchange'));
});
await page.waitForTimeout(500);
if (await page.locator('#exam-start').count()) {
  await page.click('#exam-start');
  await page.waitForSelector('#exam:not([hidden])');
  await page.waitForTimeout(300);
  await shot('20-exam', false);
  await collect('시험 대비');
  const en = page.locator('#exam-next');
  if (await page.locator('#exam-body .choice').count()) await page.locator('#exam-body .choice').first().click();
  await en.click();
  await page.waitForTimeout(450);
  await collect('시험 채점');
  await page.evaluate(() => document.querySelector('#exam-close')?.click());
  await page.waitForTimeout(400);
} else {
  allIssues.add('[시험 대비] 레슨을 끝냈는데 시험이 열리지 않습니다');
}

// ── 원고지 필사 ──
// 덮는 화면이라 탭 순회에 잡히지 않는다. 시집에서 열어 몇 줄 적어 본다.
await page.evaluate(() => {
  location.hash = '#library';
  dispatchEvent(new HashChangeEvent('hashchange'));
});
await page.waitForSelector('.poem-row');
await page.locator('.poem-row').first().click();
await page.waitForSelector('#poem-dialog[open]');
await page.click('#poem-transcribe');
await page.waitForSelector('#transcribe:not([hidden])');
await page.fill('#tr-input', '죽는 날까지 하늘을 우러러\n한 점 부끄럼이 없기를,');
await page.dispatchEvent('#tr-input', 'input');
await page.waitForTimeout(300);
await shot('19-transcribe', false);
await collect('원고지 필사');
await page.evaluate(() => document.querySelector('#tr-close')?.click());
await page.waitForTimeout(400);

// ── 데스크톱 폭에서 한 바퀴 더 ──
// 모바일만 고치고 넓은 화면을 방치하는 일이 흔하다.
await page.setViewportSize({ width: 1280, height: 900 });
await setTheme('light');
for (const [view, name] of [
  ['path', '12-path-wide'],
  ['room', '13-room-wide'],
  ['me', '14-me-wide'],
]) {
  await page.click(`.tab[data-view="${view}"]`);
  await page.waitForTimeout(500);
  await shot(name, view !== 'room');
  await collect(`${view}(넓은 화면)`);
}
await page.setViewportSize({ width: 360, height: 780 });

// ── 확인 ──
// 시 본문은 '오늘의 시' 화면에 있다. 홈이 지도로 바뀌면서 홈에는 시가 없다.
await page.evaluate(() => {
  location.hash = '#today';
  dispatchEvent(new HashChangeEvent('hashchange'));
});
await page.waitForTimeout(500);

const fontFamily = await page.evaluate(() => {
  const el = document.querySelector('.poem-title');
  return el ? getComputedStyle(el).fontFamily : '(없음)';
});
const fontLoaded = await page.evaluate(() => document.fonts.check('16px "Gowun Batang"'));

// 한 줄에 몇 글자가 들어가는지 (한국어는 35~45자가 읽기 좋다).
// 시행은 시인이 끊은 자리라 이 잣대를 대지 않는다. 산문(읽기 도움말)로 잰다.
const measure = await page.evaluate(() => {
  // 읽기 도움말은 산문이라 줄당 글자 수가 뜻을 가진다.
  const el = document.querySelector('.reading-note p') ?? document.querySelector('.poem-body .stanza');
  if (!el) return null;
  const style = getComputedStyle(el);
  const probe = document.createElement('span');
  probe.style.cssText = `font:${style.font};visibility:hidden;position:absolute;white-space:nowrap`;
  probe.textContent = '가';
  document.body.append(probe);
  const glyph = probe.getBoundingClientRect().width;
  probe.remove();
  return Math.round(el.getBoundingClientRect().width / glyph);
});

await browser.close();

console.log(`\n저장 위치: ${OUT}/`);
console.log(`시 글꼴: ${fontFamily}`);
console.log(`Gowun Batang 로드됨: ${fontLoaded ? '예' : '아니요'}`);
console.log(`산문 한 줄: 약 ${measure}자 (한국어는 35~45자가 읽기 좋습니다)`);

// 로그인 전 /api/auth/me 가 401 을 주는 건 정상이라 걸러 냅니다.
const realErrors = consoleErrors.filter((e) => !e.includes('401'));
console.log(
  realErrors.length ? `\n콘솔 오류:\n  ${realErrors.join('\n  ')}` : '\n콘솔 오류 없음',
);
console.log(
  allIssues.size ? `\n접근성:\n  ${[...allIssues].join('\n  ')}` : '\n접근성 문제 없음',
);

const failed = realErrors.length > 0 || allIssues.size > 0 || !fontLoaded;
process.exit(failed ? 1 : 0);
