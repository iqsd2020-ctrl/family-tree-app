/* Service Worker - شجرة السادة اليعقوبيين */
const CACHE_NAME = 'family-tree-app-cache-v6';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './assets/placeholder.svg',
  './css/styles.css',
  './js/config.js',
  './js/storage.js',
  './js/utils.js',
  './js/auth.js',
  './js/app.js',
  './js/pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './sjad.svg'
];

// مصادر خارجية (اختياري) - لا نفشل التثبيت إذا تعذر تحميلها
const OPTIONAL_CACHE_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics-compat.js',
  'https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Aref+Ruqaa:wght@400;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await cache.addAll(PRECACHE_URLS);

    await Promise.all(OPTIONAL_CACHE_URLS.map(async (url) => {
      try { await cache.add(url); } catch (e) {}
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== CACHE_NAME) return caches.delete(key);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // نتعامل فقط مع GET
  if (req.method !== 'GET') return;

  // طلبات التنقل (صفحات) - Network First مع fallback للكاش
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match('./index.html');
        return cached || caches.match('./');
      }
    })());
    return;
  }

  // بقية الملفات - Cache First مع تحديث بالخلفية
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, fresh.clone());
        } catch (e) {}
      })());
      return cached;
    }

    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return cached;
    }
  })());
});
