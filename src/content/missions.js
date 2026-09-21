import { POEMS, POEM_BY_ID, poemLines } from './poems.js';
import { daysBetween } from '../lib/date.js';
import { BACKGROUND_QUIZ } from './quiz-bank.js';
import { makeRng, pick, sample, shuffled } from '../lib/rng.js';
import { eulReul, eunNeun, gwaWa, euroRo } from '../lib/korean.js';

/** 시에서 `maxLen` 자 이하인 행 하나를 고른다. 없으면 첫 행을 쓴다. */
function shortLine(rng, poem, maxLen) {
  const lines = poemLines(poem);
  const short = lines.filter((l) => l.length <= maxLen);
  return short.length ? pick(rng, short) : lines[0];
}

/**
 * 미션 종류
 *  - check : 스스로 했다고 체크하는 미션 (낭독처럼 채점할 수 없는 활동)
 *  - text  : 글을 써서 제출하는 미션 (최소 글자 수로만 검사)
 *  - quiz  : 보기 중 정답을 고르는 미션 (자동 채점)
 */

/** 낭독·듣기처럼 가볍게 시작하는 미션들 */
const LIGHT = [
  {
    key: 'recite',
    kind: 'check',
    points: 20,
    build: (poem) => ({
      title: '소리 내어 읽기',
      prompt: `「${poem.title}」${eulReul(poem.title)} 처음부터 끝까지 소리 내어 한 번 읽어 보세요. 눈으로만 읽을 때와 어디가 다른지 느껴 보면 됩니다.`,
      data: {},
    }),
  },
  {
    key: 'slow-read',
    kind: 'check',
    points: 20,
    build: (poem) => ({
      title: '한 연씩 천천히',
      prompt: `「${poem.title}」${eulReul(poem.title)} 연과 연 사이에서 세 번씩 숨을 쉬며 읽어 보세요. 시가 놓아둔 빈칸을 그대로 지나가지 않는 연습입니다.`,
      data: {},
    }),
  },
  {
    key: 'memorize',
    kind: 'check',
    points: 25,
    build: (poem) => {
      const lines = poemLines(poem);
      return {
        title: '한 구절 외우기',
        prompt: `「${poem.title}」에서 한 구절만 골라 외워 보세요. 예를 들면 이런 구절입니다 — “${lines[0]}”`,
        data: {},
      };
    },
  },
];

/** 자동 채점되는 미션들 */
const QUIZ = [
  {
    key: 'cloze',
    kind: 'quiz',
    points: 25,
    build: (poem, rng) => {
      // 같은 연 안에서 "다음 행"이 존재하는 위치를 고른다.
      const spots = [];
      poem.stanzas.forEach((stanza, si) => {
        for (let li = 0; li + 1 < stanza.length; li++) spots.push([si, li]);
      });
      if (!spots.length) return null;
      const [si, li] = pick(rng, spots);
      const cue = poem.stanzas[si][li];
      const answerText = poem.stanzas[si][li + 1];

      const others = POEMS.filter((p) => p.id !== poem.id).flatMap(poemLines);
      const distractors = sample(
        rng,
        others.filter((l) => l !== answerText && l.length < 60),
        3,
      );
      const options = shuffled(rng, [answerText, ...distractors]);
      return {
        title: '다음 행 찾기',
        prompt: `「${poem.title}」에서 “${cue}” 바로 다음에 오는 행은 무엇일까요?`,
        data: { options, answer: options.indexOf(answerText) },
      };
    },
  },
  {
    key: 'keyword',
    kind: 'quiz',
    points: 20,
    build: (poem, rng) => {
      const mine = sample(rng, poem.keywords, 3);
      if (mine.length < 3) return null;
      const body = poem.stanzas.flat().join(' ');
      const foreignPool = POEMS.filter((p) => p.id !== poem.id)
        .flatMap((p) => p.keywords)
        .filter((k) => !poem.keywords.includes(k) && !body.includes(k));
      if (!foreignPool.length) return null;
      const intruder = pick(rng, foreignPool);
      const options = shuffled(rng, [...mine, intruder]);
      return {
        title: '끼어든 시어 찾기',
        prompt: `보기 중 「${poem.title}」에는 나오지 않는 말은 무엇일까요?`,
        data: { options, answer: options.indexOf(intruder) },
      };
    },
  },
  {
    key: 'background',
    kind: 'quiz',
    points: 20,
    build: (_poem, rng) => {
      const q = pick(rng, BACKGROUND_QUIZ);
      const labeled = q.options.map((text, i) => ({ text, correct: i === q.answer }));
      const options = shuffled(rng, labeled);
      return {
        title: '시인을 알아 가기',
        prompt: q.question,
        data: {
          options: options.map((o) => o.text),
          answer: options.findIndex((o) => o.correct),
          explain: q.explain,
          quizId: q.id,
        },
      };
    },
  },
  {
    key: 'written-year',
    kind: 'quiz',
    points: 20,
    build: (poem, rng) => {
      const year = Number(poem.written.slice(0, 4));
      const pool = [...new Set(POEMS.map((p) => Number(p.written.slice(0, 4))))].filter(
        (y) => y !== year,
      );
      if (pool.length < 3) return null;
      const options = shuffled(rng, [year, ...sample(rng, pool, 3)]).map((y) => `${y}년`);
      return {
        title: '언제 쓰인 시일까',
        prompt: `「${poem.title}」${eunNeun(poem.title)} 언제 쓰인 시일까요?`,
        data: { options, answer: options.indexOf(`${year}년`) },
      };
    },
  },
];

/** 글을 써서 제출하는 미션들 */
const WRITING = [
  {
    key: 'copy',
    kind: 'text',
    points: 25,
    share: false,
    build: (poem) => ({
      title: '마음에 남은 연 필사하기',
      prompt: `「${poem.title}」에서 가장 오래 머문 연을 그대로 옮겨 적어 보세요. 고르는 일 자체가 이미 감상입니다.`,
      data: { minLength: 30, placeholder: '옮겨 적은 구절을 여기에…' },
    }),
  },
  {
    key: 'reflect',
    kind: 'text',
    points: 30,
    share: true,
    build: (poem) => ({
      title: '한 줄 감상 남기기',
      prompt: `「${poem.title}」${eulReul(poem.title)} 읽고 남은 생각을 두세 문장으로 적어 보세요. 제출하면 우리 방에 함께 공유됩니다.`,
      data: { minLength: 40, placeholder: '오늘 이 시는 나에게…' },
    }),
  },
  {
    key: 'connect',
    kind: 'text',
    points: 30,
    share: true,
    build: (poem, rng) => {
      const line = shortLine(rng, poem, 40);
      return {
        title: '내 하루와 잇기',
        prompt: `“${line}” — 이 구절과 겹쳐지는 오늘 하루의 장면을 하나 적어 보세요.`,
        data: { minLength: 40, placeholder: '오늘 나는…' },
      };
    },
  },
  {
    key: 'question',
    kind: 'text',
    points: 25,
    share: true,
    build: (poem) => ({
      title: '시인에게 묻기',
      prompt: `「${poem.title}」${eulReul(poem.title)} 쓴 윤동주에게 묻고 싶은 것을 한 가지만 적어 보세요. 답이 없어도 되는 질문일수록 좋습니다.`,
      data: { minLength: 20, placeholder: '동주에게 묻습니다. ' },
    }),
  },
  {
    key: 'create',
    kind: 'text',
    points: 35,
    share: true,
    build: (poem, rng) => {
      const line = shortLine(rng, poem, 30);
      return {
        title: '한 구절 빌려 쓰기',
        prompt: `“${line}”${euroRo(line)} 시작하는 두 행짜리 시를 지어 보세요. 나머지는 온전히 당신의 말로.`,
        data: { minLength: 20, placeholder: '' },
      };
    },
  },
  {
    key: 'compare',
    kind: 'text',
    points: 35,
    share: true,
    build: (poem, rng) => {
      const other = pick(
        rng,
        POEMS.filter((p) => p.id !== poem.id && p.themes.some((t) => poem.themes.includes(t))),
      );
      if (!other) return null;
      return {
        title: '두 시 나란히 읽기',
        prompt: `「${poem.title}」${gwaWa(poem.title)} 「${other.title}」${eulReul(other.title)} 나란히 읽고, 두 시가 만나는 지점을 한 문단으로 적어 보세요.`,
        data: { minLength: 60, placeholder: '두 시는…', relatedPoemId: other.id },
      };
    },
  },
];

const GROUPS = [LIGHT, QUIZ, WRITING];

/**
 * 하루치 미션을 만든다. 같은 날짜·같은 시라면 언제 호출해도 결과가 같다.
 * 가벼운 미션 / 퀴즈 / 글쓰기에서 하나씩 뽑아 난이도가 한쪽으로 쏠리지 않게 한다.
 *
 * @param {string} day YYYY-MM-DD
 * @param {import('./poems.js').Poem} poem 오늘의 시
 * @param {number} count 만들 미션 개수
 */
export function buildDailyMissions(day, poem, count = 3) {
  const missions = [];
  const used = new Set();

  const take = (group, slot) => {
    const rng = makeRng(`${day}:${poem.id}:${slot}`);
    for (const tpl of shuffled(rng, group)) {
      if (used.has(tpl.key)) continue;
      const built = tpl.build(poem, makeRng(`${day}:${poem.id}:${tpl.key}`));
      if (!built) continue;
      used.add(tpl.key);
      missions.push({
        key: tpl.key,
        kind: tpl.kind,
        points: tpl.points,
        share: Boolean(tpl.share),
        poemId: poem.id,
        ...built,
      });
      return true;
    }
    return false;
  };

  for (let i = 0; i < count; i++) {
    const group = GROUPS[i % GROUPS.length];
    if (!take(group, i)) {
      // 해당 묶음이 동났으면 아무 묶음에서나 채운다.
      for (const g of GROUPS) if (take(g, `${i}-fallback`)) break;
    }
  }
  return missions;
}

/** 시 순환의 기준 날짜. 이 날부터 하루에 한 편씩 앞으로 나아간다. */
export const POEM_CYCLE_EPOCH = '2025-01-01';

/**
 * 그날의 시를 고른다.
 * 날짜만으로 결정되므로 모든 사용자가 같은 시를 받고,
 * 전체 작품을 한 바퀴 다 돌기 전에는 같은 시가 되풀이되지 않는다.
 */
export function poemOfTheDay(day) {
  const index = daysBetween(day, POEM_CYCLE_EPOCH);
  const cycle = Math.floor(index / POEMS.length);
  const pos = ((index % POEMS.length) + POEMS.length) % POEMS.length;
  return poemCycleOrder(cycle)[pos];
}

/**
 * 한 바퀴(= 전체 작품 수)분의 순서를 만든다.
 * 바퀴마다 순서를 새로 섞되, 앞 바퀴의 마지막 시가 이번 바퀴 첫날에 또 나오지 않도록
 * 한 칸 밀어 둔다. 어제 읽은 시를 오늘 또 받는 일만은 없게 하는 최소한의 장치다.
 */
function poemCycleOrder(cycle) {
  const order = shuffled(makeRng(`poem-cycle:${cycle}`), POEMS);
  const prevLast = shuffled(makeRng(`poem-cycle:${cycle - 1}`), POEMS).at(-1);
  if (order[0]?.id === prevLast?.id && order.length > 1) order.push(order.shift());
  return order;
}

/** 방 단위로 시를 겹치지 않게 돌리고 싶을 때 쓰는 순회 방식. */
export function poemForRoom(roomId, index) {
  const rng = makeRng(`room-order:${roomId}`);
  const order = shuffled(rng, POEMS);
  return order[index % order.length];
}

export { POEM_BY_ID };
