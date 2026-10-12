import { Router } from 'express';
import { requireAuth } from './middleware.js';
import { examSummary, startExam, answerExam } from '../services/exam.js';

export const examRouter = Router();
examRouter.use(requireAuth);

examRouter.get('/', (req, res) => {
  res.json(examSummary(req.user.id));
});

examRouter.post('/', (req, res) => {
  const result = startExam(req.user.id);
  if (result.error === 'nothing-walked') {
    return res.status(409).json({ error: '길에서 시를 한 편 이상 걸어야 시험을 볼 수 있습니다.' });
  }
  res.status(201).json(result);
});

examRouter.post('/:id/items/:index', (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: '문항 번호가 올바르지 않습니다.' });
  const result = answerExam(req.user.id, Number(req.params.id), index, req.body ?? {});
  if (result.error) return res.status(404).json({ error: '없는 시험입니다.' });
  if (!result.ok) return res.status(400).json({ error: result.message });
  res.json(result);
});
