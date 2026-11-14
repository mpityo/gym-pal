# 05 · Stop losing data silently: failed saves, unconfirmed restore, no backup nudge

**Type:** bug fix / data safety · **Suggested implementer:** Sonnet · **Size:** medium

Everything the user has ever logged lives in one `localStorage` key on one phone. Three things can destroy it without a word.

## Bugs

### A. A failed save is only a `console.warn`

`assets/js/store.js:71–78`:

```js
export function flush() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (err) { console.warn('Could not save', err); }
}
```

`localStorage` is capped at roughly 5 MB per site. The Samsung Health import stores per-day data for the whole export range plus heart-rate samples, and every live-heart-rate workout adds ~720 samples per hour. Once the quota is hit, **every later save fails silently**: the app keeps working from memory, the user finishes a workout, closes the tab, and it is gone.

### B. "Restore backup" overwrites everything with no confirmation and no undo

`assets/js/views/setup.js` `importButton` → `store.importJson` → `replaceState`. Picking the wrong file (an old backup) instantly replaces current data, including a workout in progress. "Erase everything" asks first; restore does not. `importJson` also only checks that `sessions` is an array, so a damaged file can load and then crash the views.

### C. Nothing asks the browser to keep the data, and nothing reminds you to back up

Browsers may evict site storage under pressure unless `navigator.storage.persist()` has been granted. The app never asks. There is also no record of when a backup was last exported.

### D. Picking the same file twice does nothing

The hidden file inputs (`importButton`, the watch import, the photo button in `machines.js`) never clear `value`, so choosing the same file again after an error fires no `change` event.

## Fix

### 1. Surface save failures (`store.js`, `app.js`)

- `flush()` returns `true`/`false` and records `saveError = { name, at }` on failure, clearing it on success. Export `saveStatus()` and notify subscribers.
- In `app.js`, when `saveStatus()` reports an error, render a sticky banner above `#app` (not a toast that disappears): **"Could not save to this phone — storage is full. Export a backup now."** with buttons **Export backup** and, when `state.watch` exists, **Remove imported watch data** (the largest item; then retry `flush()`). Remove the banner when a save succeeds.
- Before a watch import is committed (`setup.js` `watchCard`), measure `JSON.stringify(nextState).length`; if it exceeds ~4,000,000 characters, drop the oldest `days` until it fits and say how much was kept.
- Show approximate usage in Setup → Your data: "Using 1.2 MB of about 5 MB".

### 2. Safe restore

- Parse and validate **before** replacing. Add `validateBackup(data) → { ok, error, summary }` in a DOM-free module: `sessions` is an array; each session has numeric `startedAt` and an `entries` array; each entry has a string `ex` and a `sets` array; drop (and count) anything malformed rather than failing the whole file.
- Show a confirm with the summary: "Replace what is on this phone (41 workouts, last on Nov 12) with this backup (38 workouts, last on Nov 2, exported Nov 3)?"
- Keep the replaced state in a second key `gym-pal.v1.prev` and show `toast('Backup restored', { action: 'Undo', onAction: restorePrevious })`. If writing the undo copy fails for space, skip it and say so in the confirm text.
- Do the same undo copy for "Erase everything".

### 3. Persistence and backup reminders

- After the first workout is finished, call `navigator.storage?.persist?.()` once (store the result in `prefs.persistAsked`). No UI if it is granted; if denied, nothing else changes.
- Add `prefs.lastBackupAt` (set when "Export backup" is used) and show a card on Today when there are ≥ 5 sessions and either no backup ever or ≥ 5 new sessions since the last one: "You have N workouts that are only on this phone. Export a backup" with a button and a "Later" that snoozes for 7 days (`prefs.backupSnoozeUntil`).

### 4. File inputs

Set `e.target.value = ''` at the end of every file input `change` handler (three places listed above).

## Tests

- `validateBackup`: good file; wrapper `{ app, exportedAt, state }` and bare state both accepted; non-JSON; missing `sessions`; malformed session dropped and counted.
- A unit test for the size-trimming helper used by the watch import.
- `flush()` returning `false` when `localStorage.setItem` throws (stub `globalThis.localStorage`). Requires spec 01's `globalThis` change; if 01 is not merged, include that one-line change here.

## Acceptance criteria

- [ ] With `localStorage.setItem` forced to throw (DevTools override), a sticky banner appears and stays until a save succeeds.
- [ ] Restoring a backup shows what will be replaced, and Undo brings the previous data back.
- [ ] A truncated/garbage JSON file is rejected with a clear message and changes nothing.
- [ ] Re-selecting the same file after an error works.
- [ ] Today shows the backup reminder under the stated conditions and it can be snoozed.

## Out of scope

Cloud sync, moving all state to IndexedDB (worth a later spec if storage keeps being tight).

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
