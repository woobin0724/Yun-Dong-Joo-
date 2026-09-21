#!/usr/bin/env node
/**
 * SVG 아이콘에서 PNG 를 굽는다.
 *
 *   node scripts/make-icons.js
 *
 * 일부 플랫폼(특히 iOS 홈 화면)은 SVG 아이콘을 받지 않아서 PNG 가 따로 필요하다.
 * 손으로 그린 PNG 를 저장소에 넣어 두는 대신, SVG 하나를 원본으로 두고
 * 필요한 크기를 여기서 만들어 낸다. 아이콘을 고치면 이 명령만 다시 돌리면 된다.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ICONS = path.resolve('public/icons');
const JOBS = [
  { from: 'icon.svg', to: 'icon-192.png', size: 192 },
  { from: 'icon.svg', to: 'icon-512.png', size: 512 },
  { from: 'icon.svg', to: 'apple-touch-icon.png', size: 180 },
  { from: 'icon-maskable.svg', to: 'icon-maskable-512.png', size: 512 },
  { from: 'icon.svg', to: 'favicon-32.png', size: 32 },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const job of JOBS) {
  const svg = await fs.readFile(path.join(ICONS, job.from), 'utf8');
  const page = await browser.newPage({
    viewport: { width: job.size, height: job.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;width:${job.size}px;height:${job.size}px">
     ${svg.replace(/width="\d+"\s+height="\d+"/, `width="${job.size}" height="${job.size}"`)}
     </body></html>`,
  );
  await page.screenshot({ path: path.join(ICONS, job.to), omitBackground: true });
  await page.close();
  const { size } = await fs.stat(path.join(ICONS, job.to));
  console.log(`  ${job.to.padEnd(26)} ${job.size}px  ${(size / 1024).toFixed(1)}KB`);
}

await browser.close();
console.log('\nPNG 아이콘 생성 완료.');
