# 13 · Show last time per set, celebrate PRs as they happen, and handle plateaus

**Type:** feature · **Suggested implementer:** Sonnet · **Size:** medium

## Why

Three things the popular trackers do that this one does not yet:

1. **"Previous" next to each set.** The workout screen shows last session as one sentence inside the suggestion reason ("Last time: 100×12, 100×10, 100×9"). While logging set 2 you want to see what set 2 was last time, right at the input.
2. **PRs at the moment they happen.** Records are only listed on the finish screen (`workout.js` `finish` → `newRecords`). A badge the instant you log the set is the single most motivating thing a tracker does.
3. **Plateaus.** `suggest()` (`assets/js/metrics.js:232–311`) keeps you at the same weight forever if you never reach the top of the range, and never suggests backing off. After several stalled sessions a small deload is the standard advice.

Also one small bug in the same function.

## What to build

### 1. Previous performance per set (`views/workout.js` `openEntry`)

- Add to `metrics.js`: `lastPerformance(sessions, exId) → { date, sets } | null` (the most recent session entry for that exercise; thin wrapper over `exerciseHistory`).
- Above the log form show a compact strip: `Last time · Mon Nov 9` then one pill per previous set (`100×12`, `100×10`, `100×9`). The pill matching the set about to be logged (index `entry.sets.length`) is highlighted. Tapping a pill copies its weight and reps into the steppers.
- In each logged row (`sets__row`) add a muted comparison to the same-numbered set last time: `▲ +1 rep`, `▲ +5 lb`, `=`, or `▼ −2 reps` (compare weight first, then reps; for timed holds compare seconds; nothing for cardio).
- When this exercise was swapped in today, the strip is for the exercise actually being done (`entry.ex`), not the planned one.

### 2. Live PR callout

- Add to `metrics.js` a pure function:

  ```js
  /** Records the just-logged set beat, compared with all earlier sessions AND earlier sets today. */
  export function setRecords(set, exId, earlierSessions, earlierSetsToday, bodyweight) → [{ kind, value, was }]
  ```

  Same kinds and rules as `newRecords` (estimated 1-rep max, heaviest set, least assistance, longest hold); only for exercises with history in `earlierSessions` (first-ever session stays quiet, as today). Implement by reusing `exerciseRecords` on `[...earlierSessions, { entries: [{ ex, sets: earlierSetsToday }] }]` versus the same plus the new set, so there is one definition of a record.
- In `inputForm`'s `log()`: after `store.logSet`, call it and, if non-empty, `toast('New record — heaviest set: 105 lb (was 100)')` and mark the set `pr: [kinds]` via `store.editSet` so the row shows a small "PR" tag (also in History's session sheet).
- The finish screen list stays as is.

### 3. Plateau detection and deload in `suggest()`

Only for `track: 'weight'` exercises that are not `assist`, in the final "same weight" branches:

- Look at the last 3 sessions for the exercise (`hist.slice(-3)`). It is a plateau when all three used the same top weight, none was `allMaxed`, and total reps at the top weight did not increase from the first of the three to the last.
- Then return a deload: `w = roundToStep(topW * 0.9, step)` (never below one step), `reps = max`, `text: '<w> lb'`, `deload: true`, `reason: 'Three sessions at <topW> lb without adding reps. Drop to <w> lb for clean sets of <max>, then build back up.'`
- The session after a deload is handled by the existing rules (all sets at the top of the range → go up one step).
- UI: in `openEntry`'s guide add a `guide--deload` style and a "↓" prefix, mirroring `guide--up` / "↑". Today's preview gets the same marker.

### 4. Bug: bodyweight suggestion text and value disagree

`metrics.js:275`: `reps: Math.min(best + 1, max + 5), text: \`${best + 1} reps\``. When `best + 1` exceeds `max + 5` the form is pre-filled with one number while the text says another. Compute `const next = Math.min(best + 1, max + 5)` once and use it for both; when capped, change the reason to "You are well past the range — add weight or pick a harder variation."

## Tests

- `lastPerformance`: none, one, several sessions; picks the latest.
- `setRecords`: no history → `[]`; heavier than ever → heaviest set (+ e1RM); second identical set today → `[]`; assisted exercise with less assist → least assistance; longer hold.
- `suggest` plateau: three flat sessions → `deload: true` at 90% rounded to the exercise step (check a 5 lb and a 10 lb step exercise); improving reps → no deload; two sessions only → no deload; all maxed → still goes up.
- Bodyweight text/value consistency.

## Acceptance criteria

- [ ] The open exercise shows last time's sets as pills, with the upcoming set highlighted; tapping a pill fills the steppers.
- [ ] Logged rows show the comparison to last time.
- [ ] Beating a record shows a toast immediately and a "PR" tag on that set, once per record.
- [ ] After three flat sessions the suggestion is a deload with the reason shown; otherwise suggestions are unchanged (existing tests still pass).
- [ ] `npm test` passes.

## Out of scope

RPE / reps-in-reserve logging, percentage-based programs, changing the double-progression rules themselves.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
