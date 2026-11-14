/**
 * Plans and the weekly schedule as data (spec 15). Pure: takes the state,
 * never touches storage or the DOM, so it is tested in Node and shared by
 * store.js and the views.
 *
 *   state.customPlans  planId -> { id, name, tint, items: [...] }. A built-in id
 *                      here overrides that built-in plan; ids 'p-…' are plans
 *                      you created.
 *   state.schedule     null = the built-in WEEK; else { 0..6: planId | null }
 *                      keyed by Date.getDay().
 */
import { PLANS, PLAN_BY_ID, WEEK } from './data/plans.js';
import { exercise, MUSCLE_ORDER } from './data/exercises.js';

const LABELS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 0: 'Sun' };
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** Your version of a plan if you have one, else the built-in, else null. */
export function getPlanFrom(state, id) {
  if (!id) return null;
  return state?.customPlans?.[id] ?? PLAN_BY_ID[id] ?? null;
}

/** Built-in plans (your edits applied) followed by the plans you created. */
export function allPlansFrom(state) {
  const custom = state?.customPlans ?? {};
  const builtIn = PLANS.map((p) => (custom[p.id] ? { ...p, ...custom[p.id], builtIn: true, edited: true } : { ...p, builtIn: true }));
  const mine = Object.values(custom).filter((p) => p && !PLAN_BY_ID[p.id]);
  return [...builtIn, ...mine];
}

export function isBuiltInPlan(id) {
  return !!PLAN_BY_ID[id];
}

/**
 * The week as [{ day, label, plan, note }], Monday first: from
 * state.schedule when set, else the built-in WEEK.
 */
export function weekSchedule(state) {
  const sched = state?.schedule;
  if (!sched) return WEEK;
  return MONDAY_FIRST.map((day) => {
    const plan = sched[day] && getPlanFrom(state, sched[day]) ? sched[day] : null;
    return { day, label: LABELS[day], plan, note: plan ? undefined : 'Rest' };
  });
}

/**
 * Weekly sets per muscle if each plan in `plans` is done once, in full:
 * primary muscles count 1 per set, helping muscles ½ (same rule as
 * metrics.muscleSets). Cardio is skipped.
 */
export function plannedMuscleSets(plans) {
  const out = Object.fromEntries(MUSCLE_ORDER.map((m) => [m, 0]));
  for (const plan of plans ?? []) {
    for (const it of plan?.items ?? []) {
      const ex = exercise(it.ex);
      if (!ex || ex.track === 'cardio') continue;
      const n = Number(it.sets) || 0;
      for (const m of ex.muscles.primary) if (m in out) out[m] += n;
      for (const m of ex.muscles.secondary) if (m in out) out[m] += n * 0.5;
    }
  }
  return out;
}

/** A plan item's plain copy (drops swappedFrom/autoSwap/unavailable markers). */
export function cleanItem(it) {
  const { swappedFrom, autoSwap, unavailable, ...rest } = it;
  for (const k of Object.keys(rest)) if (rest[k] === undefined) delete rest[k];
  return JSON.parse(JSON.stringify(rest));
}

/** The target an exercise gets when it is added to a plan or a workout by hand. */
export function defaultPlanItem(exId) {
  const ex = exercise(exId);
  if (!ex) return null;
  return ex.track === 'cardio'
    ? { ex: exId, sets: 1, minutes: 10 }
    : ex.track === 'time'
      ? { ex: exId, sets: 3, secs: [30, 60], rest: 60 }
      : { ex: exId, sets: 3, reps: [8, 12], rest: 90 };
}

const MUSCLE_WORDS = [
  ['chest', ['chest', 'pec']],
  ['back', ['lat', 'back']],
  ['upperBack', ['upper back', 'rhomboid', 'trap', 'mid back']],
  ['shoulders', ['shoulder', 'delt', 'front delt', 'side delt']],
  ['rearDelts', ['rear delt', 'rear shoulder', 'posterior delt']],
  ['biceps', ['bicep']],
  ['triceps', ['tricep']],
  ['quads', ['quad']],
  ['hamstrings', ['hamstring']],
  ['glutes', ['glute']],
  ['calves', ['calf', 'calves']],
  ['adductors', ['adductor', 'inner thigh']],
  ['abs', ['abs', 'abdominal', 'core', 'oblique']],
];

/**
 * Muscle ids named in free text such as Claude's "Chest, front delts,
 * triceps" — the first one or two as primary, the rest as secondary.
 * Unknown words are ignored.
 */
export function musclesFromText(text) {
  const parts = String(text ?? '').toLowerCase().split(/[,;/&]| and /).map((x) => x.trim()).filter(Boolean);
  const found = [];
  for (const part of parts) {
    // "rear delt" must win over "delt", "upper back" over "back".
    const hit = [...MUSCLE_WORDS].sort((a, b) => Math.max(...b[1].map((w) => w.length)) - Math.max(...a[1].map((w) => w.length)))
      .find(([, words]) => words.some((w) => part.includes(w)));
    if (hit && !found.includes(hit[0])) found.push(hit[0]);
  }
  return { primary: found.slice(0, 1), secondary: found.slice(1) };
}
