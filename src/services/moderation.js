import { getDb, now } from '../db.js';
import { publish } from '../lib/bus.js';
import { AppError } from './users.js';
import { assertMember } from './rooms.js';

/**
 * 방의 안전 장치 — 신고, 가리기, 차단.
 *
 * 선생님이 늘 지켜보고 있지 않아도 반이 스스로 지킬 수 있어야 한다.
 *   - 서로 다른 세 사람이 신고하면 글이 저절로 가려진다.
 *   - 방을 만든 사람(선생님)은 어떤 글이든 가리고 되돌릴 수 있다.
 *   - 가린 글은 지우지 않는다. 운영자는 원문을 보고 판단할 수 있어야 한다.
 *   - 차단은 차단한 사람의 화면에서만 상대 글을 없앤다. 상대는 모른다.
 *     알게 되면 차단이 또 다른 다툼의 씨앗이 된다.
 * 거르는 일은 모두 서버가 한다. 화면에 맡기면 개발자 도구로 다 보인다.
 */

export const REPORTS_TO_HIDE = 3;
export const REPORT_REASONS = ['괴롭힘', '불쾌한 말', '도배', '개인정보', '기타'];

export function roleIn(roomId, userId) {
  const row = getDb()
    .prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?')
    .get(roomId, userId);
  return row?.role ?? null;
}

export function assertOwner(roomId, userId) {
  assertMember(roomId, userId);
  if (roleIn(roomId, userId) !== 'owner') {
    throw new AppError('방을 만든 사람만 할 수 있습니다.', 403, 'not_owner');
  }
}

function messageInRoom(roomId, messageId) {
  const m = getDb().prepare('SELECT * FROM messages WHERE id = ? AND room_id = ?').get(messageId, roomId);
  if (!m) throw new AppError('메시지를 찾을 수 없습니다.', 404, 'message_not_found');
  return m;
}

export function reportMessage({ roomId, messageId, userId, reason }) {
  assertMember(roomId, userId);
  const m = messageInRoom(roomId, messageId);
  if (m.author_type !== 'user') throw new AppError('알림 글은 신고할 수 없습니다.', 400, 'not_reportable');
  if (Number(m.user_id) === userId) throw new AppError('내 글은 신고할 수 없습니다.', 400, 'own_message');
  const why = REPORT_REASONS.includes(reason) ? reason : '기타';

  const db = getDb();
  db.prepare(
    `INSERT INTO reports (message_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  ).run(messageId, userId, why, now());

  const count = Number(db.prepare('SELECT COUNT(*) AS n FROM reports WHERE message_id = ?').get(messageId).n);
  let hidden = Boolean(m.hidden_at);
  if (!hidden && count >= REPORTS_TO_HIDE) {
    db.prepare("UPDATE messages SET hidden_at = ?, hidden_by = 'reports' WHERE id = ?").run(now(), messageId);
    hidden = true;
    publish(roomId, { type: 'hidden', messageId });
  }
  return { reported: true, hidden };
}

export function setHidden({ roomId, messageId, userId, hidden }) {
  assertOwner(roomId, userId);
  messageInRoom(roomId, messageId);
  getDb()
    .prepare('UPDATE messages SET hidden_at = ?, hidden_by = ? WHERE id = ?')
    .run(hidden ? now() : null, hidden ? 'owner' : null, messageId);
  publish(roomId, { type: hidden ? 'hidden' : 'unhidden', messageId });
  return { hidden };
}

export function blockUser({ userId, targetId }) {
  if (userId === targetId) throw new AppError('나를 차단할 수는 없습니다.', 400, 'self_block');
  getDb()
    .prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
    .run(userId, targetId, now());
  return { blocked: true };
}

export function unblockUser({ userId, targetId }) {
  getDb().prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(userId, targetId);
  return { blocked: false };
}

export function blockedIds(userId) {
  return new Set(
    getDb()
      .prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?')
      .all(userId)
      .map((r) => Number(r.blocked_id)),
  );
}

export function blockedList(userId) {
  return getDb()
    .prepare(
      `SELECT u.id, u.display_name AS name FROM blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
    )
    .all(userId)
    .map((r) => ({ id: Number(r.id), name: r.name }));
}

/**
 * 보는 사람에 맞춰 글을 고친다. null 이면 보여 주지 않는다.
 *   - 차단한 사람의 글: 아예 없다.
 *   - 가린 글: 운영자와 글쓴이는 원문과 '가려짐' 표시, 나머지는 빈 자리.
 */
export function forViewer(message, { viewerId, isOwner, blocked }) {
  if (!message) return null;
  if (message.userId !== null && blocked.has(message.userId)) return null;
  if (!message.hiddenAt) return message;
  if (isOwner || message.userId === viewerId) return { ...message, hidden: true };
  return {
    ...message,
    hidden: true,
    body: '',
    meta: {},
    cheers: [],
  };
}
