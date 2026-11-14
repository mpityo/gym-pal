// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../assets/js/metrics.js';
import * as sh from '../assets/js/samsung.js';
import { EXERCISES, BY_ID } from '../assets/js/data/exercises.js';
import { PLANS } from '../assets/js/data/plans.js';
import { parseMeasurement } from '../assets/js/hr.js';
import { deflateRawSync } from 'node:zlib';

const T0 = Date.UTC(2026, 10, 16, 23, 0); // a Monday evening
const session = (offsetDays, entries, mins = 60) => ({
  id: `s${offsetDays}`,
  startedAt: T0 + offsetDays * 86400000,
  endedAt: T0 + offsetDays * 86400000 + mins * 60000,
  entries,
  hr: [],
});
const sets = (w, ...reps) => reps.map((r, i) => ({ w, reps: r, at: T0 + i * 90000 }));

test('library is internally consistent', () => {
  const ids = new Set(EXERCISES.map((e) => e.id));
  assert.equal(ids.size, EXERCISES.length, 'duplicate ids');
  for (const e of EXERCISES) {
    for (const a of e.alts) assert.ok(ids.has(a), `${e.id} alt ${a} missing`);
    assert.ok(e.setup.length && e.cues.length, `${e.id} needs setup and cues`);
  }
  for (const p of PLANS) for (const it of p.items) assert.ok(BY_ID[it.ex], `${p.id} uses unknown ${it.ex}`);
});

test('load per rep follows how each exercise is logged', () => {
  assert.equal(m.loadPerRep({ w: 25 }, BY_ID['db-rdl'], 180), 50); // pair
  assert.equal(m.loadPerRep({ w: 90 }, BY_ID['chest-press'], 180), 90); // stack
  assert.equal(m.loadPerRep({ w: 70 }, BY_ID['assisted-pullup'], 180), 110); // assist
  assert.equal(m.loadPerRep({ w: 70 }, BY_ID['assisted-pullup'], null), null);
  assert.equal(m.setTonnage({ w: 25, reps: 10 }, BY_ID['db-rdl'], 180), 500);
  assert.equal(m.setTonnage({ secs: 45 }, BY_ID.plank, 180), 0);
});

test('epley e1rm', () => {
  assert.equal(m.e1rm(100, 1), 100);
  assert.equal(Math.round(m.e1rm(100, 10)), 133);
});

test('session summary totals and rest', () => {
  const s = session(0, [
    { ex: 'chest-press', sets: sets(100, 12, 10, 9) },
    { ex: 'mile-run', sets: [{ minutes: 9.5, miles: 1, at: T0 }] },
  ]);
  const sum = m.sessionSummary(s, 180);
  assert.equal(sum.tonnage, 3100);
  assert.equal(sum.workSets, 3);
  assert.equal(sum.byPattern.push, 3100);
  assert.equal(sum.cardioMiles, 1);
  assert.equal(sum.avgRestSec, 90);
});

test('double progression suggestion', () => {
  const target = { sets: 3, reps: [8, 12] };
  const maxed = [session(0, [{ ex: 'chest-press', sets: sets(100, 12, 12, 12) }])];
  const up = m.suggest('chest-press', target, maxed, 180);
  assert.equal(up.w, 105);
  assert.ok(up.up);

  const mid = [session(0, [{ ex: 'chest-press', sets: sets(100, 12, 10, 9) }])];
  assert.equal(m.suggest('chest-press', target, mid, 180).w, 100);
  assert.equal(m.suggest('chest-press', target, mid, 180).reps, 10);

  const missed = [session(0, [{ ex: 'chest-press', sets: sets(100, 9, 7, 6) }])];
  assert.match(m.suggest('chest-press', target, missed, 180).reason, /at least 8/);

  assert.equal(m.suggest('chest-press', target, [], 180).w, null);

  const legs = [session(0, [{ ex: 'leg-press', sets: sets(90, 12, 12, 12) }])];
  assert.equal(m.suggest('leg-press', { sets: 3, reps: [10, 12] }, legs, 180).w, 100);

  const assist = [session(0, [{ ex: 'assisted-pullup', sets: sets(70, 12, 12, 12) }])];
  assert.equal(m.suggest('assisted-pullup', target, assist, 180).w, 65);
});

test('records and new records', () => {
  const a = session(0, [{ ex: 'chest-press', sets: sets(100, 10, 10, 10) }]);
  const b = session(3, [{ ex: 'chest-press', sets: sets(110, 8, 8, 7) }]);
  const pr = m.newRecords(b, [a], 180);
  assert.ok(pr.some((p) => p.kind === 'Heaviest set' && p.value === 110));
  assert.ok(pr.some((p) => p.kind === 'Estimated 1-rep max'));
  assert.deepEqual(m.newRecords(a, [], 180), []);
});

test('muscle sets count primary 1, secondary 0.5', () => {
  const s = session(0, [{ ex: 'chest-press', sets: sets(100, 10, 10, 10) }]);
  const { sets: ms, frequency } = m.muscleSets([s], T0 - 1, T0 + 86400000 * 7);
  assert.equal(ms.chest, 3);
  assert.equal(ms.triceps, 1.5);
  assert.equal(frequency.chest, 1);
});

test('week streak', () => {
  const now = T0 + 86400000 * 15;
  const list = [0, 1, 7, 8, 14].map((d) => session(d, [{ ex: 'chest-press', sets: sets(100, 10) }]));
  // weeks: 2, 2, 1 (current, unmet) -> streak counts the two full weeks before
  assert.equal(m.weekStreak(list, 2, now), 2);
});

test('comparison picks the largest reference below the total', () => {
  assert.match(m.comparison(9000).text, /average new cars/);
  assert.match(m.comparison(500000).text, /Statue/);
});

test('hr zones', () => {
  const samples = [];
  for (let i = 0; i < 60; i++) samples.push([T0 + i * 5000, i < 30 ? 120 : 160]);
  const hs = m.hrSummary(samples, 190);
  assert.equal(hs.max, 160);
  assert.equal(hs.avg, 140);
  const z3 = hs.zones.find((z) => z.id === 3).secs; // 120/190 = 63% -> zone 2; 160/190 = 84% -> zone 4
  assert.equal(z3, 0);
  assert.ok(hs.zones.find((z) => z.id === 2).secs >= 145);
  assert.equal(m.maxHr({ age: 40 }), 180);
});

test('BLE heart rate measurement parsing', () => {
  assert.equal(parseMeasurement(new DataView(new Uint8Array([0x00, 72]).buffer)), 72);
  assert.equal(parseMeasurement(new DataView(new Uint8Array([0x01, 0x2c, 0x01]).buffer)), 300);
});

// ── Samsung Health ─────────────────────────────────────────────────────

const HR_CSV = `com.samsung.shealth.tracker.heart_rate,6315001,3
com.samsung.health.heart_rate.create_sh_ver,com.samsung.health.heart_rate.start_time,com.samsung.health.heart_rate.heart_rate,com.samsung.health.heart_rate.min,com.samsung.health.heart_rate.max,com.samsung.health.heart_rate.time_offset,com.samsung.health.heart_rate.datauuid,
6315001,2026-11-16 23:10:00.000,128,120,134,UTC-0500,a1,
6315001,2026-11-16 23:11:00.000,141,135,150,UTC-0500,a2,
6315001,2026-11-16 08:00:00.000,58,55,60,UTC-0500,a3,
`;
const EX_CSV = `com.samsung.shealth.exercise,6315001,9
total_calorie,com.samsung.health.exercise.start_time,com.samsung.health.exercise.end_time,com.samsung.health.exercise.exercise_type,com.samsung.health.exercise.calorie,com.samsung.health.exercise.mean_heart_rate,com.samsung.health.exercise.max_heart_rate,com.samsung.health.exercise.min_heart_rate,com.samsung.health.exercise.duration,com.samsung.health.exercise.distance,com.samsung.health.exercise.datauuid
410.5,2026-11-16 23:02:00.000,2026-11-16 23:58:00.000,15002,380.2,124.0,166.0,88.0,3360000,0.0,"x,1"
`;
const STEPS_CSV = `com.samsung.shealth.step_daily_trend,6315001,2
com.samsung.health.step_daily_trend.day_time,com.samsung.health.step_daily_trend.count,com.samsung.health.step_daily_trend.source_type
1763251200000,8421,-2
1763251200000,6000,0
`;

test('csv parser handles metadata line, prefixes and quotes', () => {
  const rows = sh.parseSamsungCsv(EX_CSV);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].exercise_type, '15002');
  assert.equal(rows[0].datauuid, 'x,1');
  assert.equal(sh.parseTime('2026-11-16 23:02:00.000'), Date.UTC(2026, 10, 16, 23, 2));
  assert.equal(sh.fileKind('Samsung Health/samsunghealth_matt/com.samsung.shealth.tracker.heart_rate.20261116120000.csv'), 'hr');
  assert.equal(sh.fileKind('com.samsung.shealth.exercise.hr_zone.20261116120000.csv'), null);
});

test('buildWatch summarises and keeps HR only inside sessions', () => {
  const s = session(0, [{ ex: 'chest-press', sets: sets(100, 10) }]);
  const files = [
    { name: 'a', kind: 'hr', text: HR_CSV },
    { name: 'b', kind: 'exercise', text: EX_CSV },
    { name: 'c', kind: 'stepsTrend', text: STEPS_CSV },
  ];
  const w = sh.buildWatch(files, [s]);
  assert.equal(w.workouts.length, 1);
  assert.equal(w.workouts[0].typeName, 'Weight machine');
  assert.equal(w.workouts[0].kcal, 380.2);
  assert.equal(w.hrSamples.length, 2);
  assert.equal(w.days['2025-11-16'].steps, 8421);
  const linked = sh.watchForSession(s, w);
  assert.equal(linked.workout.avgHr, 124);
  assert.equal(linked.samples.length, 2);
  assert.equal(linked.source, 'watch');
});

test('unzip reads deflated entries', async () => {
  const name = 'samsunghealth/com.samsung.shealth.exercise.20261116120000.csv';
  const data = Buffer.from(EX_CSV);
  const comp = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdStart = local.length + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  const zip = Buffer.concat([local, nameBuf, comp, cd, nameBuf, eocd]);
  const out = await sh.unzip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length), (n) => sh.fileKind(n) != null);
  assert.equal(out.length, 1);
  assert.equal(out[0].text, EX_CSV);
});
