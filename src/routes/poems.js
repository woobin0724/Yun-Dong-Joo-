import { Router } from 'express';
import { POEMS, POEM_BY_ID, poemPreview } from '../content/poems.js';
import { todaysPoem, poemReadIds } from '../services/missions.js';
import { recordPoemRead } from '../services/activity.js';
import { requireAuth, asyncRoute } from './middleware.js';
import { AppError } from '../services/users.js';

export const poemsRouter = Router();

poemsRouter.get('/', (req, res) => {
  const read = new Set(req.user ? poemReadIds(req.user.id) : []);
  res.json({
    poems: POEMS.map((p) => ({
      id: p.id,
      title: p.title,
      hanja: p.hanja ?? null,
      written: p.written,
      form: p.form,
      themes: p.themes,
      preview: poemPreview(p),
      read: read.has(p.id),
    })),
    total: POEMS.length,
    readCount: read.size,
  });
});

poemsRouter.get('/today', (_req, res) => {
  res.json({ poem: todaysPoem() });
});

poemsRouter.get('/:id', (req, res, next) => {
  const poem = POEM_BY_ID.get(req.params.id);
  if (!poem) return next(new AppError('그런 시가 없습니다.', 404, 'poem_not_found'));
  res.json({ poem, read: req.user ? poemReadIds(req.user.id).includes(poem.id) : false });
});

/** 시를 끝까지 펼쳐 봤을 때 클라이언트가 알려 준다. */
poemsRouter.post(
  '/:id/read',
  requireAuth,
  asyncRoute((req, res, next) => {
    if (!POEM_BY_ID.has(req.params.id)) {
      return next(new AppError('그런 시가 없습니다.', 404, 'poem_not_found'));
    }
    const earned = recordPoemRead(req.user.id, req.params.id);
    res.json({ ok: true, earnedChallenges: earned });
  }),
);
