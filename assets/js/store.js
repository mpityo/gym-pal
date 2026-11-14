/**
 * All application state, persisted to localStorage on this device.
 *
 * The exercise library and plans ship with the site and are never written to.
 * What is stored is what only you can produce: the sessions you logged, your
 * notes about where machines are and how you set them up (per gym), your
 * swaps, your profile, and whatever you imported from Samsung Health.
 *
 * The Claude key is NOT in here. It lives in its own slot (see ai.js) so it can
 * never end up in an exported backup.
 */
import { PLAN_BY_ID } from './data/plans.js';
import { exercise } from './data/exercises.js';
import * as G from './gyms.js';

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
  /** saved gyms: { id, name, lat, lng, chain?, address? } */
  gyms: [],
  /** exercise id -> { where, settings } — the any-gym default, e.g. "back wall by mirrors", "seat 4" */
  machineNotes: {},
  /** gymId -> exercise id -> { where?, settings?, missing? } — what is true at that gym; wins over machineNotes */
  gymNotes: {},
  /** planId -> { [itemIndex]: exerciseId } — permanent swaps */
  swaps: {},
  /** Samsung Health import, see samsung.js */
  watch: null,
  prefs: {
    mode: '4day', // '4day' | '3day'
    restAlert: true,
    keepAwake: true,
    autoRest: true,
    /** the gym shown outside a workout; null means none picked */
    currentGymId: null,
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

globalThis.addEventListener?.('pagehide', flush);

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

/** { where, settings, missing } for the exercise at a gym (default: the current gym). */
export function machineNote(exId, gymId = currentGym()) {
  return G.mergedNote(state, exId, gymId);
}

/** patch: { where?, settings?, missing? }. Without a gym it edits the any-gym default. */
export function setMachineNote(exId, patch, gymId = currentGym()) {
  update((s) => G.writeNote(s, exId, patch, gymId));
}

export function isMissing(exId, gymId = currentGym()) {
  return G.isMissing(state, exId, gymId);
}

// ── Gyms ─────────────────────────────────────────────────────────────────

export function addGym(gym) {
  const g = { id: uid(), ...gym };
  update((s) => s.gyms.push(g));
  return g;
}

export function updateGym(id, patch) {
  update((s) => {
    const g = s.gyms.find((x) => x.id === id);
    if (g) Object.assign(g, patch);
  });
}

export function removeGym(id) {
  update((s) => G.dropGym(s, id));
}

export function gym(id) {
  return state.gyms.find((g) => g.id === id) ?? null;
}

/** Id of the gym in use now, or null. */
export function currentGym() {
  return G.currentGymId(state);
}

export function setCurrentGym(id) {
  setPref('currentGymId', id ?? null);
}

export function gymsByRecent() {
  return G.gymsByRecent(state);
}

export function missingAt(gymId = currentGym()) {
  return G.missingIds(state, gymId);
}

/** Start a gym's notes from another gym's. Notes already written at the target are kept. */
export function copyGymNotes(fromId, toId) {
  update((s) => {
    const from = s.gymNotes[fromId] ?? {};
    const to = (s.gymNotes[toId] ??= {});
    for (const [exId, note] of Object.entries(from)) to[exId] = { ...note, ...to[exId] };
  });
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

/** Items with permanent swaps applied and anything missing at the gym auto-swapped. */
export function planItems(planId, gymId = currentGym()) {
  return G.resolvePlanItems(PLAN_BY_ID[planId], state.swaps[planId], (exId) => G.isMissing(state, exId, gymId));
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
  const items = planId ? planItems(planId, gymId) : [];
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
    autoSwap: item.autoSwap || undefined,
    unavailable: item.unavailable || undefined,
    sets: [],
    skipped: false,
  };
}

/**
 * Move the workout in progress to another gym. Plan entries you have not
 * touched (no sets, not swapped by hand) are re-picked for the new gym.
 */
export function setSessionGym(gymId) {
  update((s) => {
    const a = s.active;
    if (!a) return;
    a.gymId = gymId ?? null;
    s.prefs.currentGymId = a.gymId;
    if (!a.planId) return;
    const items = planItems(a.planId, a.gymId);
    a.entries = a.entries.map((e) => {
      const item = e.planIndex != null && items[e.planIndex];
      if (!item || e.sets.length || e.picked) return e;
      const next = entryFor(item, e.planIndex);
      return { ...next, target: e.target, skipped: e.skipped };
    });
  });
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
    if (entry && exercise(exId)) {
      entry.ex = exId;
      entry.picked = true;
      delete entry.autoSwap;
      delete entry.unavailable;
    }
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

export function updateSession(id, patch) {
  update((s) => {
    const x = s.sessions.find((y) => y.id === id);
    if (x) Object.assign(x, patch);
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
