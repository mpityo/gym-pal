# 04 · Fix Claude coach bugs: hidden errors, wrong "next workout", refusals, token limits

**Type:** bug fix · **Suggested implementer:** Sonnet · **Size:** small · **Needs a real Anthropic key to verify parts C and D** (ask the repo owner to test, or note in the PR that those parts are unverified).

## Bugs

### A. Coach errors are never shown

`assets/js/views/coach.js:78–85`:

```js
} catch (err) {
  history.pop();
  input.value = text;
  log.append(h('p', { class: 'muted small' }, err.message));
} finally {
  send.disabled = false;
  draw();            // ← replaceChildren() wipes the error that was just appended
}
```

Reproduce: go offline (or use a bad key), ask the coach something. The "…" bubble vanishes and nothing explains why.

Fix: keep a module-level `let lastError = null`. Set it in `catch`, clear it at the start of `go()`, and have `draw()` render it after the messages (`h('p', { class: 'chat__error', role: 'alert' }, lastError)`). Add a small `.chat__error` style (use the existing danger colour variable).

### B. The coach is told the wrong next workout

`coach.js:38`: `nextPlanned` is hard-coded to Upper A (or Full body A) whenever no workout is in progress, regardless of the day or what was done this week. Replace with the real answer:

```js
import { todayPlan } from './today.js';
…
const tp = todayPlan(st);
nextPlanned: !a ? { name: PLAN_BY_ID[tp.planId].name, when: tp.label, restDay: tp.rest, doneThisWeek: tp.weekDone, weeklyTarget: tp.weekTarget } : undefined,
```

(Check for an import cycle: `today.js` does not import `coach.js`, so this is safe.)

### C. Refusals look like garbage or an empty bubble

`assets/js/ai.js` `call()` handles `stop_reason === 'max_tokens'` (line 169) but not `'refusal'`. On the current models a declined request comes back as HTTP 200 with `stop_reason: "refusal"` and little or no text. Result today: the coach shows an empty bubble; the photo and weekly-read calls show "Claude returned something unreadable."

Fix, before reading `content`:

```js
if (data.stop_reason === 'refusal') throw new AiError('refused', 'Claude declined to answer that. Try rephrasing.');
```

Also treat an empty text reply as an error (`AiError('empty', 'Claude sent an empty reply — try again.')`) instead of returning `''`.

### D. Token limits are too small for models that think by default

`MODELS` uses `claude-sonnet-5-5` and `claude-haiku-5-5`. Both run adaptive thinking by default, and thinking tokens count toward `max_tokens`. The current limits are 8 (key test, line 222), 900 (coach, line 252) and 1200 (photo and weekly read, lines 294 and 328). Expected symptoms: **Test key** reports "Claude ran out of room before finishing" for a key that is fine, and longer coach answers or the structured weekly read fail the same way.

Fix:

- `testKey()`: a 200 response proves the key works. Add a `call` option `allowTruncated` and pass it from `testKey`, so `max_tokens` is not treated as a failure there. Raise its `maxTokens` to 64.
- Add an `effort` option to `call()` and send it as `output_config.effort`. When a schema is also present, send both in one object: `body.output_config = { effort, format: { type: 'json_schema', schema } }` (omit keys that are not set).
- Coach chat: `effort: 'low'`, `maxTokens: 4000` (the system prompt already asks for 2–6 sentences; this is headroom, not a target).
- Photo identify and weekly read: `effort: 'low'`, `maxTokens: 4000`.
- Key test: `effort: 'low'`.
- Leave `MODELS` as it is.

Verify with a real key: Test key succeeds; a coach question, a machine photo and a weekly read all return. If the API rejects `output_config.effort` for a model, drop it for that call and say so in the PR.

### E. Small ones while you are here

- `coach.js` `context()` builds `exercises[].name` with `exercise(e.ex).name`; it throws if an id is unknown. Use `exercise(e.ex)?.name ?? e.ex`.
- `stats.js` `weeklyReadCard`: `show(v)` assumes `v.points` is an array. Guard with `(v.points ?? [])`.

## Tests

`call()` is hard to unit test without a network. Extract the response handling into a pure exported function `readResponse(data, { schema, allowTruncated })` and test: normal text, JSON with schema, `max_tokens` (throws unless allowed), `refusal` (throws `refused`), empty content (throws `empty`), invalid JSON (throws `bad-json`).

## Acceptance criteria

- [ ] Offline or with a bad key, the coach sheet shows the error text and keeps the typed question in the box.
- [ ] With no workout in progress, the context sent to Claude names the same workout the Today tab shows.
- [ ] A refusal produces a clear message in all three features.
- [ ] Test key passes with a valid key (verified by a human, or flagged unverified).
- [ ] `npm test` passes with the new `readResponse` tests.

## Out of scope

Streaming replies, prompt caching, changing models.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
