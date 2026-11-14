// Run: node --test test/
// Spec 09: your own machine photos. IndexedDB does not exist in Node, so the
// pure key/fallback logic is tested directly and export/import goes through
// an in-memory adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as photos from '../assets/js/photos.js';

const blob = (text = 'jpegbytes') => new Blob([text], { type: 'image/jpeg' });

test('photoKey uses the gym id, or "any" without a gym', () => {
  assert.equal(photos.photoKey('leg-press', 'g1'), 'g1:leg-press');
  assert.equal(photos.photoKey('leg-press', null), 'any:leg-press');
  assert.equal(photos.photoKey('leg-press', undefined), 'any:leg-press');
});

test("pickPhoto: the gym's photo beats 'any'; 'any' is the fallback; null when neither", () => {
  const recs = [
    { key: 'any:leg-press', exId: 'leg-press', gymId: null },
    { key: 'g1:leg-press', exId: 'leg-press', gymId: 'g1' },
    { key: 'g2:chest-press', exId: 'chest-press', gymId: 'g2' },
  ];
  assert.equal(photos.pickPhoto(recs, 'leg-press', 'g1').key, 'g1:leg-press');
  assert.equal(photos.pickPhoto(recs, 'leg-press', 'g2').key, 'any:leg-press');
  assert.equal(photos.pickPhoto(recs, 'leg-press', null).key, 'any:leg-press');
  assert.equal(photos.pickPhoto(recs, 'chest-press', 'g1'), null, "another gym's photo is not used");
  assert.equal(photos.pickPhoto(recs, 'chest-press', 'g2').key, 'g2:chest-press');
  assert.equal(photos.pickPhoto([], 'x', 'g1'), null);
});

test('exportPhotosFrom / importPhotosInto round-trip', async () => {
  const a = photos.memoryAdapter();
  await a.put({ key: 'g1:leg-press', gymId: 'g1', exId: 'leg-press', blob: blob('one'), width: 800, height: 600, takenAt: 111 });
  await a.put({ key: 'any:pec-deck', gymId: null, exId: 'pec-deck', blob: blob('two'), width: 10, height: 20, takenAt: 222 });
  const list = await photos.exportPhotosFrom(a);
  assert.equal(list.length, 2);
  for (const p of list) {
    assert.match(p.dataUrl, /^data:image\/jpeg;base64,/);
    assert.equal('blob' in p, false, 'no blobs in the JSON');
  }
  // Survives a JSON round trip, as in a backup file.
  const restored = JSON.parse(JSON.stringify(list));
  const b = photos.memoryAdapter();
  assert.equal(await photos.importPhotosInto(b, restored), 2);
  const got = await b.get('g1:leg-press');
  assert.equal(got.exId, 'leg-press');
  assert.equal(got.gymId, 'g1');
  assert.equal(got.takenAt, 111);
  assert.equal(await got.blob.text(), 'one');
  assert.equal(await (await b.get('any:pec-deck')).blob.text(), 'two');
});

test('importPhotosInto skips malformed entries', async () => {
  const b = photos.memoryAdapter();
  const n = await photos.importPhotosInto(b, [null, { exId: 'x' }, { exId: 'y', dataUrl: 'javascript:alert(1)' }, { exId: 3, dataUrl: 'data:image/png;base64,AA==' }]);
  assert.equal(n, 0);
  assert.equal(await photos.importPhotosInto(b, 'nope'), 0);
});

test('the live store: put, fall back, replace, delete, stats and change events', async () => {
  photos._useAdapter(photos.memoryAdapter());
  assert.equal(await photos.init(), true);
  let changes = 0;
  const off = photos.onChange(() => changes++);
  assert.equal(await photos.putPhoto('leg-press', null, blob('anywhere')), true);
  assert.equal(await photos.putPhoto('leg-press', 'g1', blob('at g1')), true);
  assert.equal(await (await photos.getPhoto('leg-press', 'g1')).blob.text(), 'at g1');
  assert.equal(await (await photos.getPhoto('leg-press', 'g2')).blob.text(), 'anywhere');
  assert.equal(photos.photoMeta('leg-press', 'g2').key, 'any:leg-press');
  // Taking a new one replaces it.
  await photos.putPhoto('leg-press', 'g1', blob('newer'));
  assert.equal(await (await photos.getPhoto('leg-press', 'g1')).blob.text(), 'newer');
  assert.equal(photos.photoStats().count, 2);
  await photos.deletePhoto('leg-press', 'g1');
  assert.equal(await (await photos.getPhoto('leg-press', 'g1')).blob.text(), 'anywhere');
  await photos.clearPhotos();
  assert.equal(await photos.getPhoto('leg-press', 'g1'), null);
  assert.equal(photos.photoStats().count, 0);
  assert.ok(changes >= 5);
  off();
});

test('without IndexedDB the feature reports itself unavailable instead of throwing', async () => {
  photos._useAdapter(null);
  assert.equal(typeof indexedDB, 'undefined');
  assert.equal(await photos.init(), false);
  assert.equal(photos.isAvailable(), false);
  assert.equal(await photos.getPhoto('leg-press', null), null);
  assert.equal(await photos.putPhoto('leg-press', null, blob()), false);
  assert.deepEqual(await photos.listPhotos(), []);
  assert.deepEqual(await photos.exportPhotos(), []);
});
