import { h, toast, fmtRel, download } from '../util.js';
import * as store from '../store.js';
import { PLANS, PLAN_BY_ID, WEEK } from '../data/plans.js';
import { exercise } from '../data/exercises.js';
import { suggest, weekStart, dayKey, sessionSummary, muscleSets, addDays, fmtLb, fmtDuration, shouldShowBackupReminder } from '../metrics.js';
import { targetText } from './common.js';
import { MUSCLES } from '../data/exercises.js';

/** Which plan today is, and which plans this week are still undone. */
export function todayPlan(state, now = Date.now()) {
  const sessions = state.sessions;
  const week = weekStart(now);
  const doneThisWeek = new Set(sessions.filter((s) => s.startedAt >= week).map((s) => s.planId));
  const today = new Date(now).getDay();
  const doneToday = sessions.some((s) => dayKey(s.startedAt) === dayKey(now));

  if (state.prefs.mode === '3day') {
    const last = [...sessions].reverse().find((s) => s.planId === 'full-a' || s.planId === 'full-b');
    const next = last?.planId === 'full-a' ? 'full-b' : 'full-a';
    const thisWeek = sessions.filter((s) => s.startedAt >= week && PLAN_BY_ID[s.planId]?.threeDay).length;
    const isDay = [1, 3, 5].includes(today);
    return { planId: next, rest: !isDay, doneToday, missed: [], weekDone: thisWeek, weekTarget: 3, label: isDay ? 'Today' : 'Next' };
  }

  const entry = WEEK.find((d) => d.day === today);
  const ordered = WEEK.filter((d) => d.plan);
  const todayIdx = (today + 6) % 7; // Monday = 0
  const missed = ordered.filter((d) => (d.day + 6) % 7 < todayIdx && !doneThisWeek.has(d.plan)).map((d) => d.plan);
  const upcoming = ordered.find((d) => (d.day + 6) % 7 > todayIdx && !doneThisWeek.has(d.plan))?.plan ?? 'upper-a';
  const weekDone = sessions.filter((s) => s.startedAt >= week && !PLAN_BY_ID[s.planId]?.threeDay).length;
  if (entry?.plan) {
    return { planId: entry.plan, rest: false, doneToday: doneToday || doneThisWeek.has(entry.plan), missed, weekDone, weekTarget: 4, label: 'Today' };
  }
  return { planId: missed[0] ?? upcoming, rest: true, restNote: entry?.note, doneToday, missed, weekDone, weekTarget: 4, label: missed.length ? 'Catch up' : 'Next' };
}

async function locate() {
  const st = store.getState();
  const withCoords = st.gyms.filter((g) => g.lat != null);
  if (!withCoords.length || !navigator.geolocation) return { gymId: st.gyms[0]?.id ?? null, geo: null };
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000, maximumAge: 120000 }));
    const geo = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) };
    const g = store.nearestGym(geo);
    return { gymId: g?.id ?? null, geo };
  } catch {
    return { gymId: st.gyms[0]?.id ?? null, geo: null };
  }
}

export async function start(planId, ctx) {
  if (store.active()) {
    ctx.go('workout');
    return;
  }
  const where = await locate();
  store.startSession(planId, where);
  const g = where.gymId && store.gym(where.gymId);
  toast(g ? `Started at ${g.name}` : 'Workout started');
  ctx.go('workout');
}

export function renderToday(ctx) {
  const st = store.getState();
  const bw = st.profile.bodyweight;
  const plan = todayPlan(st);
  const p = PLAN_BY_ID[plan.planId];
  const items = store.planItems(plan.planId);
  const now = Date.now();
  const week = weekStart(now);

  const thisWeek = st.sessions.filter((s) => s.startedAt >= week);
  const weekTon = thisWeek.reduce((a, s) => a + sessionSummary(s, bw).tonnage, 0);
  const { sets } = muscleSets(st.sessions, week, addDays(week, 7));
  const low = Object.entries(sets).filter(([m, v]) => v > 0 && v < 10).map(([m]) => MUSCLES[m]);

  const strip = h(
    'ol',
    { class: 'week' },
    (st.prefs.mode === '3day'
      ? WEEK.map((d) => ({ ...d, plan: [1, 3, 5].includes(d.day) ? 'full' : null }))
      : WEEK
    ).map((d) => {
      const ts = addDays(week, (d.day + 6) % 7);
      const done = st.sessions.some((s) => dayKey(s.startedAt) === dayKey(ts));
      const isToday = dayKey(ts) === dayKey(now);
      const name = d.plan === 'full' ? 'Full' : d.plan ? PLAN_BY_ID[d.plan].name : 'Rest';
      return h(
        'li',
        { class: `week__day${isToday ? ' is-today' : ''}${done ? ' is-done' : ''}${d.plan ? '' : ' is-rest'}` },
        h('span', { class: 'week__label' }, d.label),
        h('span', { class: 'week__mark', 'aria-label': done ? 'done' : '' }, done ? '✓' : ''),
        h('span', { class: 'week__plan' }, name),
      );
    }),
  );

  const preview = h(
    'ol',
    { class: 'preview' },
    items.map((item) => {
      const ex = exercise(item.ex);
      const sug = suggest(item.ex, { sets: item.sets, reps: item.reps, secs: item.secs, miles: item.miles, minutes: item.minutes }, st.sessions, bw);
      const note = store.machineNote(item.ex);
      return h(
        'li',
        { class: `preview__item${ex.track === 'cardio' ? ' is-cardio' : ''}` },
        h(
          'button',
          { class: 'preview__name linkish', type: 'button', onClick: () => ctx.go(`machine/${item.ex}`) },
          ex.name,
          item.swappedFrom && h('span', { class: 'tag' }, 'swapped'),
        ),
        h('span', { class: 'preview__target' }, targetText({ sets: item.sets, reps: item.reps, secs: item.secs, miles: item.miles, minutes: item.minutes }, ex)),
        sug?.text && ex.track !== 'cardio' && h('span', { class: `preview__sug${sug.up ? ' is-up' : ''}` }, sug.up ? `↑ ${sug.text}` : sug.text),
        note.where && h('span', { class: 'preview__where' }, `📍 ${note.where}`),
      );
    }),
  );

  const a = store.active();
  return h(
    'div',
    { class: 'page' },
    a &&
      h(
        'section',
        { class: 'card card--live' },
        h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, `${a.name} in progress`), h('span', { class: 'mono', 'data-elapsed': a.startedAt })),
        h('button', { class: 'btn btn--primary btn--block', type: 'button', onClick: () => ctx.go('workout') }, 'Resume workout'),
      ),
    h('section', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'This week'), h('span', { class: 'muted mono' }, `${plan.weekDone}/${plan.weekTarget} workouts`)), strip),

    !a &&
      h(
        'section',
        { class: `card card--plan tint-${p.tint}` },
        h(
          'div',
          { class: 'card__head' },
          h('div', {}, h('p', { class: 'eyebrow' }, plan.rest ? `Rest day · ${plan.label}` : plan.doneToday ? 'Done for today · next time' : plan.label), h('h2', { class: 'plan-title' }, p.name)),
          h('span', { class: 'muted small' }, `${items.filter((i) => exercise(i.ex).track !== 'cardio').length} lifts · ~${Math.round(estimateMinutes(items))} min`),
        ),
        plan.rest && plan.restNote && h('p', { class: 'muted' }, plan.weekDone >= plan.weekTarget ? `All ${plan.weekTarget} done this week. ${plan.restNote} — ${p.name} is up next.` : `${plan.restNote}. ${plan.missed.length === 1 ? `${PLAN_BY_ID[plan.missed[0]].name} got skipped this week — want to catch up?` : plan.missed.length > 1 ? `${plan.missed.length} workouts are still open this week. Catch up with the first one, or just pick up the plan on Monday.` : 'Or start the next workout early.'}`),
        preview,
        h('button', { class: 'btn btn--primary btn--block btn--big', type: 'button', onClick: () => start(plan.planId, ctx) }, `Start ${p.name}`),
      ),

    !a &&
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Or pick another'),
        h(
          'div',
          { class: 'choice-grid' },
          PLANS.filter((x) => x.id !== plan.planId && (st.prefs.mode === '3day' ? x.threeDay : !x.threeDay)).map((x) => {
            const last = [...st.sessions].reverse().find((s) => s.planId === x.id);
            return h(
              'button',
              { class: `choice tint-${x.tint}`, type: 'button', onClick: () => start(x.id, ctx) },
              h('strong', {}, x.name),
              h('span', { class: 'muted small' }, last ? `Last: ${fmtRel(last.startedAt)}` : 'Not done yet'),
            );
          }),
          h('button', { class: 'choice', type: 'button', onClick: () => start(null, ctx) }, h('strong', {}, 'Freestyle'), h('span', { class: 'muted small' }, 'Add exercises as you go')),
        ),
      ),

    thisWeek.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'So far this week'),
        h(
          'div',
          { class: 'stat-grid' },
          stat(fmtLb(weekTon), 'lb lifted'),
          stat(String(thisWeek.reduce((a2, s) => a2 + sessionSummary(s, bw).workSets, 0)), 'sets'),
          stat(fmtDuration(thisWeek.reduce((a2, s) => a2 + sessionSummary(s, bw).durationMin, 0)), 'in the gym'),
        ),
        low.length > 0 && h('p', { class: 'muted small' }, `Under 10 sets so far: ${low.join(', ')}. That is fine mid-week — see Stats for the full picture.`),
      ),

    shouldShowBackupReminder(st, now) &&
      h(
        'section',
        { class: 'card card--tip' },
        h('h2', { class: 'card__title' }, 'Back up your data'),
        h('p', {}, `You have ${st.sessions.length} workouts that are only on this phone. Export a backup.`),
        h(
          'div',
          { class: 'row row--wrap' },
          h('button', {
            class: 'btn btn--primary',
            type: 'button',
            onClick: () => {
              download(`gym-pal-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson());
              store.recordBackupExported();
              toast('Backup exported');
              ctx.rerender();
            },
          }, 'Export backup'),
          h('button', {
            class: 'btn btn--ghost',
            type: 'button',
            onClick: () => {
              store.snoozeBackupReminder();
              toast('Reminding again in 7 days');
              ctx.rerender();
            },
          }, 'Later'),
        ),
      ),

    st.sessions.length === 0 &&
      !a &&
      h(
        'section',
        { class: 'card card--tip' },
        h('h2', { class: 'card__title' }, 'First time?'),
        h('ul', { class: 'steps' },
          h('li', {}, 'Go light for the first two weeks. The app suggests a weight once you have logged one session.'),
          h('li', {}, 'Tap any exercise to see what the machine looks like, how to set it up, and good swaps.'),
          h('li', {}, 'Add your bodyweight and age in Setup so heart-rate zones and bodyweight moves count properly.'),
        ),
      ),
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label));
}

function estimateMinutes(items) {
  let secs = 0;
  for (const it of items) {
    const ex = exercise(it.ex);
    if (ex.track === 'cardio') secs += (it.minutes ?? (it.miles ? it.miles * 10 : 5)) * 60;
    else secs += it.sets * (45 + (it.rest ?? 90)) + 60;
  }
  return secs / 60;
}

export { stat };
