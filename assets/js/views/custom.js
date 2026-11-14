/**
 * Your own exercises and the plan editor (spec 15).
 *
 * - openExerciseForm(): add or edit one of your exercises (Machines → + Add
 *   your own, a custom machine page's Edit, and the identify flow when Claude
 *   finds a machine that is not in the library).
 * - plansCard(): Setup → Plans — edit sets/reps/rest/order of any plan, make
 *   new ones, assign them to weekdays, with a live sets-per-muscle summary.
 */
import { h, modal, toast } from '../util.js';
import * as store from '../store.js';
import { allExercises, exerciseOr, MUSCLES, MUSCLE_ORDER } from '../data/exercises.js';
import { WEEK } from '../data/plans.js';
import { weekSchedule, plannedMuscleSets, defaultPlanItem, isBuiltInPlan } from '../routines.js';
import { estimateMinutes } from '../metrics.js';
import { hbars } from '../charts.js';
import { openExercisePicker, targetText } from './common.js';

// ── Your own exercises ───────────────────────────────────────────────────

export const TYPES = [
  ['stack', 'Machine/cable (weight stack)', { track: 'weight', load: 'stack' }],
  ['plates', 'Plate-loaded', { track: 'weight', load: 'plates' }],
  ['pair', 'Dumbbells (pair)', { track: 'weight', load: 'pair' }],
  ['single', 'Single dumbbell/kettlebell', { track: 'weight', load: 'single' }],
  ['body', 'Bodyweight', { track: 'bodyweight', load: 'body' }],
  ['time', 'Timed hold', { track: 'time', load: 'none' }],
  ['cardio', 'Cardio', { track: 'cardio', load: 'none' }],
];
const PATTERNS = [['push', 'Push'], ['pull', 'Pull'], ['legs', 'Legs'], ['core', 'Core'], ['cardio', 'Cardio']];

function typeOf(ex) {
  if (!ex) return 'stack';
  if (ex.track === 'cardio') return 'cardio';
  if (ex.track === 'time') return 'time';
  if (ex.track === 'bodyweight') return 'body';
  return TYPES.find(([, , v]) => v.load === ex.load)?.[0] ?? 'stack';
}

/** Single-choice chip row. */
function chipChoice(options, value, onChange) {
  const row = h('div', { class: 'row row--wrap' });
  let current = value;
  const draw = () =>
    row.replaceChildren(
      ...options.map(([id, label]) =>
        h('button', { class: `chip chip--btn${id === current ? ' chip--on' : ''}`, type: 'button', 'aria-pressed': id === current, onClick: () => { current = id; draw(); onChange(id); } }, label),
      ),
    );
  draw();
  return row;
}

/** Multi-choice chip row over a Set. */
function chipMulti(options, set, onChange) {
  const row = h('div', { class: 'row row--wrap' });
  const draw = () =>
    row.replaceChildren(
      ...options.map(([id, label]) =>
        h('button', {
          class: `chip chip--btn${set.has(id) ? ' chip--on' : ''}`,
          type: 'button',
          'aria-pressed': set.has(id),
          onClick: () => {
            if (set.has(id)) set.delete(id);
            else set.add(id);
            draw();
            onChange?.();
          },
        }, label),
      ),
    );
  draw();
  return row;
}

const lines = (text) => String(text ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

/**
 * Add (no `id`) or edit one of your exercises. `initial` pre-fills the form
 * (e.g. from Claude's identify answer). onSaved(exercise) after saving.
 */
export function openExerciseForm({ id = null, initial = {}, onSaved } = {}) {
  const existing = id ? exerciseOr(id) : null;
  const base = existing ?? initial;
  let type = typeOf(base.track ? base : null);
  let pattern = base.pattern ?? 'push';
  let step = base.step === 10 ? 10 : 5;
  const primary = new Set(base.muscles?.primary ?? []);
  const secondary = new Set(base.muscles?.secondary ?? []);
  const alts = [...(base.alts ?? [])];

  const name = h('input', { class: 'input', value: base.name ?? '', placeholder: 'e.g. Glute kickback machine' });
  const look = h('textarea', { class: 'input', rows: 2, value: base.look ?? '', placeholder: 'What it looks like, so you can find it again' });
  const setup = h('textarea', { class: 'input', rows: 3, value: (base.setup ?? []).join('\n'), placeholder: 'One step per line' });
  const cues = h('textarea', { class: 'input', rows: 3, value: (base.cues ?? []).join('\n'), placeholder: 'One cue per line' });
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const altList = h('div', { class: 'row row--wrap' });
  const drawAlts = () =>
    altList.replaceChildren(
      ...alts.map((a, i) => h('button', { class: 'chip chip--btn', type: 'button', title: 'Remove', onClick: () => { alts.splice(i, 1); drawAlts(); } }, `${exerciseOr(a).name} ✕`)),
      h('button', { class: 'chip chip--btn', type: 'button', onClick: () => openExercisePicker({ title: 'A good swap for it', onPick: (exId) => { if (!alts.includes(exId) && exId !== id) alts.push(exId); drawAlts(); } }) }, '+ swap'),
    );
  drawAlts();

  const muscleOpts = MUSCLE_ORDER.map((m) => [m, MUSCLES[m]]);
  const stepRow = h('div', {}, chipChoice([[5, '5 lb'], [10, '10 lb']], step, (v) => (step = v)));
  const stepField = h('div', { class: 'field' }, h('span', {}, 'Weight step'), stepRow);
  const showStep = () => (stepField.hidden = !['stack', 'plates', 'pair', 'single'].includes(type));
  showStep();

  const save = () => {
    const n = name.value.trim();
    const fail = (msg) => {
      error.textContent = msg;
      error.hidden = false;
    };
    if (!n) return fail('Give it a name.');
    if (store.exerciseNameTaken(n, id, allExercises())) return fail('There is already an exercise with that name.');
    const t = TYPES.find(([k]) => k === type)[2];
    if (t.track !== 'cardio' && !primary.size) return fail('Pick at least one main muscle.');
    const data = {
      name: n,
      ...t,
      pattern: t.track === 'cardio' ? 'cardio' : pattern,
      step,
      muscles: { primary: [...primary], secondary: [...secondary].filter((m) => !primary.has(m)) },
      look: look.value.trim(),
      setup: lines(setup.value),
      cues: lines(cues.value),
      alts,
    };
    let saved;
    if (id) {
      store.updateCustomExercise(id, data);
      saved = exerciseOr(id);
    } else saved = store.addCustomExercise(data);
    dialog.close();
    toast(id ? 'Saved' : `Added ${saved.name}`);
    onSaved?.(saved);
  };

  const dialog = modal(
    id ? `Edit ${existing.name}` : 'Add your own exercise',
    h(
      'div',
      { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('div', { class: 'field' }, h('span', {}, 'Type'), chipChoice(TYPES.map(([k, l]) => [k, l]), type, (v) => { type = v; showStep(); })),
      h('div', { class: 'field' }, h('span', {}, 'Movement'), chipChoice(PATTERNS, pattern, (v) => (pattern = v))),
      h('div', { class: 'field' }, h('span', {}, 'Main muscles'), chipMulti(muscleOpts, primary)),
      h('div', { class: 'field' }, h('span', {}, 'Helping muscles (optional)'), chipMulti(muscleOpts, secondary)),
      stepField,
      h('label', { class: 'field' }, h('span', {}, 'What it looks like (optional)'), look),
      h('label', { class: 'field' }, h('span', {}, 'Set-up steps (optional)'), setup),
      h('label', { class: 'field' }, h('span', {}, 'Form cues (optional)'), cues),
      h('div', { class: 'field' }, h('span', {}, 'Swaps if it is taken (optional)'), altList),
      error,
      h('button', { class: 'btn btn--primary btn--block', type: 'button', onClick: save }, id ? 'Save' : 'Add exercise'),
    ),
  );
  return dialog;
}

// ── Plans ────────────────────────────────────────────────────────────────

const DAY_NAMES = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 0: 'Sunday' };

/** The plans that make up a week right now (for the sets-per-muscle summary). */
function scheduledPlans(st) {
  if (!st.schedule && st.prefs.mode === '3day') return ['full-a', 'full-b', 'full-a'].map((id) => store.getPlan(id));
  return weekSchedule(st).filter((d) => d.plan).map((d) => store.getPlan(d.plan)).filter(Boolean);
}

function muscleSummary(st) {
  const sets = plannedMuscleSets(scheduledPlans(st));
  const items = MUSCLE_ORDER.map((m) => ({ label: MUSCLES[m], value: Math.round(sets[m] * 10) / 10 }));
  return h('div', { class: 'stack' },
    h('h3', { class: 'eyebrow' }, 'Weekly sets per muscle on this schedule'),
    hbars(items, { target: 10, fmt: (v) => String(v) }),
    h('p', { class: 'muted small' }, 'If every scheduled workout is done in full. Main muscles count 1 per set, helping muscles ½. Aim for the 10-set line.'),
  );
}

/** Weekdays a plan is on, e.g. "Mon, Thu". */
function daysFor(st, planId) {
  if (!st.schedule && st.prefs.mode === '3day') return planId.startsWith('full') ? 'alternating Mon/Wed/Fri' : '';
  return weekSchedule(st).filter((d) => d.plan === planId).map((d) => d.label).join(', ');
}

/** Setup → Plans. */
export function plansCard(st, ctx) {
  const rows = store.allPlans().filter((p) => (st.schedule || !p.builtIn ? true : st.prefs.mode === '3day' ? p.threeDay : !p.threeDay));
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Plans'),
    h('p', { class: 'muted small' }, 'Change sets, reps, rest and order, add or remove exercises, or make your own plans. Past workouts never change.'),
    h('div', { class: 'mlist' }, rows.map((p) =>
      h('button', { class: 'srow', type: 'button', onClick: () => openPlanEditor(p.id, ctx) },
        h('span', { class: 'srow__main' },
          h('span', { class: 'srow__name' }, p.name, p.edited && h('span', { class: 'tag' }, 'edited'), !p.builtIn && h('span', { class: 'tag' }, 'yours')),
          h('span', { class: 'muted small' }, [daysFor(st, p.id) || 'Not scheduled', `${p.items.length} exercises`, `~${Math.round(estimateMinutes(p.items))} min`].join(' · ')),
        ),
      ),
    )),
    h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => openNewPlan(ctx) }, '+ New plan'),
    h('h3', { class: 'eyebrow' }, 'Weekly schedule'),
    scheduleEditor(st, ctx),
    muscleSummary(st),
  );
}

function scheduleEditor(st, ctx) {
  const week = st.schedule || st.prefs.mode !== '3day' ? weekSchedule(st) : WEEK.map((d) => ({ ...d, plan: null }));
  const current = Object.fromEntries(weekSchedule(st).map((d) => [d.day, d.plan]));
  const plans = store.allPlans();
  return h('div', { class: 'stack' },
    st.prefs.mode === '3day' && !st.schedule && h('p', { class: 'muted small' }, 'The 3-day plan alternates Full A and Full B on Mon/Wed/Fri. Picking plans for days below switches to a custom schedule.'),
    h('div', { class: 'sched' }, week.map((d) =>
      h('label', { class: 'sched__row' },
        h('span', {}, DAY_NAMES[d.day]),
        h('select', {
          class: 'input',
          onChange: (e) => {
            store.setScheduleDay(d.day, e.target.value || null, st.prefs.mode === '3day' ? {} : current);
            ctx.rerender();
          },
        },
          h('option', { value: '', selected: !d.plan }, 'Rest'),
          plans.map((p) => h('option', { value: p.id, selected: p.id === d.plan }, p.name)),
        ),
      ),
    )),
    st.schedule && h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => { store.setSchedule(null); toast('Back to the built-in week'); ctx.rerender(); } }, 'Reset to the built-in week'),
  );
}

function openNewPlan(ctx) {
  const name = h('input', { class: 'input', placeholder: 'e.g. Push day' });
  const from = h('select', { class: 'input' }, h('option', { value: '' }, 'Start empty'), store.allPlans().map((p) => h('option', { value: p.id }, `Copy of ${p.name}`)));
  const dialog = modal('New plan', h('div', { class: 'stack' },
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('label', { class: 'field' }, h('span', {}, 'Start from'), from),
    h('button', {
      class: 'btn btn--primary btn--block',
      type: 'button',
      onClick: () => {
        const src = from.value || null;
        const n = name.value.trim() || (src ? `Copy of ${store.getPlan(src).name}` : 'My plan');
        const id = store.createPlan(n, src);
        dialog.close();
        ctx.rerender();
        openPlanEditor(id, ctx);
      },
    }, 'Create'),
  ));
}

function itemText(it) {
  const ex = exerciseOr(it.ex);
  return `${targetText(it, ex)}${ex.track !== 'cardio' && it.rest ? ` · rest ${it.rest}s` : ''}`;
}

/** The plan editor: name, items in order (edit / ↑ / ↓ / remove), add, reset or delete. */
export function openPlanEditor(planId, ctx) {
  const body = h('div', { class: 'stack' });
  const dialog = modal('Edit plan', body, { wide: true });
  dialog.addEventListener('close', () => ctx.rerender());
  const edit = (fn) => {
    store.editPlan(planId, fn);
    draw();
  };
  const draw = () => {
    const p = store.getPlan(planId);
    if (!p) {
      dialog.close();
      return;
    }
    const st = store.getState();
    const items = st.customPlans?.[planId] ? p.items : store.planItems(planId, null);
    const name = h('input', { class: 'input', value: p.name, onChange: (e) => edit((x) => { x.name = e.target.value.trim() || x.name; }) });
    body.replaceChildren(
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('ol', { class: 'plan-items' }, items.map((it, i) =>
        h('li', { class: 'plan-item' },
          h('button', { class: 'plan-item__main', type: 'button', onClick: () => openItemEditor(it, (next) => edit((x) => { x.items[i] = next; })) },
            h('strong', {}, exerciseOr(it.ex).name),
            h('span', { class: 'muted small mono' }, itemText(it)),
          ),
          h('div', { class: 'plan-item__tools' },
            h('button', { class: 'btn btn--small btn--ghost', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onClick: () => edit((x) => { [x.items[i - 1], x.items[i]] = [x.items[i], x.items[i - 1]]; }) }, '↑'),
            h('button', { class: 'btn btn--small btn--ghost', type: 'button', 'aria-label': 'Move down', disabled: i === items.length - 1, onClick: () => edit((x) => { [x.items[i + 1], x.items[i]] = [x.items[i], x.items[i + 1]]; }) }, '↓'),
            h('button', { class: 'btn btn--small btn--danger-ghost', type: 'button', onClick: () => edit((x) => { x.items.splice(i, 1); }) }, 'Remove'),
          ),
        ),
      )),
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => openExercisePicker({ onPick: (exId) => { const it = defaultPlanItem(exId); if (it) edit((x) => { x.items.push(it); }); } }) }, '+ Add exercise'),
      h('p', { class: 'muted small' }, `About ${Math.round(estimateMinutes(items))} minutes.`),
      isBuiltInPlan(planId)
        ? st.customPlans?.[planId] && h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => { if (confirm(`Put ${p.name} back the way it came?`)) { store.resetPlan(planId); draw(); } } }, 'Reset to default')
        : h('button', { class: 'btn btn--danger-ghost btn--small', type: 'button', onClick: () => { if (confirm(`Delete ${p.name}? Past workouts keep their sets.`)) { store.deletePlan(planId); dialog.close(); } } }, 'Delete plan'),
      muscleSummary(st),
    );
  };
  draw();
}

/** Sets, reps/seconds/minutes/miles, rest and note for one plan item. */
function openItemEditor(item, onSave) {
  const ex = exerciseOr(item.ex);
  const num = (label, value, attrs = {}) => {
    const input = h('input', { class: 'input', type: 'number', inputMode: 'decimal', value: value ?? '', ...attrs });
    return [input, h('label', { class: 'field' }, h('span', {}, label), input)];
  };
  const [sets, setsF] = num('Sets', item.sets ?? 3, { min: 1, max: 8, step: 1 });
  let a;
  let b;
  let rangeF;
  if (ex.track === 'cardio') {
    const [m, mF] = num('Minutes (optional)', item.minutes ?? '', { min: 1, max: 120 });
    const [mi, miF] = num('Miles (optional)', item.miles ?? '', { min: 0.1, max: 30, step: 0.1 });
    a = m;
    b = mi;
    rangeF = h('div', { class: 'row row--wrap' }, mF, miF);
  } else {
    const r = ex.track === 'time' ? item.secs ?? [30, 60] : item.reps ?? [8, 12];
    const unit = ex.track === 'time' ? 'seconds' : 'reps';
    const [lo, loF] = num(`Fewest ${unit}`, r[0], { min: 1, max: 600, step: 1 });
    const [hi, hiF] = num(`Most ${unit}`, r[1], { min: 1, max: 600, step: 1 });
    a = lo;
    b = hi;
    rangeF = h('div', { class: 'row row--wrap' }, loF, hiF);
  }
  const rest = h('select', { class: 'input' }, Array.from({ length: 19 }, (_, i) => 30 + i * 15).map((s) => h('option', { value: s, selected: s === (item.rest ?? 90) }, `${s} s`)));
  const note = h('input', { class: 'input', value: item.note ?? '', placeholder: 'Optional, shown in the workout' });
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const dialog = modal(ex.name, h('div', { class: 'stack' },
    setsF,
    rangeF,
    ex.track !== 'cardio' && h('label', { class: 'field' }, h('span', {}, 'Rest'), rest),
    h('label', { class: 'field' }, h('span', {}, 'Note'), note),
    error,
    h('button', {
      class: 'btn btn--primary btn--block',
      type: 'button',
      onClick: () => {
        const r = readItem(ex, { sets: sets.value, a: a.value, b: b.value, rest: rest.value, note: note.value });
        if (r.error) {
          error.textContent = r.error;
          error.hidden = false;
          return;
        }
        dialog.close();
        onSave({ ex: item.ex, ...r.item });
      },
    }, 'Save'),
  ));
}

/** Pure: the item editor's fields → { item } or { error }. */
export function readItem(ex, { sets, a, b, rest, note }) {
  const n = Number(sets);
  if (!Number.isInteger(n) || n < 1 || n > 8) return { error: 'Sets must be a whole number from 1 to 8.' };
  const out = { sets: n };
  if (ex.track === 'cardio') {
    const minutes = a === '' ? null : Number(a);
    const miles = b === '' ? null : Number(b);
    if (minutes == null && miles == null) return { error: 'Give a time or a distance.' };
    if ((minutes != null && !(minutes > 0)) || (miles != null && !(miles > 0))) return { error: 'Time and distance must be above zero.' };
    if (minutes != null) out.minutes = minutes;
    if (miles != null) out.miles = miles;
  } else {
    const lo = Number(a);
    const hi = Number(b);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi < lo) return { error: 'The range needs two whole numbers, the first no bigger than the second.' };
    out[ex.track === 'time' ? 'secs' : 'reps'] = [lo, hi];
    const r = Number(rest);
    out.rest = Number.isFinite(r) ? Math.min(300, Math.max(30, Math.round(r / 15) * 15)) : 90;
  }
  if (String(note ?? '').trim()) out.note = String(note).trim();
  return { item: out };
}
