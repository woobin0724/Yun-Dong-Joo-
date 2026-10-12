import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { getDb } from './db.js';
import { cookieMiddleware, attachUser, errorHandler } from './routes/middleware.js';
import { securityHeaders } from './routes/security.js';
import { compression } from './routes/compress.js';
import { authRouter } from './routes/auth.js';
import { poemsRouter } from './routes/poems.js';
import { missionsRouter } from './routes/missions.js';
import { roomsRouter } from './routes/rooms.js';
import { rankingRouter } from './routes/ranking.js';
import { meRouter } from './routes/me.js';
import { isPushConfigured } from './services/push.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

export function createApp() {
  getDb(); // 스키마를 먼저 준비한다

  const app = express();
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(compression);
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieMiddleware);
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      timezone: config.timezone,
      push: isPushConfigured(),
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/poems', poemsRouter);
  app.use('/api/missions', missionsRouter);
  app.use('/api/rooms', roomsRouter);
  app.use('/api/ranking', rankingRouter);
  app.use('/api/me', meRouter);

  app.use(
    express.static(publicDir, {
      setHeaders(res, filePath) {
        // 서비스 워커는 캐시되면 갱신이 늦어집니다.
        if (filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
          return;
        }
        // 글꼴 파일 이름에는 내용 해시가 들어 있어 내용이 바뀌면 이름도 바뀝니다.
        // 영구 캐시해도 안전합니다. (측정: 기본값이 max-age=0 이라 재방문마다 56건 재검증)
        if (filePath.includes('/fonts/') && filePath.endsWith('.woff2')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // API 가 아닌 경로는 모두 SPA 진입점으로 보낸다.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: '없는 경로입니다.' } });
  });

  app.use(errorHandler);
  return app;
}
