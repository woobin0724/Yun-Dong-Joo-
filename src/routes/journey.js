import { Router } from 'express';
import { requireAuth } from './middleware.js';
import { POEMS } from '../content/poems.js';
import {
  mapFor,
  openNode,
  submitStep,
  finishNode,
  myResponses,
  unverifiedFactCount,
} from '../services/journey.js';

export const journeyRouter = Router();

journeyRouter.use(requireAuth);

/** 지도. 홈 화면이 이것 하나만 받아서 그린다. */
journeyRouter.get('/', (req, res) => {
  const map = mapFor(req.user.id);
  res.json({ ...map, unverifiedFacts: unverifiedFactCount() });
});

/** 마디를 연다. 걸음 목록과 시 본문이 함께 간다. */
journeyRouter.get('/nodes/:id', (req, res) => {
  const result = openNode(req.user.id, req.params.id);
  if (result.error === 'not-found') return res.status(404).json({ error: '없는 마디입니다.' });
  if (result.error === 'locked') {
    return res.status(403).json({ error: '앞의 마디를 먼저 걸어야 합니다.' });
  }
  const poem = POEMS.find((p) => p.id === result.lesson.poemId);
  res.json({ ...result, poem });
});

/** 걸음 하나를 낸다. */
journeyRouter.post('/nodes/:id/steps/:index', (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: '걸음 번호가 올바르지 않습니다.' });
  }
  const result = submitStep(req.user.id, req.params.id, index, req.body ?? {});
  if (result.error === 'not-found' || result.error === 'no-step') {
    return res.status(404).json({ error: '없는 걸음입니다.' });
  }
  if (result.error === 'locked') {
    return res.status(403).json({ error: '앞의 마디를 먼저 걸어야 합니다.' });
  }
  if (result.error === 'not-started') {
    return res.status(409).json({ error: '마디를 먼저 열어 주세요.' });
  }
  if (result.error === 'out-of-order') {
    return res.status(409).json({ error: '걸음은 차례대로만 낼 수 있습니다.' });
  }
  if (!result.ok) return res.status(400).json({ error: result.message });
  res.json(result);
});

/** 마디를 끝낸다. */
journeyRouter.post('/nodes/:id/finish', (req, res) => {
  const result = finishNode(req.user.id, req.params.id);
  if (result.error === 'not-found') return res.status(404).json({ error: '없는 마디입니다.' });
  if (result.error === 'not-started' || result.error === 'incomplete') {
    return res.status(409).json({ error: '걸음을 모두 마쳐야 합니다.' });
  }
  res.json(result);
});

/** 내가 남긴 한 줄 감상. */
journeyRouter.get('/responses', (req, res) => {
  const rows = myResponses(req.user.id).map((r) => ({
    ...r,
    title: POEMS.find((p) => p.id === r.poemId)?.title ?? r.poemId,
  }));
  res.json({ responses: rows });
});
