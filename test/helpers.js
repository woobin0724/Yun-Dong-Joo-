import './setup.js'; // 반드시 앱 코드보다 먼저 — 아래 import 들이 설정을 읽는다
import { createApp } from '../src/app.js';

/** 테스트용 서버를 띄우고, 쿠키를 기억하는 작은 클라이언트를 돌려준다. */
export async function startTestServer() {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const makeClient = () => {
    let cookie = '';
    return async function call(path, { method = 'GET', body } = {}) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const raw of setCookie) cookie = raw.split(';')[0];
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : {} };
    };
  };

  return {
    base,
    client: makeClient,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** 가입까지 끝난 클라이언트. */
export async function signUp(server, { handle, displayName = handle, pin = '1234' }) {
  const call = server.client();
  const res = await call('/api/auth/signup', {
    method: 'POST',
    body: { handle, displayName, pin },
  });
  if (res.status !== 201) throw new Error(`가입 실패: ${JSON.stringify(res.body)}`);
  return { call, user: res.body.user };
}
