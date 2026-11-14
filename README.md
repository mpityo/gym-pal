# Gym Pal

A workout tracker for LA Fitness. It's a static site with no server, no accounts and no build step, hosted on GitHub Pages. You can install it to your phone's home screen and it works offline.

## What it does

| Tab | What it's for |
| --- | --- |
| **Today** | Shows the week at a glance and today's workout from the plan, with a suggested weight for every lift and where each machine is in your gym. Tap Start. |
| **Workout** | Live during a session. Big +/− steppers for weight and reps, a rest timer that beeps and vibrates — even if you've switched to Machines or another tab — and a **Swap** button for when a machine is taken. It also has a how-to for every exercise, a plank stopwatch, treadmill time and distance, and live heart rate. |
| **Machines** | 59 machines and exercises, each with what it looks like, how to set it up, form cues, common mistakes and good swaps. You can save notes on where each one is and your seat or pad settings. Each page also shows your history and strength trend for that exercise. |
| **Stats** | Total weight moved (with a real-world comparison), sets per muscle this week against the 10-set target, weekly volume, pushed/pulled/legs split, strength trends, personal records, machine usage, swaps, rest times, a training heatmap, mile-run pace, and Galaxy Watch heart-rate zones, calories, steps, sleep and daily low heart rate. |
| **History** | Every workout with its sets, gym, duration and heart rate. |
| **Setup** | Bodyweight and age, 4-day or 3-day plan, rest-timer and background-notification toggles, gyms, watch import, Bluetooth heart rate, Claude key, and backup/restore. |

### The plan

The 4-day upper/lower split runs Upper A on Monday, Lower A on Tuesday, Upper B on Thursday and Lower B on Friday. There's also a 3-day full-body option. Plans live in `assets/js/data/plans.js`. If a machine is always missing, swap it during a workout and tick **Always use the swap**, and the swap sticks for that plan.

### How weights are suggested

It uses double progression, as described in the ACSM 2009 position stand. You stay at a weight until every set reaches the top of the rep range, then go up one step: 5 lb for most machines and 10 lb for leg press and squats. If any set falls below the bottom of the range, you stay at that weight. The first time you do an exercise, it asks you to find a weight you could do about two more reps with than the target.

### The rest timer

The rest timer lives on the session, not on the Workout screen, so it alerts once wherever you are when it ends — even on Machines, Stats or History — and gives you a one-tap way back to the workout. If you come back long after it ended (say the phone was locked), it won't beep again; it just tells you how long ago it finished. −15/+15 change the time left without refilling the progress bar.

With **Notify me if rest ends while the app is in the background** turned on in Setup (it asks for notification permission the first time), a system notification appears if the rest ends while the app isn't the visible tab, and tapping it opens the workout. This is best-effort: if the screen is locked, the phone may delay or drop it, same as any other web notification. Keeping the screen on (the toggle above it) is the reliable option.

### Where the numbers come from

Every figure is calculated in `assets/js/metrics.js` and covered by tests in `test/`.

- **Pounds moved** = weight × reps. Dumbbells are logged per hand and counted twice. Leg press, hack squat and Smith machine count only the plates you add, because the sled or bar weight varies by machine. Assisted pull-ups and dips count your bodyweight minus the assist. Push-ups count about 64% of bodyweight.
- **Estimated 1-rep max** uses the Epley formula: w × (1 + reps / 30).
- **Sets per muscle** count primary muscles as 1 set and helping muscles as ½ set (fractional counting, as in Pelland et al. 2025). The 10-set line comes from Schoenfeld et al. 2017. "2×" shows a muscle was trained on two days, the frequency favored by Schoenfeld et al. 2016.
- **Heart-rate zones** use 50–60–70–80–90% of max heart rate. Max heart rate is 208 − 0.7 × age (Tanaka 2001) unless you enter your own.
- **Comparisons** use approximate weights: a concert grand piano is about 990 lb, an average new car about 4,300 lb, an African elephant about 13,000 lb, an empty 737 about 91,300 lb, a blue whale about 300,000 lb and the Statue of Liberty about 450,000 lb.

## Galaxy Watch

A web page can't read Samsung Health directly. Samsung has no web API, and Health Connect only works for native Android apps. You get your watch data in two ways:

1. **Import the Samsung Health export.** In Samsung Health, go to Settings → Download personal data. Then go to Setup → Galaxy Watch → Choose export files and pick the zip, or the CSV files. Everything is read on the phone. The import pulls in watch workouts (type, calories, average and max heart rate), daily steps, sleep, weight and daily heart-rate low/high. It also keeps minute-by-minute heart rate, but only during the workouts you logged. Re-import whenever you want, and it links new sessions.
2. **Live heart rate over Bluetooth** (Chrome on Android). This uses the standard Bluetooth heart-rate profile. A Galaxy Watch doesn't broadcast heart rate by default, so first install a heart-rate broadcast app on the watch. Chest straps connect directly. Live readings are saved with the workout and take priority over imported ones.

## Claude

This is optional and off until you add a key in Setup. It has three jobs:

- **Coach chat** during a workout. The coach can see your plan, what you've logged so far, the suggestions and your recent workouts.
- **What's this machine?** Take a photo and Claude names the machine, matches it to the library and explains how to set it up.
- **Weekly read** on the Stats tab, written from figures the app has already calculated. Claude is told not to calculate anything itself.

The key is stored only on your phone, in its own storage slot outside the app's data. That means it's never included in an exported backup and never touches this repo. Requests go straight from the browser to Anthropic. Setup shows a running count of requests and tokens. Models are set in `MODELS` at the top of `assets/js/ai.js`.

## Your data

Everything is stored in the browser on your phone (localStorage). To move to a new phone, use **Setup → Export backup**, then **Restore backup** on the new phone.

## Development

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # node --test: metrics, progression, Samsung parsing, zip, BLE parsing, store, today's plan, util
```

A `Tests` check (`.github/workflows/test.yml`) runs `npm test` on every pull request. Every push to `main` also runs the tests and deploys to GitHub Pages (`.github/workflows/deploy-pages.yml`). For the first deploy, set **Settings → Pages → Source** to **GitHub Actions**.

Not medical advice. Stop any exercise that causes pain.
