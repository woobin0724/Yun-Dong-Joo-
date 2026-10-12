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
const VIEWS = ['path', 'today', 'library', 'room', 'ranking', 'me'];
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
    // 브라우저가 돌려주는 색 문자열은 한 가지가 아니다.
    //   rgb(35, 33, 30) / rgba(…, 0.5)      — 0~255 정수
    //   color(srgb 0.877 0.913 0.884)       — 0~1 실수. color-mix() 가 이렇게 나온다.
    // 둘을 구별하지 않고 숫자만 긁으면 0.877 을 255 눈금의 0.877 로 읽어
    // 연한 초록이 거의 검정이 된다. 실제로 그래서 멀쩡한 화면 세 곳을
    // 1.3:1 이라고 잘못 걸렀다. 모르는 꼴은 조용히 넘기지 말고 알린다.
    const unknown = [];
    const parse = (str) => {
      const text = String(str).trim();
      if (text === 'transparent') return [0, 0, 0, 0];

      const nums = text.match(/-?[\d.]+(?:e-?\d+)?%?/gi) ?? [];
      const val = (raw, scale) => {
        if (raw === undefined) return null;
        if (raw.endsWith('%')) return (parseFloat(raw) / 100) * scale;
        return parseFloat(raw);
      };

      if (/^rgba?\(/i.test(text)) {
        const [r, g, b, a] = nums;
        return [val(r, 255), val(g, 255), val(b, 255), a === undefined ? 1 : val(a, 1)];
      }
      if (/^color\(\s*srgb\b/i.test(text)) {
        const [r, g, b, a] = nums;
        return [val(r, 1) * 255, val(g, 1) * 255, val(b, 1) * 255, a === undefined ? 1 : val(a, 1)];
      }
      unknown.push(text);
      return null;
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
      if (c === null) return behind(el.parentElement); // 못 읽은 색은 없는 셈 친다
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
      if (fg === null) continue;
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
    return { findings: out, unknown: [...new Set(unknown)] };
  });

const findings = new Map();
const unknownColors = new Set();
const add = (where, result) => {
  for (const r of result.findings) findings.set(`${where}|${r.sel}|${r.got}`, { where, ...r });
  for (const u of result.unknown) unknownColors.add(u);
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

// 처음 들어온 사람에게는 하루 목표를 묻는 화면이 지도 위를 덮는다.
// 고르면 곧장 첫 마디가 열리므로 그것도 닫고 지도로 돌아온다.
await page.waitForSelector('#onboard:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(300);
add('온보딩', await measure());
checked++;
await page.click('#onboard-goals [data-goal="1"]');
await page.waitForSelector('#lesson:not([hidden])', { timeout: 10000 });
await page.click('#lesson-close');
await page.waitForTimeout(600);

// 방 하나를 만들어 채팅 화면도 빈 상태가 아니게 한다.
await page.click('.tab[data-view="room"]');
await page.waitForTimeout(300);
if (await page.locator('#create-room-form [name=name]').count()) {
  await page.fill('#create-room-form [name=name]', '3학년 2반');
  await page.click('#create-room-form button');
  await page.waitForSelector('#chat-log .msg', { timeout: 10000 }).catch(() => {});
}
// 방의 대화상자 — 글 메뉴, 반 살펴보기. 덮는 화면이라 순회에 안 잡힌다.
await page.fill('#chat-input', '「자화상」의 우물이 오래 남습니다.');
await page.click('#chat-form button');
await page.waitForTimeout(700);
for (const theme of THEMES) {
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
  await page.locator('#chat-log .msg-more').last().click();
  await page.waitForSelector('#msg-dialog[open]');
  add(`글 메뉴·${theme}`, await measure());
  checked++;
  await page.click('#msg-hide');
  await page.waitForTimeout(700);
  add(`가린 글·${theme}`, await measure());
  checked++;
  await page.locator('#chat-log .msg-more').last().click();
  await page.waitForSelector('#msg-dialog[open]');
  await page.click('#msg-hide'); // 되돌리기
  await page.waitForTimeout(500);
  await page.click('#room-progress-btn');
  await page.waitForSelector('#progress-dialog[open]');
  add(`반 살펴보기·${theme}`, await measure());
  checked++;
  await page.evaluate(() => document.querySelector('#progress-dialog').close());
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
      // 탭이 없는 화면(오늘의 시)도 있으므로 해시로 옮깁니다.
      await page.evaluate((v) => {
        location.hash = `#${v}`;
        dispatchEvent(new HashChangeEvent('hashchange'));
      }, view);
      await page.waitForTimeout(300);
      add(`${view}·${theme}·${accent}`, await measure());
      checked++;
    }
  }
}

// 레슨은 탭이 아니라 덮는 화면이라 위 순회에 잡히지 않는다.
// 이번에 새로 생긴 가장 큰 화면이므로 걸음마다 따로 재야 한다.
for (const theme of THEMES) {
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
  await page.evaluate(() => {
    location.hash = '#path';
    dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await page.waitForTimeout(400);
  const cta = page.locator('#path-cta');
  if (!(await cta.count()) || (await cta.isHidden())) continue;
  await cta.click();
  await page.waitForSelector('#lesson:not([hidden])');
  await page.waitForTimeout(400);

  const next = page.locator('#lesson-next');
  for (let guard = 0; guard < 24; guard++) {
    add(`레슨·${theme}`, await measure());
    checked++;

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
      // 일부러 틀린 답도 한 번 고른다. 정답·오답 색이 바로 이 화면에 뜬다.
      await page.locator('#lesson-body .choice').nth(guard % 2 ? 0 : 3).click();
    } else if (kind === 'order') {
      await page.locator('#order-list [data-move="down"]').first().click();
    } else {
      await page.fill('#response-text', '마지막 두 행에서 오래 멈췄습니다. 거기서 말이 끊기기 때문입니다.');
      await page.waitForTimeout(150);
    }
    await next.click();
    await page.waitForTimeout(650);
    // 채점 결과가 떠 있는 상태도 재고 넘어간다.
    add(`레슨 결과·${theme}`, await measure());
    checked++;
    if (await page.evaluate(() => document.querySelector('#lesson-next')?.dataset.mode === 'go')) {
      await next.click();
      await page.waitForTimeout(550);
    }
  }
  await page.evaluate(() => document.querySelector('#lesson-close')?.click());
  await page.waitForTimeout(500);
}

for (const theme of THEMES) {
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);

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
  
  add(`필사·${theme}`, await measure());
  checked++;
  await page.evaluate(() => document.querySelector('#tr-close')?.click());
  await page.waitForTimeout(300);
}


// ── 시험 대비 ──
// 위에서 레슨을 끝냈으므로 시험이 열려 있어야 한다. 열리지 않으면 그것도 문제다.
for (const theme of THEMES) {
  await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
  await page.evaluate(() => {
    location.hash = '#path';
    dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await page.waitForSelector('#exam-start', { timeout: 10000 });
  await page.click('#exam-start');
  await page.waitForSelector('#exam:not([hidden])');
  await page.waitForTimeout(300);
  const en = page.locator('#exam-next');
  for (let i = 0; i < 12; i++) {
    if ((await en.getAttribute('data-mode')) === 'done') break;
    add(`시험·${theme}`, await measure());
    checked++;
    if (await page.locator('#exam-body .choice').count()) {
      await page.locator('#exam-body .choice').nth(i % 4).click();
    }
    await en.click();
    await page.waitForTimeout(450);
    add(`시험 결과·${theme}`, await measure());
    checked++;
    await en.click();
    await page.waitForTimeout(300);
  }
  add(`시험 마무리·${theme}`, await measure());
  checked++;
  await page.evaluate(() => document.querySelector('#exam-close')?.click());
  await page.waitForTimeout(400);
}

// 채점된 선택지(정답·오답 색)도 재야 한다.
await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
await page.evaluate(() => {
  location.hash = '#path';
  dispatchEvent(new HashChangeEvent('hashchange'));
});
await page.waitForTimeout(400);
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
// 검사한 화면 수에 바닥을 둔다. 레슨 순회가 첫 걸음에서 끊겨 83화면이 18화면으로
// 줄었는데도 '위반 0' 이 떴던 적이 있다. 적게 보고 통과하는 것은 통과가 아니다.
const MIN_SCREENS = 60;
if (checked < MIN_SCREENS) {
  console.log(`검사한 화면이 ${checked}개뿐입니다(최소 ${MIN_SCREENS}). 순회가 중간에 끊겼습니다.\n`);
  process.exit(3);
}
if (unknownColors.size) {
  // 읽지 못한 색이 있으면 통과를 믿을 수 없다. 조용히 넘어가지 않는다.
  console.log('읽지 못한 색 표기가 있습니다. 검사기를 고쳐야 합니다:');
  for (const u of unknownColors) console.log('  ' + u);
  console.log('');
  process.exit(2);
}
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
