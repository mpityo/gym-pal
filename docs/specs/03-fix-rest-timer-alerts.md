# 03 · Fix rest-timer alerts (missed, late, and reset progress bar)

**Type:** bug fix · **Suggested implementer:** Sonnet · **Size:** small–medium

## Bugs

The rest timer is stored on the session (`store.setRest`, `assets/js/store.js`) and driven by the 500 ms interval in `assets/js/app.js:125–155`.

### A. No alert unless the Workout tab is on screen — and a late one when you come back

`app.js:133` only does anything `if (a?.rest && bar)`, where `bar` is `#restbar`, which exists only on the Workout screen. Reproduce: log a set (rest starts), tap **Machines** to check the next machine's how-to, wait past the end of the rest. Nothing beeps. Go back to Workout a minute later: `restWasRunning` is still `true`, so it beeps and toasts "Rest is up" late, even though the bar is already hidden (`workout.js:58` hides it 4 s after expiry).

### B. −15 / +15 reset the progress bar

`workout.js:95–96` call `store.setRest(remaining ± 15)`, and `setRest` sets `total` to the new remaining time, so the bar jumps back to 100% full on every tap.

### C. Nothing happens if the phone is in your pocket

Browsers slow or freeze timers when the page is hidden, and `alertDone()` (`util.js`) cannot play audio from a suspended `AudioContext`. There is no notification. This cannot be made perfect on the web, but it can be much better and it should never be misleading.

## Fix

### 1. Store

```js
// rest: { until, total, alerted }
export function setRest(secs) { … rest = secs ? { until: Date.now() + secs * 1000, total: secs, alerted: false } : null }
export function adjustRest(deltaSecs) {   // keeps `total` so the bar does not jump
  const left = Math.max(5, (rest.until - Date.now()) / 1000 + deltaSecs);
  rest.until = Date.now() + left * 1000;
  rest.total = Math.max(rest.total, left);
  rest.alerted = false;
}
export function markRestAlerted() { … rest.alerted = true }
```

Use `adjustRest(-15)` / `adjustRest(15)` in `workout.js:95–96`.

### 2. One place decides when to alert, independent of the screen

In `app.js`, split the tick into two parts and delete `restWasRunning`:

- **Alert (any route):** `if (a?.rest && !a.rest.alerted && Date.now() >= a.rest.until)` → `store.markRestAlerted()`, then:
  - overdue by less than 10 s → `alertDone()` if `prefs.restAlert`, plus the toast. If the current route is not `workout`, give the toast an action: `toast('Rest is up — next set.', { action: 'Workout', onAction: () => ctx.go('workout') })`.
  - overdue by 10 s or more (the page was frozen) → no beep; toast `Rest ended ${fmtSecs(overdue)} ago.`
- **Bar (Workout route only):** update label/fill as today.

Because `alerted` is persisted, a reload after the rest has ended does not re-alert.

### 3. Background notification (best effort, opt-in)

- Add pref `restNotify: false` and a Setup toggle "Notify me if rest ends while the app is in the background". Turning it on calls `Notification.requestPermission()`; if not granted, switch the toggle back off and toast why. Hide the toggle when `!('Notification' in window)`.
- When the alert fires and `document.visibilityState !== 'visible'` and permission is granted: `(await navigator.serviceWorker.ready).showNotification('Rest is up', { body: nextSetLabel, tag: 'gym-pal-rest', renotify: true, vibrate: [200, 100, 200] })`. Close it (`getNotifications({ tag })`) when the page becomes visible.
- In `sw.js` add a `notificationclick` handler that focuses an existing client (or opens `./#/workout`) and closes the notification.
- In `alertDone()` call `audioCtx.resume()` before scheduling the beep.
- Under the toggle, state the limit honestly: "If the screen is locked the phone may delay this. Keeping the screen on (above) is the reliable option."

### 4. Tests

Extract the decision into a pure function in `metrics.js`, e.g. `restStatus(rest, now) → { state: 'running' | 'due' | 'late' | 'done', left, overdue }`, and test the four states and `adjustRest` keeping `total`.

## Acceptance criteria

- [ ] Rest ending while on Machines/Stats/History beeps and shows a toast with a "Workout" action, once.
- [ ] Returning to Workout long after the rest ended does not beep.
- [ ] −15 / +15 change the time without refilling the bar.
- [ ] With the new toggle on and the app in the background (screen on, another app in front), a notification appears; tapping it opens the workout.
- [ ] Reloading the page after rest ended does not alert again.

## Out of scope

Push notifications from a server (there is no server).

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
