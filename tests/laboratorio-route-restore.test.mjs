import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guard = readFileSync('laboratorio/pos-lab/lab-guard.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/lab-overrides.css', 'utf8');
const overrides = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const contract = JSON.parse(readFileSync('laboratorio/pos-lab/tasks/LAB-ROUTE-RESTORE-FLICKER-001.json', 'utf8'));

test('POS-LAB shields the default menu while a persisted module is restored', () => {
  assert.match(guard, /na_snapshot_v9/);
  assert.match(guard, /initialLabPage !== 'pageMenu'/);
  assert.match(guard, /lab-route-restoring/);
  assert.match(css, /html\.lab-route-restoring #pageMenu/);
  assert.match(overrides, /originalLoadAppState/);
  assert.match(overrides, /clearRouteRestoreShield/);
});

test('route restore fix is explicitly scoped to LAB', () => {
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
  assert.ok(contract.allowed_files.every((path) =>
    path.startsWith('laboratorio/pos-lab/') || path === 'tests/laboratorio-route-restore.test.mjs'
  ));
});
