import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';

let server;

before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

test('상태 확인', async () => {
  const res = await server.client()('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('가입 · 로그인 · 로그아웃', async () => {
  const { call, user } = await signUp(server, { handle: '동주', displayName: '윤동주' });
  assert.equal(user.handle, '동주');
  assert.equal(user.displayName, '윤동주');

  const me = await call('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, user.id);

  await call('/api/auth/logout', { method: 'POST' });
  assert.equal((await call('/api/auth/me')).status, 401);

  const again = await call('/api/auth/login', {
    method: 'POST',
    body: { handle: '동주', pin: '1234' },
  });
  assert.equal(again.status, 200);
});

test('같은 아이디로는 두 번 가입할 수 없다', async () => {
  await signUp(server, { handle: 'mongyu' });
  const res = await server.client()('/api/auth/signup', {
    method: 'POST',
    body: { handle: 'MONGYU', displayName: '송몽규', pin: '9999' },
  });
  assert.equal(res.status, 409);
});

test('잘못된 입력은 거절된다', async () => {
  const call = server.client();
  const short = await call('/api/auth/signup', {
    method: 'POST',
    body: { handle: 'a', displayName: '가', pin: '1234' },
  });
  assert.equal(short.status, 400);

  const badPin = await call('/api/auth/signup', {
    method: 'POST',
    body: { handle: 'goodhandle', displayName: '가', pin: 'abcd' },
  });
  assert.equal(badPin.status, 400);
  assert.equal(badPin.body.error.code, 'invalid_pin');
});

test('틀린 PIN 으로는 로그인되지 않는다', async () => {
  await signUp(server, { handle: 'byeongwook', pin: '4321' });
  const res = await server.client()('/api/auth/login', {
    method: 'POST',
    body: { handle: 'byeongwook', pin: '0000' },
  });
  assert.equal(res.status, 401);
});

test('로그인 없이 미션에 접근할 수 없다', async () => {
  assert.equal((await server.client()('/api/missions/today')).status, 401);
});

test('오늘의 시와 미션을 받아 온다', async () => {
  const { call } = await signUp(server, { handle: 'reader1' });
  const res = await call('/api/missions/today');

  assert.equal(res.status, 200);
  assert.ok(res.body.poem.title);
  assert.equal(res.body.missions.length, 3);
  assert.equal(res.body.remaining, 3);

  for (const mission of res.body.missions) {
    assert.equal(mission.completed, false);
    // 정답이 클라이언트로 새어 나가면 안 된다
    assert.equal(mission.data.answer, undefined);
    assert.equal(mission.data.explain, undefined);
  }
});

test('낭독 미션을 완료하면 점수가 오른다', async () => {
  const { call } = await signUp(server, { handle: 'reader2' });
  const today = await call('/api/missions/today');
  const check = today.body.missions.find((m) => m.kind === 'check');

  const res = await call(`/api/missions/${check.id}/submit`, { method: 'POST', body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.earnedPoints, check.points);
  assert.ok(res.body.missions.find((m) => m.id === check.id).completed);

  // 첫걸음 도전과제
  assert.ok(res.body.earnedChallenges.some((c) => c.id === 'first-step'));

  // 두 번 제출해도 점수가 두 번 들어가지 않는다
  const again = await call(`/api/missions/${check.id}/submit`, { method: 'POST', body: {} });
  assert.equal(again.body.alreadyDone, true);
  assert.equal(again.body.earnedPoints, 0);

  const me = await call('/api/me');
  assert.equal(me.body.stats.totalPoints, check.points + 20); // 미션 + 첫걸음 보상
});

test('글쓰기 미션은 최소 글자 수를 지켜야 한다', async () => {
  const { call } = await signUp(server, { handle: 'writer1' });
  const today = await call('/api/missions/today');
  const textMission = today.body.missions.find((m) => m.kind === 'text');
  const min = textMission.data.minLength;

  const tooShort = await call(`/api/missions/${textMission.id}/submit`, {
    method: 'POST',
    body: { text: '짧다' },
  });
  assert.equal(tooShort.status, 400);
  assert.equal(tooShort.body.error.code, 'submission_too_short');

  const ok = await call(`/api/missions/${textMission.id}/submit`, {
    method: 'POST',
    body: { text: '별'.repeat(min + 5) },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.earnedPoints, textMission.points);
});

test('퀴즈는 틀리면 점수가 없고 다시 풀 수 있다', async () => {
  const { call } = await signUp(server, { handle: 'quizzer' });
  const today = await call('/api/missions/today');
  const quiz = today.body.missions.find((m) => m.kind === 'quiz');

  // 네 개를 차례로 넣어 보며 정답을 찾는다 (정답은 응답으로만 알 수 있다)
  let correctIndex = null;
  for (let i = 0; i < quiz.data.options.length; i++) {
    const res = await call(`/api/missions/${quiz.id}/submit`, {
      method: 'POST',
      body: { answer: i },
    });
    assert.equal(res.status, 200);
    if (res.body.correct) {
      correctIndex = i;
      assert.equal(res.body.earnedPoints, quiz.points);
      break;
    }
    assert.equal(res.body.earnedPoints, 0);
  }
  assert.notEqual(correctIndex, null, '정답이 하나는 있어야 한다');

  // 푼 뒤에는 정답과 해설이 열린다
  const after = await call('/api/missions/today');
  const solved = after.body.missions.find((m) => m.id === quiz.id);
  assert.equal(solved.completed, true);
  assert.equal(solved.reveal.answer, correctIndex);

  const bad = await call(`/api/missions/${quiz.id}/submit`, {
    method: 'POST',
    body: { answer: 99 },
  });
  assert.equal(bad.body.alreadyDone, true);
});

test('보기를 고르지 않으면 퀴즈를 제출할 수 없다', async () => {
  const { call } = await signUp(server, { handle: 'quizzer2' });
  const today = await call('/api/missions/today');
  const quiz = today.body.missions.find((m) => m.kind === 'quiz');
  const res = await call(`/api/missions/${quiz.id}/submit`, { method: 'POST', body: {} });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_choice');
});

test('없는 미션은 404', async () => {
  const { call } = await signUp(server, { handle: 'nobody' });
  const res = await call('/api/missions/999999/submit', { method: 'POST', body: {} });
  assert.equal(res.status, 404);
});

test('시를 읽으면 기록되고 읽기 도전과제가 열린다', async () => {
  const { call } = await signUp(server, { handle: 'librarian' });
  const list = await call('/api/poems');
  assert.ok(list.body.poems.length >= 15);
  assert.equal(list.body.readCount, 0);

  let earned = [];
  for (const poem of list.body.poems.slice(0, 5)) {
    const res = await call(`/api/poems/${poem.id}/read`, { method: 'POST' });
    earned = earned.concat(res.body.earnedChallenges);
  }
  assert.ok(earned.some((c) => c.id === 'reader-5'), '다섯 편을 읽으면 과제가 열려야 한다');

  const after = await call('/api/poems');
  assert.equal(after.body.readCount, 5);

  assert.equal((await call('/api/poems/없는시/read', { method: 'POST' })).status, 404);
});
