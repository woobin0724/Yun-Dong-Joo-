import { getDb } from '../db.js';
import { dayKey } from '../lib/date.js';

/** 하루 목표 — 마디 수. 고를 수 있는 것은 셋뿐이다. 많이 고르게 하면 지키지 못한다. */
export const GOALS = [1, 2, 3];

export function getGoal(userId) {
  const row = getDb().prepare('SELECT daily_goal FROM users WHERE id = ?').get(userId);
  return row?.daily_goal ?? null;
}

export function setGoal(userId, goal) {
  const g = Number(goal);
  if (!GOALS.includes(g)) return { error: 'bad-goal' };
  getDb().prepare('UPDATE users SET daily_goal = ? WHERE id = ?').run(g, userId);
  return { ok: true, goal: g };
}

/**
 * 오늘 끝낸 마디 수. done_at 은 UTC 시각이라 앱 시간대의 날짜로 바꿔 센다.
 * SQL 에서 날짜를 자르면 자정 무렵에 하루가 어긋난다.
 */
export function nodesDoneToday(userId, today = dayKey()) {
  const rows = getDb()
    .prepare('SELECT done_at FROM node_progress WHERE user_id = ? AND done_at IS NOT NULL')
    .all(userId);
  return rows.filter((r) => dayKey(new Date(r.done_at)) === today).length;
}

export function goalState(userId) {
  const goal = getGoal(userId);
  const done = nodesDoneToday(userId);
  return {
    goal,
    // 목표가 없으면 처음 들어온 사람이다. 화면이 온보딩을 띄운다.
    needsOnboarding: goal === null,
    doneToday: done,
    met: goal !== null && done >= goal,
  };
}
