# 12 · Edit logged sets, fix past workouts, and log one you forgot

**Type:** feature · **Suggested implementer:** Sonnet · **Size:** medium

## Why

A mistyped set can only be deleted and re-entered, which also changes its timestamp and therefore the rest-time stats. A finished workout cannot be changed at all: the only button in History is "Delete workout". And a workout done without the phone cannot be recorded. Every mainstream tracker allows all three. `store.editSet` (`assets/js/store.js:254`) already exists but nothing calls it.

Because every stat is derived from `state.sessions` on render (`metrics.js`), edits automatically flow into records, suggestions and charts. No recalculation step is needed.

## What to build

### 1. Edit a set during a workout (`views/workout.js`)

In `openEntry`, each logged row (`sets__row`) becomes tappable (keep the ✕ delete button). Tapping opens a small modal titled "Set 2 · Chest press machine" with the same steppers the log form uses (weight + reps, or seconds, or time + miles), **Save** and **Cancel**. Save calls `store.editSet(i, j, patch)`; `at` is not touched. Reuse the validation from spec 02 if it is merged (otherwise: reps must be a positive integer, weight a finite number ≥ 0).

Refactor: extract the three field groups from `inputForm` into `setFields(ex, draft)` returning `{ node, read() }` so the log form, this modal and the History editor share one implementation.

### 2. Edit a finished workout (`views/history.js`, `store.js`)

Store additions (all call `update`, all no-ops for unknown ids):

```js
export function updateSession(id, patch)                 // name, notes, gymId, startedAt, endedAt
export function editSessionSet(id, entryIndex, setIndex, patch)
export function removeSessionSet(id, entryIndex, setIndex)   // removes the entry when its last set goes
export function addSessionSet(id, entryIndex, set)
export function addSessionEntry(id, exId)
export function removeSessionEntry(id, entryIndex)
```

After any change, keep `state.sessions` sorted by `startedAt` (several metrics assume oldest-first: `exerciseHistory`, `suggest`, `runs`).

In the session sheet (`openSession`) add an **Edit** button that switches the sheet into edit mode:

- Date, start time and duration (`<input type="date">`, `<input type="time">`, minutes). Reject an end before the start and dates in the future.
- Gym picker (list of saved gyms + none).
- Notes textarea.
- Each exercise: its sets as tappable rows (same set modal as above), "+ set" (pre-filled from the last set), remove exercise.
- "+ Add exercise" (existing `openExercisePicker`).
- **Done** leaves edit mode. Changes save as they are made, like the rest of the app.

Sets added later get `at: null`; `sessionSummary` already ignores missing `at` when averaging rest. Verify and add a test.

### 3. Log a past workout

History page header: **+ Log a past workout**. Flow: pick the date (default yesterday), start time, duration, and a plan or Freestyle → creates a finished session directly (`store.addPastSession({ planId, startedAt, endedAt })`, entries empty, flagged `manual: true`) and opens it in edit mode with the plan's exercises listed as empty, tappable placeholders to fill in. Exercises left empty are not saved. Show "added later" on manual sessions in History.

Do not allow a manual session to overlap an in-progress one in a confusing way: it never touches `state.active`.

### 4. Undo for deletes

Deleting a set (in a workout or in History), an exercise, or a whole workout shows `toast('Deleted', { action: 'Undo', … })` restoring the removed item at its original position. `util.toast` already supports actions.

## Tests (`test/store.test.mjs`; needs spec 01's `globalThis` fix, include the one-liner if 01 is not merged)

- `editSet` changes values and keeps `at`.
- `editSessionSet` / `removeSessionSet` / `addSessionSet`; removing the last set removes the entry; removing the last entry keeps the session only if another entry remains, otherwise deletes the session.
- Changing `startedAt` re-sorts sessions; `suggest()` then uses the correct "last" session.
- `addPastSession` inserts in order and never changes `active`.
- `sessionSummary` with sets that have `at: null`.

## Acceptance criteria

- [ ] Tapping a logged set in a workout lets you change weight/reps and keeps its time.
- [ ] A past workout's sets, exercises, notes, gym, date and duration can be changed, and Stats/records/suggestions reflect it immediately.
- [ ] A forgotten workout can be added for a past date and appears in the right week in History and the heatmap.
- [ ] Deletes can be undone from the toast.
- [ ] `npm test` passes.

## Out of scope

Editing heart-rate samples; bulk edits; reordering exercises inside a finished session.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
