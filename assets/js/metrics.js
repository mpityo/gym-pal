/**
 * Every number the app shows is computed here, from the sessions you logged
 * and the watch data you imported. Pure functions, no DOM, so they are tested
 * in Node (see test/metrics.test.mjs).
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
    entry.sets.forEach((s, i) => {
      workSets += 1;
      reps += Number(s.reps) || 0;
      const t = setTonnage(s, ex, bodyweight);
      tonnage += t;
      if (byPattern[ex.pattern] != null) byPattern[ex.pattern] += t;
      if (i > 0 && s.at && entry.sets[i - 1].at) {
        const gap = (s.at - entry.sets[i - 1].at) / 1000;
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
      if (entry.ex !== exId || !entry.sets.length) continue;
      let best = null;
      let tonnage = 0;
      for (const s of entry.sets) {
        tonnage += setTonnage(s, ex, bodyweight);
        const score = strengthOf(s, ex, bodyweight);
        if (!best || score > best.score) best = { ...s, score };
      }
      out.push({
        date: session.startedAt,
        sessionId: session.id,
        sets: entry.sets,
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
    const before = exerciseRecords(earlier, entry.ex, bodyweight);
    const hasHistory = exerciseHistory(earlier, entry.ex, bodyweight).length > 0;
    if (!hasHistory) continue;
    const now = exerciseRecords([session], entry.ex, bodyweight);
    if (now.bestE1rm && before.bestE1rm && now.bestE1rm.value > before.bestE1rm.value + 0.01) {
      out.push({ ex: entry.ex, kind: 'Estimated 1-rep max', value: Math.round(now.bestE1rm.value), was: Math.round(before.bestE1rm.value) });
    }
    if (now.heaviest && before.heaviest && ex.load !== 'assist' &&Number(now.heaviest.w) > Number(before.heaviest.w)) {
      out.push({ ex: entry.ex, kind: 'Heaviest set', value: Number(now.heaviest.w), was: Number(before.heaviest.w) });
    }
    if (ex.load === 'assist' && now.heaviest && before.heaviest && Number(now.heaviest.w) < Number(before.heaviest.w)) {
      out.push({ ex: entry.ex, kind: 'Least assistance', value: Number(now.heaviest.w), was: Number(before.heaviest.w) });
    }
    if (now.longest && before.longest && now.longest.secs > before.longest.secs) {
      out.push({ ex: entry.ex, kind: 'Longest hold', value: now.longest.secs, was: before.longest.secs });
    }
  }
  return out;
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
    return { w: topW || 0, reps: Math.min(best + 1, max + 5), text: `${best + 1} reps`, reason: `${summary} Beat it by one.` };
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
      const n = entry.sets.length;
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
      row.sets += entry.sets.length;
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

export function fmtDuration(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export { DAY, addDays };
