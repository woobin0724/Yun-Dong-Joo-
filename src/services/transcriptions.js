import { getDb, now } from '../db.js';
import { dayKey } from '../lib/date.js';
import { POEMS } from '../content/poems.js';
import { award } from './points.js';

/**
 * 원고지 필사.
 *
 * 점수는 **작품 한 편당 한 번만** 붙는다. 같은 시를 열 번 적어도
 * 점수는 한 번이다. 여러 번 적는 것을 막지는 않는다 — 두 번째가 더
 * 좋을 수 있고, 그것까지 막으면 연습을 벌주는 꼴이 된다. 다만 점수를
 * 노린 반복은 아무 이득이 없게 해 둔다.
 */

export const MIN_CHARS = 10;
export const TRANSCRIBE_POINTS = 30;

/** 원고지 한 칸에 한 글자. 줄바꿈은 칸을 세지 않는다. */
export const countChars = (text) => [...String(text).replace(/\n/g, '')].length;

export function saveTranscription({ userId, poemId, text }) {
  const poem = POEMS.find((p) => p.id === poemId);
  if (!poem) return { error: 'no-poem' };

  const body = String(text ?? '').replace(/\r\n?/g, '\n');
  const chars = countChars(body);
  if (chars < MIN_CHARS) return { error: 'too-short', need: MIN_CHARS, got: chars };

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO transcriptions (user_id, poem_id, text, chars, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, poemId, body, chars, now());

  // ref 가 작품 하나당 하나뿐이라, 같은 시를 다시 적어도 점수는 그대로다.
  const earned = award({
    userId,
    amount: TRANSCRIBE_POINTS,
    reason: 'transcribe',
    ref: poemId,
    day: dayKey(),
  });

  return {
    ok: true,
    id: Number(info.lastInsertRowid),
    chars,
    points: earned ? TRANSCRIBE_POINTS : 0,
    firstTime: earned,
  };
}

export function listTranscriptions(userId, limit = 60) {
  return getDb()
    .prepare(
      `SELECT id, poem_id AS poemId, text, chars, created_at AS createdAt
         FROM transcriptions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, limit)
    .map((row) => ({
      ...row,
      title: POEMS.find((p) => p.id === row.poemId)?.title ?? row.poemId,
    }));
}

export function getTranscription(userId, id) {
  const row = getDb()
    .prepare(
      `SELECT id, poem_id AS poemId, text, chars, created_at AS createdAt
         FROM transcriptions WHERE user_id = ? AND id = ?`,
    )
    .get(userId, id);
  if (!row) return null;
  return { ...row, title: POEMS.find((p) => p.id === row.poemId)?.title ?? row.poemId };
}

export function deleteTranscription(userId, id) {
  // 점수는 되돌리지 않는다. 적은 일은 실제로 있었던 일이고,
  // 지우기로 점수를 깎으면 지우는 것이 벌이 된다.
  const info = getDb()
    .prepare('DELETE FROM transcriptions WHERE user_id = ? AND id = ?')
    .run(userId, id);
  return info.changes > 0;
}

/** 몇 편을 적었는지 (같은 편을 여러 번 적어도 한 편으로 센다). */
export function transcribedPoemCount(userId) {
  const row = getDb()
    .prepare('SELECT COUNT(DISTINCT poem_id) AS n FROM transcriptions WHERE user_id = ?')
    .get(userId);
  return Number(row.n);
}
