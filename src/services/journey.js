import { getDb, now, transaction } from '../db.js';
import { dayKey } from '../lib/date.js';
import { award } from './points.js';
import {
  CHAPTERS,
  CHAPTER_NOTE,
  NODES,
  findChapter,
  findNode,
  nodesOfChapter,
} from '../content/journey.js';
import { buildLesson, grade, toClient } from './lessons.js';
import { recordMistake } from './exam.js';

/**
 * 「동주의 길」 — 지도와 걸음.
 *
 * 이 파일이 지키는 규칙 하나: **확인하지 못한 사실은 나가지 않는다.**
 * publicChapter() 가 유일한 출구이고, verified 가 아니면 years 와 story 를
 * null 로 만든 뒤에야 내보낸다. 지시서 §6 이고, 테스트로 묶여 있다
 * (test/journey.test.js 의 '확인되지 않은 사실은 응답에 실리지 않는다').
 */

/** 사실을 걸러 내보낸다. 장 바깥으로 나가는 유일한 문. */
export function publicChapter(chapter) {
  const verified = chapter.verified === true;
  return {
    id: chapter.id,
    ord: chapter.ord,
    place: chapter.place,
    hint: chapter.hint,
    // 아래 둘은 사실이다. 확인 전에는 내용 대신 null 과 이유만 나간다.
    years: verified ? chapter.years : null,
    story: verified ? chapter.story : null,
    factVerified: verified,
    source: verified
      ? { name: chapter.source_name, url: chapter.source_url, lastChecked: chapter.last_checked }
      : null,
  };
}

/** 확인되지 않은 사실이 몇 건인지. 관리 화면에 그대로 띄운다. */
export function unverifiedFactCount() {
  return CHAPTERS.filter((c) => c.verified !== true).length;
}

function progressMap(userId) {
  const rows = getDb()
    .prepare('SELECT node_id, steps_done, score, done_at FROM node_progress WHERE user_id = ?')
    .all(userId);
  return new Map(rows.map((r) => [r.node_id, r]));
}

/**
 * 지도. 장과 마디, 그리고 내가 어디까지 왔는지.
 *
 * 잠금 규칙은 하나뿐이다 — **앞 마디를 끝내야 다음 마디가 열린다.**
 * 장 사이에는 잠금을 두지 않는다. 읽을 시가 없는 장(명동촌·용정·평양·
 * 후쿠오카)이 중간에 끼어 있어서, 장을 잠그면 그 장에서 길이 끊긴다.
 */
export function mapFor(userId) {
  const done = progressMap(userId);
  const ordered = NODES;

  let firstUnfinished = null;
  const nodeStates = ordered.map((node, i) => {
    const p = done.get(node.id);
    const finished = Boolean(p?.done_at);
    // 첫 마디는 늘 열려 있고, 그다음부터는 앞 마디를 끝냈을 때 열린다.
    const prev = i === 0 ? null : ordered[i - 1];
    const open = i === 0 || Boolean(done.get(prev.id)?.done_at);
    if (!finished && open && firstUnfinished === null) firstUnfinished = node.id;
    return {
      id: node.id,
      chapterId: node.chapterId,
      ord: node.ord,
      title: node.title,
      poemId: node.poemId,
      state: finished ? 'done' : open ? 'open' : 'locked',
      score: p?.score ?? 0,
      stepsDone: p?.steps_done ?? 0,
    };
  });

  const byChapter = new Map();
  for (const s of nodeStates) {
    if (!byChapter.has(s.chapterId)) byChapter.set(s.chapterId, []);
    byChapter.get(s.chapterId).push(s);
  }

  const chapters = CHAPTERS.map((c) => {
    const mine = byChapter.get(c.id) ?? [];
    return {
      ...publicChapter(c),
      nodes: mine,
      total: mine.length,
      doneCount: mine.filter((n) => n.state === 'done').length,
      // 읽을 시가 없는 장. 비어 있는 것이 사실이므로 그대로 말한다.
      empty: mine.length === 0,
    };
  });

  const totalDone = nodeStates.filter((n) => n.state === 'done').length;

  return {
    chapters,
    chapterNote: CHAPTER_NOTE,
    next: firstUnfinished,
    total: nodeStates.length,
    doneCount: totalDone,
    // 전부 걸었으면 next 가 없다. 화면이 '끝' 을 그릴 수 있어야 한다.
    finished: firstUnfinished === null && nodeStates.length > 0,
  };
}

/** 이 마디를 지금 열 수 있는가. 순서를 건너뛴 요청을 막는다. */
export function canOpen(userId, nodeId) {
  const idx = NODES.findIndex((n) => n.id === nodeId);
  if (idx === -1) return false;
  if (idx === 0) return true;
  const prev = NODES[idx - 1];
  const row = getDb()
    .prepare('SELECT done_at FROM node_progress WHERE user_id = ? AND node_id = ?')
    .get(userId, prev.id);
  return Boolean(row?.done_at);
}

/** 마디를 연다. 걸음 목록을 답 없이 돌려준다. */
export function openNode(userId, nodeId) {
  const node = findNode(nodeId);
  if (!node) return { error: 'not-found' };
  if (!canOpen(userId, nodeId)) return { error: 'locked' };

  const lesson = buildLesson(userId, nodeId);
  if (!lesson) return { error: 'not-found' };

  const db = getDb();
  db.prepare(
    `INSERT INTO node_progress (user_id, node_id, steps_done, score, started_at)
     VALUES (?, ?, 0, 0, ?)
     ON CONFLICT (user_id, node_id) DO NOTHING`,
  ).run(userId, nodeId, now());

  const row = db
    .prepare('SELECT steps_done, score, done_at FROM node_progress WHERE user_id = ? AND node_id = ?')
    .get(userId, nodeId);

  return {
    lesson: toClient(lesson),
    chapter: publicChapter(findChapter(node.chapterId)),
    progress: { stepsDone: row.steps_done, score: row.score, done: Boolean(row.done_at) },
  };
}

/** 지금 이 마디에서 몇 번째 걸음까지 끝났는지. */
function stepsDoneOf(userId, nodeId) {
  const row = getDb()
    .prepare('SELECT steps_done FROM node_progress WHERE user_id = ? AND node_id = ?')
    .get(userId, nodeId);
  return row ? row.steps_done : null;
}

/**
 * 걸음 하나를 낸다.
 *
 * 점수는 points_ledger 에 (reason, ref) = ('lesson-step', '<node>:<i>') 로
 * 들어간다. 같은 걸음을 두 번 내도 점수는 한 번만 붙는다.
 */
export function submitStep(userId, nodeId, stepIndex, submission) {
  const node = findNode(nodeId);
  if (!node) return { error: 'not-found' };
  if (!canOpen(userId, nodeId)) return { error: 'locked' };

  const lesson = buildLesson(userId, nodeId);
  const step = lesson?.steps[stepIndex];
  if (!step) return { error: 'no-step' };

  const already = stepsDoneOf(userId, nodeId);
  if (already === null) return { error: 'not-started' };
  // 걸음은 차례대로만 낸다. 건너뛰면 뒤 문제의 답이 먼저 노출된다.
  if (stepIndex > already) return { error: 'out-of-order' };

  const result = grade(step, submission);
  if (!result.ok) return { ok: false, message: result.message, correct: result.correct };

  const isNew = stepIndex === already;

  return transaction((db) => {
    if (step.type === 'feeling') {
      db.prepare(
        `INSERT INTO feeling_votes (user_id, node_id, choice, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, node_id) DO UPDATE SET choice = excluded.choice`,
      ).run(userId, nodeId, step.options[Number(submission.choice)], now());
    }
    if (step.type === 'response') {
      db.prepare(
        `INSERT INTO responses (user_id, node_id, poem_id, text, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, node_id) DO UPDATE SET text = excluded.text`,
      ).run(userId, nodeId, node.poemId, String(submission.text).trim(), now());
    }

    // 틀린 문제는 오답 노트로. 시험 대비가 여기서부터 시작한다.
    if (isNew && result.correct === false) {
      recordMistake(db, { userId, poemId: node.poemId, origin: `lesson:${nodeId}:${stepIndex}`, step });
    }

    if (isNew) {
      db.prepare(
        'UPDATE node_progress SET steps_done = ?, score = score + ? WHERE user_id = ? AND node_id = ?',
      ).run(stepIndex + 1, result.points, userId, nodeId);
      if (result.points) {
        award({
          userId,
          amount: result.points,
          reason: 'lesson-step',
          ref: `${nodeId}:${stepIndex}`,
          day: dayKey(),
        });
      }
    }

    const row = db
      .prepare('SELECT steps_done, score FROM node_progress WHERE user_id = ? AND node_id = ?')
      .get(userId, nodeId);

    return {
      ok: true,
      correct: result.correct,
      points: isNew ? result.points : 0,
      reveal: result.reveal,
      message: result.message,
      stepsDone: row.steps_done,
      score: row.score,
      // 마지막 걸음을 냈으면 화면이 마무리로 넘어간다.
      lessonComplete: row.steps_done >= lesson.steps.length,
      // '화자의 마음' 은 채점 대신 분포를 돌려준다.
      distribution: step.type === 'feeling' ? feelingDistribution(nodeId, step.options) : null,
    };
  });
}

/**
 * 이 마디에서 사람들이 무엇을 짚었는지.
 *
 * 분모는 **보기 안에 든 표만** 센다. 보기는 마디마다 고정이므로 보통은
 * 전체 표와 같지만, 나중에 시의 themes 를 고치면 예전 표가 보기 밖으로
 * 밀려날 수 있다. 그때 전체 표를 분모로 쓰면 화면의 비율 합이 100%가
 * 안 되고, 사용자는 왜 그런지 알 길이 없다. 보이는 것만으로 셈한다.
 */
export function feelingDistribution(nodeId, options) {
  const rows = getDb()
    .prepare('SELECT choice, COUNT(*) AS n FROM feeling_votes WHERE node_id = ? GROUP BY choice')
    .all(nodeId);
  const counts = new Map(rows.map((r) => [r.choice, Number(r.n)]));
  const listed = options.map((label) => ({ label, count: counts.get(label) ?? 0 }));
  const total = listed.reduce((sum, i) => sum + i.count, 0);
  const everything = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    total,
    items: listed.map((i) => ({
      ...i,
      percent: total ? Math.round((i.count / total) * 100) : 0,
    })),
    // 보기가 바뀌어 집계에서 빠진 표가 있으면 숨기지 않고 알린다.
    orphaned: everything - total,
  };
}

/**
 * 마디를 끝낸다. 걸음을 다 내지 않았으면 끝나지 않는다.
 * 완주 보너스는 ref 가 마디 하나당 하나뿐이라 여러 번 눌러도 한 번만 붙는다.
 */
export const FINISH_BONUS = 15;

export function finishNode(userId, nodeId) {
  const node = findNode(nodeId);
  if (!node) return { error: 'not-found' };
  const lesson = buildLesson(userId, nodeId);
  const db = getDb();
  const row = db
    .prepare('SELECT steps_done, score, done_at FROM node_progress WHERE user_id = ? AND node_id = ?')
    .get(userId, nodeId);
  if (!row) return { error: 'not-started' };
  if (row.steps_done < lesson.steps.length) return { error: 'incomplete' };

  if (!row.done_at) {
    db.prepare('UPDATE node_progress SET done_at = ? WHERE user_id = ? AND node_id = ?').run(
      now(),
      userId,
      nodeId,
    );
    award({
      userId,
      amount: FINISH_BONUS,
      reason: 'lesson-finish',
      ref: nodeId,
      day: dayKey(),
    });
  }

  const map = mapFor(userId);
  return {
    ok: true,
    // 화면이 '걸음 n점 + 완주 m점' 으로 쪼개 보여 주므로 둘을 따로 보냅니다.
    // 보너스를 프런트에 숫자로 박아 두면 서버와 어긋나는 날이 옵니다.
    stepScore: row.score,
    bonus: FINISH_BONUS,
    score: row.score + FINISH_BONUS,
    next: map.next,
    doneCount: map.doneCount,
    total: map.total,
    finished: map.finished,
  };
}

/** 내가 남긴 한 줄 감상들. 「나」 화면의 '걸어온 길' 재료. */
export function myResponses(userId, limit = 50) {
  return getDb()
    .prepare(
      `SELECT id, node_id AS nodeId, poem_id AS poemId, text, created_at AS createdAt
         FROM responses WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, limit);
}

export { nodesOfChapter };
