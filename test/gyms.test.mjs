// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../assets/js/gyms.js';
import * as store from '../assets/js/store.js';
import { PLAN_BY_ID } from '../assets/js/data/plans.js';
import { BY_ID } from '../assets/js/data/exercises.js';

const A = { id: 'a', name: 'Gym A' };
const B = { id: 'b', name: 'Gym B' };
const base = (extra = {}) => ({ ...store.defaultState(), gyms: [A, B], ...extra });
const missingFn = (state, gymId) => (exId) => G.isMissing(state, exId, gymId);

test('machine note: gym note wins field by field, global fills gaps', () => {
  const s = base({
    machineNotes: { 'leg-press': { where: 'back wall', settings: 'seat 4' } },
    gymNotes: { a: { 'leg-press': { where: 'by the stairs' } } },
  });
  assert.deepEqual(G.mergedNote(s, 'leg-press', 'a'), { where: 'by the stairs', settings: 'seat 4', missing: false });
  assert.deepEqual(G.mergedNote(s, 'leg-press', 'b'), { where: 'back wall', settings: 'seat 4', missing: false });
  assert.deepEqual(G.mergedNote(s, 'leg-press', null), { where: 'back wall', settings: 'seat 4', missing: false });
  assert.deepEqual(G.mergedNote(s, 'chest-press', 'a'), { where: '', settings: '', missing: false });
});

test('writing a note goes to the gym when there is one, else to the default', () => {
  const s = base({ machineNotes: { 'leg-press': { where: 'back wall', settings: '' } } });
  G.writeNote(s, 'leg-press', { where: 'front' }, 'a');
  assert.equal(s.gymNotes.a['leg-press'].where, 'front');
  assert.equal(s.machineNotes['leg-press'].where, 'back wall');
  assert.equal(G.mergedNote(s, 'leg-press', 'b').where, 'back wall');

  // Clearing a field at a gym hides the default there.
  G.writeNote(s, 'leg-press', { where: '' }, 'b');
  assert.equal(G.mergedNote(s, 'leg-press', 'b').where, '');

  G.writeNote(s, 'chest-press', { settings: 'seat 3', missing: true }, null);
  assert.deepEqual(s.machineNotes['chest-press'], { where: '', settings: 'seat 3' });

  G.writeNote(s, 'chest-press', { missing: true }, 'a');
  assert.ok(G.isMissing(s, 'chest-press', 'a'));
  G.writeNote(s, 'chest-press', { missing: false }, 'a');
  assert.equal(s.gymNotes.a['chest-press'], undefined, 'an emptied gym note is dropped');
});

test('current gym: workout, then picked, then the only one', () => {
  assert.equal(G.currentGymId(base()), null);
  assert.equal(G.currentGymId({ ...store.defaultState(), gyms: [A] }), 'a');
  assert.equal(G.currentGymId(base({ prefs: { currentGymId: 'b' } })), 'b');
  assert.equal(G.currentGymId(base({ prefs: { currentGymId: 'b' }, active: { gymId: 'a' } })), 'a');
});

test('plan items auto-swap what is missing at that gym only', () => {
  const plan = PLAN_BY_ID['lower-a'];
  const idx = plan.items.findIndex((i) => i.ex === 'leg-press');
  const s = base({ gymNotes: { b: { 'leg-press': { missing: true } } } });

  const atA = G.resolvePlanItems(plan, {}, missingFn(s, 'a'));
  assert.equal(atA[idx].ex, 'leg-press');
  assert.equal(atA[idx].autoSwap, undefined);

  const atB = G.resolvePlanItems(plan, {}, missingFn(s, 'b'));
  assert.equal(atB[idx].ex, BY_ID['leg-press'].alts[0]);
  assert.equal(atB[idx].swappedFrom, 'leg-press');
  assert.equal(atB[idx].autoSwap, true);
  assert.equal(atB[idx].sets, plan.items[idx].sets);
});

test('auto-swap skips missing alts and respects permanent swaps', () => {
  const plan = PLAN_BY_ID['lower-a'];
  const idx = plan.items.findIndex((i) => i.ex === 'leg-press');
  const [alt1, alt2] = BY_ID['leg-press'].alts;
  const s = base({ gymNotes: { b: { 'leg-press': { missing: true }, [alt1]: { missing: true } } } });
  assert.equal(G.resolvePlanItems(plan, {}, missingFn(s, 'b'))[idx].ex, alt2);

  // A permanent swap applies first; it is only replaced if it is missing too.
  const swaps = { [idx]: 'goblet-squat' };
  const kept = G.resolvePlanItems(plan, swaps, missingFn(s, 'b'))[idx];
  assert.equal(kept.ex, 'goblet-squat');
  assert.equal(kept.autoSwap, undefined);
  assert.equal(kept.swappedFrom, 'leg-press');

  s.gymNotes.b['goblet-squat'] = { missing: true };
  // goblet-squat's own alts are all missing here, so it falls back to leg-press's.
  const re = G.resolvePlanItems(plan, swaps, missingFn(s, 'b'))[idx];
  assert.ok(re.autoSwap);
  assert.equal(re.ex, 'hack-squat');
  assert.ok(!G.isMissing(s, re.ex, 'b'));
  assert.equal(re.swappedFrom, 'leg-press');
});

test('unavailable when every alt is missing', () => {
  const plan = PLAN_BY_ID['lower-a'];
  const idx = plan.items.findIndex((i) => i.ex === 'leg-press');
  const gone = Object.fromEntries(['leg-press', ...BY_ID['leg-press'].alts].map((id) => [id, { missing: true }]));
  const s = base({ gymNotes: { b: gone } });
  const item = G.resolvePlanItems(plan, {}, missingFn(s, 'b'))[idx];
  assert.equal(item.ex, 'leg-press');
  assert.equal(item.unavailable, true);
});

test('removing a gym drops its notes and the current pick, not sessions', () => {
  const s = base({
    gymNotes: { a: { 'leg-press': { where: 'x' } }, b: { 'leg-press': { where: 'y' } } },
    prefs: { ...store.defaultState().prefs, currentGymId: 'a' },
    sessions: [{ id: 's1', gymId: 'a', startedAt: 1, entries: [] }],
  });
  G.dropGym(s, 'a');
  assert.deepEqual(s.gyms.map((g) => g.id), ['b']);
  assert.equal(s.gymNotes.a, undefined);
  assert.ok(s.gymNotes.b);
  assert.equal(s.prefs.currentGymId, null);
  assert.equal(s.sessions[0].gymId, 'a');
});

test('gyms are listed most recently used first', () => {
  const C = { id: 'c', name: 'Gym C' };
  const s = base({ gyms: [A, B, C], sessions: [{ gymId: 'a', startedAt: 1 }, { gymId: 'c', startedAt: 5 }, { gymId: 'a', startedAt: 3 }] });
  assert.deepEqual(G.gymsByRecent(s).map((g) => g.id), ['c', 'a', 'b']);
});

test('an old backup (no gymNotes, no currentGymId) restores and behaves as before', () => {
  const old = {
    version: 1,
    sessions: [{ id: 's1', planId: 'lower-a', name: 'Lower A', startedAt: 1, endedAt: 2, gymId: 'g1', entries: [] }],
    active: null,
    profile: { bodyweight: 180 },
    gyms: [{ id: 'g1', name: 'Old gym', lat: 1, lng: 2 }],
    machineNotes: { 'leg-press': { where: 'back wall', settings: 'seat 4' } },
    swaps: {},
    watch: null,
    prefs: { mode: '4day', restAlert: true, keepAwake: true, autoRest: true },
  };
  store.importJson(JSON.stringify({ app: 'gym-pal', state: old }));
  const st = store.getState();
  assert.deepEqual(st.gymNotes, {});
  assert.equal(st.prefs.currentGymId, null);
  assert.equal(store.currentGym(), 'g1');
  assert.deepEqual(store.machineNote('leg-press'), { where: 'back wall', settings: 'seat 4', missing: false });
  assert.deepEqual(store.planItems('lower-a').map((i) => i.ex), PLAN_BY_ID['lower-a'].items.map((i) => i.ex));
});

test('store: notes, missing and a workout follow the gym', () => {
  store.replaceState({ ...store.defaultState(), gyms: [A, B], machineNotes: { 'leg-press': { where: 'back wall', settings: '' } } });
  store.setCurrentGym('a');
  store.setMachineNote('leg-press', { where: 'by the stairs' });
  store.setMachineNote('leg-press', { missing: true }, 'b');
  assert.equal(store.machineNote('leg-press', 'a').where, 'by the stairs');
  assert.equal(store.machineNote('leg-press', 'b').where, 'back wall');

  const idx = PLAN_BY_ID['lower-a'].items.findIndex((i) => i.ex === 'leg-press');
  const a = store.startSession('lower-a', { gymId: 'a' });
  assert.equal(a.entries[idx].ex, 'leg-press');

  // Log a set on the first entry, then move to gym B: only untouched entries are re-picked.
  store.logSet(0, { minutes: 5 });
  store.setSessionGym('b');
  const moved = store.active();
  assert.equal(moved.gymId, 'b');
  assert.equal(store.getState().prefs.currentGymId, 'b');
  assert.equal(moved.entries[0].sets.length, 1);
  assert.equal(moved.entries[idx].ex, BY_ID['leg-press'].alts[0]);
  assert.equal(moved.entries[idx].plannedEx, 'leg-press');
  assert.ok(moved.entries[idx].autoSwap);

  // A hand-picked swap is kept when the gym changes back.
  store.swapExercise(idx, 'goblet-squat');
  store.setSessionGym('a');
  assert.equal(store.active().entries[idx].ex, 'goblet-squat');

  store.copyGymNotes('a', 'b');
  assert.equal(store.machineNote('leg-press', 'b').where, 'by the stairs');
  assert.ok(store.isMissing('leg-press', 'b'), 'copy keeps what was already written at the target');

  store.discardSession();
  store.removeGym('a');
  assert.equal(store.getState().gymNotes.a, undefined);
  store.flush();
});
