import { h, modal, toast, fmtDate, fmtClock } from '../util.js';
import * as store from '../store.js';
import { exerciseOr } from '../data/exercises.js';
import { sessionSummary, hrSummary, maxHr, weekStart, fmtLb, fmtDuration, fmtW, fmtMinutes, fmtPace } from '../metrics.js';
import { watchForSession } from '../samsung.js';
import { zoneBar } from '../charts.js';
import { empty, pickGym, gymName, crowdChips, openExercisePicker } from './common.js';
import { PLANS } from '../data/plans.js';
import { setLabel, openSetEditor } from './sets.js';

export function renderHistory(ctx) {
  const st = store.getState();
  const bw = st.profile.bodyweight;
  if (!st.sessions.length) {
    return h('div', { class: 'page' }, h('div', { class: 'page__head' }, h('h1', {}, 'History')), empty('Nothing logged yet', 'Finished workouts appear here with every set, the gym, and heart rate if your watch was connected or imported.', logPastButton(ctx)));
  }
  const groups = new Map();
  for (const s of [...st.sessions].reverse()) {
    const w = weekStart(s.startedAt);
    if (!groups.has(w)) groups.set(w, []);
    groups.get(w).push(s);
  }
  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page__head row row--wrap' }, h('h1', {}, 'History'), logPastButton(ctx)),
    [...groups.entries()].map(([w, list]) => {
      const ton = list.reduce((a, s) => a + sessionSummary(s, bw).tonnage, 0);
      return h(
        'section',
        { class: 'hgroup' },
        h('h2', { class: 'hgroup__title' }, `Week of ${fmtDate(w, { month: 'short', day: 'numeric' })}`, h('span', { class: 'muted small' }, ` · ${list.length} workout${list.length > 1 ? 's' : ''} · ${fmtLb(ton)} lb`)),
        h('div', { class: 'mlist' }, list.map((s) => sessionRow(s, st, ctx))),
      );
    }),
  );
}

function sessionRow(s, st, ctx) {
  const sum = sessionSummary(s, st.profile.bodyweight);
  const wd = watchForSession(s, st.watch);
  const hs = wd.samples ? hrSummary(wd.samples, null) : null;
  const g = s.gymId && store.gym(s.gymId);
  return h(
    'button',
    { class: 'srow', type: 'button', onClick: () => openSession(s.id, ctx) },
    h('span', { class: 'srow__date' }, h('strong', {}, fmtDate(s.startedAt, { weekday: 'short' })), h('span', {}, fmtDate(s.startedAt, { month: 'numeric', day: 'numeric' }))),
    h('span', { class: 'srow__main' },
      h('span', { class: 'srow__name' }, s.name, s.manual && h('span', { class: 'tag tag--manual' }, 'added later')),
      h('span', { class: 'muted small' }, `${fmtDuration(sum.durationMin)} · ${sum.workSets} sets · ${fmtLb(sum.tonnage)} lb${g ? ` · ${g.name}` : ''}`),
    ),
    (hs || wd.workout?.avgHr) && h('span', { class: 'srow__hr mono' }, `♥ ${hs?.avg ?? Math.round(wd.workout.avgHr)}`),
  );
}

/**
 * The session sheet. Read mode shows the workout; Edit switches the same
 * sheet into edit mode (spec 12), where changes save as they are made.
 * `placeholders` are exercise ids listed for a manual session that have no
 * sets yet: they are only shown, never stored, until a set is added.
 */
function openSession(id, ctx, { editing = false, placeholders = [] } = {}) {
  const body = h('div', { class: 'stack' });
  const dialog = modal('', body);
  const titleEl = dialog.querySelector('.modal__title');
  let mode = editing;
  let waiting = [...placeholders];
  const redraw = () => {
    const s = store.getSession(id);
    if (!s) {
      dialog.close();
      return;
    }
    titleEl.textContent = `${s.name} · ${fmtDate(s.startedAt)}`;
    // h() flattens children, replaceChildren() does not: wrap the parts in h() first.
    body.replaceChildren(...h('div', {}, mode ? editView(s) : readView(s)).childNodes);
  };
  dialog.addEventListener('close', () => {
    const s = store.getSession(id);
    // A workout added by hand and left empty is not kept.
    if (s?.manual && !s.entries.length) {
      store.deleteSession(id);
      toast('Nothing was logged, so that workout was not saved.');
    }
    ctx.rerender();
  });

  /** Delete with Undo: put the whole session back as it was. */
  const undoable = (message, before) => toast(message, { action: 'Undo', onAction: () => { store.restoreSession(before); ctx.rerender(); if (dialog.open) redraw(); } });
  const snapshot = () => JSON.parse(JSON.stringify(store.getSession(id)));

  function readView(s) {
    const st = store.getState();
    const bw = st.profile.bodyweight;
    const sum = sessionSummary(s, bw);
    const wd = watchForSession(s, st.watch);
    const hs = wd.samples ? hrSummary(wd.samples, maxHr(st.profile)) : null;
    const gymLabel = () => (s.gymId && store.gym(s.gymId) ? `📍 ${gymName(s.gymId)}` : s.gymId ? '📍 Removed gym' : st.gyms.length ? '📍 No gym' : '');
    const gymBtn = st.gyms.length
      ? h('button', {
          class: 'linkish small',
          type: 'button',
          onClick: async () => {
            const next = await pickGym({ title: 'Where was this?', current: s.gymId ?? null });
            if (next === undefined || next === s.gymId) return;
            store.updateSession(s.id, { gymId: next });
            redraw();
          },
        }, `${gymLabel()} ▾`)
      : null;
    return [
      h('p', { class: 'muted small' }, `${fmtClock(s.startedAt)}–${fmtClock(s.endedAt)}`, gymBtn ? [' · ', gymBtn] : s.geo ? ' · location saved' : '', s.manual ? ' · added later' : ''),
      h('div', { class: 'row row--wrap' }, h('span', { class: 'muted small' }, 'How busy:'), crowdChips(s.crowd, (v) => store.updateSession(s.id, { crowd: v ?? undefined }))),
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, fmtDuration(sum.durationMin)), h('span', { class: 'stat__label' }, 'duration')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, String(sum.workSets)), h('span', { class: 'stat__label' }, 'sets')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, fmtLb(sum.tonnage)), h('span', { class: 'stat__label' }, 'lb moved')),
        sum.avgRestSec && h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, `${Math.round(sum.avgRestSec)} s`), h('span', { class: 'stat__label' }, 'avg rest')),
      ),
      h('ol', { class: 'detail' }, s.entries.map((e) => {
        const ex = exerciseOr(e.ex);
        return h('li', {},
          h('button', { class: 'linkish', type: 'button', onClick: () => { dialog.close(); ctx.go(`machine/${e.ex}`); } }, ex.name),
          e.plannedEx && e.plannedEx !== e.ex && h('span', { class: 'muted small' }, ` (instead of ${exerciseOr(e.plannedEx).name})`),
          h('div', { class: 'mono small' }, e.sets.map((x) => `${setText(x, ex)}${x.pr?.length ? ' (PR)' : ''}`).join(' · ')),
        );
      })),
      (hs || wd.workout) && h('h3', { class: 'eyebrow' }, `Heart rate · ${wd.source === 'live' ? 'live Bluetooth' : 'Samsung Health'}`),
      hs && h('p', {}, `Average ${hs.avg} bpm, peak ${hs.max} bpm.`),
      !hs && wd.workout?.avgHr && h('p', {}, `Average ${Math.round(wd.workout.avgHr)} bpm, peak ${Math.round(wd.workout.maxHr)} bpm.`),
      hs?.zones && zoneBar(hs.zones),
      wd.workout && h('p', { class: 'muted small' }, `Watch workout: ${wd.workout.typeName}, ${Math.round(wd.workout.durationMs / 60000)} min${wd.workout.kcal ? `, ${Math.round(wd.workout.kcal)} kcal` : ''}.`),
      s.notes && h('p', { class: 'note' }, s.notes),
      h('div', { class: 'row row--wrap' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => { mode = true; redraw(); } }, 'Edit'),
        h('button', {
          class: 'btn btn--danger-ghost',
          type: 'button',
          onClick: () => {
            if (!confirm('Delete this workout? Its sets will drop out of every stat.')) return;
            const before = snapshot();
            store.deleteSession(s.id);
            dialog.close();
            undoable('Workout deleted', before);
          },
        }, 'Delete workout'),
      ),
    ];
  }

  function editView(s) {
    const st = store.getState();
    const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
    const date = h('input', { class: 'input', type: 'date', value: toDateInput(s.startedAt), max: toDateInput(Date.now()) });
    const time = h('input', { class: 'input', type: 'time', value: toTimeInput(s.startedAt) });
    const mins = h('input', { class: 'input', type: 'number', inputMode: 'numeric', min: 1, max: 600, value: Math.max(1, Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 60000)) });
    const saveWhen = () => {
      const r = readWhen(date.value, time.value, mins.value);
      error.hidden = !r.error;
      error.textContent = r.error ?? '';
      if (r.error) return;
      store.updateSession(s.id, { startedAt: r.startedAt, endedAt: r.endedAt });
      titleEl.textContent = `${s.name} · ${fmtDate(r.startedAt)}`;
    };
    for (const el of [date, time, mins]) el.addEventListener('change', saveWhen);

    const gym = st.gyms.length
      ? h('select', {
          class: 'input',
          onChange: (e) => store.updateSession(s.id, { gymId: e.target.value || null }),
        },
          h('option', { value: '', selected: !s.gymId }, 'No gym'),
          st.gyms.map((g) => h('option', { value: g.id, selected: g.id === s.gymId }, g.name)),
          s.gymId && !store.gym(s.gymId) && h('option', { value: s.gymId, selected: true }, 'Removed gym'),
        )
      : null;
    const notes = h('textarea', { class: 'input', rows: 2, placeholder: 'How did it go?', value: s.notes ?? '', onChange: (e) => store.updateSession(s.id, { notes: e.target.value.trim() || undefined }) });

    const entryBlock = (e, ei) => {
      const ex = exerciseOr(e.ex);
      return h('div', { class: 'edit-entry' },
        h('div', { class: 'edit-entry__head' },
          h('strong', {}, ex.name),
          h('button', {
            class: 'linkish small',
            type: 'button',
            onClick: () => {
              const before = snapshot();
              store.removeSessionEntry(s.id, ei);
              redraw();
              undoable(`${ex.name} removed`, before);
            },
          }, 'Remove exercise'),
        ),
        h('ul', { class: 'sets' }, e.sets.map((set, j) =>
          h('li', { class: 'sets__row' },
            h('button', {
              class: 'sets__edit',
              type: 'button',
              'aria-label': `Edit set ${j + 1}`,
              onClick: () => openSetEditor({ title: `Set ${j + 1} · ${ex.name}`, ex, set, onSave: (patch) => { store.editSessionSet(s.id, ei, j, patch); redraw(); } }),
            },
              h('span', { class: 'sets__n' }, `Set ${j + 1}`, set.pr?.length ? h('span', { class: 'tag tag--pr' }, 'PR') : null),
              h('span', { class: 'sets__v mono' }, setLabel(set, ex)),
              h('span', { class: 'sets__t muted small' }, set.at ? fmtClock(set.at) : ''),
            ),
            h('button', {
              class: 'sets__x',
              type: 'button',
              'aria-label': `Delete set ${j + 1}`,
              onClick: () => {
                if (s.entries.length === 1 && e.sets.length === 1 && !confirm('This is the only set left. Delete the whole workout?')) return;
                const before = snapshot();
                const removed = store.removeSessionSet(s.id, ei, j);
                if (!removed) return;
                if (removed.session) {
                  // That was the last set: the workout itself is gone.
                  dialog.close();
                  undoable('Workout deleted (its last set was removed)', before);
                  return;
                }
                redraw();
                undoable(removed.entry ? `${ex.name} removed` : 'Set deleted', before);
              },
            }, '✕'),
          ),
        )),
        h('button', {
          class: 'btn btn--small btn--ghost',
          type: 'button',
          onClick: () => {
            const last = e.sets[e.sets.length - 1] ?? {};
            openSetEditor({ title: `Set ${e.sets.length + 1} · ${ex.name}`, ex, set: last, onSave: (set) => { store.addSessionSet(s.id, ei, set); redraw(); } });
          },
        }, '+ set'),
      );
    };

    const placeholderBlock = (exId) => {
      const ex = exerciseOr(exId);
      return h('div', { class: 'edit-entry is-placeholder' },
        h('div', { class: 'edit-entry__head' },
          h('span', {}, ex.name, h('span', { class: 'muted small' }, ' · nothing logged')),
          h('button', { class: 'linkish small', type: 'button', onClick: () => { waiting = waiting.filter((x) => x !== exId); redraw(); } }, 'Remove'),
        ),
        h('button', {
          class: 'btn btn--small btn--ghost',
          type: 'button',
          onClick: () =>
            openSetEditor({
              title: `Set 1 · ${ex.name}`,
              ex,
              set: {},
              onSave: (set) => {
                const ei = store.addSessionEntry(s.id, exId);
                if (ei >= 0) store.addSessionSet(s.id, ei, set);
                waiting = waiting.filter((x) => x !== exId);
                redraw();
              },
            }),
        }, '+ set'),
      );
    };

    return [
      h('p', { class: 'muted small' }, 'Changes save as you make them. Stats, records and suggestions update straight away.'),
      h('div', { class: 'row row--wrap' },
        h('label', { class: 'field' }, h('span', {}, 'Date'), date),
        h('label', { class: 'field' }, h('span', {}, 'Start'), time),
        h('label', { class: 'field' }, h('span', {}, 'Minutes'), mins),
      ),
      error,
      gym && h('label', { class: 'field' }, h('span', {}, 'Gym'), gym),
      h('label', { class: 'field' }, h('span', {}, 'Notes'), notes),
      h('h3', { class: 'eyebrow' }, 'Exercises'),
      s.entries.map(entryBlock),
      waiting.map(placeholderBlock),
      h('button', {
        class: 'btn btn--ghost',
        type: 'button',
        onClick: () => openExercisePicker({ onPick: (exId) => { if (!waiting.includes(exId)) waiting.push(exId); redraw(); } }),
      }, '+ Add exercise'),
      h('button', { class: 'btn btn--primary btn--block', type: 'button', onClick: () => { if (s.manual && !s.entries.length) { dialog.close(); return; } mode = false; waiting = []; redraw(); } }, 'Done'),
    ];
  }

  redraw();
  return dialog;
}

// ── Log a past workout ───────────────────────────────────────────────────

function logPastButton(ctx) {
  return h('button', { class: 'btn btn--small', type: 'button', onClick: () => openLogPast(ctx) }, '+ Log a past workout');
}

function openLogPast(ctx) {
  const yesterday = Date.now() - 86400000;
  const date = h('input', { class: 'input', type: 'date', value: toDateInput(yesterday), max: toDateInput(Date.now()) });
  const time = h('input', { class: 'input', type: 'time', value: '18:00' });
  const mins = h('input', { class: 'input', type: 'number', inputMode: 'numeric', min: 1, max: 600, value: 60 });
  const plan = h('select', { class: 'input' }, PLANS.map((p) => h('option', { value: p.id }, p.name)), h('option', { value: '' }, 'Freestyle'));
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const dialog = modal('Log a past workout', h('div', { class: 'stack' },
    h('p', { class: 'muted small' }, 'For a workout you did without the phone. Fill in the sets on the next screen.'),
    h('div', { class: 'row row--wrap' },
      h('label', { class: 'field' }, h('span', {}, 'Date'), date),
      h('label', { class: 'field' }, h('span', {}, 'Start'), time),
      h('label', { class: 'field' }, h('span', {}, 'Minutes'), mins),
    ),
    h('label', { class: 'field' }, h('span', {}, 'Workout'), plan),
    error,
    h('button', {
      class: 'btn btn--primary btn--block',
      type: 'button',
      onClick: () => {
        const r = readWhen(date.value, time.value, mins.value);
        if (r.error) {
          error.textContent = r.error;
          error.hidden = false;
          return;
        }
        const planId = plan.value || null;
        const s = store.addPastSession({ planId, startedAt: r.startedAt, endedAt: r.endedAt });
        dialog.close();
        openSession(s.id, ctx, { editing: true, placeholders: planId ? store.planItems(planId, null).map((it) => it.ex) : [] });
      },
    }, 'Next: add the sets'),
  ));
}

// ── Date helpers ─────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in local time, for <input type="date">. */
export function toDateInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'HH:MM' in local time, for <input type="time">. */
export function toTimeInput(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Pure: date + start time + minutes → { startedAt, endedAt } or { error }.
 * Rejects a missing or invalid date/time, a duration under a minute, and a
 * start in the future.
 */
export function readWhen(dateText, timeText, minutesText, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText ?? '');
  const t = /^(\d{2}):(\d{2})$/.exec(timeText ?? '');
  if (!m || !t) return { error: 'Pick a date and a start time.' };
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])).getTime();
  if (!Number.isFinite(start)) return { error: 'Pick a date and a start time.' };
  const minutes = Number(minutesText);
  if (!Number.isFinite(minutes) || minutes < 1) return { error: 'The workout has to last at least a minute (the end cannot be before the start).' };
  if (minutes > 600) return { error: 'That is more than 10 hours — check the minutes.' };
  if (start > now) return { error: 'That start time is in the future.' };
  return { startedAt: start, endedAt: start + Math.round(minutes) * 60000 };
}

function setText(s, ex) {
  if (ex.track === 'cardio') return [s.miles ? `${s.miles} mi` : null, s.minutes ? fmtMinutes(s.minutes) : null, s.miles && s.minutes ? `${fmtPace(s.minutes / s.miles)}/mi` : null].filter(Boolean).join(' ');
  if (ex.track === 'time') return `${s.secs}s`;
  if (ex.track === 'bodyweight' || ex.load === 'none') return `${s.reps}`;
  return `${fmtW(s.w)}×${s.reps}`;
}
