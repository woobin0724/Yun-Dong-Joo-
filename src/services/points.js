import { getDb, now } from '../db.js';
import { dayKey, weekStart, addDays } from '../lib/date.js';

/**
 * 점수 원장(ledger). 합계를 따로 들고 있지 않고 항상 원장에서 더해 쓴다.
 * 같은 일로 두 번 점수가 들어가는 일을 막으려고 (user, reason, ref) 에 유일 인덱스를 두었다.
 */

/**
 * 점수를 적립한다. 같은 ref 로 이미 적립됐으면 아무 일도 일어나지 않는다.
 * @returns {boolean} 실제로 적립되었는지
 */
export function award({ userId, roomId = null, amount, reason, ref = null, day = dayKey() }) {
  if (!amount) return false;
  const db = getDb();
  if (ref !== null) {
    const dup = db
      .prepare('SELECT 1 FROM points_ledger WHERE user_id = ? AND reason = ? AND ref = ?')
      .get(userId, reason, ref);
    if (dup) return false;
  }
  db.prepare(
    `INSERT INTO points_ledger (user_id, room_id, day, amount, reason, ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, roomId, day, amount, reason, ref, now());
  return true;
}

export function totalPoints(userId) {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM points_ledger WHERE user_id = ?')
    .get(userId);
  return Number(row.total);
}

export function pointsSince(userId, fromDay) {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM points_ledger WHERE user_id = ? AND day >= ?',
    )
    .get(userId, fromDay);
  return Number(row.total);
}

/**
 * 기간별 랭킹.
 * @param {object} opts
 * @param {number|null} opts.roomId 방을 지정하면 그 방 구성원만 센다. null 이면 전체.
 * @param {'week'|'month'|'all'} opts.period
 * @param {number} opts.limit
 */
export function leaderboard({ roomId = null, period = 'week', limit = 50, today = dayKey() } = {}) {
  const db = getDb();
  const from =
    period === 'all'
      ? '0000-01-01'
      : period === 'month'
        ? `${today.slice(0, 7)}-01`
        : weekStart(today);

  const rows = roomId
    ? db
        .prepare(
          `SELECT u.id, u.display_name, COALESCE(SUM(p.amount), 0) AS points
             FROM room_members rm
             JOIN users u ON u.id = rm.user_id
             LEFT JOIN points_ledger p ON p.user_id = u.id AND p.day >= ?
            WHERE rm.room_id = ?
            GROUP BY u.id
            ORDER BY points DESC, u.display_name ASC
            LIMIT ?`,
        )
        .all(from, roomId, limit)
    : db
        .prepare(
          `SELECT u.id, u.display_name, COALESCE(SUM(p.amount), 0) AS points
             FROM users u
             LEFT JOIN points_ledger p ON p.user_id = u.id AND p.day >= ?
            GROUP BY u.id
            HAVING points > 0
            ORDER BY points DESC, u.display_name ASC
            LIMIT ?`,
        )
        .all(from, limit);

  return withRanks(rows, from, period);
}

/** 동점자는 같은 순위를 받는다 (1, 2, 2, 4). */
function withRanks(rows, from, period) {
  let lastPoints = null;
  let lastRank = 0;
  return rows.map((row, index) => {
    const points = Number(row.points);
    const rank = points === lastPoints ? lastRank : index + 1;
    lastPoints = points;
    lastRank = rank;
    return {
      rank,
      userId: Number(row.id),
      displayName: row.display_name,
      points,
      period,
      from,
    };
  });
}

/** 랭킹에 안 들었더라도 본인 순위는 알려 준다. */
export function rankOf({ userId, roomId = null, period = 'week', today = dayKey() }) {
  const board = leaderboard({ roomId, period, limit: 10000, today });
  const mine = board.find((r) => r.userId === userId);
  return mine ? { ...mine, total: board.length } : { rank: null, points: 0, total: board.length };
}

/** 최근 n일의 일별 점수 — 잔디 그래프용. */
export function dailySeries(userId, days = 14, today = dayKey()) {
  const from = addDays(today, -(days - 1));
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(amount) AS points FROM points_ledger
        WHERE user_id = ? AND day >= ? GROUP BY day`,
    )
    .all(userId, from);
  const byDay = new Map(rows.map((r) => [r.day, Number(r.points)]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(from, i);
    out.push({ day, points: byDay.get(day) || 0 });
  }
  return out;
}
