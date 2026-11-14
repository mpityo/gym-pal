# 06 · Fix the weekly count, double-start, and crashes on unknown exercises

**Type:** bug fix · **Suggested implementer:** Sonnet · **Size:** small–medium

Four separate, small robustness bugs. One commit each.

## A. "5/4 workouts" and a false "All 4 done this week"

`assets/js/views/today.js:30`:

```js
const weekDone = sessions.filter((s) => s.startedAt >= week && !PLAN_BY_ID[s.planId]?.threeDay).length;
```

This counts every session this week that is not a full-body plan: Freestyle sessions (`planId: null`) and repeats of the same plan included. Reproduce: do Upper A on Monday, a Freestyle session on Tuesday and Upper A again on Wednesday. Today shows `3/4 workouts` although only one of the four planned workouts is done; four Freestyle sessions make the rest-day card say "All 4 done this week" (`today.js:144`) while the list of missed workouts still has all four.

Fix: in 4-day mode count **distinct planned workouts done**: `new Set(sessionsThisWeek.map((s) => s.planId).filter((id) => WEEK.some((d) => d.plan === id))).size`. In 3-day mode keep counting full-body sessions but cap the displayed value at the target. Extra/freestyle sessions are shown separately: when there are any, append ` · +N extra` to the "This week" header.

Leave `weekStreak` in `metrics.js` as it is (any N sessions in a week keeps the streak) but add a test documenting that.

## B. Tapping Start twice starts two sessions

`today.js:51–61`: `start()` checks `store.active()`, then `await locate()` (up to 6 s waiting for GPS), then `store.startSession`. A second tap during the wait passes the same check, so a second session replaces the first and two toasts appear. There is also no feedback during those seconds, which is what invites the second tap.

Fix: a module-level `let starting = false` guard around the whole function (reset in `finally`); while starting, disable the tapped button and change its label to "Finding your gym…" (pass the event target into `start`, or re-render with a `starting` flag). Re-check `store.active()` after the `await`.

## C. One unknown exercise id crashes History, Stats, Workout and the coach

`exercise(id)` returns `null` for an id that is not in the library, and many call sites dereference it directly: `history.js:74–78` (`ex.name`, `exercise(e.plannedEx).name`), `stats.js:45, 66, 159–162, 175–182`, `workout.js` (`closedEntry`, `openEntry`), `today.js` preview, `coach.js` context, `machines.js` (`ex.alts.map(exercise)`).

This happens when a backup made by a newer version (with more exercises) is restored into an older cached copy of the app, when an exercise is renamed/removed in `exercises.js`, or when a permanent swap in `state.swaps` points at a removed id. One bad id makes the whole tab render nothing.

Fix:

- In `assets/js/data/exercises.js` add

  ```js
  /** Never null: a placeholder keeps old sessions readable if an id disappears from the library. */
  export function exerciseOr(id) {
    return BY_ID[id] ?? { id, name: `Unknown exercise (${id})`, unknown: true, pattern: 'other', track: 'weight', load: 'stack', step: 5,
      muscles: { primary: [], secondary: [] }, look: '', setup: [], cues: [], mistakes: [], alts: [] };
  }
  ```

- Use `exerciseOr` at every **display** call site listed above. Keep `exercise()` (nullable) where the code already handles `null` (`metrics.js` skips unknown ids — correct, leave it).
- `store.planItems`: ignore a swap whose target id is unknown (fall back to the plan's own exercise).
- `store.startSession` / `swapExercise` / `addEntry` already validate; add a test.
- `machines.js` "If it is taken": `ex.alts.map(exercise).filter(Boolean)`.

## D. Wake-lock request can be issued twice

`assets/js/app.js` `wakeLock(on)`: `lock` stays `null` while `navigator.wakeLock.request` is pending, and `render()` runs again on the next hash change, so two locks can be requested; only the second is kept and released later. Guard with a `pending` promise: if a request is in flight, await it instead of starting another.

## Tests

- `todayPlan`: the Monday/Freestyle/repeat scenario gives `weekDone === 1`; four Freestyle sessions give `weekDone === 0`.
- `exerciseOr('nope').unknown === true`; `sessionSummary`, `machineUsage`, `swapCounts` do not throw on a session containing an unknown id (they already skip — lock it in).
- `planItems` with a swap to an unknown id returns the original item.

## Acceptance criteria

- [ ] The scenario in A shows `1/4 workouts · +2 extra`.
- [ ] Double-tapping Start creates one session and one toast; the button shows progress while locating.
- [ ] Manually editing a saved session's `ex` to `"nope"` (DevTools → Application → Local Storage) leaves History, Stats and Machines fully usable, with the entry shown as "Unknown exercise (nope)".
- [ ] `npm test` passes.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
