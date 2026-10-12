/* 화면들이 함께 쓰는 상태와 작은 조각.
   app.js 한 파일이 1,450줄까지 자라 방·랭킹·「나」를 따로 떼면서, 그 파일들이
   같은 상태를 보도록 여기에 둡니다. 상태는 한 객체이고 모두가 같은 것을 고칩니다. */
import { toast } from './core.js';

export const state = {
  user: null,
  today: null,
  rooms: [],
  activeRoomId: null,
  messages: [],
  eventSource: null,
  ranking: { scope: 'room', period: 'week' },
};

// 응원 종류 — 전부 시의 심상에서 가져왔습니다.
export const CHEERS = [
  { key: 'star', icon: 'star', label: '별 하나' },
  { key: 'heart', icon: 'heart', label: '마음' },
  { key: 'leaf', icon: 'leaf', label: '잎새' },
  { key: 'sparkle', icon: 'sparkle', label: '반짝임' },
];

export const challengeToast = (c) =>
  toast(`${c.title} — ${c.description}`, { tone: 'star', iconName: 'star', ms: 5000 });
