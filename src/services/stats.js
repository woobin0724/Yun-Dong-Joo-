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

  // '한 날' 은 무엇이든 해서 점수가 붙은 날이다. 예전에는 오늘의 미션을 한 날만
  // 세서, 핵심 고리가 길로 바뀐 뒤 길만 걷는 학생의 연속이 영원히 0 이었다.
  for (const r of db
    .prepare('SELECT DISTINCT day FROM points_ledger WHERE user_id = ? AND amount > 0')
    .all(userId)) {
    daysWithWork.add(r.day);
  }
  const { streak, bestStreak, freezes, frozenDays } = computeStreakState(
    [...daysWithWork].sort(),
    today,
  );

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
    freezes,
    frozenDays,
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

/** 쉼표 — 하루를 쉬어도 연속이 끊기지 않게 해 주는 것. */
export const FREEZE_EVERY = 7; // 이레 연속마다 하나
export const FREEZE_MAX = 2; // 많이 쌓아 두면 연속이 의미를 잃는다

/**
 * 연속 달성일과 쉼표.
 *
 * 상태를 DB 에 쌓지 않고 '한 날' 목록만 보고 처음부터 다시 셈한다. 언제 다시
 * 계산해도 같은 답이 나와야 한다 — 읽을 때마다 쉼표를 깎는 식이면 화면을
 * 두 번 열었다고 쉼표가 두 개 사라질 수 있다.
 *
 *  - 연속이 이레가 될 때마다 쉼표 하나를 얻는다. 둘까지만 들고 있는다.
 *  - 빈 날이 k 일이면, 쉼표가 k 개 이상 있을 때 그만큼 쓰고 연속을 잇는다.
 *    빈 날은 연속 일수에 더하지 않는다(쉰 날을 한 날로 치지 않는다).
 *  - 오늘은 아직 끝나지 않았으므로 빈 날로 치지 않는다.
 */
export function computeStreakState(sortedDays, today = dayKey()) {
  const days = [...new Set(sortedDays)].sort();
  if (!days.length) return { streak: 0, bestStreak: 0, freezes: 0, frozenDays: [] };

  let run = 0;
  let best = 0;
  let held = 0;
  let frozen = [];

  const bridge = (from, missed) => {
    // from 다음 날부터 missed 일이 비었다.
    if (missed === 0) return true;
    if (held >= missed) {
      held -= missed;
      for (let i = 1; i <= missed; i++) frozen.push(addDays(from, i));
      return true;
    }
    return false;
  };

  for (let i = 0; i < days.length; i++) {
    if (i > 0) {
      const missed = daysBetween(days[i], days[i - 1]) - 1;
      if (!bridge(days[i - 1], missed)) {
        run = 0;
        held = 0; // 끊기면 들고 있던 쉼표도 함께 사라진다
        frozen = [];
      }
    }
    run += 1;
    best = Math.max(best, run);
    if (run % FREEZE_EVERY === 0) held = Math.min(FREEZE_MAX, held + 1);
  }

  // 마지막 한 날부터 오늘까지. 오늘은 빈 날이 아니다.
  const last = days.at(-1);
  const missedTail = Math.max(0, daysBetween(today, last) - 1);
  if (!bridge(last, missedTail)) return { streak: 0, bestStreak: best, freezes: 0, frozenDays: [] };

  return { streak: run, bestStreak: best, freezes: held, frozenDays: frozen };
}

/**
 * 연속 달성일. 예전 모양({streak, bestStreak})을 그대로 돌려준다.
 * 쉼표까지 필요하면 computeStreakState 를 쓴다.
 */
export function computeStreaks(sortedDays, today = dayKey()) {
  const { streak, bestStreak } = computeStreakState(sortedDays, today);
  return { streak, bestStreak };
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
