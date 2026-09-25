import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LAB_SPECIFIC_SKILLS,
  REQUIRED_BASE_SKILLS,
  validateReceipt,
  validateSkillContract
} from '../laboratorio/pos-lab/skill-preflight.mjs';

const task = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-SKILL-PREFLIGHT-GATE-001.json',
  'utf8'
));
const receipt = JSON.parse(readFileSync(
  'laboratorio/pos-lab/preflight/LAB-SKILL-PREFLIGHT-GATE-001.json',
  'utf8'
));

test('schema v3 exige impact, cross-module, scope y skill LAB específica', () => {
  assert.deepEqual(validateSkillContract(task), []);
  for (const skill of REQUIRED_BASE_SKILLS) {
    const broken = structuredClone(task);
    broken.required_skills = broken.required_skills.filter(x => x !== skill);
    assert.equal(validateSkillContract(broken).some(x => x.includes(skill)), true);
  }
  const noSpecific = structuredClone(task);
  noSpecific.required_skills = noSpecific.required_skills.filter(x => !LAB_SPECIFIC_SKILLS.includes(x));
  assert.equal(validateSkillContract(noSpecific).some(x => x.includes('skill LAB específica')), true);
});

test('recibo real acredita hashes exactos de las skills leídas', () => {
  assert.deepEqual(validateReceipt(task, receipt), []);
});

test('recibo aplica expresamente a ChatGPT, GitHub connector y OpenCode', () => {
  assert.equal(receipt.applies_to_all_writers, true);
  for (const writer of ['ChatGPT', 'GitHub connector', 'OpenCode']) {
    assert.equal(receipt.writer_classes.includes(writer), true);
  }
});

test('hash cambiado después del preflight invalida el gate', () => {
  const broken = structuredClone(receipt);
  broken.skills['impact-analysis'].git_blob_sha = '0'.repeat(40);
  assert.equal(
    validateReceipt(task, broken).some(x => x.includes('skill cambió desde el preflight')),
    true
  );
});

test('análisis ceremonial o vacío no puede declarar PASS', () => {
  const broken = structuredClone(receipt);
  broken.analysis.DOMAIN_INVARIANTS = [];
  assert.equal(
    validateReceipt(task, broken, { verifyBlobs: false }).some(x => x.includes('DOMAIN_INVARIANTS')),
    true
  );
});
