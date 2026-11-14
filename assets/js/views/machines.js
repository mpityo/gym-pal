import { h, modal, toast, matchScore, fmtRel, fmtDate } from '../util.js';
import * as store from '../store.js';
import * as ai from '../ai.js';
import { EXERCISES, MUSCLES, exercise } from '../data/exercises.js';
import { exerciseHistory, exerciseRecords, fmtW, fmtLb, e1rm, fmtMinutes, fmtPace } from '../metrics.js';
import { muscleChips, usageMap, empty, gymChip, gymName, missingToggle, exerciseThumb, exerciseFigure } from './common.js';
import { sparkline } from '../charts.js';

const FILTERS = [
  ['all', 'All'],
  ['here', 'At my gym'],
  ['used', 'Used'],
  ['push', 'Push'],
  ['pull', 'Pull'],
  ['legs', 'Legs'],
  ['core', 'Core'],
  ['cardio', 'Cardio'],
];
const view = { q: '', filter: 'all' };

export function renderMachines(ctx) {
  const usage = usageMap();
  const gid = store.currentGym();
  if (view.filter === 'here' && !gid) view.filter = 'all';
  const filters = FILTERS.filter(([id]) => id !== 'here' || gid);
  const list = h('div', { class: 'mlist' });

  const keep = (e) =>
    view.filter === 'all' ? true : view.filter === 'here' ? !store.isMissing(e.id, gid) : view.filter === 'used' ? usage.has(e.id) : e.pattern === view.filter;

  const draw = () => {
    const rows = EXERCISES.filter(keep)
      .map((e) => [e, view.q ? matchScore(`${e.name} ${e.look} ${[...e.muscles.primary, ...e.muscles.secondary].map((m) => MUSCLES[m]).join(' ')}`, view.q) : 1])
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || (view.filter === 'used' ? (usage.get(b[0].id)?.sets ?? 0) - (usage.get(a[0].id)?.sets ?? 0) : 0));
    list.replaceChildren(
      ...(rows.length
        ? rows.map(([e]) => {
            const u = usage.get(e.id);
            const note = store.machineNote(e.id);
            return h(
              'button',
              { class: 'mrow', type: 'button', onClick: () => ctx.go(`machine/${e.id}`) },
              exerciseThumb(e.id),
              h('span', { class: 'mrow__main' },
                h('span', { class: 'mrow__name' }, e.name, note.missing && h('span', { class: 'tag tag--warn' }, 'not at this gym')),
                h('span', { class: 'mrow__meta' }, e.muscles.primary.map((m) => MUSCLES[m]).join(', ')),
                note.where && h('span', { class: 'mrow__where' }, `📍 ${note.where}`),
              ),
              u && h('span', { class: 'mrow__use mono' }, `${u.sets} sets`, h('span', { class: 'muted' }, fmtRel(u.last))),
            );
          })
        : [empty('Nothing matches', 'Try a muscle ("chest"), a machine ("pulldown"), or the Used filter.')]),
    );
  };

  const chips = h(
    'div',
    { class: 'filter', role: 'tablist' },
    filters.map(([id, label]) =>
      h('button', {
        class: `chip chip--btn${view.filter === id ? ' chip--on' : ''}`,
        type: 'button',
        onClick: (e) => {
          view.filter = id;
          for (const c of chips.children) c.classList.toggle('chip--on', c === e.currentTarget);
          draw();
        },
      }, label),
    ),
  );

  draw();
  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page__head' }, h('h1', {}, 'Machines'), h('p', { class: 'muted' }, 'How to find, set up and use each one, plus the swaps when it is taken.'), gymChip(ctx)),
    ai.hasKey() &&
      h('section', { class: 'card card--tip' },
        h('div', { class: 'card__head' }, h('div', {}, h('h2', { class: 'card__title' }, 'Not sure what a machine is?'), h('p', { class: 'muted small' }, 'Snap a photo and Claude will name it and tell you how to set it up.')),
          photoButton(ctx)),
      ),
    h('input', { class: 'input input--search', type: 'search', placeholder: 'Search machines or muscles', value: view.q, onInput: (e) => { view.q = e.target.value; draw(); } }),
    chips,
    list,
  );
}

function photoButton(ctx) {
  const file = h('input', {
    type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
    onChange: (e) => {
      const chosen = e.target.files[0];
      e.target.value = '';
      identify(chosen, ctx);
    },
  });
  return h('span', {}, file, h('button', { class: 'btn btn--primary', type: 'button', onClick: () => file.click() }, 'Photo'));
}

async function identify(file, ctx) {
  if (!file) return;
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Looking at the photo…'));
  modal('What is this?', body);
  try {
    const { base64, type } = await shrink(file);
    const r = await ai.identifyMachine(base64, type, EXERCISES);
    const ex = r.exerciseId !== 'none' ? exercise(r.exerciseId) : null;
    body.replaceChildren(
      h('h3', {}, r.name),
      h('p', { class: 'muted small' }, r.muscles, r.confidence === 'low' ? ' · not sure — double-check' : ''),
      h('h3', { class: 'eyebrow' }, 'Set up'),
      h('ol', { class: 'steps' }, r.setup.map((s) => h('li', {}, s))),
      h('h3', { class: 'eyebrow' }, 'Form'),
      h('ul', { class: 'steps' }, r.cues.map((s) => h('li', {}, s))),
      ex && h('button', { class: 'btn btn--primary btn--block', type: 'button', onClick: () => { document.querySelector('dialog[open]')?.close(); ctx.go(`machine/${ex.id}`); } }, `Open ${ex.name}`),
      !ex && h('p', { class: 'muted small' }, 'This one is not in the library, so it cannot be tracked by name yet. Log it under the closest match.'),
    );
  } catch (err) {
    body.replaceChildren(h('p', {}, err.message ?? 'That did not work.'));
  }
}

/** Downscale to ~1280px JPEG before sending: faster and cheaper, same answer. */
async function shrink(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.82);
  return { base64: url.split(',')[1], type: 'image/jpeg' };
}

// ── One machine ──────────────────────────────────────────────────────────

export function renderMachine(ctx) {
  const ex = exercise(ctx.param);
  if (!ex) return empty('Unknown exercise', null, h('button', { class: 'btn', type: 'button', onClick: () => ctx.go('machines') }, 'All machines'));
  const st = store.getState();
  const bw = st.profile.bodyweight;
  const hist = exerciseHistory(st.sessions, ex.id, bw);
  const rec = exerciseRecords(st.sessions, ex.id, bw);
  const gid = store.currentGym();
  const note = store.machineNote(ex.id, gid);
  const totalSets = hist.reduce((a, x) => a + x.sets.length, 0);
  const totalLb = hist.reduce((a, x) => a + x.tonnage, 0);

  const saved = gid ? `Saved for ${gymName(gid)}` : 'Saved';
  const where = h('input', { class: 'input', value: note.where, placeholder: 'e.g. back wall, left of the mirrors', onChange: (e) => { store.setMachineNote(ex.id, { where: e.target.value.trim() }, gid); toast(saved); } });
  const settings = h('input', { class: 'input', value: note.settings, placeholder: 'e.g. seat 4, back pad 2', onChange: (e) => { store.setMachineNote(ex.id, { settings: e.target.value.trim() }, gid); toast(saved); } });

  const trend =
    ex.track === 'weight' && ex.load !== 'assist'
      ? hist.map((x) => Math.max(...x.sets.map((s) => e1rm(s.w, s.reps))))
      : ex.track === 'cardio'
        ? hist.map((x) => { const s = x.sets.find((y) => y.miles && y.minutes); return s ? s.minutes / s.miles : NaN; })
        : hist.map((x) => x.best?.score ?? NaN);

  return h(
    'div',
    { class: 'page' },
    h('button', { class: 'back', type: 'button', onClick: () => history.length > 1 ? history.back() : ctx.go('machines') }, '← Back'),
    h('div', { class: 'page__head' }, h('p', { class: `eyebrow p-text-${ex.pattern}` }, ex.pattern), h('h1', {}, ex.name), muscleChips(ex)),

    hist.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'Your numbers'),
        h(
          'div',
          { class: 'stat-grid' },
          stat(String(hist.length), hist.length === 1 ? 'session' : 'sessions'),
          stat(String(totalSets), 'sets'),
          ex.track === 'weight' && stat(fmtLb(totalLb), 'lb moved'),
          rec.bestE1rm && stat(`${Math.round(rec.bestE1rm.value)}`, 'est. 1-rep max'),
          rec.heaviest && stat(`${fmtW(rec.heaviest.w)}`, rec.heaviest.assist ? 'least assist' : 'heaviest set'),
          rec.longest && stat(`${rec.longest.secs}s`, 'longest hold'),
        ),
        trend.filter(Number.isFinite).length > 1 &&
          h('div', { class: 'trend' }, h('span', { class: 'muted small' }, ex.track === 'cardio' ? 'Pace per mile (lower is faster)' : ex.track === 'weight' ? 'Estimated 1-rep max per session (Epley)' : 'Best set per session'), sparkline(trend, { width: 280, height: 56 })),
        h(
          'ol',
          { class: 'hist' },
          hist.slice(-8).reverse().map((x) =>
            h('li', {}, h('span', { class: 'muted' }, fmtDate(x.date)), h('span', { class: 'mono' }, x.sets.map((s) => setText(s, ex)).join(' · '))),
          ),
        ),
      ),

    h(
      'section',
      { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', { class: 'card__title' }, 'Finding it'), gymChip(ctx)),
      exerciseFigure(ex.id),
      h('p', {}, ex.look),
      h('label', { class: 'field' }, h('span', {}, gid ? `Where it is at ${gymName(gid)}` : 'Where it is in your gym'), where),
      h('label', { class: 'field' }, h('span', {}, 'Your settings (seat, pads, grip)'), settings),
      missingToggle(ex.id, (on) => { toast(on ? `Marked not at ${gymName(gid)}. Plans will use a swap there.` : `Back at ${gymName(gid)}`); ctx.rerender(); }),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card__title' }, 'Set up'),
      h('ol', { class: 'steps' }, ex.setup.map((s) => h('li', {}, s))),
      h('h2', { class: 'card__title' }, 'Form'),
      h('ul', { class: 'steps' }, ex.cues.map((s) => h('li', {}, s))),
      ex.mistakes.length > 0 && h('h2', { class: 'card__title' }, 'Common mistakes'),
      ex.mistakes.length > 0 && h('ul', { class: 'steps steps--warn' }, ex.mistakes.map((s) => h('li', {}, s))),
      ai.hasKey() && h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => ctx.openCoach({ about: ex.id }) }, 'Ask the coach about this one'),
    ),
    ex.alts.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card__title' }, 'If it is taken'),
        h('div', { class: 'mlist' }, ex.alts.map(exercise).filter(Boolean).map((alt) =>
          h('button', { class: 'mrow', type: 'button', onClick: () => ctx.go(`machine/${alt.id}`) },
            h('span', { class: `mrow__pattern p-${alt.pattern}`, 'aria-hidden': 'true' }),
            h('span', { class: 'mrow__main' }, h('span', { class: 'mrow__name' }, alt.name, store.isMissing(alt.id, gid) && h('span', { class: 'tag tag--warn' }, 'not at this gym')), h('span', { class: 'mrow__meta' }, alt.look.split('.')[0])),
          ),
        )),
      ),
  );
}

function setText(s, ex) {
  if (ex.track === 'cardio') return [s.miles ? `${s.miles} mi` : null, s.minutes ? fmtMinutes(s.minutes) : null, s.miles && s.minutes ? `${fmtPace(s.minutes / s.miles)}/mi` : null].filter(Boolean).join(' ');
  if (ex.track === 'time') return `${s.secs}s`;
  if (ex.track === 'bodyweight' || ex.load === 'none') return `${s.reps}`;
  return `${fmtW(s.w)}×${s.reps}`;
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label));
}
