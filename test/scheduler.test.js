import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';

import { publishDailyMissions, postWeeklyWrap, tick } from '../src/services/scheduler.js';
import { ensureDailyMissions, todaysPoem } from '../src/services/missions.js';
import { listMessages } from '../src/services/chat.js';
import { inQuietHours, getPrefs, updatePrefs, isPushConfigured } from '../src/services/push.js';
import { award, leaderboard, rankOf, dailySeries } from '../src/services/points.js';
import { dayKey, addDays } from '../src/lib/date.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

test('하루 미션은 여러 번 만들어도 늘어나지 않는다', () => {
  const day = '2026-04-02';
  const first = ensureDailyMissions(day);
  const second = ensureDailyMissions(day);
  assert.equal(first.length, 3);
  assert.deepEqual(
    first.map((m) => m.id),
    second.map((m) => m.id),
  );
  assert.equal(todaysPoem(day).id, first[0].poemId);
});

test('미션 발행은 방마다 한 번만 알린다', async () => {
  const owner = await signUp(server, { handle: 'sched-owner' });
  const created = await owner.call('/api/rooms', { method: 'POST', body: { name: '알림 시험방' } });
  const roomId = created.body.room.id;
  const day = dayKey();

  await publishDailyMissions(day);
  await publishDailyMissions(day); // 두 번 불러도 한 번만 올라와야 한다

  const poemNotices = listMessages({ roomId, limit: 100 }).filter((m) => m.kind === 'poem');
  assert.equal(poemNotices.length, 1);
  assert.equal(poemNotices[0].meta.day, day);
  assert.ok(poemNotices[0].body.includes(todaysPoem(day).title));
});

test('주간 마감 안내도 한 번만 올라온다', async () => {
  const owner = await signUp(server, { handle: 'wrap-owner', displayName: '기록자' });
  const created = await owner.call('/api/rooms', { method: 'POST', body: { name: '마감 시험방' } });
  const roomId = created.body.room.id;

  const today = dayKey();
  award({ userId: owner.user.id, roomId, amount: 120, reason: 'test', day: addDays(today, -1) });

  await postWeeklyWrap(today);
  await postWeeklyWrap(today);

  const wraps = listMessages({ roomId, limit: 100 }).filter((m) => m.meta?.weeklyWrap);
  assert.equal(wraps.length, 1);
});

test('스케줄러는 정각이 아니면 아무것도 하지 않는다', async () => {
  const notOnTheHour = new Date('2026-04-02T00:17:00Z');
  assert.deepEqual(await tick(notOnTheHour), { skipped: 'not_on_the_hour' });
});

test('방해 금지 시간 계산', () => {
  const at = (hourKst) => new Date(Date.UTC(2026, 3, 2, hourKst - 9, 0, 0));

  const night = { quietStart: 22, quietEnd: 7 }; // 자정을 넘는 구간
  assert.equal(inQuietHours(night, at(23)), true);
  assert.equal(inQuietHours(night, at(3)), true);
  assert.equal(inQuietHours(night, at(7)), false);
  assert.equal(inQuietHours(night, at(12)), false);

  const day = { quietStart: 9, quietEnd: 18 }; // 같은 날 안의 구간
  assert.equal(inQuietHours(day, at(10)), true);
  assert.equal(inQuietHours(day, at(20)), false);

  assert.equal(inQuietHours({ quietStart: null, quietEnd: null }, at(3)), false);
  assert.equal(inQuietHours({ quietStart: 5, quietEnd: 5 }, at(5)), false);
});

test('알림 설정을 저장하고 되읽을 수 있다', async () => {
  const { call, user } = await signUp(server, { handle: 'noti-user' });

  const initial = await call('/api/me/push');
  assert.equal(initial.body.configured, isPushConfigured());
  assert.equal(initial.body.prefs.poemPush, true);
  assert.equal(initial.body.devices, 0);

  const updated = await call('/api/me/push/prefs', {
    method: 'PUT',
    body: { poemPush: false, quietStart: 22, quietEnd: 7 },
  });
  assert.equal(updated.body.prefs.poemPush, false);
  assert.equal(updated.body.prefs.missionPush, true, '건드리지 않은 설정은 그대로여야 한다');
  assert.equal(updated.body.prefs.quietStart, 22);

  assert.deepEqual(getPrefs(user.id), updated.body.prefs);

  updatePrefs(user.id, { quietStart: null, quietEnd: null });
  assert.equal(getPrefs(user.id).quietStart, null);
});

test('올바르지 않은 구독 정보는 거절된다', async () => {
  const { call } = await signUp(server, { handle: 'noti-bad' });
  const res = await call('/api/me/push/subscribe', {
    method: 'POST',
    body: { subscription: { endpoint: 'https://example.test/x' } },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_subscription');
});

test('점수 원장은 같은 근거로 두 번 쌓이지 않는다', async () => {
  const { user } = await signUp(server, { handle: 'ledger' });

  assert.equal(award({ userId: user.id, amount: 50, reason: 'mission', ref: 'm-1' }), true);
  assert.equal(award({ userId: user.id, amount: 50, reason: 'mission', ref: 'm-1' }), false);
  assert.equal(award({ userId: user.id, amount: 30, reason: 'mission', ref: 'm-2' }), true);
  // ref 가 없으면 중복 검사를 하지 않는다 (채팅 보너스처럼 여러 번 쌓이는 항목)
  assert.equal(award({ userId: user.id, amount: 5, reason: 'cheer' }), true);
  assert.equal(award({ userId: user.id, amount: 5, reason: 'cheer' }), true);

  const board = leaderboard({ period: 'all', limit: 100 });
  assert.equal(board.find((r) => r.userId === user.id).points, 90);
});

test('동점자는 같은 순위를 받는다', async () => {
  const a = await signUp(server, { handle: 'tie-a', displayName: 'ㄱ' });
  const b = await signUp(server, { handle: 'tie-b', displayName: 'ㄴ' });
  const created = await a.call('/api/rooms', { method: 'POST', body: { name: '동점 시험방' } });
  const room = created.body.room;
  await b.call('/api/rooms/join', { method: 'POST', body: { code: room.code } });

  award({ userId: a.user.id, roomId: room.id, amount: 40, reason: 'test', ref: 'tie-a' });
  award({ userId: b.user.id, roomId: room.id, amount: 40, reason: 'test', ref: 'tie-b' });

  const board = leaderboard({ roomId: room.id, period: 'all' });
  assert.equal(board[0].rank, 1);
  assert.equal(board[1].rank, 1, '같은 점수면 같은 순위');
  assert.equal(rankOf({ userId: b.user.id, roomId: room.id, period: 'all' }).rank, 1);
});

test('일별 점수 그래프는 요청한 날짜 수만큼 돌려준다', async () => {
  const { user } = await signUp(server, { handle: 'series' });
  const today = dayKey();
  award({ userId: user.id, amount: 25, reason: 'test', ref: 's1', day: today });
  award({ userId: user.id, amount: 15, reason: 'test', ref: 's2', day: addDays(today, -3) });

  const series = dailySeries(user.id, 7, today);
  assert.equal(series.length, 7);
  assert.equal(series.at(-1).day, today);
  assert.equal(series.at(-1).points, 25);
  assert.equal(series.at(-4).points, 15);
  assert.equal(series[0].points, 0);
});
