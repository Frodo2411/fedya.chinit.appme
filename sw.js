// Работа без интернета: файлы приложения лежат в кэше телефона.
// Данные прайса и код скрипта сначала берём из сети (там могут быть свежие), без сети — из кэша.
// При каждом выпуске меняется VERSION, телефон скачивает новую версию сам.

const VERSION = '2026-10-26.4';
const CACHE = 'master-' + VERSION;
const FILES = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/ui.js', 'js/engine.js', 'js/pyre.js', 'js/rules.js', 'js/search.js', 'js/crypto.js', 'js/data.js', 'js/models-app.js',
  'js/store.js', 'js/sheet.js', 'js/orders.js', 'js/xlsx.js', 'js/xls.js', 'js/importer.js', 'js/import-flow.js',
  'js/view-prices.js', 'js/view-orders.js', 'js/view-summary.js', 'js/view-more.js', 'js/site-publish.js', 'js/cart.js', 'js/view-cart.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'data/prices.enc', 'apps-script/Code.gs',
];
const NETWORK_FIRST = ['data/prices.enc', 'apps-script/Code.gs'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('master-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (NETWORK_FIRST.includes(path)) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(path, copy));
      }
      return res;
    }).catch(() => caches.match(path)));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
