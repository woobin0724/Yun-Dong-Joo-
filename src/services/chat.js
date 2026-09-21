import { getDb, now } from '../db.js';
import { publish } from '../lib/bus.js';
import { AppError } from './users.js';
import { assertMember } from './rooms.js';
import { BOT_NAME, CHEER_BY_KEY } from '../content/messages.js';

const MAX_BODY = 2000;

/**
 * 메시지를 남긴다.
 * userId 가 null 이면 봇(동주 알림이)이 말한 것으로 기록된다.
 */
export function postMessage({
  roomId,
  userId = null,
  body,
  kind = 'chat',
  meta = {},
  authorType = userId ? 'user' : 'bot',
}) {
  const text = String(body ?? '').trim();
  if (!text) throw new AppError('빈 메시지는 보낼 수 없습니다.', 400, 'empty_message');
  if ([...text].length > MAX_BODY) {
    throw new AppError(`메시지는 ${MAX_BODY}자까지 쓸 수 있습니다.`, 400, 'message_too_long');
  }
  if (authorType === 'user') assertMember(roomId, userId);

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO messages (room_id, user_id, author_type, kind, body, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(roomId, userId, authorType, kind, text, JSON.stringify(meta), now());

  const message = getMessage(Number(info.lastInsertRowid));
  publish(roomId, { type: 'message', message });
  return message;
}

/** 봇 메시지 지름길. */
export function postBotMessage({ roomId, body, kind = 'notice', meta = {} }) {
  return postMessage({ roomId, userId: null, body, kind, meta, authorType: 'bot' });
}

export function getMessage(id) {
  const row = getDb()
    .prepare(
      `SELECT m.*, u.display_name, u.handle
         FROM messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = ?`,
    )
    .get(id);
  return row ? serializeMessage(row, cheersFor([Number(row.id)])) : null;
}

/**
 * 방의 메시지를 읽는다.
 * @param {object} opts
 * @param {number} opts.beforeId 이 id 보다 앞선 메시지 (과거로 스크롤)
 * @param {number} opts.afterId  이 id 보다 뒤인 메시지 (새 메시지 따라잡기)
 */
export function listMessages({ roomId, limit = 50, beforeId = null, afterId = null }) {
  const db = getDb();
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);

  let rows;
  if (afterId) {
    rows = db
      .prepare(
        `SELECT m.*, u.display_name, u.handle
           FROM messages m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.room_id = ? AND m.id > ?
          ORDER BY m.id ASC LIMIT ?`,
      )
      .all(roomId, afterId, capped);
  } else if (beforeId) {
    rows = db
      .prepare(
        `SELECT m.*, u.display_name, u.handle
           FROM messages m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.room_id = ? AND m.id < ?
          ORDER BY m.id DESC LIMIT ?`,
      )
      .all(roomId, beforeId, capped)
      .reverse();
  } else {
    rows = db
      .prepare(
        `SELECT m.*, u.display_name, u.handle
           FROM messages m LEFT JOIN users u ON u.id = m.user_id
          WHERE m.room_id = ?
          ORDER BY m.id DESC LIMIT ?`,
      )
      .all(roomId, capped)
      .reverse();
  }

  const cheers = cheersFor(rows.map((r) => Number(r.id)));
  return rows.map((row) => serializeMessage(row, cheers));
}

/** 응원(리액션)을 켜고 끈다. 같은 종류를 다시 누르면 취소된다. */
export function toggleCheer({ messageId, userId, kind }) {
  if (!CHEER_BY_KEY.has(kind)) {
    throw new AppError('그런 응원은 없습니다.', 400, 'unknown_cheer');
  }
  const db = getDb();
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) throw new AppError('메시지를 찾을 수 없습니다.', 404, 'message_not_found');
  assertMember(Number(message.room_id), userId);

  const existing = db
    .prepare('SELECT 1 FROM cheers WHERE message_id = ? AND user_id = ? AND kind = ?')
    .get(messageId, userId, kind);

  if (existing) {
    db.prepare('DELETE FROM cheers WHERE message_id = ? AND user_id = ? AND kind = ?').run(
      messageId,
      userId,
      kind,
    );
  } else {
    db.prepare(
      'INSERT INTO cheers (message_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)',
    ).run(messageId, userId, kind, now());
  }

  const updated = getMessage(messageId);
  publish(Number(message.room_id), { type: 'cheer', message: updated });
  return { cheered: !existing, message: updated };
}

/** 여러 메시지의 응원 집계를 한 번에 가져온다 (N+1 질의 방지). */
function cheersFor(messageIds) {
  if (!messageIds.length) return new Map();
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT message_id, kind, COUNT(*) AS n,
              GROUP_CONCAT(user_id) AS user_ids
         FROM cheers WHERE message_id IN (${placeholders})
        GROUP BY message_id, kind`,
    )
    .all(...messageIds);

  const map = new Map();
  for (const row of rows) {
    const id = Number(row.message_id);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push({
      kind: row.kind,
      label: CHEER_BY_KEY.get(row.kind)?.label ?? row.kind,
      count: Number(row.n),
      userIds: String(row.user_ids || '')
        .split(',')
        .filter(Boolean)
        .map(Number),
    });
  }
  return map;
}

function serializeMessage(row, cheerMap) {
  let meta = {};
  try {
    meta = JSON.parse(row.meta || '{}');
  } catch {
    meta = {};
  }
  return {
    id: Number(row.id),
    roomId: Number(row.room_id),
    userId: row.user_id === null ? null : Number(row.user_id),
    authorType: row.author_type,
    authorName: row.author_type === 'bot' ? BOT_NAME : row.display_name || '(탈퇴한 사용자)',
    kind: row.kind,
    body: row.body,
    meta,
    cheers: cheerMap.get(Number(row.id)) || [],
    createdAt: row.created_at,
  };
}
