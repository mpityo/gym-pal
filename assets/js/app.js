import { h, clear, toast, fmtSecs, alertDone, primeAudio } from './util.js';
import * as store from './store.js';
import * as hr from './hr.js';
import * as ai from './ai.js';
import { renderToday } from './views/today.js';
import { renderWorkout } from './views/workout.js';
import { renderMachines, renderMachine } from './views/machines.js';
import { renderStats } from './views/stats.js';
import { renderHistory } from './views/history.js';
import { renderSetup } from './views/setup.js';
import { openCoach } from './views/coach.js';

const ROUTES = [
  { id: 'today', label: 'Today', icon: 'M4 12h16M12 4v16', render: renderToday },
  { id: 'workout', label: 'Workout', icon: '', render: renderWorkout, hidden: true },
  { id: 'machines', label: 'Machines', icon: '', render: renderMachines },
  { id: 'machine', label: 'Machine', render: renderMachine, hidden: true, parent: 'machines' },
  { id: 'stats', label: 'Stats', render: renderStats },
  { id: 'history', label: 'History', render: renderHistory },
  { id: 'setup', label: 'Setup', render: renderSetup },
];

const ICONS = {
  today: 'M8 3v3M16 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4',
  workout: 'M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12',
  machines: 'M4 20V4h4v16M8 8h8M16 4v16h4V4h-4M8 16h8',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  history: 'M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  setup: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14.4 3h-4l-.3 2.4a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3l.3 2.4h4l.3-2.4a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
};

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[id] ?? '');
  svg.append(p);
  return svg;
}

const ctx = {
  route: 'today',
  param: null,
  go(route) {
    location.hash = `#/${route}`;
  },
  rerender() {
    render();
  },
  openCoach(extra) {
    openCoach(ctx, extra);
  },
};

const app = document.getElementById('app');
const tabs = document.getElementById('tabs');
const topStatus = document.getElementById('top-status');

function parseHash() {
  const m = /^#\/([\w-]+)(?:\/([\w-]+))?/.exec(location.hash);
  const id = m?.[1];
  const route = ROUTES.find((r) => r.id === id) ? id : store.active() ? 'workout' : 'today';
  return { route, param: m?.[2] ?? null };
}

function render() {
  const { route, param } = parseHash();
  // No workout in progress: the workout route falls back to Today.
  ctx.route = route === 'workout' && !store.active() ? 'today' : route;
  ctx.param = param;
  const def = ROUTES.find((r) => r.id === ctx.route);

  renderTabs();
  renderTopStatus();

  const y = ctx.lastRoute === `${ctx.route}/${ctx.param}` ? window.scrollY : 0;
  clear(app);
  app.append(def.render(ctx));
  window.scrollTo(0, y);
  ctx.lastRoute = `${ctx.route}/${ctx.param}`;

  document.title = `${def.label} · Gym Pal`;
  wakeLock(ctx.route === 'workout' && store.getState().prefs.keepAwake);
}

function renderTabs() {
  const activeSession = store.active();
  const list = ROUTES.filter((r) => !r.hidden || (r.id === 'workout' && activeSession));
  const order = activeSession ? ['workout', 'machines', 'stats', 'history', 'setup'] : ['today', 'machines', 'stats', 'history', 'setup'];
  clear(tabs).append(
    ...order
      .map((id) => list.find((r) => r.id === id))
      .filter(Boolean)
      .map((r) => {
        const current = ctx.route === r.id || ROUTES.find((x) => x.id === ctx.route)?.parent === r.id || (r.id === 'workout' && ctx.route === 'today');
        return h(
          'button',
          {
            class: `tab${r.id === 'workout' ? ' tab--live' : ''}`,
            type: 'button',
            'aria-current': current ? 'page' : null,
            onClick: () => ctx.go(r.id),
          },
          icon(r.id),
          h('span', {}, r.label),
        );
      }),
  );
}

function renderTopStatus() {
  const a = store.active();
  const bpm = hr.latest();
  clear(topStatus).append(...[
    bpm ? h('span', { class: 'hr-chip', title: hr.deviceName() ?? 'Heart rate' }, h('span', { class: 'hr-chip__beat', 'aria-hidden': 'true' }, '♥'), h('span', { id: 'hr-live' }, String(bpm))) : null,
    a ? h('button', { class: 'live-chip', type: 'button', onClick: () => ctx.go('workout') }, h('span', { class: 'live-chip__dot' }), h('span', { 'data-elapsed': a.startedAt }, fmtSecs((Date.now() - a.startedAt) / 1000))) : null,
    ai.hasKey() ? h('button', { class: 'coach-chip', type: 'button', onClick: () => ctx.openCoach() }, 'Coach') : null,
  ].filter(Boolean));
}

// ── Ticking clocks: elapsed time and the rest timer ──────────────────────

let restWasRunning = false;
setInterval(() => {
  for (const el of document.querySelectorAll('[data-elapsed]')) {
    const secs = (Date.now() - Number(el.dataset.elapsed)) / 1000;
    el.textContent = secs >= 3600 ? `${Math.floor(secs / 3600)}:${fmtSecs(secs % 3600).padStart(5, '0')}` : fmtSecs(secs);
  }
  const a = store.active();
  const bar = document.getElementById('restbar');
  if (a?.rest && bar) {
    const left = (a.rest.until - Date.now()) / 1000;
    const label = bar.querySelector('[data-rest-left]');
    const fill = bar.querySelector('.restbar__fill');
    if (left > 0) {
      restWasRunning = true;
      bar.hidden = false;
      if (label) label.textContent = fmtSecs(left);
      if (fill) fill.style.width = `${Math.max(0, (left / a.rest.total) * 100)}%`;
    } else {
      if (label) label.textContent = 'Go';
      if (fill) fill.style.width = '0%';
      bar.classList.add('is-done');
      if (restWasRunning) {
        restWasRunning = false;
        if (store.getState().prefs.restAlert) alertDone();
        toast('Rest is up — next set.');
      }
    }
  }
}, 500);

// ── Live heart rate ──────────────────────────────────────────────────────

hr.onHeartRate((bpm) => {
  if (bpm) store.addHrSample(bpm);
  const live = document.getElementById('hr-live');
  if (live && bpm) live.textContent = String(bpm);
  else renderTopStatus();
});

// ── Keep the screen on during a workout ──────────────────────────────────

let lock = null;
async function wakeLock(on) {
  try {
    if (on && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
      });
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wakeLock(ctx.route === 'workout' && store.getState().prefs.keepAwake);
});

document.addEventListener('pointerdown', primeAudio, { once: true });

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
