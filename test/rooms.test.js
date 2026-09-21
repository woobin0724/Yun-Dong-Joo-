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

/** 방 하나와 그 방에 속한 두 사람을 만든다. */
async function makeRoomWithTwo(prefix) {
  const owner = await signUp(server, { handle: `${prefix}-owner`, displayName: '방장' });
  const created = await owner.call('/api/rooms', {
    method: 'POST',
    body: { name: '3학년 2반' },
  });
  const room = created.body.room;

  const guest = await signUp(server, { handle: `${prefix}-guest`, displayName: '동무' });
  const joined = await guest.call('/api/rooms/join', {
    method: 'POST',
    body: { code: room.code },
  });
  assert.equal(joined.body.joined, true);

  return { owner, guest, room };
}

test('방을 만들면 초대 코드가 생기고 안내 메시지가 남는다', async () => {
  const { owner, room } = await makeRoomWithTwo('r1');
  assert.match(room.code, /^[A-Z0-9]{6}$/);

  const messages = await owner.call(`/api/rooms/${room.id}/messages`);
  assert.equal(messages.status, 200);
  const notice = messages.body.messages.find((m) => m.authorType === 'bot');
  assert.ok(notice, '봇 안내가 있어야 한다');
  assert.match(notice.body, new RegExp(room.code));
});

test('초대 코드는 공백이나 소문자가 섞여도 통한다', async () => {
  const { room } = await makeRoomWithTwo('r2');
  const late = await signUp(server, { handle: 'r2-late' });
  const res = await late.call('/api/rooms/join', {
    method: 'POST',
    body: { code: ` ${room.code.toLowerCase()} ` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.joined, true);
});

test('없는 코드로는 들어갈 수 없다', async () => {
  const { call } = await signUp(server, { handle: 'wanderer' });
  const res = await call('/api/rooms/join', { method: 'POST', body: { code: 'ZZZZZZ' } });
  assert.equal(res.status, 404);
});

test('구성원이 아니면 방을 들여다볼 수 없다', async () => {
  const { room } = await makeRoomWithTwo('r3');
  const outsider = await signUp(server, { handle: 'outsider' });

  assert.equal((await outsider.call(`/api/rooms/${room.id}`)).status, 403);
  assert.equal((await outsider.call(`/api/rooms/${room.id}/messages`)).status, 403);
  assert.equal(
    (await outsider.call(`/api/rooms/${room.id}/messages`, { method: 'POST', body: { body: '안녕' } }))
      .status,
    403,
  );
  assert.equal((await outsider.call(`/api/rooms/${room.id}/ranking`)).status, 403);
});

test('채팅과 응원', async () => {
  const { owner, guest, room } = await makeRoomWithTwo('r4');

  const posted = await owner.call(`/api/rooms/${room.id}/messages`, {
    method: 'POST',
    body: { body: '이 시의 마지막 연이 오래 남습니다.' },
  });
  assert.equal(posted.status, 201);
  const messageId = posted.body.message.id;

  const cheered = await guest.call(`/api/rooms/${room.id}/messages/${messageId}/cheer`, {
    method: 'POST',
    body: { kind: 'star' },
  });
  assert.equal(cheered.body.cheered, true);
  assert.equal(cheered.body.message.cheers.find((c) => c.kind === 'star').count, 1);

  // 같은 응원을 다시 누르면 취소된다
  const undone = await guest.call(`/api/rooms/${room.id}/messages/${messageId}/cheer`, {
    method: 'POST',
    body: { kind: 'star' },
  });
  assert.equal(undone.body.cheered, false);
  assert.equal(undone.body.message.cheers.length, 0);

  const unknown = await guest.call(`/api/rooms/${room.id}/messages/${messageId}/cheer`, {
    method: 'POST',
    body: { kind: '없는응원' },
  });
  assert.equal(unknown.status, 400);
});

test('빈 메시지와 지나치게 긴 메시지는 거절된다', async () => {
  const { owner, room } = await makeRoomWithTwo('r5');
  assert.equal(
    (await owner.call(`/api/rooms/${room.id}/messages`, { method: 'POST', body: { body: '   ' } }))
      .status,
    400,
  );
  assert.equal(
    (
      await owner.call(`/api/rooms/${room.id}/messages`, {
        method: 'POST',
        body: { body: '별'.repeat(2001) },
      })
    ).status,
    400,
  );
});

test('공유 미션을 제출하면 방에 감상이 올라간다', async () => {
  const { owner, room } = await makeRoomWithTwo('r6');
  const today = await owner.call('/api/missions/today');
  const shareMission = today.body.missions.find((m) => m.kind === 'text');

  const text = '이 구절 앞에서 한참 멈춰 있었습니다. '.repeat(4);
  const res = await owner.call(`/api/missions/${shareMission.id}/submit`, {
    method: 'POST',
    body: { text },
  });
  assert.equal(res.status, 200);

  const messages = await owner.call(`/api/rooms/${room.id}/messages`);
  const shared = messages.body.messages.find((m) => m.kind === 'share');
  if (shareMission.share !== false && shared) {
    assert.equal(shared.body, text.trim());
    assert.equal(shared.meta.poemId, today.body.poem.id);
  }
});

test('하루 미션을 다 끝내면 봇이 한마디 남긴다', async () => {
  const { owner, room } = await makeRoomWithTwo('r7');
  const today = await owner.call('/api/missions/today');

  for (const mission of today.body.missions) {
    if (mission.kind === 'quiz') {
      for (let i = 0; i < mission.data.options.length; i++) {
        const res = await owner.call(`/api/missions/${mission.id}/submit`, {
          method: 'POST',
          body: { answer: i },
        });
        if (res.body.correct) break;
      }
    } else if (mission.kind === 'text') {
      await owner.call(`/api/missions/${mission.id}/submit`, {
        method: 'POST',
        body: { text: '별'.repeat((mission.data.minLength || 20) + 3) },
      });
    } else {
      await owner.call(`/api/missions/${mission.id}/submit`, { method: 'POST', body: {} });
    }
  }

  const after = await owner.call('/api/missions/today');
  assert.equal(after.body.remaining, 0);
  assert.equal(after.body.stats.streak, 1);

  const messages = await owner.call(`/api/rooms/${room.id}/messages`);
  assert.ok(
    messages.body.messages.some((m) => m.kind === 'mission' && m.authorType === 'bot'),
    '완료 안내가 있어야 한다',
  );
  assert.ok(
    messages.body.messages.some((m) => m.kind === 'challenge'),
    '도전과제 축하가 있어야 한다',
  );
});

test('랭킹은 점수 순으로 정렬되고 내 순위를 알려 준다', async () => {
  const { owner, guest, room } = await makeRoomWithTwo('r8');

  const today = await owner.call('/api/missions/today');
  const check = today.body.missions.find((m) => m.kind === 'check');
  await owner.call(`/api/missions/${check.id}/submit`, { method: 'POST', body: {} });

  const ranking = await owner.call(`/api/rooms/${room.id}/ranking?period=week`);
  assert.equal(ranking.status, 200);
  assert.equal(ranking.body.ranking[0].userId, owner.user.id);
  assert.ok(ranking.body.ranking[0].points > 0);
  assert.equal(ranking.body.me.rank, 1);

  // 아직 아무것도 안 한 사람은 0점으로 뒤에 놓인다
  const guestRank = await guest.call(`/api/rooms/${room.id}/ranking?period=week`);
  assert.equal(guestRank.body.me.points, 0);

  // 방 랭킹에는 그 방 사람만 나온다
  const stranger = await signUp(server, { handle: 'r8-stranger' });
  const st = await stranger.call('/api/missions/today');
  await stranger.call(`/api/missions/${st.body.missions[0].id}/submit`, {
    method: 'POST',
    body: {},
  });
  const roomBoard = await owner.call(`/api/rooms/${room.id}/ranking`);
  assert.ok(!roomBoard.body.ranking.some((r) => r.userId === stranger.user.id));

  // 전체 랭킹에는 나온다
  const all = await owner.call('/api/ranking?period=all');
  assert.ok(all.body.ranking.some((r) => r.userId === stranger.user.id));
});

test('방을 나가면 목록에서 빠진다', async () => {
  const { guest, room } = await makeRoomWithTwo('r9');
  assert.equal((await guest.call('/api/rooms')).body.rooms.length, 1);
  await guest.call(`/api/rooms/${room.id}/leave`, { method: 'POST' });
  assert.equal((await guest.call('/api/rooms')).body.rooms.length, 0);
  assert.equal((await guest.call(`/api/rooms/${room.id}/messages`)).status, 403);
});

test('도전과제 목록에 진행률이 담긴다', async () => {
  const { call } = await signUp(server, { handle: 'achiever' });
  const board = await call('/api/me/challenges');

  assert.equal(board.status, 200);
  assert.ok(board.body.items.length >= 20);
  assert.equal(board.body.earnedCount, 0);
  assert.ok(board.body.groups.length >= 5);

  const readerTen = board.body.items.find((c) => c.id === 'reader-10');
  assert.equal(readerTen.progress.target, 10);
  assert.equal(readerTen.progress.current, 0);

  const poems = await call('/api/poems');
  for (const poem of poems.body.poems.slice(0, 6)) {
    await call(`/api/poems/${poem.id}/read`, { method: 'POST' });
  }

  const after = await call('/api/me/challenges');
  assert.equal(after.body.items.find((c) => c.id === 'reader-10').progress.current, 6);
  assert.equal(after.body.items.find((c) => c.id === 'reader-5').earned, true);
});

test('요청 제한기는 정해진 횟수를 넘기면 막는다', async () => {
  const { rateLimit } = await import('../src/routes/middleware.js');
  const limiter = rateLimit({ windowMs: 1000, max: 2, key: () => 'fixed' });

  const run = () =>
    new Promise((resolve) => {
      limiter({ ip: '1.2.3.4' }, {}, (err) => resolve(err ?? null));
    });

  assert.equal(await run(), null);
  assert.equal(await run(), null);
  const blocked = await run();
  assert.ok(blocked, '세 번째는 막혀야 한다');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.code, 'rate_limited');
});
