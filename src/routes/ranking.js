import { Router } from 'express';
import { leaderboard, rankOf } from '../services/points.js';
import { requireAuth } from './middleware.js';
import { leagueTable } from '../services/league.js';

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

/** 주간 리그 — 내 등급과, 같은 등급 사람들의 이번 주 점수. */
rankingRouter.get('/league', (req, res) => {
  res.json(leagueTable(req.user.id));
});
