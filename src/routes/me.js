import { Router } from 'express';
import { challengeBoard } from '../services/challenges.js';
import { collectStats } from '../services/stats.js';
import { dailySeries, rankOf, totalPoints } from '../services/points.js';
import { poemReadIds } from '../services/missions.js';
import { listRoomsForUser } from '../services/rooms.js';
import {
  isPushConfigured,
  publicKey,
  saveSubscription,
  removeSubscription,
  getPrefs,
  updatePrefs,
  subscriptionCount,
  sendToUser,
} from '../services/push.js';
import { requireAuth, asyncRoute } from './middleware.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', (req, res) => {
  const stats = collectStats(req.user.id);
  res.json({
    user: req.user,
    stats,
    totalPoints: totalPoints(req.user.id),
    rank: rankOf({ userId: req.user.id, period: 'week' }),
    rooms: listRoomsForUser(req.user.id),
    readPoemIds: poemReadIds(req.user.id),
    activity: dailySeries(req.user.id, 21),
  });
});

meRouter.get('/challenges', (req, res) => {
  res.json(challengeBoard(req.user.id));
});

// ── 알림 설정 ────────────────────────────────────────────────

meRouter.get('/push', (req, res) => {
  res.json({
    configured: isPushConfigured(),
    publicKey: publicKey(),
    prefs: getPrefs(req.user.id),
    devices: subscriptionCount(req.user.id),
  });
});

meRouter.post(
  '/push/subscribe',
  asyncRoute((req, res) => {
    saveSubscription(req.user.id, req.body?.subscription);
    res.status(201).json({ ok: true, devices: subscriptionCount(req.user.id) });
  }),
);

meRouter.post(
  '/push/unsubscribe',
  asyncRoute((req, res) => {
    if (req.body?.endpoint) removeSubscription(req.body.endpoint);
    res.json({ ok: true, devices: subscriptionCount(req.user.id) });
  }),
);

meRouter.put(
  '/push/prefs',
  asyncRoute((req, res) => {
    res.json({ prefs: updatePrefs(req.user.id, req.body ?? {}) });
  }),
);

/** 설정이 제대로 됐는지 확인용 — 자기 자신에게 한 번 보내 본다. */
meRouter.post(
  '/push/test',
  asyncRoute(async (req, res) => {
    const result = await sendToUser(
      req.user.id,
      {
        title: '알림이 잘 도착했습니다',
        body: '이제 오늘의 시와 미션 소식을 여기로 보내 드릴게요.',
        tag: 'push-test',
        url: '/#today',
      },
      { category: 'other' },
    );
    res.json(result);
  }),
);
