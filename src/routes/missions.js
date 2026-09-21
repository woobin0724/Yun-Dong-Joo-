import { Router } from 'express';
import { missionsForUser, todaysPoem } from '../services/missions.js';
import { completeMission } from '../services/activity.js';
import { collectStats } from '../services/stats.js';
import { requireAuth, asyncRoute } from './middleware.js';
import { dayKey } from '../lib/date.js';

export const missionsRouter = Router();

missionsRouter.use(requireAuth);

/** 오늘의 시 + 오늘의 미션 + 내 진행 상황 — 첫 화면이 한 번에 받아 가는 묶음. */
missionsRouter.get('/today', (req, res) => {
  const day = dayKey();
  const missions = missionsForUser(req.user.id, day);
  const stats = collectStats(req.user.id, day);
  res.json({
    day,
    poem: todaysPoem(day),
    missions,
    remaining: missions.filter((m) => !m.completed).length,
    stats: {
      streak: stats.streak,
      bestStreak: stats.bestStreak,
      totalPoints: stats.totalPoints,
      poemsRead: stats.poemsRead,
      missionsCompleted: stats.missionsCompleted,
    },
  });
});

missionsRouter.post(
  '/:id/submit',
  asyncRoute(async (req, res) => {
    const { answer, text } = req.body ?? {};
    const result = await completeMission({
      userId: req.user.id,
      missionId: Number(req.params.id),
      answer: answer ?? null,
      text: text ?? null,
    });

    res.json({
      alreadyDone: result.alreadyDone,
      correct: result.correct,
      earnedPoints: result.earnedPoints,
      dayComplete: result.dayComplete,
      earnedChallenges: result.earnedChallenges,
      sharedMessage: result.sharedMessage,
      missions: missionsForUser(req.user.id),
    });
  }),
);
