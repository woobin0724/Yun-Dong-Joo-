import { getDb, now } from '../db.js';
import { CHALLENGES, CHALLENGE_BY_ID, newlyEarned } from '../content/challenges.js';
import { collectStats } from './stats.js';
import { award } from './points.js';
import { dayKey } from '../lib/date.js';

export function earnedIds(userId) {
  return getDb()
    .prepare('SELECT challenge_id FROM user_challenges WHERE user_id = ?')
    .all(userId)
    .map((r) => r.challenge_id);
}

/**
 * 지금까지의 기록으로 새로 달성된 과제를 확정한다.
 * 이미 받은 과제는 다시 달성되지 않고, 보상 점수도 한 번만 들어간다.
 *
 * @returns {Array<{id:string,title:string,description:string,icon:string,reward:number}>}
 */
export function evaluateChallenges(userId, { day = dayKey(), stats = null } = {}) {
  const db = getDb();
  const currentStats = stats ?? collectStats(userId, day);
  const earned = newlyEarned(currentStats, earnedIds(userId));
  if (!earned.length) return [];

  const insert = db.prepare(
    'INSERT OR IGNORE INTO user_challenges (user_id, challenge_id, earned_at) VALUES (?, ?, ?)',
  );

  const confirmed = [];
  for (const challenge of earned) {
    const info = insert.run(userId, challenge.id, now());
    if (!info.changes) continue; // 다른 요청이 먼저 넣었다면 건너뛴다
    award({
      userId,
      amount: challenge.reward,
      reason: 'challenge',
      ref: challenge.id,
      day,
    });
    confirmed.push(publicChallenge(challenge));
  }
  return confirmed;
}

/** 진행 상황을 곁들인 전체 과제 목록. */
export function challengeBoard(userId, { day = dayKey() } = {}) {
  const stats = collectStats(userId, day);
  const owned = new Map(
    getDb()
      .prepare('SELECT challenge_id, earned_at FROM user_challenges WHERE user_id = ?')
      .all(userId)
      .map((r) => [r.challenge_id, r.earned_at]),
  );

  const items = CHALLENGES.map((c) => ({
    ...publicChallenge(c),
    earned: owned.has(c.id),
    earnedAt: owned.get(c.id) ?? null,
    progress: progressFor(c, stats),
  }));

  return {
    stats,
    earnedCount: owned.size,
    total: CHALLENGES.length,
    groups: groupBy(items, (i) => i.group),
    items,
  };
}

/**
 * 진행률 표시용 근삿값.
 * 과제 정의에 목표치를 따로 적어 두지 않았으므로, 조건이 참이 될 때까지
 * 값을 올려 보며 필요한 목표치를 찾아낸다. 과제 수가 적어 비용은 무시할 만하다.
 */
function progressFor(challenge, stats) {
  if (challenge.check(stats)) return { current: 1, target: 1, ratio: 1 };

  const field = detectField(challenge);
  if (!field) return { current: 0, target: 1, ratio: 0 };

  const current = Number(field.read(stats) || 0);
  const target = field.target;
  if (!target) return { current, target: null, ratio: 0 };
  return { current, target, ratio: Math.min(current / target, 0.999) };
}

/** 과제가 어떤 수치를 보는지 찾아낸다 — 각 후보를 크게 올려 보고 반응하는 것을 고른다. */
function detectField(challenge) {
  const probes = [
    { key: 'missionsCompleted', read: (s) => s.missionsCompleted, set: (s, v) => ({ ...s, missionsCompleted: v }) },
    { key: 'bestStreak', read: (s) => s.bestStreak, set: (s, v) => ({ ...s, bestStreak: v }) },
    { key: 'perfectDays', read: (s) => s.perfectDays, set: (s, v) => ({ ...s, perfectDays: v }) },
    { key: 'poemsRead', read: (s) => s.poemsRead, set: (s, v) => ({ ...s, poemsRead: v }) },
    { key: 'quizCorrect', read: (s) => s.quizCorrect, set: (s, v) => ({ ...s, quizCorrect: v }) },
    { key: 'bestQuizStreak', read: (s) => s.bestQuizStreak, set: (s, v) => ({ ...s, bestQuizStreak: v }) },
    { key: 'longestSubmission', read: (s) => s.longestSubmission, set: (s, v) => ({ ...s, longestSubmission: v }) },
    { key: 'sharedMessages', read: (s) => s.sharedMessages, set: (s, v) => ({ ...s, sharedMessages: v }) },
    { key: 'cheersGiven', read: (s) => s.cheersGiven, set: (s, v) => ({ ...s, cheersGiven: v }) },
    { key: 'cheersReceived', read: (s) => s.cheersReceived, set: (s, v) => ({ ...s, cheersReceived: v }) },
    { key: 'totalPoints', read: (s) => s.totalPoints, set: (s, v) => ({ ...s, totalPoints: v }) },
    { key: 'checkKind', read: (s) => s.byKind.check || 0, set: (s, v) => ({ ...s, byKind: { ...s.byKind, check: v } }) },
    { key: 'textKind', read: (s) => s.byKind.text || 0, set: (s, v) => ({ ...s, byKind: { ...s.byKind, text: v } }) },
    { key: 'copyTemplate', read: (s) => s.byTemplate.copy || 0, set: (s, v) => ({ ...s, byTemplate: { ...s.byTemplate, copy: v } }) },
    { key: 'createTemplate', read: (s) => s.byTemplate.create || 0, set: (s, v) => ({ ...s, byTemplate: { ...s.byTemplate, create: v } }) },
  ];

  const blank = {
    missionsCompleted: 0,
    byKind: {},
    byTemplate: {},
    daysActive: 0,
    streak: 0,
    bestStreak: 0,
    perfectDays: 0,
    poemsRead: 0,
    quizAttempts: 0,
    quizCorrect: 0,
    quizStreak: 0,
    bestQuizStreak: 0,
    longestSubmission: 0,
    sharedMessages: 0,
    cheersGiven: 0,
    cheersReceived: 0,
    totalPoints: 0,
  };

  for (const probe of probes) {
    if (!challenge.check(probe.set(blank, 100000))) continue;
    // 이분 탐색으로 최소 목표치를 찾는다.
    let low = 1;
    let high = 100000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (challenge.check(probe.set(blank, mid))) high = mid;
      else low = mid + 1;
    }
    return { ...probe, target: low };
  }
  return null;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map].map(([name, entries]) => ({ name, items: entries }));
}

function publicChallenge(c) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    icon: c.icon,
    reward: c.reward,
    group: c.group,
  };
}

export { CHALLENGE_BY_ID, publicChallenge };
