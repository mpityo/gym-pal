# 14 · Warm-up sets and a plate calculator

**Type:** feature · **Suggested implementer:** Sonnet · **Size:** medium

## Why

- The plans start each day with 5 minutes on the treadmill and then go straight to working weight on the first heavy lift. Trackers such as Strong and Hevy generate a couple of lighter ramp-up sets for the first big lift; it is standard practice and beginners rarely know to do it.
- For plate-loaded equipment (`load: 'plates'` in `assets/js/data/exercises.js` — leg press, hack squat, Smith machine, plate-loaded presses) the app says "Try 140 lb" and leaves the arithmetic of which plates go on each side to the lifter.

## What to build

### 1. Plate calculator (pure, in `assets/js/metrics.js`)

```js
/**
 * Plates for ONE side to reach `total` pounds of added plates (the number this app logs for
 * `load: 'plates'` exercises: plates only, both sides together, bar/sled excluded).
 * Greedy from the largest plate. Returns { perSide: [45, 10, 2.5], achieved, exact }.
 */
export function platesPerSide(total, available = [45, 35, 25, 10, 5, 2.5]) { … }
```

- If `total` cannot be made exactly, return the closest loading at or below it with `exact: false`.
- Single-sided machines do not exist in the library today; if one is added later it can pass `sides: 1`. Add the option, default `2`.

UI (`views/workout.js`, in `inputForm` for exercises with `ex.load === 'plates'`): a muted line under the weight stepper that updates as the value changes: `Each side: 45 + 10 + 2.5` (or `Each side: 45 + 10 (= 110, closest to 112)`). Tapping it opens a small sheet to tick which plate sizes the gym has; store as `prefs.plates` (default all six). Show the same line on Today's preview next to the suggested weight for plate-loaded lifts.

### 2. Warm-up sets

**Which exercises:** the first `track: 'weight'` exercise of the session for each of the patterns `push`, `pull`, `legs` whose plan rest is ≥ 120 s (that selects the big compound lifts in `plans.js` and skips curls and raises). Pure helper: `needsWarmup(entries, index)`.

**What to suggest** (pure, tested): `warmupSets(workW, step) → [{ w, reps }]`:

- working weight < 4 × step → no warm-up sets (too light to ramp);
- otherwise `[{ w: round(0.5 × workW), reps: 8 }, { w: round(0.75 × workW), reps: 4 }]`, rounded down to the exercise's `step`, dropping duplicates and anything equal to the working weight.

Working weight is `suggest(...).w`; no suggestion yet (first time) → no warm-ups.

**UI** (`openEntry`): above the log form, a "Warm-up" row of chips, e.g. `50 × 8` `75 × 4`. Tapping a chip logs it as a set with `warmup: true` (it turns into a ticked chip; tapping again removes that set). Warm-up sets appear in the set list labelled "Warm-up" instead of "Set n", do not start the rest timer at full length (use 45 s), and never advance to the next exercise. A Setup toggle "Suggest warm-up sets" (`prefs.warmups`, default `true`) turns the row off.

**Counting rules** — warm-up sets must not distort training numbers. Update `metrics.js`:

| Function | Warm-up sets |
| --- | --- |
| `sessionSummary` → `tonnage`, `reps`, `byPattern` | counted (the weight was moved) |
| `sessionSummary` → `workSets`, rest average | **not** counted |
| `muscleSets` | **not** counted |
| `exerciseHistory` → `best`, and therefore `suggest`, `exerciseRecords`, `newRecords` | **ignored** (filter them out of `sets` used for strength; keep them in `tonnage`) |
| `machineUsage` → `sets` | **not** counted |

Implement with one helper `const work = (sets) => sets.filter((s) => !s.warmup)` and use it consistently. `done(entry)` in `workout.js` and the "Log set n" label count only work sets. Display helpers (`summarizeSets`, History `setText`) prefix warm-ups with `w`.

README: add a line to "Where the numbers come from" explaining the rules above.

## Tests

- `platesPerSide(140)` → `[45, 25]`; `(90)` → `[45]`; `(5)` → `[2.5]`; `(112)` → closest 110, `exact: false`; restricted `available` (no 35s, no 2.5s); `0` → `[]`.
- `warmupSets(100, 5)` → `[{50, 8}, {75, 4}]`; `(15, 5)` → `[]`; rounding with a 10 lb step; no duplicate of the working weight.
- `needsWarmup` on the Upper A and Lower B plans picks the expected entries.
- A session with one warm-up and three work sets: `workSets === 3`, tonnage includes all four, `muscleSets` counts 3, `suggest` and `exerciseRecords` ignore the warm-up (a heavy single flagged `warmup` must not become a record).

## Acceptance criteria

- [ ] Plate-loaded lifts show the per-side plate breakdown, updating as the weight changes, respecting the plates ticked as available.
- [ ] The first big push/pull/leg lift of a workout offers two warm-up chips derived from the suggested weight; logging them does not complete the exercise or change "Log set 1".
- [ ] Warm-up sets never affect suggestions, records or sets-per-muscle, but do count toward pounds moved.
- [ ] The Setup toggle hides the warm-up row.
- [ ] Existing tests pass unchanged (sets without the `warmup` flag behave exactly as before).

## Out of scope

Barbell support with a bar weight (the library has no free barbell lifts), kg units.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
