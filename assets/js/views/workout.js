import { h, modal, toast, fmtSecs, fmtClock } from '../util.js';
import * as store from '../store.js';
import * as hr from '../hr.js';
import { exerciseOr } from '../data/exercises.js';
import { PLAN_BY_ID } from '../data/plans.js';
import {
  suggest, sessionSummary, newRecords, comparison, hrSummary, maxHr, fmtW, fmtLb, fmtDuration, fmtMinutes, fmtPace, parseClock, parseAmount,
} from '../metrics.js';
import { targetText, openSwap, openHowTo, openExercisePicker, pickGym, gymName, exerciseThumb } from './common.js';
import { zoneBar } from '../charts.js';

/** Typed-but-not-logged values, so a re-render does not wipe them. */
const draft = {};
let stopwatch = null; // { entry, startedAt }

export function renderWorkout(ctx) {
  const a = store.active();
  const st = store.getState();
  const bw = st.profile.bodyweight;
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

function done(entry) {
  return entry.sets.length >= entry.target.sets;
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
  return entry.sets.map((s) => `${fmtW(s.w)}×${s.reps}`).join(' · ');
}

function openEntry(ctx, a, entry, i, st) {
  rerenderSoon = () => ctx.rerender();
  const ex = exerciseOr(entry.ex);
  const earlier = st.sessions;
  const sug = suggest(entry.ex, entry.target, earlier, st.profile.bodyweight);
  const note = store.machineNote(entry.ex);
  const d = (draft[a.id + i] ??= {});
  const lastSet = entry.sets[entry.sets.length - 1];

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
              planName: PLAN_BY_ID[a.planId]?.name,
              onPick: (id, { always }) => {
                store.swapExercise(i, id);
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
    { class: `guide${sug?.up ? ' guide--up' : ''}` },
    sug?.text && h('p', { class: 'guide__main' }, sug.up ? '↑ ' : '', ex.track === 'cardio' ? `Target: ${sug.text}` : sug.w == null && ex.track === 'weight' ? sug.text : `Try ${sug.text}`),
    sug?.reason && h('p', { class: 'guide__why' }, sug.reason),
    (note.where || note.settings) && h('p', { class: 'guide__note' }, note.where && `📍 ${note.where}`, note.where && note.settings && ' · ', note.settings && `⚙ ${note.settings}`),
    entry.target.note && h('p', { class: 'guide__note' }, entry.target.note),
  );

  const logged = entry.sets.length
    ? h(
        'ol',
        { class: 'sets' },
        entry.sets.map((s, j) =>
          h(
            'li',
            { class: 'sets__row' },
            h('span', { class: 'sets__n' }, `Set ${j + 1}`),
            h('span', { class: 'sets__v mono' }, setLabel(s, ex)),
            h('span', { class: 'sets__t muted small' }, fmtClock(s.at)),
            h('button', { class: 'sets__x', type: 'button', 'aria-label': `Delete set ${j + 1}`, onClick: () => { store.removeSet(i, j); ctx.rerender(); } }, '✕'),
          ),
        ),
      )
    : null;

  const form = inputForm(ctx, a, entry, i, ex, sug, d, lastSet);
  return h('div', { class: 'entry__body' }, head, guide, logged, form, tools);
}

function setLabel(s, ex) {
  if (ex.track === 'cardio') return [s.miles ? `${s.miles} mi` : null, s.minutes ? fmtMinutes(s.minutes) : null, s.miles && s.minutes ? `${fmtPace(s.minutes / s.miles)}/mi` : null].filter(Boolean).join(' · ');
  if (ex.track === 'time') return `${s.secs} s`;
  if (ex.track === 'bodyweight' || ex.load === 'none') return `${s.reps} reps${s.w ? ` +${fmtW(s.w)} lb` : ''}`;
  const unit = ex.load === 'assist' ? ' assist' : ex.load === 'pair' ? ' ea' : '';
  return `${fmtW(s.w)} lb${unit} × ${s.reps}`;
}

function stepper(label, value, step, onChange, { suffix, decimals, parse = Number, format = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1)), inputMode } = {}) {
  const input = h('input', {
    class: 'stepper__input mono',
    type: 'text',
    inputMode: inputMode ?? (decimals ? 'decimal' : 'numeric'),
    value: value ?? '',
    'aria-label': label,
    onInput: (e) => onChange(e.target.value),
    onFocus: (e) => e.target.select(),
  });
  const bump = (dir) => {
    const current = parse(input.value);
    const n = Math.max(0, (Number.isFinite(current) ? current : 0) + dir * step);
    input.value = format(n);
    onChange(input.value);
  };
  return h(
    'div',
    { class: 'stepper' },
    h('span', { class: 'stepper__label' }, label),
    h('div', { class: 'stepper__ctl' },
      h('button', { class: 'stepper__btn', type: 'button', 'aria-label': `Less ${label}`, onClick: () => bump(-1) }, '−'),
      input,
      h('button', { class: 'stepper__btn', type: 'button', 'aria-label': `More ${label}`, onClick: () => bump(1) }, '+'),
    ),
    suffix && h('span', { class: 'stepper__suffix' }, suffix),
  );
}

function inputForm(ctx, a, entry, i, ex, sug, d, lastSet) {
  const n = entry.sets.length + 1;
  const log = (set) => {
    store.logSet(i, set);
    const e = store.active().entries[i];
    const finishedEntry = e.sets.length >= e.target.sets;
    if (store.getState().prefs.autoRest && ex.track !== 'cardio' && e.target.rest) store.setRest(e.target.rest);
    if (finishedEntry) advance(store.active(), i);
    ctx.rerender();
  };

  if (ex.track === 'cardio') {
    d.minutes ??= entry.target.minutes ? fmtMinutes(entry.target.minutes) : '';
    d.miles ??= entry.target.miles ?? '';
    return h(
      'div',
      { class: 'logform' },
      h('div', { class: 'logform__inputs' },
        stepper('Time (m:ss)', d.minutes, 0.25, (v) => (d.minutes = v), { parse: parseClock, format: fmtMinutes, inputMode: 'text' }),
        stepper('Miles', d.miles, 0.1, (v) => (d.miles = v), { decimals: true }),
      ),
      h('button', {
        class: 'btn btn--primary btn--block',
        type: 'button',
        onClick: () => {
          const minutes = parseClock(d.minutes);
          if (!(minutes > 0)) return toast('Enter the time from the treadmill.');
          const milesText = String(d.miles ?? '').trim();
          let miles = null;
          if (milesText) {
            miles = parseAmount(milesText);
            if (miles === null) return toast('Enter the miles, or leave it blank.');
          }
          log({ minutes, miles });
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
            const secs = parseAmount(d.secs);
            if (secs === null || secs < 1) return toast('Start the timer or enter the seconds.');
            log({ secs });
          },
        }, `Log set ${n}`),
      ),
    );
  }

  const usesWeight = ex.track === 'weight';
  d.w ??= lastSet?.w ?? sug?.w ?? '';
  d.reps ??= lastSet?.reps ?? sug?.reps ?? entry.target.reps?.[1] ?? 10;
  const wLabel = ex.load === 'assist' ? 'Assist lb' : ex.load === 'pair' ? 'lb each' : ex.load === 'plates' ? 'Plates lb' : 'Weight lb';
  return h(
    'div',
    { class: 'logform' },
    h(
      'div',
      { class: 'logform__inputs' },
      usesWeight && stepper(wLabel, d.w, ex.step ?? 5, (v) => (d.w = v), { decimals: true }),
      stepper('Reps', d.reps, 1, (v) => (d.reps = v)),
    ),
    h('button', {
      class: 'btn btn--primary btn--block btn--big',
      type: 'button',
      onClick: () => {
        const reps = parseAmount(d.reps, { integer: true });
        if (reps === null) return toast('How many reps?');
        let w = 0;
        if (usesWeight) {
          w = parseAmount(d.w, { allowZero: true });
          if (w === null) return toast('Enter the weight as a number, e.g. 45 or 47.5');
        }
        if (reps > 200 || w > 1500) return toast('That looks like a typo.');
        log({ w, reps });
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
  const bw = st.profile.bodyweight;
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
      h('p', { class: 'muted small' }, 'Next session the app will suggest weights from what you just did.'),
    ),
  );
  ctx.go('history');
}
