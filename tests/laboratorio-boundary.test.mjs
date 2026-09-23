import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('LAB está aislado de CANON y producción', () => {
  const root = resolve(import.meta.dirname, '..');
  const output = execFileSync(process.execPath, ['laboratorio/check.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.match(output, /LAB_BOUNDARY_PASS/);
});
