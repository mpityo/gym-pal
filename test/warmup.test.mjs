// Run: node --test test/
// Spec 14: plate calculator, warm-up sets, and how warm-ups are counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  platesPerSide, plateText, warmupSets, needsWarmup, sessionSummary, muscleSets, suggest, exerciseRecords, machineUsage, newRecords,
} from '../assets/js/metrics.js';
import { PLAN_BY_ID } from '../assets/js/data/plans.js';

test('platesPerSide', () => {
  assert.deepEqual(platesPerSide(140).perSide, [45, 25]);
  assert.deepEqual(platesPerSide(90).perSide, [45]);
  assert.deepEqual(platesPerSide(5).perSide, [2.5]);
  const r = platesPerSide(112);
  assert.deepEqual(r.perSide, [45, 10]);
  assert.equal(r.achieved, 110);
  assert.equal(r.exact, false);
  assert.deepEqual(platesPerSide(0).perSide, []);
  assert.deepEqual(platesPerSide(140, [45, 25, 10, 5]).perSide, [45, 25]);
  assert.deepEqual(platesPerSide(70, [45, 25, 10, 5]).perSide, [25, 10], 'no 35s');
  const no25 = platesPerSide(95, [45, 35, 25, 10, 5]);
  assert.deepEqual(no25.perSide, [45]);
  assert.equal(no25.exact, false, 'no 2.5s: 47.5 a side cannot be made');
  assert.deepEqual(platesPerSide(45, PLATES_ONE, { sides: 1 }).perSide, [45]);
});
const PLATES_ONE = [45, 35, 25, 10, 5, 2.5];

test('plateText', () => {
  assert.equal(plateText(115), 'Each side: 45 + 10 + 2.5');
  assert.equal(plateText(112), 'Each side: 45 + 10 (= 110, closest to 112)');
  assert.equal(plateText(0), null);
});

test('warmupSets', () => {
  assert.deepEqual(warmupSets(100, 5), [{ w: 50, reps: 8 }, { w: 75, reps: 4 }]);
  assert.deepEqual(warmupSets(15, 5), []);
  assert.deepEqual(warmupSets(100, 10), [{ w: 50, reps: 8 }, { w: 70, reps: 4 }]);
  assert.deepEqual(warmupSets(185, 10), [{ w: 90, reps: 8 }, { w: 130, reps: 4 }]);
  // Never a duplicate, never the working weight itself.
  assert.deepEqual(warmupSets(20, 5), [{ w: 10, reps: 8 }, { w: 15, reps: 4 }]);
  assert.deepEqual(warmupSets(40, 10), [{ w: 20, reps: 8 }, { w: 30, reps: 4 }]);
});

test('needsWarmup picks the first big push/pull/leg lift', () => {
  const pick = (id) => PLAN_BY_ID[id].items.map((it, i) => (needsWarmup(PLAN_BY_ID[id].items, i) ? it.ex : null)).filter(Boolean);
  assert.deepEqual(pick('upper-a'), ['chest-press', 'lat-pulldown']);
  assert.deepEqual(pick('lower-b'), ['smith-squat']);
  assert.deepEqual(pick('upper-b'), ['incline-press', 'row-machine']);
  // Works on workout entries too.
  const entries = [{ ex: 'treadmill-warmup', target: {} }, { ex: 'chest-press', target: { rest: 120 } }, { ex: 'incline-press', target: { rest: 120 } }];
  assert.equal(needsWarmup(entries, 1), true);
  assert.equal(needsWarmup(entries, 2), false);
});

const T = 1_000_000;
const sessionWith = (sets, startedAt = T) => ({ id: `w${startedAt}`, startedAt, endedAt: startedAt + 3600000, entries: [{ ex: 'chest-press', plannedEx: 'chest-press', sets }] });
const oneWarmupThreeWork = [
  { w: 50, reps: 8, warmup: true, at: T + 1000 },
  { w: 100, reps: 10, at: T + 100000 },
  { w: 100, reps: 10, at: T + 200000 },
  { w: 100, reps: 10, at: T + 300000 },
];

test('warm-ups count toward pounds moved but not sets, rest or sets per muscle', () => {
  const s = sessionWith(oneWarmupThreeWork);
  const sum = sessionSummary(s, 180);
  assert.equal(sum.workSets, 3);
  assert.equal(sum.tonnage, 50 * 8 + 3 * 1000);
  assert.equal(sum.reps, 38);
  assert.equal(sum.avgRestSec, 100, 'rest only between work sets');
  assert.equal(muscleSets([s], 0, T * 10).sets.chest, 3);
  assert.equal(machineUsage([s], 180)[0].sets, 3);
});

test('a heavy single flagged warmup is never a record or a suggestion', () => {
  const earlier = sessionWith([{ w: 100, reps: 10 }, { w: 100, reps: 10 }, { w: 100, reps: 10 }], T - 86400000);
  const s = sessionWith([{ w: 300, reps: 1, warmup: true }, { w: 100, reps: 10 }, { w: 100, reps: 10 }, { w: 100, reps: 10 }]);
  const rec = exerciseRecords([earlier, s], 'chest-press', 180);
  assert.equal(rec.heaviest.w, 100);
  assert.deepEqual(newRecords(s, [earlier], 180), []);
  const sug = suggest('chest-press', { sets: 3, reps: [8, 12] }, [earlier, s], 180);
  assert.equal(sug.w, 100);
  assert.doesNotMatch(sug.reason, /300/);
});
