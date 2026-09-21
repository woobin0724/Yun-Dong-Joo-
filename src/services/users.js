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
  if (!row.pin_hash || !row.pin_salt) {
    // 구글 로그인으로만 만들어진 계정이다. "PIN 이 틀렸다"고 하면 혼란스러우니 따로 알려 준다.
    throw new AppError(
      '이 아이디는 구글 로그인으로 만들어졌습니다. 구글 계정으로 들어와 주세요.',
      401,
      'use_google_login',
    );
  }
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
    profileCompleted: row.profile_completed !== 0,
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

// ── 로그인 수단 (아이디+PIN / 구글) ──────────────────────

/**
 * 아이디를 자동으로 지어 준다. 구글 로그인으로 처음 들어온 사람에게 쓴다.
 * 이름이나 이메일 앞부분을 다듬어 쓰되, 이미 있는 아이디면 숫자를 붙인다.
 */
export function suggestHandle(seed) {
  const base =
    String(seed || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9가-힣._-]/gu, '')
      .slice(0, 16) || 'byeol';

  const db = getDb();
  const padded = base.length >= 2 ? base : `${base}별`;
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? padded : `${padded}${i + 1}`.slice(0, 20);
    if (!db.prepare('SELECT 1 FROM users WHERE handle = ?').get(candidate)) return candidate;
  }
  // 여기까지 오면 임의의 꼬리를 붙인다.
  return `${padded.slice(0, 12)}${crypto.randomBytes(3).toString('hex')}`;
}

/** 구글 등 외부 로그인으로 들어온 사람을 위한 계정. PIN 이 없다. */
export function createExternalUser({ handle, displayName }) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO users (handle, display_name, pin_hash, pin_salt, created_at, profile_completed)
       VALUES (?, ?, NULL, NULL, ?, 0)`,
    )
    .run(handle, validateDisplayName(displayName), now());

  const userId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO notification_prefs (user_id) VALUES (?)').run(userId);
  return getUserById(userId);
}

export function findIdentity({ provider, providerUserId }) {
  const row = getDb()
    .prepare('SELECT * FROM auth_identities WHERE provider = ? AND provider_user_id = ?')
    .get(provider, providerUserId);
  return row ? { ...row, id: Number(row.id), userId: Number(row.user_id) } : null;
}

export function linkIdentity({ provider, providerUserId, userId, email = null }) {
  getDb()
    .prepare(
      `INSERT INTO auth_identities (provider, provider_user_id, user_id, email, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, provider_user_id)
       DO UPDATE SET last_login_at = excluded.last_login_at, email = excluded.email`,
    )
    .run(provider, providerUserId, userId, email, now(), now());
}

export function touchIdentity(identityId) {
  getDb().prepare('UPDATE auth_identities SET last_login_at = ? WHERE id = ?').run(now(), identityId);
}

/** 이 사람이 쓸 수 있는 로그인 수단. 계정 화면에서 보여 준다. */
export function loginMethods(userId) {
  const db = getDb();
  const user = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(userId);
  const providers = db
    .prepare('SELECT provider FROM auth_identities WHERE user_id = ?')
    .all(userId)
    .map((r) => r.provider);
  return { password: Boolean(user?.pin_hash), providers };
}

/** 구글로 갓 만든 계정이 이름·아이디를 정하는 단계. */
export function completeProfile({ userId, handle, displayName }) {
  const db = getDb();
  const normalized = validateHandle(handle);
  const name = validateDisplayName(displayName);

  const taken = db.prepare('SELECT id FROM users WHERE handle = ? AND id <> ?').get(normalized, userId);
  if (taken) throw new AppError('이미 쓰이고 있는 아이디입니다.', 409, 'handle_taken');

  db.prepare(
    'UPDATE users SET handle = ?, display_name = ?, profile_completed = 1 WHERE id = ?',
  ).run(normalized, name, userId);
  return getUserById(userId);
}
