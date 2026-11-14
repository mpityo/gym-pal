// Run: node --test test/
// Spec 13: last time per set, live PRs, plateau deloads, bodyweight text fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lastPerformance, setRecords, suggest, compareSet } from '../assets/js/metrics.js';
import { exercise } from '../assets/js/data/exercises.js';

const DAY = 86400000;
let n = 0;
const session = (day, ex, sets) => ({ id: `p${n++}`, startedAt: day * DAY, endedAt: day * DAY + 3600000, entries: [{ ex, plannedEx: ex, sets }] });
const sets = (w, ...reps) => reps.map((r) => ({ w, reps: r }));
const target = { sets: 3, reps: [8, 12] };

test('lastPerformance: none, one, several (picks the latest)', () => {
  assert.equal(lastPerformance([], 'chest-press'), null);
  const one = [session(1, 'chest-press', sets(100, 12, 10, 9))];
  assert.deepEqual(lastPerformance(one, 'chest-press').sets.map((s) => s.reps), [12, 10, 9]);
  const several = [...one, session(3, 'chest-press', sets(105, 8, 8, 8)), session(2, 'pec-deck', sets(80, 10))];
  const last = lastPerformance(several, 'chest-press');
  assert.equal(last.date, 3 * DAY);
  assert.equal(last.sets[0].w, 105);
});

test('setRecords: quiet with no history', () => {
  assert.deepEqual(setRecords({ w: 200, reps: 10 }, 'chest-press', [], [], 180), []);
});

test('setRecords: heavier than ever → heaviest set (+ e1RM); an identical second set today → nothing', () => {
  const earlier = [session(1, 'chest-press', sets(100, 10, 10, 10))];
  const kinds = setRecords({ w: 110, reps: 8 }, 'chest-press', earlier, [], 180).map((r) => r.kind);
  assert.ok(kinds.includes('Heaviest set'));
  assert.ok(kinds.includes('Estimated 1-rep max'));
  const heavy = setRecords({ w: 110, reps: 8 }, 'chest-press', earlier, [], 180).find((r) => r.kind === 'Heaviest set');
  assert.deepEqual([heavy.value, heavy.was], [110, 100]);
  assert.deepEqual(setRecords({ w: 110, reps: 8 }, 'chest-press', earlier, [{ w: 110, reps: 8 }], 180), []);
});

test('setRecords: less assistance on an assisted exercise; a longer hold', () => {
  const earlier = [session(1, 'assisted-pullup', sets(60, 8, 8, 8))];
  assert.deepEqual(setRecords({ w: 50, reps: 8 }, 'assisted-pullup', earlier, [], 180).map((r) => r.kind), ['Least assistance']);
  const holds = [session(1, 'plank', [{ secs: 45 }, { secs: 40 }])];
  const r = setRecords({ secs: 50 }, 'plank', holds, [], 180);
  assert.deepEqual(r.map((x) => [x.kind, x.value, x.was]), [['Longest hold', 50, 45]]);
});

test('suggest: three flat sessions → deload to 90% rounded down to the step (5 lb)', () => {
  const hist = [session(1, 'chest-press', sets(100, 10, 9, 8)), session(3, 'chest-press', sets(100, 10, 9, 8)), session(5, 'chest-press', sets(100, 9, 9, 8))];
  const s = suggest('chest-press', target, hist, 180);
  assert.equal(s.deload, true);
  assert.equal(s.w, 90);
  assert.equal(s.reps, 12);
  assert.match(s.reason, /Three sessions at 100 lb without adding reps\. Drop to 90 lb/);
});

test('suggest: plateau on a 10 lb step exercise rounds down to the step', () => {
  const hist = [session(1, 'leg-press', sets(185, 10, 9, 8)), session(3, 'leg-press', sets(185, 10, 9, 8)), session(5, 'leg-press', sets(185, 10, 9, 8))];
  const s = suggest('leg-press', target, hist, 180);
  assert.equal(s.deload, true);
  assert.equal(s.w, 160); // 166.5 → 160
});

test('suggest: improving reps, only two sessions, or all maxed → no deload', () => {
  const improving = [session(1, 'chest-press', sets(100, 9, 8, 8)), session(3, 'chest-press', sets(100, 10, 9, 8)), session(5, 'chest-press', sets(100, 10, 10, 9))];
  assert.notEqual(suggest('chest-press', target, improving, 180).deload, true);
  const two = [session(1, 'chest-press', sets(100, 10, 9, 8)), session(3, 'chest-press', sets(100, 10, 9, 8))];
  assert.notEqual(suggest('chest-press', target, two, 180).deload, true);
  const maxed = [session(1, 'chest-press', sets(100, 10, 9, 8)), session(3, 'chest-press', sets(100, 10, 9, 8)), session(5, 'chest-press', sets(100, 12, 12, 12))];
  const s = suggest('chest-press', target, maxed, 180);
  assert.notEqual(s.deload, true);
  assert.equal(s.up, true);
  assert.equal(s.w, 105);
});

test('suggest: bodyweight text and value agree, also when capped', () => {
  const normal = suggest('pushup', target, [session(1, 'pushup', [{ w: 0, reps: 10 }])], 180);
  assert.equal(normal.text, `${normal.reps} reps`);
  assert.equal(normal.reps, 11);
  const capped = suggest('pushup', target, [session(1, 'pushup', [{ w: 0, reps: 30 }])], 180);
  assert.equal(capped.reps, 17); // max 12 + 5
  assert.equal(capped.text, '17 reps');
  assert.match(capped.reason, /well past the range/);
});

test('compareSet: weight first, then reps; holds by seconds; nothing for cardio', () => {
  const press = exercise('chest-press');
  assert.equal(compareSet({ w: 105, reps: 8 }, { w: 100, reps: 10 }, press).text, '▲ +5 lb');
  assert.equal(compareSet({ w: 100, reps: 11 }, { w: 100, reps: 10 }, press).text, '▲ +1 rep');
  assert.equal(compareSet({ w: 100, reps: 8 }, { w: 100, reps: 10 }, press).text, '▼ −2 reps');
  assert.equal(compareSet({ w: 100, reps: 10 }, { w: 100, reps: 10 }, press).text, '=');
  assert.equal(compareSet({ w: 50, reps: 8 }, { w: 60, reps: 8 }, exercise('assisted-pullup')).dir, 1, 'less assist is better');
  assert.equal(compareSet({ secs: 50 }, { secs: 45 }, exercise('plank')).text, '▲ +5 s');
  assert.equal(compareSet({ minutes: 10 }, { minutes: 11 }, exercise('mile-run')), null);
  assert.equal(compareSet({ w: 1, reps: 1 }, undefined, press), null);
});
