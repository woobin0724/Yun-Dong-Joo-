import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

/**
 * SQLite 연결. Node 22의 내장 node:sqlite 를 쓰므로 네이티브 빌드 의존성이 없다.
 */

let db;

/** 순서대로 한 번씩만 적용되는 마이그레이션. 새 변경은 배열 끝에 덧붙인다. */
const MIGRATIONS = [
  {
    name: '001-initial',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        handle        TEXT NOT NULL UNIQUE,
        display_name  TEXT NOT NULL,
        pin_hash      TEXT NOT NULL,
        pin_salt      TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        last_active_day TEXT
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE rooms (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        code       TEXT NOT NULL UNIQUE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE room_members (
        room_id   INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role      TEXT NOT NULL DEFAULT 'member',
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE INDEX idx_room_members_user ON room_members(user_id);

      -- 하루치 미션은 전체 사용자에게 공통이다 (day + idx 로 유일).
      CREATE TABLE daily_missions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        day        TEXT NOT NULL,
        idx        INTEGER NOT NULL,
        poem_id    TEXT NOT NULL,
        mission_key TEXT NOT NULL,
        kind       TEXT NOT NULL,
        title      TEXT NOT NULL,
        prompt     TEXT NOT NULL,
        points     INTEGER NOT NULL,
        share      INTEGER NOT NULL DEFAULT 0,
        data       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (day, idx)
      );
      CREATE INDEX idx_daily_missions_day ON daily_missions(day);

      CREATE TABLE mission_completions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id  INTEGER NOT NULL REFERENCES daily_missions(id) ON DELETE CASCADE,
        day         TEXT NOT NULL,
        mission_key TEXT NOT NULL,
        kind        TEXT NOT NULL,
        submission  TEXT,
        correct     INTEGER,
        points      INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        UNIQUE (user_id, mission_id)
      );
      CREATE INDEX idx_completions_user_day ON mission_completions(user_id, day);

      -- 퀴즈 오답도 기록해 두면 연속 정답 계산과 복습에 쓸 수 있다.
      CREATE TABLE quiz_attempts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id INTEGER NOT NULL REFERENCES daily_missions(id) ON DELETE CASCADE,
        correct    INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_quiz_attempts_user ON quiz_attempts(user_id, created_at);

      CREATE TABLE poem_reads (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        poem_id    TEXT NOT NULL,
        read_count INTEGER NOT NULL DEFAULT 1,
        first_read_at TEXT NOT NULL,
        last_read_at  TEXT NOT NULL,
        PRIMARY KEY (user_id, poem_id)
      );

      CREATE TABLE messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        author_type TEXT NOT NULL DEFAULT 'user',   -- user | bot
        kind        TEXT NOT NULL DEFAULT 'chat',   -- chat | share | poem | mission | challenge | notice
        body        TEXT NOT NULL,
        meta        TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_messages_room ON messages(room_id, id);

      CREATE TABLE cheers (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id, kind)
      );
      CREATE INDEX idx_cheers_user ON cheers(user_id);

      CREATE TABLE points_ledger (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        room_id    INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
        day        TEXT NOT NULL,
        amount     INTEGER NOT NULL,
        reason     TEXT NOT NULL,
        ref        TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_points_user_day ON points_ledger(user_id, day);
      CREATE INDEX idx_points_room_day ON points_ledger(room_id, day);
      CREATE UNIQUE INDEX idx_points_unique_ref ON points_ledger(user_id, reason, ref)
        WHERE ref IS NOT NULL;

      CREATE TABLE user_challenges (
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        challenge_id TEXT NOT NULL,
        earned_at    TEXT NOT NULL,
        PRIMARY KEY (user_id, challenge_id)
      );

      CREATE TABLE push_subscriptions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_ok_at TEXT,
        failures   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_push_user ON push_subscriptions(user_id);

      CREATE TABLE notification_prefs (
        user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        poem_push     INTEGER NOT NULL DEFAULT 1,
        mission_push  INTEGER NOT NULL DEFAULT 1,
        challenge_push INTEGER NOT NULL DEFAULT 1,
        quiet_start   INTEGER,          -- 0-23, null 이면 사용 안 함
        quiet_end     INTEGER
      );

      -- 같은 알림을 두 번 보내지 않기 위한 발송 기록.
      CREATE TABLE push_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    name: '002-cheer-sparkle',
    sql: `
      -- 응원 아이콘을 이모지에서 커스텀 SVG 로 바꾸면서
      -- 그리기 어려운 '손뼉'을 시의 심상에 맞는 '반짝임'으로 바꿨다.
      UPDATE cheers SET kind = 'sparkle' WHERE kind = 'clap';
    `,
  },
];

function applyMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    database.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw new Error(`마이그레이션 실패 (${migration.name}): ${err.message}`, { cause: err });
    }
  }
}

/** 연결을 만들거나 이미 만든 연결을 돌려준다. */
export function getDb() {
  if (db) return db;
  const target = config.dbPath;
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  }
  db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  applyMigrations(db);
  return db;
}

/** 테스트에서 깨끗한 상태로 다시 시작할 때 쓴다. */
export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

/** 여러 문장을 한 트랜잭션으로 묶는다. */
export function transaction(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();
