import { h, modal, fmtDate, fmtClock } from '../util.js';
import * as store from '../store.js';
import { exerciseOr } from '../data/exercises.js';
import { sessionSummary, hrSummary, maxHr, weekStart, fmtLb, fmtDuration, fmtW, fmtMinutes, fmtPace } from '../metrics.js';
import { watchForSession } from '../samsung.js';
import { zoneBar } from '../charts.js';
import { empty, pickGym, gymName, crowdChips } from './common.js';

export function renderHistory(ctx) {
  const st = store.getState();
  const bw = st.profile.bodyweight;
  if (!st.sessions.length) {
    return h('div', { class: 'page' }, h('div', { class: 'page__head' }, h('h1', {}, 'History')), empty('Nothing logged yet', 'Finished workouts appear here with every set, the gym, and heart rate if your watch was connected or imported.'));
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
    h('div', { class: 'page__head' }, h('h1', {}, 'History')),
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
    { class: 'srow', type: 'button', onClick: () => openSession(s, ctx) },
    h('span', { class: 'srow__date' }, h('strong', {}, fmtDate(s.startedAt, { weekday: 'short' })), h('span', {}, fmtDate(s.startedAt, { month: 'numeric', day: 'numeric' }))),
    h('span', { class: 'srow__main' },
      h('span', { class: 'srow__name' }, s.name),
      h('span', { class: 'muted small' }, `${fmtDuration(sum.durationMin)} · ${sum.workSets} sets · ${fmtLb(sum.tonnage)} lb${g ? ` · ${g.name}` : ''}`),
    ),
    (hs || wd.workout?.avgHr) && h('span', { class: 'srow__hr mono' }, `♥ ${hs?.avg ?? Math.round(wd.workout.avgHr)}`),
  );
}

function openSession(s, ctx) {
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
          gymBtn.textContent = `${gymLabel()} ▾`;
          ctx.rerender();
        },
      }, `${gymLabel()} ▾`)
    : null;

  const dialog = modal(
    `${s.name} · ${fmtDate(s.startedAt)}`,
    h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted small' }, `${fmtClock(s.startedAt)}–${fmtClock(s.endedAt)}`, gymBtn ? [' · ', gymBtn] : s.geo ? ' · location saved' : ''),
      h('div', { class: 'row row--wrap' }, h('span', { class: 'muted small' }, 'How busy:'), crowdChips(s.crowd, (v) => { store.updateSession(s.id, { crowd: v ?? undefined }); ctx.rerender(); })),
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
          e.plannedEx !== e.ex && h('span', { class: 'muted small' }, ` (instead of ${exerciseOr(e.plannedEx).name})`),
          h('div', { class: 'mono small' }, e.sets.map((x) => setText(x, ex)).join(' · ')),
        );
      })),
      (hs || wd.workout) && h('h3', { class: 'eyebrow' }, `Heart rate · ${wd.source === 'live' ? 'live Bluetooth' : 'Samsung Health'}`),
      hs && h('p', {}, `Average ${hs.avg} bpm, peak ${hs.max} bpm.`),
      !hs && wd.workout?.avgHr && h('p', {}, `Average ${Math.round(wd.workout.avgHr)} bpm, peak ${Math.round(wd.workout.maxHr)} bpm.`),
      hs?.zones && zoneBar(hs.zones),
      wd.workout && h('p', { class: 'muted small' }, `Watch workout: ${wd.workout.typeName}, ${Math.round(wd.workout.durationMs / 60000)} min${wd.workout.kcal ? `, ${Math.round(wd.workout.kcal)} kcal` : ''}.`),
      s.notes && h('p', { class: 'note' }, s.notes),
      h('button', {
        class: 'btn btn--danger-ghost',
        type: 'button',
        onClick: () => {
          if (confirm('Delete this workout? Its sets will drop out of every stat.')) {
            store.deleteSession(s.id);
            dialog.close();
            ctx.rerender();
          }
        },
      }, 'Delete workout'),
    ),
  );
}

function setText(s, ex) {
  if (ex.track === 'cardio') return [s.miles ? `${s.miles} mi` : null, s.minutes ? fmtMinutes(s.minutes) : null, s.miles && s.minutes ? `${fmtPace(s.minutes / s.miles)}/mi` : null].filter(Boolean).join(' ');
  if (ex.track === 'time') return `${s.secs}s`;
  if (ex.track === 'bodyweight' || ex.load === 'none') return `${s.reps}`;
  return `${fmtW(s.w)}×${s.reps}`;
}
