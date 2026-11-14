// Run: node --test test/
// Spec 12: the date/time/duration rules for editing and logging past workouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readWhen, toDateInput, toTimeInput } from '../assets/js/views/history.js';

const now = new Date(2026, 10, 14, 12, 0).getTime();

test('readWhen builds local start and end times', () => {
  const r = readWhen('2026-11-13', '18:30', '45', now);
  assert.equal(r.startedAt, new Date(2026, 10, 13, 18, 30).getTime());
  assert.equal(r.endedAt - r.startedAt, 45 * 60000);
});

test('readWhen rejects the future, an end before the start, and junk', () => {
  assert.match(readWhen('2026-11-15', '08:00', '60', now).error, /future/);
  assert.match(readWhen('2026-11-13', '18:00', '0', now).error, /end cannot be before the start/);
  assert.match(readWhen('2026-11-13', '18:00', '-5', now).error, /end cannot be before the start/);
  assert.ok(readWhen('', '18:00', '60', now).error);
  assert.ok(readWhen('2026-11-13', '', '60', now).error);
  assert.ok(readWhen('2026-11-13', '18:00', 'abc', now).error);
});

test('toDateInput / toTimeInput round-trip through readWhen', () => {
  const ts = new Date(2026, 0, 5, 7, 5).getTime();
  assert.equal(toDateInput(ts), '2026-01-05');
  assert.equal(toTimeInput(ts), '07:05');
  assert.equal(readWhen(toDateInput(ts), toTimeInput(ts), '30', now).startedAt, ts);
});
