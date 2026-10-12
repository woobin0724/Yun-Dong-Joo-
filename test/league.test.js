import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';
import { tierFromWeeks, THRESHOLDS, TIERS, leagueOf } from '../src/services/league.js';
import { getDb, now } from '../src/db.js';
import { dayKey, addDays, weekStart } from '../src/lib/date.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

let n = 0;
const fresh = () => signUp(server, { handle: `league${++n}` });

/** 지난 날짜로 점수를 넣는다. */
function give(userId, day, amount) {
  getDb()
    .prepare(
      `INSERT INTO points_ledger (user_id, room_id, day, amount, reason, ref, created_at)
       VALUES (?, NULL, ?, ?, 'test', ?, ?)`,
    )
    .run(userId, day, amount, `${day}:${Math.random()}`, now());
}

const thisWeek = weekStart(dayKey());
const weeksAgo = (k) => addDays(thisWeek, -7 * k);

test('문턱을 넘은 주 다음에 한 칸 올라간다', () => {
  const { tier } = tierFromWeeks([{ week: 'w1', points: THRESHOLDS[0] }]);
  assert.equal(tier, 1);
});

test('한 주에 한 칸씩만 올라간다 — 아무리 많이 해도', () => {
  const { tier } = tierFromWeeks([{ week: 'w1', points: 99999 }]);
  assert.equal(tier, 1);
});

test('내려가는 일은 없다 — 쉰 주가 있어도', () => {
  const { tier } = tierFromWeeks([
    { week: 'w1', points: THRESHOLDS[0] },
    { week: 'w2', points: 0 },
    { week: 'w3', points: 0 },
  ]);
  assert.equal(tier, 1);
});

test('맨 위 등급에서 멈춘다', () => {
  const weeks = Array.from({ length: 10 }, (_, i) => ({ week: `w${i}`, points: 99999 }));
  assert.equal(tierFromWeeks(weeks).tier, TIERS.length - 1);
});

test('원장에서 다시 셈한다 — 지난주 문턱을 넘었으면 이번 주는 한 연', async () => {
  const { call, user } = await fresh();
  give(user.id, weeksAgo(1), THRESHOLDS[0]);
  const res = await call('/api/ranking/league');
  assert.equal(res.status, 200);
  assert.equal(res.body.league.tier.id, 'stanza');
  assert.equal(res.body.league.threshold, THRESHOLDS[1]);
});

test('쉰 주가 껴도 등급은 그대로다', async () => {
  const { user } = await fresh();
  give(user.id, weeksAgo(4), THRESHOLDS[0]); // 한 줄 → 한 연
  // 그 뒤 세 주는 아무것도 안 함
  assert.equal(leagueOf(user.id).tier.id, 'stanza');
});

test('이번 주 남은 점수와, 넘었는지를 알려 준다', async () => {
  const { call, user } = await fresh();
  give(user.id, dayKey(), 30);
  let l = (await call('/api/ranking/league')).body.league;
  assert.equal(l.remaining, THRESHOLDS[0] - 30);
  assert.equal(l.promotesNextWeek, false);
  give(user.id, dayKey(), THRESHOLDS[0]);
  l = (await call('/api/ranking/league')).body.league;
  assert.equal(l.remaining, 0);
  assert.equal(l.promotesNextWeek, true);
});

test('리그 표에는 같은 등급 사람만 나온다', async () => {
  const low = await fresh();
  const high = await fresh();
  give(low.user.id, dayKey(), 10);
  give(high.user.id, weeksAgo(1), THRESHOLDS[0]);
  give(high.user.id, dayKey(), 10);
  const table = (await low.call('/api/ranking/league')).body;
  assert.ok(table.rows.some((r) => r.me));
  assert.ok(!table.rows.some((r) => r.name === high.user.displayName), '다른 등급 사람이 섞였습니다');
});

test('리그 표에 다른 사람의 id 는 나가지 않는다', async () => {
  const { call, user } = await fresh();
  give(user.id, dayKey(), 10);
  const dump = JSON.stringify((await call('/api/ranking/league')).body.rows);
  assert.ok(!dump.includes('"userId"'));
});
