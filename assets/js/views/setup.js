import { h, toast, download, fmtRel, fmtDate } from '../util.js';
import * as store from '../store.js';
import * as ai from '../ai.js';
import * as hr from '../hr.js';
import { readFiles, buildWatch } from '../samsung.js';
import { maxHr } from '../metrics.js';

export function renderSetup(ctx) {
  const st = store.getState();
  const p = st.profile;

  const num = (label, key, unit, hint) =>
    h('label', { class: 'field' },
      h('span', {}, label),
      h('span', { class: 'field__row' },
        h('input', { class: 'input mono', type: 'text', inputMode: 'decimal', value: p[key] ?? '', onChange: (e) => { const v = e.target.value.trim(); store.setProfile({ [key]: v ? Number(v) : null }); ctx.rerender(); } }),
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
        seg('4 days: upper/lower', st.prefs.mode === '4day', () => { store.setPref('mode', '4day'); ctx.rerender(); }),
        seg('3 days: full body', st.prefs.mode === '3day', () => { store.setPref('mode', '3day'); ctx.rerender(); }),
      ),
      toggle('Beep and vibrate when rest is up', 'restAlert', st),
      toggle('Start the rest timer when I log a set', 'autoRest', st),
      toggle('Keep the screen on during a workout', 'keepAwake', st),
      'Notification' in window && restNotifyToggle(st),
      Object.keys(st.swaps).some((k) => Object.keys(st.swaps[k]).length) &&
        h('button', { class: 'btn btn--ghost btn--small', type: 'button', onClick: () => { store.update((s) => { s.swaps = {}; }); toast('Plan swaps cleared'); ctx.rerender(); } }, 'Reset my permanent swaps'),
    ),

    gymsCard(st, ctx),
    watchCard(st, ctx),
    claudeCard(ctx),

    h('section', { class: 'card' },
      h('h2', { class: 'card__title' }, 'Your data'),
      h('p', { class: 'muted small' }, 'Everything is stored in this browser on this phone. Export a backup to move it to a new phone. The Claude key is never included.'),
      h('div', { class: 'row row--wrap' },
        h('button', { class: 'btn', type: 'button', onClick: () => download(`gym-pal-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson()) }, 'Export backup'),
        importButton(ctx),
        h('button', { class: 'btn btn--danger-ghost', type: 'button', onClick: () => { if (confirm('Erase every workout, note and import on this phone?')) { store.replaceState(store.defaultState()); ctx.rerender(); } } }, 'Erase everything'),
      ),
    ),
    h('p', { class: 'muted small center' }, 'Gym Pal · not medical advice. Stop any exercise that causes pain.'),
  );
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
      try {
        store.importJson(await e.target.files[0].text());
        toast('Backup restored');
        ctx.rerender();
      } catch (err) {
        toast(err.message);
      }
    },
  });
  return h('span', {}, file, h('button', { class: 'btn', type: 'button', onClick: () => file.click() }, 'Restore backup'));
}

// ── Gyms ─────────────────────────────────────────────────────────────────

function gymsCard(st, ctx) {
  const name = h('input', { class: 'input', placeholder: 'e.g. LA Fitness – Pinellas Park' });
  const add = async (useGps) => {
    const n = name.value.trim() || 'My gym';
    let coords = {};
    if (useGps) {
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }));
        coords = { lat: +pos.coords.latitude.toFixed(5), lng: +pos.coords.longitude.toFixed(5) };
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
    h('p', { class: 'muted small' }, 'Save your gym while you are standing in it, and each workout is tagged with where it happened automatically. Location is checked once when you start a workout, and stays on this phone.'),
    st.gyms.length > 0 && h('ul', { class: 'plain' }, st.gyms.map((g) =>
      h('li', { class: 'row' }, h('span', {}, `📍 ${g.name}`, g.lat == null && h('span', { class: 'muted small' }, ' (no location)')), h('button', { class: 'linkish small', type: 'button', onClick: () => { store.removeGym(g.id); ctx.rerender(); } }, 'Remove')),
    )),
    name,
    h('div', { class: 'row row--wrap' },
      h('button', { class: 'btn btn--primary', type: 'button', onClick: () => add(true) }, 'Save — I’m here now'),
      h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => add(false) }, 'Save name only'),
    ),
  );
}

// ── Galaxy Watch ─────────────────────────────────────────────────────────

function watchCard(st, ctx) {
  const w = st.watch;
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const file = h('input', {
    type: 'file', multiple: true, accept: '.zip,.csv,application/zip,text/csv', hidden: true,
    onChange: async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      try {
        status.textContent = 'Reading…';
        const read = await readFiles(files, (msg) => (status.textContent = msg));
        if (!read.length) {
          status.textContent = 'No Samsung Health files found in that selection. Pick the export zip, or the CSV files inside it.';
          return;
        }
        status.textContent = 'Crunching…';
        await new Promise((r) => setTimeout(r, 20));
        const watch = buildWatch(read, store.getState().sessions);
        store.setWatch(watch);
        toast(`Imported ${watch.workouts.length} watch workouts and ${Object.keys(watch.days).length} days`);
        ctx.rerender();
      } catch (err) {
        status.textContent = err.message ?? 'Import failed.';
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
