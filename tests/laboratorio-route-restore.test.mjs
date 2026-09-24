import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guard = readFileSync('laboratorio/pos-lab/lab-guard.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/lab-overrides.css', 'utf8');
const overrides = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');

test('POS-LAB shields the default menu while a persisted module is restored', () => {
  assert.match(guard, /na_snapshot_v9/);
  assert.match(guard, /initialLabPage !== 'pageMenu'/);
  assert.match(guard, /lab-route-restoring/);
  assert.match(css, /html\.lab-route-restoring #pageMenu/);
  assert.match(overrides, /originalLoadAppState/);
  assert.match(overrides, /clearRouteRestoreShield/);
});

test('route restore shield remains LAB-only', () => {
  assert.doesNotMatch(guard, /POS\//);
  assert.doesNotMatch(overrides, /POS\//);
});
