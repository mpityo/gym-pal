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
import { adjustRest as adjustRestPure } from './metrics.js';

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
    /** Have we ever asked the browser to persist storage (navigator.storage.persist)? */
    persistAsked: false,
    /** When "Export backup" was last used, and how many sessions existed then. */
    lastBackupAt: null,
    lastBackupSessionCount: 0,
    /** Today's backup-reminder card is hidden until this time, if set. */
    backupSnoozeUntil: null,
    restNotify: false,
    /** Spec 14: suggest warm-up sets on the first big lift of each kind. */
    warmups: true,
    /** Spec 14: plate sizes (lb) the gym has, for the per-side breakdown. */
    plates: [45, 35, 25, 10, 5, 2.5],
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

/**
 * The most recent save failure, or null. Not persisted itself — it only
 * describes what happened in this running session, since a failed save by
 * definition never made it to disk.
 */
let saveError = null;

/**
 * Write the current state to localStorage. Returns true/false instead of
 * swallowing the error, so callers (app.js) can show a sticky banner instead
 * of silently losing data once the quota (~5 MB) is hit.
 */
export function flush() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = null;
    notify();
    return true;
  } catch (err) {
    // The undo snapshot from a restore/erase roughly doubles what is stored.
    // Saving the real data matters more, so give that space up and retry once.
    if (dropPrevious()) {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        saveError = null;
        notify();
        return true;
      } catch {
        // fall through to the failure path
      }
    }
    console.warn('Could not save', err);
    saveError = { name: err?.name ?? 'Error', at: Date.now() };
    notify();
    return false;
  }
}

/** { ok: true, error: null } or { ok: false, error: { name, at } }. */
export function saveStatus() {
  return { ok: !saveError, error: saveError };
}

/** Roughly how much of the ~5 MB localStorage quota the current state uses. */
export function storageEstimate() {
  return { bytes: JSON.stringify(state).length };
}

globalThis.addEventListener?.('pagehide', flush);

function notify() {
  for (const fn of listeners) fn(state);
}

function commit() {
  persist();
  notify();
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

/** Test-only: swap the live state wholesale, bypassing localStorage. */
export function _resetForTests(next = defaultState()) {
  state = next;
  saveError = null;
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

/** Returns the removed set (for Undo with insertSet), or null. */
export function removeSet(entryIndex, setIndex) {
  let removed = null;
  update((s) => {
    [removed = null] = s.active?.entries[entryIndex]?.sets.splice(setIndex, 1) ?? [];
  });
  return removed;
}

/** Puts a set back at its old position in the workout in progress (Undo). */
export function insertSet(entryIndex, setIndex, set) {
  update((s) => {
    const sets = s.active?.entries[entryIndex]?.sets;
    if (sets && set) sets.splice(Math.min(setIndex, sets.length), 0, set);
  });
}

export function editSet(entryIndex, setIndex, patch) {
  update((s) => {
    const set = s.active?.entries[entryIndex]?.sets[setIndex];
    if (set) Object.assign(set, patch);
  });
}

/** reason: 'taken' | 'missing' | 'prefer' — why it was swapped (feeds the busy-times history). */
export function swapExercise(entryIndex, exId, reason) {
  update((s) => {
    const entry = s.active?.entries[entryIndex];
    if (entry && exercise(exId)) {
      entry.ex = exId;
      entry.picked = true;
      if (['taken', 'missing', 'prefer'].includes(reason)) entry.swapReason = reason;
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

/** The target an exercise gets when it is added by hand. */
function defaultItem(exId, ex) {
  return ex.track === 'cardio'
    ? { ex: exId, sets: 1, minutes: 10 }
    : ex.track === 'time'
      ? { ex: exId, sets: 3, secs: [30, 60], rest: 60 }
      : { ex: exId, sets: 3, reps: [8, 12], rest: 90 };
}

export function addEntry(exId) {
  const ex = exercise(exId);
  if (!ex) return;
  const item = defaultItem(exId, ex);
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
    if (s.active) s.active.rest = secs ? { until: Date.now() + secs * 1000, total: secs, alerted: false } : null;
  });
}

/** ±N seconds on the time left, without refilling the progress bar. */
export function adjustRest(deltaSecs) {
  update((s) => {
    if (s.active?.rest) s.active.rest = adjustRestPure(s.active.rest, deltaSecs);
  });
}

/** Marks the current rest as already alerted, so a reload does not re-alert. */
export function markRestAlerted() {
  update((s) => {
    if (s.active?.rest) s.active.rest.alerted = true;
  });
}

export function setSessionNotes(text) {
  update((s) => {
    if (s.active) s.active.notes = text;
  });
}

export function finishSession() {
  let finished = null;
  let shouldAskPersist = false;
  update((s) => {
    if (!s.active) return;
    finished = { ...s.active, endedAt: Date.now() };
    delete finished.rest;
    delete finished.current;
    // Keep only what was actually done.
    finished.entries = finished.entries.filter((e) => e.sets.length);
    if (finished.entries.length) s.sessions.push(finished);
    s.active = null;
    if (!s.prefs.persistAsked) {
      s.prefs.persistAsked = true;
      shouldAskPersist = true;
    }
  });
  if (shouldAskPersist) requestPersistentStorage();
  return finished;
}

/**
 * Ask the browser to keep this site's storage around under pressure, once
 * the first workout is finished. Fire-and-forget: there is nothing to show
 * either way (no UI if granted, nothing else changes if denied).
 */
function requestPersistentStorage() {
  try {
    navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}

export function discardSession() {
  update((s) => {
    s.active = null;
  });
}

// ── Editing finished workouts (spec 12) ────────────────────────────────
// Every stat is derived from state.sessions on render, so edits flow into
// records, suggestions and charts with no recalculation step. Several
// metrics assume oldest-first (exerciseHistory, suggest, runs), so the list
// is re-sorted after anything that can move a session in time.

function sortSessions(s) {
  s.sessions.sort((a, b) => a.startedAt - b.startedAt);
}

function findSession(s, id) {
  return s.sessions.find((y) => y.id === id) ?? null;
}

/** patch: name, notes, gymId, startedAt, endedAt, crowd, … No-op for an unknown id. */
export function updateSession(id, patch) {
  update((s) => {
    const x = findSession(s, id);
    if (!x) return;
    Object.assign(x, patch);
    if ('startedAt' in patch || 'endedAt' in patch) sortSessions(s);
  });
}

export function getSession(id) {
  return state.sessions.find((y) => y.id === id) ?? null;
}

export function editSessionSet(id, entryIndex, setIndex, patch) {
  update((s) => {
    const set = findSession(s, id)?.entries[entryIndex]?.sets[setIndex];
    if (set) Object.assign(set, patch);
  });
}

/**
 * Removes one set. When it was the entry's last set the entry goes too, and
 * when that was the session's last entry the session goes. Returns what was
 * removed ({ set, entry, session }) so the caller can offer Undo with
 * restoreSession(), or null for unknown ids.
 */
export function removeSessionSet(id, entryIndex, setIndex) {
  let removed = null;
  update((s) => {
    const x = findSession(s, id);
    const entry = x?.entries[entryIndex];
    if (!entry || !entry.sets[setIndex]) return;
    const [set] = entry.sets.splice(setIndex, 1);
    removed = { set, entry: null, session: null };
    if (!entry.sets.length) {
      x.entries.splice(entryIndex, 1);
      removed.entry = entry;
      if (!x.entries.length) {
        s.sessions = s.sessions.filter((y) => y.id !== id);
        removed.session = x;
      }
    }
  });
  return removed;
}

/** Sets added afterwards have no time (`at: null`); rest averages skip them. */
export function addSessionSet(id, entryIndex, set) {
  update((s) => {
    const entry = findSession(s, id)?.entries[entryIndex];
    if (entry) entry.sets.push({ ...set, at: null });
  });
}

/** Adds an exercise (with the usual default target) to a finished session. Returns its index, or -1. */
export function addSessionEntry(id, exId) {
  const ex = exercise(exId);
  let index = -1;
  if (!ex) return index;
  update((s) => {
    const x = findSession(s, id);
    if (!x) return;
    x.entries.push(entryFor(defaultItem(exId, ex)));
    index = x.entries.length - 1;
  });
  return index;
}

/** Removes an exercise from a finished session. Returns the removed entry, or null. */
export function removeSessionEntry(id, entryIndex) {
  let removed = null;
  update((s) => {
    const x = findSession(s, id);
    if (!x?.entries[entryIndex]) return;
    [removed] = x.entries.splice(entryIndex, 1);
  });
  return removed;
}

/** Put a whole session back as it was (Undo): replaces the one with the same id, or re-inserts it. */
export function restoreSession(snapshot) {
  if (!snapshot?.id) return;
  const copy = JSON.parse(JSON.stringify(snapshot));
  update((s) => {
    s.sessions = s.sessions.filter((y) => y.id !== copy.id);
    s.sessions.push(copy);
    sortSessions(s);
  });
}

/**
 * A workout done without the phone: a finished session for a past date,
 * flagged `manual: true`, with no entries yet. Never touches `active`.
 */
export function addPastSession({ planId = null, startedAt, endedAt }) {
  const plan = planId ? PLAN_BY_ID[planId] : null;
  const session = {
    id: uid(),
    planId: plan ? planId : null,
    name: plan?.name ?? 'Freestyle',
    startedAt,
    endedAt,
    gymId: null,
    geo: null,
    entries: [],
    hr: [],
    manual: true,
  };
  update((s) => {
    s.sessions.push(session);
    sortSessions(s);
  });
  return session;
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

const PREV_KEY = 'gym-pal.v1.prev';

export function exportJson() {
  return JSON.stringify({ app: 'gym-pal', exportedAt: new Date().toISOString(), state }, null, 1);
}

/** Call once "Export backup" has actually produced a file, to drive the Today reminder. */
export function recordBackupExported() {
  update((s) => {
    s.prefs.lastBackupAt = Date.now();
    s.prefs.lastBackupSessionCount = s.sessions.length;
  });
}

/** "Later" on the Today backup-reminder card: hide it for a week. */
export function snoozeBackupReminder(days = 7) {
  update((s) => {
    s.prefs.backupSnoozeUntil = Date.now() + days * 86400000;
  });
}

/**
 * Parse and check a backup file *before* anything is replaced. Accepts the
 * export wrapper `{ app, exportedAt, state }` or a bare state object.
 * Malformed sessions/entries are dropped and counted rather than failing the
 * whole file, so one bad entry does not block the rest of the data.
 */
export function validateBackup(raw) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, error: 'That file is not valid JSON.', summary: null, state: null };
  }

  const isWrapper = data && typeof data === 'object' && !Array.isArray(data) && data.state && typeof data.state === 'object' && !Array.isArray(data.state);
  const candidate = isWrapper ? data.state : data;
  const exportedAt = isWrapper && typeof data.exportedAt === 'string' ? data.exportedAt : null;

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !Array.isArray(candidate.sessions)) {
    return { ok: false, error: 'That file is not a Gym Pal backup.', summary: null, state: null };
  }

  let droppedSessions = 0;
  let droppedEntries = 0;
  const sessions = [];
  for (const s of candidate.sessions) {
    if (!s || typeof s !== 'object' || typeof s.startedAt !== 'number' || !Array.isArray(s.entries)) {
      droppedSessions += 1;
      continue;
    }
    const entries = [];
    for (const e of s.entries) {
      if (!e || typeof e !== 'object' || typeof e.ex !== 'string' || !Array.isArray(e.sets)) {
        droppedEntries += 1;
        continue;
      }
      entries.push(e);
    }
    sessions.push({ ...s, entries });
  }

  const lastAt = sessions.reduce((max, s) => Math.max(max, s.startedAt), 0) || null;
  return {
    ok: true,
    error: null,
    state: { ...candidate, sessions },
    summary: { sessions: sessions.length, lastAt, exportedAt, droppedSessions, droppedEntries },
  };
}

/** Remove the restore/erase undo snapshot. True if there was one. */
function dropPrevious() {
  try {
    if (localStorage.getItem(PREV_KEY) == null) return false;
    localStorage.removeItem(PREV_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort snapshot of the current state, so a restore/erase can be undone. */
function savePrevious() {
  try {
    localStorage.setItem(PREV_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Replace the state with `next` (already validated), keeping an undo copy. */
export function restoreBackup(next) {
  const savedPrev = savePrevious();
  replaceState(next);
  return { savedPrev };
}

/** Same undo copy as restoreBackup, for "Erase everything". */
export function eraseAll() {
  return restoreBackup(defaultState());
}

/** Undo the last restore/erase. Returns false if there is nothing to undo. */
export function restorePrevious() {
  try {
    const raw = localStorage.getItem(PREV_KEY);
    if (!raw) return false;
    const prev = JSON.parse(raw);
    replaceState(prev);
    localStorage.removeItem(PREV_KEY);
    return true;
  } catch {
    return false;
  }
}

export function importJson(text) {
  const result = validateBackup(text);
  if (!result.ok) throw new Error(result.error);
  replaceState(result.state);
}

/**
 * The watch import can add megabytes of per-day data. If adding `watch` to
 * the current state would push it past `maxChars` (close to the ~5 MB
 * localStorage quota, minus headroom for everything else), drop the oldest
 * days until it fits.
 */
export function trimWatchToFit(nextState, maxChars = 4_000_000) {
  const watch = nextState?.watch;
  if (!watch?.days) return { state: nextState, droppedDays: 0 };
  if (JSON.stringify(nextState).length <= maxChars) return { state: nextState, droppedDays: 0 };

  const days = { ...watch.days };
  const order = Object.keys(days).sort();
  let dropped = 0;
  let trimmed = { ...nextState, watch: { ...watch, days } };
  while (order.length && JSON.stringify(trimmed).length > maxChars) {
    delete days[order.shift()];
    dropped += 1;
    trimmed = { ...nextState, watch: { ...watch, days } };
  }
  return { state: trimmed, droppedDays: dropped };
}
