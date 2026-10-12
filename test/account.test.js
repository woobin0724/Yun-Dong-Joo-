import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';
import { getDb } from '../src/db.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

let n = 0;
const person = () => signUp(server, { handle: `bye${++n}`, displayName: `사람${n}` });
const count = (sql, ...args) => Number(getDb().prepare(sql).get(...args).n);

test('아이디를 정확히 적지 않으면 지우지 않는다', async () => {
  const { call } = await person();
  const res = await call('/api/me', { method: 'DELETE', body: { confirmHandle: '틀린아이디' } });
  assert.equal(res.status, 400);
  assert.equal((await call('/api/me')).status, 200, '계정이 남아 있어야 합니다');
});

test('지우면 로그인이 풀리고, 기록과 방에 쓴 글이 함께 사라진다', async () => {
  const me = await person();
  const friend = await person();
  const room = (await friend.call('/api/rooms', { method: 'POST', body: { name: '반' } })).body.room;
  await me.call('/api/rooms/join', { method: 'POST', body: { code: room.code } });
  await me.call(`/api/rooms/${room.id}/messages`, { method: 'POST', body: { body: '지워질 내 글' } });
  await me.call('/api/transcriptions', {
    method: 'POST',
    body: { poemId: 'seosi', text: '죽는 날까지 하늘을 우러러\n한 점 부끄럼이 없기를,' },
  });
  const id = me.user.id;

  const res = await me.call('/api/me', { method: 'DELETE', body: { confirmHandle: me.user.handle } });
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);
  assert.equal((await me.call('/api/me')).status, 401, '지운 뒤에도 로그인이 남아 있습니다');

  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM transcriptions WHERE user_id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM points_ledger WHERE user_id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', id), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM messages WHERE body = '지워질 내 글'"), 0, '방에 쓴 글이 남았습니다');
  assert.equal(count('SELECT COUNT(*) AS n FROM messages WHERE user_id IS NULL AND author_type = ?', 'user'), 0,
    '작성자만 비운 글이 남았습니다');
});

test('방장이 지우면 가장 먼저 들어온 사람이 방장이 된다', async () => {
  const teacher = await person();
  const first = await person();
  const second = await person();
  const room = (await teacher.call('/api/rooms', { method: 'POST', body: { name: '반' } })).body.room;
  await first.call('/api/rooms/join', { method: 'POST', body: { code: room.code } });
  await second.call('/api/rooms/join', { method: 'POST', body: { code: room.code } });

  const res = await teacher.call('/api/me', { method: 'DELETE', body: { confirmHandle: teacher.user.handle } });
  assert.deepEqual(res.body.handedOver, [room.id]);
  const role = getDb()
    .prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
    .get(room.id, first.user.id).role;
  assert.equal(role, 'owner');
  assert.equal((await first.call(`/api/rooms/${room.id}/progress`)).status, 200, '새 방장이 반 살펴보기를 못 엽니다');
});

test('혼자 있던 방은 함께 지워진다', async () => {
  const lone = await person();
  const room = (await lone.call('/api/rooms', { method: 'POST', body: { name: '혼자' } })).body.room;
  const res = await lone.call('/api/me', { method: 'DELETE', body: { confirmHandle: lone.user.handle } });
  assert.deepEqual(res.body.removedRooms, [room.id]);
  assert.equal(count('SELECT COUNT(*) AS n FROM rooms WHERE id = ?', room.id), 0);
});
