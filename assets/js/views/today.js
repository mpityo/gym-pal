import { h, toast, fmtRel, download } from '../util.js';
import * as store from '../store.js';
import { PLANS, PLAN_BY_ID, WEEK } from '../data/plans.js';
import { exerciseOr } from '../data/exercises.js';
import { suggest, weekStart, dayKey, sessionSummary, muscleSets, addDays, fmtLb, fmtDuration, shouldShowBackupReminder, crowdGrid, crowdHint, plateText } from '../metrics.js';
import { targetText, pickGym, gymChip, exerciseThumb } from './common.js';
import { MUSCLES } from '../data/exercises.js';

/** Which plan today is, and which plans this week are still undone. */
export function todayPlan(state, now = Date.now()) {
  const sessions = state.sessions;
  const week = weekStart(now);
  const sessionsThisWeek = sessions.filter((s) => s.startedAt >= week);
  const doneThisWeek = new Set(sessionsThisWeek.map((s) => s.planId));
  const today = new Date(now).getDay();
  const doneToday = sessions.some((s) => dayKey(s.startedAt) === dayKey(now));

  if (state.prefs.mode === '3day') {
    const last = [...sessions].reverse().find((s) => s.planId === 'full-a' || s.planId === 'full-b');
    const next = last?.planId === 'full-a' ? 'full-b' : 'full-a';
    const weekTarget = 3;
    // Repeats of a full-body plan still count, up to the weekly target; anything
    // past that (and any Freestyle session) is "extra", shown separately.
    const threeDayCount = sessionsThisWeek.filter((s) => PLAN_BY_ID[s.planId]?.threeDay).length;
    const weekDone = Math.min(threeDayCount, weekTarget);
    const extra = sessionsThisWeek.length - weekDone;
    const isDay = [1, 3, 5].includes(today);
    return { planId: next, rest: !isDay, doneToday, missed: [], weekDone, weekTarget, extra, label: isDay ? 'Today' : 'Next' };
  }

  const entry = WEEK.find((d) => d.day === today);
  const ordered = WEEK.filter((d) => d.plan);
  const todayIdx = (today + 6) % 7; // Monday = 0
  const missed = ordered.filter((d) => (d.day + 6) % 7 < todayIdx && !doneThisWeek.has(d.plan)).map((d) => d.plan);
  const upcoming = ordered.find((d) => (d.day + 6) % 7 > todayIdx && !doneThisWeek.has(d.plan))?.plan ?? 'upper-a';
  const weekTarget = 4;
  // Count distinct planned workouts done this week, not every session: a
  // Freestyle session (planId null) or a repeat of the same plan should not
  // inflate the count or falsely mark the week complete.
  const weekDone = new Set(sessionsThisWeek.map((s) => s.planId).filter((id) => id && WEEK.some((d) => d.plan === id))).size;
  const extra = sessionsThisWeek.length - weekDone;
  if (entry?.plan) {
    return { planId: entry.plan, rest: false, doneToday: doneToday || doneThisWeek.has(entry.plan), missed, weekDone, weekTarget, extra, label: 'Today' };
  }
  return { planId: missed[0] ?? upcoming, rest: true, restNote: entry?.note, doneToday, missed, weekDone, weekTarget, extra, label: missed.length ? 'Catch up' : 'Next' };
}

/** { gymId, geo, certain }: certain only when GPS puts you inside a saved gym. */
async function locate() {
  const st = store.getState();
  const withCoords = st.gyms.filter((g) => g.lat != null);
  if (!withCoords.length || !navigator.geolocation) return { gymId: null, geo: null, certain: false };
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 6000, maximumAge: 120000 }));
    const geo = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5), acc: Math.round(pos.coords.accuracy) };
    const g = store.nearestGym(geo);
    return { gymId: g?.id ?? null, geo, certain: !!g };
  } catch {
    return { gymId: null, geo: null, certain: false };
  }
}

let starting = false;

/** `btn` is the tapped button, if any: disabled and relabelled while locating. */
export async function start(planId, ctx, btn) {
  if (store.active()) {
    ctx.go('workout');
    return;
  }
  if (starting) return; // a tap is already in flight — ignore the extra tap
  starting = true;
  let prevLabel;
  if (btn) {
    prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Finding your gym…';
  }
  try {
    const where = await locate();
    const gyms = store.getState().gyms;
    if (!where.certain) {
      if (gyms.length >= 2) {
        const picked = await pickGym({ current: store.currentGym(), intro: 'Your location did not match a saved gym. Notes and swaps follow the gym you pick.' });
        if (picked === undefined) return;
        where.gymId = picked;
      } else if (gyms.length === 1) {
        where.gymId = gyms[0].id;
      }
    }
    if (store.active()) {
      // A session appeared while we were locating (e.g. resumed elsewhere).
      ctx.go('workout');
      return;
    }
    if (gyms.length) store.setCurrentGym(where.gymId);
    store.startSession(planId, { gymId: where.gymId, geo: where.geo });
    const g = where.gymId && store.gym(where.gymId);
    toast(g ? `Started at ${g.name}` : 'Workout started');
    ctx.go('workout');
  } finally {
    starting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  }
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

  const crowd = crowdHint(crowdGrid(st.sessions, store.currentGym()), now);

  const preview = h(
    'ol',
    { class: 'preview' },
    items.map((item) => {
      const ex = exerciseOr(item.ex);
      const sug = suggest(item.ex, { sets: item.sets, reps: item.reps, secs: item.secs, miles: item.miles, minutes: item.minutes }, st.sessions, bw);
      const note = store.machineNote(item.ex);
      return h(
        'li',
        { class: `preview__item${ex.track === 'cardio' ? ' is-cardio' : ''}` },
        exerciseThumb(item.ex),
        h(
          'button',
          { class: 'preview__name linkish', type: 'button', onClick: () => ctx.go(`machine/${item.ex}`) },
          ex.name,
          item.autoSwap
            ? h('span', { class: 'tag' }, 'not at this gym → swapped')
            : item.unavailable
              ? h('span', { class: 'tag tag--warn' }, 'not at this gym')
              : item.swappedFrom && h('span', { class: 'tag' }, 'swapped'),
        ),
        h('span', { class: 'preview__target' }, targetText({ sets: item.sets, reps: item.reps, secs: item.secs, miles: item.miles, minutes: item.minutes }, ex)),
        sug?.text && ex.track !== 'cardio' && h('span', { class: `preview__sug${sug.up ? ' is-up' : sug.deload ? ' is-deload' : ''}` }, sug.up ? `↑ ${sug.text}` : sug.deload ? `↓ ${sug.text} (deload)` : sug.text),
        ex.load === 'plates' && sug?.w > 0 && h('span', { class: 'preview__plates' }, plateText(sug.w, st.prefs.plates)),
        note.where && h('span', { class: 'preview__where' }, `📍 ${note.where}`),
      );
    }),
  );

  const a = store.active();
  const chip = gymChip(ctx);
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
    chip && h('div', { class: 'row row--wrap' }, chip),
    h('section', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'This week'), h('span', { class: 'muted mono' }, `${plan.weekDone}/${plan.weekTarget} workouts${plan.extra ? ` · +${plan.extra} extra` : ''}`)), strip),

    !a &&
      h(
        'section',
        { class: `card card--plan tint-${p.tint}` },
        h(
          'div',
          { class: 'card__head' },
          h('div', {}, h('p', { class: 'eyebrow' }, plan.rest ? `Rest day · ${plan.label}` : plan.doneToday ? 'Done for today · next time' : plan.label), h('h2', { class: 'plan-title' }, p.name)),
          h('span', { class: 'muted small' }, `${items.filter((i) => exerciseOr(i.ex).track !== 'cardio').length} lifts · ~${Math.round(estimateMinutes(items))} min`),
        ),
        crowd && h('p', { class: 'muted small' }, crowd.text),
        plan.rest && plan.restNote && h('p', { class: 'muted' }, plan.weekDone >= plan.weekTarget ? `All ${plan.weekTarget} done this week. ${plan.restNote} — ${p.name} is up next.` : `${plan.restNote}. ${plan.missed.length === 1 ? `${PLAN_BY_ID[plan.missed[0]].name} got skipped this week — want to catch up?` : plan.missed.length > 1 ? `${plan.missed.length} workouts are still open this week. Catch up with the first one, or just pick up the plan on Monday.` : 'Or start the next workout early.'}`),
        preview,
        h('button', { class: 'btn btn--primary btn--block btn--big', type: 'button', onClick: (e) => start(plan.planId, ctx, e.currentTarget) }, `Start ${p.name}`),
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
              { class: `choice tint-${x.tint}`, type: 'button', onClick: (e) => start(x.id, ctx, e.currentTarget) },
              h('strong', {}, x.name),
              h('span', { class: 'muted small' }, last ? `Last: ${fmtRel(last.startedAt)}` : 'Not done yet'),
            );
          }),
          h('button', { class: 'choice', type: 'button', onClick: (e) => start(null, ctx, e.currentTarget) }, h('strong', {}, 'Freestyle'), h('span', { class: 'muted small' }, 'Add exercises as you go')),
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
    const ex = exerciseOr(it.ex);
    if (ex.track === 'cardio') secs += (it.minutes ?? (it.miles ? it.miles * 10 : 5)) * 60;
    else secs += it.sets * (45 + (it.rest ?? 90)) + 60;
  }
  return secs / 60;
}

export { stat };
