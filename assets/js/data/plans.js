/**
 * The training plans.
 *
 * The 4-day upper/lower split trains every muscle twice a week (Schoenfeld,
 * Ogborn & Krieger 2016), uses 8–12 / 10–15 rep ranges for a novice
 * (ACSM 2009 position stand), and lands most muscles at roughly 10+ weekly
 * sets (Schoenfeld et al. 2017 dose-response).
 *
 * Item fields: ex (exercise id), sets, reps [min, max], rest (seconds),
 * minutes / miles for cardio, and an optional note shown in the session.
 */

const lift = (ex, sets, min, max, rest = 90, note) => ({ ex, sets, reps: [min, max], rest, note });
const cardio = (ex, minutes, miles, note) => ({ ex, sets: 1, minutes, miles, note });

export const PLANS = [
  {
    id: 'upper-a',
    name: 'Upper A',
    day: 1, // Monday
    tint: 'blue',
    items: [
      cardio('treadmill-warmup', 5, null, 'Easy jog or incline walk'),
      lift('chest-press', 3, 8, 12, 120),
      lift('lat-pulldown', 3, 8, 12, 120),
      lift('shoulder-press', 3, 10, 12, 90),
      lift('cable-row', 3, 10, 12, 90),
      lift('tricep-pushdown', 2, 12, 15, 60),
      lift('cable-curl', 2, 12, 15, 60),
      cardio('mile-run', null, 1, 'After lifting — fine on upper days'),
    ],
  },
  {
    id: 'lower-a',
    name: 'Lower A',
    day: 2, // Tuesday
    tint: 'green',
    items: [
      cardio('treadmill-warmup', 5, null, 'Easy pace only — save your legs'),
      lift('leg-press', 3, 10, 12, 120),
      lift('leg-curl-seated', 3, 10, 12, 90),
      lift('leg-extension', 2, 12, 15, 60),
      lift('calf-legpress', 3, 12, 15, 60),
      lift('cable-crunch', 3, 12, 15, 60),
    ],
  },
  {
    id: 'upper-b',
    name: 'Upper B',
    day: 4, // Thursday
    tint: 'purple',
    items: [
      cardio('treadmill-warmup', 5, null, 'Easy jog or incline walk'),
      lift('incline-press', 3, 8, 12, 120),
      lift('row-machine', 3, 8, 12, 120),
      lift('pec-deck', 2, 12, 15, 60),
      lift('rear-delt-fly', 2, 12, 15, 60),
      lift('lateral-raise', 2, 12, 15, 60),
      lift('hammer-curl', 2, 10, 12, 60),
      lift('overhead-cable-ext', 2, 10, 12, 60),
      cardio('mile-run', null, 1, 'After lifting — fine on upper days'),
    ],
  },
  {
    id: 'lower-b',
    name: 'Lower B',
    day: 5, // Friday
    tint: 'orange',
    items: [
      cardio('treadmill-warmup', 5, null, 'Easy pace only — save your legs'),
      lift('smith-squat', 3, 8, 10, 150),
      lift('db-rdl', 3, 10, 12, 120),
      lift('walking-lunge', 2, 10, 10, 90, 'Reps are per leg'),
      lift('hip-abductor', 2, 15, 15, 60),
      lift('hip-adductor', 2, 15, 15, 60),
      { ex: 'plank', sets: 3, secs: [30, 60], rest: 60 },
      lift('hanging-knee-raise', 3, 10, 10, 60),
    ],
  },
  {
    id: 'full-a',
    name: 'Full body A',
    day: null,
    tint: 'teal',
    threeDay: true,
    items: [
      cardio('treadmill-warmup', 5, null),
      lift('leg-press', 3, 8, 12, 120),
      lift('chest-press', 3, 8, 12, 120),
      lift('lat-pulldown', 3, 8, 12, 120),
      lift('shoulder-press', 3, 8, 12, 90),
      lift('leg-curl-seated', 3, 8, 12, 90),
      { ex: 'plank', sets: 3, secs: [30, 60], rest: 60 },
    ],
  },
  {
    id: 'full-b',
    name: 'Full body B',
    day: null,
    tint: 'teal',
    threeDay: true,
    items: [
      cardio('treadmill-warmup', 5, null),
      lift('smith-squat', 3, 8, 12, 150),
      lift('cable-row', 3, 8, 12, 90),
      lift('incline-press', 3, 8, 12, 120),
      lift('db-rdl', 3, 8, 12, 120),
      lift('lateral-raise', 3, 8, 12, 60),
      lift('cable-crunch', 3, 8, 12, 60),
    ],
  },
];

export const PLAN_BY_ID = Object.fromEntries(PLANS.map((p) => [p.id, p]));

/** The usual week, Monday-first, for the Today screen. */
export const WEEK = [
  { day: 1, label: 'Mon', plan: 'upper-a' },
  { day: 2, label: 'Tue', plan: 'lower-a' },
  { day: 3, label: 'Wed', plan: null, note: 'Rest, or a mile run' },
  { day: 4, label: 'Thu', plan: 'upper-b' },
  { day: 5, label: 'Fri', plan: 'lower-b' },
  { day: 6, label: 'Sat', plan: null, note: 'Rest, or a mile run' },
  { day: 0, label: 'Sun', plan: null, note: 'Rest' },
];
