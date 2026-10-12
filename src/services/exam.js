import { getDb, now, transaction } from '../db.js';
import { dayKey } from '../lib/date.js';
import { makeRng, shuffled } from '../lib/rng.js';
import { POEMS } from '../content/poems.js';
import { NODES } from '../content/journey.js';
import { award } from './points.js';
import { buildCloze, buildOrder, buildDiction, buildRepeat, grade } from './lessons.js';

/**
 * 시험 대비 — 오답 노트와 짧은 시험.
 *
 * 무엇을 묻는가
 *   시 본문에서 셈으로 확인되는 것만 묻는다: 빈칸, 행 순서, 이 시에 없는 말,
 *   가장 여러 번 되풀이되는 말. "화자의 태도는?" 처럼 해석에 정답을 매기는
 *   문항은 만들지 않는다. 그런 문항은 출처가 있어야 하는데 지금은 확인할
 *   길이 없다(지시서 §6). 확인 못 한 해석을 정답으로 가르칠 수는 없다.
 *
 * 어디서 묻는가
 *   **걸어 본 시에서만.** 아직 읽지 않은 시로 시험을 보면 그건 복습이 아니라
 *   찍기다.
 *
 * 차례
 *   오답 노트에서 아직 못 푼 것부터 넣고, 남은 자리를 새 문제로 채운다.
 *   오답 문제를 맞히면 노트에서 지워진다(resolved). 다시 틀리면 남는다.
 */

export const EXAM_SIZE = 8;
export const MAX_FROM_MISTAKES = 4;
export const EXAM_POINTS = 5;

const BUILDERS = [buildCloze, buildOrder, buildDiction, buildRepeat];

/** 틀린 걸음을 노트에 적는다. 같은 자리면 다시 열어 둔다. */
export function recordMistake(db, { userId, poemId, origin, step }) {
  db.prepare(
    `INSERT INTO mistakes (user_id, poem_id, origin, step, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, origin) DO UPDATE SET resolved_at = NULL, step = excluded.step`,
  ).run(userId, poemId, origin, JSON.stringify(step), now());
}

function walkedPoemIds(userId) {
  const done = getDb()
    .prepare('SELECT node_id FROM node_progress WHERE user_id = ? AND done_at IS NOT NULL')
    .all(userId)
    .map((r) => r.node_id);
  const ids = new Set(done.map((id) => NODES.find((n) => n.id === id)?.poemId).filter(Boolean));
  return [...ids];
}

export function examSummary(userId) {
  const db = getDb();
  const open = db
    .prepare('SELECT COUNT(*) AS n FROM mistakes WHERE user_id = ? AND resolved_at IS NULL')
    .get(userId).n;
  const resolved = db
    .prepare('SELECT COUNT(*) AS n FROM mistakes WHERE user_id = ? AND resolved_at IS NOT NULL')
    .get(userId).n;
  const walked = walkedPoemIds(userId);
  return {
    openMistakes: Number(open),
    resolvedMistakes: Number(resolved),
    walkedPoems: walked.length,
    // 걸어 본 시가 없으면 시험을 볼 수 없다. 화면이 그 이유를 말해야 한다.
    ready: walked.length > 0,
  };
}

/** 답을 떼어 내고 브라우저로 보낼 모양으로. */
const publicItem = ({ step, poemId, mistakeId }, index) => {
  const { answer, counts, ...rest } = step;
  return {
    index,
    poemId,
    title: POEMS.find((p) => p.id === poemId)?.title ?? poemId,
    fromMistakes: Boolean(mistakeId),
    ...rest,
  };
};

/** 문제가 '무엇을 묻는지' 로 만든 열쇠. 보기 순서와 상관없다. */
export function examKey(poemId, step) {
  const subject =
    step.type === 'cloze'
      ? step.line
      : step.type === 'order'
        ? [...step.lines].sort().join('|')
        : step.type === 'repeat'
          ? '' // 한 시에서 '가장 많이 나오는 말' 은 하나뿐이다
          : step.options[step.answer];
  return `${poemId}:${step.type}:${subject}`;
}

export function startExam(userId) {
  const walked = walkedPoemIds(userId);
  if (!walked.length) return { error: 'nothing-walked' };

  const db = getDb();
  const items = [];

  const open = db
    .prepare(
      `SELECT id, poem_id, step FROM mistakes
        WHERE user_id = ? AND resolved_at IS NULL ORDER BY created_at LIMIT ?`,
    )
    .all(userId, MAX_FROM_MISTAKES);
  for (const m of open) {
    const step = JSON.parse(m.step);
    items.push({ step, poemId: m.poem_id, mistakeId: m.id, key: examKey(m.poem_id, step) });
  }

  // 새 문제. 시험마다 시드가 달라야 같은 시험이 되풀이되지 않는다.
  const nth = db.prepare('SELECT COUNT(*) AS n FROM exam_sessions WHERE user_id = ?').get(userId).n;
  const rng = makeRng(`exam:${userId}:${nth}`);
  const poems = walked.map((id) => POEMS.find((p) => p.id === id)).filter(Boolean);

  let guard = 0;
  while (items.length < EXAM_SIZE && guard++ < EXAM_SIZE * 12) {
    const poem = poems[Math.floor(rng() * poems.length)];
    const build = BUILDERS[Math.floor(rng() * BUILDERS.length)];
    const step = build(rng, poem);
    if (!step) continue;
    // 같은 시험 안에 같은 문제가 두 번 나오지 않게. 보기 순서만 다른 것도
    // 같은 문제다 — 처음에는 보기 배열로 비교해서 「새로운 길」의 되풀이 문항이
    // 한 시험에 두 번 나왔다. 무엇을 묻는지(정답)로 가린다.
    const key = examKey(poem.id, step);
    if (items.some((it) => it.key === key)) continue;
    items.push({ step, poemId: poem.id, key });
  }

  const ordered = shuffled(rng, items).map(({ key, ...rest }) => rest);
  const info = db
    .prepare('INSERT INTO exam_sessions (user_id, items, created_at) VALUES (?, ?, ?)')
    .run(userId, JSON.stringify(ordered), now());

  return {
    examId: Number(info.lastInsertRowid),
    items: ordered.map(publicItem),
    fromMistakes: ordered.filter((i) => i.mistakeId).length,
  };
}

function loadExam(userId, examId) {
  const row = getDb()
    .prepare('SELECT id, items, finished_at FROM exam_sessions WHERE id = ? AND user_id = ?')
    .get(examId, userId);
  return row ? { ...row, items: JSON.parse(row.items) } : null;
}

export function answerExam(userId, examId, index, submission) {
  const exam = loadExam(userId, examId);
  if (!exam) return { error: 'not-found' };
  const item = exam.items[index];
  if (!item) return { error: 'no-item' };

  const result = grade(item.step, submission);
  if (!result.ok) return { ok: false, message: result.message };

  return transaction((db) => {
    // 한 문항은 한 번만 채점한다. 답을 본 뒤 다시 내서 맞히는 길을 막는다.
    const prior = db
      .prepare('SELECT correct FROM exam_answers WHERE exam_id = ? AND idx = ?')
      .get(examId, index);
    if (prior) {
      return { ok: true, already: true, correct: Boolean(prior.correct), points: 0, reveal: result.reveal };
    }
    db.prepare('INSERT INTO exam_answers (exam_id, idx, correct) VALUES (?, ?, ?)').run(
      examId,
      index,
      result.correct ? 1 : 0,
    );

    let points = 0;
    if (result.correct) {
      if (award({ userId, amount: EXAM_POINTS, reason: 'exam', ref: `${examId}:${index}`, day: dayKey() })) {
        points = EXAM_POINTS;
      }
      if (item.mistakeId) {
        db.prepare('UPDATE mistakes SET resolved_at = ? WHERE id = ? AND user_id = ?').run(
          now(),
          item.mistakeId,
          userId,
        );
      }
    } else if (!item.mistakeId) {
      recordMistake(db, {
        userId,
        poemId: item.poemId,
        origin: `exam:${examId}:${index}`,
        step: item.step,
      });
    }

    const answered = db.prepare('SELECT COUNT(*) AS n, SUM(correct) AS c FROM exam_answers WHERE exam_id = ?').get(examId);
    const finished = Number(answered.n) >= exam.items.length;
    if (finished && !exam.finished_at) {
      db.prepare('UPDATE exam_sessions SET finished_at = ? WHERE id = ?').run(now(), examId);
    }
    return {
      ok: true,
      correct: result.correct,
      points,
      reveal: result.reveal,
      message: result.message,
      resolvedMistake: Boolean(result.correct && item.mistakeId),
      finished,
      score: { correct: Number(answered.c ?? 0), total: exam.items.length },
    };
  });
}
