# 02 · Fix the cardio time stepper and validate what gets logged

**Type:** bug fix · **Suggested implementer:** Sonnet · **Size:** small

## Bugs

All in `assets/js/views/workout.js` unless noted.

### A. Pressing + or − on the treadmill time wipes it

Reproduce: start Upper A. The first exercise is the 5-minute treadmill warm-up and the time field shows `5:00`. Press **+**. The field becomes `1`. Press **−** instead and it becomes `0`.

Cause: the cardio form builds the field with `stepper('Time (m:ss)', d.minutes, 1, …)` (line 267). `stepper`'s `bump` (lines 231–235) does `Number(input.value)`, and `Number('5:00')` is `NaN`, so it falls back to `0` and adds the step.

### B. Bad numbers are saved

- Line 326: `log({ w: usesWeight ? Number(d.w) : 0, reps })`. Only an empty string is rejected (line 325). Typing `12,5` or `abc` logs `w: NaN`, which is saved as `null` and then counted as 0 lb everywhere.
- Line 323–324: `Number(d.reps)` is only checked for falsy, so `-3` logs negative reps and `2.5` logs half a rep.
- Line 301: `log({ secs: Number(d.secs) || 0 })` happily logs a 0-second plank, which also starts the rest timer and counts as a set.
- Cardio (lines 274–276): `parseClock('5:xx')` gives `5`, miles `-1` is accepted.
- `assets/js/views/setup.js:16`: profile fields store `Number(v)`, so `abc` or `180,5` saves `NaN` (later `null`) with no message, and a negative age or bodyweight is accepted.

## Fix

### 1. Teach `stepper` about formatted values

Give `stepper` two optional functions in its options object: `parse(text) → number | NaN` and `format(number) → string`. Defaults: `parse = Number`, `format = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1)` (what it does now). `bump` becomes:

```js
const bump = (dir) => {
  const current = parse(input.value);
  const n = Math.max(0, (Number.isFinite(current) ? current : 0) + dir * step);
  input.value = format(n);
  onChange(input.value);
};
```

For the cardio time field pass `parse: parseClock`, `format: fmtMinutes` and a step of `0.25` (15 seconds), so `5:00` → `5:15` → `5:30`. Use `inputMode: 'text'` for that field so the phone keyboard offers `:` (add an `inputMode` option; today it is derived from `decimals`).

### 2. Move parsing into a tested, DOM-free place

Move `parseClock` out of `workout.js` into `assets/js/metrics.js` (next to `fmtMinutes`) and export it. Make it strict: return `NaN` for anything that is not `m`, `m.d`, or `m:ss` with `ss` in 0–59. Add:

```js
/** A positive, finite number from user text. Accepts "12,5". Returns null if it is not one. */
export function parseAmount(text, { allowZero = false, integer = false } = {}) { … }
```

### 3. Validate before logging

In `inputForm`:

- Weight/reps: `const w = parseAmount(d.w, { allowZero: true })`, `const reps = parseAmount(d.reps, { integer: true })`. Toast and return if either is `null` ("Enter the weight as a number, e.g. 45 or 47.5" / "How many reps?"). Cap obviously wrong values: weight > 1500 or reps > 200 → toast "That looks like a typo."
- Timed holds: require `secs >= 1` ("Start the timer or enter the seconds.").
- Cardio: minutes must be `> 0`; miles must be `null` or `> 0`.

In `setup.js` `num(...)`: parse with `parseAmount`; on `null` (and non-empty input) toast "Enter a number" and restore the previous value instead of saving. Reasonable bounds: bodyweight 50–700 lb, age 10–100, max heart rate 100–230.

### 4. Tests (`test/core.test.mjs` or a new file)

- `parseClock`: `'5:00'→5`, `'9:30'→9.5`, `'12'→12`, `''→NaN`, `'5:xx'→NaN`, `'5:75'→NaN`.
- `parseAmount`: `'45'→45`, `'47,5'→47.5`, `'abc'→null`, `'-3'→null`, `'0'→null` and `0` with `allowZero`, `'2.5'` with `integer` → `null`.

## Acceptance criteria

- [ ] On the treadmill warm-up, + and − move the time in 15-second steps and never reset it.
- [ ] Typing `abc` or `12,5x` as a weight shows a toast and logs nothing; `47,5` logs 47.5.
- [ ] A 0-second hold, negative reps, or negative miles cannot be logged.
- [ ] Setup rejects non-numbers without overwriting the saved value.
- [ ] New tests pass.

## Out of scope

Editing already-logged sets (spec 12).

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
