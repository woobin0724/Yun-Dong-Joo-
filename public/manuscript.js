/* 원고지 칸 셈 — DOM 도 다른 모듈도 쓰지 않습니다.
   그래야 서버 쪽 테스트(node --test)가 이 파일을 그대로 불러 규칙을 묶을 수 있습니다. */

export const COLS = 10; // 한 줄 열 칸. 좁은 화면에서 한 칸이 손가락만 해지는 상한.

/**
 * 글을 원고지 칸에 흘려 넣는다.
 * @returns {{char:string, nl:boolean}[][]} 줄별 칸 배열
 */
export function layout(text, cols = COLS) {
  const rows = [];
  let row = [];
  // 칸이 다 차서 저절로 넘어간 줄인지. 사용자가 줄을 바꾼 것과 구별해야 한다.
  let wrapped = false;
  for (const ch of String(text)) {
    if (ch === '\n') {
      rows.push(row);
      row = [];
      wrapped = false;
      continue;
    }
    // 원고지에서는 줄 끝에서 띄어 쓸 자리가 오면 다음 줄 첫 칸을 비우지
    // 않는다. 저절로 넘어간 줄의 맨 앞 공백은 버린다. 사용자가 일부러
    // 줄을 바꾸고 띄운 것(들여쓰기)은 그대로 둔다.
    if (wrapped && row.length === 0 && ch === ' ') {
      wrapped = false;
      continue;
    }
    wrapped = false;
    row.push(ch);
    if (row.length === cols) {
      rows.push(row);
      row = [];
      wrapped = true;
    }
  }
  rows.push(row);
  return rows;
}

/** 지금 글자가 들어갈 칸의 번호. 커서를 그 자리에 둔다. */
export function caretCell(text, caret, cols = COLS) {
  // layout() 과 같은 규칙으로 센다. 따로 세면 줄 끝 공백에서 커서가 한 칸 어긋난다.
  const rows = layout(String(text).slice(0, caret), cols);
  const last = rows.length - 1;
  const col = rows[last].length;
  if (col === cols) return { row: last + 1, col: 0 };
  return { row: last, col };
}

