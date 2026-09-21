#!/usr/bin/env node
/**
 * 시연용 데이터 만들기.
 *
 *   npm run seed
 *
 * 방 하나와 사람 넷을 만들고, 지난 며칠치 활동을 흉내 내 채워 넣는다.
 * 랭킹·도전과제·채팅이 어떻게 보이는지 바로 확인할 때 쓴다.
 * (모두 PIN 은 1234)
 */
import { createUser, AppError } from '../src/services/users.js';
import { createRoom, joinRoomByCode } from '../src/services/rooms.js';
import { ensureDailyMissions } from '../src/services/missions.js';
import { completeMission } from '../src/services/activity.js';
import { postMessage } from '../src/services/chat.js';
import { award } from '../src/services/points.js';
import { evaluateChallenges } from '../src/services/challenges.js';
import { markPoemRead } from '../src/services/missions.js';
import { POEMS } from '../src/content/poems.js';
import { dayKey, addDays } from '../src/lib/date.js';
import { getDb } from '../src/db.js';

const PEOPLE = [
  { handle: '한결', displayName: '한결', zeal: 1.0 },
  { handle: '윤슬', displayName: '윤슬', zeal: 0.8 },
  { handle: '도담', displayName: '도담', zeal: 0.6 },
  { handle: '가온', displayName: '가온', zeal: 0.35 },
];

const REMARKS = [
  '“잎새에 이는 바람에도”라는 구절에서 한참 멈췄습니다.',
  '소리 내어 읽으니 호흡이 달라지네요. 확실히 다릅니다.',
  '오늘 시는 출퇴근길에 읽기 좋았습니다.',
  '이 시를 스물넷에 썼다는 게 자꾸 걸립니다.',
  '마지막 연만 몇 번을 다시 읽었어요.',
  '필사해 보니 행이 나뉜 자리가 눈에 들어옵니다.',
];

function ensureUser(person) {
  try {
    return createUser({ ...person, pin: '1234' });
  } catch (err) {
    if (err instanceof AppError && err.code === 'handle_taken') {
      const row = getDb().prepare('SELECT * FROM users WHERE handle = ?').get(person.handle);
      return { id: Number(row.id), displayName: row.display_name };
    }
    throw err;
  }
}

async function main() {
  const db = getDb();
  const users = PEOPLE.map(ensureUser);

  let room = db.prepare("SELECT * FROM rooms WHERE name = ?").get('함께 읽는 윤동주');
  if (!room) {
    room = createRoom({ name: '함께 읽는 윤동주', userId: users[0].id });
  } else {
    room = { id: Number(room.id), name: room.name, code: room.code };
  }
  for (const user of users.slice(1)) {
    joinRoomByCode({ code: room.code, userId: user.id });
  }

  const today = dayKey();

  // 지난 6일치 활동 — 점수 원장에 직접 넣어 연속 달성 기록을 만든다.
  for (let back = 6; back >= 1; back--) {
    const day = addDays(today, -back);
    ensureDailyMissions(day);
    users.forEach((user, index) => {
      if (Math.random() > PEOPLE[index].zeal) return;
      award({
        userId: user.id,
        roomId: room.id,
        amount: 40 + Math.floor(Math.random() * 45),
        reason: 'seed',
        ref: `${day}:${user.id}`,
        day,
      });
      db.prepare(
        `INSERT OR IGNORE INTO mission_completions
           (user_id, mission_id, day, mission_key, kind, submission, correct, points, created_at)
         VALUES (?, ?, ?, 'recite', 'check', NULL, NULL, 20, ?)`,
      ).run(user.id, ensureDailyMissions(day)[0].id, day, new Date().toISOString());
    });
  }

  // 읽은 시 기록
  users.forEach((user, index) => {
    const count = Math.round(POEMS.length * PEOPLE[index].zeal);
    for (const poem of POEMS.slice(0, count)) markPoemRead(user.id, poem.id);
  });

  // 오늘치는 실제 흐름을 그대로 태운다 (봇 메시지·도전과제까지 만들어진다).
  const todaysMissions = ensureDailyMissions(today);
  for (const [index, user] of users.entries()) {
    if (Math.random() > PEOPLE[index].zeal) continue;
    for (const mission of todaysMissions) {
      try {
        if (mission.kind === 'quiz') {
          await completeMission({ userId: user.id, missionId: mission.id, answer: mission.data.answer });
        } else if (mission.kind === 'text') {
          await completeMission({
            userId: user.id,
            missionId: mission.id,
            text: REMARKS[Math.floor(Math.random() * REMARKS.length)].repeat(2),
          });
        } else {
          await completeMission({ userId: user.id, missionId: mission.id });
        }
      } catch {
        // 이미 한 미션이면 넘어간다
      }
    }
  }

  // 방 안 대화 몇 마디
  for (let i = 0; i < 5; i++) {
    const user = users[Math.floor(Math.random() * users.length)];
    postMessage({
      roomId: room.id,
      userId: user.id,
      body: REMARKS[i % REMARKS.length],
      kind: 'chat',
    });
  }

  users.forEach((user) => evaluateChallenges(user.id));

  console.log(`
  시연용 데이터를 넣었습니다.

  방       「${room.name}」  초대 코드 ${room.code}
  사람     ${PEOPLE.map((p) => p.handle).join(', ')}   (PIN 은 모두 1234)

  npm start 로 서버를 켜고 위 아이디로 로그인해 보세요.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
