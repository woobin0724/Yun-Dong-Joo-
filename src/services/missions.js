import { getDb, now, transaction } from '../db.js';
import { config } from '../config.js';
import { dayKey } from '../lib/date.js';
import { buildDailyMissions, poemOfTheDay } from '../content/missions.js';
import { POEM_BY_ID } from '../content/poems.js';
import { AppError } from './users.js';
import { award } from './points.js';

/**
 * 하루치 미션을 DB에 만들어 둔다.
 * 이미 만들어져 있으면 그대로 돌려준다 — 여러 번 불러도 안전하다.
 */
export function ensureDailyMissions(day = dayKey()) {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM daily_missions WHERE day = ? ORDER BY idx ASC')
    .all(day);
  if (existing.length) return existing.map(rowToMission);

  const poem = poemOfTheDay(day);
  const built = buildDailyMissions(day, poem, config.dailyMissionCount);

  return transaction((database) => {
    const insert = database.prepare(
      `INSERT OR IGNORE INTO daily_missions
         (day, idx, poem_id, mission_key, kind, title, prompt, points, share, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    built.forEach((m, idx) => {
      insert.run(
        day,
        idx,
        m.poemId,
        m.key,
        m.kind,
        m.title,
        m.prompt,
        m.points,
        m.share ? 1 : 0,
        JSON.stringify(m.data || {}),
        now(),
      );
    });
    return database
      .prepare('SELECT * FROM daily_missions WHERE day = ? ORDER BY idx ASC')
      .all(day)
      .map(rowToMission);
  });
}

/** 오늘의 시. */
export function todaysPoem(day = dayKey()) {
  const missions = ensureDailyMissions(day);
  return POEM_BY_ID.get(missions[0]?.poemId) || poemOfTheDay(day);
}

/** 사용자 시점의 오늘 미션 목록 (완료 여부 포함, 정답은 감춤). */
export function missionsForUser(userId, day = dayKey()) {
  const missions = ensureDailyMissions(day);
  const db = getDb();
  const done = new Map(
    db
      .prepare('SELECT * FROM mission_completions WHERE user_id = ? AND day = ?')
      .all(userId, day)
      .map((r) => [Number(r.mission_id), r]),
  );

  return missions.map((m) => {
    const completion = done.get(m.id);
    return {
      ...publicMission(m),
      completed: Boolean(completion),
      completion: completion
        ? {
            submission: completion.submission,
            correct: completion.correct === null ? null : Boolean(completion.correct),
            points: Number(completion.points),
            at: completion.created_at,
          }
        : null,
      // 이미 푼 퀴즈는 정답과 해설을 보여 준다.
      reveal:
        completion && m.kind === 'quiz'
          ? { answer: m.data.answer, explain: m.data.explain ?? null }
          : null,
    };
  });
}

export function getMission(missionId) {
  const row = getDb().prepare('SELECT * FROM daily_missions WHERE id = ?').get(missionId);
  return row ? rowToMission(row) : null;
}

/**
 * 미션을 제출한다.
 *
 * - check : 별도 입력 없이 완료 처리
 * - text  : 최소 글자 수를 넘겨야 완료
 * - quiz  : 고른 보기가 정답이어야 점수를 받고, 틀리면 다시 풀 수 있다
 *
 * @returns {{completion:object, alreadyDone:boolean, correct:boolean|null, earnedPoints:number}}
 */
export function submitMission({ userId, missionId, answer = null, text = null, day = dayKey() }) {
  const db = getDb();
  const mission = getMission(missionId);
  if (!mission) throw new AppError('그런 미션이 없습니다.', 404, 'mission_not_found');
  if (mission.day !== day) {
    throw new AppError('오늘 미션이 아닙니다.', 400, 'mission_not_today');
  }

  const existing = db
    .prepare('SELECT * FROM mission_completions WHERE user_id = ? AND mission_id = ?')
    .get(userId, missionId);
  if (existing) {
    return {
      alreadyDone: true,
      correct: existing.correct === null ? null : Boolean(existing.correct),
      earnedPoints: 0,
      submission: existing.submission,
      mission: publicMission(mission),
    };
  }

  let submission = null;
  let correct = null;

  if (mission.kind === 'text') {
    submission = String(text ?? '').trim();
    const min = Number(mission.data.minLength || 20);
    if ([...submission].length < min) {
      throw new AppError(`${min}자 이상 적어 주세요.`, 400, 'submission_too_short');
    }
  } else if (mission.kind === 'quiz') {
    // Number(null) 은 0 이므로, 고르지 않은 것과 첫 보기를 고른 것을 먼저 갈라 놓는다.
    const choice = answer === null || answer === undefined || answer === '' ? NaN : Number(answer);
    if (!Number.isInteger(choice) || choice < 0 || choice >= (mission.data.options?.length ?? 0)) {
      throw new AppError('보기를 하나 골라 주세요.', 400, 'invalid_choice');
    }
    correct = choice === Number(mission.data.answer);
    submission = String(choice);
    db.prepare(
      'INSERT INTO quiz_attempts (user_id, mission_id, correct, created_at) VALUES (?, ?, ?, ?)',
    ).run(userId, missionId, correct ? 1 : 0, now());

    if (!correct) {
      // 오답은 기록만 남기고 완료 처리하지 않는다 — 다시 풀 수 있다.
      return {
        alreadyDone: false,
        correct: false,
        earnedPoints: 0,
        submission,
        mission: publicMission(mission),
      };
    }
  }

  const points = mission.points;
  db.prepare(
    `INSERT INTO mission_completions
       (user_id, mission_id, day, mission_key, kind, submission, correct, points, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    missionId,
    day,
    mission.missionKey,
    mission.kind,
    submission,
    correct === null ? null : correct ? 1 : 0,
    points,
    now(),
  );

  award({
    userId,
    amount: points,
    reason: 'mission',
    ref: String(missionId),
    day,
  });

  markPoemRead(userId, mission.poemId);

  return {
    alreadyDone: false,
    correct,
    earnedPoints: points,
    submission,
    mission: publicMission(mission),
  };
}

/** 하루 미션을 전부 끝냈는지. */
export function isDayComplete(userId, day = dayKey()) {
  const missions = ensureDailyMissions(day);
  const done = Number(
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM mission_completions WHERE user_id = ? AND day = ?')
      .get(userId, day).n,
  );
  return missions.length > 0 && done >= missions.length;
}

/** 시를 펼쳐 본 기록. 도전과제 '읽기' 계열의 근거가 된다. */
export function markPoemRead(userId, poemId) {
  if (!POEM_BY_ID.has(poemId)) return;
  const stamp = now();
  getDb()
    .prepare(
      `INSERT INTO poem_reads (user_id, poem_id, read_count, first_read_at, last_read_at)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(user_id, poem_id)
       DO UPDATE SET read_count = read_count + 1, last_read_at = excluded.last_read_at`,
    )
    .run(userId, poemId, stamp, stamp);
}

export function poemReadIds(userId) {
  return getDb()
    .prepare('SELECT poem_id FROM poem_reads WHERE user_id = ?')
    .all(userId)
    .map((r) => r.poem_id);
}

function rowToMission(row) {
  let data = {};
  try {
    data = JSON.parse(row.data || '{}');
  } catch {
    data = {};
  }
  return {
    id: Number(row.id),
    day: row.day,
    idx: Number(row.idx),
    poemId: row.poem_id,
    missionKey: row.mission_key,
    kind: row.kind,
    title: row.title,
    prompt: row.prompt,
    points: Number(row.points),
    share: Boolean(row.share),
    data,
  };
}

/** 클라이언트로 내보낼 때 정답은 지운다. */
function publicMission(mission) {
  const { answer, explain, ...safeData } = mission.data;
  return { ...mission, data: safeData };
}

export { publicMission };
