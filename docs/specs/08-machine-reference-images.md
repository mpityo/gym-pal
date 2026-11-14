# 08 · A picture for every machine and exercise

**Type:** feature · **Suggested implementer:** Sonnet (mostly careful data matching) · **Size:** medium

## Why

"I find it hard to find the right machine sometimes." Today each exercise only has a sentence of text (`look` in `assets/js/data/exercises.js`). A picture next to the name on Today, in the workout and on the machine page answers "which one is it?" at a glance. This spec adds a stock reference picture for each of the 59 library entries. Spec 09 adds your own photo of the actual machine in your gym.

## Source of images

Use [`yuhonas/free-exercise-db`](https://github.com/yuhonas/free-exercise-db): 800+ exercises with photos, released under the **Unlicense** (public domain dedication), so the images can be copied into this repo.

- Index: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json` — fields `id`, `name`, `equipment`, `primaryMuscles`, `images` (e.g. `["Air_Bike/0.jpg", "Air_Bike/1.jpg"]`).
- Image: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<path from images[]>`.

Before copying anything, open the repository's LICENSE file and confirm it is still the Unlicense and that nothing excludes the images. If that has changed, stop and report in the PR instead of proceeding.

The pictures show a person doing the movement on the equipment (start and end position), not a product shot of the machine. That is still the fastest way to recognise it; say so in the caption ("Reference photo — your gym's machine may look different").

## What to build

### 1. Match and vendor the images (one-off, committed)

- Write `tools/fetch-images.mjs` (Node, no dependencies, not loaded by the site, not in `sw.js`). It reads a hand-written mapping `tools/image-map.json` of `{ "<our exercise id>": "<free-exercise-db id>" }`, downloads `images[0]` (and `images[1]` when present) for each, and writes them to `assets/img/ex/<our id>-0.jpg` / `-1.jpg`.
- Build the mapping by hand for all 59 ids in `EXERCISES`. Search the index by name and equipment (for example `chest-press` → a machine/lever chest press entry, `lat-pulldown` → a wide-grip lat pulldown entry, `leg-press` → `Leg_Press`). Open every chosen image and check it really shows the same equipment and movement; a wrong picture is worse than none. Where there is no honest match (likely for a few cardio pieces or brand-specific machines), leave the id out.
- Resize to 480 px on the long edge, JPEG quality ~70, target ≤ 40 KB each and ≤ 3 MB in total. Use whatever local tool is available (`sips`, ImageMagick, `ffmpeg`); do not add an npm dependency. Record the exact command in a comment at the top of the script.
- Add `assets/img/ex/ATTRIBUTION.md`: source repo, licence, date fetched.

### 2. Data

New file `assets/js/data/images.js`:

```js
/** exercise id -> number of reference images available (files are assets/img/ex/<id>-<n>.jpg) */
export const IMAGE_COUNT = { 'chest-press': 2, 'lat-pulldown': 2, … };
export function exerciseImages(id) { … returns ['assets/img/ex/<id>-0.jpg', …] or [] }
```

Keep it separate from `exercises.js` so the library file stays readable.

### 3. UI

Add `exerciseThumb(exId, { size })` and `exerciseFigure(exId)` to `assets/js/views/common.js`:

- `exerciseThumb`: a square `<img loading="lazy" decoding="async" width height alt="">` with rounded corners; when there is no image, a neutral tile using the existing pattern colour classes (`p-push`, `p-pull`, …) so rows stay aligned.
- `exerciseFigure`: the image(s) full width with the caption; with two images, show them side by side labelled "Start" and "End". Tapping opens the image larger in the existing `modal`.

Place them:

| Screen | File | Where |
| --- | --- | --- |
| Today plan preview | `views/today.js` `preview` | 44 px thumb at the start of each row |
| Workout, open exercise | `views/workout.js` `openEntry` | 64 px thumb beside the title; tap opens How-to |
| How-to sheet | `views/common.js` `openHowTo` | figure at the top, above "Look for" |
| Machine page | `views/machines.js` `renderMachine` | figure at the top of the "Finding it" card |
| Machines list, swap and add pickers | `machines.js` `draw`, `common.js` `exerciseOption` | 44 px thumb in each row |

Add `onerror` handling that swaps a failed image for the neutral tile (offline before the image was cached).

### 4. Offline

Images must not block installing the app shell. In `sw.js`:

- Bump `VERSION`.
- Keep `SHELL` as the required set (add `assets/js/data/images.js`).
- Add a second list `IMAGES` and cache it best-effort in `install`: `event.waitUntil(Promise.all([shell, cache.addAll(IMAGES).catch(() => {})]))`. Generate `IMAGES` in the script and paste it in, or import nothing and list them literally (a service worker cannot import an ES module unless registered as `type: 'module'`; keep it classic).

### 5. Tests

- Every key in `IMAGE_COUNT` is a real exercise id; every referenced file exists on disk (`fs.existsSync`) and is under 60 KB.
- Every image listed in `sw.js` exists.

## Acceptance criteria

- [ ] At least 50 of the 59 exercises have a correct reference image; the PR description lists which ids have none and why.
- [ ] Thumbs appear on Today, in the workout, in pickers and the Machines list; full figures on the How-to sheet and machine page.
- [ ] After one online load, the pictures show in airplane mode.
- [ ] Total added image weight ≤ 3 MB; the app shell still installs if an image is missing.
- [ ] Attribution file present.

## Out of scope

Animated GIFs or video, hot-linking images from another site at runtime, user photos (spec 09).

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
