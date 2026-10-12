import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, caretCell, COLS } from '../public/manuscript.js';

// 칸을 한 줄 글자로 보이게. 공백은 _ 로.
const rows = (text, cols = COLS) => layout(text, cols).map((r) => r.join('').replaceAll(' ', '_'));

test('한 칸에 한 글자, 열 칸이 차면 다음 줄', () => {
  assert.deepEqual(rows('가나다라마바사아자차카타'), ['가나다라마바사아자차', '카타']);
});

test('줄 끝에서 넘어간 띄어쓰기는 다음 줄 첫 칸을 비우지 않는다', () => {
  // "죽는 날까지 하늘을" 이 정확히 열 칸이고, 그 뒤 공백이 다음 줄 맨 앞에 온다.
  assert.deepEqual(rows('죽는 날까지 하늘을 우러러'), ['죽는_날까지_하늘을', '우러러']);
});

test('일부러 줄을 바꾸고 띄운 들여쓰기는 살린다', () => {
  assert.deepEqual(rows('첫 줄\n  들여 쓴 줄'), ['첫_줄', '__들여_쓴_줄']);
});

test('줄바꿈은 남은 칸을 비우고 다음 줄로 간다', () => {
  assert.deepEqual(rows('하늘\n바람\n별'), ['하늘', '바람', '별']);
});

test('글자는 코드 포인트로 센다 — 이모지가 두 칸을 먹지 않는다', () => {
  assert.equal(layout('별🌟별', 10)[0].length, 3);
});

test('커서 칸은 layout 과 같은 규칙을 따른다', () => {
  // 열 칸이 꽉 차면 커서는 다음 줄 첫 칸.
  const at = (t) => caretCell(t, t.length, 10); // 커서가 글 맨 끝에 있을 때
  assert.deepEqual(at('가나다라마바사아자차'), { row: 1, col: 0 });
  // 줄 끝 공백 뒤에서도 한 칸 어긋나지 않는다.
  assert.deepEqual(at('죽는 날까지 하늘을 '), { row: 1, col: 0 });
  assert.deepEqual(at('죽는 날까지 하늘을 우'), { row: 1, col: 1 });
  // 커서가 글 중간에 있으면 그 앞까지만 센다.
  assert.deepEqual(caretCell('하늘과 바람과', 2, 10), { row: 0, col: 2 });
});
