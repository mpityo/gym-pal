import { h, modal, toast, fmtSecs, fmtClock, fmtDate } from '../util.js';
import * as store from '../store.js';
import * as hr from '../hr.js';
import { exerciseOr } from '../data/exercises.js';
import {
  suggest, sessionSummary, newRecords, comparison, hrSummary, maxHr, fmtW, fmtLb, fmtDuration, fmtMinutes,
  lastPerformance, compareSet, setRecords, work, warmupSets, needsWarmup, plateText, PLATES,
} from '../metrics.js';
import { crowdChips, targetText, openSwap, openHowTo, openExercisePicker, pickGym, gymName, exerciseThumb } from './common.js';
import { zoneBar } from '../charts.js';
import { stepper, setLabel, setFields, readSet, openSetEditor } from './sets.js';

/** Typed-but-not-logged values, so a re-render does not wipe them. */
const draft = {};
let stopwatch = null; // { entry, startedAt }

export function renderWorkout(ctx) {
  const a = store.active();
  const st = store.getState();
  const bw = store.bw();
  const sum = sessionSummary(a, bw);
  const changeGym = async () => {
    const next = await pickGym({ title: 'Change gym', current: a.gymId, intro: 'Exercises you have not started are re-picked for that gym. Logged sets stay as they are.' });
    if (next === undefined || next === a.gymId) return;
    store.setSessionGym(next);
    toast(`Now at ${gymName(next)}`);
    ctx.rerender();
  };

  const header = h(
    'section',
    { class: 'card card--live workout-head' },
    h(
      'div',
      { class: 'card__head' },
      h('div', {},
        st.gyms.length
          ? h('button', { class: 'eyebrow linkish', type: 'button', 'aria-label': `Gym: ${gymName(a.gymId)}. Change gym`, onClick: changeGym }, `📍 ${gymName(a.gymId)} ▾`)
          : h('p', { class: 'eyebrow' }, 'Workout'),
        h('h2', { class: 'plan-title' }, a.name)),
      h('span', { class: 'clock mono', 'data-elapsed': a.startedAt }, fmtSecs((Date.now() - a.startedAt) / 1000)),
    ),
    h(
      'div',
      { class: 'head-stats' },
      h('span', {}, h('strong', {}, String(sum.workSets)), ' sets'),
      h('span', {}, h('strong', {}, fmtLb(sum.tonnage)), ' lb'),
      h('span', {}, h('strong', {}, `${a.entries.filter((e) => done(e)).length}/${a.entries.length}`), ' exercises'),
      hr.connected()
        ? h('span', { class: 'hr-inline' }, '♥ ', h('strong', {}, String(hr.latest() ?? '–')))
        : hr.supported() && h('button', { class: 'linkish small', type: 'button', onClick: () => connectHr(ctx) }, 'Connect heart rate'),
    ),
  );

  const list = h(
    'ol',
    { class: 'entries' },
    a.entries.map((entry, i) => (i === a.current ? h('li', { class: 'entry is-open' }, openEntry(ctx, a, entry, i, st)) : h('li', { class: `entry${done(entry) ? ' is-done' : ''}${entry.skipped ? ' is-skipped' : ''}` }, closedEntry(entry, i)))),
  );

  const notes = h('textarea', {
    class: 'input',
    rows: 2,
    placeholder: 'Notes for this workout (how you felt, what to change)',
    value: a.notes,
    onChange: (e) => store.setSessionNotes(e.target.value),
  });

  const rest = a.rest && a.rest.until > Date.now() - 4000;
  return h(
    'div',
    { class: 'page page--workout' },
    header,
    list,
    h(
      'div',
      { class: 'row row--wrap' },
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => openExercisePicker({ onPick: (id) => { store.addEntry(id); ctx.rerender(); } }) }, '+ Add exercise'),
    ),
    h('section', { class: 'card' }, h('h3', { class: 'eyebrow' }, 'Notes'), notes),
    h(
      'div',
      { class: 'stack' },
      h('button', { class: 'btn btn--primary btn--block btn--big', type: 'button', onClick: () => finish(ctx) }, 'Finish workout'),
      h(
        'button',
        {
          class: 'btn btn--danger-ghost btn--block',
          type: 'button',
          onClick: () => {
            if (confirm('Throw away this workout? Nothing from it will be saved.')) {
              store.discardSession();
              ctx.go('today');
            }
          },
        },
        'Discard workout',
      ),
    ),
    h(
      'div',
      { id: 'restbar', class: 'restbar', hidden: !rest },
      h('span', { class: 'restbar__fill' }),
      h('span', { class: 'restbar__label' }, 'Rest ', h('strong', { class: 'mono', 'data-rest-left': '' }, a.rest ? fmtSecs((a.rest.until - Date.now()) / 1000) : '')),
      h('span', { class: 'restbar__actions' },
        h('button', { type: 'button', onClick: () => { store.adjustRest(-15); ctx.rerender(); } }, '−15'),
        h('button', { type: 'button', onClick: () => { store.adjustRest(15); ctx.rerender(); } }, '+15'),
        h('button', { type: 'button', onClick: () => { store.setRest(0); ctx.rerender(); } }, 'Skip'),
      ),
    ),
  );
}

/** Done when the work sets reach the target; warm-ups never complete an exercise. */
function done(entry) {
  return work(entry.sets).length >= entry.target.sets;
}

function closedEntry(entry, i) {
  const ex = exerciseOr(entry.ex);
  return h(
    'button',
    { class: 'entry__row', type: 'button', onClick: () => store.setCurrent(i) || rerenderSoon() },
    h('span', { class: 'entry__check', 'aria-hidden': 'true' }, done(entry) ? '✓' : entry.skipped ? '–' : String(i + 1)),
    h('span', { class: 'entry__name' }, ex.name),
    h('span', { class: 'entry__progress mono' }, entry.sets.length ? summarizeSets(entry, ex) : targetText(entry.target, ex)),
  );
}

let rerenderSoon = () => {};

function summarizeSets(entry, ex) {
  if (ex.track === 'cardio') return entry.sets.map((s) => (s.miles ? `${s.miles} mi ${fmtMinutes(s.minutes)}` : `${fmtMinutes(s.minutes)}`)).join(', ');
  if (ex.track === 'time') return entry.sets.map((s) => `${s.secs}s`).join(' · ');
  if (ex.track === 'bodyweight' || ex.load === 'none') return entry.sets.map((s) => `${s.reps}`).join(' · ');
  return entry.sets.map((s) => `${s.warmup ? 'w' : ''}${fmtW(s.w)}×${s.reps}`).join(' · ');
}

function openEntry(ctx, a, entry, i, st) {
  rerenderSoon = () => ctx.rerender();
  const ex = exerciseOr(entry.ex);
  const earlier = st.sessions;
  const sug = suggest(entry.ex, entry.target, earlier, store.bw());
  const note = store.machineNote(entry.ex);
  const d = (draft[a.id + i] ??= {});
  const lastSet = entry.sets[entry.sets.length - 1];
  // Last time for the exercise actually being done (after a swap, the swapped-in one).
  const prev = lastPerformance(earlier, entry.ex);

  const head = h(
    'div',
    { class: 'entry__head entry__head--thumb' },
    h('button', { class: 'entry__thumb', type: 'button', 'aria-label': `How to: ${ex.name}`, onClick: () => openHowTo(entry.ex, ctx) }, exerciseThumb(entry.ex, { size: 64 })),
    h('div', {}, h('h3', { class: 'entry__title' }, ex.name), h('p', { class: 'muted small' }, targetText(entry.target, ex), entry.target.rest && ex.track !== 'cardio' ? ` · rest ${fmtSecs(entry.target.rest)}` : '', entry.autoSwap ? ` · ${exerciseOr(entry.plannedEx).name} is not at this gym` : entry.plannedEx !== entry.ex ? ` · swapped for ${exerciseOr(entry.plannedEx).name}` : '', entry.unavailable ? ' · not at this gym — swap or skip' : '')),
  );

  const tools = h(
    'div',
    { class: 'entry__tools' },
    h('button', { class: 'btn btn--small btn--ghost', type: 'button', onClick: () => openHowTo(entry.ex, ctx) }, 'How to'),
    ex.alts.length > 0 &&
      h(
        'button',
        {
          class: 'btn btn--small btn--ghost',
          type: 'button',
          onClick: () =>
            openSwap(entry.ex, {
              title: 'Machine taken or missing?',
              allowPermanent: entry.planIndex != null && a.planId,
              planName: store.getPlan(a.planId)?.name,
              askReason: true,
              onPick: (id, { always, reason, markMissing }) => {
                if (markMissing) store.setMachineNote(entry.ex, { missing: true }, a.gymId ?? store.currentGym());
                store.swapExercise(i, id, reason);
                if (always && a.planId && entry.planIndex != null) store.setPermanentSwap(a.planId, entry.planIndex, id);
                delete draft[a.id + i];
                toast(`Swapped to ${exerciseOr(id).name}`);
                ctx.rerender();
              },
            }),
        },
        'Swap',
      ),
    h(
      'button',
      {
        class: 'btn btn--small btn--ghost',
        type: 'button',
        onClick: () => {
          store.skipEntry(i, true);
          advance(a, i);
          ctx.rerender();
        },
      },
      'Skip',
    ),
  );

  const guide = h(
    'div',
    { class: `guide${sug?.up ? ' guide--up' : sug?.deload ? ' guide--deload' : ''}` },
    sug?.text && h('p', { class: 'guide__main' }, sug.up ? '↑ ' : sug?.deload ? '↓ ' : '', ex.track === 'cardio' ? `Target: ${sug.text}` : sug.w == null && ex.track === 'weight' ? sug.text : `Try ${sug.text}`),
    sug?.reason && h('p', { class: 'guide__why' }, sug.reason),
    (note.where || note.settings) && h('p', { class: 'guide__note' }, note.where && `📍 ${note.where}`, note.where && note.settings && ' · ', note.settings && `⚙ ${note.settings}`),
    entry.target.note && h('p', { class: 'guide__note' }, entry.target.note),
  );

  const logged = entry.sets.length
    ? h(
        'ol',
        { class: 'sets' },
        entry.sets.map((s, j) => {
          const k = workIndex(entry.sets, j);
          return h(
            'li',
            { class: `sets__row${s.warmup ? ' is-warmup' : ''}` },
            h('button', {
              class: 'sets__edit',
              type: 'button',
              'aria-label': `Edit ${s.warmup ? 'warm-up set' : `set ${k + 1}`}`,
              onClick: () => openSetEditor({ title: `${s.warmup ? 'Warm-up' : `Set ${k + 1}`} · ${ex.name}`, ex, set: s, onSave: (patch) => { store.editSet(i, j, patch); toast('Set updated'); ctx.rerender(); } }),
            },
              h('span', { class: 'sets__n' }, s.warmup ? 'Warm-up' : `Set ${k + 1}`, s.pr?.length ? h('span', { class: 'tag tag--pr', title: s.pr.join(', ') }, 'PR') : null),
              h('span', { class: 'sets__v mono' }, setLabel(s, ex)),
              h('span', { class: 'sets__t muted small' }, (!s.warmup && vsLast(s, prev?.sets[k], ex)) || fmtClock(s.at)),
            ),
            h('button', {
              class: 'sets__x',
              type: 'button',
              'aria-label': `Delete set ${j + 1}`,
              onClick: () => {
                const removed = store.removeSet(i, j);
                ctx.rerender();
                if (removed) toast('Set deleted', { action: 'Undo', onAction: () => { store.insertSet(i, j, removed); ctx.rerender(); } });
              },
            }, '✕'),
          );
        }),
      )
    : null;

  const form = inputForm(ctx, a, entry, i, ex, sug, d, lastSet);
  const warm = warmupRow(ctx, a, entry, i, ex, sug, st);
  const strip = prev && ex.track !== 'cardio' ? lastTimeStrip(prev, work(entry.sets).length, ex, (set) => {
    if (ex.track === 'time') d.secs = set.secs;
    else {
      d.w = set.w ?? d.w;
      d.reps = set.reps ?? d.reps;
    }
    ctx.rerender();
  }) : null;
  return h('div', { class: 'entry__body' }, head, guide, warm, logged, strip, form, tools);
}

/** Position of a set among the work sets (warm-ups are not numbered). */
function workIndex(sets, j) {
  return sets.slice(0, j).filter((x) => !x.warmup).length;
}

/**
 * Warm-up chips for the first big push/pull/leg lift (spec 14): tap to log
 * one as a warm-up set (short rest, never advances); tap a ticked one to
 * remove it. Off with Setup → "Suggest warm-up sets".
 */
function warmupRow(ctx, a, entry, i, ex, sug, st) {
  if (st.prefs.warmups === false || ex.track !== 'weight' || !sug?.w || !needsWarmup(a.entries, i)) return null;
  const sets = warmupSets(sug.w, ex.step ?? 5);
  if (!sets.length) return null;
  return h(
    'div',
    { class: 'warmup' },
    h('span', { class: 'muted small' }, 'Warm-up'),
    h('div', { class: 'lasttime__pills' }, sets.map((w) => {
      const j = entry.sets.findIndex((x) => x.warmup && Number(x.w) === w.w && Number(x.reps) === w.reps);
      const ticked = j >= 0;
      return h('button', {
        class: `chip chip--btn mono${ticked ? ' chip--on' : ''}`,
        type: 'button',
        'aria-pressed': ticked,
        onClick: () => {
          if (ticked) store.removeSet(i, j);
          else {
            store.logSet(i, { w: w.w, reps: w.reps, warmup: true });
            if (store.getState().prefs.autoRest) store.setRest(45);
          }
          ctx.rerender();
        },
      }, `${ticked ? '✓ ' : ''}${fmtW(w.w)} × ${w.reps}`);
    })),
  );
}

/** "Last time · Mon, Nov 9" and one pill per set; the upcoming set is highlighted; a tap copies it into the steppers. */
function lastTimeStrip(prev, nextIndex, ex, onPick) {
  return h(
    'div',
    { class: 'lasttime' },
    h('span', { class: 'lasttime__label muted small' }, `Last time · ${fmtDate(prev.date, { weekday: 'short', month: 'short', day: 'numeric' })}`),
    h('div', { class: 'lasttime__pills' }, prev.sets.map((set, j) =>
      h('button', {
        class: `chip chip--btn mono${j === nextIndex ? ' chip--on' : ''}`,
        type: 'button',
        'aria-label': `Use set ${j + 1} from last time`,
        onClick: () => onPick(set),
      }, pillText(set, ex)),
    )),
  );
}

function pillText(set, ex) {
  if (ex.track === 'time') return `${set.secs}s`;
  if (ex.track === 'weight') return `${fmtW(set.w)}×${set.reps}`;
  return `${set.reps}`;
}

/** "▲ +1 rep" etc. versus the same-numbered set last time, or null. */
function vsLast(set, prevSet, ex) {
  const c = compareSet(set, prevSet, ex);
  return c && h('span', { class: `vs vs--${c.dir > 0 ? 'up' : c.dir < 0 ? 'down' : 'same'}` }, c.text);
}

function inputForm(ctx, a, entry, i, ex, sug, d, lastSet) {
  const n = work(entry.sets).length + 1;
  const log = (set) => {
    const before = [...entry.sets];
    store.logSet(i, set);
    // A record beaten right now: say so at once, and tag the set.
    const st = store.getState();
    const prs = setRecords(set, ex.id, st.sessions, work(before), store.bw());
    if (prs.length) {
      store.editSet(i, before.length, { pr: prs.map((p) => p.kind) });
      const p = prs.find((x) => x.kind !== 'Estimated 1-rep max') ?? prs[0];
      const unit = p.kind === 'Longest hold' ? ' s' : ' lb';
      toast(`New record — ${p.kind.toLowerCase()}: ${p.value}${unit} (was ${p.was})`);
    }
    const e = store.active().entries[i];
    const finishedEntry = work(e.sets).length >= e.target.sets;
    if (store.getState().prefs.autoRest && ex.track !== 'cardio' && e.target.rest) store.setRest(e.target.rest);
    if (finishedEntry) advance(store.active(), i);
    ctx.rerender();
  };

  if (ex.track === 'cardio') {
    d.minutes ??= entry.target.minutes ? fmtMinutes(entry.target.minutes) : '';
    d.miles ??= entry.target.miles ?? '';
    const fields = setFields(ex, d);
    return h(
      'div',
      { class: 'logform' },
      fields.node,
      h('button', {
        class: 'btn btn--primary btn--block',
        type: 'button',
        onClick: () => {
          const r = fields.read();
          if (r.error) return toast(r.error);
          log(r.set);
        },
      }, entry.sets.length ? 'Log another' : 'Log cardio'),
    );
  }

  if (ex.track === 'time') {
    d.secs ??= lastSet?.secs ?? sug?.secs ?? entry.target.secs?.[0] ?? 30;
    const running = stopwatch?.entry === `${a.id}${i}`;
    return h(
      'div',
      { class: 'logform' },
      h('div', { class: 'logform__inputs' }, stepper('Seconds', d.secs, 5, (v) => (d.secs = v))),
      h('div', { class: 'row' },
        h('button', {
          class: 'btn btn--ghost',
          type: 'button',
          onClick: () => {
            if (running) {
              d.secs = Math.round((Date.now() - stopwatch.startedAt) / 1000);
              stopwatch = null;
            } else stopwatch = { entry: `${a.id}${i}`, startedAt: Date.now() };
            ctx.rerender();
          },
        }, running ? h('span', {}, 'Stop ', h('span', { class: 'mono', 'data-elapsed': stopwatch.startedAt })) : 'Start timer'),
        h('button', {
          class: 'btn btn--primary',
          type: 'button',
          onClick: () => {
            const r = readSet(ex, d);
            if (r.error) return toast(r.error);
            log(r.set);
          },
        }, `Log set ${n}`),
      ),
    );
  }

  const lastWork = work(entry.sets).at(-1);
  d.w ??= lastWork?.w ?? sug?.w ?? '';
  d.reps ??= lastWork?.reps ?? sug?.reps ?? entry.target.reps?.[1] ?? 10;
  const plates = ex.load === 'plates' ? h('button', { class: 'linkish small plates-line', type: 'button', onClick: () => openPlates(ctx) }) : null;
  const drawPlates = () => {
    if (plates) plates.textContent = plateText(d.w, store.getState().prefs.plates ?? PLATES) ?? 'Tap to choose which plates your gym has';
  };
  const fields = setFields(ex, d, { onChange: drawPlates });
  drawPlates();
  return h(
    'div',
    { class: 'logform' },
    fields.node,
    plates,
    h('button', {
      class: 'btn btn--primary btn--block btn--big',
      type: 'button',
      onClick: () => {
        const r = fields.read();
        if (r.error) return toast(r.error);
        log(r.set);
      },
    }, `Log set ${n}${n > entry.target.sets ? ' (extra)' : ''}`),
  );
}

function advance(a, i) {
  const next = a.entries.findIndex((e, j) => j > i && !done(e) && !e.skipped);
  const anyLeft = a.entries.findIndex((e) => !done(e) && !e.skipped);
  const target = next >= 0 ? next : anyLeft;
  if (target >= 0) store.setCurrent(target);
}

async function connectHr(ctx) {
  try {
    const name = await hr.connect();
    toast(`Connected to ${name ?? 'heart rate sensor'}`);
  } catch (err) {
    if (err?.name !== 'NotFoundError') toast(err.message ?? 'Could not connect.');
  }
  ctx.rerender();
}

function finish(ctx) {
  const a = store.active();
  const left = a.entries.filter((e) => !done(e) && !e.skipped && e.sets.length === 0).length;
  if (!a.entries.some((e) => e.sets.length)) {
    if (confirm('Nothing logged yet. Discard this workout?')) {
      store.discardSession();
      ctx.go('today');
    }
    return;
  }
  if (left && !confirm(`${left} exercise${left > 1 ? 's' : ''} not started. Finish anyway?`)) return;

  const st = store.getState();
  const earlier = [...st.sessions];
  const s = store.finishSession();
  const bw = store.bw();
  const sum = sessionSummary(s, bw);
  const prs = newRecords(s, earlier, bw);
  const cmp = comparison(sum.tonnage);
  const hrs = s.hr?.length ? hrSummary(s.hr, maxHr(st.profile)) : null;
  toast('Workout saved');

  modal(
    'Workout done',
    h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, fmtDuration(sum.durationMin)), h('span', { class: 'stat__label' }, 'duration')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(sum.workSets)), h('span', { class: 'stat__label' }, 'sets')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, fmtLb(sum.tonnage)), h('span', { class: 'stat__label' }, 'lb moved')),
      ),
      cmp && h('p', { class: 'muted' }, `That is about ${cmp.text} (approx.).`),
      prs.length > 0 && h('h3', { class: 'eyebrow' }, 'New records'),
      prs.length > 0 && h('ul', { class: 'prs' }, prs.map((p) => h('li', {}, h('strong', {}, exerciseOr(p.ex).name), ` — ${p.kind}: ${p.kind === 'Longest hold' ? `${p.value} s` : `${p.value} lb`} (was ${p.was})`))),
      hrs && h('h3', { class: 'eyebrow' }, 'Heart rate'),
      hrs && h('p', {}, `Average ${hrs.avg} bpm, peak ${hrs.max} bpm.`),
      hrs?.zones && zoneBar(hrs.zones),
      h('h3', { class: 'eyebrow' }, 'How busy was the gym?'),
      crowdChips(s.crowd, (v) => store.updateSession(s.id, { crowd: v ?? undefined })),
      h('p', { class: 'muted small' }, 'Optional. A few ratings build your own quiet-times chart in Stats.'),
      h('p', { class: 'muted small' }, 'Next session the app will suggest weights from what you just did.'),
    ),
  );
  ctx.go('history');
}

/** Tick which plate sizes the gym has (prefs.plates). */
function openPlates(ctx) {
  const have = new Set(store.getState().prefs.plates ?? PLATES);
  modal('Plates at your gym', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'The per-side breakdown only uses the sizes ticked here.'),
    PLATES.map((p) => h('label', { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: have.has(p),
        onChange: (e) => {
          if (e.target.checked) have.add(p);
          else have.delete(p);
          store.setPref('plates', PLATES.filter((x) => have.has(x)));
          ctx.rerender();
        },
      }),
      h('span', {}, `${fmtW(p)} lb`),
    )),
  ));
}
