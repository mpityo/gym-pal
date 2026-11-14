/**
 * Gym-aware rules, kept free of the DOM and of storage so they can be tested
 * in Node. store.js wraps these with the live state.
 *
 * Notes live in two places: `machineNotes[exId]` is the any-gym default and
 * `gymNotes[gymId][exId]` is what is true at one gym. Reading merges them
 * field by field, so a note written before gyms existed shows everywhere
 * until a gym overrides it.
 */
import { exercise } from './data/exercises.js';

const FIELDS = ['where', 'settings'];

/** The gym in use: the workout's, else the one picked outside a workout, else the only one. */
export function currentGymId(state) {
  return state.active?.gymId ?? state.prefs?.currentGymId ?? (state.gyms.length === 1 ? state.gyms[0].id : null);
}

export function mergedNote(state, exId, gymId) {
  const base = state.machineNotes?.[exId] ?? {};
  const here = (gymId && state.gymNotes?.[gymId]?.[exId]) || {};
  const out = {};
  for (const f of FIELDS) out[f] = here[f] ?? base[f] ?? '';
  out.missing = !!(gymId && here.missing);
  return out;
}

/** Writes `patch` into the gym's note when there is a gym, else into the defaults. Mutates state. */
export function writeNote(state, exId, patch, gymId) {
  if (gymId) {
    state.gymNotes ??= {};
    const notes = (state.gymNotes[gymId] ??= {});
    const next = { ...notes[exId], ...patch };
    if (!next.missing) delete next.missing;
    if (Object.keys(next).length) notes[exId] = next;
    else delete notes[exId];
  } else {
    const { missing, ...rest } = patch;
    state.machineNotes[exId] = { where: '', settings: '', ...state.machineNotes[exId], ...rest };
  }
}

export function isMissing(state, exId, gymId) {
  return !!(gymId && state.gymNotes?.[gymId]?.[exId]?.missing);
}

export function missingIds(state, gymId) {
  if (!gymId) return [];
  return Object.entries(state.gymNotes?.[gymId] ?? {})
    .filter(([, n]) => n.missing)
    .map(([id]) => id);
}

/**
 * Plan items with permanent swaps applied, then anything missing at the gym
 * replaced by the first listed alternative that is there.
 */
export function resolvePlanItems(plan, swaps = {}, missing = () => false) {
  if (!plan) return [];
  return plan.items.map((item, i) => {
    // A swap to an id no longer in the library is ignored.
    const out = swaps[i] && exercise(swaps[i]) ? { ...item, ex: swaps[i], swappedFrom: item.ex } : { ...item };
    if (!missing(out.ex)) return out;
    // Alternatives of what you would have done, then of the plan's own exercise.
    const candidates = [...(exercise(out.ex)?.alts ?? []), item.ex, ...(exercise(item.ex)?.alts ?? [])];
    const alt = candidates.find((a) => a !== out.ex && !missing(a));
    if (alt) return { ...out, ex: alt, swappedFrom: item.ex, autoSwap: true };
    return { ...out, unavailable: true };
  });
}

/** Forget a gym's notes and stop pointing at it. Sessions keep their gymId. Mutates state. */
export function dropGym(state, id) {
  state.gyms = state.gyms.filter((g) => g.id !== id);
  if (state.gymNotes) delete state.gymNotes[id];
  if (state.prefs?.currentGymId === id) state.prefs.currentGymId = null;
}

/** Saved gyms, the most recently trained at first. */
export function gymsByRecent(state) {
  const last = new Map();
  for (const s of [...state.sessions, state.active].filter(Boolean)) {
    if (s.gymId && (last.get(s.gymId) ?? 0) < s.startedAt) last.set(s.gymId, s.startedAt);
  }
  return state.gyms
    .map((g, i) => [g, last.get(g.id) ?? 0, i])
    .sort((a, b) => b[1] - a[1] || a[2] - b[2])
    .map(([g]) => g);
}

/**
 * A Google Maps search for the gym, which shows its "Popular times" when
 * Google has them. Uses the name plus the address, or plus lat,lng when
 * there is no address.
 */
export function mapsLink(gym) {
  if (!gym) return null;
  const where = gym.address ? ` ${gym.address}` : gym.lat != null && gym.lng != null ? ` ${gym.lat},${gym.lng}` : '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gym.name ?? ''}${where}`.trim())}`;
}
