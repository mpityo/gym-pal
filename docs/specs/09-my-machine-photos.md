# 09 · Your own photo of each machine, per gym

**Type:** feature · **Suggested implementer:** Opus (IndexedDB, blob lifecycle, backup format) · **Size:** large · **Best after** spec 07 (gym profiles) and spec 08 (reference images), but works without them (see "Fallbacks").

## Why

A stock picture shows what a chest press looks like in general. What actually solves "I can't find the right machine" is a photo of **the** machine in **your** gym — the one in the back corner with the yellow frame — next to your note about where it is and what seat setting you use. Take it once; see it every time that exercise comes up.

## What to build

### 1. Storage: IndexedDB, not localStorage

Photos are far too big for the 5 MB `localStorage` state. New module `assets/js/photos.js` (add to `sw.js` `SHELL`):

```js
// DB 'gym-pal-photos', version 1, object store 'photos', keyPath 'key'
// record: { key: `${gymId ?? 'any'}:${exId}`, gymId, exId, blob, width, height, takenAt }
export async function putPhoto(exId, gymId, blob, meta)
export async function getPhoto(exId, gymId)        // gym's photo, else the 'any' photo, else null
export async function deletePhoto(exId, gymId)
export async function listPhotos()                  // metadata only (no blobs)
export async function exportPhotos()                // [{ key, gymId, exId, takenAt, dataUrl }]
export async function importPhotos(list)
export function photoUrl(record)                    // URL.createObjectURL with a small cache
export function releaseUrls()                       // revoke all; call at the start of each render()
```

One photo per exercise per gym (taking a new one replaces it). Wrap every call in `try/catch`; if IndexedDB is unavailable (private mode), hide the feature rather than erroring.

Keep an index of which keys have photos in memory after the first `listPhotos()` so list views do not open a transaction per row.

### 2. Capturing

- Move `shrink(file)` from `assets/js/views/machines.js` to `assets/js/util.js` and extend it: `shrink(file, { max = 1280, type = 'image/jpeg', quality = 0.82, as = 'base64' | 'blob' })`. Photos are stored as blobs at max 1024 px (~100–200 KB).
- Add a shared `photoInput(onFile)` helper (hidden `<input type="file" accept="image/*" capture="environment">`, clears `value` after each pick).
- Entry points:
  - Machine page → "Finding it" card: **Add a photo of this machine** / **Retake** / **Remove**.
  - How-to sheet during a workout: the same button, so it can be done while standing at the machine.
  - After "What's this machine?" (`machines.js` `identify`) matches a library exercise: **Save this photo to {exercise name}** — reuse the image already taken instead of asking for another.

### 3. Showing

Everywhere spec 08 places a picture, prefer the user's photo for the current gym and fall back to the reference image:

- Today preview and workout entry thumbs; pickers and Machines list thumbs (mark user photos with a small corner dot so it is clear which are yours).
- How-to sheet and machine page: show your photo first, labelled "Your photo · {gym name} · {date}", then the reference figure below.
- Tap to view full size in a `modal`.

Rendering is synchronous today (`render()` builds the DOM in one pass). Do not make views async. Render the placeholder/reference image immediately, then fill in the user photo when the promise resolves:

```js
const img = exerciseThumb(exId);            // from spec 08
photos.getPhoto(exId, gymId).then((rec) => { if (rec && img.isConnected) img.src = photos.photoUrl(rec); });
```

### 4. Backup

Photos are not part of `store.exportJson()`. In Setup → Your data:

- Show "N machine photos · X MB".
- Export: a checkbox "Include photos" (default off; show the estimated file size). When on, add `photos: await exportPhotos()` to the exported JSON next to `state`.
- Restore: if the file has `photos`, import them after the state. Say in the result toast how many were restored.
- "Erase everything" also clears the photo store.
- Call `navigator.storage?.persist?.()` when the first photo is saved (photos are the first thing a browser evicts).

### 5. Fallbacks when other specs are not merged

- Without spec 07: there is no `currentGym()` helper; use `store.active()?.gymId ?? (state.gyms.length === 1 ? state.gyms[0].id : null)`, which yields the `'any'` key for most users. Structure the key logic in one function so it picks up spec 07's helper later.
- Without spec 08: add minimal `exerciseThumb` / `exerciseFigure` helpers in `views/common.js` that show only user photos (neutral tile otherwise), with the same names and signatures spec 08 uses, so the later merge is a small conflict.

## Tests

IndexedDB does not exist in Node. Keep the key and fallback logic pure and test that: `photoKey(exId, gymId)`, and `pickPhoto(records, exId, gymId)` (gym-specific beats `'any'`, `null` when neither). Test `exportPhotos`/`importPhotos` round-trip shape with an injected in-memory store adapter (pass the adapter as a parameter; the real one wraps IndexedDB).

Manual test list for the PR description: take, retake, remove; two gyms with different photos of the same exercise; reload; offline; export with photos → erase → restore.

## Acceptance criteria

- [ ] A photo taken on the machine page appears on Today, in the workout and in the How-to sheet for that exercise, and survives a reload and airplane mode.
- [ ] With two gyms, each shows its own photo; a gym with none falls back to the 'any' photo, then the reference image.
- [ ] "Save this photo to …" works from the Claude identify flow without a second capture.
- [ ] Backup with photos restores them on a clean browser profile; backup without photos is unchanged in size.
- [ ] No object-URL leak: navigating between tabs 50 times does not grow memory unboundedly (URLs are revoked on render).
- [ ] The app works normally when IndexedDB is unavailable.

## Out of scope

Multiple photos per machine, a floor map of the gym, uploading photos anywhere (they stay on the phone, except the existing opt-in Claude identify call).

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
