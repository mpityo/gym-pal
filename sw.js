/**
 * Offline support. Gym basements eat mobile signal, so the whole app is cached
 * on first load and served from cache, refreshing in the background so the
 * next load picks up a new deploy. Requests to Anthropic are never cached.
 */
const VERSION = 'gym-pal-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/icon.svg',
  'assets/js/ai.js',
  'assets/js/app.js',
  'assets/js/charts.js',
  'assets/js/data/exercises.js',
  'assets/js/data/plans.js',
  'assets/js/gyms.js',
  'assets/js/hr.js',
  'assets/js/metrics.js',
  'assets/js/samsung.js',
  'assets/js/store.js',
  'assets/js/util.js',
  'assets/js/views/coach.js',
  'assets/js/views/common.js',
  'assets/js/views/history.js',
  'assets/js/views/machines.js',
  'assets/js/views/setup.js',
  'assets/js/views/stats.js',
  'assets/js/views/today.js',
  'assets/js/views/workout.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((p) => new URL(p, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(staleWhileRevalidate(event, request));
});

async function staleWhileRevalidate(event, request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) (await caches.open(VERSION)).put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const response = await refresh;
  if (response) return response;
  if (request.mode === 'navigate') {
    const shell = await caches.match(new URL('index.html', self.registration.scope).href);
    if (shell) return shell;
  }
  return new Response('Offline', { status: 503 });
}
