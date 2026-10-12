import { Router } from 'express';
import { requireAuth } from './middleware.js';
import {
  saveTranscription,
  listTranscriptions,
  getTranscription,
  deleteTranscription,
  MIN_CHARS,
} from '../services/transcriptions.js';

export const transcriptionsRouter = Router();

transcriptionsRouter.use(requireAuth);

transcriptionsRouter.get('/', (req, res) => {
  res.json({ transcriptions: listTranscriptions(req.user.id) });
});

transcriptionsRouter.get('/:id', (req, res) => {
  const row = getTranscription(req.user.id, Number(req.params.id));
  if (!row) return res.status(404).json({ error: '없는 필사입니다.' });
  res.json({ transcription: row });
});

transcriptionsRouter.post('/', (req, res) => {
  const { poemId, text } = req.body ?? {};
  const result = saveTranscription({ userId: req.user.id, poemId, text });
  if (result.error === 'no-poem') return res.status(404).json({ error: '없는 작품입니다.' });
  if (result.error === 'too-short') {
    return res
      .status(400)
      .json({ error: `${MIN_CHARS}자 이상 옮겨 적어 주세요. (지금 ${result.got}자)` });
  }
  res.status(201).json(result);
});

transcriptionsRouter.delete('/:id', (req, res) => {
  const ok = deleteTranscription(req.user.id, Number(req.params.id));
  if (!ok) return res.status(404).json({ error: '없는 필사입니다.' });
  res.json({ ok: true });
});
