import crypto from 'node:crypto';
import { getDb, now } from '../db.js';
import { config } from '../config.js';
import { dayKey } from '../lib/date.js';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

export class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hashPin(pin, salt) {
  return crypto
    .scryptSync(pin.normalize('NFKC'), salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    })
    .toString('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** 로그인 아이디 정규화 — 대소문자와 유니코드 표기를 통일한다. */
export function normalizeHandle(handle) {
  return String(handle || '').trim().normalize('NFKC').toLowerCase();
}

export function validateHandle(handle) {
  const normalized = normalizeHandle(handle);
  if (!/^[a-z0-9가-힣._-]{2,20}$/u.test(normalized)) {
    throw new AppError(
      '아이디는 2~20자의 한글·영문·숫자와 . _ - 만 쓸 수 있습니다.',
      400,
      'invalid_handle',
    );
  }
  return normalized;
}

export function validateDisplayName(name) {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > 20) {
    throw new AppError('이름은 1~20자로 적어 주세요.', 400, 'invalid_name');
  }
  return trimmed;
}

export function validatePin(pin) {
  const value = String(pin || '');
  if (!/^[0-9]{4,12}$/.test(value)) {
    throw new AppError('PIN 은 숫자 4~12자리로 정해 주세요.', 400, 'invalid_pin');
  }
  return value;
}

export function createUser({ handle, displayName, pin }) {
  const db = getDb();
  const normalized = validateHandle(handle);
  const name = validateDisplayName(displayName);
  const checkedPin = validatePin(pin);

  const existing = db.prepare('SELECT id FROM users WHERE handle = ?').get(normalized);
  if (existing) throw new AppError('이미 쓰이고 있는 아이디입니다.', 409, 'handle_taken');

  const salt = crypto.randomBytes(16).toString('hex');
  const info = db
    .prepare(
      `INSERT INTO users (handle, display_name, pin_hash, pin_salt, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(normalized, name, hashPin(checkedPin, salt), salt, now());

  const userId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO notification_prefs (user_id) VALUES (?)').run(userId);
  return getUserById(userId);
}

export function verifyCredentials({ handle, pin }) {
  const db = getDb();
  const normalized = normalizeHandle(handle);
  const row = db.prepare('SELECT * FROM users WHERE handle = ?').get(normalized);
  if (!row) throw new AppError('아이디나 PIN이 맞지 않습니다.', 401, 'bad_credentials');
  if (!timingSafeEqual(hashPin(String(pin || ''), row.pin_salt), row.pin_hash)) {
    throw new AppError('아이디나 PIN이 맞지 않습니다.', 401, 'bad_credentials');
  }
  return publicUser(row);
}

export function getUserById(id) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? publicUser(row) : null;
}

export function publicUser(row) {
  return {
    id: Number(row.id),
    handle: row.handle,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastActiveDay: row.last_active_day,
  };
}

export function touchActivity(userId) {
  getDb()
    .prepare('UPDATE users SET last_active_day = ? WHERE id = ?')
    .run(dayKey(), userId);
}

// ── 세션 ───────────────────────────────────────────────────

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlDays * 86400000);
  getDb()
    .prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run(hashToken(token), userId, now(), expires.toISOString());
  return { token, expiresAt: expires };
}

export function resolveSession(token) {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(hashToken(token));
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return getUserById(row.user_id);
}

export function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

/** 만료된 세션 청소 — 스케줄러가 하루 한 번 부른다. */
export function pruneSessions() {
  return Number(
    getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()).changes,
  );
}
