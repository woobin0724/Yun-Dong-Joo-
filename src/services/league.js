import { getDb } from '../db.js';
import { dayKey, addDays, weekStart } from '../lib/date.js';

/**
 * 주간 리그 — 올라가기만 한다.
 *
 * 등급은 원고지의 단위로 짓는다. 한 줄 → 한 연 → 한 편 → 시집.
 * 한 주 동안 그 등급의 문턱만큼 걸으면 다음 주에 한 칸 올라간다.
 *
 * 내려가는 일은 없다. 강등이 있는 리그는 한 주를 쉬면 잃는 것이 생기고,
 * 시험 기간이나 아픈 주에 앱을 여는 일 자체가 벌이 된다. 이 앱이 쌓으려는
 * 것은 '다시 여는 이유' 이지 '열지 않으면 잃는 것' 이 아니다.
 *
 * 상태를 저장하지 않는다. 점수 원장에서 주마다 처음부터 다시 셈한다. 언제
 * 계산해도 같은 등급이 나와야 하고, 원장이 고쳐지면 등급도 따라 고쳐져야 한다.
 */

export const TIERS = [
  { id: 'line', name: '한 줄' },
  { id: 'stanza', name: '한 연' },
  { id: 'poem', name: '한 편' },
  { id: 'book', name: '시집' },
];

/**
 * 다음 등급으로 가는 한 주의 문턱(점수).
 * 마디 하나가 대략 70~85점이다. 한 줄 → 한 연은 '한 주에 두 번쯤 걷기'.
 */
export const THRESHOLDS = [100, 200, 300];

/**
 * 주별 점수 목록 → 지금 등급. 순수 함수.
 * @param {{week:string, points:number}[]} weeks 끝난 주만, 오래된 차례로
 */
export function tierFromWeeks(weeks) {
  let tier = 0;
  const promotions = [];
  for (const { week, points } of weeks) {
    if (tier < THRESHOLDS.length && points >= THRESHOLDS[tier]) {
      tier += 1;
      promotions.push({ week, to: TIERS[tier].id });
    }
  }
  return { tier, promotions };
}

/** 한 사람의 주별 점수. 이번 주는 따로 돌려준다(아직 끝나지 않았다). */
function weeklyPoints(userId, today) {
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(amount) AS pts FROM points_ledger
        WHERE user_id = ? GROUP BY day ORDER BY day`,
    )
    .all(userId);
  const thisWeek = weekStart(today);
  const byWeek = new Map();
  for (const r of rows) {
    const w = weekStart(r.day);
    byWeek.set(w, (byWeek.get(w) ?? 0) + Number(r.pts));
  }
  if (!rows.length) return { past: [], current: 0, thisWeek };

  // 빈 주도 목록에 넣는다. 쉰 주는 0점인 주다(그래도 내려가지는 않는다).
  const past = [];
  for (let w = weekStart(rows[0].day); w < thisWeek; w = addDays(w, 7)) {
    past.push({ week: w, points: byWeek.get(w) ?? 0 });
  }
  return { past, current: byWeek.get(thisWeek) ?? 0, thisWeek };
}

export function leagueOf(userId, today = dayKey()) {
  const { past, current, thisWeek } = weeklyPoints(userId, today);
  const { tier, promotions } = tierFromWeeks(past);
  const threshold = THRESHOLDS[tier] ?? null;
  return {
    tier: TIERS[tier],
    tierIndex: tier,
    top: tier === TIERS.length - 1,
    week: thisWeek,
    weekEnds: addDays(thisWeek, 6),
    points: current,
    threshold,
    remaining: threshold === null ? 0 : Math.max(0, threshold - current),
    // 이번 주에 이미 문턱을 넘었으면 다음 주에 올라간다.
    promotesNextWeek: threshold !== null && current >= threshold,
    next: TIERS[tier + 1] ?? null,
    promotions,
  };
}

/**
 * 같은 등급 사람들의 이번 주 점수.
 *
 * 비용: 점수가 있는 사람마다 등급을 다시 셈한다(사람 수 × 주 수). 한 학교·한
 * 반 규모에서는 문제가 없지만, 사용자가 수만 명이 되면 주가 끝날 때 등급을
 * 표에 적어 두는 쪽으로 바꿔야 한다.
 */
export function leagueTable(userId, today = dayKey(), limit = 30) {
  const me = leagueOf(userId, today);
  const db = getDb();
  const people = db
    .prepare(
      `SELECT DISTINCT u.id, u.display_name FROM users u
         JOIN points_ledger p ON p.user_id = u.id`,
    )
    .all();
  const rows = [];
  for (const p of people) {
    const l = p.id === userId ? me : leagueOf(p.id, today);
    if (l.tierIndex !== me.tierIndex) continue;
    rows.push({ userId: p.id, name: p.display_name, points: l.points, me: p.id === userId });
  }
  if (!rows.some((r) => r.me)) rows.push({ userId, name: null, points: me.points, me: true });
  rows.sort((a, b) => b.points - a.points || a.userId - b.userId);

  let rank = 0;
  let prev = null;
  rows.forEach((r, i) => {
    if (r.points !== prev) rank = i + 1;
    prev = r.points;
    r.rank = rank;
  });
  const mine = rows.find((r) => r.me);
  return {
    league: me,
    rows: rows.slice(0, limit).map(({ userId: id, ...rest }) => rest),
    myRank: mine.rank,
    size: rows.length,
  };
}
