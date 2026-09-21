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
        // 리다이렉트를 따라가지 않아야 Location 을 확인할 수 있다 (구글 로그인 흐름).
        redirect: 'manual',
      });

      // 쿠키는 클라이언트가 계속 들고 다닌다. 지우라는 응답이면 지운다.
      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const [name, value] = pair.split('=');
        const jar = new Map(
          cookie ? cookie.split('; ').map((c) => c.split('=').map((x, i) => (i ? c.slice(c.indexOf('=') + 1) : x))) : [],
        );
        if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
        else jar.set(name, value);
        cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      }

      const text = await res.text();
      let parsed = {};
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text }; // 리다이렉트나 HTML 응답
        }
      }
      return {
        status: res.status,
        body: parsed,
        headers: Object.fromEntries(res.headers),
      };
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
