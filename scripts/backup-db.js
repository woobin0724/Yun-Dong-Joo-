#!/usr/bin/env node
/**
 * 학생 기록(SQLite 파일)을 한 벌 떠 둔다.
 *
 *   npm run backup                 → DB 옆 backups/ 폴더에 app-2026-10-12T0530.db
 *   npm run backup -- /어디/파일.db → 지정한 곳에
 *
 * 서버가 돌고 있어도 된다. 파일을 그냥 복사하면 쓰는 도중의 반쪽짜리가 복사될 수
 * 있어서, SQLite 의 VACUUM INTO 로 '한 순간의 온전한 사본' 을 만든다.
 *
 * 주의: 같은 디스크에 두는 백업은 '실수로 지웠다', '업데이트가 데이터를 망쳤다' 는
 * 경우만 막는다. 디스크 자체가 사라지면 함께 사라진다. 학기가 끝날 때처럼 중요한
 * 때에는 만든 파일을 내려받아 다른 곳에도 두라. docs/배포-안내.md 를 보라.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const source = process.env.DB_PATH || './data/app.db';
if (!fs.existsSync(source)) {
  console.error(`DB 파일이 없습니다: ${source}  (DB_PATH 를 확인하세요)`);
  process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', 'T');
const target =
  process.argv[2] || path.join(path.dirname(path.resolve(source)), 'backups', `app-${stamp}.db`);
fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
if (fs.existsSync(target)) {
  console.error(`이미 있는 파일입니다: ${target}`);
  process.exit(1);
}

const db = new DatabaseSync(source, { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');
db.exec(`VACUUM INTO '${path.resolve(target).replaceAll("'", "''")}'`);
db.close();

// 만든 사본이 열리는지, 무엇이 들었는지 확인하고 알려 준다.
const check = new DatabaseSync(target, { readOnly: true });
const ok = check.prepare('PRAGMA integrity_check').get();
const users = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
check.close();
const kb = Math.round(fs.statSync(target).size / 1024);
console.log(`백업 완료: ${target}`);
console.log(`  크기 ${kb}KB · 사용자 ${users}명 · 무결성 ${Object.values(ok)[0]}`);
