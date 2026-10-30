// 오프라인 캐시. GitHub Pages 하위 경로(/korean-legend-boardgame/)에서도 동작하도록 상대 경로만 쓴다.
// 네트워크를 먼저 시도해 새 버전을 받고, 실패하면 캐시로 연다.
const CACHE = 'augyut-v4';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
  './fonts/black-han-sans.woff2', './fonts/ibm-plex-sans-kr-400.woff2', './fonts/ibm-plex-sans-kr-700.woff2',
  './src/main.js', './src/state.js', './src/util.js', './src/board.js', './src/augs.js', './src/sound.js', './src/save.js',
  './src/rules.js', './src/ai.js', './src/alkkagi.js', './src/render.js', './src/ui.js',
  './src/net/sha256.js', './src/net/room.js', './src/net/mqtt.js', './src/net/transports.js', './src/net/bridge.js', './src/net/session.js', './src/net/online-ui.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});
