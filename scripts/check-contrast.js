#!/usr/bin/env node
/**
 * 실제로 화면에 칠해진 색으로 대비를 잰다.
 *
 *   node scripts/check-contrast.js [주소]
 *
 * 왜 다시 썼는가
 *   이전 판은 styles.css 의 토큰 선언을 글자로 읽어 짝을 맞춰 보는 방식이었다.
 *   34개 짝이 모두 통과했는데, 같은 시점에 「나」 화면에서 가장 큰 덩어리였던
 *   도전과제 글이 2.19:1 이었다. .challenge 에 걸린 opacity: 0.55 를 토큰만
 *   들여다보는 검사가 볼 수 없었기 때문이다.
 *
 *   그래서 이제 브라우저를 띄워 로그인하고, 화면에 실제로 보이는 글자마다
 *   조상에 걸린 opacity 를 모두 곱하고 반투명 배경을 차례로 합성한 다음,
 *   그 결과 색으로 대비를 잰다. 토큰 짝이 아니라 사람 눈에 닿는 색이다.
 *
 * 기준 (WCAG 2.1 AA)
 *   본문 4.5:1 · 큰 글자(24px 이상, 또는 굵고 18.66px 이상) 3:1
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const VIEWS = ['today', 'library', 'room', 'ranking', 'me'];
const THEMES = ['light', 'dark'];
// 인주 레드는 고르지 않은 안이라 배포 CSS 에 없습니다. 재 봐야 블루와
// 같은 값이 나오므로 빼둡니다. 포인트 색을 다시 고르면 여기도 늘립니다.
const ACCENTS = ['blue'];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({
  viewport: { width: 360, height: 780 },
  deviceScaleFactor: 1,
  locale: 'ko-KR',
});
const page = await ctx.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('#gate:not([hidden])');

/** 로그인 화면도 검사 대상이다. 먼저 여기서 한 번 재고 들어간다. */
const measure = () =>
  page.evaluate(() => {
    const parse = (s) => {
      const m = s.match(/[\d.]+/g);
      if (!m) return [0, 0, 0, 0];
      return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
    };
    const over = (fg, bg) => {
      const a = fg[3];
      return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
    };
    const lum = (c) => {
      const f = (v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };

    /** el 뒤에 실제로 깔린 색. 반투명 배경은 그 뒤의 색과 합성한다. */
    const behind = (el) => {
      if (!el) return [255, 255, 255];
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c[3] >= 0.999) return c.slice(0, 3);
      if (c[3] > 0) return over(c, behind(el.parentElement));
      return behind(el.parentElement);
    };

    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    /** el 자신과 조상에 걸린 opacity 를 모두 곱한 값과, 그 투명도가
        시작되는 지점 바로 바깥의 배경색을 함께 돌려준다. */
    const opacityChain = (el) => {
      let op = 1;
      let outermostFaded = null;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const o = parseFloat(getComputedStyle(n).opacity);
        if (o < 0.999) {
          op *= o;
          outermostFaded = n;
        }
      }
      return { op, outermostFaded };
    };

    const out = [];
    const seen = new Set();

    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      // 자기 자신이 직접 가진 글자만 본다 (자식 글자는 자식 차례에 잰다).
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim())
        .join(' ');
      if (!own) continue;

      const cs = getComputedStyle(el);
      const { op, outermostFaded } = opacityChain(el);
      // 투명도가 걸려 있으면 그 덩어리 전체가 '뒤쪽 배경' 위로 흐려진다.
      const bg = outermostFaded
        ? behind(outermostFaded.parentElement)
        : behind(el);
      const fg = parse(cs.color);
      const text = over([fg[0], fg[1], fg[2], fg[3] * op], bg);

      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const got = ratio(text, bg);

      if (got + 0.005 < need) {
        const sel =
          el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          (el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\s+/).join('.')
            : '');
        const key = sel + '|' + Math.round(got * 100);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          sel,
          got: +got.toFixed(2),
          need,
          size: Math.round(size),
          opacity: +op.toFixed(2),
          text: own.slice(0, 26),
        });
      }
    }
    return out;
  });

const findings = new Map();
const add = (where, rows) => {
  for (const r of rows) findings.set(`${where}|${r.sel}|${r.got}`, { where, ...r });
};

let checked = 0;
add('로그인', await measure());
checked++;

// ── 로그인하고 모든 화면을 돈다 ──
const handle = 'k' + Date.now().toString(36);
await page.click('#tab-signup');
await page.fill('#signup-form [name=handle]', handle);
await page.fill('#signup-form [name=displayName]', '한결');
await page.fill('#signup-form [name=pin]', '1234');
await page.click('#signup-form button[type=submit]');
await page.waitForSelector('#mission-list .mission', { timeout: 15000 });

// 방 하나를 만들어 채팅 화면도 빈 상태가 아니게 한다.
await page.click('.tab[data-view="room"]');
await page.waitForTimeout(300);
if (await page.locator('#create-room-form [name=name]').count()) {
  await page.fill('#create-room-form [name=name]', '3학년 2반');
  await page.click('#create-room-form button');
  await page.waitForSelector('#chat-log .msg', { timeout: 10000 }).catch(() => {});
}

for (const theme of THEMES) {
  for (const accent of ACCENTS) {
    await page.evaluate(
      ({ theme, accent }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.accent = accent;
      },
      { theme, accent },
    );
    for (const view of VIEWS) {
      await page.click(`.tab[data-view="${view}"]`);
      await page.waitForTimeout(260);
      add(`${view}·${theme}·${accent}`, await measure());
      checked++;
    }
  }
}

// 채점된 선택지(정답·오답 색)도 재야 한다.
await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
await page.click('.tab[data-view="today"]');
await page.waitForTimeout(300);
const choice = page.locator('.mission .choice').first();
if (await choice.count()) {
  await choice.click();
  const submit = page.locator('[data-act="quiz"]').first();
  if (await submit.count()) {
    await submit.click();
    await page.waitForTimeout(800);
    add('채점 결과·light', await measure());
    checked++;
  }
}

await browser.close();

const rows = [...findings.values()].sort((a, b) => a.got - b.got);
console.log(`\n화면 ${checked}번을 돌며 실제 합성된 색으로 쟀습니다.\n`);
if (!rows.length) {
  console.log('기준 미만인 글자가 없습니다. (본문 4.5:1 · 큰 글자 3:1)\n');
  process.exit(0);
}
console.log(`기준 미만 ${rows.length}건:\n`);
for (const r of rows) {
  console.log(
    `  ${String(r.got).padStart(5)}:1  (${r.need} 필요)  ${r.size}px` +
      (r.opacity < 1 ? ` opacity ${r.opacity}` : '') +
      `\n         ${r.where} — ${r.sel}\n         "${r.text}"`,
  );
}
console.log('');
process.exit(1);
