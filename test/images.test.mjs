// Run: node --test test/
// Spec 08: reference photos for the exercise library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { IMAGE_COUNT, exerciseImages } from '../assets/js/data/images.js';
import { EXERCISES } from '../assets/js/data/exercises.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ids = new Set(EXERCISES.map((e) => e.id));

test('every IMAGE_COUNT key is a real exercise id', () => {
  for (const id of Object.keys(IMAGE_COUNT)) assert.ok(ids.has(id), id);
});

test('at least 50 of the library exercises have a picture', () => {
  assert.ok(EXERCISES.filter((e) => IMAGE_COUNT[e.id]).length >= 50);
});

test('every referenced image exists and is under 60 KB; all of them total at most 3 MB', () => {
  let total = 0;
  for (const id of Object.keys(IMAGE_COUNT)) {
    const files = exerciseImages(id);
    assert.equal(files.length, IMAGE_COUNT[id]);
    for (const f of files) {
      const path = join(ROOT, f);
      assert.ok(existsSync(path), f);
      const { size } = statSync(path);
      assert.ok(size < 60 * 1024, `${f} is ${size} bytes`);
      total += size;
    }
  }
  assert.ok(total <= 3 * 1024 * 1024, `total ${total} bytes`);
});

test('exerciseImages returns [] for an exercise without a picture', () => {
  assert.deepEqual(exerciseImages('no-such-exercise'), []);
});

test('every image listed in sw.js exists, and sw.js lists all of them', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/'(assets\/img\/ex\/[^']+)'/g)].map((m) => m[1]);
  for (const f of listed) assert.ok(existsSync(join(ROOT, f)), f);
  const expected = Object.keys(IMAGE_COUNT).flatMap(exerciseImages);
  assert.deepEqual([...listed].sort(), [...expected].sort());
  assert.ok(sw.includes("'assets/js/data/images.js'"), 'images.js is in SHELL');
});
