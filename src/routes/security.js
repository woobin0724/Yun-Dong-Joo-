import { config } from '../config.js';

/**
 * 보안 헤더.
 *
 * 패키지를 더 쓰지 않고 필요한 것만 직접 붙인다.
 * 가장 중요한 건 script-src 'self' — 외부 스크립트도, 인라인 스크립트도 실행되지 않는다.
 * style-src 에만 'unsafe-inline' 을 둔 이유는 진행률 막대처럼 계산된 값을
 * style 속성으로 넣는 곳이 있기 때문이다. 스타일 주입은 스크립트 주입과 위험도가 다르다.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}
