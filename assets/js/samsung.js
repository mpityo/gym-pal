/**
 * Samsung Health import.
 *
 * A web page cannot read Samsung Health directly: Samsung has no web API, and
 * Health Connect is only open to native Android apps. What Samsung Health does
 * offer is a full export of your data (Samsung Health → Settings → Download
 * personal data), as a folder of CSV files. This reads that export — the whole
 * zip, or the CSV files picked individually — entirely on the device.
 *
 * What is kept:
 *   - every recorded workout (type, time, calories, heart rate, distance)
 *   - per-day steps, sleep, heart-rate low/high/average, and weight
 *   - minute-level heart rate, but only inside the windows of your logged gym
 *     sessions, so storage stays small
 *
 * File names look like `com.samsung.shealth.tracker.heart_rate.20261114093000.csv`.
 * The part before the 14-digit timestamp says what is inside. Column names are
 * long (`com.samsung.health.heart_rate.heart_rate`) and the prefix changes
 * between export versions, so columns are matched on their last segment.
 */
import { SAMSUNG_TYPES } from './data/exercises.js';
import { dayKey } from './metrics.js';

const WANTED = {
  'com.samsung.shealth.tracker.heart_rate': 'hr',
  'com.samsung.shealth.exercise': 'exercise',
  'com.samsung.shealth.tracker.pedometer_day_summary': 'steps',
  'com.samsung.shealth.step_daily_trend': 'stepsTrend',
  'com.samsung.shealth.sleep': 'sleep',
  'com.samsung.health.weight': 'weight',
};

export function fileKind(name) {
  const base = String(name).split('/').pop();
  const m = /^(.+?)\.(\d{12,14})\.csv$/i.exec(base);
  if (!m) return null;
  return WANTED[m[1]] ?? null;
}

// ── Reading files ────────────────────────────────────────────────────────

/** Accepts a mix of .zip and .csv Files. Returns [{ name, kind, text }]. */
export async function readFiles(files, onProgress = () => {}) {
  const out = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const entries = await unzip(await file.arrayBuffer(), (name) => fileKind(name) != null, onProgress);
      for (const e of entries) out.push({ name: e.name.split('/').pop(), kind: fileKind(e.name), text: e.text });
    } else if (fileKind(file.name)) {
      onProgress(`Reading ${file.name}`);
      out.push({ name: file.name, kind: fileKind(file.name), text: await file.text() });
    }
  }
  return out;
}

/**
 * Minimal zip reader: central directory, stored and deflated entries only.
 * Uses the browser's DecompressionStream, so there is no library to download.
 */
export async function unzip(buffer, want, onProgress = () => {}) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('That does not look like a zip file.');
  let count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // Zip64: very large exports.
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (view.getUint32(locator, true) === 0x07064b50) {
      const z64 = Number(view.getBigUint64(locator + 8, true));
      count = Number(view.getBigUint64(z64 + 32, true));
      cdOffset = Number(view.getBigUint64(z64 + 48, true));
    }
  }

  const decoder = new TextDecoder();
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    let compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // Zip64 extra field carries the real sizes/offset.
    if (compSize === 0xffffffff || localOffset === 0xffffffff) {
      let q = p + 46 + nameLen;
      const end = q + extraLen;
      while (q < end) {
        const id = view.getUint16(q, true);
        const size = view.getUint16(q + 2, true);
        if (id === 0x0001) {
          let r = q + 4;
          const uncomp = view.getUint32(p + 24, true);
          if (uncomp === 0xffffffff) r += 8;
          if (compSize === 0xffffffff) {
            compSize = Number(view.getBigUint64(r, true));
            r += 8;
          }
          if (localOffset === 0xffffffff) localOffset = Number(view.getBigUint64(r, true));
        }
        q += 4 + size;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;

    if (!want(name)) continue;
    onProgress(`Unpacking ${name.split('/').pop()}`);
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + compSize);

    let raw;
    if (method === 0) raw = data;
    else if (method === 8) raw = await inflate(data);
    else continue;
    out.push({ name, text: decoder.decode(raw) });
  }
  return out;
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ── CSV ──────────────────────────────────────────────────────────────────

/** RFC-4180-ish CSV: quotes, escaped quotes, commas and newlines in quotes. */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Rows as objects keyed by the last segment of each column name.
 * Samsung puts a one-line metadata header above the real header; it is
 * recognised and skipped.
 */
export function parseSamsungCsv(text) {
  const rows = parseCsvRows(text);
  let h = 0;
  const looksLikeHeader = (r) => r.some((c) => /(start_time|day_time|create_time|datauuid|update_time)$/.test(c.trim()));
  if (!looksLikeHeader(rows[0] ?? []) && looksLikeHeader(rows[1] ?? [])) h = 1;
  const header = (rows[h] ?? []).map((c) => c.trim().split('.').pop());
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 2) continue;
    const obj = {};
    header.forEach((key, j) => {
      if (key && obj[key] === undefined) obj[key] = r[j] ?? '';
    });
    out.push(obj);
  }
  return out;
}

/** Samsung writes "2026-11-14 14:05:00.000" in UTC; some fields are epoch ms. */
export function parseTime(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (/^\d{12,}$/.test(v)) return Number(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(v);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Number((m[7] ?? '0').slice(0, 3).padEnd(3, '0')));
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : null;
};

// ── Building the watch summary ───────────────────────────────────────────

/**
 * files: output of readFiles. sessions: your logged sessions, used to decide
 * which minute-level heart rate to keep.
 */
export function buildWatch(files, sessions = []) {
  const days = {};
  const day = (k) => (days[k] ??= { steps: null, hrLow: null, hrHigh: null, hrSum: 0, hrN: 0, sleepMin: null, weightKg: null });
  const workouts = [];
  const hrSamples = [];
  const windows = sessions.map((s) => [s.startedAt - 15 * 60000, (s.endedAt ?? s.startedAt) + 15 * 60000]).sort((a, b) => a[0] - b[0]);
  const inWindow = (t) => windows.some(([a, b]) => t >= a && t <= b);
  let from = Infinity;
  let to = -Infinity;
  const stamp = (t) => {
    if (t == null) return;
    from = Math.min(from, t);
    to = Math.max(to, t);
  };
  const counts = {};

  for (const file of files) {
    const rows = parseSamsungCsv(file.text);
    counts[file.kind] = (counts[file.kind] ?? 0) + rows.length;

    if (file.kind === 'hr') {
      for (const r of rows) {
        const t = parseTime(r.start_time);
        const bpm = num(r.heart_rate);
        if (t == null || !bpm || bpm < 25 || bpm > 240) continue;
        stamp(t);
        const d = day(dayKey(t));
        d.hrLow = d.hrLow == null ? bpm : Math.min(d.hrLow, bpm);
        d.hrHigh = d.hrHigh == null ? bpm : Math.max(d.hrHigh, bpm);
        d.hrSum += bpm;
        d.hrN += 1;
        if (inWindow(t)) hrSamples.push([t, bpm]);
      }
    } else if (file.kind === 'exercise') {
      for (const r of rows) {
        const start = parseTime(r.start_time);
        if (start == null) continue;
        const durationMs = num(r.duration);
        const end = parseTime(r.end_time) ?? (durationMs ? start + durationMs : start);
        const type = num(r.exercise_type) ?? 0;
        stamp(start);
        workouts.push({
          start,
          end,
          type,
          typeName: SAMSUNG_TYPES[type] ?? (r.exercise_custom_type ? 'Custom workout' : `Workout type ${type}`),
          kcal: num(r.calorie) ?? num(r.total_calorie),
          avgHr: num(r.mean_heart_rate),
          maxHr: num(r.max_heart_rate),
          minHr: num(r.min_heart_rate),
          distanceM: num(r.distance),
          durationMs: durationMs ?? end - start,
        });
      }
    } else if (file.kind === 'steps' || file.kind === 'stepsTrend') {
      for (const r of rows) {
        const t = num(r.day_time) ?? parseTime(r.day_time);
        const steps = num(r.step_count) ?? num(r.count);
        if (t == null || steps == null) continue;
        // day_time is UTC midnight of the calendar day it summarises.
        const k = new Date(t).toISOString().slice(0, 10);
        const d = day(k);
        d.steps = Math.max(d.steps ?? 0, steps);
        stamp(t);
      }
    } else if (file.kind === 'sleep') {
      for (const r of rows) {
        const a = parseTime(r.start_time);
        const b = parseTime(r.end_time);
        if (a == null || b == null || b <= a) continue;
        const mins = (b - a) / 60000;
        if (mins > 20 * 60) continue;
        const d = day(dayKey(b)); // credited to the morning you woke up
        d.sleepMin = (d.sleepMin ?? 0) + mins;
        stamp(b);
      }
    } else if (file.kind === 'weight') {
      for (const r of rows) {
        const t = parseTime(r.start_time) ?? parseTime(r.create_time);
        const kg = num(r.weight);
        if (t == null || !kg) continue;
        day(dayKey(t)).weightKg = kg;
        stamp(t);
      }
    }
  }

  for (const d of Object.values(days)) {
    d.hrAvg = d.hrN ? Math.round(d.hrSum / d.hrN) : null;
    delete d.hrSum;
  }

  workouts.sort((a, b) => a.start - b.start);
  hrSamples.sort((a, b) => a[0] - b[0]);
  return {
    importedAt: Date.now(),
    files: files.map((f) => f.name),
    counts,
    range: Number.isFinite(from) ? { from, to } : null,
    workouts,
    days,
    hrSamples: dedupe(hrSamples),
  };
}

function dedupe(samples) {
  const out = [];
  let last = null;
  for (const s of samples) {
    if (last && last[0] === s[0]) continue;
    out.push(s);
    last = s;
  }
  return out;
}

/**
 * Watch data for one logged session: the overlapping Samsung workout (if you
 * started one on the watch) and the heart-rate readings inside the session.
 * Bluetooth samples recorded live take priority over imported ones.
 */
export function watchForSession(session, watch) {
  const a = session.startedAt;
  const b = session.endedAt ?? Date.now();
  const pad = 15 * 60000;
  const workout = watch?.workouts?.find((w) => w.start < b + pad && w.end > a - pad) ?? null;
  const live = session.hr?.length ? session.hr : null;
  const imported = watch?.hrSamples?.filter(([t]) => t >= a - 60000 && t <= b + 60000) ?? [];
  return { workout, samples: live ?? (imported.length ? imported : null), source: live ? 'live' : imported.length ? 'watch' : null };
}
