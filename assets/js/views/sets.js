/**
 * The fields for one set — weight + reps, seconds, or time + miles — shared
 * by the workout log form, the "edit this set" sheet and History's editor
 * (spec 12), so all three parse and validate the same way.
 */
import { h, modal } from '../util.js';
import { fmtW, fmtMinutes, fmtPace, parseClock, parseAmount } from '../metrics.js';

export function stepper(label, value, step, onChange, { suffix, decimals, parse = Number, format = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1)), inputMode } = {}) {
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

/** "100 lb × 10", "45 s", "1.2 mi · 12:00 · 10:00/mi". */
export function setLabel(s, ex) {
  if (ex.track === 'cardio') return [s.miles ? `${s.miles} mi` : null, s.minutes ? fmtMinutes(s.minutes) : null, s.miles && s.minutes ? `${fmtPace(s.minutes / s.miles)}/mi` : null].filter(Boolean).join(' · ');
  if (ex.track === 'time') return `${s.secs} s`;
  if (ex.track === 'bodyweight' || ex.load === 'none') return `${s.reps} reps${s.w ? ` +${fmtW(s.w)} lb` : ''}`;
  const unit = ex.load === 'assist' ? ' assist' : ex.load === 'pair' ? ' ea' : '';
  return `${fmtW(s.w)} lb${unit} × ${s.reps}`;
}

export function weightLabel(ex) {
  return ex.load === 'assist' ? 'Assist lb' : ex.load === 'pair' ? 'lb each' : ex.load === 'plates' ? 'Plates lb' : 'Weight lb';
}

/**
 * Pure: turn what was typed into a set, or explain what is wrong.
 * d: { w, reps } | { secs } | { minutes, miles } as strings or numbers.
 * Returns { set } or { error }.
 */
export function readSet(ex, d) {
  if (ex.track === 'cardio') {
    const minutes = parseClock(d.minutes);
    if (!(minutes > 0)) return { error: 'Enter the time from the treadmill.' };
    const milesText = String(d.miles ?? '').trim();
    let miles = null;
    if (milesText) {
      miles = parseAmount(milesText);
      if (miles === null) return { error: 'Enter the miles, or leave it blank.' };
    }
    return { set: { minutes, miles } };
  }
  if (ex.track === 'time') {
    const secs = parseAmount(d.secs);
    if (secs === null || secs < 1) return { error: 'Start the timer or enter the seconds.' };
    return { set: { secs } };
  }
  const reps = parseAmount(d.reps, { integer: true });
  if (reps === null) return { error: 'How many reps?' };
  let w = 0;
  if (ex.track === 'weight') {
    w = parseAmount(d.w, { allowZero: true });
    if (w === null) return { error: 'Enter the weight as a number, e.g. 45 or 47.5' };
  }
  if (reps > 200 || w > 1500) return { error: 'That looks like a typo.' };
  return { set: { w, reps } };
}

/** The draft values to start editing an existing set from. */
export function draftFrom(set, ex) {
  if (ex.track === 'cardio') return { minutes: set.minutes ? fmtMinutes(set.minutes) : '', miles: set.miles ?? '' };
  if (ex.track === 'time') return { secs: set.secs ?? '' };
  return { w: set.w ?? '', reps: set.reps ?? '' };
}

/**
 * The steppers for one set. `d` is a draft object the fields write into as
 * you type (so a re-render does not lose it). Returns { node, read } where
 * read() is readSet(ex, d).
 */
export function setFields(ex, d) {
  let node;
  if (ex.track === 'cardio') {
    node = h('div', { class: 'logform__inputs' },
      stepper('Time (m:ss)', d.minutes, 0.25, (v) => (d.minutes = v), { parse: parseClock, format: fmtMinutes, inputMode: 'text' }),
      stepper('Miles', d.miles, 0.1, (v) => (d.miles = v), { decimals: true }),
    );
  } else if (ex.track === 'time') {
    node = h('div', { class: 'logform__inputs' }, stepper('Seconds', d.secs, 5, (v) => (d.secs = v)));
  } else {
    node = h('div', { class: 'logform__inputs' },
      ex.track === 'weight' && stepper(weightLabel(ex), d.w, ex.step ?? 5, (v) => (d.w = v), { decimals: true }),
      stepper('Reps', d.reps, 1, (v) => (d.reps = v)),
    );
  }
  return { node, read: () => readSet(ex, d) };
}

/**
 * "Set 2 · Chest press machine": the same steppers, Save and Cancel.
 * onSave(patch) gets the parsed values; the set's time (`at`) is left alone.
 */
export function openSetEditor({ title, ex, set, onSave }) {
  const d = draftFrom(set, ex);
  const fields = setFields(ex, d);
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const dialog = modal(
    title,
    h(
      'div',
      { class: 'stack' },
      fields.node,
      error,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => dialog.close() }, 'Cancel'),
        h('button', {
          class: 'btn btn--primary',
          type: 'button',
          onClick: () => {
            const r = fields.read();
            if (r.error) {
              error.textContent = r.error;
              error.hidden = false;
              return;
            }
            dialog.close();
            onSave(r.set);
          },
        }, 'Save'),
      ),
    ),
  );
  return dialog;
}
