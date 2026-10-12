import { Router } from 'express';
import {
  createRoom,
  joinRoomByCode,
  listRoomsForUser,
  listMembers,
  getRoom,
  assertMember,
  leaveRoom,
} from '../services/rooms.js';
import { listMessages, postMessage, toggleCheer, postBotMessage } from '../services/chat.js';
import { refreshChallenges } from '../services/activity.js';
import { subscribe } from '../lib/bus.js';
import { leaderboard, rankOf } from '../services/points.js';
import { requireAuth, asyncRoute, rateLimit } from './middleware.js';
import { config } from '../config.js';
import { AppError } from '../services/users.js';
import { memberJoinedMessage } from '../content/messages.js';

import {
  forViewer,
  roleIn,
  blockedIds,
  reportMessage,
  setHidden,
  assertOwner,
  REPORT_REASONS,
} from '../services/moderation.js';
import { roomProgress } from '../services/room-progress.js';
import { shareToRoom } from '../services/share.js';

export const roomsRouter = Router();

roomsRouter.use(requireAuth);

roomsRouter.get('/', (req, res) => {
  res.json({ rooms: listRoomsForUser(req.user.id) });
});

roomsRouter.post(
  '/',
  asyncRoute((req, res) => {
    const room = createRoom({ name: req.body?.name, userId: req.user.id });
    postBotMessage({
      roomId: room.id,
      kind: 'notice',
      body:
        `「${room.name}」 방이 열렸습니다.\n` +
        `초대 코드는 ${room.code} 입니다. 함께 읽을 사람에게 알려 주세요.`,
      meta: { roomCreated: true },
    });
    res.status(201).json({ room });
  }),
);

// 초대 코드는 6자리뿐이라, 제한이 없으면 남의 방을 찾아낼 수 있다.
const joinLimit = rateLimit({
  ...config.joinRateLimit,
  key: (req) => `join:${req.user?.id ?? req.ip}`,
});

roomsRouter.post(
  '/join',
  joinLimit,
  asyncRoute((req, res) => {
    const { room, joined } = joinRoomByCode({ code: req.body?.code, userId: req.user.id });
    if (joined) {
      postBotMessage({
        roomId: room.id,
        kind: 'notice',
        body: memberJoinedMessage({ name: req.user.displayName }),
        meta: { userId: req.user.id },
      });
    }
    res.json({ room, joined });
  }),
);

roomsRouter.get('/:id', (req, res, next) => {
  const roomId = Number(req.params.id);
  const room = getRoom(roomId);
  if (!room) return next(new AppError('그런 방이 없습니다.', 404, 'room_not_found'));
  assertMember(roomId, req.user.id);
  res.json({ room, members: listMembers(roomId) });
});

roomsRouter.post(
  '/:id/leave',
  asyncRoute((req, res) => {
    const roomId = Number(req.params.id);
    assertMember(roomId, req.user.id);
    leaveRoom({ roomId, userId: req.user.id });
    res.json({ ok: true });
  }),
);

// ── 채팅 ────────────────────────────────────────────────────

roomsRouter.get(
  '/:id/messages',
  asyncRoute((req, res) => {
    const roomId = Number(req.params.id);
    assertMember(roomId, req.user.id);
    const view = viewerOf(roomId, req.user.id);
    res.json({
      messages: listMessages({
        roomId,
        limit: Number(req.query.limit) || 50,
        beforeId: req.query.before ? Number(req.query.before) : null,
        afterId: req.query.after ? Number(req.query.after) : null,
      })
        .map((m) => forViewer(m, view))
        .filter(Boolean),
      isOwner: view.isOwner,
      reportReasons: REPORT_REASONS,
    });
  }),
);

roomsRouter.post(
  '/:id/messages',
  asyncRoute((req, res) => {
    const roomId = Number(req.params.id);
    const message = postMessage({
      roomId,
      userId: req.user.id,
      body: req.body?.body,
      kind: 'chat',
    });
    const earnedChallenges = refreshChallenges(req.user.id);
    res.status(201).json({ message, earnedChallenges });
  }),
);

roomsRouter.post(
  '/:id/messages/:messageId/cheer',
  asyncRoute((req, res) => {
    assertMember(Number(req.params.id), req.user.id);
    const result = toggleCheer({
      messageId: Number(req.params.messageId),
      userId: req.user.id,
      kind: req.body?.kind || 'star',
    });
    const earnedChallenges = refreshChallenges(req.user.id);
    res.json({ ...result, earnedChallenges });
  }),
);

/** 새 메시지를 실시간으로 받는다 (Server-Sent Events). */
roomsRouter.get('/:id/stream', (req, res, next) => {
  const roomId = Number(req.params.id);
  try {
    assertMember(roomId, req.user.id);
  } catch (err) {
    return next(err);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  // 사람마다 다른 연결이므로 보내기 전에 그 사람 눈에 맞춰 거른다.
  // 차단한 사람의 새 글은 아예 보내지 않고, 가린 글은 원문을 빼고 보낸다.
  const send = (event) => {
    const view = viewerOf(roomId, req.user.id);
    if (event.message) {
      const shown = forViewer(event.message, view);
      if (!shown) return;
      event = { ...event, message: shown };
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = subscribe(roomId, send);

  // 프록시가 끊지 않도록 주기적으로 주석 한 줄을 흘려보낸다.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  heartbeat.unref?.();

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ── 랭킹 ────────────────────────────────────────────────────

roomsRouter.get(
  '/:id/ranking',
  asyncRoute((req, res) => {
    const roomId = Number(req.params.id);
    assertMember(roomId, req.user.id);
    const period = ['week', 'month', 'all'].includes(req.query.period)
      ? req.query.period
      : 'week';
    res.json({
      period,
      ranking: leaderboard({ roomId, period, limit: 100 }),
      me: rankOf({ userId: req.user.id, roomId, period }),
    });
  }),
);

/** 이 방에서 이 사람이 무엇을 볼 수 있는지. */
function viewerOf(roomId, userId) {
  return { viewerId: userId, isOwner: roleIn(roomId, userId) === 'owner', blocked: blockedIds(userId) };
}

// ── 안전 장치 ────────────────────────────────────────────────

roomsRouter.post(
  '/:id/messages/:messageId/report',
  asyncRoute((req, res) => {
    const result = reportMessage({
      roomId: Number(req.params.id),
      messageId: Number(req.params.messageId),
      userId: req.user.id,
      reason: req.body?.reason,
    });
    res.json(result);
  }),
);

roomsRouter.post(
  '/:id/messages/:messageId/hide',
  asyncRoute((req, res) => {
    res.json(
      setHidden({
        roomId: Number(req.params.id),
        messageId: Number(req.params.messageId),
        userId: req.user.id,
        hidden: req.body?.hidden !== false,
      }),
    );
  }),
);

/** 선생님 보기 — 방을 만든 사람만. 각자 얼마나 걸었는지, 누가 멈춰 있는지. */
roomsRouter.get(
  '/:id/progress',
  asyncRoute((req, res) => {
    const roomId = Number(req.params.id);
    assertOwner(roomId, req.user.id);
    res.json(roomProgress(roomId));
  }),
);

/** 내가 쓴 한 줄 감상이나 필사를 방에 나눈다. */
roomsRouter.post(
  '/:id/share',
  asyncRoute((req, res) => {
    const message = shareToRoom({
      roomId: Number(req.params.id),
      userId: req.user.id,
      type: req.body?.type,
      id: req.body?.id,
    });
    res.status(201).json({ message });
  }),
);
