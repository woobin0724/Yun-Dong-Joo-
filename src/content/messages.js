import { makeRng, pick } from '../lib/rng.js';
import { eulReul, eunNeun, iGa } from '../lib/korean.js';

/**
 * 봇(‘동주 알림이’)이 방에 올리는 말들.
 *
 * 성인 학습자를 대상으로 하므로 과장된 칭찬 대신 담백한 인정과
 * 시의 한 구절을 곁들이는 쪽을 택했다.
 */

export const BOT_NAME = '동주 알림이';

/** 미션을 마쳤을 때 */
const MISSION_DONE = [
  '{name} 님이 오늘 몫을 마쳤습니다.',
  '{name} 님, 오늘도 한 걸음.',
  '{name} 님이 시 한 편을 지나왔습니다.',
  '{name} 님의 오늘이 기록되었습니다.',
  '{name} 님, 잘 읽으셨습니다.',
];

/** 연속 달성일에 따라 붙는 말 */
const STREAK_NOTES = [
  { min: 28, text: '{days}일째. 이제 이건 습관입니다.' },
  { min: 14, text: '{days}일 연속. 두 주를 건너오셨네요.' },
  { min: 7, text: '{days}일 연속 — 이레를 채우셨습니다.' },
  { min: 3, text: '{days}일 연속입니다. 이어 가는 힘이 보입니다.' },
  { min: 2, text: '이틀째입니다.' },
];

/** 도전과제를 달성했을 때 */
const CHALLENGE_LINES = [
  '{name} 님이 「{title}」{eulReul} 얻었습니다. {desc}',
  '축하합니다. {name} 님, 「{title}」 달성. {desc}',
  '{name} 님의 이름 옆에 「{title}」{iGa} 붙었습니다. {desc}',
];

/**
 * 응원의 종류. 넷 다 윤동주의 시에 나오는 심상에서 가져왔다.
 * icon 은 화면의 아이콘 스프라이트 이름이다 (이모지를 쓰지 않는다 —
 * 기기마다 모양이 달라 통일감이 깨지기 때문).
 */
export const CHEER_LABELS = [
  { key: 'star', icon: 'star', label: '별 하나' },
  { key: 'heart', icon: 'heart', label: '마음' },
  { key: 'leaf', icon: 'leaf', label: '잎새' },
  { key: 'sparkle', icon: 'sparkle', label: '반짝임' },
];

export const CHEER_BY_KEY = new Map(CHEER_LABELS.map((c) => [c.key, c]));

/** 오늘의 시 알림 문구 */
const POEM_INTROS = [
  '오늘의 시는 「{title}」입니다.',
  '오늘은 「{title}」{eulReul} 펼칩니다.',
  '「{title}」 — 오늘 우리가 읽을 시입니다.',
  '오늘 몫의 시, 「{title}」.',
];

/** 오래 쉬었다 돌아온 사람에게 */
const WELCOME_BACK = [
  '{name} 님이 돌아오셨습니다. 쉰 날은 셈하지 않습니다.',
  '{name} 님, 다시 오셨네요. 오늘부터 다시 세면 됩니다.',
  '{name} 님의 자리에 다시 불이 켜졌습니다.',
];

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

/** 같은 상황에서 늘 같은 문장이 나오지 않도록 seed 로 변주를 준다. */
function choose(list, seed) {
  return pick(makeRng(seed), list);
}

export function missionDoneMessage({ name, streak, seed }) {
  const base = fill(choose(MISSION_DONE, `mission:${seed}`), { name });
  const note = STREAK_NOTES.find((n) => streak >= n.min);
  return note ? `${base} ${fill(note.text, { days: streak })}` : base;
}

export function challengeMessage({ name, challenge, seed }) {
  return fill(choose(CHALLENGE_LINES, `challenge:${seed}`), {
    name,
    title: challenge.title,
    desc: challenge.description,
    eulReul: eulReul(challenge.title),
    iGa: iGa(challenge.title),
  });
}

export function poemAnnouncement({ poem, seed }) {
  return fill(choose(POEM_INTROS, `poem:${seed}`), {
    title: poem.title,
    eulReul: eulReul(poem.title),
    eunNeun: eunNeun(poem.title),
  });
}

export function welcomeBackMessage({ name, seed }) {
  return fill(choose(WELCOME_BACK, `back:${seed}`), { name });
}

/** 새 사람이 방에 들어왔을 때 */
export function memberJoinedMessage({ name }) {
  return `${name} 님이 방에 들어왔습니다. 반갑습니다.`;
}

/** 랭킹 주간 마감 안내 */
export function weeklyWrapMessage({ top }) {
  if (!top.length) return '이번 주는 기록이 없습니다. 다음 주에 다시 시작해요.';
  const lines = top
    .slice(0, 3)
    .map((r, i) => `${i + 1}위  ${r.displayName}  ${r.points}점`);
  return ['한 주가 마감되었습니다.', ...lines, '다음 주 점수는 0에서 다시 시작합니다.'].join('\n');
}
