// Run: node --test test/
// Spec 15: custom exercises, editable plans, and a custom weekly schedule.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../assets/js/store.js';
import { exercise, allExercises, EXERCISES, registerCustom } from '../assets/js/data/exercises.js';
import { PLANS, PLAN_BY_ID } from '../assets/js/data/plans.js';
import { weekSchedule, plannedMuscleSets, musclesFromText, getPlanFrom } from '../assets/js/routines.js';
import { sessionSummary, muscleSets, suggest, estimateMinutes } from '../assets/js/metrics.js';
import { todayPlan } from '../assets/js/views/today.js';
import { readItem } from '../assets/js/views/custom.js';

test.beforeEach(() => store._resetForTests());
test.after(() => registerCustom([]));

const kickback = { name: 'Glute kickback machine', track: 'weight', load: 'stack', pattern: 'legs', step: 5, muscles: { primary: ['glutes'], secondary: ['hamstrings'] }, look: 'Standing machine with a foot pad', setup: ['Chest on the pad'], cues: ['Squeeze'], alts: ['hip-abductor'] };

test('a custom exercise resolves through exercise() and allExercises(); hidden ones only on request', () => {
  const e = store.addCustomExercise(kickback);
  assert.match(e.id, /^c-/);
  assert.equal(exercise(e.id).name, 'Glute kickback machine');
  assert.equal(exercise(e.id).custom, true);
  assert.equal(allExercises().length, EXERCISES.length + 1);
  store.update((s) => { s.customExercises[0].hidden = true; });
  assert.equal(allExercises().length, EXERCISES.length);
  assert.equal(allExercises({ includeHidden: true }).length, EXERCISES.length + 1);
  assert.ok(exercise(e.id), 'still resolves for old sessions');
});

test('metrics work on a custom exercise', () => {
  const e = store.addCustomExercise(kickback);
  const T = Date.UTC(2026, 10, 16, 12);
  const s = { id: 'x', startedAt: T, endedAt: T + 3600000, entries: [{ ex: e.id, plannedEx: e.id, sets: [{ w: 50, reps: 12 }, { w: 50, reps: 12 }, { w: 50, reps: 12 }] }] };
  assert.equal(sessionSummary(s, 180).tonnage, 1800);
  assert.equal(muscleSets([s], T - 1, T + 1).sets.glutes, 3);
  assert.equal(muscleSets([s], T - 1, T + 1).sets.hamstrings, 1.5);
  const sug = suggest(e.id, { sets: 3, reps: [8, 12] }, [s], 180);
  assert.equal(sug.w, 55);
  assert.equal(sug.up, true);
});

test('deleting a custom exercise hides it with history, removes it without', () => {
  const used = store.addCustomExercise(kickback);
  const unused = store.addCustomExercise({ ...kickback, name: 'Other' });
  store.update((s) => { s.sessions.push({ id: 'x', startedAt: 1, endedAt: 2, entries: [{ ex: used.id, sets: [{ w: 1, reps: 1 }] }] }); });
  assert.equal(store.deleteCustomExercise(used.id), 'hidden');
  assert.equal(store.deleteCustomExercise(unused.id), 'removed');
  assert.equal(exercise(unused.id), null);
  assert.equal(exercise(used.id).hidden, true);
});

test('exerciseNameTaken checks visible names case-insensitively', () => {
  assert.equal(store.exerciseNameTaken('chest press MACHINE', null, allExercises()), true);
  assert.equal(store.exerciseNameTaken('Something new', null, allExercises()), false);
});

test('getPlan/planItems: custom beats built-in; first edit bakes swaps in; reset restores', () => {
  store.setPermanentSwap('upper-a', 1, 'db-bench');
  assert.equal(store.planItems('upper-a', null)[1].ex, 'db-bench');
  store.editPlan('upper-a', (p) => { p.items[2].sets = 4; });
  assert.equal(store.getState().swaps['upper-a'], undefined, 'swaps are forgotten once baked in');
  const items = store.planItems('upper-a', null);
  assert.equal(items[1].ex, 'db-bench', 'the swap was baked in');
  assert.equal(items[2].sets, 4);
  assert.equal(items[1].swappedFrom, undefined);
  // Later permanent swaps edit the custom plan directly.
  store.setPermanentSwap('upper-a', 1, 'smith-bench');
  assert.equal(store.planItems('upper-a', null)[1].ex, 'smith-bench');
  store.resetPlan('upper-a');
  assert.deepEqual(store.planItems('upper-a', null).map((i) => i.ex), PLAN_BY_ID['upper-a'].items.map((i) => i.ex));
});

test('a new plan, a copy, and deleting one also clears it from the schedule', () => {
  const empty = store.createPlan('Push day');
  assert.deepEqual(store.getPlan(empty).items, []);
  const copy = store.createPlan('Copy', 'lower-a');
  assert.deepEqual(store.getPlan(copy).items.map((i) => i.ex), PLAN_BY_ID['lower-a'].items.map((i) => i.ex));
  assert.ok(store.allPlans().some((p) => p.id === copy && !p.builtIn));
  store.setScheduleDay(6, copy, {});
  assert.equal(store.getState().schedule[6], copy);
  store.deletePlan(copy);
  assert.equal(store.getPlan(copy), null);
  assert.equal(store.getState().schedule[6], null);
  store.deletePlan('upper-a');
  assert.ok(store.getPlan('upper-a'), 'built-ins cannot be deleted');
});

test('editing a plan never changes a workout already started or finished', () => {
  const s = store.startSession('upper-a');
  const before = JSON.stringify(s.entries.map((e) => e.target));
  store.editPlan('upper-a', (p) => { p.items.forEach((it) => { it.sets = 5; }); });
  assert.equal(JSON.stringify(store.active().entries.map((e) => e.target)), before);
});

const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();

test('weekSchedule + todayPlan with a custom Mon/Wed/Fri/Sat schedule', () => {
  const state = { ...store.defaultState(), schedule: { 1: 'upper-a', 3: 'lower-a', 5: 'upper-b', 6: 'lower-b' } };
  const week = weekSchedule(state);
  assert.deepEqual(week.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(week.filter((d) => d.plan).map((d) => d.day), [1, 3, 5, 6]);
  // Wednesday 2026-11-18, Monday done.
  const mon = { id: 'm', planId: 'upper-a', startedAt: at(2026, 10, 16, 18), endedAt: at(2026, 10, 16, 19), entries: [] };
  const wed = todayPlan({ ...state, sessions: [mon] }, at(2026, 10, 18));
  assert.equal(wed.planId, 'lower-a');
  assert.equal(wed.rest, false);
  assert.equal(wed.weekTarget, 4);
  assert.equal(wed.weekDone, 1);
  // Thursday, Wednesday missed.
  const thu = todayPlan({ ...state, sessions: [mon] }, at(2026, 10, 19));
  assert.equal(thu.rest, true);
  assert.deepEqual(thu.missed, ['lower-a']);
});

test('todayPlan with schedule: null is unchanged (built-in week, 4 a week)', () => {
  const p = todayPlan({ ...store.defaultState(), sessions: [] }, at(2026, 10, 16));
  assert.equal(p.planId, 'upper-a');
  assert.equal(p.weekTarget, 4);
  assert.equal(weekSchedule(store.defaultState()).length, 7);
});

test('plannedMuscleSets for the built-in 4-day week matches muscleSets of a week doing each plan once in full', () => {
  const plans = ['upper-a', 'lower-a', 'upper-b', 'lower-b'].map((id) => PLAN_BY_ID[id]);
  const planned = plannedMuscleSets(plans);
  const T = at(2026, 10, 16);
  const sessions = plans.map((p, i) => ({
    id: p.id,
    startedAt: T + i * 86400000,
    endedAt: T + i * 86400000 + 3600000,
    entries: p.items.map((it) => ({ ex: it.ex, sets: Array.from({ length: it.sets }, () => ({ w: 50, reps: 10, minutes: 5, secs: 30 })) })),
  }));
  const done = muscleSets(sessions, T - 1, T + 7 * 86400000).sets;
  assert.deepEqual(planned, done);
});

test('backups round-trip customExercises, customPlans and schedule; an old backup still loads', () => {
  store.addCustomExercise(kickback);
  store.createPlan('Mine');
  store.setScheduleDay(1, 'upper-a', {});
  const v = store.validateBackup(store.exportJson());
  assert.equal(v.ok, true);
  store._resetForTests();
  store.restoreBackup(v.state);
  const st = store.getState();
  assert.equal(st.customExercises.length, 1);
  assert.equal(Object.keys(st.customPlans).length, 1);
  assert.equal(st.schedule[1], 'upper-a');
  assert.ok(exercise(st.customExercises[0].id), 'registered again after restore');
  // A backup from before this change.
  store.restoreBackup({ sessions: [], profile: {}, prefs: { mode: '4day' } });
  assert.deepEqual(store.getState().customExercises, []);
  assert.deepEqual(store.getState().customPlans, {});
  assert.equal(store.getState().schedule, null);
});

test('musclesFromText maps Claude-style muscle text to ids', () => {
  assert.deepEqual(musclesFromText('Glutes, hamstrings'), { primary: ['glutes'], secondary: ['hamstrings'] });
  assert.deepEqual(musclesFromText('Rear delts and upper back'), { primary: ['rearDelts'], secondary: ['upperBack'] });
  assert.deepEqual(musclesFromText('Lats, biceps, something odd'), { primary: ['back'], secondary: ['biceps'] });
  assert.deepEqual(musclesFromText(''), { primary: [], secondary: [] });
});

test('readItem validates the plan item editor', () => {
  const press = exercise('chest-press');
  assert.deepEqual(readItem(press, { sets: '4', a: '6', b: '10', rest: '120', note: '' }).item, { sets: 4, reps: [6, 10], rest: 120 });
  assert.ok(readItem(press, { sets: '9', a: '6', b: '10', rest: '90' }).error);
  assert.ok(readItem(press, { sets: '3', a: '12', b: '8', rest: '90' }).error);
  assert.deepEqual(readItem(exercise('plank'), { sets: '3', a: '30', b: '45', rest: '60' }).item, { sets: 3, secs: [30, 45], rest: 60 });
  assert.deepEqual(readItem(exercise('mile-run'), { sets: '1', a: '', b: '1', rest: '' }).item, { sets: 1, miles: 1 });
  assert.ok(readItem(exercise('mile-run'), { sets: '1', a: '', b: '', rest: '' }).error);
});

test('estimateMinutes moved to metrics and gives the same numbers', () => {
  assert.ok(estimateMinutes(PLANS[0].items) > 30);
  assert.equal(getPlanFrom({}, 'upper-a').name, 'Upper A');
});

test('a plan scheduled twice a week counts twice toward the weekly target', () => {
  const state = { ...store.defaultState(), schedule: { 1: 'upper-a', 3: 'lower-a', 6: 'upper-a' } };
  const s = (d, planId) => ({ id: `${d}${planId}`, planId, startedAt: at(2026, 10, 16 + d, 18), endedAt: at(2026, 10, 16 + d, 19), entries: [] });
  const p = todayPlan({ ...state, sessions: [s(0, 'upper-a'), s(2, 'lower-a'), s(5, 'upper-a'), s(5, 'upper-a')] }, at(2026, 10, 22));
  assert.equal(p.weekTarget, 3);
  assert.equal(p.weekDone, 3);
  assert.equal(p.extra, 1);
});
