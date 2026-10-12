import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, signUp } from './helpers.js';
import { TRANSCRIBE_POINTS, MIN_CHARS, countChars } from '../src/services/transcriptions.js';
import { eulReul } from '../src/lib/korean.js';

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  await server.close();
});

let n = 0;
const fresh = () => signUp(server, { handle: `scribe${++n}` });
const POEM = 'seosi';
const TEXT = '죽는 날까지 하늘을 우러러\n한 점 부끄럼이 없기를,';

test('필사를 저장하고 다시 찾는다', async () => {
  const { call } = await fresh();
  const saved = await call('/api/transcriptions', { method: 'POST', body: { poemId: POEM, text: TEXT } });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.chars, countChars(TEXT));

  const list = await call('/api/transcriptions');
  assert.equal(list.body.transcriptions.length, 1);
  assert.equal(list.body.transcriptions[0].text, TEXT, '줄바꿈까지 그대로 남아야 합니다');
  assert.equal(list.body.transcriptions[0].title, '서시');
});

test('줄바꿈은 칸을 세지 않고, 글자는 코드 포인트로 센다', () => {
  assert.equal(countChars('가나\n다'), 3);
  // String.length 로 세면 이모지가 두 칸이 된다.
  assert.equal(countChars('별🌟'), 2);
});

test('같은 시를 여러 번 적어도 점수는 한 번만', async () => {
  const { call } = await fresh();
  const first = await call('/api/transcriptions', { method: 'POST', body: { poemId: POEM, text: TEXT } });
  const again = await call('/api/transcriptions', { method: 'POST', body: { poemId: POEM, text: TEXT } });
  assert.equal(first.body.points, TRANSCRIBE_POINTS);
  assert.equal(again.body.points, 0);
  assert.equal(again.status, 201, '다시 적는 것 자체는 막지 않습니다');
  assert.equal((await call('/api/transcriptions')).body.transcriptions.length, 2);
});

test('너무 짧으면 받지 않는다', async () => {
  const { call } = await fresh();
  const res = await call('/api/transcriptions', { method: 'POST', body: { poemId: POEM, text: '죽는 날' } });
  assert.equal(res.status, 400);
  assert.match(res.body.error, new RegExp(String(MIN_CHARS)));
});

test('없는 작품은 404', async () => {
  const { call } = await fresh();
  const res = await call('/api/transcriptions', {
    method: 'POST',
    body: { poemId: '없는-시', text: '열 글자가 넘는 아무 글입니다' },
  });
  assert.equal(res.status, 404);
});

test('남의 필사는 보이지도 지워지지도 않는다', async () => {
  const a = await fresh();
  const b = await fresh();
  const saved = await a.call('/api/transcriptions', { method: 'POST', body: { poemId: POEM, text: TEXT } });
  const id = saved.body.id;

  assert.equal((await b.call(`/api/transcriptions/${id}`)).status, 404);
  assert.equal((await b.call(`/api/transcriptions/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await b.call('/api/transcriptions')).body.transcriptions.length, 0);
  assert.equal((await a.call(`/api/transcriptions/${id}`)).status, 200, '주인에게는 그대로 있어야 합니다');
});

test('지워도 점수는 깎지 않는다', async () => {
  const { call } = await fresh();
  const saved = await call('/api/transcriptions', { method: 'POST', body: { poemId: POEM, text: TEXT } });
  const before = (await call('/api/me')).body.stats.totalPoints;
  await call(`/api/transcriptions/${saved.body.id}`, { method: 'DELETE' });
  assert.equal((await call('/api/me')).body.stats.totalPoints, before);
});

test('조사 고르기 파일은 브라우저로도 그대로 나간다', async () => {
  const res = await fetch(`${server.base}/lib/korean.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  const src = await res.text();
  assert.match(src, /export const eulReul/);
  assert.doesNotMatch(src, /from 'node:/, '브라우저에서 못 도는 node 내장 모듈을 쓰면 안 됩니다');
});

test('제목 뒤 조사 — 받침에 따라 갈린다', () => {
  assert.equal(eulReul('서시'), '를');
  assert.equal(eulReul('길'), '을');
  assert.equal(eulReul('별 헤는 밤'), '을');
  assert.equal(eulReul('간'), '을');
  assert.equal(eulReul('소년'), '을');
  assert.equal(eulReul('바람이 불어'), '를');
});

test('로그인하지 않으면 필사에 들어갈 수 없다', async () => {
  const anon = server.client();
  assert.equal((await anon('/api/transcriptions')).status, 401);
});
