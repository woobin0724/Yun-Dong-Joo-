#!/usr/bin/env node
/**
 * 콘텐츠 신뢰도 점검.
 *
 *   npm run content:check
 *
 * 이 앱은 실존 시인을 다룹니다. 확인되지 않은 것을 사실처럼 보여 주지 않도록,
 * 무엇이 아직 확인 전인지 한눈에 드러내 둡니다.
 *
 * 검사 항목
 *   1. 달력에 없는 날짜 (예: 9월 31일)
 *   2. 정본 대조(verified) 가 안 된 작품
 *   3. 출처(source_url) 가 없는 사실 항목
 *
 * 이 스크립트는 실패하지 않습니다(종료 코드 0). 고칠 사람이 사람이기 때문입니다.
 * 대신 남은 일의 목록을 보여 줍니다.
 */
import { POEMS } from '../src/content/poems.js';
import { BACKGROUND_QUIZ } from '../src/content/quiz-bank.js';
import { CHAPTERS } from '../src/content/journey.js';

const bad = [];
const unverified = [];
const sourceless = [];

for (const poem of POEMS) {
  const [y, m, d] = String(poem.written).split('-').map(Number);
  if (d) {
    const probe = new Date(Date.UTC(y, m - 1, d));
    const real =
      probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
    if (!real) bad.push({ id: poem.id, title: poem.title, written: poem.written });
  }
  if (!poem.verified) unverified.push(poem.title);
  if (!poem.source_url) sourceless.push(poem.title);
}

const quizNoSource = BACKGROUND_QUIZ.filter((q) => !q.source_url);

console.log('\n콘텐츠 신뢰도 점검\n');

if (bad.length) {
  console.log('■ 달력에 없는 날짜 — 사람이 정본과 대조해야 합니다');
  for (const b of bad) {
    console.log(`   「${b.title}」  written: '${b.written}'  (src/content/poems.js)`);
  }
  console.log(
    '   앱 화면에서는 날짜를 떼고 연·월까지만 보여 주고 있습니다.\n' +
      '   오타인지 자필 원고의 기록인지는 원본을 봐야 알 수 있습니다.\n',
  );
}

console.log(`■ 정본 대조 안 된 작품: ${unverified.length} / ${POEMS.length}편`);
if (unverified.length) console.log(`   ${unverified.join(' · ')}\n`);

console.log(`■ 출처가 없는 작품: ${sourceless.length} / ${POEMS.length}편`);
console.log(`■ 출처가 없는 배경 문항: ${quizNoSource.length} / ${BACKGROUND_QUIZ.length}문항\n`);

const chapterFacts = CHAPTERS.filter((c) => c.verified !== true);
console.log(`■ 출처 대조 안 된 장의 사실: ${chapterFacts.length} / ${CHAPTERS.length}장`);
if (chapterFacts.length) {
  // 장 이름에 이미 가운뎃점이 든 것이 있어(도쿄 · 교토) 쉼표로 가릅니다.
  console.log(`   ${chapterFacts.map((c) => c.place).join(', ')}`);
  console.log(
    '   이 장들의 years 와 story 는 API 응답에서 빠집니다(services/journey.js).\n' +
      '   확인하려면 source_url 을 열어 본문에 그 진술이 실제로 있는지 보고,\n' +
      '   맞으면 verified 를 true 로, last_checked 를 그날 날짜로 바꾸세요.\n' +
      '   비슷한 말이 있다고 통과시키면 안 됩니다.\n',
  );
}

console.log('대조 절차는 README 의 「시 본문 정정」 항목을 보세요.');
console.log('정음사 『하늘과 바람과 별과 詩』(1955 증보판) / 왕신영 외 『사진판 윤동주 자필 시고전집』\n');
