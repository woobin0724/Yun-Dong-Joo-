#!/usr/bin/env node
/**
 * 시 본문용 글꼴(Gowun Batang)을 내려받아 자체 호스팅한다.
 *
 *   node scripts/fetch-fonts.js
 *
 * 왜 자체 호스팅인가
 *   - 외부 CDN 이 막히거나 느려도 앱이 그대로 동작해야 한다.
 *   - 서비스워커가 캐시해서 오프라인에서도 시가 제 모습으로 보여야 한다.
 *   - 사용자의 방문 기록이 제3자 서버로 새지 않는다.
 *
 * 하는 일
 *   1. Google Fonts CSS API 에서 @font-face 규칙을 받는다(woff2 를 받으려고 최신 브라우저 UA 를 쓴다).
 *   2. 거기 적힌 서브셋 파일을 전부 내려받아 public/fonts/gowun-batang/ 에 저장한다.
 *   3. CSS 안의 주소를 로컬 경로로 바꿔 public/fonts/fonts.css 로 저장한다.
 *
 * 서브셋이 190개쯤 되는데, 이게 오히려 이득이다. 브라우저는 unicode-range 를 보고
 * 화면에 실제로 쓰인 글자가 든 조각만 받는다. 한 화면당 보통 5~15개면 충분하다.
 *
 * 라이선스: Gowun Batang 은 SIL Open Font License 1.1. docs/LICENSES.md 참고.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const FAMILIES = [{ name: 'Gowun Batang', query: 'Gowun+Batang:wght@400;700', dir: 'gowun-batang' }];

const OUT_ROOT = path.resolve('public/fonts');
// woff2 를 받으려면 최신 브라우저인 척해야 한다. 아니면 구형 포맷을 준다.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function get(url, asBuffer = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return asBuffer ? Buffer.from(await res.arrayBuffer()) : res.text();
}

/** 동시에 너무 많이 요청하지 않도록 조금씩 나눠 받는다. */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
    process.stdout.write(`\r  ${Math.min(i + size, items.length)} / ${items.length}`);
  }
  process.stdout.write('\n');
  return out;
}

async function fetchFamily({ name, query, dir }) {
  console.log(`\n${name} 받는 중…`);
  const cssUrl = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  let css = await get(cssUrl);

  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g) ?? [])];
  if (!urls.length) throw new Error(`${name}: woff2 주소를 찾지 못했습니다.`);

  const outDir = path.join(OUT_ROOT, dir);
  await fs.mkdir(outDir, { recursive: true });

  let bytes = 0;
  await inBatches(urls, 8, async (url) => {
    const file = path.basename(new URL(url).pathname);
    const buf = await get(url, true);
    bytes += buf.length;
    await fs.writeFile(path.join(outDir, file), buf);
    css = css.replaceAll(url, `/fonts/${dir}/${file}`);
  });

  console.log(`  ${urls.length}개 · ${(bytes / 1024 / 1024).toFixed(2)}MB`);
  return { css, count: urls.length, bytes };
}

const results = [];
for (const family of FAMILIES) results.push(await fetchFamily(family));

const header = `/* 자동 생성 파일 — 고치지 마세요. \`node scripts/fetch-fonts.js\` 로 다시 만듭니다.
 *
 * Gowun Batang — SIL Open Font License 1.1
 * Copyright 2021 The Gowun Batang Project Authors
 * (https://github.com/yangheeryu/Gowun-Batang)
 * 출처: Google Fonts. 라이선스 전문은 docs/LICENSES.md 참고.
 *
 * UI 글꼴은 따로 받지 않고 각 기기의 시스템 글꼴을 씁니다
 * (iOS: Apple SD Gothic Neo / Windows: 맑은 고딕 / Android: Noto Sans KR).
 * 내려받을 것이 없으니 가장 빠르고, 기기에 가장 자연스럽게 어울립니다.
 */
`;

await fs.writeFile(path.join(OUT_ROOT, 'fonts.css'), header + results.map((r) => r.css).join('\n'));

const total = results.reduce((sum, r) => sum + r.bytes, 0);
console.log(
  `\n완료 — 파일 ${results.reduce((s, r) => s + r.count, 0)}개, ` +
    `${(total / 1024 / 1024).toFixed(2)}MB → public/fonts/`,
);
