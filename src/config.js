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

loadDotEnv();

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

const isTest = process.env.NODE_ENV === 'test';

export const config = {
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
  // 로그인·가입 무차별 시도 제한. 테스트에서는 사실상 끈다.
  authRateLimit: {
    windowMs: 5 * 60_000,
    max: Number(process.env.AUTH_RATE_LIMIT_MAX || (isTest ? 100_000 : 20)),
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
