// Run: node --test test/
// Spec 16: bodyweight over time, and the right weight for each workout.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../assets/js/store.js';
import { bodyweightAt, sessionBodyweight, upsertBodyweight, sessionSummary, totals, bodyweightTrend, sevenDayAverage, shouldAskWeight, dayKey } from '../assets/js/metrics.js';

const log = [
  { date: '2026-10-01', lb: 200, source: 'manual' },
  { date: '2026-10-15', lb: 195, source: 'manual' },
  { date: '2026-11-01', lb: 190, source: 'manual' },
];
const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();

test('bodyweightAt: exact date, between entries, before the first, empty log', () => {
  assert.equal(bodyweightAt(log, at(2026, 9, 15)), 195);
  assert.equal(bodyweightAt(log, at(2026, 9, 20)), 195);
  assert.equal(bodyweightAt(log, at(2026, 11, 1)), 190);
  assert.equal(bodyweightAt(log, at(2026, 8, 1)), 200, 'before the first entry: the earliest');
  assert.equal(bodyweightAt([], at(2026, 9, 20), 180), 180);
  assert.equal(bodyweightAt(null, at(2026, 9, 20), null), null);
});

test('upsert keeps one sorted entry per date; manual beats watch; watch never replaces manual', () => {
  let l = upsertBodyweight([], { date: '2026-11-02', lb: 190 });
  l = upsertBodyweight(l, { date: '2026-11-01', lb: 191, source: 'watch' });
  assert.deepEqual(l.map((e) => e.date), ['2026-11-01', '2026-11-02']);
  l = upsertBodyweight(l, { date: '2026-11-01', lb: 189.5, source: 'manual' });
  assert.equal(l[0].lb, 189.5);
  l = upsertBodyweight(l, { date: '2026-11-01', lb: 200, source: 'watch' });
  assert.equal(l[0].lb, 189.5, 'watch does not overwrite a manual entry');
  assert.equal(l.length, 2);
});

test('logBodyweight: profile.bodyweight follows the latest date, not the latest call', () => {
  store._resetForTests();
  store.logBodyweight(190, '2026-11-10');
  store.logBodyweight(200, '2026-10-01');
  assert.equal(store.getState().profile.bodyweight, 190);
  store.logBodyweight(188, '2026-11-12');
  assert.equal(store.getState().profile.bodyweight, 188);
  store.removeBodyweight('2026-11-12');
  assert.equal(store.getState().profile.bodyweight, 190);
});

const pushups = (startedAt, extra = {}) => ({ id: `p${startedAt}`, startedAt, endedAt: startedAt + 3600000, entries: [{ ex: 'pushup', plannedEx: 'pushup', sets: [{ w: 0, reps: 20 }] }], ...extra });

test('a push-up workout logged at 200 lb keeps its pounds when the profile changes to 180', () => {
  store._resetForTests();
  store.logBodyweight(200, dayKey(Date.now()));
  const s = store.startSession(null);
  store.addEntry('pushup');
  store.logSet(0, { w: 0, reps: 20 });
  const done = store.finishSession();
  assert.equal(done.bodyweight, 200, 'snapshot taken at start');
  const before = sessionSummary(store.getSession(s.id), store.bw()).tonnage;
  store.logBodyweight(180, dayKey(Date.now()));
  const after = sessionSummary(store.getSession(s.id), store.bw()).tonnage;
  assert.equal(after, before);
  assert.ok(before > 0);
});

test('a workout without a snapshot uses the log entry in force on its date', () => {
  const resolver = (session) => sessionBodyweight(session, log, 170);
  const oct = pushups(at(2026, 9, 20));
  const nov = pushups(at(2026, 10, 5));
  const a = sessionSummary(oct, resolver).tonnage;
  const b = sessionSummary(nov, resolver).tonnage;
  assert.equal(a, sessionSummary(oct, 195).tonnage);
  assert.equal(b, sessionSummary(nov, 190).tonnage);
  // totals() passes the resolver through to every session.
  assert.equal(totals([oct, nov], resolver).tonnage, a + b);
});

test('a plain number still works everywhere', () => {
  assert.equal(sessionSummary(pushups(at(2026, 9, 20)), 200).tonnage, sessionSummary(pushups(at(2026, 9, 20), { bodyweight: 150 }), 200).tonnage);
});

test('migration seeds exactly one entry from an old single bodyweight', () => {
  store._resetForTests();
  store.replaceState({ sessions: [pushups(at(2026, 5, 3)), pushups(at(2026, 6, 1))], profile: { bodyweight: 185 }, prefs: {} });
  assert.deepEqual(store.getState().bodyweightLog, [{ date: dayKey(at(2026, 5, 3)), lb: 185, source: 'manual' }]);
  store.replaceState(store.getState());
  assert.equal(store.getState().bodyweightLog.length, 1, 'not seeded twice');
  store.replaceState({ sessions: [], profile: {}, prefs: {} });
  assert.deepEqual(store.getState().bodyweightLog, []);
});

test('a backup round-trips bodyweightLog', () => {
  store._resetForTests();
  store.logBodyweight(181.5, '2026-11-01');
  store.logBodyweight(180, '2026-11-08', 'watch');
  const v = store.validateBackup(store.exportJson());
  store._resetForTests();
  store.restoreBackup(v.state);
  assert.deepEqual(store.getState().bodyweightLog.map((e) => [e.date, e.lb, e.source]), [['2026-11-01', 181.5, 'manual'], ['2026-11-08', 180, 'watch']]);
});

test('trend, 7-day average and the weekly prompt', () => {
  assert.equal(bodyweightTrend([log[0]]), null);
  const t = bodyweightTrend(log, at(2026, 10, 1));
  assert.deepEqual(t, { latestLb: 190, change30dLb: -10, changeAllLb: -10 });
  assert.equal(sevenDayAverage([{ date: '2026-11-01', lb: 180 }, { date: '2026-11-05', lb: 182 }, { date: '2026-11-07', lb: 184 }]), 182);
  assert.equal(sevenDayAverage([{ date: '2026-10-01', lb: 170 }, { date: '2026-11-07', lb: 184 }]), 184);
  assert.equal(shouldAskWeight([], {}), true);
  assert.equal(shouldAskWeight(log, {}, at(2026, 10, 5)), false);
  assert.equal(shouldAskWeight(log, {}, at(2026, 10, 12)), true);
  assert.equal(shouldAskWeight(log, { weighSnoozeUntil: at(2026, 10, 20) }, at(2026, 10, 12)), false);
});
