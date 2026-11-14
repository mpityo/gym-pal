/**
 * Offline support. Gym basements eat mobile signal, so the whole app is cached
 * on first load and served from cache, refreshing in the background so the
 * next load picks up a new deploy. Requests to Anthropic are never cached.
 */
const VERSION = 'gym-pal-v5';
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
  'assets/js/data/images.js',
  'assets/js/data/plans.js',
  'assets/js/gyms.js',
  'assets/js/hr.js',
  'assets/js/metrics.js',
  'assets/js/photos.js',
  'assets/js/samsung.js',
  'assets/js/store.js',
  'assets/js/util.js',
  'assets/js/views/coach.js',
  'assets/js/views/common.js',
  'assets/js/views/history.js',
  'assets/js/views/machines.js',
  'assets/js/views/sets.js',
  'assets/js/views/setup.js',
  'assets/js/views/stats.js',
  'assets/js/views/today.js',
  'assets/js/views/workout.js',
];

/**
 * Exercise reference photos (spec 08). Cached best-effort: a missing or
 * failed image must never stop the app shell from installing. Regenerate
 * this list from assets/js/data/images.js when tools/fetch-images.mjs runs.
 */
const IMAGES = [
  'assets/img/ex/ab-machine-0.jpg',
  'assets/img/ex/ab-machine-1.jpg',
  'assets/img/ex/assisted-dip-0.jpg',
  'assets/img/ex/assisted-dip-1.jpg',
  'assets/img/ex/assisted-pullup-0.jpg',
  'assets/img/ex/assisted-pullup-1.jpg',
  'assets/img/ex/bike-0.jpg',
  'assets/img/ex/bike-1.jpg',
  'assets/img/ex/cable-crunch-0.jpg',
  'assets/img/ex/cable-crunch-1.jpg',
  'assets/img/ex/cable-curl-0.jpg',
  'assets/img/ex/cable-curl-1.jpg',
  'assets/img/ex/cable-fly-0.jpg',
  'assets/img/ex/cable-fly-1.jpg',
  'assets/img/ex/cable-lateral-raise-0.jpg',
  'assets/img/ex/cable-lateral-raise-1.jpg',
  'assets/img/ex/cable-row-0.jpg',
  'assets/img/ex/cable-row-1.jpg',
  'assets/img/ex/calf-legpress-0.jpg',
  'assets/img/ex/calf-legpress-1.jpg',
  'assets/img/ex/calf-seated-0.jpg',
  'assets/img/ex/calf-seated-1.jpg',
  'assets/img/ex/calf-standing-0.jpg',
  'assets/img/ex/calf-standing-1.jpg',
  'assets/img/ex/chest-press-0.jpg',
  'assets/img/ex/chest-press-1.jpg',
  'assets/img/ex/db-bench-0.jpg',
  'assets/img/ex/db-bench-1.jpg',
  'assets/img/ex/db-curl-0.jpg',
  'assets/img/ex/db-curl-1.jpg',
  'assets/img/ex/db-incline-0.jpg',
  'assets/img/ex/db-incline-1.jpg',
  'assets/img/ex/db-kickback-0.jpg',
  'assets/img/ex/db-kickback-1.jpg',
  'assets/img/ex/db-overhead-ext-0.jpg',
  'assets/img/ex/db-overhead-ext-1.jpg',
  'assets/img/ex/db-rdl-0.jpg',
  'assets/img/ex/db-rdl-1.jpg',
  'assets/img/ex/db-rear-fly-0.jpg',
  'assets/img/ex/db-rear-fly-1.jpg',
  'assets/img/ex/db-row-0.jpg',
  'assets/img/ex/db-row-1.jpg',
  'assets/img/ex/db-shoulder-press-0.jpg',
  'assets/img/ex/db-shoulder-press-1.jpg',
  'assets/img/ex/dead-bug-0.jpg',
  'assets/img/ex/dead-bug-1.jpg',
  'assets/img/ex/elliptical-0.jpg',
  'assets/img/ex/elliptical-1.jpg',
  'assets/img/ex/face-pull-0.jpg',
  'assets/img/ex/face-pull-1.jpg',
  'assets/img/ex/goblet-squat-0.jpg',
  'assets/img/ex/goblet-squat-1.jpg',
  'assets/img/ex/hack-squat-0.jpg',
  'assets/img/ex/hack-squat-1.jpg',
  'assets/img/ex/hammer-curl-0.jpg',
  'assets/img/ex/hammer-curl-1.jpg',
  'assets/img/ex/hanging-knee-raise-0.jpg',
  'assets/img/ex/hanging-knee-raise-1.jpg',
  'assets/img/ex/hip-abductor-0.jpg',
  'assets/img/ex/hip-abductor-1.jpg',
  'assets/img/ex/hip-adductor-0.jpg',
  'assets/img/ex/hip-adductor-1.jpg',
  'assets/img/ex/incline-press-0.jpg',
  'assets/img/ex/incline-press-1.jpg',
  'assets/img/ex/lat-pulldown-0.jpg',
  'assets/img/ex/lat-pulldown-1.jpg',
  'assets/img/ex/lateral-raise-0.jpg',
  'assets/img/ex/lateral-raise-1.jpg',
  'assets/img/ex/leg-curl-lying-0.jpg',
  'assets/img/ex/leg-curl-lying-1.jpg',
  'assets/img/ex/leg-curl-seated-0.jpg',
  'assets/img/ex/leg-curl-seated-1.jpg',
  'assets/img/ex/leg-extension-0.jpg',
  'assets/img/ex/leg-extension-1.jpg',
  'assets/img/ex/leg-press-0.jpg',
  'assets/img/ex/leg-press-1.jpg',
  'assets/img/ex/mile-run-0.jpg',
  'assets/img/ex/mile-run-1.jpg',
  'assets/img/ex/overhead-cable-ext-0.jpg',
  'assets/img/ex/overhead-cable-ext-1.jpg',
  'assets/img/ex/pec-deck-0.jpg',
  'assets/img/ex/pec-deck-1.jpg',
  'assets/img/ex/plank-0.jpg',
  'assets/img/ex/preacher-curl-0.jpg',
  'assets/img/ex/preacher-curl-1.jpg',
  'assets/img/ex/pulldown-machine-0.jpg',
  'assets/img/ex/pulldown-machine-1.jpg',
  'assets/img/ex/pushup-0.jpg',
  'assets/img/ex/pushup-1.jpg',
  'assets/img/ex/rear-delt-fly-0.jpg',
  'assets/img/ex/rear-delt-fly-1.jpg',
  'assets/img/ex/row-machine-0.jpg',
  'assets/img/ex/row-machine-1.jpg',
  'assets/img/ex/seated-dip-0.jpg',
  'assets/img/ex/seated-dip-1.jpg',
  'assets/img/ex/shoulder-press-0.jpg',
  'assets/img/ex/shoulder-press-1.jpg',
  'assets/img/ex/smith-bench-0.jpg',
  'assets/img/ex/smith-bench-1.jpg',
  'assets/img/ex/smith-shoulder-press-0.jpg',
  'assets/img/ex/smith-shoulder-press-1.jpg',
  'assets/img/ex/smith-squat-0.jpg',
  'assets/img/ex/smith-squat-1.jpg',
  'assets/img/ex/split-squat-0.jpg',
  'assets/img/ex/split-squat-1.jpg',
  'assets/img/ex/straight-arm-pulldown-0.jpg',
  'assets/img/ex/straight-arm-pulldown-1.jpg',
  'assets/img/ex/treadmill-warmup-0.jpg',
  'assets/img/ex/treadmill-warmup-1.jpg',
  'assets/img/ex/tricep-ext-machine-0.jpg',
  'assets/img/ex/tricep-ext-machine-1.jpg',
  'assets/img/ex/tricep-pushdown-0.jpg',
  'assets/img/ex/tricep-pushdown-1.jpg',
  'assets/img/ex/walking-lunge-0.jpg',
  'assets/img/ex/walking-lunge-1.jpg',
];

self.addEventListener('install', (event) => {
  const abs = (p) => new URL(p, self.registration.scope).href;
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) =>
        Promise.all([
          cache.addAll(SHELL.map(abs)),
          // One request each so one missing file does not drop the rest.
          Promise.all(IMAGES.map((p) => cache.add(abs(p)).catch(() => {}))),
        ]),
      )
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(new URL('./#/workout', self.registration.scope).href);
          return;
        }
      }
      await self.clients.openWindow(new URL('./#/workout', self.registration.scope).href);
    })(),
  );
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
