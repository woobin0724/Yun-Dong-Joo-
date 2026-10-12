# 별 헤는 밤 — 어디서든 같은 모습으로 돌리기 위한 이미지
#
# Render 는 이 파일 없이 render.yaml 만으로도 돌아갑니다. 이 파일은 Railway·Fly.io·
# 학교 서버처럼 다른 곳에 올릴 때 씁니다. docs/배포-안내.md 를 보세요.
#
# Node 22.13 이상이어야 합니다. node:sqlite 가 그 버전에서 플래그 없이 열렸습니다
# (Node 변경 기록 v22.13.0, "unflag sqlite module", nodejs/node#55890).
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/app.db \
    APP_TIMEZONE=Asia/Seoul

WORKDIR /app

# 의존성만 먼저 — 코드만 바뀌었을 때 설치 단계를 다시 하지 않게.
# 개발용(playwright·impeccable)은 빼고 설치한다. 런타임 의존성은 express 와 web-push 뿐이다.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
# 운영 서버에서 'npm run backup' 으로 기록을 떠 두기 위해.
COPY scripts/backup-db.js ./scripts/backup-db.js

# 학생 기록(SQLite 파일)이 여기 쌓인다. 반드시 영구 디스크(볼륨)를 붙여야 한다.
# 붙이지 않으면 컨테이너를 다시 만들 때마다 모든 기록이 사라진다.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
