import { getDb } from '../db.js';
import { dayKey, addDays, daysBetween } from '../lib/date.js';
import { totalPoints } from './points.js';

/**
 * 도전과제 판정과 프로필 화면에서 함께 쓰는 통계.
 * 한 번의 호출로 필요한 값을 모두 모아 온다.
 */
export function collectStats(userId, today = dayKey()) {
  const db = getDb();

  const completions = db
    .prepare(
      `SELECT day, kind, mission_key, submission, correct
         FROM mission_completions WHERE user_id = ? ORDER BY day ASC, id ASC`,
    )
    .all(userId);

  const byKind = {};
  const byTemplate = {};
  const daysWithWork = new Set();
  let longestSubmission = 0;

  for (const c of completions) {
    byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    byTemplate[c.mission_key] = (byTemplate[c.mission_key] || 0) + 1;
    daysWithWork.add(c.day);
    if (c.submission) longestSubmission = Math.max(longestSubmission, [...c.submission].length);
  }

  const { streak, bestStreak } = computeStreaks([...daysWithWork].sort(), today);

  const poemsRead = Number(
    db.prepare('SELECT COUNT(*) AS n FROM poem_reads WHERE user_id = ?').get(userId).n,
  );

  const quizRows = db
    .prepare('SELECT correct FROM quiz_attempts WHERE user_id = ? ORDER BY id ASC')
    .all(userId);
  let quizCorrect = 0;
  let quizStreak = 0;
  let bestQuizStreak = 0;
  for (const row of quizRows) {
    if (row.correct) {
      quizCorrect++;
      quizStreak++;
      bestQuizStreak = Math.max(bestQuizStreak, quizStreak);
    } else {
      quizStreak = 0;
    }
  }

  const sharedMessages = Number(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND kind IN ('chat', 'share')",
      )
      .get(userId).n,
  );

  const cheersGiven = Number(
    db.prepare('SELECT COUNT(*) AS n FROM cheers WHERE user_id = ?').get(userId).n,
  );
  const cheersReceived = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM cheers c
           JOIN messages m ON m.id = c.message_id
          WHERE m.user_id = ? AND c.user_id <> ?`,
      )
      .get(userId, userId).n,
  );

  const perfectDays = countPerfectDays(userId);

  return {
    missionsCompleted: completions.length,
    byKind,
    byTemplate,
    daysActive: daysWithWork.size,
    streak,
    bestStreak,
    perfectDays,
    poemsRead,
    quizAttempts: quizRows.length,
    quizCorrect,
    quizStreak,
    bestQuizStreak,
    longestSubmission,
    sharedMessages,
    cheersGiven,
    cheersReceived,
    totalPoints: totalPoints(userId),
  };
}

/**
 * 연속 달성일.
 * 오늘 아직 안 했더라도 어제까지 이어졌다면 연속은 살아 있는 것으로 본다
 * (오늘이 끝나기 전이니까).
 */
export function computeStreaks(sortedDays, today = dayKey()) {
  if (!sortedDays.length) return { streak: 0, bestStreak: 0 };

  let best = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    run = daysBetween(sortedDays[i], sortedDays[i - 1]) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const last = sortedDays.at(-1);
  const gap = daysBetween(today, last);
  const streak = gap === 0 || gap === 1 ? run : 0;
  return { streak, bestStreak: best };
}

/** 그날 나온 미션을 하나도 남기지 않은 날의 수. */
function countPerfectDays(userId) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT d.day
           FROM daily_missions d
           LEFT JOIN mission_completions c
             ON c.mission_id = d.id AND c.user_id = ?
          GROUP BY d.day
         HAVING COUNT(d.id) = COUNT(c.id)
       )`,
    )
    .get(userId);
  return Number(row.n);
}

export { addDays };
