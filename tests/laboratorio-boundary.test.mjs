import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('LAB está aislado de CANON y producción', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = execFileSync(process.execPath, ['laboratorio/check.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.match(output, /LAB_BOUNDARY_PASS/);
});
