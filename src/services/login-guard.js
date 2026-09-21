import { AppError } from './users.js';

/**
 * 로그인 무차별 대입 방어.
 *
 * IP 로만 막으면 학교처럼 한 회선을 여럿이 나눠 쓰는 곳에서
 * 학생들이 서로를 막아 버린다. 그래서 두 겹으로 나눈다.
 *
 *   계정별 — "실패"만 센다. 남의 아이디를 두드리는 것을 막는 진짜 방어선.
 *   IP별   — 느슨하게. 한 대가 미친 듯이 두드릴 때만 걸린다.
 *
 * 메모리에만 둔다. 서버가 여러 대가 되면 공용 저장소로 옮겨야 한다
 * (lib/bus.js 와 같은 제약).
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

/** @type {Map<string, number[]>} 아이디 → 최근 실패 시각들 */
const failures = new Map();

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, times] of failures) {
    const kept = times.filter((t) => t > cutoff);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
  }
}, WINDOW_MS).unref?.();

const recent = (handle) => {
  const cutoff = Date.now() - WINDOW_MS;
  return (failures.get(handle) || []).filter((t) => t > cutoff);
};

/** 이 아이디로 더 시도해도 되는지. 안 되면 던진다. */
export function assertLoginAllowed(handle) {
  if (!handle) return;
  if (recent(handle).length >= MAX_FAILURES) {
    throw new AppError(
      '로그인 시도가 너무 많았습니다. 15분 뒤에 다시 시도해 주세요.',
      429,
      'too_many_attempts',
    );
  }
}

export function recordFailure(handle) {
  if (!handle) return;
  failures.set(handle, [...recent(handle), Date.now()]);
}

/** 들어왔으면 지금까지의 실패는 잊는다. */
export function recordSuccess(handle) {
  if (handle) failures.delete(handle);
}

/** 테스트에서 상태를 비운다. */
export function resetLoginGuard() {
  failures.clear();
}

export const failureCount = (handle) => recent(handle).length;
