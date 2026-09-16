import { getDb } from '../db.js';
import { config } from '../config.js';
import { dayKey, localParts, weekStart, addDays } from '../lib/date.js';
import { ensureDailyMissions, todaysPoem, missionsForUser } from './missions.js';
import { postBotMessage } from './chat.js';
import { sendToUser } from './push.js';
import { pruneSessions } from './users.js';
import { leaderboard } from './points.js';
import { poemAnnouncement, weeklyWrapMessage } from '../content/messages.js';
import { poemPreview } from '../content/poems.js';
import { eulReul } from '../lib/korean.js';

/**
 * 정해진 시각에 할 일을 처리하는 아주 단순한 스케줄러.
 *
 * cron 라이브러리를 쓰지 않고 1분마다 "지금 할 일이 있나" 를 확인한다.
 * 실제로 보낼 때는 push_log 의 dedupe_key 로 한 번 더 걸러 내므로,
 * 서버가 재시작되거나 확인이 겹쳐도 같은 알림이 두 번 가지 않는다.
 */

const TICK_MS = 60 * 1000;
let timer = null;

export function startScheduler() {
  if (timer) return;
  if (!config.enableScheduler) {
    console.log('[스케줄러] ENABLE_SCHEDULER=false 이므로 켜지 않습니다.');
    return;
  }
  // 시작할 때 오늘 것은 미리 만들어 둔다.
  ensureDailyMissions();
  timer = setInterval(() => {
    tick().catch((err) => console.error('[스케줄러] 처리 중 오류:', err));
  }, TICK_MS);
  timer.unref?.();
  console.log(
    `[스케줄러] 켜짐 — 미션 발행 ${config.missionPublishHour}시, ` +
      `시 알림 ${config.poemPushHours.join('시·')}시 (${config.timezone})`,
  );
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** 테스트에서 시각을 넣어 직접 부를 수 있도록 분리해 두었다. */
export async function tick(at = new Date()) {
  const { day, hour, minute } = localParts(at);
  if (minute !== 0) return { skipped: 'not_on_the_hour' };

  const jobs = [];

  if (hour === config.missionPublishHour) jobs.push(publishDailyMissions(day));
  if (config.poemPushHours.includes(hour)) jobs.push(pushTodaysPoem(day, hour));
  if (hour === 3) jobs.push(Promise.resolve({ prunedSessions: pruneSessions() }));
  // 월요일 0시에 지난주 마감 안내
  if (hour === 0 && weekStart(day) === day) jobs.push(postWeeklyWrap(day));

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[스케줄러] 작업 실패:', r.reason);
  }
  return { day, hour, jobs: results.length };
}

/** 오늘의 미션을 만들고, 모든 방에 오늘의 시를 알린다. */
export async function publishDailyMissions(day = dayKey()) {
  const missions = ensureDailyMissions(day);
  const poem = todaysPoem(day);
  const db = getDb();
  const rooms = db.prepare('SELECT id FROM rooms').all().map((r) => Number(r.id));

  for (const roomId of rooms) {
    const already = db
      .prepare(
        `SELECT 1 FROM messages
          WHERE room_id = ? AND kind = 'poem' AND json_extract(meta, '$.day') = ?`,
      )
      .get(roomId, day);
    if (already) continue;

    postBotMessage({
      roomId,
      kind: 'poem',
      body:
        `${poemAnnouncement({ poem, seed: `${day}:${roomId}` })}\n` +
        `“${poemPreview(poem)}”\n오늘의 미션 ${missions.length}가지가 올라왔습니다.`,
      meta: { day, poemId: poem.id, poemTitle: poem.title, missionCount: missions.length },
    });
  }

  // 아직 오늘 미션을 시작하지 않은 사람에게만 알림을 보낸다.
  const users = db.prepare('SELECT id FROM users').all().map((r) => Number(r.id));
  await Promise.allSettled(
    users.map((userId) =>
      sendToUser(
        userId,
        {
          title: `오늘의 시 — 「${poem.title}」`,
          body: `미션 ${missions.length}가지가 준비됐습니다. ${poemPreview(poem)}`,
          tag: `mission-${day}`,
          url: '/#today',
        },
        { category: 'mission', dedupeKey: `mission:${day}:${userId}` },
      ),
    ),
  );

  return { day, poemId: poem.id, rooms: rooms.length, users: users.length };
}

/** 정해진 시각마다 오늘의 시를 다시 한 번 알린다 (아직 안 끝낸 사람에게만). */
export async function pushTodaysPoem(day = dayKey(), hour = 0) {
  const poem = todaysPoem(day);
  const db = getDb();
  const users = db.prepare('SELECT id FROM users').all().map((r) => Number(r.id));

  let sent = 0;
  await Promise.allSettled(
    users.map(async (userId) => {
      const remaining = missionsForUser(userId, day).filter((m) => !m.completed).length;
      if (!remaining) return; // 다 끝낸 사람은 조용히 둔다
      const result = await sendToUser(
        userId,
        {
          title: `「${poem.title}」${eulReul(poem.title)} 읽어 볼까요`,
          body:
            remaining === 1
              ? '오늘 미션이 하나 남았습니다.'
              : `오늘 미션이 ${remaining}가지 남았습니다.`,
          tag: `poem-${day}-${hour}`,
          url: '/#today',
        },
        { category: 'poem', dedupeKey: `poem:${day}:${hour}:${userId}` },
      );
      if (result.sent) sent++;
    }),
  );
  return { day, hour, sent };
}

/** 월요일 0시 — 지난주 랭킹을 각 방에 남긴다. */
export async function postWeeklyWrap(day = dayKey()) {
  const db = getDb();
  const lastWeekDay = addDays(day, -1); // 지난주에 속한 하루
  const rooms = db.prepare('SELECT id FROM rooms').all().map((r) => Number(r.id));

  for (const roomId of rooms) {
    const already = db
      .prepare(
        `SELECT 1 FROM messages
          WHERE room_id = ? AND kind = 'notice' AND json_extract(meta, '$.weeklyWrap') = ?`,
      )
      .get(roomId, day);
    if (already) continue;

    const top = leaderboard({ roomId, period: 'week', limit: 3, today: lastWeekDay });
    postBotMessage({
      roomId,
      kind: 'notice',
      body: weeklyWrapMessage({ top }),
      meta: { weeklyWrap: day, weekOf: weekStart(lastWeekDay) },
    });
  }
  return { day, rooms: rooms.length };
}
