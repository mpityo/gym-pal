/** Pieces shared by several screens. */
import { h, modal, matchScore, fmtRel, fmtDate, toast, shrink, photoInput } from '../util.js';
import { EXERCISES, MUSCLES, exercise, exerciseOr } from '../data/exercises.js';
import * as store from '../store.js';
import { exerciseImages } from '../data/images.js';
import * as photos from '../photos.js';
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

// ── Reference pictures ───────────────────────────────────────────────────

/** Neutral square in the exercise's movement colour, used when there is no picture. */
function thumbTile(exId, size) {
  const pattern = exerciseOr(exId).pattern;
  return h('span', { class: `thumb thumb--tile p-${pattern}`, style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' });
}

/**
 * Which gym's photos to use. One place for this, so it follows whatever
 * spec 07 decides is the gym in use (the workout's, else the one picked).
 */
export function photoGym() {
  return store.currentGym();
}

/** The reference picture as a small square, or a coloured tile when there is none (or it fails offline). */
function referenceThumb(exId, size) {
  const [src] = exerciseImages(exId);
  if (!src) return thumbTile(exId, size);
  const img = h('img', { class: 'thumb', src, alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(thumbTile(exId, size)), { once: true });
  return img;
}

/**
 * A small square picture of the exercise: your own photo for the current
 * gym when there is one (marked with a dot), else the reference picture,
 * else a coloured tile so rows stay aligned. Rendering stays synchronous:
 * the reference shows at once and your photo replaces it when it loads.
 */
export function exerciseThumb(exId, { size = 44 } = {}) {
  const el = referenceThumb(exId, size);
  const gid = photoGym();
  if (photos.photoMeta(exId, gid)) {
    photos.getPhoto(exId, gid).then((rec) => {
      if (!rec || !el.parentNode) return;
      const img = h('img', { src: photos.photoUrl(rec), alt: '', width: size, height: size, decoding: 'async' });
      el.replaceWith(h('span', { class: 'thumb thumb--mine', style: { width: `${size}px`, height: `${size}px` }, title: 'Your photo' }, img));
    });
  }
  return el;
}

/**
 * "Your photo" for the machine page and the How-to sheet: the photo (tap for
 * full size) labelled with its gym and date, and Add / Retake / Remove.
 * Removes itself when photos cannot be stored in this browser.
 */
export function myPhotoBlock(exId) {
  const box = h('div', { class: 'myphoto' });
  const gid = photoGym();
  const draw = async () => {
    if (!(await photos.init())) {
      box.remove();
      return;
    }
    const rec = await photos.getPhoto(exId, gid);
    const input = photoInput(async (file) => {
      box.replaceChildren(h('p', { class: 'muted small' }, 'Saving the photo…'));
      try {
        const { blob, width, height } = await shrink(file, { max: 1024, quality: 0.8, as: 'blob' });
        toast((await photos.putPhoto(exId, gid, blob, { width, height })) ? 'Photo saved' : 'Could not save the photo on this phone');
      } catch (err) {
        toast(err?.message ?? 'Could not read that photo.');
      }
      draw();
    });
    const name = exerciseOr(exId).name;
    if (!rec) {
      box.replaceChildren(
        input,
        h('button', { class: 'btn btn--block', type: 'button', onClick: () => input.open() }, '📷 Add a photo of this machine'),
        h('p', { class: 'muted small' }, gid ? `Saved for ${gymName(gid)}, on this phone only.` : 'Saved on this phone only.'),
      );
      return;
    }
    const url = photos.photoUrl(rec);
    const label = `Your photo · ${rec.gymId ? gymName(rec.gymId) : 'any gym'} · ${fmtDate(rec.takenAt, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    box.replaceChildren(
      input,
      h(
        'figure',
        { class: 'figure' },
        h('button', { class: 'figure__cell', type: 'button', onClick: () => openPicture(url, `${name} · your photo`) }, h('img', { src: url, alt: `Your photo of ${name}` })),
        h('figcaption', { class: 'muted small' }, label),
      ),
      h(
        'div',
        { class: 'row row--wrap' },
        h('button', { class: 'btn btn--small', type: 'button', onClick: () => input.open() }, rec.gymId === (gid ?? null) ? 'Retake' : `Take one for ${gymName(gid)}`),
        h('button', {
          class: 'btn btn--small btn--danger-ghost',
          type: 'button',
          onClick: async () => {
            if (!confirm('Remove this photo?')) return;
            await photos.deletePhoto(exId, rec.gymId);
            toast('Photo removed');
            draw();
          },
        }, 'Remove'),
      ),
    );
  };
  draw();
  return box;
}

/** Shows a picture full size in a modal. */
function openPicture(src, title) {
  modal(title, h('img', { class: 'figure__big', src, alt: title }), { wide: true });
}

/**
 * The reference picture(s), full width with a caption. Two images are shown
 * side by side as "Start" and "End". Tapping one opens it larger. Null when
 * the exercise has no picture.
 */
export function exerciseFigure(exId) {
  const srcs = exerciseImages(exId);
  if (!srcs.length) return null;
  const ex = exerciseOr(exId);
  const labels = srcs.length === 2 ? ['Start', 'End'] : [null];
  return h(
    'figure',
    { class: 'figure' },
    h(
      'div',
      { class: `figure__row figure__row--${srcs.length}` },
      srcs.map((src, i) => {
        const img = h('img', { src, alt: `${ex.name}${labels[i] ? ` — ${labels[i].toLowerCase()}` : ''}`, loading: 'lazy', decoding: 'async' });
        img.addEventListener('error', () => img.closest('.figure__cell')?.remove(), { once: true });
        return h(
          'button',
          { class: 'figure__cell', type: 'button', onClick: () => openPicture(src, labels[i] ? `${ex.name} · ${labels[i]}` : ex.name) },
          img,
          labels[i] && h('span', { class: 'figure__label' }, labels[i]),
        );
      }),
    ),
    h('figcaption', { class: 'muted small' }, "Reference photo — your gym's machine may look different."),
  );
}

function exerciseOption(ex, usage, onPick) {
  const u = usage.get(ex.id);
  const note = store.machineNote(ex.id);
  return h(
    'button',
    { class: `pick pick--thumb${note.missing ? ' is-missing' : ''}`, type: 'button', onClick: () => onPick(ex.id) },
    exerciseThumb(ex.id),
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
      myPhotoBlock(exId),
      exerciseFigure(exId),
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
