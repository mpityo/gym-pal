# 15 · Custom exercises and a plan editor

**Type:** feature · **Suggested implementer:** Opus (cross-cutting: library lookup, store, schedule, five views) · **Size:** large · **Land after** the bug-fix specs; touches the same files as specs 07 and 12, so merge those first if they are in flight.

## Why

Two hard limits make the app fit exactly one person's routine:

1. **The library is closed.** The 59 entries in `assets/js/data/exercises.js` are all there is. A machine your gym has that is not on the list cannot be logged; the photo-identify flow even says so: "This one is not in the library, so it cannot be tracked by name yet" (`views/machines.js`).
2. **The plans are code.** Sets, reps, rest, order and which day is which live in `assets/js/data/plans.js` and the `WEEK` constant. The only customisation is a permanent one-for-one swap. Changing 3×8–12 to 4×6–10, adding face pulls to Upper B, or training Mon/Wed/Fri/Sat requires editing source.

Custom exercises and editable routines are table stakes in every comparable app.

## Part A — custom exercises

### Data

```js
// store.js defaultState
customExercises: [],   // same shape as library entries, id 'c-<uid>', plus { custom: true, hidden?: true }
```

### Lookup — one registry

`metrics.js` and every view resolve ids through `exercise(id)` from `data/exercises.js`. Keep that as the single lookup and make it aware of custom entries:

- In `data/exercises.js` add `registerCustom(list)` (replaces the custom set, rebuilds a `CUSTOM_BY_ID` map) and `allExercises({ includeHidden = false } = {})` (library followed by custom). `exercise(id)` checks `BY_ID` then `CUSTOM_BY_ID`.
- `store.js` calls `registerCustom(state.customExercises)` after `load()`, in `replaceState()` and after any custom-exercise mutation.
- Replace direct uses of the `EXERCISES` array in views with `allExercises()`: `views/machines.js` (list, identify), `views/common.js` (swap search, exercise picker), `views/coach.js` (`library`). `grep -n "EXERCISES" assets/js` to find them all. Tests that validate the built-in library keep using `EXERCISES`.

### UI

- Machines page: **+ Add your own** button → form: name (required, unique among visible exercises), type chips `Machine/cable (weight stack)` → `track: 'weight', load: 'stack'`, `Plate-loaded` → `plates`, `Dumbbells (pair)` → `pair`, `Single dumbbell/kettlebell` → `single`, `Bodyweight` → `track: 'bodyweight', load: 'body'`, `Timed hold` → `track: 'time'`, `Cardio` → `track: 'cardio', load: 'none'`; movement chips push / pull / legs / core / cardio; primary and secondary muscles (multi-select chips from `MUSCLES`; at least one primary unless cardio); weight step (5 or 10); optional "what it looks like", set-up steps and cues (one per line); optional swaps chosen with the exercise picker.
- A custom exercise's machine page shows **Edit** and **Delete**. Delete with history → set `hidden: true` (it disappears from pickers and lists but old sessions still render); without history → remove it.
- Identify-from-photo: when Claude returns `exerciseId: 'none'`, replace the dead-end message with **Add "{name}" to my exercises**, opening the form pre-filled from the response (`name`, `setup`, `cues`; map `muscles` text to chips when it matches, else leave for the user).
- Mark custom rows with a small "yours" tag.

## Part B — plan editor

### Data

```js
customPlans: {},   // planId -> { id, name, tint, items: [{ ex, sets, reps:[min,max] | secs:[min,max] | minutes | miles, rest, note }] }
schedule: null,    // null = built-in WEEK; else { 0..6: planId | null } keyed by Date.getDay()
```

- `getPlan(id)` in `store.js` returns `customPlans[id] ?? PLAN_BY_ID[id]`; `allPlans()` returns built-ins (with overrides applied) plus user-created plans (ids `p-<uid>`). Replace `PLAN_BY_ID[...]` / `PLANS` reads in `store.js`, `views/today.js`, `views/workout.js`, `views/coach.js` with these.
- `planItems(planId)`: when a custom version exists, use its items and ignore `state.swaps[planId]`. When the user first edits a built-in plan, seed the custom copy from `planItems()` so existing permanent swaps are baked in, then delete `swaps[planId]`.
- Sessions already snapshot their targets into `entries[].target` at start, so editing a plan never changes past workouts.

### Schedule

`todayPlan()` (`views/today.js`) and the week strip read the `WEEK` constant. Add `weekSchedule(state)` returning the same shape (`[{ day, label, plan, note }]`, Monday first) from `state.schedule` when set, else `WEEK`. Use it in `todayPlan`, the strip and the "missed/upcoming" logic. `weekTarget` becomes the number of scheduled days. The 3-day mode keeps working as is when `schedule` is null; when a custom schedule is set it takes precedence and the 4-day/3-day switch in Setup shows "Custom schedule" as a third state.

### UI — Setup → "Plans"

- List of plans with day(s) assigned. Tap → editor:
  - Name.
  - Items in order, each row: exercise name, `sets × reps`, rest. Tap to edit sets (1–8), rep range or seconds range or minutes/miles (depending on the exercise's `track`), rest (30–300 s in 15 s steps), note. **↑ / ↓** buttons to reorder (no drag-and-drop needed), **Remove**.
  - **+ Add exercise** (picker; defaults from `store.addEntry`'s rules).
  - **Reset to default** (built-in plans) / **Delete plan** (user-created; also clears it from the schedule).
- **+ New plan** (name → empty plan, or "Copy of …").
- **Weekly schedule**: seven rows Mon–Sun, each a select of plan or Rest. **Reset to the built-in week**.
- A live summary under the editor, using existing metrics: estimated minutes (move `estimateMinutes` from `today.js` to `metrics.js`) and weekly sets per muscle across the scheduled plans versus the 10-set line (pure function `plannedMuscleSets(plans)`, shown with `hbars`). This is the guard rail that keeps a hand-edited plan sensible.

README: update "The plan" section.

## Tests

- Registry: `exercise('c-1')` resolves after `registerCustom`; `allExercises()` excludes hidden unless asked; metrics (`sessionSummary`, `muscleSets`, `suggest`) work on a custom exercise.
- `getPlan` / `planItems` precedence: custom over built-in; seeding bakes swaps in; reset restores the built-in.
- `weekSchedule` + `todayPlan` with a custom Mon/Wed/Fri/Sat schedule: correct plan today, missed list, `weekTarget === 4`; with `schedule: null` every existing `todayPlan` expectation is unchanged.
- `plannedMuscleSets` for the built-in 4-day week matches `muscleSets` of a week in which each plan is done once in full.
- Backup round-trip includes `customExercises`, `customPlans`, `schedule`; a backup from before this change loads.

## Acceptance criteria

- [ ] A new exercise can be created, logged in a workout, appears in History, Stats and Machines, and gets weight suggestions next time.
- [ ] "What's this machine?" offers to add an unknown machine and pre-fills the form.
- [ ] A built-in plan's sets/reps/rest/order can be changed, exercises added and removed, and the plan reset.
- [ ] A new plan can be created and assigned to a weekday; Today and the week strip follow the custom schedule.
- [ ] Past workouts are unchanged by plan edits; deleting a custom exercise with history keeps that history readable.
- [ ] With no customisation, the app behaves exactly as before and all existing tests pass.

## Out of scope

Supersets/circuits, sharing plans between users, AI-generated plans (a natural follow-up once plans are data).

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
