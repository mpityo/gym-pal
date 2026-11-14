// Run: node --test test/
// Spec 10: your own busy-times history. Timestamps are built with
// new Date(y, m, d, h, min) so local-time bucketing passes in any time zone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crowdGrid, crowdScore, crowdEstimated, quietTimes, busyTimes, crowdHint, fmtHour, crowdLabel } from '../assets/js/metrics.js';
import { mapsLink } from '../assets/js/gyms.js';

// Monday 2026-11-16.
const at = (dayOffset, h, min = 0) => new Date(2026, 10, 16 + dayOffset, h, min).getTime();
let n = 0;
const sess = (dayOffset, h1, m1, h2, m2, extra = {}) => ({ id: `s${n++}`, startedAt: at(dayOffset, h1, m1), endedAt: at(dayOffset, h2, m2), entries: [], gymId: 'g1', ...extra });
const taken = { entries: [{ ex: 'a', swapReason: 'taken' }, { ex: 'b' }] };

test('a Monday 17:40–18:50 session is a visit at Mon 17 and Mon 18 only', () => {
  const g = crowdGrid([sess(0, 17, 40, 18, 50, { crowd: 4 })], 'g1');
  assert.equal(g.cells[0][17].visits, 1);
  assert.equal(g.cells[0][18].visits, 1);
  assert.equal(g.cells[0][16].visits, 0);
  assert.equal(g.cells[0][19].visits, 0);
  assert.equal(g.cells[1][17].visits, 0);
  assert.equal(g.totalRated, 1);
});

test('a session ending exactly on the hour does not count the next hour', () => {
  const g = crowdGrid([sess(0, 6, 0, 7, 0)], 'g1');
  assert.equal(g.cells[0][6].visits, 1);
  assert.equal(g.cells[0][7].visits, 0);
});

test('averages, takenPerVisit, rated vs unrated, and gym filtering', () => {
  const sessions = [
    sess(0, 18, 0, 18, 30, { crowd: 4, ...taken }),
    sess(7, 18, 10, 18, 50, { crowd: 2 }),
    sess(14, 18, 5, 18, 45), // no rating: a visit, not rated
    sess(0, 18, 0, 18, 30, { crowd: 5, gymId: 'g2' }), // another gym
    sess(0, 18, 0, 18, 30, { crowd: 1, gymId: undefined }), // no gym
  ];
  const c = crowdGrid(sessions, 'g1').cells[0][18];
  assert.equal(c.visits, 3);
  assert.equal(c.rated, 2);
  assert.equal(c.avg, 3);
  assert.equal(c.takenVisits, 1);
  assert.equal(c.takenPerVisit, 1 / 3);
  assert.equal(crowdGrid(sessions, 'g2').cells[0][18].visits, 1);
  const none = crowdGrid(sessions, null);
  assert.equal(none.cells[0][18].visits, 1);
  assert.equal(none.cells[0][18].avg, 1);
});

test('crowdScore: rating nudged up by taken swaps, capped; estimate without ratings; null without visits', () => {
  assert.equal(crowdScore({ visits: 0 }), null);
  assert.equal(crowdScore({ visits: 2, rated: 2, avg: 3, takenPerVisit: 0 }), 3);
  assert.equal(crowdScore({ visits: 2, rated: 2, avg: 3, takenPerVisit: 1 }), 3.5);
  assert.equal(crowdScore({ visits: 2, rated: 2, avg: 4.8, takenPerVisit: 4 }), 5);
  assert.equal(crowdScore({ visits: 2, rated: 0, avg: null, takenPerVisit: 0.5 }), 3);
  assert.equal(crowdEstimated({ visits: 2, rated: 0 }), true);
  assert.equal(crowdEstimated({ visits: 2, rated: 1 }), false);
});

test('quietTimes / busyTimes ignore single-visit cells and sort, ties to more visits', () => {
  const sessions = [
    // Mon 6 am: Quiet twice
    sess(0, 6, 0, 6, 50, { crowd: 2 }), sess(7, 6, 0, 6, 50, { crowd: 2 }),
    // Wed 6 am: Quiet three times (same score, more visits → first)
    sess(2, 6, 0, 6, 50, { crowd: 2 }), sess(9, 6, 0, 6, 50, { crowd: 2 }), sess(16, 6, 0, 6, 50, { crowd: 2 }),
    // Mon 6 pm: Packed twice
    sess(0, 18, 0, 18, 50, { crowd: 5 }), sess(7, 18, 0, 18, 50, { crowd: 5 }),
    // Sat 9 am: Empty but only once → ignored
    sess(5, 9, 0, 9, 50, { crowd: 1 }),
  ];
  const g = crowdGrid(sessions, 'g1');
  const q = quietTimes(g, { limit: 3 });
  assert.deepEqual(q.map((x) => [x.day, x.hour]), [[2, 6], [0, 6], [0, 18]]);
  const b = busyTimes(g, { limit: 1 });
  assert.deepEqual(b.map((x) => [x.day, x.hour, x.score]), [[0, 18, 5]]);
});

test('crowdHint: only with data for this weekday within an hour; names a quieter time', () => {
  const sessions = [
    sess(0, 18, 0, 18, 50, { crowd: 4 }), sess(7, 18, 0, 18, 50, { crowd: 4 }), sess(14, 18, 0, 18, 50, { crowd: 4 }),
    sess(0, 20, 0, 20, 50, { crowd: 2 }), sess(7, 20, 0, 20, 50, { crowd: 2 }),
  ];
  const g = crowdGrid(sessions, 'g1');
  const hint = crowdHint(g, at(21, 18, 20));
  assert.equal(hint.text, 'Mondays around 6 pm have been Busy for you (3 visits). Quieter: Mon 8 pm.');
  assert.ok(crowdHint(g, at(21, 17, 30)), 'one hour before still counts');
  assert.equal(crowdHint(g, at(21, 12, 0)), null, 'nothing near noon');
  assert.equal(crowdHint(g, at(22, 18, 0)), null, 'nothing on Tuesday');
});

test('fmtHour and crowdLabel', () => {
  assert.equal(fmtHour(0), '12 am');
  assert.equal(fmtHour(6), '6 am');
  assert.equal(fmtHour(12), '12 pm');
  assert.equal(fmtHour(18), '6 pm');
  assert.equal(crowdLabel(3.6), 'Busy');
  assert.equal(crowdLabel(1), 'Empty');
  assert.equal(crowdLabel(null), null);
});

test('mapsLink uses name + address, else name + lat,lng', () => {
  assert.equal(mapsLink({ name: 'LA Fitness', address: '1 Main St' }), 'https://www.google.com/maps/search/?api=1&query=LA%20Fitness%201%20Main%20St');
  assert.equal(mapsLink({ name: 'Gym', lat: 40.1, lng: -75.2 }), 'https://www.google.com/maps/search/?api=1&query=Gym%2040.1%2C-75.2');
  assert.equal(mapsLink(null), null);
});
