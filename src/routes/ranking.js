import { Router } from 'express';
import { leaderboard, rankOf } from '../services/points.js';
import { requireAuth } from './middleware.js';

export const rankingRouter = Router();

rankingRouter.use(requireAuth);

/** 전체 랭킹. 방별 랭킹은 /api/rooms/:id/ranking 에 있다. */
rankingRouter.get('/', (req, res) => {
  const period = ['week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'week';
  res.json({
    period,
    ranking: leaderboard({ period, limit: 100 }),
    me: rankOf({ userId: req.user.id, period }),
  });
});
