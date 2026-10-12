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

/** 쿠키를 들고 Origin/Referer 를 마음대로 붙여 보내는 요청. */
async function post(path, cookie, headers) {
  return fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    body: JSON.stringify({ name: '방' }),
  });
}

async function cookieOf() {
  const res = await fetch(`${server.base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, displayName: 'x', pin: '1234' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

test('다른 출처의 쓰기 요청은 403', async () => {
  const cookie = await cookieOf();
  const res = await post('/api/rooms', cookie, { Origin: 'https://evil.example.com' });
  assert.equal(res.status, 403);
});

test('Origin 이 없으면 Referer 로 가린다', async () => {
  const cookie = await cookieOf();
  const res = await post('/api/rooms', cookie, { Referer: 'https://evil.example.com/page' });
  assert.equal(res.status, 403);
});

test('같은 출처의 쓰기 요청은 통과', async () => {
  const cookie = await cookieOf();
  const res = await post('/api/rooms', cookie, { Origin: server.base });
  assert.equal(res.status, 201);
});

test('읽기 요청은 Origin 을 보지 않는다', async () => {
  const cookie = await cookieOf();
  const res = await fetch(`${server.base}/api/journey`, {
    headers: { Cookie: cookie, Origin: 'https://evil.example.com' },
  });
  assert.equal(res.status, 200);
});

test('Origin·Referer 가 둘 다 없는 요청(브라우저가 아닌 곳)은 통과', async () => {
  const { call } = await signUp(server, { handle: `nohdr${Date.now().toString(36)}` });
  const res = await call('/api/rooms', { method: 'POST', body: { name: '방' } });
  assert.equal(res.status, 201);
});
