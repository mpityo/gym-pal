// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../assets/js/store.js';

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
