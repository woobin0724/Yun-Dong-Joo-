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

/**
 * 다른 출처에서 온 쓰기 요청을 막는다(CSRF).
 *
 * 세션 쿠키가 SameSite=Lax 라서 요즘 브라우저는 다른 사이트의 POST 에 쿠키를
 * 싣지 않는다. 이것은 그 위에 한 겹 더 두는 것이다 — SameSite 를 제대로 지키지
 * 않는 브라우저, 그리고 나중에 누가 쿠키 설정을 바꾸는 날을 위해.
 *
 * 규칙: 쓰기 요청(GET·HEAD·OPTIONS 가 아닌 것)에 Origin 이 있으면 이 서버의
 * 출처와 같아야 한다. Origin 이 없으면 Referer 를 본다. 둘 다 없으면 통과시킨다.
 * 브라우저는 다른 출처로 POST 할 때 Origin 을 반드시 붙이므로, 둘 다 없는 요청은
 * 브라우저가 아닌 곳(테스트, 명령줄)에서 온 것이고 그쪽은 애초에 남의 쿠키를
 * 훔쳐 쓸 수 없다.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sameOriginWrites(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const own = `${req.protocol}://${req.get('host')}`;
  const origin = req.get('origin');
  let from = origin;
  if (!from) {
    const referer = req.get('referer');
    if (referer) {
      try {
        from = new URL(referer).origin;
      } catch {
        from = 'invalid';
      }
    }
  }
  if (!from || from === own) return next();
  res.status(403).json({ error: '다른 사이트에서 보낸 요청은 받지 않습니다.' });
}
