import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import './setup.js';
// 구글 설정은 앱을 불러오기 전에 넣어야 config 가 읽는다.
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://127.0.0.1/api/auth/google/callback';

const { startTestServer, signUp } = await import('./helpers.js');
const { setHttpClient, clearJwksCache } = await import('../src/services/google-auth.js');

// ── 가짜 구글 ────────────────────────────────────────────
// 실제 구글을 부를 수 없으므로 여기서 진짜 RSA 키로 id_token 을 만들어 준다.
// 서명·kid·aud·만료 검증 코드가 실제로 도는 것을 확인하기 위해서다.

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake-kid', alg: 'RS256', use: 'sig' };

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function makeIdToken(overrides = {}, { kid = 'fake-kid', key = privateKey } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: process.env.GOOGLE_CLIENT_ID,
    sub: '1234567890',
    email: 'dongju@example.com',
    email_verified: true,
    name: '윤동주',
    iat: nowSec,
    exp: nowSec + 3600,
    ...overrides,
  };
  const input = `${b64({ alg: 'RS256', kid })}.${b64(payload)}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

/** 토큰 교환과 JWKS 를 흉내 내는 fetch. 마지막 요청 본문을 기록해 둔다. */
function fakeGoogle({ idToken = makeIdToken(), tokenStatus = 200 } = {}) {
  const seen = { tokenBody: null, calls: 0 };
  setHttpClient(async (url, init) => {
    seen.calls++;
    if (String(url).includes('/certs')) {
      return {
        ok: true,
        json: async () => ({ keys: [jwk] }),
        headers: { get: () => 'max-age=3600' },
      };
    }
    seen.tokenBody = new URLSearchParams(init.body);
    return {
      ok: tokenStatus === 200,
      status: tokenStatus,
      json: async () =>
        tokenStatus === 200
          ? { id_token: idToken, access_token: 'a', token_type: 'Bearer' }
          : { error: 'invalid_grant', error_description: '코드가 이미 쓰였습니다' },
    };
  });
  return seen;
}

let server;
before(async () => {
  server = await startTestServer();
});
after(async () => {
  setHttpClient(null);
  await server.close();
});
beforeEach(() => clearJwksCache());

/** start → 콜백까지 한 번에 태운다. 쿠키는 클라이언트가 들고 다닌다. */
async function runGoogleLogin(call, { codeParam = 'auth-code-1', tamper } = {}) {
  const start = await call('/api/auth/google/start');
  assert.equal(start.status, 302);

  const authUrl = new URL(start.headers.location);
  const query = Object.fromEntries(authUrl.searchParams);
  const state = tamper?.state ?? query.state;

  const callback = await call(
    `/api/auth/google/callback?code=${codeParam}&state=${encodeURIComponent(state)}`,
  );
  return { query, callback };
}

test('로그인 수단 목록에 구글이 켜져 있다', async () => {
  const res = await server.client()('/api/auth/providers');
  assert.deepEqual(res.body, { password: true, google: true });
});

test('start 는 구글 동의 화면으로 보내며 PKCE 와 state 를 싣는다', async () => {
  fakeGoogle();
  const res = await server.client()('/api/auth/google/start');

  assert.equal(res.status, 302);
  const url = new URL(res.headers.location);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.ok(url.searchParams.get('state'));
  // 필요 이상을 요청하지 않는다
  assert.ok(!url.searchParams.get('scope').includes('contacts'));
});

test('처음 들어온 사람은 계정이 만들어지고 이름 정하기로 간다', async () => {
  const seen = fakeGoogle();
  const call = server.client();

  const { query, callback } = await runGoogleLogin(call);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, '/#welcome');

  // PKCE verifier 가 실제로 교환에 쓰였고, challenge 와 짝이 맞는다
  const verifier = seen.tokenBody.get('code_verifier');
  assert.ok(verifier);
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.equal(expected, query.code_challenge);
  assert.equal(seen.tokenBody.get('grant_type'), 'authorization_code');
  assert.equal(seen.tokenBody.get('client_secret'), 'test-client-secret');

  // 로그인된 상태이고, 프로필은 아직 미완성이다
  const me = await call('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.profileCompleted, false);
  assert.equal(me.body.user.displayName, '윤동주');
});

test('두 번째 로그인은 같은 계정으로 이어지고 바로 오늘 화면으로 간다', async () => {
  fakeGoogle({ idToken: makeIdToken({ sub: 'repeat-user', email: 'a@example.com' }) });

  const first = await runGoogleLogin(server.client());
  assert.equal(first.callback.headers.location, '/#welcome');

  // 프로필을 마치고
  const call = server.client();
  await runGoogleLogin(call);
  await call('/api/me/profile', {
    method: 'PATCH',
    body: { handle: 'repeat-handle', displayName: '되돌아온 사람' },
  });

  // 다시 로그인하면 환영 화면을 건너뛴다
  const again = await runGoogleLogin(server.client());
  assert.equal(again.callback.headers.location, '/#today');

  const users = await call('/api/auth/me');
  assert.equal(users.body.user.handle, 'repeat-handle');
});

test('state 가 맞지 않으면 로그인되지 않는다', async () => {
  fakeGoogle({ idToken: makeIdToken({ sub: 'csrf-target' }) });
  const call = server.client();

  const { callback } = await runGoogleLogin(call, { tamper: { state: '공격자가-지어낸-state' } });
  assert.equal(callback.status, 302);
  assert.match(callback.headers.location, /auth_error=state/);
  assert.equal((await call('/api/auth/me')).status, 401);
});

test('state 쿠키 없이 콜백만 부르면 거부된다', async () => {
  fakeGoogle();
  const res = await server.client()('/api/auth/google/callback?code=x&state=y');
  assert.match(res.headers.location, /auth_error=state/);
});

test('사용자가 동의 화면에서 취소하면 그렇게 알려 준다', async () => {
  const res = await server.client()('/api/auth/google/callback?error=access_denied');
  assert.match(res.headers.location, /auth_error=cancelled/);
});

test('서명이 맞지 않는 id_token 은 거부된다', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fakeGoogle({ idToken: makeIdToken({ sub: '위조' }, { key: other.privateKey }) });

  const call = server.client();
  const { callback } = await runGoogleLogin(call);
  assert.match(callback.headers.location, /auth_error=google/);
  assert.equal((await call('/api/auth/me')).status, 401);
});

test('다른 앱에 발급된 토큰은 거부된다', async () => {
  fakeGoogle({ idToken: makeIdToken({ aud: '남의-앱.apps.googleusercontent.com' }) });
  const { callback } = await runGoogleLogin(server.client());
  assert.match(callback.headers.location, /auth_error=google/);
});

test('만료된 토큰은 거부된다', async () => {
  const past = Math.floor(Date.now() / 1000) - 7200;
  fakeGoogle({ idToken: makeIdToken({ iat: past, exp: past + 3600 }) });
  const { callback } = await runGoogleLogin(server.client());
  assert.match(callback.headers.location, /auth_error=google/);
});

test('이메일 확인이 안 된 구글 계정은 거부된다', async () => {
  fakeGoogle({ idToken: makeIdToken({ sub: '미확인', email_verified: false }) });
  const { callback } = await runGoogleLogin(server.client());
  assert.match(callback.headers.location, /auth_error=unverified/);
});

test('토큰 교환이 실패하면 로그인되지 않는다', async () => {
  fakeGoogle({ tokenStatus: 400 });
  const call = server.client();
  const { callback } = await runGoogleLogin(call);
  assert.match(callback.headers.location, /auth_error=google/);
  assert.equal((await call('/api/auth/me')).status, 401);
});

test('같은 이메일이어도 기존 아이디+PIN 계정에 자동으로 붙지 않는다', async () => {
  // 계정 가로채기를 막기 위한 규칙이다.
  const existing = await signUp(server, { handle: '기존계정', displayName: '기존 사람' });
  fakeGoogle({
    idToken: makeIdToken({ sub: '다른사람', email: 'dongju@example.com', name: '기존 사람' }),
  });

  const { callback } = await runGoogleLogin(server.client());
  assert.equal(callback.headers.location, '/#welcome');

  const call = server.client();
  await runGoogleLogin(call);
  const me = await call('/api/auth/me');
  assert.notEqual(me.body.user.id, existing.user.id, '별개의 계정이어야 한다');
});

test('구글로 만든 계정은 PIN 로그인을 시도해도 안내를 받는다', async () => {
  fakeGoogle({ idToken: makeIdToken({ sub: 'pinless', name: '핀없음' }) });
  const call = server.client();
  await runGoogleLogin(call);
  const { user } = (await call('/api/auth/me')).body;

  const res = await server.client()('/api/auth/login', {
    method: 'POST',
    body: { handle: user.handle, pin: '1234' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'use_google_login');
});

test('아이디가 겹치면 숫자를 붙여 자동으로 지어 준다', async () => {
  await signUp(server, { handle: 'mongyu' }); // 구글이 제안할 아이디를 미리 선점해 둔다
  fakeGoogle({ idToken: makeIdToken({ sub: '겹침', email: 'mongyu@example.com' }) });

  const call = server.client();
  await runGoogleLogin(call);
  const me = await call('/api/auth/me');
  assert.notEqual(me.body.user.handle, 'mongyu');
  assert.match(me.body.user.handle, /^mongyu\d+$/);
});

test('이름 정하기에서 남의 아이디는 쓸 수 없다', async () => {
  await signUp(server, { handle: '선점된아이디' });
  fakeGoogle({ idToken: makeIdToken({ sub: '프로필시도' }) });

  const call = server.client();
  await runGoogleLogin(call);

  const taken = await call('/api/me/profile', {
    method: 'PATCH',
    body: { handle: '선점된아이디', displayName: '아무개' },
  });
  assert.equal(taken.status, 409);

  const ok = await call('/api/me/profile', {
    method: 'PATCH',
    body: { handle: '새아이디', displayName: '아무개' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.profileCompleted, true);
});

test('로그인 수단을 조회할 수 있다', async () => {
  fakeGoogle({ idToken: makeIdToken({ sub: '수단조회' }) });
  const call = server.client();
  await runGoogleLogin(call);

  const res = await call('/api/me/login-methods');
  assert.deepEqual(res.body, { password: false, providers: ['google'] });

  const pinUser = await signUp(server, { handle: '핀계정' });
  assert.deepEqual((await pinUser.call('/api/me/login-methods')).body, {
    password: true,
    providers: [],
  });
});

// ── 무차별 대입 방어 ─────────────────────────────────────

test('한 아이디에 PIN 을 계속 틀리면 그 아이디만 잠깐 막힌다', async () => {
  const { resetLoginGuard } = await import('../src/services/login-guard.js');
  resetLoginGuard();

  await signUp(server, { handle: '표적계정', pin: '1111' });
  await signUp(server, { handle: '옆자리친구', pin: '2222' });

  const attacker = server.client();
  for (let i = 0; i < 10; i++) {
    const res = await attacker('/api/auth/login', {
      method: 'POST',
      body: { handle: '표적계정', pin: '0000' },
    });
    assert.equal(res.status, 401, `${i + 1}번째 시도는 401 이어야 한다`);
  }

  // 11번째부터는 맞는 PIN 이어도 막힌다
  const blocked = await attacker('/api/auth/login', {
    method: 'POST',
    body: { handle: '표적계정', pin: '1111' },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'too_many_attempts');

  // 같은 IP 라도 옆자리 친구는 멀쩡히 들어간다 — 교실에서 서로를 막지 않아야 한다
  const neighbour = await attacker('/api/auth/login', {
    method: 'POST',
    body: { handle: '옆자리친구', pin: '2222' },
  });
  assert.equal(neighbour.status, 200);

  resetLoginGuard();
});

test('로그인에 성공하면 그동안의 실패 기록이 지워진다', async () => {
  const { resetLoginGuard, failureCount } = await import('../src/services/login-guard.js');
  resetLoginGuard();

  await signUp(server, { handle: '건망증', pin: '3333' });
  const call = server.client();
  for (let i = 0; i < 5; i++) {
    await call('/api/auth/login', { method: 'POST', body: { handle: '건망증', pin: '9999' } });
  }
  assert.equal(failureCount('건망증'), 5);

  const ok = await call('/api/auth/login', { method: 'POST', body: { handle: '건망증', pin: '3333' } });
  assert.equal(ok.status, 200);
  assert.equal(failureCount('건망증'), 0);

  resetLoginGuard();
});

test('운영 환경에서는 가짜 구글 주소를 무시한다', async () => {
  // 실수로 켜 둔 채 배포하면 아무나 로그인할 수 있게 되므로,
  // NODE_ENV=production 에서는 이 값이 아예 읽히지 않아야 한다.
  const source = (await import('node:fs')).readFileSync(
    new URL('../src/config.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /NODE_ENV === 'production' \? '' : process\.env\.GOOGLE_FAKE_BASE/,
    'config.js 가 운영에서 GOOGLE_FAKE_BASE 를 무시해야 합니다',
  );
});
