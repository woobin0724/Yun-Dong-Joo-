import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';
import { NODES } from '../src/content/journey.js';
import { POEMS } from '../src/content/poems.js';
import { buildLesson, buildRepeat, countIn } from '../src/services/lessons.js';
import { makeRng } from '../src/lib/rng.js';
import { getDb } from '../src/db.js';
import { EXAM_SIZE, EXAM_POINTS } from '../src/services/exam.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

let n = 0;
const fresh = () => signUp(server, { handle: `exam${++n}` });

/** 마디 하나를 걷는다. wrongAt 의 걸음은 일부러 틀린다. */
async function walk(call, userId, nodeId, { wrongAt = [] } = {}) {
  await call(`/api/journey/nodes/${nodeId}`);
  const lesson = buildLesson(userId, nodeId);
  for (let i = 0; i < lesson.steps.length; i++) {
    const s = lesson.steps[i];
    const wrong = wrongAt.includes(i);
    let body;
    if (s.type === 'slow-read') body = { stanzasSeen: s.stanzas.length };
    else if (s.type === 'order') body = { lines: wrong ? s.lines : s.answer };
    else if (s.type === 'feeling') body = { choice: 0 };
    else if (s.type === 'response') body = { text: '마지막 행에서 오래 멈췄습니다. 말이 끊기는 자리입니다.' };
    else body = { choice: wrong ? (s.answer + 1) % s.options.length : s.answer };
    await call(`/api/journey/nodes/${nodeId}/steps/${i}`, { method: 'POST', body });
  }
  await call(`/api/journey/nodes/${nodeId}/finish`, { method: 'POST' });
  return lesson;
}

/** 서버에 얼려 둔 문항(답 포함)을 꺼낸다 — 테스트만 이렇게 한다. */
const frozen = (examId) =>
  JSON.parse(getDb().prepare('SELECT items FROM exam_sessions WHERE id = ?').get(examId).items);

test('걸어 본 시가 없으면 시험을 볼 수 없다', async () => {
  const { call } = await fresh();
  const summary = await call('/api/exam');
  assert.equal(summary.body.ready, false);
  const res = await call('/api/exam', { method: 'POST' });
  assert.equal(res.status, 409);
});

test('레슨에서 틀린 문제는 오답 노트로 간다', async () => {
  const { call, user } = await fresh();
  const lesson = buildLesson(user.id, NODES[0].id);
  const graded = lesson.steps.findIndex((s) => ['cloze', 'order', 'diction'].includes(s.type));
  await walk(call, user.id, NODES[0].id, { wrongAt: [graded] });
  const summary = await call('/api/exam');
  assert.equal(summary.body.openMistakes, 1);
  assert.equal(summary.body.ready, true);
});

test('시험은 걸어 본 시에서만, 오답 노트부터 낸다', async () => {
  const { call, user } = await fresh();
  const lesson = buildLesson(user.id, NODES[0].id);
  const graded = lesson.steps.findIndex((s) => ['cloze', 'order', 'diction'].includes(s.type));
  await walk(call, user.id, NODES[0].id, { wrongAt: [graded] });

  const exam = await call('/api/exam', { method: 'POST' });
  assert.equal(exam.status, 201);
  assert.ok(exam.body.items.length > 0 && exam.body.items.length <= EXAM_SIZE);
  assert.equal(exam.body.fromMistakes, 1);
  for (const item of exam.body.items) {
    assert.equal(item.poemId, NODES[0].poemId, '걷지 않은 시가 시험에 나왔습니다');
  }
});

test('시험 문항에도 답이 실려 나가지 않는다', async () => {
  const { call, user } = await fresh();
  await walk(call, user.id, NODES[0].id);
  const exam = await call('/api/exam', { method: 'POST' });
  const dump = JSON.stringify(exam.body);
  assert.ok(!dump.includes('"answer"'));
  assert.ok(!dump.includes('"counts"'), '되풀이 문항의 횟수표가 나가면 답이 보입니다');
});

test('오답 문제를 맞히면 노트에서 지워진다', async () => {
  const { call, user } = await fresh();
  const lesson = buildLesson(user.id, NODES[0].id);
  const graded = lesson.steps.findIndex((s) => ['cloze', 'order', 'diction'].includes(s.type));
  await walk(call, user.id, NODES[0].id, { wrongAt: [graded] });

  const exam = await call('/api/exam', { method: 'POST' });
  const items = frozen(exam.body.examId);
  const idx = items.findIndex((it) => it.mistakeId);
  const step = items[idx].step;
  const body = step.type === 'order' ? { lines: step.answer } : { choice: step.answer };

  const res = await call(`/api/exam/${exam.body.examId}/items/${idx}`, { method: 'POST', body });
  assert.equal(res.body.correct, true);
  assert.equal(res.body.resolvedMistake, true);
  assert.equal((await call('/api/exam')).body.openMistakes, 0);
});

test('시험에서 새로 틀린 것은 노트에 남고, 한 문항은 한 번만 채점한다', async () => {
  const { call, user } = await fresh();
  await walk(call, user.id, NODES[0].id);
  const exam = await call('/api/exam', { method: 'POST' });
  const items = frozen(exam.body.examId);
  const idx = items.findIndex((it) => it.step.type !== 'order');
  const step = items[idx].step;
  const wrong = { choice: (step.answer + 1) % step.options.length };

  const first = await call(`/api/exam/${exam.body.examId}/items/${idx}`, { method: 'POST', body: wrong });
  assert.equal(first.body.correct, false);
  assert.equal((await call('/api/exam')).body.openMistakes, 1);

  // 답을 본 뒤 다시 내서 맞히는 길은 막혀 있어야 한다.
  const retry = await call(`/api/exam/${exam.body.examId}/items/${idx}`, {
    method: 'POST',
    body: { choice: step.answer },
  });
  assert.equal(retry.body.already, true);
  assert.equal(retry.body.correct, false);
  assert.equal(retry.body.points, 0);
});

test('맞힌 시험 문항은 점수가 한 번 붙는다', async () => {
  const { call, user } = await fresh();
  await walk(call, user.id, NODES[0].id);
  const before = (await call('/api/me')).body.stats.totalPoints;
  const exam = await call('/api/exam', { method: 'POST' });
  const items = frozen(exam.body.examId);
  const step = items[0].step;
  const body = step.type === 'order' ? { lines: step.answer } : { choice: step.answer };
  const res = await call(`/api/exam/${exam.body.examId}/items/0`, { method: 'POST', body });
  assert.equal(res.body.points, EXAM_POINTS);
  assert.equal((await call('/api/me')).body.stats.totalPoints, before + EXAM_POINTS);
});

test('남의 시험은 풀 수 없다', async () => {
  const a = await fresh();
  const b = await fresh();
  await walk(a.call, a.user.id, NODES[0].id);
  const exam = await a.call('/api/exam', { method: 'POST' });
  const res = await b.call(`/api/exam/${exam.body.examId}/items/0`, { method: 'POST', body: { choice: 0 } });
  assert.equal(res.status, 404);
});

// ── 되풀이 문항: 정답이 횟수라 틀리면 변명할 길이 없다 ──

test('낱말은 경계에서만 센다 — "내일" 안의 "내" 는 시내가 아니다', () => {
  const g = POEMS.find((p) => p.id === 'saeroun-gil');
  assert.equal(countIn(g, '내'), 2);
  const wind = POEMS.find((p) => p.id === 'barami-bureo');
  assert.equal(countIn(wind, '괴로움'), 2, '조사가 겹쳐도("괴로움에는") 세어야 합니다');
});

test('되풀이 문항의 정답은 정말로 가장 많이 나오는 말이다', () => {
  for (const poem of POEMS) {
    for (let seed = 0; seed < 5; seed++) {
      const q = buildRepeat(makeRng(`t${seed}`), poem);
      if (!q) continue;
      const answer = q.options[q.answer];
      for (const opt of q.options) {
        if (opt === answer) continue;
        assert.ok(
          countIn(poem, opt) < countIn(poem, answer),
          `「${poem.title}」: 정답 "${answer}"(${countIn(poem, answer)}) 보다 "${opt}"(${countIn(poem, opt)}) 가 많거나 같습니다`,
        );
      }
    }
  }
});

test('한 시험에 같은 문제가 두 번 나오지 않는다 — 보기 순서만 다른 것도', async () => {
  const { call, user } = await fresh();
  await walk(call, user.id, NODES[0].id);
  const { examKey } = await import('../src/services/exam.js');
  for (let round = 0; round < 6; round++) {
    const exam = await call('/api/exam', { method: 'POST' });
    const keys = frozen(exam.body.examId).map((it) => examKey(it.poemId, it.step));
    assert.equal(new Set(keys).size, keys.length, `중복 문항: ${keys.join(' / ')}`);
  }
});
