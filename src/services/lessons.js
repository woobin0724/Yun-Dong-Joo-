import { makeRng, sample, shuffled } from '../lib/rng.js';
import { POEMS } from '../content/poems.js';
import { findNode } from '../content/journey.js';

/**
 * 레슨 엔진 — 마디 하나(2~4분)를 걸음으로 쪼갠다.
 *
 * 설계에서 지킨 것 세 가지
 *
 *  1. 답은 서버에만 있다.
 *     toClient() 가 정답을 떼어 내고 내보낸다. 채점은 grade() 가 한다.
 *     브라우저에 답을 같이 보내고 "보지 마세요" 하는 구조를 만들지 않는다.
 *
 *  2. 사람마다 다른 문제가 나온다.
 *     시드가 (사용자, 마디) 라서 같은 사람에게는 늘 같은 문제가 나오고
 *     (새로고침해도 답이 바뀌지 않는다) 사람마다는 다르다. 이전 판은
 *     모두에게 같은 문제를 같은 보기 순서로 냈다.
 *
 *  3. '화자의 마음' 은 채점하지 않는다.
 *     고르면 다른 사람들이 어디를 짚었는지 분포를 보여 준다. 시를 읽고
 *     느낀 것에 정답을 매기는 순간 그건 시 수업이 아니라 받아쓰기가 된다.
 *
 * 걸음의 차례
 *   천천히 읽기 → (사람마다 다른 두 문제) → 화자의 마음 → 한 줄 감상
 */

/** 걸음마다 받는 점수. 합이 한 마디의 만점이다. */
export const STEP_POINTS = {
  'slow-read': 10,
  cloze: 15,
  order: 15,
  diction: 15,
  feeling: 10,
  response: 20,
};

/** 한 줄 감상의 최소 길이. 이보다 짧으면 받지 않는다. */
export const MIN_RESPONSE = 15;

const poemById = (id) => POEMS.find((p) => p.id === id) ?? null;
const allLines = (poem) => poem.stanzas.flat();

/**
 * 시 본문에 실제로 나오는 낱말만 고른다.
 * keywords 에 적혀 있어도 본문에 없으면 빈칸을 뚫을 수 없다.
 */
function wordsInBody(poem) {
  const body = allLines(poem).join(' ');
  return (poem.keywords ?? []).filter((w) => body.includes(w));
}

/** 다른 시에서 가져온, 이 시에는 없는 낱말들. 오답 보기로 쓴다. */
function foreignWords(poem) {
  const body = allLines(poem).join(' ');
  const mine = new Set(poem.keywords ?? []);
  const out = new Set();
  for (const other of POEMS) {
    if (other.id === poem.id) continue;
    for (const w of other.keywords ?? []) {
      if (!mine.has(w) && !body.includes(w)) out.add(w);
    }
  }
  return [...out];
}

// ───────────────────────── 걸음 만들기 ─────────────────────────

/** 천천히 읽기 — 연을 하나씩. 채점하지 않는다. */
function buildSlowRead(poem) {
  return {
    type: 'slow-read',
    points: STEP_POINTS['slow-read'],
    prompt: '한 연씩 천천히 읽어 보세요.',
    stanzas: poem.stanzas,
    // 연마다 머물러야 하는 최소 시간. 글자 수에 비례하되 위아래를 묶는다.
    // 넘기기 버튼을 바로 누르고 지나가면 '읽었다' 가 거짓이 된다.
    dwellMs: poem.stanzas.map((st) =>
      Math.min(12000, Math.max(2500, st.join('').length * 110)),
    ),
  };
}

/** 빈칸 — 본문의 시어 하나를 지우고 네 보기에서 고른다. */
function buildCloze(rng, poem) {
  const candidates = wordsInBody(poem);
  if (!candidates.length) return null;

  const word = candidates[Math.floor(rng() * candidates.length)];
  const lines = allLines(poem);
  const hits = lines.filter((l) => l.includes(word));
  const line = hits[Math.floor(rng() * hits.length)];

  const wrong = sample(rng, foreignWords(poem), 3);
  if (wrong.length < 3) return null;

  const options = shuffled(rng, [word, ...wrong]);
  return {
    type: 'cloze',
    points: STEP_POINTS.cloze,
    prompt: '빈칸에 들어갈 말을 고르세요.',
    line: line.replaceAll(word, '____'),
    options,
    answer: options.indexOf(word),
  };
}

/** 행 순서 — 한 연의 행을 섞어 놓고 제자리로 돌린다. */
function buildOrder(rng, poem) {
  const usable = poem.stanzas.filter((st) => st.length >= 3 && st.length <= 5);
  if (!usable.length) return null;

  const stanza = usable[Math.floor(rng() * usable.length)];
  let scrambled = shuffled(rng, stanza);
  // 섞었는데 원래와 같으면 문제가 되지 않는다. 한 번 더 섞는다.
  let guard = 0;
  while (scrambled.join('\u0000') === stanza.join('\u0000') && guard++ < 8) {
    scrambled = shuffled(rng, stanza);
  }

  return {
    type: 'order',
    points: STEP_POINTS.order,
    prompt: '흩어진 행을 제자리로 돌려 놓으세요.',
    lines: scrambled,
    answer: stanza,
  };
}

/** 시어 고르기 — 이 시에 없는 말을 찾는다. 본문을 읽어야만 풀린다. */
function buildDiction(rng, poem) {
  const mine = wordsInBody(poem);
  if (mine.length < 3) return null;
  const outsider = sample(rng, foreignWords(poem), 1)[0];
  if (!outsider) return null;

  const options = shuffled(rng, [...sample(rng, mine, 3), outsider]);
  return {
    type: 'diction',
    points: STEP_POINTS.diction,
    prompt: '이 시에 나오지 않는 말은 어느 것일까요?',
    options,
    answer: options.indexOf(outsider),
  };
}

/**
 * 화자의 마음 — 채점하지 않는다. 고르면 분포를 돌려준다.
 *
 * 여기만 시드가 사람이 아니라 **마디**다. 다른 문제는 사람마다 달라야 하지만
 * 이것은 모두가 같은 보기를 받아야 한다. 보기가 사람마다 다르면
 * "n명 중 x%가 같은 곳을 짚었습니다" 가 거짓이 된다. 내가 못 본 보기에
 * 들어간 표까지 분모에 들어가기 때문이다. (실제로 그렇게 만들었다가
 * 분포 합이 전체와 안 맞는 것을 테스트가 잡아냈다.)
 */
function buildFeeling(_rng, poem, nodeId) {
  const themes = poem.themes ?? [];
  if (themes.length < 2) return null;
  const rng = makeRng(`feeling:${nodeId}`);
  // 이 시의 결 중 둘, 다른 시의 결 중 둘. 어느 쪽도 오답이 아니다.
  const others = [...new Set(POEMS.flatMap((p) => (p.id === poem.id ? [] : p.themes ?? [])))]
    .filter((t) => !themes.includes(t))
    .sort(); // 마디마다 같은 출발점에서 뽑도록 차례를 못박는다
  const options = shuffled(rng, [...sample(rng, themes, 2), ...sample(rng, others, 2)]);
  return {
    type: 'feeling',
    points: STEP_POINTS.feeling,
    prompt: '이 시를 읽고 가장 크게 남은 것은 무엇인가요?',
    note: '맞고 틀림이 없습니다. 고르면 다른 사람들이 어디를 짚었는지 보여 드립니다.',
    options,
    answer: null,
  };
}

/** 한 줄 감상 — 자기 말로 한 줄. */
function buildResponse(poem) {
  return {
    type: 'response',
    points: STEP_POINTS.response,
    prompt: `「${poem.title}」에서 가장 오래 머문 한 줄과, 그 까닭을 적어 보세요.`,
    minLength: MIN_RESPONSE,
    answer: null,
  };
}

/**
 * 마디 하나의 걸음 목록을 만든다. (userId, nodeId) 가 같으면 항상 같다.
 * @returns {{nodeId:string, poemId:string, title:string, steps:object[]}|null}
 */
export function buildLesson(userId, nodeId) {
  const node = findNode(nodeId);
  if (!node) return null;
  const poem = poemById(node.poemId);
  if (!poem) return null;

  const rng = makeRng(`lesson:${userId}:${nodeId}`);

  // 가운데 두 문제는 사람마다 다른 종류가 나온다.
  const builders = shuffled(rng, [buildCloze, buildOrder, buildDiction]);
  const middle = [];
  for (const build of builders) {
    if (middle.length === 2) break;
    const step = build(rng, poem);
    if (step) middle.push(step);
  }

  const steps = [buildSlowRead(poem), ...middle];
  const feeling = buildFeeling(rng, poem, nodeId);
  if (feeling) steps.push(feeling);
  steps.push(buildResponse(poem));

  return { nodeId, poemId: poem.id, title: poem.title, steps };
}

/** 답을 떼어 내고 브라우저로 보낼 모양으로 바꾼다. */
export function toClient(lesson) {
  return {
    nodeId: lesson.nodeId,
    poemId: lesson.poemId,
    title: lesson.title,
    totalPoints: lesson.steps.reduce((sum, s) => sum + s.points, 0),
    steps: lesson.steps.map(({ answer, ...rest }, i) => ({ index: i, ...rest })),
  };
}

/**
 * 걸음 하나를 채점한다.
 * @returns {{ok:boolean, correct:boolean|null, points:number, reveal:any, message:string}}
 */
export function grade(step, submission) {
  switch (step.type) {
    case 'slow-read': {
      // 연을 다 넘겼는지만 본다. 머문 시간은 브라우저가 지키고,
      // 서버는 연 수가 맞는지만 확인한다. 시간을 서버가 재면 느린
      // 네트워크에서 제대로 읽은 사람이 손해를 본다.
      const seen = Number(submission?.stanzasSeen);
      const ok = Number.isInteger(seen) && seen >= step.stanzas.length;
      return {
        ok,
        correct: null,
        points: ok ? step.points : 0,
        reveal: null,
        message: ok ? '' : '아직 다 읽지 않았습니다.',
      };
    }

    case 'cloze':
    case 'diction': {
      const choice = submission?.choice;
      if (choice === null || choice === undefined || choice === '') {
        return { ok: false, correct: null, points: 0, reveal: null, message: '보기를 골라 주세요.' };
      }
      const n = Number(choice);
      if (!Number.isInteger(n) || n < 0 || n >= step.options.length) {
        return { ok: false, correct: null, points: 0, reveal: null, message: '없는 보기입니다.' };
      }
      const correct = n === step.answer;
      return {
        ok: true,
        correct,
        points: correct ? step.points : 0,
        // 틀려도 정답을 보여 준다. 알려 주지 않으면 다시 풀 수가 없다.
        reveal: { answer: step.answer, word: step.options[step.answer] },
        message: correct ? '' : `정답은 "${step.options[step.answer]}" 입니다.`,
      };
    }

    case 'order': {
      const given = submission?.lines;
      if (!Array.isArray(given) || given.length !== step.answer.length) {
        return { ok: false, correct: null, points: 0, reveal: null, message: '행을 모두 놓아 주세요.' };
      }
      const correct = given.every((l, i) => l === step.answer[i]);
      return {
        ok: true,
        correct,
        points: correct ? step.points : 0,
        reveal: { lines: step.answer },
        message: correct ? '' : '시인이 놓은 차례는 이렇습니다.',
      };
    }

    case 'feeling': {
      const n = Number(submission?.choice);
      if (!Number.isInteger(n) || n < 0 || n >= step.options.length) {
        return { ok: false, correct: null, points: 0, reveal: null, message: '하나를 골라 주세요.' };
      }
      // correct 가 null 이다. 맞고 틀림이 없다는 뜻이며, 화면도 그렇게 그린다.
      return { ok: true, correct: null, points: step.points, reveal: null, message: '' };
    }

    case 'response': {
      const text = String(submission?.text ?? '').trim();
      if (text.length < step.minLength) {
        return {
          ok: false,
          correct: null,
          points: 0,
          reveal: null,
          message: `${step.minLength}자 이상 적어 주세요. (지금 ${text.length}자)`,
        };
      }
      return { ok: true, correct: null, points: step.points, reveal: null, message: '' };
    }

    default:
      return { ok: false, correct: null, points: 0, reveal: null, message: '모르는 걸음입니다.' };
  }
}
