import { getDb } from '../db.js';
import { dayKey, daysBetween } from '../lib/date.js';
import { listMembers } from './rooms.js';
import { computeStreakState } from './stats.js';
import { NODES } from '../content/journey.js';
import { goalState } from './goal.js';

/**
 * 선생님 보기 — 반 학생이 각자 얼마나 걸었는지.
 *
 * 숫자만 보인다. 학생이 쓴 한 줄 감상이나 필사의 원문은 여기서 볼 수 없다.
 * 원문은 학생이 '방에 나누기' 를 눌렀을 때만 방에 나온다. 선생님이 늘 읽을 수
 * 있다고 생각하면 학생은 시가 아니라 선생님에게 쓴다.
 *
 * '멈춤' 은 사흘 넘게 아무것도 안 한 사람이다. 혼내라는 표시가 아니라 말을 걸어
 * 보라는 표시다.
 */
export const STALL_DAYS = 3;

export function roomProgress(roomId, today = dayKey()) {
  const db = getDb();
  // 방을 만든 사람(선생님)은 살필 대상이 아니다. 넣었더니 선생님이 늘 '멈춤' 으로
  // 맨 위에 올라왔다.
  const members = listMembers(roomId).filter((m) => m.role !== 'owner');
  const rows = members.map((m) => {
    const days = db
      .prepare('SELECT DISTINCT day FROM points_ledger WHERE user_id = ? AND amount > 0 ORDER BY day')
      .all(m.id)
      .map((r) => r.day);
    const { streak } = computeStreakState(days, today);
    const last = days.at(-1) ?? null;
    const idle = last ? daysBetween(today, last) : null;
    const nodesDone = Number(
      db.prepare('SELECT COUNT(*) AS n FROM node_progress WHERE user_id = ? AND done_at IS NOT NULL').get(m.id).n,
    );
    const transcribed = Number(
      db.prepare('SELECT COUNT(DISTINCT poem_id) AS n FROM transcriptions WHERE user_id = ?').get(m.id).n,
    );
    const openMistakes = Number(
      db.prepare('SELECT COUNT(*) AS n FROM mistakes WHERE user_id = ? AND resolved_at IS NULL').get(m.id).n,
    );
    const goal = goalState(m.id);
    return {
      id: m.id,
      name: m.displayName,
      role: m.role,
      nodesDone,
      totalNodes: NODES.length,
      streak,
      lastActive: last,
      idleDays: idle,
      stalled: idle === null || idle > STALL_DAYS,
      transcribed,
      openMistakes,
      goalMetToday: goal.met,
    };
  });
  // 멈춘 사람을 위로. 말을 걸어야 할 사람이 먼저 보여야 한다.
  rows.sort((a, b) => Number(b.stalled) - Number(a.stalled) || (b.idleDays ?? 999) - (a.idleDays ?? 999) || a.nodesDone - b.nodesDone);
  return {
    members: rows,
    summary: {
      count: rows.length,
      stalled: rows.filter((r) => r.stalled).length,
      metToday: rows.filter((r) => r.goalMetToday).length,
    },
  };
}
