#!/usr/bin/env node
/**
 * 구글 로그인 흐름을 브라우저로 직접 눌러 확인한다.
 *
 *   1) node scripts/fake-google-server.js          (가짜 구글, 4100)
 *   2) GOOGLE_FAKE_BASE=http://127.0.0.1:4100 \
 *      GOOGLE_CLIENT_ID=fake-client-id \
 *      GOOGLE_CLIENT_SECRET=fake-secret \
 *      GOOGLE_REDIRECT_URI=${BASE}/api/auth/google/callback \
 *      PORT=3100 npm start                        (앱)
 *   3) node scripts/verify-google-login.js screenshots/google
 *
 * 확인하는 것: 구글 버튼 표시 → 동의 화면 → 취소 안내 → 첫 로그인(이름 정하기)
 * → 아이디 규칙 검사 → 재로그인 시 환영 화면 건너뛰기.
 *
 * 실제 구글 자격증명으로 확인하려면 GOOGLE_FAKE_BASE 없이 진짜 키로 띄우고
 * 브라우저에서 직접 눌러 보면 된다 (자동화는 구글 로그인 화면 때문에 어렵다).
 */
import { chromium } from 'playwright';

const OUT = process.argv[2] || 'screenshots/google';
const BASE = process.argv[3] || 'http://127.0.0.1:3100';
await (await import('node:fs/promises')).mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport:{width:360,height:780}, deviceScaleFactor:2, colorScheme:'dark', locale:'ko-KR' });
const page = await ctx.newPage();
// 가짜 구글 서버(다른 포트)에서 나는 소리는 앱의 문제가 아니므로 따로 센다.
const errs = [];
// 일부러 잘못된 값을 넣어 보는 구간에서는 오류가 나는 게 정상이다.
let expectingError = null;

page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
page.on('response', (r) => {
  if (r.status() < 400) return;
  if (!r.url().startsWith(BASE)) return;          // 가짜 구글 쪽 요청은 제외
  if (r.url().endsWith('/api/auth/me') && r.status() === 401) return; // 로그인 전 확인은 정상
  if (expectingError && r.url().includes(expectingError)) return;
  errs.push(`${r.status()} ${r.url()}`);
});
const shot = (n, full=true) => page.screenshot({ path:`${OUT}/${n}.png`, fullPage:full });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#gate:not([hidden])');
await page.waitForTimeout(500);
await shot('g1-login-with-google');

// 구글 버튼이 실제로 떴는지
const visible = await page.locator('#google-btn').isVisible();
console.log('구글 버튼 표시됨:', visible);

// 취소 경로 먼저
await page.click('#google-btn');
await page.waitForURL(/4100/, { timeout: 8000 });
await shot('g2-consent', false);
await page.click('#cancel');
await page.waitForURL(/3100/, { timeout: 8000 });
await page.waitForTimeout(600);
await shot('g3-cancelled');
console.log('취소 후 안내:', (await page.locator('#gate-error').textContent()).trim());

// 정상 로그인
await page.click('#google-btn');
await page.waitForURL(/4100/, { timeout: 8000 });
await page.click('#new-user');
await page.waitForURL(/3100/, { timeout: 10000 });
await page.waitForSelector('#welcome:not([hidden])', { timeout: 8000 });
await page.waitForTimeout(600);
await shot('g4-welcome');
console.log('이름 기본값:', await page.locator('#welcome-form [name=displayName]').inputValue());
console.log('아이디 기본값:', await page.locator('#welcome-form [name=handle]').inputValue());

// 규칙에 어긋나는 아이디를 넣으면 거부되는지 (여기서 나는 400 은 예상된 것)
expectingError = '/api/me/profile';
await page.fill('#welcome-form [name=handle]', 'ㄱ');
await page.click('#welcome-form button');
await page.waitForTimeout(600);
console.log('잘못된 아이디 안내:', (await page.locator('#welcome-error').textContent()).trim());
expectingError = null;

// 제대로 넣기
// 여러 번 돌려도 겹치지 않게 아이디를 새로 짓는다.
const handle = `dongju${Date.now().toString(36)}`;
await page.fill('#welcome-form [name=displayName]', '동주');
await page.fill('#welcome-form [name=handle]', handle);
await page.click('#welcome-form button');
await page.waitForSelector('#mission-list .mission', { timeout: 10000 });
await page.waitForTimeout(800);
await shot('g5-after-signup');
console.log('정한 아이디:', handle);

// 다시 로그인하면 환영 화면을 건너뛰는지
await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('#gate:not([hidden])');
await page.click('#google-btn');
await page.waitForURL(/4100/, { timeout: 8000 });
await page.click('#returning-user');
await page.waitForSelector('#mission-list .mission', { timeout: 10000 });
console.log('두 번째 로그인 — 환영 화면 건너뜀:', page.url().includes('#today'));
await shot('g6-returning');

console.log(errs.length ? `앱 오류:\n  ${errs.join('\n  ')}` : '앱 오류 없음');
await browser.close();
process.exit(errs.length ? 1 : 0);
