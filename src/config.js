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

if (!process.env.SESSION_SECRET && !isTest) {
  console.warn(
    '[설정] SESSION_SECRET 이 없어 임시 키를 생성했습니다. 서버를 재시작하면 모든 로그인이 풀립니다.\n' +
      '       .env 에 SESSION_SECRET 을 지정하세요.',
  );
}
