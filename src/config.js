import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 의존성 없이 .env 를 읽는다 (있을 때만).
function loadDotEnv(file = '.env') {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) return;
  for (const raw of fs.readFileSync(full, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const isTestEnv = process.env.NODE_ENV === 'test';

// 테스트는 저장소에 있는 .env 에 영향을 받으면 안 된다.
// (로컬에서는 통과하는데 CI 에서만 깨지는 문제의 단골 원인)
if (!isTestEnv) loadDotEnv();

const bool = (v, fallback) =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const hours = (v, fallback) => {
  if (!v) return fallback;
  const parsed = String(v)
    .split(',')
    .map((h) => Number(h.trim()))
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  return parsed.length ? parsed : fallback;
};

const isTest = isTestEnv;

export const config = {
  isProduction: process.env.NODE_ENV === 'production',
  // 쿠키에 Secure 를 붙일지. 운영에서는 기본으로 붙인다(https 에서만 쿠키가 오간다).
  // https 없이 학교 내부망 주소(http://...)로 띄워야 할 때만 COOKIE_SECURE=false 로 끈다.
  // 끄면 같은 망의 다른 사람이 쿠키를 엿볼 수 있으니 시연·임시용으로만.
  cookieSecure:
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE !== 'false'
      : process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  timezone: process.env.APP_TIMEZONE || 'Asia/Seoul',
  dbPath: process.env.DB_PATH || (isTest ? ':memory:' : './data/app.db'),
  sessionSecret:
    process.env.SESSION_SECRET ||
    (isTest ? 'test-secret' : crypto.randomBytes(32).toString('hex')),
  sessionTtlDays: 60,
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
  /**
   * IP 기준 제한. 학교처럼 한 회선을 여럿이 쓰는 곳을 막지 않도록 느슨하게 둔다.
   * 무차별 대입에 대한 진짜 방어는 services/login-guard.js 의 계정별 실패 횟수다.
   */
  authRateLimit: {
    windowMs: 5 * 60_000,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || (isTest ? 100_000 : 120)),
  },
  // 초대 코드 무차별 대입 방지. 사람은 코드를 몇 번씩 잘못 치지 않는다.
  joinRateLimit: {
    windowMs: 10 * 60_000,
    max: Number(process.env.JOIN_RATE_LIMIT_MAX || (isTest ? 100_000 : 10)),
  },
  // 구글 로그인 (Phase 2 에서 연결). 값이 없으면 로그인 화면에 버튼이 뜨지 않는다.
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    // 개발용 가짜 구글 서버 주소. 운영에서는 무시한다 — 실수로 켜 두면
    // 아무나 로그인할 수 있게 되기 때문이다.
    fakeBase:
      process.env.NODE_ENV === 'production' ? '' : process.env.GOOGLE_FAKE_BASE || '',
  },
  missionPublishHour: Number(process.env.MISSION_PUBLISH_HOUR ?? 6),
  poemPushHours: hours(process.env.POEM_PUSH_HOURS, [8, 21]),
  enableScheduler: bool(process.env.ENABLE_SCHEDULER, !isTest),
  dailyMissionCount: 3,
};

// 운영에서는 세션 키가 없거나 약하면 아예 시작하지 않는다. 임시 키로 뜨면 서버가
// 재시작될 때마다(배포할 때마다) 모든 학생이 로그아웃되고, 예시 값을 그대로 쓰면
// 누구나 세션을 위조할 수 있다. 조용히 뜨는 것보다 시작하지 않는 것이 낫다.
const WEAK_SECRETS = new Set(['change-me-to-a-long-random-string', 'secret', 'changeme']);
if (config.isProduction) {
  const secret = process.env.SESSION_SECRET ?? '';
  // 24자 = base64 로 약 144비트. Render 의 generateValue 가 만드는 길이를 문서로
  // 확인하지 못해, 그보다 짧게 잡아 배포가 시작부터 막히는 일이 없게 했다.
  if (secret.length < 24 || WEAK_SECRETS.has(secret)) {
    console.error(
      '[설정] 운영 환경(NODE_ENV=production)인데 SESSION_SECRET 이 없거나 너무 짧습니다(24자 이상).\n' +
        '       예: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
        '       docs/배포-안내.md 를 보세요.',
    );
    process.exit(1);
  }
  // 상대 경로면 DB 가 앱 폴더 안에 생긴다. Render 같은 곳은 배포할 때마다 앱 폴더를
  // 새로 만들므로 그때마다 학생 기록이 사라진다. 막지는 않는다 — 학교 서버처럼 앱
  // 폴더가 그대로 남는 곳도 있다 — 대신 크게 말한다.
  if (!path.isAbsolute(config.dbPath)) {
    console.warn(
      `[설정] DB_PATH 가 상대 경로(${config.dbPath})입니다. 호스팅에 따라 배포할 때마다 기록이 사라질 수 있습니다.\n` +
        '       영구 디스크 안의 절대 경로로 지정하세요(예: /var/data/app.db). docs/배포-안내.md 참고.',
    );
  }
} else if (!process.env.SESSION_SECRET && !isTest) {
  console.warn(
    '[설정] SESSION_SECRET 이 없어 임시 키를 생성했습니다. 서버를 재시작하면 모든 로그인이 풀립니다.\n' +
      '       .env 에 SESSION_SECRET 을 지정하세요.',
  );
}
