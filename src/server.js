import { createApp } from './app.js';
import { config } from './config.js';
import { startScheduler } from './services/scheduler.js';
import { isPushConfigured } from './services/push.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`
  별 헤는 밤 — 윤동주 교육용 앱
  http://localhost:${config.port}

  시간대     ${config.timezone}
  미션 발행  매일 ${config.missionPublishHour}시
  시 알림    ${config.poemPushHours.map((h) => `${h}시`).join(', ')}
  웹푸시     ${isPushConfigured() ? '켜짐' : '꺼짐 (npm run keys 로 VAPID 키를 만드세요)'}
`);
  startScheduler();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
