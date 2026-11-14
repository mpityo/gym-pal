import { h, fmtDate, fmtRel } from '../util.js';
import * as store from '../store.js';
import * as ai from '../ai.js';
import { exerciseOr, MUSCLES, MUSCLE_ORDER } from '../data/exercises.js';
import {
  totals, comparison, weekly, weekStreak, muscleSets, weekStart, addDays, machineUsage, exerciseHistory, exerciseRecords,
  e1rm, calendar, runs, sessionSummary, hrSummary, maxHr, fmtLb, fmtDuration, fmtPace, fmtW, swapCounts, dayKey,
} from '../metrics.js';
import { watchForSession } from '../samsung.js';
import { bars, hbars, split, heatmap, sparkline, zoneBar } from '../charts.js';
import { empty } from './common.js';

let readCache = null;

export function renderStats(ctx) {
  const st = store.getState();
  const bw = st.profile.bodyweight;
  const sessions = st.sessions;
  if (!sessions.length) {
    return h('div', { class: 'page' }, h('div', { class: 'page__head' }, h('h1', {}, 'Stats')), empty('No workouts yet', 'Finish your first workout and this fills up: total weight moved, strength trends, weekly sets per muscle, machine usage, and your watch data.', h('button', { class: 'btn btn--primary', type: 'button', onClick: () => ctx.go('today') }, 'Start a workout')));
  }

  const now = Date.now();
  const target = st.prefs.mode === '3day' ? 3 : 4;
  const all = totals(sessions, bw);
  const cmp = comparison(all.tonnage);
  const streak = weekStreak(sessions, target, now);
  const wk = weekStart(now);
  const thisWeek = muscleSets(sessions, wk, addDays(wk, 7));
  const lastWeek = muscleSets(sessions, addDays(wk, -7), wk);
  const weeks = weekly(sessions, 12, bw, now);
  const usage = machineUsage(sessions, bw);
  const swaps = swapCounts(sessions);
  const summaries = sessions.map((s) => sessionSummary(s, bw));
  // Sessions under 10 minutes are usually ones finished by accident; they would wreck the averages.
  const real = summaries.filter((s) => s.durationMin >= 10);
  const avgLen = real.length ? real.reduce((a, s) => a + s.durationMin, 0) / real.length : null;
  const rests = summaries.map((s) => s.avgRestSec).filter(Boolean);
  const avgRest = rests.length ? rests.reduce((a, b) => a + b, 0) / rests.length : null;
  const density = real.length ? real.reduce((a, s) => a + s.density, 0) / real.length : null;

  // Strength trends: lifts done in 2+ sessions, change in best e1RM first → latest.
  const progress = usage
    .map((u) => {
      const ex = exerciseOr(u.ex);
      if (ex.track !== 'weight' || ex.load === 'assist') return null;
      const hist = exerciseHistory(sessions, u.ex, bw);
      if (hist.length < 2) return null;
      const series = hist.map((x) => Math.max(...x.sets.map((s) => e1rm(s.w, s.reps))));
      const first = series[0];
      const last = series[series.length - 1];
      return { ex, series, change: first ? (last - first) / first : 0, last };
    })
    .filter(Boolean)
    .sort((a, b) => b.change - a.change);

  // Time of day you train
  const hours = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
  for (const s of sessions) {
    const hr = new Date(s.startedAt).getHours();
    hours[hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : hr < 21 ? 'Evening' : 'Night'] += 1;
  }
  const favTime = Object.entries(hours).sort((a, b) => b[1] - a[1])[0][0];

  const mostMoved = [...usage].filter((u) => u.tonnage > 0).sort((a, b) => b.tonnage - a.tonnage).slice(0, 5);
  const mostUsed = usage.filter((u) => exerciseOr(u.ex).track !== 'cardio').slice(0, 6);
  const runList = runs(sessions).filter((r) => r.ex === 'mile-run');
  const bestMile = runList.length ? Math.min(...runList.map((r) => r.pace)) : null;

  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page__head' }, h('h1', {}, 'Stats'), h('p', { class: 'muted' }, `${sessions.length} workouts since ${fmtDate(sessions[0].startedAt, { month: 'short', day: 'numeric', year: 'numeric' })}`)),

    // Hero
    h(
      'section',
      { class: 'card card--hero' },
      h('p', { class: 'eyebrow' }, 'Total weight moved'),
      h('p', { class: 'hero-number mono' }, fmtLb(all.tonnage), h('span', { class: 'hero-unit' }, ' lb')),
      cmp && h('p', { class: 'hero-cmp' }, `About ${cmp.text}.`),
      h(
        'div',
        { class: 'stat-grid' },
        stat(String(all.sessions), 'workouts'),
        stat(fmtDuration(all.minutes), 'training'),
        stat(all.reps.toLocaleString(), 'reps'),
        stat(`${streak} wk`, `streak (${target}+/wk)`),
      ),
      !bw && h('p', { class: 'muted small' }, 'Add your bodyweight in Setup so push-ups and assisted moves count toward this.'),
    ),

    // Claude read
    ai.hasKey() && weeklyReadCard(st, { thisWeek, lastWeek, weeks, progress, streak, target }),

    // Muscles
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Sets per muscle this week'), h('span', { class: 'muted small' }, 'target 10+')),
      hbars(
        MUSCLE_ORDER.filter((m) => thisWeek.sets[m] > 0 || lastWeek.sets[m] > 0).map((m) => ({
          label: MUSCLES[m],
          value: thisWeek.sets[m],
          note: thisWeek.frequency[m] ? ` · ${thisWeek.frequency[m]}×` : '',
        })),
        { target: 10, fmt: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) },
      ),
      h('p', { class: 'muted small' }, 'Direct sets count 1, sets where the muscle helps count ½. 10+ weekly sets per muscle tracked with more growth in Schoenfeld et al. 2017; "2×" means it was trained on two days, the frequency Schoenfeld 2016 favored.'),
    ),

    // Weekly volume
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Weekly volume'),
      bars(weeks.map((w, i) => ({ label: i === weeks.length - 1 ? 'Now' : fmtDate(w.start, { month: 'numeric', day: 'numeric' }), value: Math.round(w.tonnage), highlight: i === weeks.length - 1, title: `${w.sessions} workouts, ${w.sets} sets` })), { fmt: fmtLb }),
      h('p', { class: 'muted small' }, 'Pounds moved per week (weight × reps).'),
    ),

    // Push / pull split
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Pushed, pulled, legs'),
      split(
        [
          { label: 'Pushed', value: Math.round(all.byPattern.push), cls: 'p-push' },
          { label: 'Pulled', value: Math.round(all.byPattern.pull), cls: 'p-pull' },
          { label: 'Legs', value: Math.round(all.byPattern.legs), cls: 'p-legs' },
          { label: 'Core', value: Math.round(all.byPattern.core), cls: 'p-core' },
        ],
        { fmt: (v) => `${fmtLb(v)} lb` },
      ),
      balanceNote(all.byPattern),
    ),

    // Strength
    progress.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Getting stronger'),
        h('ol', { class: 'progress-list' }, progress.slice(0, 8).map((p) =>
          h('li', {},
            h('button', { class: 'linkish', type: 'button', onClick: () => ctx.go(`machine/${p.ex.id}`) }, p.ex.name),
            sparkline(p.series, { width: 96, height: 28 }),
            h('span', { class: `delta${p.change > 0 ? ' is-up' : p.change < 0 ? ' is-down' : ''}` }, `${p.change > 0 ? '+' : ''}${Math.round(p.change * 100)}%`),
          ),
        )),
        h('p', { class: 'muted small' }, 'Change in estimated 1-rep max (Epley) from your first session to your latest.'),
      ),

    // Records
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Personal records'),
      h('ol', { class: 'records' }, usage.filter((u) => exerciseOr(u.ex).track === 'weight' && exerciseOr(u.ex).load !== 'assist').slice(0, 10).map((u) => {
        const r = exerciseRecords(sessions, u.ex, bw);
        return h('li', {},
          h('span', {}, exerciseOr(u.ex).name),
          h('span', { class: 'mono' }, r.heaviest ? `${fmtW(r.heaviest.w)} × ${r.heaviest.reps}` : '–'),
          h('span', { class: 'muted small' }, r.bestE1rm ? `e1RM ${Math.round(r.bestE1rm.value)} · ${fmtRel(r.bestE1rm.date)}` : ''),
        );
      })),
    ),

    // Machines
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Machine usage'),
      h('h3', { class: 'eyebrow' }, 'Most used (sets)'),
      hbars(mostUsed.map((u) => ({ label: exerciseOr(u.ex).name, value: u.sets, note: ` · ${u.sessions}×` }))),
      mostMoved.length > 0 && h('h3', { class: 'eyebrow' }, 'Most weight moved'),
      mostMoved.length > 0 && hbars(mostMoved.map((u) => ({ label: exerciseOr(u.ex).name, value: Math.round(u.tonnage) })), { fmt: (v) => `${fmtLb(v)} lb` }),
      Object.keys(swaps).length > 0 && h('h3', { class: 'eyebrow' }, 'Swaps (machine taken or missing)'),
      Object.keys(swaps).length > 0 &&
        h('ul', { class: 'plain' }, Object.entries(swaps).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => {
          const [from, to] = k.split('→');
          return h('li', {}, `${exerciseOr(from).name} → ${exerciseOr(to).name}`, h('span', { class: 'muted' }, ` · ${n}×`));
        })),
    ),

    // Habits
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Habits'),
      h('div', { class: 'stat-grid' },
        stat(avgLen ? fmtDuration(avgLen) : '–', 'average workout'),
        stat(avgRest ? `${Math.round(avgRest)} s` : '–', 'average rest'),
        stat(density ? `${Math.round(density)}` : '–', 'lb per minute'),
        stat(favTime, 'usual time'),
      ),
      h('h3', { class: 'eyebrow' }, 'Last 16 weeks'),
      heatmap(calendar(sessions, bw), { weeks: 16, now }),
    ),

    // Cardio
    runList.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Mile run'),
        h('div', { class: 'stat-grid' }, stat(fmtPace(bestMile), 'best mile'), stat(fmtPace(runList[runList.length - 1].pace), 'latest'), stat(String(runList.length), 'runs logged'), stat(all.miles.toFixed(1), 'total miles')),
        runList.length > 1 && h('div', { class: 'trend' }, h('span', { class: 'muted small' }, 'Minutes per mile — lower is faster'), sparkline(runList.map((r) => r.pace), { width: 280, height: 56 })),
      ),

    watchSection(st, sessions, bw),
  );
}

function balanceNote(p) {
  const push = p.push;
  const pull = p.pull;
  if (!push || !pull) return null;
  const ratio = push / pull;
  const txt = ratio > 1.3 ? 'You have pushed noticeably more than you have pulled. Rows, pulldowns and rear-delt work balance the shoulders.' : ratio < 0.77 ? 'More pulling than pushing so far.' : 'Pushing and pulling are roughly balanced.';
  return h('p', { class: 'muted small' }, `Push : pull = ${ratio.toFixed(2)}. ${txt}`);
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label));
}

// ── Watch ────────────────────────────────────────────────────────────────

function watchSection(st, sessions, bw) {
  const w = st.watch;
  const hrMax = maxHr(st.profile);
  const linked = sessions.map((s) => ({ s, ...watchForSession(s, w) })).filter((x) => x.workout || x.samples);

  if (!w && !linked.length) {
    return h('section', { class: 'card card--tip' }, h('h2', { class: 'card__title' }, 'Galaxy Watch'), h('p', { class: 'muted' }, 'Import your Samsung Health data in Setup, or connect live heart rate during a workout, and heart-rate zones, calories, steps and sleep show up here.'));
  }

  // Zones across all linked sessions
  const zoneTotals = [1, 2, 3, 4, 5].map((id) => ({ id, name: '', secs: 0 }));
  let avgSum = 0;
  let avgN = 0;
  let peak = 0;
  for (const x of linked) {
    const hs = x.samples ? hrSummary(x.samples, hrMax) : null;
    const avg = hs?.avg ?? x.workout?.avgHr;
    if (avg) {
      avgSum += avg;
      avgN += 1;
    }
    peak = Math.max(peak, hs?.max ?? x.workout?.maxHr ?? 0);
    hs?.zones?.forEach((z, i) => {
      zoneTotals[i].secs += z.secs;
      zoneTotals[i].name = z.name;
    });
  }
  const kcal = linked.reduce((a, x) => a + (x.workout?.kcal ?? 0), 0);

  const days = w?.days ?? {};
  const keys = Object.keys(days).sort();
  const last30 = keys.filter((k) => k >= dayKey(Date.now() - 30 * 86400000));
  const avgOf = (field, list) => {
    const v = list.map((k) => days[k][field]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const steps30 = avgOf('steps', last30);
  const sleep30 = avgOf('sleepMin', last30);
  const lowSeries = last30.map((k) => days[k].hrLow).filter((x) => x != null);

  // Sleep the night before vs how much you moved — only shown once there are enough sessions in each group.
  const withSleep = sessions.map((s) => ({ s, sleep: days[dayKey(s.startedAt)]?.sleepMin })).filter((x) => x.sleep != null);
  const good = withSleep.filter((x) => x.sleep >= 420);
  const short = withSleep.filter((x) => x.sleep < 420);
  const avgTon = (list) => list.reduce((a, x) => a + sessionSummary(x.s, bw).tonnage, 0) / list.length;

  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Galaxy Watch'), w && h('span', { class: 'muted small' }, `imported ${fmtRel(w.importedAt)}`)),
    linked.length > 0 &&
      h('div', { class: 'stat-grid' },
        stat(avgN ? `${Math.round(avgSum / avgN)}` : '–', 'avg workout bpm'),
        stat(peak ? String(peak) : '–', 'peak bpm'),
        stat(kcal ? Math.round(kcal).toLocaleString() : '–', 'kcal (watch)'),
        stat(String(linked.length), 'workouts with HR'),
      ),
    zoneTotals.some((z) => z.secs > 0) && h('h3', { class: 'eyebrow' }, `Time in heart-rate zones${hrMax ? ` (max ${hrMax})` : ''}`),
    zoneTotals.some((z) => z.secs > 0) && zoneBar(zoneTotals),
    !hrMax && linked.length > 0 && h('p', { class: 'muted small' }, 'Add your age in Setup to see heart-rate zones.'),
    keys.length > 0 &&
      h('div', { class: 'stat-grid' },
        stat(steps30 ? Math.round(steps30).toLocaleString() : '–', 'steps/day (30 d)'),
        stat(sleep30 ? `${(sleep30 / 60).toFixed(1)} h` : '–', 'sleep/night (30 d)'),
        stat(lowSeries.length ? String(Math.round(lowSeries.reduce((a, b) => a + b, 0) / lowSeries.length)) : '–', 'daily low bpm'),
      ),
    lowSeries.length > 1 && h('div', { class: 'trend' }, h('span', { class: 'muted small' }, 'Lowest heart rate each day, last 30 days. A slow drift down is a common sign of improving fitness.'), sparkline(lowSeries, { width: 280, height: 48 })),
    good.length >= 3 && short.length >= 3 &&
      h('p', { class: 'insight' }, `After 7+ hours of sleep you moved ${fmtLb(avgTon(good))} lb per workout on average, vs ${fmtLb(avgTon(short))} lb after less (${good.length} vs ${short.length} workouts). Small sample — a pattern to watch, not a conclusion.`),
  );
}

// ── Claude's read of the week ────────────────────────────────────────────

function weeklyReadCard(st, d) {
  const out = h('div', { class: 'read' });
  const btn = h('button', { class: 'btn btn--ghost', type: 'button', onClick: run }, 'Write my weekly read');
  if (readCache?.key === readKey(st)) show(readCache.value);

  async function run() {
    btn.disabled = true;
    out.replaceChildren(h('p', { class: 'muted' }, 'Reading your week…'));
    try {
      const value = await ai.weeklyRead(facts(st, d));
      readCache = { key: readKey(st), value };
      show(value);
    } catch (err) {
      out.replaceChildren(h('p', {}, err.message));
    } finally {
      btn.disabled = false;
    }
  }
  function show(v) {
    out.replaceChildren(h('p', { class: 'read__headline' }, v.headline), h('ul', { class: 'steps' }, (v.points ?? []).map((p) => h('li', {}, p))), h('p', { class: 'read__next' }, h('strong', {}, 'Next: '), v.next));
  }
  return h('section', { class: 'card card--read' }, h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Coach’s read'), btn), out);
}

function readKey(st) {
  return `${st.sessions.length}:${st.sessions[st.sessions.length - 1]?.id}`;
}

function facts(st, d) {
  const bw = st.profile.bodyweight;
  const wk = weekStart(Date.now());
  const recent = st.sessions.filter((s) => s.startedAt >= addDays(wk, -7));
  return {
    plan: st.prefs.mode === '3day' ? '3-day full body' : '4-day upper/lower',
    weeklyTarget: d.target,
    weekStreak: d.streak,
    thisWeekSetsPerMuscle: Object.fromEntries(Object.entries(d.thisWeek.sets).filter(([, v]) => v > 0).map(([k, v]) => [MUSCLES[k], v])),
    thisWeekDaysPerMuscle: Object.fromEntries(Object.entries(d.thisWeek.frequency).filter(([, v]) => v > 0).map(([k, v]) => [MUSCLES[k], v])),
    lastWeekSetsPerMuscle: Object.fromEntries(Object.entries(d.lastWeek.sets).filter(([, v]) => v > 0).map(([k, v]) => [MUSCLES[k], v])),
    weeklyPoundsLast4: d.weeks.slice(-4).map((w) => ({ week: dayKey(w.start), pounds: Math.round(w.tonnage), workouts: w.sessions })),
    strengthChangeSinceFirstSession: d.progress.slice(0, 8).map((p) => ({ exercise: p.ex.name, changePct: Math.round(p.change * 100), latestE1rm: Math.round(p.last) })),
    recentWorkouts: recent.map((s) => {
      const sum = sessionSummary(s, bw);
      const wd = watchForSession(s, st.watch);
      return {
        date: dayKey(s.startedAt),
        plan: s.name,
        minutes: Math.round(sum.durationMin),
        sets: sum.workSets,
        pounds: sum.tonnage,
        avgHr: wd.samples ? hrSummary(wd.samples, null).avg : wd.workout?.avgHr ?? null,
        sleepHoursNightBefore: st.watch?.days?.[dayKey(s.startedAt)]?.sleepMin ? +(st.watch.days[dayKey(s.startedAt)].sleepMin / 60).toFixed(1) : null,
        notes: s.notes || null,
      };
    }),
  };
}
