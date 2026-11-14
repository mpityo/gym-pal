// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { todayPlan } from '../assets/js/views/today.js';
import { defaultState } from '../assets/js/store.js';

const MON = new Date(2026, 10, 16, 12, 0, 0).getTime(); // Monday
const day = (n) => MON + n * 86400000;

const session = (planId, ts) => ({ id: `s-${planId}-${ts}`, planId, startedAt: ts, endedAt: ts + 3600000, entries: [], hr: [] });

const state = (sessions, prefs = {}) => ({ ...defaultState(), sessions, prefs: { ...defaultState().prefs, ...prefs } });

test('Monday with no sessions is upper-a, not a rest day', () => {
  const plan = todayPlan(state([]), day(0));
  assert.equal(plan.planId, 'upper-a');
  assert.equal(plan.rest, false);
});

test('Wednesday with Monday done and Tuesday missed suggests catching up on lower-a', () => {
  const sessions = [session('upper-a', day(0))];
  const plan = todayPlan(state(sessions), day(2));
  assert.equal(plan.rest, true);
  assert.equal(plan.planId, 'lower-a');
  assert.equal(plan.label, 'Catch up');
});

test('Saturday with all four done this week points at upper-a, labelled Next', () => {
  const sessions = [session('upper-a', day(0)), session('lower-a', day(1)), session('upper-b', day(3)), session('lower-b', day(4))];
  const plan = todayPlan(state(sessions), day(5));
  assert.equal(plan.planId, 'upper-a');
  assert.equal(plan.label, 'Next');
  assert.equal(plan.missed.length, 0);
});

test('3-day mode alternates full-a / full-b based on the last full-body session', () => {
  const sessions = [session('full-a', day(0) - 86400000 * 7)];
  const plan = todayPlan(state(sessions, { mode: '3day' }), day(0)); // Monday, a 3-day training day
  assert.equal(plan.planId, 'full-b');
  assert.equal(plan.rest, false);
  assert.equal(plan.label, 'Today');
});

test('3-day mode rest day (not Mon/Wed/Fri) is labelled Next', () => {
  const sessions = [session('full-a', day(0))];
  const plan = todayPlan(state(sessions, { mode: '3day' }), day(1)); // Tuesday
  assert.equal(plan.planId, 'full-b');
  assert.equal(plan.rest, true);
  assert.equal(plan.label, 'Next');
});
