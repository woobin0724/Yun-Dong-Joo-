import { getDb } from '../db.js';
import { POEMS } from '../content/poems.js';
import { AppError } from './users.js';
import { postMessage } from './chat.js';

/**
 * 감상 나누기 — 내가 쓴 것을 방에 올린다.
 *
 * 방은 잡담방이 아니라 감상 피드다. 길에서 남긴 한 줄, 원고지에 옮겨 적은 시를
 * 골라 올린다. 남이 쓴 것은 올릴 수 없다(id 로 남의 글을 끌어오는 길을 막는다).
 */
export function shareToRoom({ roomId, userId, type, id }) {
  const db = getDb();
  const n = Number(id);
  if (type === 'response') {
    const r = db.prepare('SELECT * FROM responses WHERE id = ? AND user_id = ?').get(n, userId);
    if (!r) throw new AppError('나눌 글을 찾을 수 없습니다.', 404, 'share_not_found');
    const title = POEMS.find((p) => p.id === r.poem_id)?.title ?? r.poem_id;
    return postMessage({
      roomId,
      userId,
      body: r.text,
      kind: 'share',
      meta: { source: 'response', poemId: r.poem_id, poemTitle: title },
    });
  }
  if (type === 'transcription') {
    const t = db.prepare('SELECT * FROM transcriptions WHERE id = ? AND user_id = ?').get(n, userId);
    if (!t) throw new AppError('나눌 필사를 찾을 수 없습니다.', 404, 'share_not_found');
    const title = POEMS.find((p) => p.id === t.poem_id)?.title ?? t.poem_id;
    return postMessage({
      roomId,
      userId,
      body: t.text,
      kind: 'share',
      meta: { source: 'transcription', poemId: t.poem_id, poemTitle: title, chars: t.chars },
    });
  }
  throw new AppError('나눌 수 있는 것은 한 줄 감상과 필사뿐입니다.', 400, 'bad_share_type');
}
