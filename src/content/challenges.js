import { POEMS } from './poems.js';

/**
 * 도전과제(업적).
 *
 * check(stats) 가 true 를 돌려주면 달성 처리되고, 보상 점수가 더해지며
 * 방 채팅에 축하 메시지가 올라간다. 한 번 달성한 과제는 다시 달성되지 않는다.
 *
 * icon 은 화면의 아이콘 스프라이트 이름이다 (public/index.html 의 <symbol id="i-…">).
 * 이모지를 쓰지 않는 이유: 기기마다 모양이 달라 통일감이 깨지고,
 * 푸시 알림 제목에까지 섞여 들어간다.
 *
 * stats 는 services/stats.js 의 collectStats() 가 만들어 준다.
 */

/** @typedef {{id:string,title:string,description:string,icon:string,reward:number,group:string,check:(s:any)=>boolean}} Challenge */

/** @type {Challenge[]} */
export const CHALLENGES = [
  // ── 시작과 꾸준함 ─────────────────────────────────────────
  {
    id: 'first-step',
    title: '첫걸음',
    description: '첫 미션을 완료했습니다.',
    icon: 'path',
    reward: 20,
    group: '꾸준함',
    check: (s) => s.missionsCompleted >= 1,
  },
  {
    id: 'streak-3',
    title: '세 밤의 별',
    description: '사흘 연속으로 미션을 완료했습니다.',
    icon: 'flame',
    reward: 40,
    group: '꾸준함',
    check: (s) => s.bestStreak >= 3,
  },
  {
    id: 'streak-7',
    title: '일곱 밤의 별',
    description: '이레 연속으로 미션을 완료했습니다.',
    icon: 'flame',
    reward: 80,
    group: '꾸준함',
    check: (s) => s.bestStreak >= 7,
  },
  {
    id: 'streak-28',
    title: '스물여덟 밤',
    description: '스물여드레 연속으로 미션을 완료했습니다. 시가 습관이 되었습니다.',
    icon: 'flame',
    reward: 200,
    group: '꾸준함',
    check: (s) => s.bestStreak >= 28,
  },
  {
    id: 'perfect-day',
    title: '오늘 치를 다 헤다',
    description: '하루의 미션을 하나도 남기지 않고 끝냈습니다.',
    icon: 'calendar',
    reward: 30,
    group: '꾸준함',
    check: (s) => s.perfectDays >= 1,
  },
  {
    id: 'perfect-week',
    title: '빠짐없는 한 주',
    description: '이레 동안 하루도 미션을 남기지 않았습니다.',
    icon: 'calendar',
    reward: 120,
    group: '꾸준함',
    check: (s) => s.perfectDays >= 7,
  },

  // ── 읽기 ────────────────────────────────────────────────
  {
    id: 'reader-5',
    title: '다섯 편을 지나',
    description: '서로 다른 시 다섯 편을 펼쳐 읽었습니다.',
    icon: 'book',
    reward: 30,
    group: '읽기',
    check: (s) => s.poemsRead >= 5,
  },
  {
    id: 'reader-10',
    title: '별 헤는 사람',
    description: '서로 다른 시 열 편을 펼쳐 읽었습니다.',
    icon: 'book',
    reward: 70,
    group: '읽기',
    check: (s) => s.poemsRead >= 10,
  },
  {
    id: 'reader-all',
    title: '하늘과 바람과 별과 시',
    description: '앱에 실린 모든 작품을 읽었습니다.',
    icon: 'trophy',
    reward: 250,
    group: '읽기',
    check: (s) => s.poemsRead >= POEMS.length,
  },
  {
    id: 'reciter-7',
    title: '낭독가',
    description: '낭독 미션을 일곱 번 마쳤습니다.',
    icon: 'speak',
    reward: 60,
    group: '읽기',
    check: (s) => (s.byKind.check || 0) >= 7,
  },

  // ── 쓰기 ────────────────────────────────────────────────
  {
    id: 'scribe-1',
    title: '필사의 시작',
    description: '처음으로 시를 손수 옮겨 적었습니다.',
    icon: 'pen',
    reward: 20,
    group: '쓰기',
    check: (s) => (s.byTemplate.copy || 0) >= 1,
  },
  {
    id: 'scribe-10',
    title: '필사의 사람',
    description: '열 번 필사했습니다.',
    icon: 'pen',
    reward: 100,
    group: '쓰기',
    check: (s) => (s.byTemplate.copy || 0) >= 10,
  },
  {
    id: 'writer-10',
    title: '쓰는 사람',
    description: '글로 답하는 미션을 열 번 제출했습니다.',
    icon: 'pen',
    reward: 70,
    group: '쓰기',
    check: (s) => (s.byKind.text || 0) >= 10,
  },
  {
    id: 'poet',
    title: '빌려 쓴 두 행',
    description: '윤동주의 구절을 빌려 직접 시를 지었습니다.',
    icon: 'sparkle',
    reward: 40,
    group: '쓰기',
    check: (s) => (s.byTemplate.create || 0) >= 1,
  },
  {
    id: 'long-form',
    title: '길게 머문 마음',
    description: '한 번에 300자 넘는 감상을 남겼습니다.',
    icon: 'pen',
    reward: 50,
    group: '쓰기',
    check: (s) => s.longestSubmission >= 300,
  },

  // ── 알기 ────────────────────────────────────────────────
  {
    id: 'quiz-10',
    title: '시어 사냥꾼',
    description: '퀴즈를 열 번 맞혔습니다.',
    icon: 'quiz',
    reward: 50,
    group: '알기',
    check: (s) => s.quizCorrect >= 10,
  },
  {
    id: 'quiz-30',
    title: '동주를 아는 사람',
    description: '퀴즈를 서른 번 맞혔습니다.',
    icon: 'quiz',
    reward: 130,
    group: '알기',
    check: (s) => s.quizCorrect >= 30,
  },
  {
    id: 'quiz-streak-5',
    title: '한 번도 틀리지 않고',
    description: '퀴즈를 연속으로 다섯 번 맞혔습니다.',
    icon: 'target',
    reward: 60,
    group: '알기',
    check: (s) => s.bestQuizStreak >= 5,
  },

  // ── 함께 ────────────────────────────────────────────────
  {
    id: 'friend-5',
    title: '동무',
    description: '감상을 우리 방에 다섯 번 나눴습니다.',
    icon: 'users',
    reward: 40,
    group: '함께',
    check: (s) => s.sharedMessages >= 5,
  },
  {
    id: 'cheer-10',
    title: '응원단',
    description: '다른 사람의 글에 열 번 응원을 보냈습니다.',
    icon: 'heart',
    reward: 60,
    group: '함께',
    check: (s) => s.cheersGiven >= 10,
  },
  {
    id: 'cheered-10',
    title: '멀리 있어도',
    description: '내 글이 열 번 응원받았습니다.',
    icon: 'heart',
    reward: 60,
    group: '함께',
    check: (s) => s.cheersReceived >= 10,
  },

  // ── 점수 ────────────────────────────────────────────────
  {
    id: 'points-300',
    title: '잎새에 이는 바람',
    description: '300점을 모았습니다.',
    icon: 'leaf',
    reward: 30,
    group: '점수',
    check: (s) => s.totalPoints >= 300,
  },
  {
    id: 'points-1000',
    title: '부끄럼 없이',
    description: '1,000점을 모았습니다.',
    icon: 'crown',
    reward: 100,
    group: '점수',
    check: (s) => s.totalPoints >= 1000,
  },
];

export const CHALLENGE_BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));

/** 아직 못 받은 과제 중 달성 조건을 만족한 것들. */
export function newlyEarned(stats, earnedIds) {
  const owned = new Set(earnedIds);
  return CHALLENGES.filter((c) => !owned.has(c.id) && c.check(stats));
}
