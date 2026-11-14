# 16 · Track bodyweight over time (and use the right weight for each workout)

**Type:** feature + correctness fix · **Suggested implementer:** Sonnet · **Size:** medium

## Why

Bodyweight is a single number in Setup (`state.profile.bodyweight`). That causes one real inaccuracy and misses an obvious feature:

- **History is rewritten when you change it.** Every bodyweight-dependent figure is computed from the current profile value: push-ups (64% of bodyweight), assisted pull-ups and dips (bodyweight minus assist) — see `loadPerRep` in `assets/js/metrics.js` and the `bw` argument threaded through every view. Lose 15 lb and update Setup, and the pounds moved for every past push-up and pull-up session silently change, as do "best session" records for those exercises.
- **No weight trend.** Most people tracking workouts also want to see their weight over time. The Samsung Health import already reads weigh-ins (`buildWatch` stores `days[date].weightKg`, `assets/js/samsung.js`) and then nothing displays them.

## What to build

### 1. Data (`store.js`)

```js
bodyweightLog: [],   // [{ date: 'YYYY-MM-DD', lb: number, source: 'manual' | 'watch' }], sorted by date, one per date
```

- `logBodyweight(lb, date = dayKey(Date.now()), source = 'manual')` upserts the entry for that date (manual beats watch on the same date), keeps the array sorted, and sets `profile.bodyweight` to the latest entry's value so existing readers keep working.
- `removeBodyweight(date)`.
- Migration on load: if `bodyweightLog` is empty and `profile.bodyweight` is set, seed one entry dated at the first session's day (or today when there are no sessions).
- `startSession` snapshots the current value: `active.bodyweight = profile.bodyweight ?? null`.

### 2. Use the weight that was true at the time (`metrics.js`)

- Add `bodyweightAt(log, ts, fallback)`: the latest entry on or before that day; if none, the earliest entry; if the log is empty, `fallback`.
- Add `sessionBodyweight(session, log, fallback) → session.bodyweight ?? bodyweightAt(log, session.startedAt, fallback)`.
- The metric functions take a `bodyweight` number today. To avoid touching every signature, let that parameter also accept a resolver: wherever a function has a session in hand (`sessionSummary`, `exerciseHistory`, `machineUsage`, and through them `totals`, `weekly`, `calendar`, `exerciseRecords`, `newRecords`, `suggest`), compute `const bw = typeof bodyweight === 'function' ? bodyweight(session) : bodyweight`. Numbers keep working, so existing tests pass unchanged.
- Add `store.bw()` returning the resolver `(session) => sessionBodyweight(session, state.bodyweightLog, state.profile.bodyweight)` and pass it from the views instead of `st.profile.bodyweight` (`grep -n "profile.bodyweight" assets/js/views`).

### 3. UI

- **Setup → You**: the Bodyweight field calls `logBodyweight` for today. Below it: "Last logged {date}".
- **Today**: when the last entry is more than 7 days old (or there is none), a slim card "Log today's weight" with a stepper (0.5 lb steps, pre-filled with the last value) and Save / Not now (snooze 7 days in `prefs.weighSnoozeUntil`).
- **Stats**: new "Bodyweight" card when there are ≥ 2 entries: latest, change over 30 days, change since first entry, a `sparkline` of the last 90 days, and a 7-day-average line in the caption ("7-day average 181.4 lb") to smooth daily noise. A "See all" list with delete per entry.
- **Samsung import** (`views/setup.js` `watchCard`, after a successful import): if `watch.days` has weigh-ins, offer "Add N weigh-ins from your watch to your weight history" → `logBodyweight(kg × 2.20462, date, 'watch')` for each, rounded to 0.1.
- **Coach / weekly read context** (`coach.js`, `stats.js` `facts`): include `bodyweightTrend: { latestLb, change30dLb }` when available.

### 4. README

Update "Where the numbers come from": bodyweight moves use your weight at the time of the workout.

## Tests

- `bodyweightAt`: exact date, between entries, before the first, empty log.
- `logBodyweight` upsert and ordering; manual overrides watch for the same date; `profile.bodyweight` follows the latest date, not the latest call.
- A push-up session logged at 200 lb keeps its tonnage after the profile changes to 180 lb (snapshot), and a session without a snapshot uses the log entry in force on its date.
- Passing a plain number still works everywhere (existing tests untouched).
- Migration seeds exactly one entry.

## Acceptance criteria

- [ ] Changing bodyweight today does not change pounds moved for past workouts.
- [ ] Weight can be logged from Setup and from the Today prompt; the prompt appears at most weekly and can be snoozed.
- [ ] Stats shows the trend card with ≥ 2 entries.
- [ ] Watch weigh-ins can be added after an import and never overwrite a manual entry for the same day.
- [ ] Old backups load; a new backup round-trips `bodyweightLog`.

## Out of scope

Body-fat percentage, tape measurements, progress photos, kg display.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
