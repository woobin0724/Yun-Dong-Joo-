/* 서비스 워커 — 오프라인에서도 앱 껍데기가 뜨게 하고, 웹푸시를 받는다. */

const CACHE = 'byeol-v9';
// 시 본문 응답. 앱 껍데기와 따로 둔다 — 로그아웃할 때 이것만 비운다.
const API_CACHE = 'byeol-poems';
const POEM_API = /^\/api\/poems(?:\/[^/]+)?$/; // 목록과 한 편. /read 같은 쓰기는 아니다.

// 앱 껍데기. 글꼴 조각은 여기 넣지 않고, 실제로 쓰인 것만 아래에서 캐시한다
// (서브셋이 190개라 전부 미리 받으면 첫 방문이 느려진다).
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/core.js',
  '/journey.js',
  '/transcribe.js',
  '/manuscript.js',
  '/exam.js',
  '/lib/korean.js',
  '/theme-init.js',
  '/fonts/fonts.css',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 시 본문만은 오프라인에서도 읽혀야 한다. 지하철에서, 데이터가 끊긴 교실에서.
  // 네트워크를 먼저 쓰고, 안 되면 마지막으로 받아 둔 것을 준다.
  // 레슨과 시험은 캐시하지 않는다 — 채점을 서버가 하므로 끊긴 채로는 걸을 수 없고,
  // 그렇다고 화면이 말해 준다.
  if (POEM_API.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request, { cacheName: API_CACHE }).then(
            (cached) => cached || Response.json({ error: '인터넷에 연결되어 있지 않습니다.' }, { status: 503 }),
          ),
        ),
    );
    return;
  }
  // 나머지 API 는 캐시하지 않는다 — 늘 최신이어야 한다.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match('/index.html')),
    ),
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: '별 헤는 밤', body: '오늘의 시가 도착했습니다.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: payload.tag || 'byeol',
      renotify: false,
      data: { url: payload.url || '/#today' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/#today';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          return client.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
