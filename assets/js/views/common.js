/** Pieces shared by several screens. */
import { h, modal, matchScore, fmtRel } from '../util.js';
import { EXERCISES, MUSCLES, exercise, exerciseOr } from '../data/exercises.js';
import * as store from '../store.js';
import { machineUsage, fmtLb } from '../metrics.js';
import { hasKey } from '../ai.js';

export function muscleChips(ex) {
  return h(
    'span',
    { class: 'chips' },
    ex.muscles.primary.map((m) => h('span', { class: 'chip chip--primary' }, MUSCLES[m])),
    ex.muscles.secondary.map((m) => h('span', { class: 'chip' }, MUSCLES[m])),
  );
}

export function targetText(target, ex) {
  if (!target) return '';
  if (ex?.track === 'cardio') return target.miles ? `${target.miles} mile` : `${target.minutes ?? ''} min`;
  if (target.secs) return `${target.sets} × ${target.secs[0]}–${target.secs[1]} s`;
  const [a, b] = target.reps ?? [];
  return `${target.sets} × ${a === b ? a : `${a}–${b}`}`;
}

export function usageMap() {
  const st = store.getState();
  return new Map(machineUsage(st.sessions, st.profile.bodyweight).map((u) => [u.ex, u]));
}

// ── Gyms ─────────────────────────────────────────────────────────────────

/**
 * "Which gym?" sheet. Resolves to a gym id, null for "Somewhere else", or
 * undefined if closed without choosing.
 */
export function pickGym({ title = 'Which gym?', current, intro } = {}) {
  return new Promise((resolve) => {
    let chosen;
    const choose = (id) => {
      chosen = id;
      dialog.close();
    };
    const option = (id, label, meta) =>
      h('button', { class: `pick${id === current ? ' is-current' : ''}`, type: 'button', 'aria-pressed': id === current, onClick: () => choose(id) },
        h('span', { class: 'pick__name' }, label, id === current && h('span', { class: 'tag' }, 'current')),
        meta && h('span', { class: 'pick__meta' }, meta),
      );
    const dialog = modal(
      title,
      h('div', { class: 'stack' },
        intro && h('p', { class: 'muted' }, intro),
        h('div', { class: 'pick-list' },
          store.gymsByRecent().map((g) => option(g.id, `📍 ${g.name}`, [g.chain, g.address].filter(Boolean).join(' · '))),
          option(null, 'Somewhere else', 'No gym notes or gym swaps'),
        ),
      ),
    );
    dialog.addEventListener('close', () => resolve(chosen));
  });
}

/** Display name of a gym id, for labels. */
export function gymName(id) {
  return (id && store.gym(id)?.name) || 'Somewhere else';
}

/**
 * "📍 Name ▾" switcher, shown when there are two or more gyms. During a
 * workout it moves the workout; otherwise it sets the gym being viewed.
 */
export function gymChip(ctx) {
  const st = store.getState();
  if (st.gyms.length < 2) return null;
  const id = store.currentGym();
  return h('button', {
    class: 'chip chip--btn gym-chip',
    type: 'button',
    'aria-label': `Gym: ${gymName(id)}. Change gym`,
    onClick: async () => {
      const next = await pickGym({ current: id });
      if (next === undefined || next === id) return;
      if (store.active()) store.setSessionGym(next);
      else store.setCurrentGym(next);
      ctx.rerender();
    },
  }, `📍 ${gymName(id)} ▾`);
}

/** "Not at {gym}" checkbox, or nothing when no gym is selected. */
export function missingToggle(exId, onChange) {
  const gid = store.currentGym();
  if (!gid) return null;
  return h('label', { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: store.isMissing(exId, gid),
      onChange: (e) => {
        store.setMachineNote(exId, { missing: e.target.checked }, gid);
        onChange?.(e.target.checked);
      },
    }),
    h('span', {}, `Not at ${gymName(gid)}`),
  );
}

/** Missing-at-this-gym last, keeping the order otherwise. */
function missingLast(list, idOf = (x) => x.id) {
  const gid = store.currentGym();
  if (!gid) return list;
  return [...list].sort((a, b) => store.isMissing(idOf(a), gid) - store.isMissing(idOf(b), gid));
}

function exerciseOption(ex, usage, onPick) {
  const u = usage.get(ex.id);
  const note = store.machineNote(ex.id);
  return h(
    'button',
    { class: `pick${note.missing ? ' is-missing' : ''}`, type: 'button', onClick: () => onPick(ex.id) },
    h('span', { class: 'pick__name' }, ex.name, note.missing && h('span', { class: 'tag tag--warn' }, 'not at this gym')),
    h('span', { class: 'pick__meta' }, ex.muscles.primary.map((m) => MUSCLES[m]).join(', '), u ? ` · used ${fmtRel(u.last)}` : ''),
    note.where && h('span', { class: 'pick__where' }, `📍 ${note.where}`),
  );
}

/**
 * Alternatives for an exercise: its listed swaps first, then everything else
 * that trains the same primary muscle, then a search over the whole library.
 */
export function openSwap(exId, { title = 'Swap exercise', onPick, planName, allowPermanent = false } = {}) {
  const ex = exerciseOr(exId);
  const usage = usageMap();
  const listed = missingLast(ex.alts.map(exercise).filter(Boolean));
  const same = missingLast(EXERCISES.filter(
    (e) => e.id !== ex.id && !ex.alts.includes(e.id) && e.pattern === ex.pattern && e.muscles.primary.some((m) => ex.muscles.primary.includes(m)),
  ));
  let always = false;
  const results = h('div', { class: 'pick-list' });
  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search every exercise',
    onInput: () => {
      const q = search.value.trim();
      results.replaceChildren(
        ...(q
          ? missingLast(
              EXERCISES.map((e) => [e, matchScore(`${e.name} ${e.look}`, q)])
                .filter(([, sc]) => sc > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12),
              ([e]) => e.id,
            ).map(([e]) => exerciseOption(e, usage, pick))
          : []),
      );
    },
  });
  const pick = (id) => {
    dialog.close();
    onPick(id, { always });
  };
  const dialog = modal(
    title,
    h(
      'div',
      { class: 'stack' },
      h('p', { class: 'muted' }, `Instead of ${ex.name}. These hit the same muscles the same way.`),
      h('h3', { class: 'eyebrow' }, 'Best swaps'),
      h('div', { class: 'pick-list' }, listed.map((e) => exerciseOption(e, usage, pick))),
      same.length > 0 && h('h3', { class: 'eyebrow' }, 'Also works'),
      same.length > 0 && h('div', { class: 'pick-list' }, same.map((e) => exerciseOption(e, usage, pick))),
      h('h3', { class: 'eyebrow' }, 'Something else'),
      search,
      results,
      allowPermanent &&
        h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', onChange: (e) => (always = e.target.checked) }),
          h('span', {}, `Always use the swap in ${planName ?? 'this plan'}`),
        ),
    ),
  );
}

export function openExercisePicker({ title = 'Add an exercise', onPick }) {
  const usage = usageMap();
  const list = h('div', { class: 'pick-list' });
  const draw = (q = '') => {
    const gid = store.currentGym();
    const rows = EXERCISES.map((e) => [e, q ? matchScore(`${e.name} ${e.look} ${e.muscles.primary.map((m) => MUSCLES[m]).join(' ')}`, q) : 1])
      .filter(([, sc]) => sc > 0)
      .sort((a, b) => store.isMissing(a[0].id, gid) - store.isMissing(b[0].id, gid) || b[1] - a[1] || (usage.get(b[0].id)?.sets ?? 0) - (usage.get(a[0].id)?.sets ?? 0));
    list.replaceChildren(...rows.map(([e]) => exerciseOption(e, usage, (id) => {
      dialog.close();
      onPick(id);
    })));
  };
  const dialog = modal(
    title,
    h('div', { class: 'stack' }, h('input', { class: 'input', type: 'search', placeholder: 'Search: chest, leg press, cable…', onInput: (e) => draw(e.target.value) }), list),
  );
  draw();
}

/** The how-to sheet used from a workout. Full detail lives on the Machines screen. */
export function openHowTo(exId, ctx) {
  const ex = exerciseOr(exId);
  const gid = store.currentGym();
  const note = store.machineNote(exId, gid);
  const where = h('input', { class: 'input', value: note.where, placeholder: 'e.g. back wall, left of the mirrors' });
  const settings = h('input', { class: 'input', value: note.settings, placeholder: 'e.g. seat 4, back pad 2' });
  const save = () => {
    const now = store.machineNote(exId, gid);
    const patch = {};
    if (where.value.trim() !== now.where) patch.where = where.value.trim();
    if (settings.value.trim() !== now.settings) patch.settings = settings.value.trim();
    if (Object.keys(patch).length) store.setMachineNote(exId, patch, gid);
  };
  where.addEventListener('change', save);
  settings.addEventListener('change', save);
  const dialog = modal(
    ex.name,
    h(
      'div',
      { class: 'stack' },
      muscleChips(ex),
      h('p', {}, h('strong', {}, 'Look for: '), ex.look),
      h('h3', { class: 'eyebrow' }, 'Set up'),
      h('ol', { class: 'steps' }, ex.setup.map((x) => h('li', {}, x))),
      h('h3', { class: 'eyebrow' }, 'Form'),
      h('ul', { class: 'steps' }, ex.cues.map((x) => h('li', {}, x))),
      ex.mistakes.length > 0 && h('h3', { class: 'eyebrow' }, 'Avoid'),
      ex.mistakes.length > 0 && h('ul', { class: 'steps steps--warn' }, ex.mistakes.map((x) => h('li', {}, x))),
      h('h3', { class: 'eyebrow' }, gid ? `Your notes · ${gymName(gid)}` : 'Your notes'),
      h('label', { class: 'field' }, h('span', {}, 'Where it is in this gym'), where),
      h('label', { class: 'field' }, h('span', {}, 'Your settings'), settings),
      missingToggle(exId),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { save(); dialog.close(); ctx.go(`machine/${exId}`); } }, 'Full page & your stats'),
        hasKey() && h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { save(); dialog.close(); ctx.openCoach({ about: exId }); } }, 'Ask the coach'),
      ),
    ),
  );
  dialog.addEventListener('close', save);
}

export function empty(title, body, action) {
  return h('div', { class: 'empty' }, h('h2', {}, title), body && h('p', { class: 'muted' }, body), action);
}

export { fmtLb };
