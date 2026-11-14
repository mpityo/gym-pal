# 10 · How busy was it? Your own busy-times history for each gym

**Type:** feature · **Suggested implementer:** Sonnet · **Size:** medium · **Works with any gym, needs no API or key.** Spec 11 adds optional live data on top.

## Why

There is no free, official API for gym busyness: Google does not expose "Popular times" through the Places API, and gym chains do not publish occupancy. But the app already knows exactly when you train and how often you had to swap because a machine was taken. One tap at the end of each workout turns that into a personal, per-gym "when is it quiet" chart that gets better every week, costs nothing and works offline. A deep link covers "what does Google say right now".

## What to build

### 1. Capture

- **Finish screen** (`assets/js/views/workout.js` `finish`, the "Workout done" modal): add a row "How busy was the gym?" with five chips: `Empty · Quiet · Normal · Busy · Packed` (1–5). Tapping saves immediately via a new `store.updateSession(id, { crowd })`; tapping the selected chip again clears it. Optional: no nagging if skipped.
- **History** session sheet (`views/history.js` `openSession`): show the same row so it can be set or changed later.
- **Swap reason** (`views/common.js` `openSwap`, only when opened from a workout): a small chip row above the list, "Why? `Taken` · `Not here` · `Prefer this`", default `Taken`. Store on the entry as `swapReason: 'taken' | 'missing' | 'prefer'` (extend `store.swapExercise(entryIndex, exId, reason)`). If spec 07 is merged, choosing `Not here` also offers "Mark as not at this gym".

Data added: `session.crowd` (1–5 or absent), `entry.swapReason`. Both optional, so no migration.

### 2. Metrics (`assets/js/metrics.js`, pure, tested)

```js
/**
 * Per weekday (Mon=0) and hour (0–23): visits, average crowd rating, and "taken" swaps per visit.
 * A session contributes to every clock hour it overlaps. gymId null = sessions with no gym.
 */
export function crowdGrid(sessions, gymId) → { cells: [7][24] of { visits, rated, avg, takenPerVisit }, totalRated }

/** A single 1–5 score per cell: avg rating when rated, nudged up by taken swaps; null when visits === 0. */
export function crowdScore(cell)

/** Best and worst windows, only from cells with ≥ 2 visits. */
export function quietTimes(grid, { limit = 3 }) → [{ day, hour, score, visits }]
export function busyTimes(grid, { limit = 3 })
```

Suggested score: `avg + min(1, takenPerVisit * 0.5)` capped at 5; for unrated cells with visits, `2.5 + min(2, takenPerVisit)` flagged `estimated: true`.

### 3. Show it

- **Stats** (`views/stats.js`): new card "When your gym is quiet" after "Habits". One grid per gym with ≥ 3 rated sessions (gym picker chips if several): rows Mon–Sun, columns for the hours that have any visit ±1 (not all 24). Cell colour uses five levels (reuse the heatmap level classes `l0–l4` from `charts.js`/`app.css`, add a fifth or a separate ramp); empty cells stay blank. Tap a cell → "Tue 6–7 pm: 4 visits, usually Busy, a machine was taken in 3 of 4". Under the grid: "Quietest for you: Sat 9 am, Wed 6 am" and "Busiest: Mon 6 pm". Below 3 rated sessions show "Rate a few more workouts to see this" instead of an empty chart. Add a `crowdHeat(grid)` chart helper in `charts.js`.
- **Today** (`views/today.js`): one muted line on the plan card when there is data for the current weekday and hour ±1: "Mondays around 6 pm have been Busy for you (3 visits). Quieter: Mon 8 pm." Nothing when there is no data.
- **Google link**: on the Stats card and in Setup → Gyms, a link "Popular times on Google Maps" → `https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(name + (address ? ' ' + address : ''))>` (append the gym's `lat,lng` to the query when there is no address). Opens in a new tab; label it clearly as leaving the app.
- **Coach context** (`views/coach.js`): add `gymBusyTimes: { quietest, busiest }` (labels only) when available.

### 4. README

Add a short "Busy times" section: what is recorded, that it is your own history, and why there is no automatic feed.

## Tests

- A session 17:40–18:50 on a Monday contributes a visit to Mon 17 and Mon 18.
- Averages, `takenPerVisit`, and gym filtering.
- `quietTimes`/`busyTimes` ignore cells with one visit and sort correctly; ties broken by more visits.
- Sessions without `crowd` count as visits but not as rated.
- Local-time bucketing: build timestamps with `new Date(y, m, d, h)` so the test passes in any time zone.

## Acceptance criteria

- [ ] Finishing a workout offers the five chips; the choice shows in History and can be changed there.
- [ ] Swapping during a workout records a reason, defaulting to "Taken".
- [ ] With ≥ 3 rated sessions at a gym, Stats shows the grid with quietest/busiest lines; with fewer it shows the prompt.
- [ ] Today shows the hint only when data exists for now ±1 hour.
- [ ] The Google Maps link opens the right place.
- [ ] Existing sessions and backups are unaffected.

## Out of scope

Live occupancy (spec 11), sharing data between users.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
