# 07 · Gym profiles: make the app work for any gym, and for more than one

**Type:** feature · **Suggested implementer:** Opus (touches store, four views and copy) · **Size:** large · **Do before** specs 09, 10, 11 (they key their data by gym).

## Why

The app is written as "a workout tracker for LA Fitness" and assumes one gym:

- Machine notes are global. `state.machineNotes[exId] = { where, settings }` (`store.js:121`) holds a single "where it is" per exercise, so "back wall by the mirrors" shows up at every gym.
- Nothing records that a gym does not have a machine. The only tool is the per-plan permanent swap, which then applies at every gym.
- Gyms can be added and removed but not renamed or re-located, and the gym for a workout cannot be changed after Start.
- If GPS fails or you are not within 400 m of a saved gym, `locate()` (`today.js:37–49`) silently tags the workout with `gyms[0]` (on failure) or nothing.
- Copy is LA Fitness specific: `README.md:3`, `setup.js:91` placeholder, `ai.js:229` coach system prompt, `data/exercises.js:5` comment.

## What to build

### 1. Data model (`store.js`)

```js
gyms: [{ id, name, lat, lng, chain?: string, address?: string }],
/** gymId -> exId -> { where, settings, missing } — what is true at that gym */
gymNotes: {},
/** existing field, now the "any gym" default */
machineNotes: {},
prefs: { …, currentGymId: null },   // the gym shown outside a workout
```

- `machineNote(exId, gymId = currentGym())` returns `{ where, settings, missing }` merged field by field: the gym's note wins, the global note fills gaps. `currentGym()` is `state.active?.gymId ?? state.prefs.currentGymId ?? (state.gyms.length === 1 ? state.gyms[0].id : null)`.
- `setMachineNote(exId, patch, gymId = currentGym())` writes to `gymNotes[gymId][exId]` when there is a gym, else to `machineNotes`.
- `updateGym(id, patch)`, `setCurrentGym(id)`. `removeGym(id)` also deletes `gymNotes[id]` and clears `prefs.currentGymId` if it pointed there (sessions keep their `gymId`; views already handle a missing gym).
- No destructive migration: existing `machineNotes` simply become the defaults.

### 2. Choosing the gym

- `locate()` returns `{ gymId, geo, certain }`. `certain` is true only when GPS put you inside a saved gym. Never fall back to `gyms[0]` when there are two or more gyms.
- `start()`: if `!certain` and there are ≥ 2 gyms, open a small modal "Which gym?" listing the gyms (last used first) plus "Somewhere else". With exactly one gym and no GPS match, use it. Set `prefs.currentGymId` to the choice.
- Workout header (`workout.js`, the `📍` eyebrow): make it a button that opens the same picker and calls a new `store.setSessionGym(id)`.
- History → session sheet: the gym line becomes editable the same way (`store.updateSession(id, { gymId })`).
- Today, Machines and the machine page show a small gym switcher chip (`📍 Name ▾`) when there are ≥ 2 gyms; it sets `prefs.currentGymId`.

### 3. "My gym doesn't have this"

- Machine page (`machines.js` `renderMachine`, "Finding it" card) and the How-to sheet (`common.js` `openHowTo`): a checkbox "Not at {gym name}". Stored as `missing: true` in that gym's note. Hidden when there is no current gym.
- `store.planItems(planId, gymId = currentGym())`: after applying permanent swaps, if the resulting exercise is `missing` at that gym, replace it with the first entry of its `alts` that is not missing, and mark the item `{ swappedFrom, autoSwap: true }`. If every alt is missing, keep the original and mark `unavailable: true`.
- Today preview: show the tag "not at this gym → swapped" for `autoSwap`, and "not at this gym" in the warning colour for `unavailable`.
- `startSession` uses the gym-aware `planItems`. If the gym is changed mid-workout, do **not** rewrite entries that already have sets; re-resolve only untouched ones.
- Swap picker and exercise picker (`common.js`): sort missing exercises last and label them "not at this gym".
- Machines list: a filter chip "At my gym" (hides missing) when a gym is selected.

### 4. Gym management (Setup → Gyms)

Each gym row gets **Edit**: name, optional chain/brand and address (free text; used by specs 10 and 11), "Update location to where I am now", and Remove (confirm, mentioning how many workouts are tagged with it). Add "Copy notes from another gym" (copies that gym's `gymNotes` as a starting point).

### 5. Copy

- `README.md:3` → "A workout tracker for any gym with machines, cables and dumbbells." Adjust the Machines row and add a short "Gyms" section describing per-gym notes and "not at this gym".
- `setup.js:91` placeholder → "e.g. Planet Fitness – Main St".
- `ai.js` `COACH_SYSTEM`: drop "(LA Fitness)"; add the current gym's name/chain and the list of exercise ids marked missing there to the context built in `coach.js`, and tell the coach not to suggest missing ones.
- `data/exercises.js:5`: generalise the comment.
- `manifest.webmanifest` / `index.html` descriptions need no change.

## Tests

- `machineNote` merge order (gym note over global, field by field); writing with and without a current gym.
- `planItems` auto-swap: picks the first non-missing alt; respects a permanent swap; `unavailable` when all alts are missing; different results for two gyms.
- `removeGym` cleans up notes and `currentGymId`.
- Old state (no `gymNotes`, no `currentGymId`) loads and behaves exactly as before.

## Acceptance criteria

- [ ] With two gyms saved, a "where" note written at gym A is not shown at gym B; a note written before this change shows at both until overridden.
- [ ] Marking Leg press "not at" gym B makes Lower A at gym B preview and start with its first available swap, while gym A still gets Leg press.
- [ ] With two gyms and GPS denied, Start asks which gym. With one gym it does not ask.
- [ ] The gym can be changed during a workout and on a past workout.
- [ ] Gyms can be renamed and re-located.
- [ ] No "LA Fitness" left in the UI, README or prompts (a placeholder example of another gym name is fine).
- [ ] An existing backup made before this change restores and works.

## Out of scope

A database of real gym chains and their equipment; crowd levels (specs 10, 11); photos (specs 08, 09).

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
