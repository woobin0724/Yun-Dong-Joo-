import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';
import { CHAPTERS, NODES } from '../src/content/journey.js';
import { buildLesson, grade, toClient, STEP_POINTS, MIN_RESPONSE } from '../src/services/lessons.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

let n = 0;
const fresh = () => signUp(server, { handle: `walker${++n}`, displayName: '한결' });

/** 마디 하나를 끝까지 걷는다. 서버가 내준 걸음을 보고 맞는 답을 만들어 낸다. */
async function walkNode(call, userId, nodeId) {
  const opened = await call(`/api/journey/nodes/${nodeId}`);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  const lesson = buildLesson(userId, nodeId); // 서버와 같은 시드 → 같은 문제
  for (let i = 0; i < lesson.steps.length; i++) {
    const step = lesson.steps[i];
    let body;
    if (step.type === 'slow-read') body = { stanzasSeen: step.stanzas.length };
    else if (step.type === 'cloze' || step.type === 'diction') body = { choice: step.answer };
    else if (step.type === 'order') body = { lines: step.answer };
    else if (step.type === 'feeling') body = { choice: 0 };
    else body = { text: '이 시의 마지막 두 행이 오래 남았습니다. 거기서 말이 멎기 때문입니다.' };

    const res = await call(`/api/journey/nodes/${nodeId}/steps/${i}`, { method: 'POST', body });
    assert.equal(res.status, 200, `걸음 ${i}(${step.type}): ${JSON.stringify(res.body)}`);
  }
  return call(`/api/journey/nodes/${nodeId}/finish`, { method: 'POST' });
}

// ───────────────────────── §6 — 확인하지 않은 사실 ─────────────────────────

test('확인되지 않은 사실은 응답에 실리지 않는다', async () => {
  const { call } = await fresh();
  const res = await call('/api/journey');
  assert.equal(res.status, 200);

  for (const chapter of res.body.chapters) {
    if (chapter.factVerified) continue;
    assert.equal(chapter.years, null, `${chapter.id}: 확인 전인데 years 가 나갔습니다`);
    assert.equal(chapter.story, null, `${chapter.id}: 확인 전인데 story 가 나갔습니다`);
    assert.equal(chapter.source, null, `${chapter.id}: 확인 전인데 출처가 나갔습니다`);
  }

  // 확인 안 된 건수를 세어 화면에 띄울 수 있어야 한다.
  const unverified = CHAPTERS.filter((c) => c.verified !== true).length;
  assert.equal(res.body.unverifiedFacts, unverified);
});

test('장 안의 사실 본문이 응답 어디에도 섞여 있지 않다', async () => {
  // 나중에 누군가 story 를 채우고 verified 는 안 올렸을 때를 대비한 그물.
  // 응답 전체를 글자로 훑어서 확인 안 된 본문이 흘러나갔는지 본다.
  const { call } = await fresh();
  const res = await call('/api/journey');
  const dump = JSON.stringify(res.body);
  for (const c of CHAPTERS) {
    if (c.verified === true) continue;
    if (c.story) assert.ok(!dump.includes(c.story), `${c.id}: story 본문이 응답에 있습니다`);
    if (c.years) assert.ok(!dump.includes(c.years), `${c.id}: years 가 응답에 있습니다`);
  }
});

// ───────────────────────── 지도와 잠금 ─────────────────────────

test('지도는 장을 차례대로 주고, 시가 없는 장을 비었다고 말한다', async () => {
  const { call } = await fresh();
  const { body } = await call('/api/journey');

  assert.deepEqual(
    body.chapters.map((c) => c.id),
    CHAPTERS.map((c) => c.id),
  );
  assert.equal(body.total, NODES.length);

  const empties = body.chapters.filter((c) => c.empty);
  assert.ok(empties.length > 0, '읽을 시가 없는 장이 있어야 합니다');
  for (const c of empties) assert.equal(c.nodes.length, 0);
});

test('첫 마디만 열려 있고 나머지는 잠겨 있다', async () => {
  const { call } = await fresh();
  const { body } = await call('/api/journey');
  const all = body.chapters.flatMap((c) => c.nodes);

  assert.equal(all[0].state, 'open');
  assert.equal(body.next, all[0].id);
  for (const node of all.slice(1)) assert.equal(node.state, 'locked');
});

test('잠긴 마디는 열리지 않는다', async () => {
  const { call } = await fresh();
  const locked = NODES[3].id;
  const res = await call(`/api/journey/nodes/${locked}`);
  assert.equal(res.status, 403);
});

test('없는 마디는 404', async () => {
  const { call } = await fresh();
  assert.equal((await call('/api/journey/nodes/없는-마디')).status, 404);
});

// ───────────────────────── 걷기 ─────────────────────────

test('마디를 끝까지 걸으면 다음 마디가 열린다', async () => {
  const { call, user } = await fresh();
  const first = NODES[0].id;
  const second = NODES[1].id;

  assert.equal((await call(`/api/journey/nodes/${second}`)).status, 403);

  const done = await walkNode(call, user.id, first);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.next, second);
  assert.equal(done.body.doneCount, 1);

  assert.equal((await call(`/api/journey/nodes/${second}`)).status, 200);

  const map = await call('/api/journey');
  const all = map.body.chapters.flatMap((c) => c.nodes);
  assert.equal(all[0].state, 'done');
  assert.equal(all[1].state, 'open');
});

test('걸음을 건너뛰면 거절한다', async () => {
  const { call, user } = await fresh();
  const node = NODES[0].id;
  await call(`/api/journey/nodes/${node}`);
  const lesson = buildLesson(user.id, node);

  const skipped = await call(`/api/journey/nodes/${node}/steps/${lesson.steps.length - 1}`, {
    method: 'POST',
    body: { text: '건너뛰어 봅니다. 이 글은 충분히 깁니다.' },
  });
  assert.equal(skipped.status, 409);
});

test('걸음을 다 내지 않으면 마디가 끝나지 않는다', async () => {
  const { call } = await fresh();
  const node = NODES[0].id;
  await call(`/api/journey/nodes/${node}`);
  const res = await call(`/api/journey/nodes/${node}/finish`, { method: 'POST' });
  assert.equal(res.status, 409);
});

test('같은 걸음을 두 번 내도 점수는 한 번만 붙는다', async () => {
  const { call, user } = await fresh();
  const node = NODES[0].id;
  await call(`/api/journey/nodes/${node}`);
  const step = buildLesson(user.id, node).steps[0];

  const first = await call(`/api/journey/nodes/${node}/steps/0`, {
    method: 'POST',
    body: { stanzasSeen: step.stanzas.length },
  });
  const again = await call(`/api/journey/nodes/${node}/steps/0`, {
    method: 'POST',
    body: { stanzasSeen: step.stanzas.length },
  });

  assert.equal(first.body.points, STEP_POINTS['slow-read']);
  assert.equal(again.body.points, 0, '두 번째에는 점수가 붙지 않아야 합니다');
  assert.equal(again.body.score, first.body.score);
});

test('마디를 두 번 끝내도 완주 보너스는 한 번만 붙는다', async () => {
  const { call, user } = await fresh();
  const node = NODES[0].id;
  await walkNode(call, user.id, node);
  const before = (await call('/api/me')).body.stats.totalPoints;
  await call(`/api/journey/nodes/${node}/finish`, { method: 'POST' });
  const after = (await call('/api/me')).body.stats.totalPoints;
  assert.equal(after, before);
});

// ───────────────────────── 레슨 엔진 ─────────────────────────

test('답은 브라우저로 나가지 않는다', async () => {
  const { call, user } = await fresh();
  const node = NODES[0].id;
  const res = await call(`/api/journey/nodes/${node}`);
  const dump = JSON.stringify(res.body.lesson);
  assert.ok(!dump.includes('"answer"'), '걸음에 answer 가 실려 있습니다');

  // 서버가 들고 있는 답이 응답 어디에도 없는지 본다 (행 순서의 정답 배열).
  for (const step of buildLesson(user.id, node).steps) {
    if (step.type !== 'order') continue;
    assert.ok(
      !dump.includes(JSON.stringify(step.answer)),
      '행 순서의 정답 배열이 그대로 나갔습니다',
    );
  }
});

test('사람이 다르면 문제도 다르다', async () => {
  const node = NODES[0].id;
  const a = JSON.stringify(toClient(buildLesson(1, node)));
  const b = JSON.stringify(toClient(buildLesson(2, node)));
  assert.notEqual(a, b, '모든 사용자에게 같은 문제가 나왔습니다');
});

test('같은 사람에게는 늘 같은 문제가 나온다', () => {
  const node = NODES[0].id;
  assert.equal(
    JSON.stringify(toClient(buildLesson(7, node))),
    JSON.stringify(toClient(buildLesson(7, node))),
    '새로고침하면 문제가 바뀝니다',
  );
});

test('모든 마디가 걸음을 제대로 만들어 낸다', () => {
  for (const node of NODES) {
    for (const userId of [1, 2, 3]) {
      const lesson = buildLesson(userId, node.id);
      assert.ok(lesson, `${node.id}: 레슨을 만들지 못했습니다`);
      assert.ok(lesson.steps.length >= 3, `${node.id}: 걸음이 너무 적습니다`);
      assert.equal(lesson.steps[0].type, 'slow-read');
      assert.equal(lesson.steps.at(-1).type, 'response');
      for (const step of lesson.steps) {
        assert.ok(STEP_POINTS[step.type], `${node.id}: 모르는 걸음 ${step.type}`);
        if (step.type === 'cloze' || step.type === 'diction') {
          assert.equal(step.options.length, 4);
          assert.ok(step.answer >= 0 && step.answer < 4);
        }
        if (step.type === 'order') {
          assert.notDeepEqual(step.lines, step.answer, `${node.id}: 섞이지 않은 행 순서 문제`);
          assert.deepEqual([...step.lines].sort(), [...step.answer].sort());
        }
      }
    }
  }
});

test('빈칸 문제의 오답 보기는 시 본문에 없는 말이다', () => {
  for (const node of NODES) {
    for (const userId of [1, 2, 3, 4, 5]) {
      const lesson = buildLesson(userId, node.id);
      const step = lesson.steps.find((s) => s.type === 'cloze');
      if (!step) continue;
      // 정답 말고 다른 보기가 빈칸에 들어가도 말이 되면 문제가 성립하지 않는다.
      const wrong = step.options.filter((_, i) => i !== step.answer);
      for (const w of wrong) {
        assert.ok(!step.line.includes(w), `${node.id}: 오답 "${w}" 가 같은 행에 이미 있습니다`);
      }
    }
  }
});

test("'화자의 마음' 은 채점하지 않고 분포를 돌려준다", async () => {
  const { call, user } = await fresh();
  const node = NODES[0].id;
  await call(`/api/journey/nodes/${node}`);
  const lesson = buildLesson(user.id, node);
  const idx = lesson.steps.findIndex((s) => s.type === 'feeling');
  assert.ok(idx > 0, '화자의 마음 걸음이 있어야 합니다');

  for (let i = 0; i < idx; i++) {
    const step = lesson.steps[i];
    const body =
      step.type === 'slow-read'
        ? { stanzasSeen: step.stanzas.length }
        : step.type === 'order'
          ? { lines: step.answer }
          : { choice: step.answer };
    await call(`/api/journey/nodes/${node}/steps/${i}`, { method: 'POST', body });
  }

  const res = await call(`/api/journey/nodes/${node}/steps/${idx}`, {
    method: 'POST',
    body: { choice: 1 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.correct, null, '맞고 틀림을 매기면 안 됩니다');
  assert.equal(res.body.points, STEP_POINTS.feeling, '어느 쪽을 골라도 점수는 같습니다');
  // 분포는 이 마디를 걸은 모든 사람의 집계다. 이 파일 앞쪽 테스트들이 이미
  // 같은 마디에 투표해 두었으므로 1 이 아니라 '내 표를 포함한 수' 를 본다.
  const dist = res.body.distribution;
  assert.ok(dist);
  assert.ok(dist.total >= 1, '내 표가 세어져야 합니다');
  assert.equal(
    dist.items.reduce((sum, i) => sum + i.count, 0),
    dist.total,
    '보기별 합이 전체와 맞아야 합니다',
  );
  assert.ok(
    dist.items.some((i) => i.label === lesson.steps[idx].options[1] && i.count >= 1),
    '내가 고른 보기가 세어져 있어야 합니다',
  );
  for (const item of dist.items) {
    assert.ok(item.percent >= 0 && item.percent <= 100);
  }

  // 한 사람이 두 번 골라도 표는 하나다 (고쳐 고를 수는 있다).
  const again = await call(`/api/journey/nodes/${node}/steps/${idx}`, {
    method: 'POST',
    body: { choice: 2 },
  });
  assert.equal(again.body.distribution.total, dist.total, '같은 사람이 표를 둘 가지면 안 됩니다');
});

test('틀린 답에도 정답을 알려 준다', () => {
  const step = {
    type: 'cloze',
    points: 15,
    options: ['별', '바람', '하늘', '구름'],
    answer: 0,
    line: '____ 하나에 추억과',
  };
  const wrong = grade(step, { choice: 2 });
  assert.equal(wrong.correct, false);
  assert.equal(wrong.points, 0);
  assert.equal(wrong.reveal.word, '별');
  assert.match(wrong.message, /별/);
});

test('빈 제출은 0번 보기를 고른 것으로 치지 않는다', () => {
  const step = { type: 'cloze', points: 15, options: ['별', '바람', '하늘', '구름'], answer: 0, line: 'x' };
  for (const submission of [{}, { choice: null }, { choice: '' }, { choice: undefined }]) {
    const res = grade(step, submission);
    assert.equal(res.ok, false, `${JSON.stringify(submission)} 가 통과했습니다`);
    assert.equal(res.correct, null);
  }
});

test('한 줄 감상은 너무 짧으면 받지 않는다', async () => {
  const { call, user } = await fresh();
  const node = NODES[0].id;
  await call(`/api/journey/nodes/${node}`);
  const lesson = buildLesson(user.id, node);
  const last = lesson.steps.length - 1;

  for (let i = 0; i < last; i++) {
    const step = lesson.steps[i];
    const body =
      step.type === 'slow-read'
        ? { stanzasSeen: step.stanzas.length }
        : step.type === 'order'
          ? { lines: step.answer }
          : { choice: step.answer ?? 0 };
    await call(`/api/journey/nodes/${node}/steps/${i}`, { method: 'POST', body });
  }

  const tooShort = await call(`/api/journey/nodes/${node}/steps/${last}`, {
    method: 'POST',
    body: { text: '좋다' },
  });
  assert.equal(tooShort.status, 400);
  assert.match(tooShort.body.error, new RegExp(String(MIN_RESPONSE)));
});

test('천천히 읽기는 연을 다 넘겨야 통과한다', () => {
  const step = { type: 'slow-read', points: 10, stanzas: [['가'], ['나'], ['다']] };
  assert.equal(grade(step, { stanzasSeen: 2 }).ok, false);
  assert.equal(grade(step, { stanzasSeen: 3 }).ok, true);
});

// ───────────────────────── 남은 것 ─────────────────────────

test('한 줄 감상은 남아서 다시 찾을 수 있다', async () => {
  const { call, user } = await fresh();
  const node = NODES[0].id;
  await walkNode(call, user.id, node);

  const res = await call('/api/journey/responses');
  assert.equal(res.status, 200);
  assert.equal(res.body.responses.length, 1);
  assert.equal(res.body.responses[0].nodeId, node);
  assert.ok(res.body.responses[0].title, '어느 시에 쓴 글인지 알 수 있어야 합니다');
});

test('로그인하지 않으면 길에 들어갈 수 없다', async () => {
  const anon = server.client();
  assert.equal((await anon('/api/journey')).status, 401);
  assert.equal((await anon(`/api/journey/nodes/${NODES[0].id}`)).status, 401);
});

test("'화자의 마음' 보기는 모두에게 같다", () => {
  // 보기가 사람마다 다르면 분포가 거짓말이 된다. 내가 못 본 보기에 들어간
  // 표까지 분모에 끼어 비율 합이 100%가 되지 않는다. 실제로 그렇게 만들었다가
  // 테스트에 걸렸고, 그래서 이 걸음만 시드를 마디로 바꿨다.
  for (const node of NODES) {
    const sets = [1, 2, 3, 9, 42].map((uid) => {
      const step = buildLesson(uid, node.id).steps.find((s) => s.type === 'feeling');
      return step ? JSON.stringify(step.options) : null;
    });
    const present = sets.filter(Boolean);
    if (!present.length) continue;
    assert.equal(
      new Set(present).size,
      1,
      `${node.id}: 사람마다 다른 보기가 나왔습니다 — ${present.join(' / ')}`,
    );
  }
});

test('분포의 비율 합은 늘 100%에 수렴한다', async () => {
  const node = NODES[0].id;
  const voters = [];
  for (let i = 0; i < 4; i++) voters.push(await fresh());

  let dist = null;
  for (const { call, user } of voters) {
    await call(`/api/journey/nodes/${node}`);
    const lesson = buildLesson(user.id, node);
    const idx = lesson.steps.findIndex((s) => s.type === 'feeling');
    if (idx < 0) return;
    for (let i = 0; i < idx; i++) {
      const step = lesson.steps[i];
      const body =
        step.type === 'slow-read'
          ? { stanzasSeen: step.stanzas.length }
          : step.type === 'order'
            ? { lines: step.answer }
            : { choice: step.answer };
      await call(`/api/journey/nodes/${node}/steps/${i}`, { method: 'POST', body });
    }
    const res = await call(`/api/journey/nodes/${node}/steps/${idx}`, {
      method: 'POST',
      body: { choice: voters.indexOf(voters.find((v) => v.user.id === user.id)) % 4 },
    });
    dist = res.body.distribution;
  }

  assert.equal(dist.orphaned, 0, '보기 밖으로 새어 나간 표가 있습니다');
  assert.equal(
    dist.items.reduce((s, i) => s + i.count, 0),
    dist.total,
  );
  const sum = dist.items.reduce((s, i) => s + i.percent, 0);
  assert.ok(Math.abs(sum - 100) <= 2, `비율 합이 ${sum}% 입니다`);
});
