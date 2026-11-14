// Run: node --test test/
//
// store.js touches `localStorage`, `navigator` and `pagehide` at module load
// and inside flush(), so it is stubbed here with an in-memory localStorage
// *before* the module is imported (a dynamic import, since a static one
// would run before this file's own code). Spec 01's globalThis.addEventListener
// change (instead of window.addEventListener) is what makes this importable
// in Node at all; it is included directly in store.js on this branch.
import test from 'node:test';
import assert from 'node:assert/strict';

function makeLocalStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
  };
}

globalThis.localStorage = makeLocalStorage();

const store = await import('../assets/js/store.js');

function freshSession(startedAt, entries) {
  return { id: `s${startedAt}`, startedAt, endedAt: startedAt + 60000, entries };
}

test('flush() saves and clears any previous error', () => {
  store._resetForTests();
  assert.equal(store.flush(), true);
  assert.deepEqual(store.saveStatus(), { ok: true, error: null });
});

test('flush() returns false and records saveError when localStorage.setItem throws', () => {
  store._resetForTests();
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    const err = new Error('quota');
    err.name = 'QuotaExceededError';
    throw err;
  };

  assert.equal(store.flush(), false);
  const failed = store.saveStatus();
  assert.equal(failed.ok, false);
  assert.equal(failed.error.name, 'QuotaExceededError');
  assert.equal(typeof failed.error.at, 'number');

  // Recovers once storage is usable again, and the banner condition clears.
  globalThis.localStorage.setItem = real;
  assert.equal(store.flush(), true);
  assert.deepEqual(store.saveStatus(), { ok: true, error: null });
});

test('flush() notifies subscribers on both failure and recovery', () => {
  store._resetForTests();
  const seen = [];
  const unsubscribe = store.subscribe(() => seen.push(store.saveStatus().ok));
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error('nope');
  };
  store.flush();
  globalThis.localStorage.setItem = real;
  store.flush();
  unsubscribe();
  assert.deepEqual(seen, [false, true]);
});

test('validateBackup accepts a bare state object', () => {
  const state = { sessions: [freshSession(1000, [{ ex: 'chest-press', sets: [{ w: 100, reps: 10 }] }])] };
  const result = store.validateBackup(JSON.stringify(state));
  assert.equal(result.ok, true);
  assert.equal(result.summary.sessions, 1);
  assert.equal(result.summary.droppedSessions, 0);
  assert.equal(result.summary.droppedEntries, 0);
});

test('validateBackup accepts the export wrapper and reports exportedAt', () => {
  const wrapper = {
    app: 'gym-pal',
    exportedAt: '2026-11-03T12:00:00.000Z',
    state: { sessions: [freshSession(2000, [])] },
  };
  const result = store.validateBackup(JSON.stringify(wrapper));
  assert.equal(result.ok, true);
  assert.equal(result.summary.exportedAt, '2026-11-03T12:00:00.000Z');
  assert.equal(result.summary.sessions, 1);
});

test('validateBackup rejects non-JSON with a clear message', () => {
  const result = store.validateBackup('{ this is not json');
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/i);
});

test('validateBackup rejects a file with no sessions array', () => {
  const result = store.validateBackup(JSON.stringify({ profile: {} }));
  assert.equal(result.ok, false);
  assert.match(result.error, /not a Gym Pal backup/i);
});

test('validateBackup drops malformed sessions and entries, and counts them', () => {
  const state = {
    sessions: [
      freshSession(1000, [{ ex: 'chest-press', sets: [{ w: 100, reps: 10 }] }]),
      { id: 'bad-session', startedAt: 'not a number', entries: [] }, // bad startedAt
      { id: 'no-entries', startedAt: 2000 }, // entries not an array
      freshSession(3000, [
        { ex: 'squat', sets: [{ w: 135, reps: 5 }] },
        { ex: 123, sets: [] }, // ex not a string
        { ex: 'ok', sets: 'nope' }, // sets not an array
      ]),
    ],
  };
  const result = store.validateBackup(state); // also accepts an object, not just a string
  assert.equal(result.ok, true);
  assert.equal(result.summary.sessions, 2); // the two malformed sessions were dropped
  assert.equal(result.summary.droppedSessions, 2);
  assert.equal(result.summary.droppedEntries, 2);
  assert.equal(result.state.sessions[1].entries.length, 1); // only the good entry survives
});

test('trimWatchToFit leaves a state alone when it already fits', () => {
  const state = { watch: { days: { '2026-01-01': { steps: 100 } } } };
  const { state: out, droppedDays } = store.trimWatchToFit(state, 10_000);
  assert.equal(droppedDays, 0);
  assert.equal(out, state);
});

test('trimWatchToFit drops the oldest days first, until the state fits', () => {
  const days = {};
  for (let i = 1; i <= 30; i++) {
    const k = `2026-01-${String(i).padStart(2, '0')}`;
    days[k] = { steps: 10000, hrLow: 60, hrHigh: 150, hrAvg: 90, sleepMin: 420, weightKg: 80 };
  }
  const state = { sessions: [], watch: { days } };
  const fullSize = JSON.stringify(state).length;
  const cap = Math.round(fullSize * 0.5); // force roughly half the days to go

  const { state: out, droppedDays } = store.trimWatchToFit(state, cap);
  assert.ok(droppedDays > 0, 'should have dropped some days');
  assert.ok(JSON.stringify(out).length <= cap, 'trimmed state should fit under the cap');

  const keptKeys = Object.keys(out.watch.days).sort();
  const droppedKeys = Object.keys(days)
    .sort()
    .slice(0, droppedDays);
  // The oldest keys (lexicographically first, since dayKey is YYYY-MM-DD) go first.
  for (const k of droppedKeys) assert.ok(!keptKeys.includes(k), `${k} should have been dropped`);
  assert.equal(keptKeys.length + droppedDays, 30);
});

test('trimWatchToFit is a no-op when there is no watch data', () => {
  const state = { sessions: [{ id: 's1' }] };
  const { state: out, droppedDays } = store.trimWatchToFit(state, 1);
  assert.equal(droppedDays, 0);
  assert.equal(out, state);
});

test('restoreBackup keeps an undo copy that restorePrevious brings back', () => {
  store._resetForTests({ ...store.defaultState(), sessions: [freshSession(1, [])] });
  const before = store.getState();
  assert.equal(before.sessions.length, 1);

  const next = { ...store.defaultState(), sessions: [freshSession(2, []), freshSession(3, [])] };
  const { savedPrev } = store.restoreBackup(next);
  assert.equal(savedPrev, true);
  assert.equal(store.getState().sessions.length, 2);

  const undone = store.restorePrevious();
  assert.equal(undone, true);
  assert.equal(store.getState().sessions.length, 1);
  assert.equal(store.getState().sessions[0].startedAt, 1);
});

test('restorePrevious returns false when there is nothing to undo', () => {
  store._resetForTests();
  globalThis.localStorage.removeItem('gym-pal.v1.prev');
  assert.equal(store.restorePrevious(), false);
});

test('eraseAll replaces state with defaults but keeps an undo copy', () => {
  store._resetForTests({ ...store.defaultState(), sessions: [freshSession(1, [])] });
  const { savedPrev } = store.eraseAll();
  assert.equal(savedPrev, true);
  assert.equal(store.getState().sessions.length, 0);
  assert.equal(store.restorePrevious(), true);
  assert.equal(store.getState().sessions.length, 1);
});

test('recordBackupExported and snoozeBackupReminder update prefs', () => {
  store._resetForTests();
  store.recordBackupExported();
  assert.equal(typeof store.getState().prefs.lastBackupAt, 'number');
  assert.equal(store.getState().prefs.lastBackupSessionCount, 0);

  const before = Date.now();
  store.snoozeBackupReminder(7);
  assert.ok(store.getState().prefs.backupSnoozeUntil > before);
});

test('defaultState has defaults for every new persisted field', () => {
  const d = store.defaultState();
  assert.equal(d.prefs.persistAsked, false);
  assert.equal(d.prefs.lastBackupAt, null);
  assert.equal(d.prefs.lastBackupSessionCount, 0);
  assert.equal(d.prefs.backupSnoozeUntil, null);
});
