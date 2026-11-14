# 01 · Run tests on pull requests and make the store testable

**Type:** tooling · **Suggested implementer:** Sonnet · **Size:** small · **Do this first** — every other spec in `docs/specs/` adds tests that should run before merge.

## Problem

1. Tests only run inside `.github/workflows/deploy-pages.yml`, which triggers on pushes to `main`. A pull request gets no check at all, so a broken PR is only discovered after it is merged and the deploy fails.
2. `assets/js/store.js:80` runs `window.addEventListener?.('pagehide', flush)` at import time. In Node `window` is not defined, so this throws a `ReferenceError` and nothing that imports the store can be tested. Today no test imports `store.js`, `views/today.js` (`todayPlan`) or `util.js`, so the session lifecycle, plan swaps, backup import and "what is today's workout" logic are untested.
3. `assets/js/metrics.js:4` says the tests live in `test/metrics.test.mjs`; the file is `test/core.test.mjs`.

## What to build

### 1. A test workflow for pull requests

Add `.github/workflows/test.yml`:

```yaml
name: Tests
on:
  pull_request:
  push:
    branches-ignore: [main]   # main is covered by deploy-pages.yml
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm test
```

In `deploy-pages.yml`, add the same `actions/setup-node@v4` (Node 22) step before "Unit tests" and change the command to `npm test`, so both workflows run the same thing.

### 2. Make `store.js` importable in Node

- `assets/js/store.js:80` → `globalThis.addEventListener?.('pagehide', flush);`
- `load()` and `flush()` already wrap `localStorage` in `try/catch`, so they need no change. Confirm by importing the module in a test with no globals defined.
- Add a test-only reset: `export function _resetForTests(next = defaultState()) { state = next; }` (no persistence, no listeners).

### 3. New tests

Create `test/store.test.mjs`:

- `startSession('upper-a')` creates one entry per plan item with the right targets; `startSession(null)` creates a Freestyle session with no entries.
- `logSet` appends with an `at` timestamp and clears `skipped`; `removeSet`, `editSet`, `skipEntry`, `swapExercise` (ignores unknown ids), `addEntry` (cardio / time / weight defaults).
- `setPermanentSwap` then `planItems` returns the swap with `swappedFrom`; swapping back to the original id removes it.
- `finishSession` drops entries with no sets, removes `rest` and `current`, does not save a session with nothing logged, and sets `active` to `null`.
- `exportJson` → `importJson` round-trips; `importJson('{"foo":1}')` throws "That file is not a Gym Pal backup."
- `nearestGym` returns a gym within 400 m and `null` beyond it.

Create `test/today.test.mjs` for `todayPlan(state, now)` (exported from `assets/js/views/today.js`; it imports cleanly in Node because nothing touches the DOM at import time — verify, and if an import does, move `todayPlan` to a new DOM-free `assets/js/schedule.js` and re-export it from `today.js`; remember `sw.js`):

- Monday with no sessions → `upper-a`, `rest: false`.
- Wednesday with Monday done and Tuesday missed → `rest: true`, `planId: 'lower-a'`, `label: 'Catch up'`.
- Saturday with all four done → `planId: 'upper-a'`, `label: 'Next'`.
- 3-day mode alternates `full-a` / `full-b` based on the last full-body session.

Create `test/util.test.mjs` for `matchScore` (exact > prefix > word prefix > substring > subsequence > 0) and `fmtSecs`, `fmtRel`.

### 4. Fix the comment

`assets/js/metrics.js:4` → "see test/".

## Acceptance criteria

- [ ] Opening a PR runs a "Tests" check; a deliberately failing assertion turns it red.
- [ ] `npm test` passes locally and runs the three new test files.
- [ ] No behaviour change in the browser (load the app, start and finish a workout).
- [ ] Deploy workflow still runs tests before deploying.

## Out of scope

Browser/end-to-end tests, linting, formatting.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
