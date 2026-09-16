import crypto from 'node:crypto';
import { getDb, now } from '../db.js';
import { AppError } from './users.js';

// 헷갈리기 쉬운 0/O, 1/I 는 뺐다.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** 사용자가 공백이나 하이픈을 섞어 입력해도 코드를 찾을 수 있게 정리한다. */
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function createRoom({ name, userId }) {
  const db = getDb();
  const roomName = String(name || '').trim();
  if (roomName.length < 1 || roomName.length > 30) {
    throw new AppError('방 이름은 1~30자로 적어 주세요.', 400, 'invalid_room_name');
  }

  let code;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateCode();
    if (!db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(candidate)) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new AppError('초대 코드를 만들지 못했습니다. 다시 시도해 주세요.', 500, 'code_failed');

  const info = db
    .prepare('INSERT INTO rooms (name, code, created_by, created_at) VALUES (?, ?, ?, ?)')
    .run(roomName, code, userId, now());
  const roomId = Number(info.lastInsertRowid);
  addMember({ roomId, userId, role: 'owner' });
  return getRoom(roomId);
}

export function addMember({ roomId, userId, role = 'member' }) {
  const db = getDb();
  const existing = db
    .prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
    .get(roomId, userId);
  if (existing) return false;
  db.prepare(
    'INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
  ).run(roomId, userId, role, now());
  return true;
}

export function joinRoomByCode({ code, userId }) {
  const db = getDb();
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(normalizeCode(code));
  if (!room) throw new AppError('그런 초대 코드를 가진 방이 없습니다.', 404, 'room_not_found');
  const joined = addMember({ roomId: Number(room.id), userId });
  return { room: serializeRoom(room), joined };
}

export function getRoom(roomId) {
  const row = getDb().prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  return row ? serializeRoom(row) : null;
}

export function listRoomsForUser(userId) {
  return getDb()
    .prepare(
      `SELECT r.*, rm.role, rm.joined_at AS member_joined_at,
              (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) AS member_count
         FROM rooms r
         JOIN room_members rm ON rm.room_id = r.id
        WHERE rm.user_id = ?
        ORDER BY rm.joined_at ASC`,
    )
    .all(userId)
    .map((row) => ({
      ...serializeRoom(row),
      role: row.role,
      memberCount: Number(row.member_count),
    }));
}

export function listMembers(roomId) {
  return getDb()
    .prepare(
      `SELECT u.id, u.display_name, u.handle, rm.role, rm.joined_at
         FROM room_members rm
         JOIN users u ON u.id = rm.user_id
        WHERE rm.room_id = ?
        ORDER BY rm.joined_at ASC`,
    )
    .all(roomId)
    .map((r) => ({
      id: Number(r.id),
      displayName: r.display_name,
      handle: r.handle,
      role: r.role,
      joinedAt: r.joined_at,
    }));
}

export function isMember(roomId, userId) {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
      .get(roomId, userId),
  );
}

export function assertMember(roomId, userId) {
  if (!isMember(roomId, userId)) {
    throw new AppError('이 방의 구성원이 아닙니다.', 403, 'not_a_member');
  }
}

export function leaveRoom({ roomId, userId }) {
  getDb()
    .prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?')
    .run(roomId, userId);
}

/** 사용자가 속한 모든 방의 id. 봇 메시지를 뿌릴 때 쓴다. */
export function roomIdsForUser(userId) {
  return getDb()
    .prepare('SELECT room_id FROM room_members WHERE user_id = ?')
    .all(userId)
    .map((r) => Number(r.room_id));
}

function serializeRoom(row) {
  return {
    id: Number(row.id),
    name: row.name,
    code: row.code,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    createdAt: row.created_at,
  };
}
