/**
 * All application state, persisted to localStorage on this device.
 *
 * The exercise library and plans ship with the site and are never written to.
 * What is stored is what only you can produce: the sessions you logged, your
 * notes about where machines are and how you set them up, your swaps, your
 * profile, and whatever you imported from Samsung Health.
 *
 * The Claude key is NOT in here. It lives in its own slot (see ai.js) so it can
 * never end up in an exported backup.
 */
import { PLAN_BY_ID } from './data/plans.js';
import { exercise } from './data/exercises.js';

const KEY = 'gym-pal.v1';
const listeners = new Set();

export const defaultState = () => ({
  version: 1,
  /** finished sessions, oldest first */
  sessions: [],
  /** the session in progress, or null */
  active: null,
  profile: {
    bodyweight: null, // lb
    age: null,
    maxHr: null, // override; otherwise estimated from age
    restingHr: null,
  },
  /** saved gyms: { id, name, lat, lng } */
  gyms: [],
  /** exercise id -> { where, settings } — your notes, e.g. "back wall by mirrors", "seat 4" */
  machineNotes: {},
  /** planId -> { [itemIndex]: exerciseId } — permanent swaps */
  swaps: {},
  /** Samsung Health import, see samsung.js */
  watch: null,
  prefs: {
    mode: '4day', // '4day' | '3day'
    restAlert: true,
    keepAwake: true,
    autoRest: true,
  },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return merge(defaultState(), JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

/** Shallow-merge nested objects so new default keys appear after an update. */
function merge(base, saved) {
  const out = { ...base, ...saved };
  for (const key of ['profile', 'prefs']) out[key] = { ...base[key], ...(saved?.[key] ?? {}) };
  return out;
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 150);
}

export function flush() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save', err);
  }
}

window.addEventListener?.('pagehide', flush);

function commit() {
  persist();
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export function replaceState(next) {
  state = merge(defaultState(), next);
  commit();
}

export function update(fn) {
  fn(state);
  commit();
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── Profile, prefs, notes ────────────────────────────────────────────────

export function setProfile(patch) {
  update((s) => Object.assign(s.profile, patch));
}

export function setPref(key, value) {
  update((s) => {
    s.prefs[key] = value;
  });
}

export function machineNote(exId) {
  return state.machineNotes[exId] ?? { where: '', settings: '' };
}

export function setMachineNote(exId, patch) {
  update((s) => {
    s.machineNotes[exId] = { ...machineNote(exId), ...patch };
  });
}

// ── Gyms ─────────────────────────────────────────────────────────────────

export function addGym(gym) {
  const g = { id: uid(), ...gym };
  update((s) => s.gyms.push(g));
  return g;
}

export function removeGym(id) {
  update((s) => {
    s.gyms = s.gyms.filter((g) => g.id !== id);
  });
}

export function gym(id) {
  return state.gyms.find((g) => g.id === id) ?? null;
}

/** Metres between two lat/lng points (haversine). */
export function distanceM(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** The saved gym you are standing in, if any is within 400 m. */
export function nearestGym(pos) {
  let best = null;
  for (const g of state.gyms) {
    if (g.lat == null) continue;
    const d = distanceM(pos, g);
    if (d <= 400 && (!best || d < best.d)) best = { gym: g, d };
  }
  return best?.gym ?? null;
}

// ── Plans with your swaps applied ────────────────────────────────────────

export function planItems(planId) {
  const plan = PLAN_BY_ID[planId];
  if (!plan) return [];
  const swaps = state.swaps[planId] ?? {};
  return plan.items.map((item, i) => (swaps[i] ? { ...item, ex: swaps[i], swappedFrom: item.ex } : item));
}

export function setPermanentSwap(planId, index, exId) {
  update((s) => {
    s.swaps[planId] = { ...(s.swaps[planId] ?? {}) };
    if (!exId || PLAN_BY_ID[planId]?.items[index]?.ex === exId) delete s.swaps[planId][index];
    else s.swaps[planId][index] = exId;
  });
}

// ── The session in progress ──────────────────────────────────────────────

export function startSession(planId, { gymId = null, geo = null } = {}) {
  const items = planId ? planItems(planId) : [];
  const now = Date.now();
  update((s) => {
    s.active = {
      id: uid(),
      planId,
      name: PLAN_BY_ID[planId]?.name ?? 'Freestyle',
      startedAt: now,
      endedAt: null,
      gymId,
      geo,
      current: 0,
      entries: items.map((item, i) => entryFor(item, i)),
      hr: [],
      notes: '',
    };
  });
  return state.active;
}

function entryFor(item, planIndex = null) {
  return {
    ex: item.ex,
    plannedEx: item.swappedFrom ?? item.ex,
    planIndex,
    target: {
      sets: item.sets ?? 3,
      reps: item.reps ?? null,
      secs: item.secs ?? null,
      rest: item.rest ?? 90,
      minutes: item.minutes ?? null,
      miles: item.miles ?? null,
      note: item.note ?? null,
    },
    sets: [],
    skipped: false,
  };
}

export function active() {
  return state.active;
}

export function setCurrent(i) {
  update((s) => {
    if (s.active) s.active.current = i;
  });
}

/** set: { w, reps } | { secs } | { minutes, miles } */
export function logSet(entryIndex, set) {
  update((s) => {
    const entry = s.active?.entries[entryIndex];
    if (!entry) return;
    entry.sets.push({ ...set, at: Date.now() });
    entry.skipped = false;
  });
}

export function removeSet(entryIndex, setIndex) {
  update((s) => {
    s.active?.entries[entryIndex]?.sets.splice(setIndex, 1);
  });
}

export function editSet(entryIndex, setIndex, patch) {
  update((s) => {
    const set = s.active?.entries[entryIndex]?.sets[setIndex];
    if (set) Object.assign(set, patch);
  });
}

export function swapExercise(entryIndex, exId) {
  update((s) => {
    const entry = s.active?.entries[entryIndex];
    if (entry && exercise(exId)) entry.ex = exId;
  });
}

export function skipEntry(entryIndex, skipped = true) {
  update((s) => {
    const entry = s.active?.entries[entryIndex];
    if (entry) entry.skipped = skipped;
  });
}

export function addEntry(exId) {
  const ex = exercise(exId);
  if (!ex) return;
  const item =
    ex.track === 'cardio'
      ? { ex: exId, sets: 1, minutes: 10 }
      : ex.track === 'time'
        ? { ex: exId, sets: 3, secs: [30, 60], rest: 60 }
        : { ex: exId, sets: 3, reps: [8, 12], rest: 90 };
  update((s) => {
    if (!s.active) return;
    s.active.entries.push(entryFor(item));
    s.active.current = s.active.entries.length - 1;
  });
}

export function addHrSample(bpm) {
  const a = state.active;
  if (!a) return;
  const t = Date.now();
  const last = a.hr[a.hr.length - 1];
  // One sample every 5 s is plenty for zones and keeps storage small.
  if (last && t - last[0] < 5000) return;
  a.hr.push([t, bpm]);
  persist();
}

/** Rest timer lives on the session so it survives a reload or a phone lock. */
export function setRest(secs) {
  update((s) => {
    if (s.active) s.active.rest = secs ? { until: Date.now() + secs * 1000, total: secs } : null;
  });
}

export function setSessionNotes(text) {
  update((s) => {
    if (s.active) s.active.notes = text;
  });
}

export function finishSession() {
  let finished = null;
  update((s) => {
    if (!s.active) return;
    finished = { ...s.active, endedAt: Date.now() };
    delete finished.rest;
    delete finished.current;
    // Keep only what was actually done.
    finished.entries = finished.entries.filter((e) => e.sets.length);
    if (finished.entries.length) s.sessions.push(finished);
    s.active = null;
  });
  return finished;
}

export function discardSession() {
  update((s) => {
    s.active = null;
  });
}

export function deleteSession(id) {
  update((s) => {
    s.sessions = s.sessions.filter((x) => x.id !== id);
  });
}

export function setWatch(watch) {
  update((s) => {
    s.watch = watch;
  });
}

// ── Backup ───────────────────────────────────────────────────────────────

export function exportJson() {
  return JSON.stringify({ app: 'gym-pal', exportedAt: new Date().toISOString(), state }, null, 1);
}

export function importJson(text) {
  const data = JSON.parse(text);
  const next = data?.state ?? data;
  if (!Array.isArray(next?.sessions)) throw new Error('That file is not a Gym Pal backup.');
  replaceState(next);
}
