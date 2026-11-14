// Run: node --test test/
// Every module the app loads must be in the service worker's SHELL, or it
// will not work offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
  });
}

test('every assets/js module is listed in sw.js SHELL', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  for (const f of jsFiles(join(ROOT, 'assets/js'))) {
    const rel = relative(ROOT, f).split('\\').join('/');
    assert.ok(sw.includes(`'${rel}'`), `${rel} is missing from SHELL`);
  }
});
