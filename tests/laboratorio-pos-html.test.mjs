import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('POS-LAB existe y no convierte CANON en laboratorio', () => {
  const canon = readFileSync(resolve(root, 'POS/index.html'), 'utf8');
  const lab = readFileSync(resolve(root, 'laboratorio/pos-lab/index.html'), 'utf8');
  const guard = readFileSync(resolve(root, 'laboratorio/pos-lab/lab-guard.js'), 'utf8');
  const server = readFileSync(resolve(root, 'laboratorio/pos-lab/server.mjs'), 'utf8');
  const source = JSON.parse(readFileSync(resolve(root, 'laboratorio/pos-lab/SOURCE.json'), 'utf8'));

  assert.doesNotMatch(canon, /LABORATORIO · NO PRODUCCIÓN/);
  assert.match(lab, /LABORATORIO · NO PRODUCCIÓN/);
  assert.match(lab, /<base href="\/POS\/">/);
  assert.match(lab, /\/laboratorio\/pos-lab\/lab-guard\.js/);
  assert.match(lab, /!window\.__NA_LAB__/);
  assert.match(guard, /NA_LAB_PRODUCTION_WRITE_BLOCKED/);
  assert.match(server, /127\.0\.0\.1/);
  assert.match(server, /8799/);
  assert.equal(source.source_path, 'POS/index.html');
  assert.equal(source.snapshot_path, 'laboratorio/pos-lab/index.html');
  assert.equal(source.canonical_modified, false);
  assert.equal(source.production_writes_blocked, true);
});
