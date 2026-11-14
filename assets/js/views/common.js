/** Pieces shared by several screens. */
import { h, modal, matchScore, fmtRel } from '../util.js';
import { EXERCISES, MUSCLES, exercise } from '../data/exercises.js';
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

function exerciseOption(ex, usage, onPick) {
  const u = usage.get(ex.id);
  const note = store.machineNote(ex.id);
  return h(
    'button',
    { class: 'pick', type: 'button', onClick: () => onPick(ex.id) },
    h('span', { class: 'pick__name' }, ex.name),
    h('span', { class: 'pick__meta' }, ex.muscles.primary.map((m) => MUSCLES[m]).join(', '), u ? ` · used ${fmtRel(u.last)}` : ''),
    note.where && h('span', { class: 'pick__where' }, `📍 ${note.where}`),
  );
}

/**
 * Alternatives for an exercise: its listed swaps first, then everything else
 * that trains the same primary muscle, then a search over the whole library.
 */
export function openSwap(exId, { title = 'Swap exercise', onPick, planName, allowPermanent = false } = {}) {
  const ex = exercise(exId);
  const usage = usageMap();
  const listed = ex.alts.map(exercise).filter(Boolean);
  const same = EXERCISES.filter(
    (e) => e.id !== ex.id && !ex.alts.includes(e.id) && e.pattern === ex.pattern && e.muscles.primary.some((m) => ex.muscles.primary.includes(m)),
  );
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
          ? EXERCISES.map((e) => [e, matchScore(`${e.name} ${e.look}`, q)])
              .filter(([, sc]) => sc > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([e]) => exerciseOption(e, usage, pick))
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
    const rows = EXERCISES.map((e) => [e, q ? matchScore(`${e.name} ${e.look} ${e.muscles.primary.map((m) => MUSCLES[m]).join(' ')}`, q) : 1])
      .filter(([, sc]) => sc > 0)
      .sort((a, b) => b[1] - a[1] || (usage.get(b[0].id)?.sets ?? 0) - (usage.get(a[0].id)?.sets ?? 0));
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
  const ex = exercise(exId);
  const note = store.machineNote(exId);
  const where = h('input', { class: 'input', value: note.where, placeholder: 'e.g. back wall, left of the mirrors' });
  const settings = h('input', { class: 'input', value: note.settings, placeholder: 'e.g. seat 4, back pad 2' });
  const save = () => store.setMachineNote(exId, { where: where.value.trim(), settings: settings.value.trim() });
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
      h('h3', { class: 'eyebrow' }, 'Your notes'),
      h('label', { class: 'field' }, h('span', {}, 'Where it is in your gym'), where),
      h('label', { class: 'field' }, h('span', {}, 'Your settings'), settings),
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
