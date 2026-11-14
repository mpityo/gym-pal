// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, fmtSecs, fmtRel } from '../assets/js/util.js';

test('matchScore ranks exact > prefix > word prefix > substring > subsequence > no match', () => {
  const exact = matchScore('Chest press', 'chest press');
  const prefix = matchScore('Chest press machine', 'chest press');
  const wordPrefix = matchScore('Incline chest press', 'ches');
  const substring = matchScore('Seated chest press', 'ted chest');
  const subsequence = matchScore('Grape tomatoes', 'grtom');
  const none = matchScore('Chest press', 'xyz');

  assert.equal(exact, 100);
  assert.ok(prefix < exact && prefix > 0);
  assert.ok(wordPrefix < prefix && wordPrefix > 0);
  assert.ok(substring < wordPrefix && substring > 0);
  assert.ok(subsequence > 0 && subsequence < substring);
  assert.equal(none, 0);
});

test('fmtSecs formats seconds as mm:ss', () => {
  assert.equal(fmtSecs(0), '0:00');
  assert.equal(fmtSecs(65), '1:05');
  assert.equal(fmtSecs(599), '9:59');
  assert.equal(fmtSecs(-5), '0:00');
});

test('fmtRel labels today, yesterday, this week and older dates', () => {
  const now = new Date(2026, 10, 19, 12, 0, 0).getTime(); // Thursday
  assert.equal(fmtRel(now, now), 'Today');
  assert.equal(fmtRel(now - 86400000, now), 'Yesterday');
  assert.equal(fmtRel(now - 86400000 * 2, now), 'Tuesday');
  assert.equal(fmtRel(now - 86400000 * 10, now), 'Nov 9');
});
