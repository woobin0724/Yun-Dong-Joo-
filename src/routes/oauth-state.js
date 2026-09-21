import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * 구글에 다녀오는 동안 state 와 PKCE verifier 를 들고 있어야 한다.
 *
 * 서버에 표를 하나 더 만드는 대신 서명한 쿠키에 담는다.
 * 값은 10분이면 쓸모가 없어지고, 서명이 있어 사용자가 고칠 수 없다.
 * SameSite=Lax 라 구글에서 돌아오는 최상위 이동에는 쿠키가 따라온다.
 */

export const OAUTH_COOKIE = 'ydj_oauth';
const MAX_AGE_MS = 10 * 60 * 1000;

const sign = (value) =>
  crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');

export function packState(data) {
  const body = Buffer.from(JSON.stringify({ ...data, t: Date.now() })).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** 서명과 시간이 맞으면 내용을, 아니면 null 을 돌려준다. */
export function unpackState(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;

  const expected = sign(body);
  // 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다.
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data?.t || Date.now() - data.t > MAX_AGE_MS) return null;
  return data;
}

export function setOAuthCookie(res, value) {
  res.cookie(OAUTH_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: MAX_AGE_MS,
    path: '/api/auth',
  });
}

export function clearOAuthCookie(res) {
  res.clearCookie(OAUTH_COOKIE, { path: '/api/auth' });
}
