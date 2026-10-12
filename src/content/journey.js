import { POEMS } from './poems.js';

/**
 * 「동주의 길」 — 장(章)과 마디.
 *
 * ─────────────────────────────────────────────────────────────
 * 사실과 길잡이를 가르는 선
 * ─────────────────────────────────────────────────────────────
 * 장의 차례(명동촌 → 용정 → 평양 → 서울 → 도쿄·교토 → 후쿠오카)는
 * 이 앱을 만들라고 받은 지시서에 적혀 있던 것이다. 내가 지어낸 순서가
 * 아니다. 그래서 길잡이(네비게이션)로는 쓴다.
 *
 * 그러나 "윤동주가 몇 년에 어디에 있었고 무엇을 했는가" 는 사실이다.
 * 이 사실들은 아직 출처 본문으로 확인하지 못했다. 확인하려고 했으나
 * 이 환경의 네트워크 정책이 백과사전·위키백과·국사편찬위원회를 모두
 * 막고 있었다(CONNECT 403). 그래서 전부 verified: false 로 두었고,
 * verified 가 false 인 사실은 API 응답에서 빠진다(services/journey.js).
 * 화면에는 지어낸 이야기 대신 "아직 출처 대조가 되지 않았습니다" 가 뜬다.
 *
 * 확인하는 방법: source_url 을 열어 story 와 years 가 그 글에 실제로
 * 적혀 있는지 보고, 맞으면 verified 를 true 로, last_checked 를 그날
 * 날짜로 바꾼다. 비슷한 말이 적혀 있다고 통과시키면 안 된다.
 *
 * ─────────────────────────────────────────────────────────────
 * 마디에 시를 어떻게 나눠 넣었는가
 * ─────────────────────────────────────────────────────────────
 * **창작 연도**로만 나눴다. 시가 쓰인 해는 poems.js 에 이미 있는 값이다.
 *
 * "이 시는 서울에서 썼다" 는 말은 하지 않는다. 그것도 확인하지 못한
 * 사실이기 때문이다. 장은 '그 무렵에 쓴 시를 함께 읽는 단위' 이고,
 * 화면에도 그렇게 적는다(chapterNote).
 *
 * 그래서 1938년 이전 장(명동촌·용정·평양)과 마지막 장(후쿠오카)에는
 * 읽을 시가 하나도 없다. 비어 있는 것이 사실이다. 채우려고 시를 옮겨
 * 놓지 않는다. 후쿠오카에 시가 없는 것은 그 자체로 이 길의 끝이다.
 */

/** 출처를 확인하지 못한 사실에 공통으로 붙는 꼬리표. */
const UNVERIFIED = {
  source_name: '한국민족문화대백과사전 「윤동주」',
  source_url: 'https://encykorea.aks.ac.kr/Article/E0042533',
  verified: false,
  last_checked: null,
};

/**
 * 장. years 와 story 는 사실이므로 verified 가 true 일 때만 내보낸다.
 * place 와 ord 는 지시서가 준 길잡이라 늘 내보낸다.
 *
 * @typedef {{id:string, ord:number, place:string, hint:string,
 *            years:string|null, story:string|null,
 *            source_name:string, source_url:string,
 *            verified:boolean, last_checked:string|null,
 *            yearsCovered:number[]}} Chapter
 */

/** @type {Chapter[]} */
export const CHAPTERS = [
  {
    id: 'myeongdong',
    ord: 1,
    place: '명동촌',
    hint: '태어난 마을',
    years: null,
    story: null,
    ...UNVERIFIED,
    yearsCovered: [],
  },
  {
    id: 'yongjeong',
    ord: 2,
    place: '용정',
    hint: '학교를 다닌 곳',
    years: null,
    story: null,
    ...UNVERIFIED,
    yearsCovered: [],
  },
  {
    id: 'pyongyang',
    ord: 3,
    place: '평양',
    hint: '숭실',
    years: null,
    story: null,
    ...UNVERIFIED,
    yearsCovered: [],
  },
  {
    id: 'seoul',
    ord: 4,
    place: '서울',
    hint: '연희전문',
    years: null,
    story: null,
    ...UNVERIFIED,
    yearsCovered: [1938, 1939, 1940, 1941],
  },
  {
    id: 'tokyo-kyoto',
    ord: 5,
    place: '도쿄 · 교토',
    hint: '바다 건너',
    years: null,
    story: null,
    ...UNVERIFIED,
    yearsCovered: [1942],
  },
  {
    id: 'fukuoka',
    ord: 6,
    place: '후쿠오카',
    hint: '마지막',
    years: null,
    story: null,
    ...UNVERIFIED,
    yearsCovered: [],
  },
];

/** 장이 시를 어떤 기준으로 모았는지 화면에 그대로 적는다. */
export const CHAPTER_NOTE =
  '장은 그 무렵에 **쓴** 시를 함께 읽는 단위입니다. ' +
  '시를 어디에서 썼는지는 아직 출처로 확인하지 못해, 장소와 작품을 잇지 않았습니다.';

const year = (poem) => Number(String(poem.written).slice(0, 4));

/**
 * 마디. 장 하나에 그 해에 쓴 시가 차례로 들어간다.
 * 순서는 쓴 날짜 순. 같은 날이면 poems.js 에 적힌 차례를 따른다.
 */
export const NODES = CHAPTERS.flatMap((chapter) => {
  if (!chapter.yearsCovered.length) return [];
  const mine = POEMS.filter((p) => chapter.yearsCovered.includes(year(p))).sort((a, b) =>
    String(a.written).localeCompare(String(b.written)),
  );
  return mine.map((poem, i) => ({
    id: `${chapter.id}-${poem.id}`,
    chapterId: chapter.id,
    ord: i + 1,
    poemId: poem.id,
    title: poem.title,
  }));
});

/** 장 하나에 든 마디 수. 지도에서 "3 / 15" 를 그릴 때 쓴다. */
export function nodesOfChapter(chapterId) {
  return NODES.filter((n) => n.chapterId === chapterId);
}

export function findNode(nodeId) {
  return NODES.find((n) => n.id === nodeId) ?? null;
}

export function findChapter(chapterId) {
  return CHAPTERS.find((c) => c.id === chapterId) ?? null;
}
