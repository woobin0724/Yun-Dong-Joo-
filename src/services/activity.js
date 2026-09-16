import { dayKey } from '../lib/date.js';
import { submitMission, isDayComplete, markPoemRead } from './missions.js';
import { roomIdsForUser } from './rooms.js';
import { postMessage, postBotMessage } from './chat.js';
import { evaluateChallenges } from './challenges.js';
import { collectStats } from './stats.js';
import { touchActivity, getUserById } from './users.js';
import { sendToUser } from './push.js';
import { POEM_BY_ID } from '../content/poems.js';
import { missionDoneMessage, challengeMessage } from '../content/messages.js';

/**
 * 미션 제출을 둘러싼 뒷일을 한자리에서 처리한다.
 *
 *   제출 → (공유 미션이면) 방에 감상 올리기
 *        → 하루치를 다 끝냈으면 봇이 한마디
 *        → 새로 달성한 도전과제 확정 + 축하 메시지 + 푸시
 *
 * 채팅이 시끄러워지지 않도록, 봇은 "하루 완료"와 "도전과제 달성"에만 입을 연다.
 */
export async function completeMission({ userId, missionId, answer = null, text = null }) {
  const day = dayKey();
  const result = submitMission({ userId, missionId, answer, text, day });

  if (result.alreadyDone) {
    return { ...result, sharedMessage: null, earnedChallenges: [], dayComplete: null };
  }
  if (result.correct === false) {
    // 오답 — 다시 풀 수 있으므로 아무것도 기록하지 않는다.
    return { ...result, sharedMessage: null, earnedChallenges: [], dayComplete: false };
  }

  touchActivity(userId);

  const rooms = roomIdsForUser(userId);
  const mission = result.mission;
  const poem = POEM_BY_ID.get(mission.poemId);

  // 1) 공유 미션이면 사용자의 글을 방에 올린다.
  let sharedMessage = null;
  if (mission.share && result.submission) {
    for (const roomId of rooms) {
      const message = postMessage({
        roomId,
        userId,
        body: result.submission,
        kind: 'share',
        meta: {
          missionId: mission.id,
          missionTitle: mission.title,
          poemId: mission.poemId,
          poemTitle: poem?.title ?? null,
        },
      });
      sharedMessage ??= message;
    }
  }

  // 2) 하루치를 다 끝냈으면 봇이 한마디 남긴다.
  const stats = collectStats(userId, day);
  const dayComplete = isDayComplete(userId, day);
  if (dayComplete && rooms.length) {
    const body = missionDoneMessage({
      name: displayNameOf(userId),
      streak: stats.streak,
      seed: `${userId}:${day}`,
    });
    for (const roomId of rooms) {
      postBotMessage({
        roomId,
        body,
        kind: 'mission',
        meta: { userId, day, streak: stats.streak },
      });
    }
  }

  // 3) 새 도전과제.
  const earnedChallenges = evaluateChallenges(userId, { day, stats });
  for (const challenge of earnedChallenges) {
    const body = challengeMessage({
      name: displayNameOf(userId),
      challenge,
      seed: `${userId}:${challenge.id}`,
    });
    for (const roomId of rooms) {
      postBotMessage({
        roomId,
        body,
        kind: 'challenge',
        meta: { userId, challengeId: challenge.id, icon: challenge.icon },
      });
    }
    await sendToUser(
      userId,
      {
        title: `${challenge.icon} ${challenge.title}`,
        body: `${challenge.description} (+${challenge.reward}점)`,
        tag: `challenge-${challenge.id}`,
        url: '/#challenges',
      },
      { category: 'challenge', dedupeKey: `challenge:${userId}:${challenge.id}` },
    );
  }

  return { ...result, sharedMessage, earnedChallenges, dayComplete, stats };
}

/** 시를 펼쳐 봤을 때 — 읽기 계열 도전과제가 여기서 열린다. */
export function recordPoemRead(userId, poemId) {
  markPoemRead(userId, poemId);
  touchActivity(userId);
  return evaluateChallenges(userId);
}

/** 응원을 주고받은 뒤에도 과제 조건이 바뀔 수 있다. */
export function refreshChallenges(userId) {
  return evaluateChallenges(userId);
}

function displayNameOf(userId) {
  return getUserById(userId)?.displayName ?? '누군가';
}
