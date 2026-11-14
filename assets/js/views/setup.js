import { h, modal, toast, download, fmtRel, fmtDate, pluralize } from '../util.js';
import * as store from '../store.js';
import * as photos from '../photos.js';
import { mapsLink } from '../gyms.js';
import { plansCard } from './custom.js';
import * as ai from '../ai.js';
import * as hr from '../hr.js';
import { readFiles, buildWatch } from '../samsung.js';
import { maxHr, parseAmount } from '../metrics.js';

// Reasonable bounds for free-typed profile numbers.
const BOUNDS = { bodyweight: [50, 700], age: [10, 100], maxHr: [100, 230] };

export function renderSetup(ctx) {
  const includePhotos = photosCheckbox();
  const st = store.getState();
  const p = st.profile;

  const num = (label, key, unit, hint) =>
    h('label', { class: 'field' },
      h('span', {}, label),
      h('span', { class: 'field__row' },
        h('input', {
          class: 'input mono',
          type: 'text',
          inputMode: 'decimal',
          value: p[key] ?? '',
          onChange: (e) => {
            const v = e.target.value.trim();
            if (!v) { store.setProfile({ [key]: null }); ctx.rerender(); return; }
            const [lo, hi] = BOUNDS[key] ?? [0, Infinity];
            const n = parseAmount(v);
            if (n === null || n < lo || n > hi) {
              toast('Enter a number');
              e.target.value = p[key] ?? '';
              return;
            }
            store.setProfile({ [key]: n });
            ctx.rerender();
          },
        }),
        unit && h('span', { class: 'muted' }, unit),
      ),
      hint && h('span', { class: 'field__hint' }, hint),
    );

  return h(
    'div',
    { class: 'page' },
    h('div', { class: 'page__head' }, h('h1', {}, 'Setup')),

    h('section', { class: 'card' },
      h('h2', { class: 'card__title' }, 'You'),
      num('Bodyweight', 'bodyweight', 'lb', 'Counts push-ups and assisted pull-ups/dips toward pounds moved.'),
      num('Age', 'age', 'years', maxHr(p) && !p.maxHr ? `Estimated max heart rate: ${maxHr(p)} bpm (208 − 0.7 × age, Tanaka 2001).` : 'Used to estimate max heart rate for zones.'),
      num('Max heart rate (optional)', 'maxHr', 'bpm', 'If you know yours from a test, it beats the estimate.'),
    ),

    h('section', { class: 'card' },
      h('h2', { class: 'card__title' }, 'Schedule'),
      h('div', { class: 'seg' },
        seg('4 days: upper/lower', !st.schedule && st.prefs.mode === '4day', () => { store.setSchedule(null); store.setPref('mode', '4day'); ctx.rerender(); }),
        seg('3 days: full body', !st.schedule && st.prefs.mode === '3day', () => { store.setSchedule(null); store.setPref('mode', '3day'); ctx.rerender(); }),
        st.schedule && seg('Custom schedule', true, () => {}),
      ),
      st.schedule && h('p', { class: 'muted small' }, 'Your own weekly schedule is in use — see Plans below. Pick 4 or 3 days to go back to a built-in one.'),
      toggle('Beep and vibrate when rest is up', 'restAlert', st),
      toggle('Start the rest timer when I log a set', 'autoRest', st),
      toggle('Keep the screen on during a workout', 'keepAwake', st),
      toggle('Suggest warm-up sets on the first big lift', 'warmups', st),
      'Notification' in window && restNotifyToggle(st),
      Object.keys(st.swaps).some((k) => Object.keys(st.swaps[k]).length) &&
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => { store.update((s) => { s.swaps = {}; }); toast('Plan swaps cleared'); ctx.rerender(); } }, 'Reset my permanent swaps'),
    ),

    plansCard(st, ctx),
    gymsCard(st, ctx),
    watchCard(st, ctx),
    claudeCard(ctx),

    h('section', { class: 'card' },
      h('h2', { class: 'card__title' }, 'Your data'),
      h('p', { class: 'muted small' }, 'Everything is stored in this browser on this phone. Export a backup to move it to a new phone. The Claude key is never included.'),
      h('p', { class: 'muted small' }, `Using ${(store.storageEstimate().bytes / 1e6).toFixed(1)} MB of about 5 MB.`),
      photosLine(),
      includePhotos,
      h('div', { class: 'row row--wrap' },
        h('button', {
          class: 'btn',
          type: 'button',
          onClick: async (e) => {
            const btn = e.currentTarget;
            const withPhotos = includePhotos?.querySelector('input')?.checked;
            let text = store.exportJson();
            if (withPhotos) {
              btn.disabled = true;
              try {
                const list = await photos.exportPhotos();
                const data = JSON.parse(text);
                data.photos = list;
                text = JSON.stringify(data, null, 1);
              } finally {
                btn.disabled = false;
              }
            }
            download(`gym-pal-backup-${new Date().toISOString().slice(0, 10)}.json`, text);
            store.recordBackupExported();
            ctx.rerender();
          },
        }, 'Export backup'),
        importButton(ctx),
        h('button', {
          class: 'btn btn--danger-ghost',
          type: 'button',
          onClick: () => {
            const { count } = photos.photoStats();
            if (!confirm(`Erase every workout, note${count ? ', machine photo' : ''} and import on this phone?${count ? ' Photos cannot be brought back with Undo.' : ''}`)) return;
            photos.clearPhotos();
            const { savedPrev } = store.eraseAll();
            toast('Everything erased', savedPrev ? { action: 'Undo', onAction: () => { store.restorePrevious(); ctx.rerender(); } } : undefined);
            ctx.rerender();
          },
        }, 'Erase everything'),
      ),
    ),
    h('p', { class: 'muted small center' }, 'Gym Pal · not medical advice. Stop any exercise that causes pain.'),
  );
}

/** "N machine photos · X MB", or nothing when there are none or photos are unavailable. */
function photosLine() {
  const { count, bytes } = photos.photoStats();
  if (!count) return null;
  return h('p', { class: 'muted small' }, `${pluralize(count, 'machine photo')} · ${fmtSize(bytes)} (kept separately from the 5 MB above).`);
}

/** "Include photos" for Export, off by default. Hidden when there are no photos. */
function photosCheckbox() {
  const { count, bytes } = photos.photoStats();
  if (!count) return null;
  // Base64 makes the file about a third bigger than the photos themselves.
  return h('label', { class: 'check' }, h('input', { type: 'checkbox' }), h('span', {}, `Include photos in the backup (adds about ${fmtSize((bytes * 4) / 3)})`));
}

function fmtSize(bytes) {
  return bytes < 100_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

function seg(label, on, onClick) {
  return h('button', { class: `seg__btn${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': on, onClick }, label);
}

function toggle(label, key, st) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.prefs[key], onChange: (e) => store.setPref(key, e.target.checked) }), h('span', {}, label));
}

/** Opt-in background notification when rest ends. Asks for permission on the way in. */
function restNotifyToggle(st) {
  return h(
    'div',
    { class: 'stack' },
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: st.prefs.restNotify,
        onChange: async (e) => {
          if (!e.target.checked) {
            store.setPref('restNotify', false);
            return;
          }
          try {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
              store.setPref('restNotify', true);
            } else {
              e.target.checked = false;
              toast('Notifications were not allowed, so this stays off.');
            }
          } catch {
            e.target.checked = false;
            toast('Could not ask for notification permission.');
          }
        },
      }),
      h('span', {}, 'Notify me if rest ends while the app is in the background'),
    ),
    h('p', { class: 'field__hint' }, 'If the screen is locked the phone may delay this. Keeping the screen on (above) is the reliable option.'),
  );
}

function importButton(ctx) {
  const file = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onChange: async (e) => {
      const input = e.target;
      try {
        const chosen = input.files[0];
        if (!chosen) return;
        const text = await chosen.text();
        const result = store.validateBackup(text);
        if (!result.ok) {
          toast(result.error);
          return;
        }

        const cur = store.getState();
        const curLast = cur.sessions.length ? fmtDate(cur.sessions[cur.sessions.length - 1].startedAt, { month: 'short', day: 'numeric' }) : 'never';
        const newLast = result.summary.sessions ? fmtDate(result.summary.lastAt, { month: 'short', day: 'numeric' }) : 'never';
        const exportedNote = result.summary.exportedAt ? `, exported ${fmtDate(new Date(result.summary.exportedAt).getTime(), { month: 'short', day: 'numeric' })}` : '';
        const droppedNote = result.summary.droppedSessions ? ` ${pluralize(result.summary.droppedSessions, 'damaged workout')} in this file will be skipped.` : '';
        const question =
          `Replace what is on this phone (${pluralize(cur.sessions.length, 'workout')}, last on ${curLast}) ` +
          `with this backup (${pluralize(result.summary.sessions, 'workout')}, last on ${newLast}${exportedNote})?${droppedNote}`;
        if (!confirm(question)) return;

        const { savedPrev } = store.restoreBackup(result.state);
        let photoNote = '';
        try {
          const list = JSON.parse(text)?.photos;
          if (Array.isArray(list) && list.length) {
            const n = await photos.importPhotos(list);
            photoNote = n ? ` with ${pluralize(n, 'machine photo')}` : ' (the photos in it could not be saved here)';
          }
        } catch {
          // the state is restored; photos are a bonus
        }
        toast(`Backup restored${photoNote}`, savedPrev ? { action: 'Undo', onAction: () => { store.restorePrevious(); ctx.rerender(); } } : undefined);
        ctx.rerender();
      } catch (err) {
        toast(err.message ?? 'Could not read that file.');
      } finally {
        input.value = '';
      }
    },
  });
  return h('span', {}, file, h('button', { class: 'btn', type: 'button', onClick: () => file.click() }, 'Restore backup'));
}

// ── Gyms ─────────────────────────────────────────────────────────────────

async function here() {
  const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }));
  return { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5) };
}

function gymsCard(st, ctx) {
  const name = h('input', { class: 'input', placeholder: 'e.g. Planet Fitness – Main St' });
  const add = async (useGps) => {
    const n = name.value.trim() || 'My gym';
    let coords = {};
    if (useGps) {
      try {
        coords = await here();
      } catch {
        toast('Could not get your location — saved without it.');
      }
    }
    store.addGym({ name: n, ...coords });
    toast(`Saved ${n}`);
    ctx.rerender();
  };
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Gyms'),
    h('p', { class: 'muted small' }, 'Save your gym while you are standing in it, and each workout is tagged with where it happened automatically. Location is checked once when you start a workout, and stays on this phone. With more than one gym, machine notes and "not at this gym" are kept per gym.'),
    st.gyms.length > 0 && h('ul', { class: 'plain' }, st.gyms.map((g) =>
      h('li', { class: 'row' },
        h('span', {}, `📍 ${g.name}`, g.chain && h('span', { class: 'muted small' }, ` · ${g.chain}`), g.lat == null && h('span', { class: 'muted small' }, ' (no location)')),
        h('a', { class: 'small', href: mapsLink(g), target: '_blank', rel: 'noopener', title: 'Popular times on Google Maps (leaves the app)' }, 'Popular times ↗'),
        h('button', { class: 'linkish small', type: 'button', onClick: () => editGym(g.id, ctx) }, 'Edit'),
      ),
    )),
    name,
    h('div', { class: 'row row--wrap' },
      h('button', { class: 'btn btn--primary', type: 'button', onClick: () => add(true) }, 'Save — I’m here now'),
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => add(false) }, 'Save name only'),
    ),
  );
}

function editGym(id, ctx) {
  const st = store.getState();
  const g = store.gym(id);
  if (!g) return;
  const field = (label, value, placeholder, hint) => {
    const input = h('input', { class: 'input', value: value ?? '', placeholder });
    return [input, h('label', { class: 'field' }, h('span', {}, label), input, hint && h('span', { class: 'field__hint' }, hint))];
  };
  const [name, nameField] = field('Name', g.name, 'e.g. Planet Fitness – Main St');
  const [chain, chainField] = field('Chain or brand (optional)', g.chain, 'e.g. Planet Fitness');
  const [address, addressField] = field('Address (optional)', g.address, 'e.g. 123 Main St');
  const loc = h('p', { class: 'muted small' }, g.lat != null ? `Location saved (${g.lat}, ${g.lng}).` : 'No location saved, so workouts here will ask which gym.');
  const others = st.gyms.filter((x) => x.id !== id && Object.keys(st.gymNotes[x.id] ?? {}).length);
  const from = others.length > 0 && h('select', { class: 'input' }, others.map((x) => h('option', { value: x.id }, x.name)));
  const tagged = st.sessions.filter((x) => x.gymId === id).length;

  const save = () => {
    store.updateGym(id, { name: name.value.trim() || g.name, chain: chain.value.trim() || undefined, address: address.value.trim() || undefined });
  };
  const dialog = modal(
    `Edit ${g.name}`,
    h('div', { class: 'stack' },
      nameField,
      chainField,
      addressField,
      loc,
      h('button', {
        class: 'btn btn--ghost',
        type: 'button',
        onClick: async () => {
          try {
            store.updateGym(id, await here());
            const n = store.gym(id);
            loc.textContent = `Location updated (${n.lat}, ${n.lng}).`;
            toast('Location updated');
          } catch {
            toast('Could not get your location.');
          }
        },
      }, 'Update location to where I am now'),
      from && h('h3', { class: 'eyebrow' }, 'Start from another gym’s notes'),
      from && h('div', { class: 'row' }, from,
        h('button', {
          class: 'btn btn--ghost btn--small',
          type: 'button',
          onClick: () => {
            store.copyGymNotes(from.value, id);
            toast(`Copied notes from ${store.gym(from.value)?.name}. Notes already written here were kept.`);
          },
        }, 'Copy notes')),
      h('div', { class: 'row row--wrap' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => dialog.close() }, 'Save'),
        h('button', {
          class: 'btn btn--danger-ghost',
          type: 'button',
          onClick: () => {
            const msg = `Remove ${g.name} and its machine notes?${tagged ? ` ${tagged} workout${tagged > 1 ? 's are' : ' is'} tagged with it and will keep their sets, but no gym name.` : ''}`;
            if (!confirm(msg)) return;
            store.removeGym(id);
            toast(`Removed ${g.name}`);
            dialog.close();
          },
        }, 'Remove gym'),
      ),
    ),
  );
  dialog.addEventListener('close', () => {
    if (store.gym(id)) save();
    ctx.rerender();
  });
}

// ── Galaxy Watch ─────────────────────────────────────────────────────────

function watchCard(st, ctx) {
  const w = st.watch;
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const file = h('input', {
    type: 'file', multiple: true, accept: '.zip,.csv,application/zip,text/csv', hidden: true,
    onChange: async (e) => {
      const input = e.target;
      const files = [...input.files];
      try {
        if (!files.length) return;
        status.textContent = 'Reading…';
        const read = await readFiles(files, (msg) => (status.textContent = msg));
        if (!read.length) {
          status.textContent = 'No Samsung Health files found in that selection. Pick the export zip, or the CSV files inside it.';
          return;
        }
        status.textContent = 'Crunching…';
        await new Promise((r) => setTimeout(r, 20));
        const watch = buildWatch(read, store.getState().sessions);
        const totalDays = Object.keys(watch.days).length;
        const { state: trimmed, droppedDays } = store.trimWatchToFit({ ...store.getState(), watch });
        store.setWatch(trimmed.watch);
        const keptDays = Object.keys(trimmed.watch.days).length;
        const fitNote = droppedDays ? ` Kept the most recent ${keptDays} of ${totalDays} days to fit on this phone.` : '';
        toast(`Imported ${watch.workouts.length} watch workouts and ${keptDays} days.${fitNote}`);
        ctx.rerender();
      } catch (err) {
        status.textContent = err.message ?? 'Import failed.';
      } finally {
        input.value = '';
      }
    },
  });

  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Galaxy Watch'),
    h('h3', { class: 'eyebrow' }, 'Import from Samsung Health'),
    h('ol', { class: 'steps small' },
      h('li', {}, 'In Samsung Health, open the menu (≡ or your profile) → Settings → Download personal data → Download.'),
      h('li', {}, 'It saves to your phone’s Download folder (Download/Samsung Health). If it is a zip, pick the zip; otherwise pick all the CSV files.'),
      h('li', {}, 'Re-import whenever you like. It replaces the last import and links watch heart rate to the workouts you logged.'),
    ),
    file,
    h('button', { class: 'btn btn--primary', type: 'button', onClick: () => file.click() }, w ? 'Re-import' : 'Choose export files'),
    status,
    w && h('p', { class: 'small' },
      `Last import ${fmtRel(w.importedAt)}: ${w.workouts.length} workouts, ${Object.keys(w.days).length} days, ${w.hrSamples.length} heart-rate readings during your gym sessions`,
      w.range ? ` (data from ${fmtDate(w.range.from, { month: 'short', year: 'numeric' })} to ${fmtDate(w.range.to, { month: 'short', day: 'numeric', year: 'numeric' })}).` : '.',
    ),
    w && h('button', { class: 'linkish small', type: 'button', onClick: () => { store.setWatch(null); ctx.rerender(); } }, 'Remove imported watch data'),

    h('h3', { class: 'eyebrow' }, 'Live heart rate (Bluetooth)'),
    hr.supported()
      ? h('div', { class: 'stack' },
          h('p', { class: 'muted small' }, 'Works with Chrome on Android. A Galaxy Watch does not broadcast heart rate on its own: install a heart-rate broadcast app on the watch from the Play Store on the watch (search "heart rate broadcast"), start it, then connect here. Chest straps work directly.'),
          hr.connected()
            ? h('div', { class: 'row' }, h('span', {}, `Connected: ${hr.deviceName() ?? 'sensor'} · ${hr.latest() ?? '–'} bpm`), h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => { hr.disconnect(); ctx.rerender(); } }, 'Disconnect'))
            : h('button', { class: 'btn', type: 'button', onClick: async () => { try { toast(`Connected to ${await hr.connect()}`); } catch (err) { if (err?.name !== 'NotFoundError') toast(err.message); } ctx.rerender(); } }, 'Connect a heart-rate sensor'),
        )
      : h('p', { class: 'muted small' }, 'This browser does not support Bluetooth. Use Chrome on Android for live heart rate; the Samsung Health import works everywhere.'),
  );
}

// ── Claude ───────────────────────────────────────────────────────────────

function claudeCard(ctx) {
  const has = ai.hasKey();
  const u = ai.usage();
  const input = h('input', { class: 'input mono', type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off' });
  return h('section', { class: 'card' },
    h('h2', { class: 'card__title' }, 'Claude coach'),
    h('p', { class: 'muted small' }, 'Optional. Adds a coach you can ask mid-workout, machine identification from a photo, and a written read of your week. The key is stored only on this phone, in its own slot outside your data, so it is never in a backup or the repo. Requests go straight from this phone to Anthropic.'),
    has
      ? h('div', { class: 'stack' },
          h('p', {}, '✓ Key saved on this phone.'),
          h('p', { class: 'muted small' }, `${u.calls} requests · ${(u.inputTokens / 1000).toFixed(1)}k tokens in · ${(u.outputTokens / 1000).toFixed(1)}k out${u.since ? ` since ${u.since}` : ''}. Billing is on your Anthropic console.`),
          h('div', { class: 'row row--wrap' },
            h('button', { class: 'btn btn--ghost', type: 'button', onClick: async () => { try { await ai.testKey(); toast('Key works'); } catch (err) { toast(err.message); } ctx.rerender(); } }, 'Test key'),
            h('button', { class: 'btn btn--danger-ghost', type: 'button', onClick: () => { ai.clearKey(); ctx.rerender(); } }, 'Remove key'),
          ),
        )
      : h('div', { class: 'stack' },
          input,
          h('button', {
            class: 'btn btn--primary',
            type: 'button',
            onClick: async () => {
              const k = input.value.trim();
              if (!ai.looksLikeKey(k)) return toast('That does not look like an Anthropic key (sk-ant-…).');
              ai.setKey(k);
              try {
                await ai.testKey();
                toast('Key saved and working');
              } catch (err) {
                toast(err.message);
              }
              ctx.rerender();
            },
          }, 'Save key'),
          h('p', { class: 'muted small' }, 'Get one at console.anthropic.com → API keys.'),
        ),
  );
}
