/**
 * Every number the app shows is computed here, from the sessions you logged
 * and the watch data you imported. Pure functions, no DOM, so they are tested
 * in Node (see test/).
 *
 * Claude is never asked to count. It is handed these finished numbers and
 * writes prose over them, nothing more.
 */
import { exercise, MUSCLE_ORDER } from './data/exercises.js';

const DAY = 86400000;

// ── Dates ────────────────────────────────────────────────────────────────

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight on the Monday of the week containing ts. */
export function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - offset);
  return d.getTime();
}

function addDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

// ── Load ─────────────────────────────────────────────────────────────────

/**
 * Pounds actually moved per rep for one logged set, or null if it cannot be
 * known (e.g. a bodyweight move before a bodyweight is entered).
 */
export function loadPerRep(set, ex, bodyweight) {
  if (!ex) return null;
  const w = Number(set.w) || 0;
  switch (ex.load) {
    case 'pair':
      return w * 2;
    case 'assist':
      return bodyweight ? Math.max(bodyweight - w, 0) : null;
    case 'body':
      return bodyweight ? bodyweight * (ex.bodyShare ?? 1) : null;
    case 'none':
      return 0;
    default: // stack, plates, single
      return w;
  }
}

export function setTonnage(set, ex, bodyweight) {
  if (!ex || ex.track === 'cardio' || ex.track === 'time') return 0;
  const load = loadPerRep(set, ex, bodyweight);
  return load == null ? 0 : load * (Number(set.reps) || 0);
}

/**
 * Estimated one-rep max, Epley formula: w × (1 + reps/30).
 * Reported on the number you log (one dumbbell, the stack pin) so it matches
 * what you see on the machine. Less reliable past ~12 reps, so higher-rep sets
 * are flagged rather than hidden.
 */
export function e1rm(w, reps) {
  w = Number(w);
  reps = Number(reps);
  if (!w || !reps) return 0;
  if (reps === 1) return w;
  return w * (1 + reps / 30);
}

/** For assisted moves, less assist is stronger — compare on effective load. */
function strengthOf(set, ex, bodyweight) {
  if (ex?.load === 'assist') {
    const eff = loadPerRep(set, ex, bodyweight);
    return eff == null ? -Number(set.w || 0) : e1rm(eff, set.reps);
  }
  if (ex?.track === 'time') return Number(set.secs) || 0;
  if (ex?.track === 'bodyweight') return Number(set.reps) || 0;
  return e1rm(set.w, set.reps);
}

// ── One session ──────────────────────────────────────────────────────────

/**
 * Work sets only: warm-up sets (spec 14) count toward pounds moved, but not
 * toward sets, rest, sets per muscle, suggestions or records.
 */
export const work = (sets) => (sets ?? []).filter((s) => !s.warmup);

export function sessionSummary(session, bodyweight) {
  const end = session.endedAt ?? Date.now();
  const durationMin = Math.max(0, (end - session.startedAt) / 60000);
  const byPattern = { push: 0, pull: 0, legs: 0, core: 0 };
  let workSets = 0;
  let reps = 0;
  let tonnage = 0;
  let cardioMin = 0;
  let cardioMiles = 0;
  const rests = [];

  for (const entry of session.entries) {
    const ex = exercise(entry.ex);
    if (!ex) continue;
    if (ex.track === 'cardio') {
      for (const s of entry.sets) {
        cardioMin += Number(s.minutes) || 0;
        cardioMiles += Number(s.miles) || 0;
      }
      continue;
    }
    for (const s of entry.sets) {
      reps += Number(s.reps) || 0;
      const t = setTonnage(s, ex, bodyweight);
      tonnage += t;
      if (byPattern[ex.pattern] != null) byPattern[ex.pattern] += t;
    }
    const ws = work(entry.sets);
    ws.forEach((s, i) => {
      workSets += 1;
      if (i > 0 && s.at && ws[i - 1].at) {
        const gap = (s.at - ws[i - 1].at) / 1000;
        // Ignore gaps that are obviously "walked away", not rest.
        if (gap > 10 && gap < 600) rests.push(gap);
      }
    });
  }

  const avgRestSec = rests.length ? rests.reduce((a, b) => a + b, 0) / rests.length : null;
  return {
    durationMin,
    workSets,
    reps,
    tonnage: Math.round(tonnage),
    byPattern,
    cardioMin,
    cardioMiles,
    avgRestSec,
    density: durationMin ? tonnage / durationMin : 0,
    exercises: session.entries.filter((e) => e.sets.length).length,
  };
}

// ── History per exercise ─────────────────────────────────────────────────

export function exerciseHistory(sessions, exId, bodyweight) {
  const ex = exercise(exId);
  const out = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.ex !== exId) continue;
      // Strength comes from work sets only; warm-ups still count as weight moved.
      const ws = work(entry.sets);
      if (!ws.length) continue;
      let best = null;
      let tonnage = 0;
      for (const s of entry.sets) tonnage += setTonnage(s, ex, bodyweight);
      for (const s of ws) {
        const score = strengthOf(s, ex, bodyweight);
        if (!best || score > best.score) best = { ...s, score };
      }
      out.push({
        date: session.startedAt,
        sessionId: session.id,
        sets: ws,
        best,
        tonnage: Math.round(tonnage),
      });
    }
  }
  return out;
}

/** Personal records for one exercise. */
export function exerciseRecords(sessions, exId, bodyweight) {
  const ex = exercise(exId);
  const rec = { bestE1rm: null, heaviest: null, mostReps: null, bestSessionTonnage: null, longest: null };
  for (const h of exerciseHistory(sessions, exId, bodyweight)) {
    if (!rec.bestSessionTonnage || h.tonnage > rec.bestSessionTonnage.value) {
      rec.bestSessionTonnage = { value: h.tonnage, date: h.date };
    }
    for (const s of h.sets) {
      if (ex.track === 'time') {
        if (!rec.longest || s.secs > rec.longest.secs) rec.longest = { secs: s.secs, date: h.date };
        continue;
      }
      if (ex.track === 'weight' && ex.load !== 'assist') {
        const v = e1rm(s.w, s.reps);
        if (!rec.bestE1rm || v > rec.bestE1rm.value) rec.bestE1rm = { value: v, w: s.w, reps: s.reps, date: h.date };
        if (!rec.heaviest || Number(s.w) > Number(rec.heaviest.w)) rec.heaviest = { w: s.w, reps: s.reps, date: h.date };
      }
      if (ex.load === 'assist' && (!rec.heaviest || Number(s.w) < Number(rec.heaviest.w))) {
        rec.heaviest = { w: s.w, reps: s.reps, date: h.date, assist: true };
      }
      if (!rec.mostReps || Number(s.reps) > Number(rec.mostReps.reps)) rec.mostReps = { w: s.w, reps: s.reps, date: h.date };
    }
  }
  return rec;
}

/**
 * Records set in `session` that beat everything before it. Used for the
 * finish screen. Only counts exercises done at least once before, so the first
 * session is not a wall of meaningless "PRs".
 */
export function newRecords(session, earlier, bodyweight) {
  const out = [];
  for (const entry of session.entries) {
    const ex = exercise(entry.ex);
    if (!ex || ex.track === 'cardio' || !entry.sets.length) continue;
    const hasHistory = exerciseHistory(earlier, entry.ex, bodyweight).length > 0;
    if (!hasHistory) continue;
    const before = exerciseRecords(earlier, entry.ex, bodyweight);
    const now = exerciseRecords([session], entry.ex, bodyweight);
    for (const r of recordsBeaten(ex, before, now)) out.push({ ex: entry.ex, ...r });
  }
  return out;
}

/** The one definition of "a record was beaten", shared by newRecords and setRecords. */
function recordsBeaten(ex, before, now) {
  const out = [];
  if (now.bestE1rm && before.bestE1rm && now.bestE1rm.value > before.bestE1rm.value + 0.01) {
    out.push({ kind: 'Estimated 1-rep max', value: Math.round(now.bestE1rm.value), was: Math.round(before.bestE1rm.value) });
  }
  if (now.heaviest && before.heaviest && ex.load !== 'assist' && Number(now.heaviest.w) > Number(before.heaviest.w)) {
    out.push({ kind: 'Heaviest set', value: Number(now.heaviest.w), was: Number(before.heaviest.w) });
  }
  if (ex.load === 'assist' && now.heaviest && before.heaviest && Number(now.heaviest.w) < Number(before.heaviest.w)) {
    out.push({ kind: 'Least assistance', value: Number(now.heaviest.w), was: Number(before.heaviest.w) });
  }
  if (now.longest && before.longest && now.longest.secs > before.longest.secs) {
    out.push({ kind: 'Longest hold', value: now.longest.secs, was: before.longest.secs });
  }
  return out;
}

/**
 * Records the just-logged `set` beat, compared with all earlier sessions AND
 * the sets already logged today. Same kinds and rules as newRecords; quiet
 * for an exercise with no earlier sessions (the first time is not a PR).
 */
export function setRecords(set, exId, earlierSessions, earlierSetsToday, bodyweight) {
  const ex = exercise(exId);
  if (!ex || ex.track === 'cardio' || !set || set.warmup) return [];
  if (!exerciseHistory(earlierSessions, exId, bodyweight).length) return [];
  const today = (sets) => ({ id: '_today', startedAt: Number.MAX_SAFE_INTEGER, entries: [{ ex: exId, sets }] });
  const before = exerciseRecords([...earlierSessions, today(earlierSetsToday ?? [])], exId, bodyweight);
  const now = exerciseRecords([...earlierSessions, today([...(earlierSetsToday ?? []), set])], exId, bodyweight);
  return recordsBeaten(ex, before, now);
}

/** The most recent time this exercise was done: { date, sets }, or null. */
export function lastPerformance(sessions, exId) {
  const hist = exerciseHistory(sessions, exId, 0);
  const last = hist[hist.length - 1];
  return last ? { date: last.date, sets: last.sets } : null;
}

/**
 * How a set compares with the same-numbered set last time: weight first,
 * then reps (seconds for holds). { dir: 1 | 0 | -1, text } or null (cardio,
 * or nothing to compare with).
 */
export function compareSet(set, prev, ex) {
  if (!set || !prev || !ex || ex.track === 'cardio') return null;
  const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
  if (ex.track === 'time') {
    const d = (Number(set.secs) || 0) - (Number(prev.secs) || 0);
    return d > 0 ? { dir: 1, text: `▲ +${d} s` } : d < 0 ? { dir: -1, text: `▼ −${-d} s` } : { dir: 0, text: '=' };
  }
  if (ex.track === 'weight') {
    // Less help is better on assisted lifts.
    const dw = ((Number(set.w) || 0) - (Number(prev.w) || 0)) * (ex.load === 'assist' ? -1 : 1);
    if (dw !== 0) {
      const lb = fmtW(Math.abs(Number(set.w) - Number(prev.w)));
      return dw > 0 ? { dir: 1, text: `▲ ${ex.load === 'assist' ? '−' : '+'}${lb} lb` } : { dir: -1, text: `▼ ${ex.load === 'assist' ? '+' : '−'}${lb} lb` };
    }
  }
  const dr = (Number(set.reps) || 0) - (Number(prev.reps) || 0);
  return dr > 0 ? { dir: 1, text: `▲ +${plural(dr, 'rep')}` } : dr < 0 ? { dir: -1, text: `▼ −${plural(-dr, 'rep')}` } : { dir: 0, text: '=' };
}

// ── What to lift today ───────────────────────────────────────────────────

/**
 * Double progression, as the ACSM 2009 position stand describes it: stay at a
 * weight until you can do every set at the top of the rep range, then add a
 * small step (2–10%) and work back up.
 */
export function suggest(exId, target, sessions, bodyweight) {
  const ex = exercise(exId);
  if (!ex) return null;
  const hist = exerciseHistory(sessions, exId, bodyweight);
  const last = hist[hist.length - 1];
  const [min, max] = target?.reps ?? [8, 12];

  if (ex.track === 'cardio') {
    if (!last) return { text: target?.miles ? `${target.miles} mile` : `${target?.minutes ?? 5} min`, reason: 'First time logging this.' };
    const s = last.sets[last.sets.length - 1];
    return {
      text: target?.miles ? `${target.miles} mile` : `${target?.minutes ?? s.minutes} min`,
      reason: s.miles && s.minutes ? `Last time: ${s.miles} mi in ${fmtMinutes(s.minutes)} (${fmtPace(s.minutes / s.miles)}/mi).` : null,
    };
  }

  if (ex.track === 'time') {
    const [lo, hi] = target?.secs ?? [30, 60];
    if (!last) return { secs: lo, text: `${lo} s`, reason: `Start at ${lo} seconds, build toward ${hi}.` };
    const best = Math.max(...last.sets.map((s) => Number(s.secs) || 0));
    const next = Math.min(hi, best + 5);
    return { secs: next, text: `${next} s`, reason: `Last time your best hold was ${best} s.` };
  }

  if (!last) {
    return {
      w: null,
      reps: max,
      text: `Find your weight`,
      reason: `First time: pick a weight you could do about ${max + 2} times, and stop at ${max}. The last 1–2 reps should be hard but clean.`,
    };
  }

  const sets = last.sets;
  const topW = Math.max(...sets.map((s) => Number(s.w) || 0));
  const atTop = sets.filter((s) => Number(s.w) === topW);
  const allMaxed = atTop.length >= (target?.sets ?? sets.length) && atTop.every((s) => Number(s.reps) >= max);
  const anyMissed = sets.some((s) => Number(s.reps) < min);
  const summary = `Last time: ${sets.map((s) => `${fmtW(s.w)}×${s.reps}`).join(', ')}.`;
  const step = ex.step ?? 5;

  if (ex.track === 'bodyweight' || ex.load === 'none' || ex.load === 'body') {
    const best = Math.max(...sets.map((s) => Number(s.reps) || 0));
    // One number for both the pre-filled value and the text.
    const next = Math.min(best + 1, max + 5);
    const capped = next < best + 1;
    return {
      w: topW || 0,
      reps: next,
      text: `${next} reps`,
      reason: capped ? `${summary} You are well past the range — add weight or pick a harder variation.` : `${summary} Beat it by one.`,
    };
  }

  if (ex.load === 'assist') {
    if (allMaxed) {
      const w = Math.max(0, topW - step);
      return { w, reps: min, text: `${fmtW(w)} assist`, reason: `${summary} Every set hit ${max}, so take ${step} lb of help away.` };
    }
    return { w: topW, reps: max, text: `${fmtW(topW)} assist`, reason: `${summary} Stay here until every set reaches ${max}.` };
  }

  if (allMaxed) {
    const w = topW + step;
    return {
      w,
      reps: min,
      text: `${fmtW(w)} lb`,
      reason: `${summary} You hit ${max} on every set — go up ${step} lb and aim for ${min}+.`,
      up: true,
    };
  }
  const deload = plateauDeload(hist, target, max, step);
  if (deload) return deload;
  if (anyMissed) {
    return {
      w: topW,
      reps: min,
      text: `${fmtW(topW)} lb`,
      reason: `${summary} Same weight — get every set to at least ${min} before adding more.`,
    };
  }
  const lowest = Math.min(...atTop.map((s) => Number(s.reps)));
  return {
    w: topW,
    reps: Math.min(lowest + 1, max),
    text: `${fmtW(topW)} lb`,
    reason: `${summary} Same weight — add a rep to your weakest set.`,
  };
}

/**
 * Three sessions at the same top weight, none with every set at the top of
 * the range, and no more total reps at that weight in the last than in the
 * first: a plateau. Suggest about 10% less (rounded down to the exercise's
 * step, never below one step) for clean sets at the top of the range; the
 * normal rules then build back up. null when it is not a plateau.
 */
function plateauDeload(hist, target, max, step) {
  if (hist.length < 3) return null;
  const last3 = hist.slice(-3);
  const tops = last3.map((h) => Math.max(...h.sets.map((s) => Number(s.w) || 0)));
  if (!tops.every((w) => w === tops[0]) || !(tops[0] > 0)) return null;
  const topW = tops[0];
  const atTop = (h) => h.sets.filter((s) => Number(s.w) === topW);
  const maxed = (h) => atTop(h).length >= (target?.sets ?? h.sets.length) && atTop(h).every((s) => Number(s.reps) >= max);
  if (last3.some(maxed)) return null;
  const reps = (h) => atTop(h).reduce((a, s) => a + (Number(s.reps) || 0), 0);
  if (reps(last3[2]) > reps(last3[0])) return null;
  const w = Math.max(step, Math.floor((topW * 0.9) / step) * step);
  if (w >= topW) return null;
  return {
    w,
    reps: max,
    text: `${fmtW(w)} lb`,
    deload: true,
    reason: `Three sessions at ${fmtW(topW)} lb without adding reps. Drop to ${fmtW(w)} lb for clean sets of ${max}, then build back up.`,
  };
}

// ── Rest timer ───────────────────────────────────────────────────────────

/**
 * Decides what the rest timer should show/do, independent of which screen is
 * on top. `rest` is `{ until, total, alerted }` or null/undefined (no timer).
 *   - 'running': still counting down.
 *   - 'due': just ended (< 10 s ago) — the moment to beep/toast.
 *   - 'late': ended 10 s or more ago — the page was likely frozen; no beep.
 *   - 'done': no rest timer at all.
 * `left`/`overdue` are seconds, always >= 0.
 */
export function restStatus(rest, now = Date.now()) {
  if (!rest) return { state: 'done', left: 0, overdue: 0 };
  const left = (rest.until - now) / 1000;
  if (left > 0) return { state: 'running', left, overdue: 0 };
  const overdue = -left;
  return { state: overdue < 10 ? 'due' : 'late', left: 0, overdue };
}

/**
 * ±deltaSecs on the time left, keeping `total` at whatever it already was
 * (growing it if the new time left exceeds it) so the progress bar does not
 * jump back to full on every tap. Never lets less than 5 s remain.
 */
export function adjustRest(rest, deltaSecs, now = Date.now()) {
  if (!rest) return rest;
  const left = Math.max(5, (rest.until - now) / 1000 + deltaSecs);
  return { ...rest, until: now + left * 1000, total: Math.max(rest.total, left), alerted: false };
}

// ── Weekly volume ────────────────────────────────────────────────────────

function inRange(sessions, from, to) {
  return sessions.filter((s) => s.startedAt >= from && s.startedAt < to);
}

/**
 * Sets per muscle in a window. Primary muscles count 1 per set, secondary 0.5
 * (fractional counting, Pelland et al. 2025). Schoenfeld et al. 2017 found
 * growth kept improving up to 10+ weekly sets per muscle, which is the target
 * line the Stats screen draws.
 */
export function muscleSets(sessions, from, to) {
  const out = Object.fromEntries(MUSCLE_ORDER.map((m) => [m, 0]));
  const days = Object.fromEntries(MUSCLE_ORDER.map((m) => [m, new Set()]));
  for (const session of inRange(sessions, from, to)) {
    for (const entry of session.entries) {
      const ex = exercise(entry.ex);
      if (!ex || ex.track === 'cardio') continue;
      const n = work(entry.sets).length;
      if (!n) continue;
      for (const m of ex.muscles.primary) {
        out[m] += n;
        days[m].add(dayKey(session.startedAt));
      }
      for (const m of ex.muscles.secondary) out[m] += n * 0.5;
    }
  }
  const frequency = Object.fromEntries(MUSCLE_ORDER.map((m) => [m, days[m].size]));
  return { sets: out, frequency };
}

export function weekly(sessions, weeks, bodyweight, now = Date.now()) {
  const thisWeek = weekStart(now);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 7);
    const list = inRange(sessions, start, end);
    let tonnage = 0;
    let minutes = 0;
    let sets = 0;
    for (const s of list) {
      const sum = sessionSummary(s, bodyweight);
      tonnage += sum.tonnage;
      minutes += sum.durationMin;
      sets += sum.workSets;
    }
    out.push({ start, sessions: list.length, tonnage, minutes, sets });
  }
  return out;
}

/** Consecutive weeks hitting `target` sessions. This week counts once it is met. */
export function weekStreak(sessions, target, now = Date.now()) {
  const counts = new Map();
  for (const s of sessions) {
    const w = weekStart(s.startedAt);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  let week = weekStart(now);
  if ((counts.get(week) ?? 0) < target) week = addDays(week, -7);
  let streak = 0;
  while ((counts.get(week) ?? 0) >= target) {
    streak += 1;
    week = addDays(week, -7);
  }
  return streak;
}

/** dayKey -> tonnage (or 1 for a cardio-only day), for the heatmap. */
export function calendar(sessions, bodyweight) {
  const out = {};
  for (const s of sessions) {
    const k = dayKey(s.startedAt);
    const t = sessionSummary(s, bodyweight).tonnage;
    out[k] = (out[k] ?? 0) + Math.max(t, 1);
  }
  return out;
}

// ── Totals and fun comparisons ───────────────────────────────────────────

export function totals(sessions, bodyweight) {
  let tonnage = 0;
  let minutes = 0;
  let sets = 0;
  let reps = 0;
  let miles = 0;
  const byPattern = { push: 0, pull: 0, legs: 0, core: 0 };
  for (const s of sessions) {
    const sum = sessionSummary(s, bodyweight);
    tonnage += sum.tonnage;
    minutes += sum.durationMin;
    sets += sum.workSets;
    reps += sum.reps;
    miles += sum.cardioMiles;
    for (const k of Object.keys(byPattern)) byPattern[k] += sum.byPattern[k];
  }
  return { sessions: sessions.length, tonnage, minutes, sets, reps, miles, byPattern };
}

/**
 * Real-world weights for the "you have lifted…" line. Approximate, and
 * labelled that way on screen.
 *   - Concert grand piano (Steinway Model D): ~990 lb
 *   - Average new US vehicle: ~4,300 lb (EPA Automotive Trends Report)
 *   - Adult male African elephant: ~13,000 lb
 *   - Boeing 737-800, empty: ~91,300 lb
 *   - Blue whale: ~300,000 lb
 *   - Statue of Liberty: ~450,000 lb (225 tons, National Park Service)
 */
export const COMPARISONS = [
  { name: 'concert grand piano', plural: 'concert grand pianos', lb: 990 },
  { name: 'average new car', plural: 'average new cars', lb: 4300 },
  { name: 'African elephant', plural: 'African elephants', lb: 13000 },
  { name: 'empty Boeing 737', plural: 'empty Boeing 737s', lb: 91300 },
  { name: 'blue whale', plural: 'blue whales', lb: 300000 },
  { name: 'Statue of Liberty', plural: 'Statues of Liberty', lb: 450000 },
];

export function comparison(lb) {
  if (!lb) return null;
  let pick = COMPARISONS[0];
  for (const c of COMPARISONS) if (lb >= c.lb) pick = c;
  const n = lb / pick.lb;
  return { ...pick, count: n, text: `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${n >= 0.95 && n < 1.05 ? pick.name : pick.plural}` };
}

// ── Machines ─────────────────────────────────────────────────────────────

export function machineUsage(sessions, bodyweight) {
  const map = new Map();
  for (const session of sessions) {
    for (const entry of session.entries) {
      const ex = exercise(entry.ex);
      if (!ex || !entry.sets.length) continue;
      const row = map.get(entry.ex) ?? { ex: entry.ex, sessions: 0, sets: 0, reps: 0, tonnage: 0, first: session.startedAt, last: 0, minutes: 0 };
      row.sessions += 1;
      row.sets += work(entry.sets).length;
      for (const s of entry.sets) {
        row.reps += Number(s.reps) || 0;
        row.tonnage += setTonnage(s, ex, bodyweight);
        row.minutes += Number(s.minutes) || 0;
      }
      row.last = Math.max(row.last, session.startedAt);
      map.set(entry.ex, row);
    }
  }
  return [...map.values()].sort((a, b) => b.sets - a.sets || b.tonnage - a.tonnage);
}

/** Exercises you swapped in when the planned one was taken or missing. */
export function swapCounts(sessions) {
  const out = {};
  for (const s of sessions) {
    for (const e of s.entries) {
      if (e.plannedEx && e.plannedEx !== e.ex) {
        const k = `${e.plannedEx}→${e.ex}`;
        out[k] = (out[k] ?? 0) + 1;
      }
    }
  }
  return out;
}

// ── Cardio ───────────────────────────────────────────────────────────────

export function runs(sessions) {
  const out = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      if (entry.ex !== 'mile-run' && entry.ex !== 'treadmill-warmup') continue;
      for (const s of entry.sets) {
        if (!s.miles || !s.minutes) continue;
        out.push({ date: session.startedAt, ex: entry.ex, miles: Number(s.miles), minutes: Number(s.minutes), pace: Number(s.minutes) / Number(s.miles) });
      }
    }
  }
  return out;
}

// ── Heart rate ───────────────────────────────────────────────────────────

/** Tanaka, Monahan & Seals 2001: HRmax ≈ 208 − 0.7 × age. */
export function maxHr(profile) {
  if (profile?.maxHr) return Number(profile.maxHr);
  if (profile?.age) return Math.round(208 - 0.7 * Number(profile.age));
  return null;
}

export const ZONES = [
  { id: 1, name: 'Very light', from: 0.5, to: 0.6 },
  { id: 2, name: 'Light', from: 0.6, to: 0.7 },
  { id: 3, name: 'Moderate', from: 0.7, to: 0.8 },
  { id: 4, name: 'Hard', from: 0.8, to: 0.9 },
  { id: 5, name: 'Maximum', from: 0.9, to: 10 },
];

/** samples: [[ms, bpm], ...] sorted. Seconds in each zone, gaps capped at 60 s. */
export function hrSummary(samples, hrMax) {
  if (!samples?.length) return null;
  let sum = 0;
  let max = 0;
  let min = Infinity;
  const zones = ZONES.map((z) => ({ ...z, secs: 0 }));
  for (let i = 0; i < samples.length; i++) {
    const [t, bpm] = samples[i];
    sum += bpm;
    max = Math.max(max, bpm);
    min = Math.min(min, bpm);
    if (!hrMax) continue;
    const next = samples[i + 1];
    const dt = next ? Math.min((next[0] - t) / 1000, 60) : 5;
    const pct = bpm / hrMax;
    const z = zones.find((zz) => pct >= zz.from && pct < zz.to);
    if (z) z.secs += dt;
  }
  return { avg: Math.round(sum / samples.length), max, min, zones: hrMax ? zones : null, count: samples.length };
}

// ── Formatting shared by views ───────────────────────────────────────────

export function fmtW(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return '–';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function fmtLb(lb) {
  if (lb >= 1e6) return `${(lb / 1e6).toFixed(2)}M`;
  if (lb >= 10000) return `${(lb / 1000).toFixed(1)}k`;
  return Math.round(lb).toLocaleString('en-US');
}

export function fmtMinutes(min) {
  const total = Math.round(Number(min) * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtPace(minPerMile) {
  return fmtMinutes(minPerMile);
}

// ── Backup reminder ──────────────────────────────────────────────────────

/**
 * Whether Today should nudge the user to export a backup: at least 5
 * sessions logged, and either no backup was ever made, or at least 5 new
 * sessions have piled up since the last one — unless it was snoozed.
 */
export function shouldShowBackupReminder(state, now = Date.now()) {
  const sessions = state?.sessions ?? [];
  const prefs = state?.prefs ?? {};
  if (sessions.length < 5) return false;
  if (prefs.backupSnoozeUntil && now < prefs.backupSnoozeUntil) return false;
  if (!prefs.lastBackupAt) return true;
  return sessions.length - (prefs.lastBackupSessionCount ?? 0) >= 5;
}

/**
 * Minutes from a treadmill-style time field. Accepts `m`, `m.d` or `m:ss`
 * (seconds 0–59). Anything else — empty, `5:xx`, `5:75` — is `NaN`.
 */
export function parseClock(v) {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  if (s.includes(':')) {
    const m = /^(\d+):(\d{1,2})$/.exec(s);
    if (!m) return NaN;
    const mins = Number(m[1]);
    const secs = Number(m[2]);
    if (secs > 59) return NaN;
    return mins + secs / 60;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** A positive, finite number from user text. Accepts "12,5". Returns null if it is not one. */
export function parseAmount(text, { allowZero = false, integer = false } = {}) {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (integer && !Number.isInteger(n)) return null;
  if (n === 0 && !allowZero) return null;
  return n;
}

export function fmtDuration(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export { DAY, addDays };

// ── Busy times (spec 10) ─────────────────────────────────────────────────
// Your own history of how busy each gym was: one optional 1–5 rating per
// workout, plus how often you had to swap because a machine was taken.

export const CROWD_LABELS = ['Empty', 'Quiet', 'Normal', 'Busy', 'Packed'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** '6 am', '12 pm', '7 pm'. */
export function fmtHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n} ${h < 12 ? 'am' : 'pm'}`;
}

/** 'Mon 6 pm' (day: Mon = 0). */
export function fmtDayHour(day, hour) {
  return `${WEEKDAY_SHORT[day]} ${fmtHour(hour)}`;
}

/** The word for a 1–5 score, e.g. 3.6 → 'Busy'. */
export function crowdLabel(score) {
  if (score == null) return null;
  return CROWD_LABELS[Math.min(5, Math.max(1, Math.round(score))) - 1];
}

const emptyCell = () => ({ visits: 0, rated: 0, sum: 0, avg: null, taken: 0, takenVisits: 0, takenPerVisit: 0 });

/**
 * Per weekday (Mon = 0) and hour (0–23): visits, average crowd rating, and
 * "taken" swaps per visit. A session counts as a visit in every clock hour
 * it overlaps (17:40–18:50 → 17 and 18), in local time. gymId null = the
 * sessions logged with no gym.
 */
export function crowdGrid(sessions, gymId) {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, emptyCell));
  let totalRated = 0;
  for (const s of sessions ?? []) {
    if ((s.gymId ?? null) !== (gymId ?? null) || typeof s.startedAt !== 'number') continue;
    const rating = Number.isInteger(s.crowd) && s.crowd >= 1 && s.crowd <= 5 ? s.crowd : null;
    if (rating) totalRated += 1;
    const taken = (s.entries ?? []).filter((e) => e?.swapReason === 'taken').length;
    const end = typeof s.endedAt === 'number' && s.endedAt > s.startedAt ? s.endedAt : s.startedAt + 1;
    const slot = new Date(s.startedAt);
    slot.setMinutes(0, 0, 0);
    // Guard against bad data: never walk more than a day of hours.
    for (let i = 0; slot.getTime() < end && i < 24; i++) {
      const c = cells[(slot.getDay() + 6) % 7][slot.getHours()];
      c.visits += 1;
      c.taken += taken;
      if (taken) c.takenVisits += 1;
      if (rating) {
        c.rated += 1;
        c.sum += rating;
      }
      slot.setHours(slot.getHours() + 1);
    }
  }
  for (const row of cells) {
    for (const c of row) {
      c.avg = c.rated ? c.sum / c.rated : null;
      c.takenPerVisit = c.visits ? c.taken / c.visits : 0;
    }
  }
  return { cells, totalRated };
}

/**
 * One 1–5 score per cell: the average rating, nudged up by "taken" swaps.
 * Cells with visits but no rating get an estimate from swaps alone (see
 * crowdEstimated). null when there were no visits.
 */
export function crowdScore(cell) {
  if (!cell?.visits) return null;
  if (cell.rated) return Math.min(5, cell.avg + Math.min(1, cell.takenPerVisit * 0.5));
  return Math.min(5, 2.5 + Math.min(2, cell.takenPerVisit));
}

/** True when crowdScore() is only an estimate (no ratings in that cell). */
export function crowdEstimated(cell) {
  return !!cell?.visits && !cell.rated;
}

function rankedCells(grid, minVisits) {
  const out = [];
  grid.cells.forEach((row, day) =>
    row.forEach((c, hour) => {
      if (c.visits >= minVisits) out.push({ day, hour, score: crowdScore(c), visits: c.visits });
    }),
  );
  return out;
}

/** The quietest times, only from cells with at least 2 visits. Ties go to more visits. */
export function quietTimes(grid, { limit = 3 } = {}) {
  return rankedCells(grid, 2).sort((a, b) => a.score - b.score || b.visits - a.visits).slice(0, limit);
}

/** The busiest times, only from cells with at least 2 visits. Ties go to more visits. */
export function busyTimes(grid, { limit = 3 } = {}) {
  return rankedCells(grid, 2).sort((a, b) => b.score - a.score || b.visits - a.visits).slice(0, limit);
}

/**
 * Today's one-line hint for the plan card, or null when there is no data
 * for this weekday within an hour of now.
 * "Mondays around 6 pm have been Busy for you (3 visits). Quieter: Mon 8 pm."
 */
export function crowdHint(grid, now = Date.now()) {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7;
  const hour = d.getHours();
  const near = [hour, hour - 1, hour + 1]
    .filter((x) => x >= 0 && x < 24)
    .map((x) => ({ hour: x, cell: grid.cells[day][x] }))
    .filter((x) => x.cell.visits > 0);
  if (!near.length) return null;
  const best = near.reduce((a, b) => (b.cell.visits > a.cell.visits ? b : a));
  const score = crowdScore(best.cell);
  const word = crowdLabel(score);
  const days = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][day];
  const n = best.cell.visits;
  let text = `${days} around ${fmtHour(best.hour)} have ${crowdEstimated(best.cell) ? 'looked' : 'been'} ${word} for you (${n} visit${n === 1 ? '' : 's'}).`;
  const quieter = rankedCells(grid, 2)
    .filter((c) => c.day === day && c.hour !== best.hour && c.score < score - 0.5)
    .sort((a, b) => a.score - b.score || b.visits - a.visits)[0];
  if (quieter) text += ` Quieter: ${fmtDayHour(quieter.day, quieter.hour)}.`;
  return { text, score, hour: best.hour, visits: n };
}

// ── Plates and warm-ups (spec 14) ────────────────────────────────────────

export const PLATES = [45, 35, 25, 10, 5, 2.5];

/**
 * Plates for ONE side to reach `total` pounds of added plates (the number
 * this app logs for `load: 'plates'` exercises: plates only, both sides
 * together, bar/sled excluded). Greedy from the largest plate. When `total`
 * cannot be made exactly, gives the closest loading below it.
 * Returns { perSide: [45, 10, 2.5], achieved, exact }.
 */
export function platesPerSide(total, available = PLATES, { sides = 2 } = {}) {
  const t = Number(total);
  if (!(t > 0)) return { perSide: [], achieved: 0, exact: t === 0 };
  // Tenths of a pound, so 2.5 lb plates add up without float error.
  let left = Math.round((t * 10) / sides);
  const sizes = [...new Set(available.map(Number).filter((x) => x > 0))].sort((a, b) => b - a);
  const perSide = [];
  for (const p of sizes) {
    const u = Math.round(p * 10);
    while (left >= u) {
      perSide.push(p);
      left -= u;
    }
  }
  const achieved = Math.round(perSide.reduce((a, p) => a + p, 0) * sides * 10) / 10;
  return { perSide, achieved, exact: Math.abs(achieved - t) < 0.001 };
}

/** "Each side: 45 + 10 + 2.5", or "Each side: 45 + 10 (= 110, closest to 112)"; null for nothing to load. */
export function plateText(total, available = PLATES) {
  const r = platesPerSide(total, available);
  if (!r.perSide.length) return Number(total) > 0 ? `No plate combination fits ${fmtW(Number(total))} lb with the plates ticked.` : null;
  const list = r.perSide.map((p) => fmtW(p)).join(' + ');
  return r.exact ? `Each side: ${list}` : `Each side: ${list} (= ${fmtW(r.achieved)}, closest to ${fmtW(Number(total))})`;
}

/**
 * Two ramp-up sets before a heavy first lift: half the working weight for 8,
 * then three-quarters for 4, each rounded down to the exercise's step.
 * Nothing when the working weight is under four steps (too light to ramp).
 */
export function warmupSets(workW, step = 5) {
  const w = Number(workW);
  if (!(w > 0) || w < 4 * step) return [];
  const down = (x) => Math.floor(x / step) * step;
  const out = [];
  for (const [f, reps] of [[0.5, 8], [0.75, 4]]) {
    const x = down(w * f);
    if (x > 0 && x < w && !out.some((o) => o.w === x)) out.push({ w: x, reps });
  }
  return out;
}

/**
 * Whether entries[index] gets warm-up sets: for each of push, pull and legs,
 * the first weight-tracked exercise of the session whose planned rest is at
 * least 120 s (the big compound lifts in plans.js; not curls or raises).
 * Works on workout entries ({ ex, target: { rest } }) and plan items ({ ex, rest }).
 */
export function needsWarmup(entries, index) {
  const big = (e) => {
    const ex = exercise(e?.ex);
    return !!ex && ex.track === 'weight' && ex.load !== 'assist' && ['push', 'pull', 'legs'].includes(ex.pattern) && (e.target?.rest ?? e.rest ?? 0) >= 120;
  };
  const e = entries?.[index];
  if (!big(e)) return false;
  const pattern = exercise(e.ex).pattern;
  return !entries.slice(0, index).some((x) => big(x) && exercise(x.ex).pattern === pattern);
}

/** Rough minutes for a plan's items: each set plus its rest, cardio by time. */
export function estimateMinutes(items) {
  let secs = 0;
  for (const it of items ?? []) {
    const ex = exercise(it.ex);
    if (ex?.track === 'cardio') secs += (it.minutes ?? (it.miles ? it.miles * 10 : 5)) * 60;
    else secs += (Number(it.sets) || 0) * (45 + (it.rest ?? 90)) + 60;
  }
  return secs / 60;
}
