import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';
import { REPORTS_TO_HIDE } from '../src/services/moderation.js';
import { NODES } from '../src/content/journey.js';
import { buildLesson } from '../src/services/lessons.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

let n = 0;
const person = (name) => signUp(server, { handle: `safe${++n}`, displayName: name ?? `사람${n}` });

/** 선생님이 방을 만들고 학생 k 명이 들어온다. */
async function classroom(k) {
  const teacher = await person('선생님');
  const room = (await teacher.call('/api/rooms', { method: 'POST', body: { name: '3학년 2반' } })).body.room;
  const students = [];
  for (let i = 0; i < k; i++) {
    const s = await person();
    await s.call('/api/rooms/join', { method: 'POST', body: { code: room.code } });
    students.push(s);
  }
  return { teacher, room, students };
}

const say = async (who, room, body) =>
  (await who.call(`/api/rooms/${room.id}/messages`, { method: 'POST', body: { body } })).body.message;
const read = async (who, room) => (await who.call(`/api/rooms/${room.id}/messages`)).body.messages;

test(`서로 다른 ${REPORTS_TO_HIDE}명이 신고하면 글이 저절로 가려진다`, async () => {
  const { room, students } = await classroom(REPORTS_TO_HIDE + 1);
  const [bad, ...others] = students;
  const msg = await say(bad, room, '나쁜 말');

  for (let i = 0; i < REPORTS_TO_HIDE - 1; i++) {
    const r = await others[i].call(`/api/rooms/${room.id}/messages/${msg.id}/report`, { method: 'POST', body: { reason: '불쾌한 말' } });
    assert.equal(r.body.hidden, false);
  }
  const last = await others[REPORTS_TO_HIDE - 1].call(`/api/rooms/${room.id}/messages/${msg.id}/report`, { method: 'POST', body: { reason: '괴롭힘' } });
  assert.equal(last.body.hidden, true);

  const seen = (await read(others[0], room)).find((m) => m.id === msg.id);
  assert.equal(seen.hidden, true);
  assert.equal(seen.body, '', '다른 사람에게는 원문이 나가면 안 됩니다');
});

test('같은 사람이 여러 번 신고해도 한 번으로 센다', async () => {
  const { room, students } = await classroom(2);
  const [author, reporter] = students;
  const msg = await say(author, room, '그냥 글');
  for (let i = 0; i < REPORTS_TO_HIDE + 2; i++) {
    const r = await reporter.call(`/api/rooms/${room.id}/messages/${msg.id}/report`, { method: 'POST', body: {} });
    assert.equal(r.body.hidden, false);
  }
});

test('내 글이나 알림 글은 신고할 수 없다', async () => {
  const { room, students } = await classroom(1);
  const msg = await say(students[0], room, '내 글');
  const own = await students[0].call(`/api/rooms/${room.id}/messages/${msg.id}/report`, { method: 'POST', body: {} });
  assert.equal(own.status, 400);
});

test('가린 글은 선생님과 글쓴이에게는 원문이 보인다 — 무엇이 문제였는지 판단해야 하니까', async () => {
  const { teacher, room, students } = await classroom(2);
  const msg = await say(students[0], room, '선생님이 가릴 글');
  const hide = await teacher.call(`/api/rooms/${room.id}/messages/${msg.id}/hide`, { method: 'POST', body: {} });
  assert.equal(hide.body.hidden, true);

  const forTeacher = (await read(teacher, room)).find((m) => m.id === msg.id);
  const forAuthor = (await read(students[0], room)).find((m) => m.id === msg.id);
  const forOther = (await read(students[1], room)).find((m) => m.id === msg.id);
  assert.equal(forTeacher.body, '선생님이 가릴 글');
  assert.equal(forAuthor.body, '선생님이 가릴 글');
  assert.equal(forOther.body, '');

  await teacher.call(`/api/rooms/${room.id}/messages/${msg.id}/hide`, { method: 'POST', body: { hidden: false } });
  assert.equal((await read(students[1], room)).find((m) => m.id === msg.id).body, '선생님이 가릴 글');
});

test('학생은 남의 글을 가릴 수 없다', async () => {
  const { room, students } = await classroom(2);
  const msg = await say(students[0], room, '글');
  const res = await students[1].call(`/api/rooms/${room.id}/messages/${msg.id}/hide`, { method: 'POST', body: {} });
  assert.equal(res.status, 403);
});

test('차단하면 내 화면에서만 상대 글이 사라진다', async () => {
  const { room, students } = await classroom(3);
  const [a, b, c] = students;
  await say(b, room, 'b 의 글');
  await a.call('/api/me/blocks', { method: 'POST', body: { userId: b.user.id } });

  assert.ok(!(await read(a, room)).some((m) => m.body === 'b 의 글'), '차단한 사람에게 보입니다');
  assert.ok((await read(c, room)).some((m) => m.body === 'b 의 글'), '다른 사람에게서도 사라졌습니다');
  assert.ok((await read(b, room)).some((m) => m.body === 'b 의 글'), '차단당한 사람이 알게 됩니다');

  await a.call(`/api/me/blocks/${b.user.id}`, { method: 'DELETE' });
  assert.ok((await read(a, room)).some((m) => m.body === 'b 의 글'));
});

test('나를 차단할 수는 없다', async () => {
  const a = await person();
  assert.equal((await a.call('/api/me/blocks', { method: 'POST', body: { userId: a.user.id } })).status, 400);
});

test('선생님 보기 — 방을 만든 사람만, 숫자만', async () => {
  const { teacher, room, students } = await classroom(2);
  const [walker] = students;
  // 한 학생이 마디 하나를 걷는다.
  const node = NODES[0].id;
  await walker.call(`/api/journey/nodes/${node}`);
  const lesson = buildLesson(walker.user.id, node);
  for (let i = 0; i < lesson.steps.length; i++) {
    const s = lesson.steps[i];
    const body =
      s.type === 'slow-read' ? { stanzasSeen: s.stanzas.length }
      : s.type === 'order' ? { lines: s.answer }
      : s.type === 'feeling' ? { choice: 0 }
      : s.type === 'response' ? { text: '비밀로 남기고 싶은 감상입니다. 선생님이 보면 안 됩니다.' }
      : { choice: s.answer };
    await walker.call(`/api/journey/nodes/${node}/steps/${i}`, { method: 'POST', body });
  }
  await walker.call(`/api/journey/nodes/${node}/finish`, { method: 'POST' });

  assert.equal((await students[1].call(`/api/rooms/${room.id}/progress`)).status, 403);

  const res = await teacher.call(`/api/rooms/${room.id}/progress`);
  assert.equal(res.status, 200);
  const me = res.body.members.find((m) => m.id === walker.user.id);
  assert.equal(me.nodesDone, 1);
  assert.equal(me.stalled, false);
  const idle = res.body.members.find((m) => m.id === students[1].user.id);
  assert.equal(idle.stalled, true);
  assert.equal(res.body.members[0].stalled, true, '멈춘 사람이 위에 와야 합니다');
  assert.ok(!res.body.members.some((m) => m.id === teacher.user.id), '선생님은 살필 대상이 아닙니다');
  assert.equal(res.body.summary.count, 2);
  assert.ok(!JSON.stringify(res.body).includes('비밀로 남기고'), '학생의 감상 원문이 선생님에게 나갔습니다');
});

test('내 한 줄 감상을 방에 나눌 수 있고, 남의 것은 끌어올 수 없다', async () => {
  const { room, students } = await classroom(2);
  const [a, b] = students;
  const node = NODES[0].id;
  await a.call(`/api/journey/nodes/${node}`);
  const lesson = buildLesson(a.user.id, node);
  for (let i = 0; i < lesson.steps.length; i++) {
    const s = lesson.steps[i];
    const body =
      s.type === 'slow-read' ? { stanzasSeen: s.stanzas.length }
      : s.type === 'order' ? { lines: s.answer }
      : s.type === 'feeling' ? { choice: 0 }
      : s.type === 'response' ? { text: '나누고 싶은 한 줄 감상입니다. 길이가 충분합니다.' }
      : { choice: s.answer };
    await a.call(`/api/journey/nodes/${node}/steps/${i}`, { method: 'POST', body });
  }
  const mine = (await a.call('/api/journey/responses')).body.responses[0];
  const shared = await a.call(`/api/rooms/${room.id}/share`, { method: 'POST', body: { type: 'response', id: mine.id } });
  assert.equal(shared.status, 201);
  assert.equal(shared.body.message.kind, 'share');
  assert.equal(shared.body.message.meta.poemTitle, '새로운 길');

  const steal = await b.call(`/api/rooms/${room.id}/share`, { method: 'POST', body: { type: 'response', id: mine.id } });
  assert.equal(steal.status, 404);
});
