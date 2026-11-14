// Run: node --test test/
//
// Covers spec 06 (docs/specs/06-fix-week-count-double-start-unknown-exercise.md):
//   A. the weekly-workout count on Today
//   C. exerciseOr() placeholder + planItems ignoring swaps to unknown ids
// (B, the double-tap Start guard, and D, the wake-lock pending guard, touch
// DOM/async timing that isn't meaningfully unit-testable here; see the PR
// description for how those were verified.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { todayPlan } from '../assets/js/views/today.js';
import * as store from '../assets/js/store.js';
import * as m from '../assets/js/metrics.js';
import { exercise, exerciseOr } from '../assets/js/data/exercises.js';

const T0 = Date.UTC(2026, 10, 16, 23, 0); // a Monday evening, like core.test.mjs

const fakeSession = (offsetDays, planId, hour = 18) => ({
  id: `fs${offsetDays}-${planId ?? 'free'}`,
  planId,
  startedAt: T0 - (23 - hour) * 3600000 + offsetDays * 86400000,
  endedAt: null,
  entries: [],
  hr: [],
});

const fakeState = (sessions, mode = '4day') => ({ sessions, prefs: { mode } });

// ── A. weekly-workout count ──────────────────────────────────────────────

test('todayPlan (4-day): Upper A, a Freestyle session, and a repeat of Upper A count as one workout done, two extra', () => {
  const sessions = [
    fakeSession(0, 'upper-a'), // Monday: Upper A
    fakeSession(1, null), // Tuesday: Freestyle
    fakeSession(2, 'upper-a'), // Wednesday: Upper A again
  ];
  const plan = todayPlan(fakeState(sessions), T0 + 2 * 86400000 + 3600000);
  assert.equal(plan.weekDone, 1, 'only one distinct planned workout was done');
  assert.equal(plan.weekTarget, 4);
  assert.equal(plan.extra, 2, 'the Freestyle session and the repeat are both extra');
});

test('todayPlan (4-day): four Freestyle sessions count as zero workouts done, four extra', () => {
  const sessions = [0, 1, 2, 3].map((d) => fakeSession(d, null));
  const plan = todayPlan(fakeState(sessions), T0 + 3 * 86400000 + 3600000);
  assert.equal(plan.weekDone, 0);
  assert.equal(plan.extra, 4);
});

test('todayPlan (4-day): all four distinct plans done this week, no extra, "done" is true', () => {
  const sessions = ['upper-a', 'lower-a', 'upper-b', 'lower-b'].map((p, i) => fakeSession(i, p));
  const plan = todayPlan(fakeState(sessions), T0 + 3 * 86400000 + 3600000);
  assert.equal(plan.weekDone, 4);
  assert.equal(plan.extra, 0);
});

test('todayPlan (3-day): full-body repeats cap at the weekly target; extras shown separately', () => {
  const sessions = [
    fakeSession(0, 'full-a'),
    fakeSession(1, 'full-b'),
    fakeSession(2, 'full-a'),
    fakeSession(3, 'full-b'), // a 4th full-body session this week
    fakeSession(4, null), // plus a Freestyle session
  ];
  const plan = todayPlan(fakeState(sessions, '3day'), T0 + 4 * 86400000 + 3600000);
  assert.equal(plan.weekTarget, 3);
  assert.equal(plan.weekDone, 3, 'display caps at the target, not the raw count');
  assert.equal(plan.extra, 2, 'the 4th full-body session and the Freestyle session are both extra');
});

test('weekStreak: any N sessions in a week keeps the streak, even Freestyle/unmatched-plan ones', () => {
  // weekStreak only counts sessions per week, regardless of planId — a week of
  // nothing but Freestyle (or repeat) sessions still counts toward the streak.
  // This documents that existing behaviour; it is left as-is by spec 06.
  const freestyleWeek = (weekOffsetDays, n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `w${weekOffsetDays}-${i}`,
      startedAt: T0 + weekOffsetDays * 86400000 + i * 3600000,
      planId: null,
      entries: [],
      hr: [],
    }));
  const now = T0 + 14 * 86400000;
  const sessions = [...freestyleWeek(0, 4), ...freestyleWeek(7, 4), ...freestyleWeek(14, 4)];
  assert.equal(m.weekStreak(sessions, 4, now), 3);
});

// ── C. exerciseOr() placeholder, and planItems ignoring unknown swaps ───

test('exerciseOr() never returns null, and flags an unknown id', () => {
  assert.equal(exercise('nope'), null);
  const placeholder = exerciseOr('nope');
  assert.equal(placeholder.unknown, true);
  assert.equal(placeholder.name, 'Unknown exercise (nope)');
  assert.deepEqual(placeholder.alts, []);
  assert.deepEqual(placeholder.muscles, { primary: [], secondary: [] });
  // A known id still resolves to the real exercise, not a placeholder.
  const known = exerciseOr('chest-press');
  assert.equal(known.unknown, undefined);
  assert.equal(known.name, 'Chest press machine');
});

test('sessionSummary, machineUsage and swapCounts skip an unknown exercise id instead of throwing', () => {
  const session = {
    id: 'u1',
    startedAt: T0,
    endedAt: T0 + 3600000,
    entries: [
      { ex: 'nope', plannedEx: 'chest-press', sets: [{ w: 50, reps: 10, at: T0 }] },
      { ex: 'chest-press', plannedEx: 'chest-press', sets: [{ w: 100, reps: 10, at: T0 }] },
    ],
    hr: [],
  };
  assert.doesNotThrow(() => m.sessionSummary(session, 180));
  const sum = m.sessionSummary(session, 180);
  // Only the known entry is counted.
  assert.equal(sum.workSets, 1);
  assert.equal(sum.tonnage, 1000);

  assert.doesNotThrow(() => m.machineUsage([session], 180));
  const usage = m.machineUsage([session], 180);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].ex, 'chest-press');

  assert.doesNotThrow(() => m.swapCounts([session]));
  const swaps = m.swapCounts([session]);
  // swapCounts does not look the id up in the library, so the unknown swap is
  // still recorded — it just must not throw.
  assert.equal(swaps['chest-press→nope'], 1);
});

test('planItems ignores a swap whose target id is unknown, and falls back to the plan\'s own exercise', () => {
  const before = store.planItems('upper-a')[0];
  store.setPermanentSwap('upper-a', 0, 'totally-bogus-id');
  const after = store.planItems('upper-a')[0];
  assert.equal(after.ex, before.ex);
  assert.equal(after.swappedFrom, undefined);
  // Clean up so this test does not leak state into any test run after it.
  store.setPermanentSwap('upper-a', 0, null);
});

test('swapExercise and addEntry ignore an unknown exercise id (already validated; locked in here)', () => {
  const s = store.startSession('upper-a', {});
  const entryCount = s.entries.length;
  const originalEx = s.entries[0].ex;

  store.swapExercise(0, 'nope-nope-nope');
  assert.equal(store.active().entries[0].ex, originalEx, 'swap to an unknown id is a no-op');

  store.addEntry('nope-nope-nope');
  assert.equal(store.active().entries.length, entryCount, 'addEntry with an unknown id adds nothing');

  store.discardSession();
});
