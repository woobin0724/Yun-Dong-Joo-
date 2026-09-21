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
  colorScheme: 'dark',
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

    for (const el of document.querySelectorAll('button, a[href], select, input, textarea')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 24)) {
        issues.push(
          `터치영역 ${Math.round(r.width)}×${Math.round(r.height)} — ` +
            `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent || '').trim().slice(0, 14)}"`,
        );
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

// ── 로그인 화면 ──
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#gate:not([hidden])');
await page.waitForTimeout(500);
await shot('01-login-dark');
await collect('로그인');

await setTheme('light');
await page.waitForTimeout(300);
await shot('02-login-light');
await setTheme('dark');

// ── 가입 ──
const handle = 'u' + Date.now().toString(36);
await page.click('#tab-signup');
await page.fill('#signup-form [name=handle]', handle);
await page.fill('#signup-form [name=displayName]', '한결');
await page.fill('#signup-form [name=pin]', '1234');
await page.click('#signup-form button[type=submit]');
await page.waitForSelector('#mission-list .mission', { timeout: 10000 });
await page.waitForTimeout(700);
await shot('03-today-dark');
await collect('오늘');

await setTheme('light');
await page.waitForTimeout(300);
await shot('04-today-light');
await setTheme('dark');

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
await page.waitForSelector('.challenge');
await page.waitForTimeout(500);
await shot('10-me-dark');
await collect('나');
await setTheme('light');
await page.waitForTimeout(300);
await shot('11-me-light');

// ── 확인 ──
const fontFamily = await page.evaluate(() => {
  const el = document.querySelector('.poem-title');
  return el ? getComputedStyle(el).fontFamily : '(없음)';
});
const fontLoaded = await page.evaluate(() => document.fonts.check('16px "Gowun Batang"'));

await browser.close();

console.log(`\n저장 위치: ${OUT}/`);
console.log(`시 글꼴: ${fontFamily}`);
console.log(`Gowun Batang 로드됨: ${fontLoaded ? '예' : '아니요'}`);

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
