import test from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, validateChangedFiles } from '../laboratorio/pos-lab/scope-guard.mjs';

test('glob LAB soporta * y **', () => {
  assert.equal(globToRegExp('laboratorio/**').test('laboratorio/pos-lab/a.css'), true);
  assert.equal(globToRegExp('laboratorio/pos-lab/*.html').test('laboratorio/pos-lab/index.html'), true);
  assert.equal(globToRegExp('laboratorio/pos-lab/*.html').test('laboratorio/pos-lab/sections/a.html'), false);
});

test('scope guard rechaza CANON aunque se intente permitir', () => {
  const contract = {
    task_id: 'T',
    environment: 'LABORATORIO',
    allowed_files: ['laboratorio/**', 'POS/**'],
    forbidden_files: []
  };
  const errors = validateChangedFiles(['POS/index.html'], contract);
  assert.equal(errors.some(x => x.includes('CANON prohibido')), true);
});

test('scope guard rechaza archivos fuera de allowlist', () => {
  const contract = {
    task_id: 'T',
    environment: 'LABORATORIO',
    allowed_files: ['laboratorio/pos-lab/styles/**'],
    forbidden_files: ['infra/**']
  };
  assert.deepEqual(validateChangedFiles(['laboratorio/pos-lab/styles/pages/pos.css'], contract), []);
  assert.equal(validateChangedFiles(['AGENTS.md'], contract).length, 1);
  assert.equal(validateChangedFiles(['infra/x'], contract).length, 1);
});
