import { getDb, now, transaction } from '../db.js';
import { AppError } from './users.js';

/**
 * 계정 지우기.
 *
 * 되돌릴 수 없다. 그래서 아이디를 한 번 더 적게 해서 누르다 지우는 일을 막는다.
 *
 * 지우는 것
 *   - 계정과 로그인 수단(구글 연결 포함), 세션
 *   - 걸어온 길, 한 줄 감상, 필사, 오답 노트, 시험, 점수, 도전과제, 알림 설정
 *   - **방에 쓴 글과 응원.** 학생이 쓴 글은 학생의 것이다. 표가 기본으로는
 *     작성자만 비우고 글을 남기게(SET NULL) 되어 있어 여기서 따로 지운다.
 *   - 내가 한 신고와 차단
 *
 * 남기는 것
 *   - 내가 만든 방. 방장 자리는 가장 먼저 들어온 사람에게 넘긴다. 넘기지 않으면
 *     운영자가 없는 방이 남아 아무도 글을 가리지 못한다. 남은 사람이 없으면 방을
 *     지운다.
 */
export function deleteAccount({ userId, confirmHandle }) {
  const db = getDb();
  const user = db.prepare('SELECT id, handle FROM users WHERE id = ?').get(userId);
  if (!user) throw new AppError('계정을 찾을 수 없습니다.', 404, 'user_not_found');
  if (String(confirmHandle ?? '').trim() !== user.handle) {
    throw new AppError('아이디를 정확히 적어 주세요. 지운 계정은 되돌릴 수 없습니다.', 400, 'confirm_mismatch');
  }

  return transaction(() => {
    const owned = db
      .prepare("SELECT room_id FROM room_members WHERE user_id = ? AND role = 'owner'")
      .all(userId)
      .map((r) => Number(r.room_id));

    const handedOver = [];
    const removedRooms = [];
    for (const roomId of owned) {
      const heir = db
        .prepare(
          `SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?
            ORDER BY joined_at ASC, user_id ASC LIMIT 1`,
        )
        .get(roomId, userId);
      if (heir) {
        db.prepare("UPDATE room_members SET role = 'owner' WHERE room_id = ? AND user_id = ?").run(roomId, heir.user_id);
        handedOver.push(roomId);
      } else {
        db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
        removedRooms.push(roomId);
      }
    }

    // 방에 쓴 글. 응원·신고는 메시지를 따라 지워진다.
    const messages = db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId).changes;
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    return { deleted: true, messages: Number(messages), handedOver, removedRooms, at: now() };
  });
}
