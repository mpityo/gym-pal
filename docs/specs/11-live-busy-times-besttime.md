# 11 · Optional live and forecast busy times for any gym (BestTime.app)

**Type:** feature · **Suggested implementer:** Opus · **Size:** medium–large · **Needs a decision and a key from the repo owner before work starts** (see "Read first"). Build after spec 07 (gym name/address) and ideally spec 10 (it reuses the chart).

## Read first: what is and is not possible

- Google's "Popular times" has no official API. Scraping it breaks Google's terms and cannot be done from a browser anyway.
- Gym chains (LA Fitness included) do not publish occupancy.
- [BestTime.app](https://besttime.app) sells foot-traffic data for public venues worldwide, gyms included: an hour-by-hour forecast for each weekday (0–100%) and, where available, live busyness compared with the forecast. It is a **paid, metered** service (their site lists a metered plan with a monthly minimum and a free test allowance; live lookups cost more than forecasts). Check current prices at besttime.app before committing.
- This app has no server. The call has to go straight from the phone to BestTime with a key the user pastes in, exactly as the Claude key works today (`assets/js/ai.js`).

**Two things must be confirmed before writing code. If either fails, stop and report in the PR instead of working around it:**

1. **The API allows browser (CORS) requests.** Test from the deployed origin or `http://localhost:8000` with `fetch`. If CORS is blocked, this feature cannot be built without a proxy server, which is out of scope.
2. **The endpoint names and response fields below.** They are written from memory of the public docs at `documentation.besttime.app`, which I could not open while writing this spec. Read the docs and correct this section first.

Endpoints as I recall them (verify):

| Purpose | Request | Key fields in the response |
| --- | --- | --- |
| Create/refresh a forecast | `POST https://besttime.app/api/v1/forecasts?api_key_private=…&venue_name=…&venue_address=…` | `venue_info.venue_id`, `venue_info.venue_name`, `analysis[7]` each with `day_info.day_int` and `day_raw[24]` (percent per hour; the array starts at 6 am, not midnight) |
| Live busyness | `POST https://besttime.app/api/v1/forecasts/live?api_key_private=…&venue_id=…` | `analysis.venue_live_busyness`, `analysis.venue_forecasted_busyness`, `analysis.venue_live_busyness_available` |

## What to build

### 1. Key handling (copy the Claude pattern)

New module `assets/js/busy.js` (add to `sw.js`): `getKey/setKey/clearKey/hasKey` using its own `localStorage` slot `gym-pal.besttime-key`, **never** part of `store` state or backups. Keep a usage counter (`calls`, `liveCalls`, `since`) like `ai.usage()`.

Setup gets a "Busy times (optional)" card: what it does, that it is a paid third-party service billed to the user's own BestTime account, a link to get a key, the key field, Test, Remove, and the usage counter. Feature is invisible elsewhere until a key is saved.

The service worker only handles same-origin requests (`sw.js` fetch handler), so these calls are never cached by it. Leave that as is.

### 2. Linking a gym to a venue

In Setup → Gyms → Edit (spec 07): "Link busy times". Sends name + address (address is required; prompt for it if empty), shows the venue BestTime matched (name and address) and asks the user to confirm it is the right place. On confirm store on the gym: `busy: { venueId, venueName, forecast: { fetchedAt, days: [[24 numbers] × 7] } }`. Normalise `day_raw` into midnight-based arrays in `busy.js` so the rest of the app never deals with the 6 am offset.

Forecasts are stable for weeks: refresh only when older than 14 days or when the user taps "Refresh". That keeps cost near zero.

### 3. Live lookup: only on demand

Never poll. A **Check now** button on Today (shown when the current gym is linked) makes one live call and shows: "Right now: 62% — busier than usual for a Monday 6 pm (usually 45%)". Cache the result in memory for 15 minutes. If live data is not available for the venue, show the forecast value and say so.

### 4. Show it

- **Today** plan card: a compact bar chart of today's forecast for the current gym (hours the gym is open, i.e. non-zero), current hour highlighted, with "Quietest today: 2–3 pm" beneath. Reuse `bars()` from `charts.js`.
- **Stats** → "When your gym is quiet" (spec 10): a toggle "Mine / Forecast" switching between the personal grid and the 7×24 BestTime grid, using the same `crowdHeat` helper. Without spec 10, add the card with only the forecast grid.
- **Coach context**: `gymForecastNow: { percent, usualForThisHour }` when cached.

### 5. Errors

Map failures to plain messages like `ai.js` does: bad key, out of credits, venue not found ("BestTime has no data for this place — check the name and address"), offline, rate limited. Never throw into `render()`.

## Tests

Pure parts in `busy.js`: normalising a `day_raw` array that starts at 6 am into a midnight-based array; picking the quietest open window; deciding whether a cached forecast is stale; building request URLs (key and venue name are URL-encoded). Test with fixture JSON copied from a real response once the docs/API have been checked.

## Acceptance criteria

- [ ] Section "Read first" has been verified against the live docs and corrected in this file; CORS confirmed working (state how in the PR).
- [ ] No key → no UI outside Setup; nothing is requested.
- [ ] The key is never in an exported backup.
- [ ] Linking shows the matched venue and requires confirmation.
- [ ] Opening Today makes **zero** BestTime calls when a fresh forecast is cached; "Check now" makes exactly one.
- [ ] Forecast shows offline once fetched.
- [ ] The usage counter increments per call.

## Out of scope

Running a proxy server, scraping Google, automatic background refresh.

## Ground rules for this repo

- Static site: no build step, no npm dependencies, plain ES modules. Do not add a bundler or a framework.
- Any new `.js` or asset file the app loads must be added to `SHELL` in `sw.js`, or it will not work offline.
- Put pure logic in DOM-free modules (like `assets/js/metrics.js`) and cover it with Node tests in `test/`. `npm test` must pass.
- Every new persisted field needs a default in `defaultState()` in `assets/js/store.js` (nested objects also need a line in `merge()`), so existing saves and old backups keep loading. Never rename or remove an existing field without a migration.
- Phone-first UI. Reuse the classes already in `assets/css/app.css` (`card`, `btn`, `chip`, `stat-grid`, `mlist`, `field`, `modal`) before adding new ones.
- Update `README.md` wherever it describes behaviour you change.
- Work on this PR's branch. Keep this spec file; tick the acceptance boxes in the PR description as you go.
