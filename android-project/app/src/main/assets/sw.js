const CACHE_NAME = 'aura-music-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './audio-engine.js',
  './db.js',
  './id3-parser.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/sample-tracks/midnight_drive_cover.jpg',
  './assets/sample-tracks/celestial_echoes_cover.jpg',
  './assets/sample-tracks/golden_hour_cover.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Let audio range requests bypass cache or stream naturally
  if (event.request.headers.get('range')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
