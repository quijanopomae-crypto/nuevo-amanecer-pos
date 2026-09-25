import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  globToRegExp,
  validateChangedFiles,
  validateContract
} from '../laboratorio/pos-lab/scope-guard.mjs';

function contract(overrides = {}) {
  return {
    schema_version: 2,
    task_id: 'T',
    environment: 'LABORATORIO',
    base_ref: 'feature/v1.3-mobile-cloud',
    objective: 'Prueba de alcance',
    allowed_files: ['laboratorio/**'],
    forbidden_files: ['POS/**', 'infra/**'],
    required_skills: ['lab-scope-guard'],
    production_data_authority: false,
    isolated_d1_data_allowed: true,
    production_credentials: false,
    production_writes: false,
    canon_writes: false,
    ...overrides
  };
}

test('glob LAB soporta * y **', () => {
  assert.equal(globToRegExp('laboratorio/**').test('laboratorio/pos-lab/a.css'), true);
  assert.equal(globToRegExp('laboratorio/pos-lab/*.html').test('laboratorio/pos-lab/index.html'), true);
  assert.equal(globToRegExp('laboratorio/pos-lab/*.html').test('laboratorio/pos-lab/sections/a.html'), false);
});

test('scope guard rechaza CANON aunque se intente permitir', () => {
  const c = contract({ allowed_files: ['laboratorio/**', 'POS/**'] });
  const errors = validateChangedFiles(['POS/index.html'], c);
  assert.equal(errors.some(x => x.includes('CANON prohibido')), true);
});

test('scope guard rechaza archivos fuera de allowlist', () => {
  const c = contract({ allowed_files: ['laboratorio/pos-lab/styles/**'] });
  assert.deepEqual(validateChangedFiles(['laboratorio/pos-lab/styles/pages/pos.css'], c), []);
  assert.equal(validateChangedFiles(['AGENTS.md'], c).some(x => x.includes('Fuera de alcance')), true);
  assert.equal(validateChangedFiles(['infra/x'], c).some(x => x.includes('Archivo prohibido')), true);
});

test('schema v2 exige declaraciones de seguridad ejecutables', () => {
  assert.deepEqual(validateContract(contract()), []);
  assert.equal(validateContract(contract({ production_writes: true })).some(x => x.includes('production_writes')), true);
  assert.equal(validateContract(contract({ canon_writes: true })).some(x => x.includes('canon_writes')), true);
  assert.equal(validateContract(contract({ production_credentials: true })).some(x => x.includes('production_credentials')), true);
  assert.equal(validateContract(contract({ isolated_d1_data_allowed: undefined })).some(x => x.includes('isolated_d1_data_allowed')), true);
});

test('schema v1 histórico conserva aliases seguros', () => {
  const legacy = {
    schema_version: 1,
    task_id: 'LEGACY',
    environment: 'LABORATORIO',
    base_ref: 'feature/v1.3-mobile-cloud',
    objective: 'Contrato histórico',
    allowed_files: ['laboratorio/**'],
    forbidden_files: ['POS/**'],
    required_skills: ['lab-scope-guard'],
    production_data: false,
    production_credentials: false,
    production_writes: false
  };
  assert.deepEqual(validateContract(legacy), []);
  assert.equal(validateContract({ ...legacy, production_data: true }).some(x => x.includes('production_data')), true);
});

test('scope guard incluye archivos untracked y validator no declara PASS sin scope', () => {
  const scopeSource = readFileSync('laboratorio/pos-lab/scope-guard.mjs', 'utf8');
  const validateSource = readFileSync('laboratorio/pos-lab/validate-lab.mjs', 'utf8');
  assert.match(scopeSource, /ls-files['"],\s*['"]--others['"],\s*['"]--exclude-standard/);
  assert.match(validateSource, /LAB_VALIDATE_FAIL: se requiere --task=/);
  assert.match(validateSource, /LAB_VALIDATE_PARTIAL/);
  assert.doesNotMatch(validateSource, /LAB_SCOPE_SKIPPED: usa --task/);
});


test('schema v3 exige skills base, skill específica y recibo previo', () => {
  const v3 = contract({
    schema_version: 3,
    required_skills: ['impact-analysis', 'cross-module-impact', 'lab-scope-guard', 'lab-feature-edit'],
    skill_preflight_receipt: 'laboratorio/pos-lab/preflight/T.json'
  });
  assert.deepEqual(validateContract(v3), []);

  const missingImpact = { ...v3, required_skills: v3.required_skills.filter(x => x !== 'impact-analysis') };
  assert.equal(validateContract(missingImpact).some(x => x.includes('impact-analysis')), true);

  const missingSpecific = {
    ...v3,
    required_skills: ['impact-analysis', 'cross-module-impact', 'lab-scope-guard']
  };
  assert.equal(validateContract(missingSpecific).some(x => x.includes('skill LAB específica')), true);

  const missingReceipt = { ...v3, skill_preflight_receipt: undefined };
  assert.equal(validateContract(missingReceipt).some(x => x.includes('skill_preflight_receipt')), true);
});
