import crypto from 'node:crypto';
import { config } from '../config.js';
import { verifyRs256, assertClaims } from '../lib/jwt.js';
import { AppError } from './users.js';

/**
 * 구글 로그인 (OAuth 2.0 Authorization Code + PKCE).
 *
 * 패키지를 더 쓰지 않고 내장 fetch 와 node:crypto 로 처리한다.
 *
 * 받아 오는 범위는 `openid email profile` 뿐이다. 그 이상은 요청하지 않는다.
 * 이메일은 계정을 알아보는 데만 쓰고 화면·랭킹·채팅 어디에도 내보내지 않는다.
 */

/**
 * 구글 엔드포인트.
 *
 * GOOGLE_FAKE_BASE 가 있으면 그쪽을 본다 — 실제 자격증명 없이 흐름을 눌러 보기 위한
 * 개발용 장치다. 운영(NODE_ENV=production)에서는 config.js 가 이 값을 무시한다.
 */
const FAKE = config.google.fakeBase;
const AUTH_ENDPOINT = FAKE ? `${FAKE}/o/oauth2/v2/auth` : 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = FAKE ? `${FAKE}/token` : 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = FAKE ? `${FAKE}/certs` : 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SCOPE = 'openid email profile';

/**
 * 바깥으로 나가는 HTTP 호출 자리.
 * 테스트에서는 구글 서버 대신 가짜를 끼워 넣는다 (실제 구글을 부를 수 없으므로).
 */
let httpClient = (...args) => fetch(...args);
export function setHttpClient(fn) {
  httpClient = fn ?? ((...args) => fetch(...args));
}

export const isConfigured = () =>
  Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);

function assertConfigured() {
  if (!isConfigured()) {
    throw new AppError(
      '이 서버에는 구글 로그인이 설정되어 있지 않습니다.',
      503,
      'google_not_configured',
    );
  }
}

// ── PKCE ───────────────────────────────────────────────────

const base64url = (buf) => Buffer.from(buf).toString('base64url');

export function createPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * 구글 동의 화면으로 보낼 주소.
 *
 * state 로 CSRF 를, PKCE 로 authorization code 가로채기를 막는다.
 * 둘 다 서버가 만들어 쿠키에 서명해 두고 콜백에서 대조한다.
 */
export function buildAuthUrl({ state, codeChallenge }) {
  assertConfigured();
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online', // refresh token 이 필요 없다 — 로그인 한 번이면 끝이다
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

// ── 공개키 (JWKS) ─────────────────────────────────────────

let jwksCache = { keys: null, expiresAt: 0 };

/** 구글의 서명 공개키. Cache-Control 을 존중해 캐시한다. */
export async function fetchJwks({ force = false } = {}) {
  if (!force && jwksCache.keys && Date.now() < jwksCache.expiresAt) return jwksCache.keys;

  const res = await httpClient(JWKS_ENDPOINT);
  if (!res.ok) throw new AppError('구글 공개키를 받지 못했습니다.', 502, 'google_jwks_failed');

  const body = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers?.get?.('cache-control') || '')?.[1]);
  jwksCache = {
    keys: body,
    expiresAt: Date.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 3600) * 1000,
  };
  return body;
}

export function clearJwksCache() {
  jwksCache = { keys: null, expiresAt: 0 };
}

// ── 토큰 교환 ──────────────────────────────────────────────

/**
 * authorization code 를 토큰으로 바꾸고, id_token 을 검증해 사용자 정보를 돌려준다.
 *
 * @returns {{sub:string, email:string|null, emailVerified:boolean, name:string|null}}
 */
export async function exchangeCodeForProfile({ code, codeVerifier }) {
  assertConfigured();

  const res = await httpClient(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error_description || '';
    } catch {
      /* 본문을 못 읽어도 상태 코드만으로 충분하다 */
    }
    throw new AppError(
      `구글 로그인에 실패했습니다.${detail ? ` (${detail})` : ''}`,
      502,
      'google_token_failed',
    );
  }

  const { id_token: idToken } = await res.json();
  if (!idToken) throw new AppError('구글이 신원 토큰을 주지 않았습니다.', 502, 'google_no_id_token');

  return verifyProfile(idToken);
}

/** id_token 의 서명과 내용을 확인한다. kid 를 모르면 공개키를 한 번 다시 받아 본다. */
export async function verifyProfile(idToken) {
  let payload;
  try {
    payload = verifyRs256(idToken, await fetchJwks());
  } catch {
    // 구글이 키를 교체한 직후일 수 있다. 한 번만 강제로 다시 받아 본다.
    payload = verifyRs256(idToken, await fetchJwks({ force: true }));
  }

  assertClaims(payload, { issuers: ISSUERS, audience: config.google.clientId });

  if (payload.email && payload.email_verified === false) {
    throw new AppError(
      '구글에서 이메일 확인이 끝나지 않은 계정입니다.',
      403,
      'google_email_unverified',
    );
  }

  return {
    sub: String(payload.sub),
    email: payload.email ? String(payload.email) : null,
    emailVerified: payload.email_verified !== false,
    name: payload.name ? String(payload.name) : null,
  };
}
