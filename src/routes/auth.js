import { Router } from 'express';
import crypto from 'node:crypto';
import {
  createUser,
  verifyCredentials,
  createSession,
  destroySession,
  createExternalUser,
  findIdentity,
  linkIdentity,
  touchIdentity,
  getUserById,
  suggestHandle,
} from '../services/users.js';
import {
  isConfigured as googleConfigured,
  createPkce,
  buildAuthUrl,
  exchangeCodeForProfile,
} from '../services/google-auth.js';
import {
  assertLoginAllowed,
  recordFailure,
  recordSuccess,
} from '../services/login-guard.js';
import { normalizeHandle } from '../services/users.js';
import {
  OAUTH_COOKIE,
  packState,
  unpackState,
  setOAuthCookie,
  clearOAuthCookie,
} from './oauth-state.js';
import { config } from '../config.js';
import {
  SESSION_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  asyncRoute,
  rateLimit,
} from './middleware.js';

export const authRouter = Router();

const loginLimit = rateLimit(config.authRateLimit);

authRouter.post(
  '/signup',
  loginLimit,
  asyncRoute((req, res) => {
    const { handle, displayName, pin } = req.body ?? {};
    const user = createUser({ handle, displayName, pin });
    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  loginLimit,
  asyncRoute((req, res) => {
    const { handle, pin } = req.body ?? {};
    const normalized = normalizeHandle(handle);

    assertLoginAllowed(normalized);
    let user;
    try {
      user = verifyCredentials({ handle, pin });
    } catch (err) {
      // "구글로 만든 계정"처럼 PIN 과 무관한 안내는 실패로 세지 않는다.
      if (err.code === 'bad_credentials') recordFailure(normalized);
      throw err;
    }
    recordSuccess(normalized);

    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.json({ user });
  }),
);

authRouter.post('/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/**
 * 이 서버가 켜 둔 로그인 수단.
 * 구글 자격증명이 없으면 화면에 구글 버튼을 띄우지 않는다 —
 * 눌러도 안 되는 버튼을 보여 주지 않기 위해서다.
 */
authRouter.get('/providers', (_req, res) => {
  res.json({
    password: true,
    google: googleConfigured(),
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── 구글 로그인 ─────────────────────────────────────────────

// start 는 주소를 만들어 넘겨보내는 것뿐이라 넉넉히 둔다.
// 콜백은 구글에 토큰 교환을 요청하므로 조금 더 조인다.
const googleStartLimit = rateLimit({ ...config.authRateLimit, key: (req) => `g-start:${req.ip}` });
const googleCallbackLimit = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  max: Math.max(20, Math.floor(config.authRateLimit.max / 2)),
  key: (req) => `g-cb:${req.ip}`,
});

/** 1단계 — 구글 동의 화면으로 보낸다. */
authRouter.get(
  '/google/start',
  googleStartLimit,
  asyncRoute((req, res) => {
    const state = crypto.randomBytes(24).toString('base64url');
    const { verifier, challenge } = createPkce();

    setOAuthCookie(res, packState({ state, verifier }));
    res.redirect(buildAuthUrl({ state, codeChallenge: challenge }));
  }),
);

/**
 * 2단계 — 구글이 돌려보낸 코드를 받는다.
 *
 * 브라우저가 주소창을 타고 들어오는 자리라 JSON 대신 화면으로 되돌려 보낸다.
 * 실패해도 이유를 주소에 남겨 로그인 화면이 알려 줄 수 있게 한다.
 */
authRouter.get(
  '/google/callback',
  googleCallbackLimit,
  asyncRoute(async (req, res) => {
    const back = (params) => res.redirect(`/?${new URLSearchParams(params)}`);
    const saved = unpackState(req.cookies?.[OAUTH_COOKIE]);
    clearOAuthCookie(res);

    if (req.query.error) {
      // 사용자가 동의 화면에서 취소한 경우가 대부분이다.
      return back({ auth_error: req.query.error === 'access_denied' ? 'cancelled' : 'google' });
    }
    if (!saved || !req.query.state || req.query.state !== saved.state) {
      return back({ auth_error: 'state' });
    }
    if (!req.query.code) return back({ auth_error: 'google' });

    let profile;
    try {
      profile = await exchangeCodeForProfile({
        code: String(req.query.code),
        codeVerifier: saved.verifier,
      });
    } catch (err) {
      console.error('[구글 로그인] 실패:', err.message);
      return back({ auth_error: err.code === 'google_email_unverified' ? 'unverified' : 'google' });
    }

    // 이미 연결된 계정이면 그대로 들어간다.
    const existing = findIdentity({ provider: 'google', providerUserId: profile.sub });
    let user;
    let isNew = false;

    if (existing) {
      user = getUserById(existing.userId);
      touchIdentity(existing.id);
    } else {
      // 이메일이 같다고 기존 계정에 자동으로 붙이지 않는다.
      // 남의 이메일을 선점해 계정을 가로채는 길이 되기 때문이다.
      // 연결은 로그인한 상태에서 본인이 직접 누를 때만 한다.
      const handle = suggestHandle(profile.email?.split('@')[0] || profile.name);
      user = createExternalUser({ handle, displayName: profile.name?.trim() || handle });
      linkIdentity({
        provider: 'google',
        providerUserId: profile.sub,
        userId: user.id,
        email: profile.email,
      });
      isNew = true;
    }

    if (!user) return back({ auth_error: 'google' });

    const { token, expiresAt } = createSession(user.id);
    setSessionCookie(res, token, expiresAt);
    res.redirect(isNew || !user.profileCompleted ? '/#welcome' : '/#today');
  }),
);
