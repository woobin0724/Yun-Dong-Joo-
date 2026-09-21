import { resolveSession, AppError } from '../services/users.js';

export const SESSION_COOKIE = 'ydj_session';

/** 의존성 없이 Cookie 헤더를 읽는다. */
export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function cookieMiddleware(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** 로그인했으면 req.user 를 채우고, 아니어도 통과시킨다. */
export function attachUser(req, _res, next) {
  req.user = resolveSession(req.cookies?.[SESSION_COOKIE]) || null;
  next();
}

/** 로그인이 반드시 필요한 경로. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(new AppError('로그인이 필요합니다.', 401, 'unauthorized'));
  next();
}

/** async 핸들러의 예외를 express 에러 처리로 넘긴다. */
export const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export function errorHandler(err, _req, res, _next) {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error('[오류]', err);
  res.status(status).json({
    error: {
      code: err.code || 'internal_error',
      message:
        status >= 500 ? '서버에서 문제가 생겼습니다. 잠시 뒤에 다시 시도해 주세요.' : err.message,
    },
  });
}

/**
 * 아주 단순한 요청 제한기 (메모리 기반).
 * 로그인·회원가입처럼 무차별 시도가 걱정되는 경로에만 건다.
 */
export function rateLimit({ windowMs = 60_000, max = 30, key = (req) => req.ip } = {}) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs).unref?.();

  return (req, _res, next) => {
    const id = key(req);
    const cutoff = Date.now() - windowMs;
    const times = (hits.get(id) || []).filter((t) => t > cutoff);
    if (times.length >= max) {
      return next(new AppError('요청이 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요.', 429, 'rate_limited'));
    }
    times.push(Date.now());
    hits.set(id, times);
    next();
  };
}
