#!/usr/bin/env node
/**
 * 구글 대신 답하는 가짜 서버. **개발·검증용이며 운영에서는 절대 쓰지 않습니다.**
 *
 *   node scripts/fake-google-server.js
 *
 * 실제 구글 자격증명 없이도 로그인 화면부터 이름 정하기까지의 흐름을
 * 브라우저로 직접 눌러 볼 수 있게 합니다. 서명은 진짜 RSA 키로 합니다 —
 * 그래야 검증 코드가 실제로 도는 것을 확인할 수 있습니다.
 *
 * 앱 서버는 이 주소를 바라보도록 GOOGLE_* 환경변수를 맞춰 띄워야 합니다.
 * scripts/dev-with-fake-google.sh 가 두 개를 한 번에 띄웁니다.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.FAKE_GOOGLE_PORT || 4100);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://127.0.0.1:3100';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake-kid', alg: 'RS256', use: 'sig' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const codes = new Map(); // code → 사용자 정보
let lastUser = null;     // "직전 계정으로 계속"에 쓴다

/**
 * 동의 화면에서 두 가지를 고를 수 있게 한다.
 *   새 계정  — 매번 다른 sub. "처음 들어온 사람" 경로를 확인할 때.
 *   직전 계정 — 같은 sub. "다시 온 사람" 경로를 확인할 때.
 * 이렇게 해야 DB 에 뭐가 남아 있든 검증 결과가 같다.
 */
function newUser() {
  const tag = crypto.randomUUID().slice(0, 8);
  return { sub: `fake-sub-${tag}`, email: `dongju.${tag}@example.com`, name: '윤동주' };
}

function idTokenFor(user) {
  const nowSec = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', kid: 'fake-kid' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: user.sub,
    email: user.email,
    email_verified: true,
    name: user.name,
    iat: nowSec,
    exp: nowSec + 3600,
  })}`;
  return `${input}.${crypto.sign('sha256', Buffer.from(input), privateKey).toString('base64url')}`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    // 동의 화면 — 진짜 구글처럼 생기지 않게, 개발용임이 드러나게 만듭니다.
    if (url.pathname === '/o/oauth2/v2/auth') {
      const redirect = url.searchParams.get('redirect_uri');
      const state = encodeURIComponent(url.searchParams.get('state'));
      const linkFor = (user) => {
        const code = crypto.randomUUID();
        codes.set(code, user);
        return `${redirect}?code=${code}&state=${state}`;
      };

      // "직전 계정" 링크는 이번 렌더링으로 새로 만든 사람이 아니라
      // 정말로 직전에 쓰인 사람을 가리켜야 한다. 그래서 먼저 붙잡아 둔다.
      const previous = lastUser;
      lastUser = newUser();
      const newLink = linkFor(lastUser);
      const returningLink = previous ? linkFor(previous) : null;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
        <link rel="icon" href="data:,"></head>
        <body style="font-family:system-ui,sans-serif;padding:40px;max-width:420px;margin:auto">
        <h1 style="font-size:20px">가짜 구글 동의 화면</h1>
        <p style="color:#666;line-height:1.7">개발·검증용입니다. <b>실제 구글이 아닙니다.</b><br>
        요청된 범위: <code>${url.searchParams.get('scope')}</code></p>
        <p><a id="new-user" href="${newLink}" style="display:inline-block;padding:12px 20px;background:#1a73e8;color:#fff;border-radius:8px;text-decoration:none">새 계정으로 계속</a></p>
        ${returningLink ? `<p><a id="returning-user" href="${returningLink}">직전 계정으로 계속</a></p>` : ''}
        <p><a id="cancel" href="${redirect}?error=access_denied">취소</a></p>
      </body></html>`);
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      const body = await new Promise((resolve) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => resolve(new URLSearchParams(raw)));
      });
      const user = codes.get(body.get('code'));
      res.writeHead(user ? 200 : 400, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify(
          user
            ? { id_token: idTokenFor(user), access_token: 'fake', token_type: 'Bearer' }
            : { error: 'invalid_grant', error_description: '모르는 코드' },
        ),
      );
    }

    if (url.pathname === '/certs') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' });
      return res.end(JSON.stringify({ keys: [jwk] }));
    }

    res.writeHead(404).end();
  })
  .listen(PORT, () => {
    console.log(`가짜 구글 서버: http://127.0.0.1:${PORT}  (앱: ${APP_ORIGIN})`);
    console.log('⚠  개발·검증 전용입니다. 운영에서는 쓰지 마세요.');
  });
