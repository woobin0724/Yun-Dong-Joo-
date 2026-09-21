import webpush from 'web-push';
import { getDb, now } from '../db.js';
import { config } from '../config.js';
import { localParts } from '../lib/date.js';
import { AppError } from './users.js';

let configured = false;

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  configured = true;
} else {
  console.warn(
    '[웹푸시] VAPID 키가 없어 푸시 알림이 꺼진 상태로 시작합니다.\n' +
      '         `npm run keys` 로 키를 만들어 .env 에 넣으면 켜집니다. (앱의 다른 기능은 그대로 동작합니다)',
  );
}

export const isPushConfigured = () => configured;
export const publicKey = () => config.vapid.publicKey;

export function saveSubscription(userId, subscription) {
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    throw new AppError('구독 정보가 올바르지 않습니다.', 400, 'invalid_subscription');
  }
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE
         SET user_id = excluded.user_id,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             failures = 0`,
    )
    .run(userId, endpoint, p256dh, auth, now());
  return { ok: true };
}

export function removeSubscription(endpoint) {
  getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function getPrefs(userId) {
  const db = getDb();
  let row = db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO notification_prefs (user_id) VALUES (?)').run(userId);
    row = db.prepare('SELECT * FROM notification_prefs WHERE user_id = ?').get(userId);
  }
  return {
    poemPush: Boolean(row.poem_push),
    missionPush: Boolean(row.mission_push),
    challengePush: Boolean(row.challenge_push),
    quietStart: row.quiet_start === null ? null : Number(row.quiet_start),
    quietEnd: row.quiet_end === null ? null : Number(row.quiet_end),
  };
}

export function updatePrefs(userId, patch) {
  const current = getPrefs(userId);
  const next = { ...current, ...patch };
  const hour = (v) => (v === null || v === undefined || v === '' ? null : Number(v) % 24);
  getDb()
    .prepare(
      `UPDATE notification_prefs
          SET poem_push = ?, mission_push = ?, challenge_push = ?, quiet_start = ?, quiet_end = ?
        WHERE user_id = ?`,
    )
    .run(
      next.poemPush ? 1 : 0,
      next.missionPush ? 1 : 0,
      next.challengePush ? 1 : 0,
      hour(next.quietStart),
      hour(next.quietEnd),
      userId,
    );
  return getPrefs(userId);
}

/**
 * 방해 금지 시간대인지. 22시~7시처럼 자정을 넘는 구간도 다룬다.
 */
export function inQuietHours(prefs, at = new Date()) {
  if (prefs.quietStart === null || prefs.quietEnd === null) return false;
  const { hour } = localParts(at);
  const { quietStart: start, quietEnd: end } = prefs;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * 한 사용자의 모든 기기로 알림을 보낸다.
 *
 * @param {object} opts
 * @param {string} opts.dedupeKey 같은 키로는 두 번 보내지 않는다 (스케줄러 중복 실행 방지)
 * @param {'poem'|'mission'|'challenge'|'other'} opts.category 사용자 설정과 대조할 갈래
 */
export async function sendToUser(userId, payload, { dedupeKey = null, category = 'other' } = {}) {
  if (!configured) return { sent: 0, skipped: 'not_configured' };

  const prefs = getPrefs(userId);
  const allowed = {
    poem: prefs.poemPush,
    mission: prefs.missionPush,
    challenge: prefs.challengePush,
    other: true,
  }[category];
  if (!allowed) return { sent: 0, skipped: 'muted' };
  if (inQuietHours(prefs)) return { sent: 0, skipped: 'quiet_hours' };

  const db = getDb();
  if (dedupeKey) {
    const info = db
      .prepare('INSERT OR IGNORE INTO push_log (dedupe_key, created_at) VALUES (?, ?)')
      .run(dedupeKey, now());
    if (!info.changes) return { sent: 0, skipped: 'duplicate' };
  }

  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (!subs.length) return { sent: 0, skipped: 'no_subscription' };

  const body = JSON.stringify(payload);
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 12 },
        );
        sent++;
        db.prepare('UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE id = ?').run(
          now(),
          sub.id,
        );
      } catch (err) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          // 브라우저가 구독을 버린 경우 — 정리한다.
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        } else {
          db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(
            sub.id,
          );
          console.warn(`[웹푸시] 발송 실패 (id=${sub.id}, status=${status}):`, err?.message);
        }
      }
    }),
  );

  return { sent };
}

/** 여러 사용자에게. 실패한 한 명 때문에 전체가 멈추지 않게 한다. */
export async function sendToUsers(userIds, payloadFor, options = {}) {
  const results = await Promise.allSettled(
    userIds.map((id) =>
      sendToUser(id, typeof payloadFor === 'function' ? payloadFor(id) : payloadFor, {
        ...options,
        dedupeKey: options.dedupeKey ? `${options.dedupeKey}:${id}` : null,
      }),
    ),
  );
  return {
    ok: results.filter((r) => r.status === 'fulfilled' && r.value.sent > 0).length,
    total: userIds.length,
  };
}

export function subscriptionCount(userId) {
  return Number(
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?')
      .get(userId).n,
  );
}
