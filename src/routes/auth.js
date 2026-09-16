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

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
