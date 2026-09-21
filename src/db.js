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
  {
    name: '003-auth-identities',
    // users 테이블을 다시 만든다.
    // SQLite 는 컬럼의 NOT NULL 을 나중에 풀 수 없어서, 공식 문서가 권하는
    // "새 표를 만들고 옮겨 담고 바꿔치기" 절차를 그대로 따른다.
    // 이 동안에는 외래키 검사를 꺼야 하므로 아래 flag 를 둔다.
    foreignKeysOff: true,
    sql: `
      CREATE TABLE users_new (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        handle            TEXT NOT NULL UNIQUE,
        display_name      TEXT NOT NULL,
        -- 구글 로그인만 쓰는 계정은 PIN 이 없다.
        pin_hash          TEXT,
        pin_salt          TEXT,
        created_at        TEXT NOT NULL,
        last_active_day   TEXT,
        -- 구글로 갓 만든 계정은 이름·아이디를 아직 정하지 않았다.
        profile_completed INTEGER NOT NULL DEFAULT 1
      );

      INSERT INTO users_new (id, handle, display_name, pin_hash, pin_salt, created_at, last_active_day)
        SELECT id, handle, display_name, pin_hash, pin_salt, created_at, last_active_day FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      -- 로그인 수단. 한 사람이 아이디+PIN 과 구글을 함께 가질 수 있다.
      CREATE TABLE auth_identities (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        provider         TEXT NOT NULL,          -- 'google'
        provider_user_id TEXT NOT NULL,          -- 구글의 sub
        user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email            TEXT,                   -- 계정 식별용으로만 쓴다. 화면에 내보내지 않는다.
        created_at       TEXT NOT NULL,
        last_login_at    TEXT,
        UNIQUE (provider, provider_user_id)
      );
      CREATE INDEX idx_identities_user ON auth_identities(user_id);
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

    // 표를 통째로 바꿔치기하는 마이그레이션은 외래키 검사를 잠시 꺼야 한다.
    // (SQLite 문서의 권장 절차. PRAGMA 는 트랜잭션 밖에서 걸어야 먹는다.)
    if (migration.foreignKeysOff) database.exec('PRAGMA foreign_keys = OFF');

    database.exec('BEGIN');
    try {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(migration.name, new Date().toISOString());
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      if (migration.foreignKeysOff) database.exec('PRAGMA foreign_keys = ON');
      throw new Error(`마이그레이션 실패 (${migration.name}): ${err.message}`, { cause: err });
    }

    if (migration.foreignKeysOff) {
      database.exec('PRAGMA foreign_keys = ON');
      // 바꿔치기 뒤에 끊어진 참조가 없는지 꼭 확인한다.
      const broken = database.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) {
        throw new Error(
          `마이그레이션 뒤 외래키가 깨졌습니다 (${migration.name}): ` +
            JSON.stringify(broken.slice(0, 5)),
        );
      }
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
