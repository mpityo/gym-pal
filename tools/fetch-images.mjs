#!/usr/bin/env node
// One-off: download reference photos from yuhonas/free-exercise-db (Unlicense)
// for the exercises in tools/image-map.json, resize them, and write
// assets/img/ex/<our id>-<n>.jpg. Not loaded by the site and not in sw.js.
//
// Resizing uses ImageMagick, run once per file:
//   convert <in.jpg> -resize 480x480> -strip -quality 62 <out.jpg>
// (`480x480>` = fit within 480 px on the long edge, never enlarge.)
//
// The map is hand-checked: every picked image was opened and compared with
// the exercise. Ids with no honest match are left out of the map.
//
// Usage: node tools/fetch-images.mjs [--only id1,id2]
// Prints the IMAGE_COUNT object to paste into assets/js/data/images.js.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';
const OUT = join(ROOT, 'assets/img/ex');

const map = JSON.parse(await readFile(join(ROOT, 'tools/image-map.json'), 'utf8'));
const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

const index = await (await fetch(`${BASE}/dist/exercises.json`)).json();
const byId = new Map(index.map((e) => [e.id, e]));

await mkdir(OUT, { recursive: true });
const tmp = join(tmpdir(), 'gym-pal-fetch-images');
await mkdir(tmp, { recursive: true });

const counts = {};
for (const [ours, spec] of Object.entries(map)) {
  if (only && !only.has(ours)) continue;
  // "Some_Id" takes images 0 and 1; "Some_Id:1" takes only the listed indexes
  // (e.g. when image 0 is a set-up pose rather than the movement).
  const [theirs, pick] = spec.split(':');
  const entry = byId.get(theirs);
  if (!entry) {
    console.error(`skip ${ours}: ${theirs} is not in the index`);
    continue;
  }
  const images = pick ? pick.split(',').map((i) => entry.images[Number(i)]).filter(Boolean) : entry.images.slice(0, 2);
  let n = 0;
  for (const path of images) {
    const res = await fetch(`${BASE}/exercises/${path}`);
    if (!res.ok) {
      console.error(`skip ${ours} ${path}: HTTP ${res.status}`);
      continue;
    }
    const raw = join(tmp, `${ours}-${n}.src.jpg`);
    await writeFile(raw, Buffer.from(await res.arrayBuffer()));
    execFileSync('convert', [raw, '-resize', '480x480>', '-strip', '-quality', '62', join(OUT, `${ours}-${n}.jpg`)]);
    n += 1;
  }
  if (n) counts[ours] = n;
}
await rm(tmp, { recursive: true, force: true });
console.log(JSON.stringify(counts, null, 2));
