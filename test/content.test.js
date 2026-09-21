import { test } from 'node:test';
import assert from 'node:assert/strict';

import { POEMS, POEM_BY_ID, poemLines, poemPreview } from '../src/content/poems.js';
import { buildDailyMissions, poemOfTheDay } from '../src/content/missions.js';
import { CHALLENGES } from '../src/content/challenges.js';
import { BACKGROUND_QUIZ } from '../src/content/quiz-bank.js';
import { eulReul, eunNeun, iGa, gwaWa, euroRo } from '../src/lib/korean.js';
import { addDays, daysBetween, weekStart, dayKey } from '../src/lib/date.js';
import { computeStreaks } from '../src/services/stats.js';

test('시 데이터가 온전하다', () => {
  assert.ok(POEMS.length >= 15, '작품이 충분히 실려 있어야 한다');
  const ids = new Set();
  for (const poem of POEMS) {
    assert.ok(!ids.has(poem.id), `id 가 겹친다: ${poem.id}`);
    ids.add(poem.id);
    assert.ok(poem.title, 'title 필요');
    assert.match(poem.written, /^\d{4}(-\d{2}){0,2}$/, `written 형식: ${poem.id}`);
    assert.ok(['verse', 'prose'].includes(poem.form));
    assert.ok(poem.stanzas.length > 0 && poem.stanzas.every((s) => s.length > 0));
    assert.ok(poem.keywords.length >= 3, `${poem.id} 는 시어가 3개 이상이어야 한다`);
    assert.ok(poem.note.length > 20);
    assert.ok(poemLines(poem).every((line) => line.trim().length > 0));
    assert.ok(poemPreview(poem).length > 0);
  }
});

test('퀴즈 은행의 정답 인덱스가 범위 안에 있다', () => {
  for (const q of BACKGROUND_QUIZ) {
    assert.ok(q.answer >= 0 && q.answer < q.options.length, q.id);
    assert.equal(new Set(q.options).size, q.options.length, `${q.id}: 보기 중복`);
    assert.ok(q.explain.length > 10, `${q.id}: 해설 필요`);
  }
});

test('조사가 받침에 맞게 선택된다', () => {
  assert.equal(eulReul('십자가'), '를');
  assert.equal(eulReul('무서운 시간'), '을');
  assert.equal(eunNeun('서시'), '는');
  assert.equal(eunNeun('별 헤는 밤'), '은');
  assert.equal(iGa('길'), '이');
  assert.equal(gwaWa('자화상'), '과');
  assert.equal(gwaWa('병원'), '과');
  assert.equal(gwaWa('소년'), '과');
  assert.equal(gwaWa('봄바다'), '와');
  // 뒤에 붙은 문장부호는 무시한다
  assert.equal(eulReul('하늘,'), '을');
  assert.equal(euroRo('바람'), '으로');
  assert.equal(euroRo('하늘'), '로');
  assert.equal(euroRo('길'), '로'); // ㄹ 받침은 '로'
});

test('날짜 계산', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // 윤년
  assert.equal(daysBetween('2026-09-16', '2026-09-10'), 6);
  assert.equal(weekStart('2026-09-16'), '2026-09-14'); // 수요일 → 그 주 월요일
  assert.equal(weekStart('2026-09-14'), '2026-09-14');
  assert.match(dayKey(), /^\d{4}-\d{2}-\d{2}$/);
});

test('오늘의 시는 날짜만으로 정해지고 연달아 같은 시가 나오지 않는다', () => {
  assert.equal(poemOfTheDay('2026-09-16').id, poemOfTheDay('2026-09-16').id);

  let day = '2026-01-01';
  let previous = null;
  for (let i = 0; i < 400; i++) {
    const poem = poemOfTheDay(day);
    assert.notEqual(poem.id, previous, `${day} 에 같은 시가 이틀 연속 나왔다`);
    previous = poem.id;
    day = addDays(day, 1);
  }
});

test('하루 미션은 세 갈래가 고루 섞이고 언제 만들어도 같다', () => {
  for (const day of ['2026-01-01', '2026-05-05', '2026-12-31']) {
    const poem = poemOfTheDay(day);
    const missions = buildDailyMissions(day, poem, 3);

    assert.equal(missions.length, 3);
    assert.deepEqual(
      [...new Set(missions.map((m) => m.kind))].sort(),
      ['check', 'quiz', 'text'],
      `${day}: 갈래가 고루 섞여야 한다`,
    );
    assert.equal(new Set(missions.map((m) => m.key)).size, 3, '같은 템플릿이 겹치면 안 된다');
    assert.deepEqual(missions, buildDailyMissions(day, poem, 3), '두 번 만들어도 같아야 한다');

    for (const mission of missions) {
      assert.ok(mission.points > 0);
      assert.ok(mission.prompt.length > 10);
      assert.equal(mission.poemId, poem.id);
      if (mission.kind === 'quiz') {
        assert.equal(mission.data.options.length, 4);
        assert.ok(mission.data.answer >= 0 && mission.data.answer < 4);
        assert.equal(new Set(mission.data.options).size, 4, '보기가 겹치면 안 된다');
      }
      if (mission.kind === 'text') assert.ok(mission.data.minLength > 0);
      // 조사가 잘못 붙어 '을(를)' 같은 표기가 남지 않아야 한다
      assert.doesNotMatch(mission.prompt, /[을은이과][(（][를는가와]/);
    }
  }
});

test('모든 시에 대해 미션이 만들어진다', () => {
  for (const poem of POEMS) {
    const missions = buildDailyMissions('2026-06-15', poem, 3);
    assert.equal(missions.length, 3, `${poem.id} 에서 미션이 모자란다`);
  }
});

test('도전과제 정의가 온전하다', () => {
  const ids = new Set();
  for (const c of CHALLENGES) {
    assert.ok(!ids.has(c.id), `중복 id: ${c.id}`);
    ids.add(c.id);
    assert.ok(c.reward > 0);
    assert.ok(c.title && c.description && c.icon && c.group);
    assert.equal(typeof c.check, 'function');
  }
});

test('연속 달성일 계산', () => {
  assert.deepEqual(computeStreaks([], '2026-09-16'), { streak: 0, bestStreak: 0 });
  assert.deepEqual(
    computeStreaks(['2026-09-14', '2026-09-15', '2026-09-16'], '2026-09-16'),
    { streak: 3, bestStreak: 3 },
  );
  // 어제까지 이어졌다면 오늘 아직 안 했어도 연속은 살아 있다
  assert.deepEqual(computeStreaks(['2026-09-14', '2026-09-15'], '2026-09-16'), {
    streak: 2,
    bestStreak: 2,
  });
  // 이틀 넘게 비면 끊긴다
  assert.deepEqual(computeStreaks(['2026-09-10', '2026-09-11'], '2026-09-16'), {
    streak: 0,
    bestStreak: 2,
  });
  // 최고 기록은 남는다
  assert.deepEqual(
    computeStreaks(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10'], '2026-09-16'),
    { streak: 0, bestStreak: 3 },
  );
});

test('poemPreview 는 너무 길어지지 않는다', () => {
  for (const poem of POEMS) assert.ok(poemPreview(poem).length <= 80);
});

test('POEM_BY_ID 로 모든 시를 찾을 수 있다', () => {
  for (const poem of POEMS) assert.equal(POEM_BY_ID.get(poem.id), poem);
});

test('도전과제 아이콘이 모두 스프라이트에 정의되어 있다', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const defined = new Set([...html.matchAll(/<symbol id="i-([^"]+)"/g)].map((m) => m[1]));

  for (const c of CHALLENGES) {
    assert.ok(defined.has(c.icon), `${c.id}: 스프라이트에 '${c.icon}' 아이콘이 없습니다`);
  }
});

test('사용자에게 나가는 문구에 이모지를 쓰지 않는다', async () => {
  // 이모지는 기기마다 모양이 달라 통일감을 깨고, 푸시 알림 제목에까지 섞여 들어갑니다.
  const fs = await import('node:fs');
  const pictographic = /\p{Extended_Pictographic}/u;
  for (const file of ['content/challenges.js', 'content/messages.js', 'services/activity.js']) {
    const source = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const found = source.split('\n').find((line) => pictographic.test(line));
    assert.equal(found, undefined, `src/${file} 에 이모지가 남아 있습니다: ${found}`);
  }
});
