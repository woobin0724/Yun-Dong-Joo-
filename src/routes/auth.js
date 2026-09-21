import { Router } from 'express';
import {
  createUser,
  verifyCredentials,
  createSession,
  destroySession,
} from '../services/users.js';
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
    const user = verifyCredentials({ handle, pin });
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
    google: Boolean(config.google?.clientId && config.google?.clientSecret),
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
