// Run: node --test test/
//
// store.js touches `localStorage`, `navigator` and `pagehide` at module load
// and inside flush(), so it is stubbed here with an in-memory localStorage
// *before* the module is imported (a dynamic import, since a static one
// would run before this file's own code).
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


test.beforeEach(() => {
  store._resetForTests();
});

test('startSession creates one entry per plan item with the right targets', () => {
  const s = store.startSession('upper-a');
  const items = store.planItems('upper-a');
  assert.equal(s.entries.length, items.length);
  assert.equal(s.name, 'Upper A');
  s.entries.forEach((entry, i) => {
    assert.equal(entry.ex, items[i].ex);
    assert.equal(entry.target.sets, items[i].sets ?? 3);
    assert.equal(entry.target.rest, items[i].rest ?? 90);
    assert.deepEqual(entry.sets, []);
    assert.equal(entry.skipped, false);
  });
});

test('startSession(null) creates a Freestyle session with no entries', () => {
  const s = store.startSession(null);
  assert.equal(s.name, 'Freestyle');
  assert.deepEqual(s.entries, []);
  assert.equal(s.planId, null);
});

test('logSet appends with an at timestamp and clears skipped', () => {
  store.startSession('upper-a');
  store.skipEntry(1, true);
  store.logSet(1, { w: 100, reps: 10 });
  const entry = store.active().entries[1];
  assert.equal(entry.sets.length, 1);
  assert.equal(entry.sets[0].w, 100);
  assert.equal(entry.sets[0].reps, 10);
  assert.ok(typeof entry.sets[0].at === 'number');
  assert.equal(entry.skipped, false);
});

test('removeSet removes a logged set', () => {
  store.startSession('upper-a');
  store.logSet(1, { w: 100, reps: 10 });
  store.logSet(1, { w: 100, reps: 9 });
  store.removeSet(1, 0);
  const entry = store.active().entries[1];
  assert.equal(entry.sets.length, 1);
  assert.equal(entry.sets[0].reps, 9);
});

test('editSet patches an existing set', () => {
  store.startSession('upper-a');
  store.logSet(1, { w: 100, reps: 10 });
  store.editSet(1, 0, { w: 105 });
  assert.equal(store.active().entries[1].sets[0].w, 105);
});

test('skipEntry marks and unmarks an entry as skipped', () => {
  store.startSession('upper-a');
  store.skipEntry(1, true);
  assert.equal(store.active().entries[1].skipped, true);
  store.skipEntry(1, false);
  assert.equal(store.active().entries[1].skipped, false);
});

test('swapExercise changes the exercise id, and ignores unknown ids', () => {
  store.startSession('upper-a');
  store.swapExercise(1, 'incline-press');
  assert.equal(store.active().entries[1].ex, 'incline-press');
  store.swapExercise(1, 'not-a-real-exercise');
  assert.equal(store.active().entries[1].ex, 'incline-press');
});

test('addEntry picks the right defaults by track', () => {
  store.startSession(null);
  store.addEntry('mile-run'); // cardio
  store.addEntry('plank'); // time
  store.addEntry('chest-press'); // weight
  const entries = store.active().entries;
  assert.equal(entries[0].target.minutes, 10);
  assert.equal(entries[1].target.secs[0], 30);
  assert.deepEqual(entries[2].target.reps, [8, 12]);
});

test('addEntry does nothing for an unknown exercise id', () => {
  store.startSession(null);
  store.addEntry('not-a-real-exercise');
  assert.equal(store.active().entries.length, 0);
});

test('setPermanentSwap applies to planItems with swappedFrom, and reversing removes it', () => {
  store.setPermanentSwap('upper-a', 1, 'incline-press');
  let items = store.planItems('upper-a');
  assert.equal(items[1].ex, 'incline-press');
  assert.equal(items[1].swappedFrom, 'chest-press');

  store.setPermanentSwap('upper-a', 1, 'chest-press'); // back to original
  items = store.planItems('upper-a');
  assert.equal(items[1].ex, 'chest-press');
  assert.equal(items[1].swappedFrom, undefined);
});

test('finishSession drops empty entries, strips rest/current, and clears active', () => {
  store.startSession('upper-a');
  store.logSet(1, { w: 100, reps: 10 });
  store.setRest(30);
  const finished = store.finishSession();
  assert.ok(finished);
  assert.ok(finished.entries.every((e) => e.sets.length > 0));
  assert.equal(finished.rest, undefined);
  assert.equal(finished.current, undefined);
  assert.equal(store.active(), null);
});

test('finishSession does not save a session with nothing logged', () => {
  store.startSession('upper-a');
  const finished = store.finishSession();
  assert.equal(finished.entries.length, 0);
  assert.equal(store.getState().sessions.length, 0);
  assert.equal(store.active(), null);
});

test('exportJson / importJson round-trips, and rejects a non-backup file', () => {
  store.startSession('upper-a');
  store.logSet(0, { minutes: 5 });
  store.finishSession();
  const json = store.exportJson();

  store._resetForTests();
  assert.equal(store.getState().sessions.length, 0);

  store.importJson(json);
  assert.equal(store.getState().sessions.length, 1);

  assert.throws(() => store.importJson('{"foo":1}'), /That file is not a Gym Pal backup\./);
});

test('nearestGym returns a gym within 400 m and null beyond it', () => {
  store._resetForTests();
  const g = store.addGym({ name: 'Downtown', lat: 40.0, lng: -74.0 });
  const near = store.nearestGym({ lat: 40.0005, lng: -74.0 }); // ~56 m away
  assert.equal(near?.id, g.id);
  const far = store.nearestGym({ lat: 40.01, lng: -74.0 }); // ~1.1 km away
  assert.equal(far, null);
});


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

test('flush() gives up the undo snapshot when that is what makes the save fit', () => {
  store._resetForTests();
  globalThis.localStorage.setItem('gym-pal.v1.prev', '{"sessions":[]}');
  const real = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = function (key, value) {
    if (globalThis.localStorage.getItem('gym-pal.v1.prev') != null) {
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return real.call(this, key, value);
  };
  try {
    assert.equal(store.flush(), true);
    assert.equal(globalThis.localStorage.getItem('gym-pal.v1.prev'), null);
    assert.deepEqual(store.saveStatus(), { ok: true, error: null });
  } finally {
    globalThis.localStorage.setItem = real;
  }
});

test('swapExercise records why it was swapped; an unknown reason is ignored', () => {
  store._resetForTests();
  store.startSession('upper-a');
  const alt = store.active().entries[1].ex === 'pec-deck' ? 'cable-fly' : 'pec-deck';
  store.swapExercise(1, alt, 'taken');
  assert.equal(store.active().entries[1].swapReason, 'taken');
  store.swapExercise(1, 'chest-press', 'bogus');
  assert.equal(store.active().entries[1].swapReason, 'taken');
});
