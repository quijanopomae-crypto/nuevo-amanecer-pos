import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  LAB_SPECIFIC_SKILLS,
  REQUIRED_BASE_SKILLS,
  validateReceipt,
  validateSkillContract
} from '../laboratorio/pos-lab/skill-preflight.mjs';

const task = JSON.parse(readFileSync(
  'laboratorio/pos-lab/tasks/LAB-SKILL-PREFLIGHT-GATE-002.json',
  'utf8'
));
const receipt = JSON.parse(readFileSync(
  'laboratorio/pos-lab/preflight/LAB-SKILL-PREFLIGHT-GATE-002.json',
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

function ciWithoutReceipt(t, paths) {
  const dir = mkdtempSync(join(tmpdir(), 'lab-preflight-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = 'laboratorio/pos-lab/skill-preflight.mjs';
  mkdirSync(dirname(join(dir, script)), { recursive: true });
  writeFileSync(join(dir, script), readFileSync(script));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '--quiet');
  git('config', 'user.name', 'Synthetic CI test');
  git('config', 'user.email', 'synthetic@example.invalid');
  git('config', 'core.autocrlf', 'false');
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic base');
  const base = git('rev-parse', 'HEAD').trim();
  for (const path of paths) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), readFileSyncIfScript(path, script));
  }
  git('add', '.'); git('commit', '--quiet', '-m', 'synthetic change');
  return spawnSync(process.execPath, [script, '--ci', '--base='+base, '--require-order=true'], { cwd: dir, encoding: 'utf8' });
}
function readFileSyncIfScript(path, script) {
  return path === script ? readFileSync(script, 'utf8')+'\n// synthetic governance edit\n' : '// synthetic change\n';
}

test('CI rejects real LAB product changes without a contract and receipt', t => {
  const result = ciWithoutReceipt(t, ['laboratorio/pos-lab/js/payment.js']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Task Contract schema_version>=3/);
  assert.match(result.stderr, /recibo SKILL_PREFLIGHT/);
});
test('CI accepts CANON and shared Worker infrastructure without a false LAB preflight', t => {
  const result = ciWithoutReceipt(t, ['POS/js/sync/canonical-client.js', 'tools/cloudflare-lab/src/worker.js', 'tools/cloudflare-lab/src/a6-canonical.js', 'tools/cloudflare-lab/src/a6-replication.js']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKILL_PREFLIGHT_NOT_REQUIRED/);
});
test('CI still rejects mixed shared infrastructure and real LAB changes without preflight', t => {
  const result = ciWithoutReceipt(t, ['tools/cloudflare-lab/src/worker.js', 'laboratorio/pos-lab/styles/pos.css']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /recibo SKILL_PREFLIGHT/);
});
test('CI protects LAB-only backend logic and governance policy', t => {
  for (const path of ['tools/cloudflare-lab/src/lab-workspace.js', 'laboratorio/pos-lab/scope-guard.mjs', '.agents/skills/lab-scope-guard/SKILL.md', '.github/workflows/lab-cloud-ci.yml', 'tests/laboratorio-scope-guard.test.mjs']) {
    const result = ciWithoutReceipt(t, [path]);
    assert.equal(result.status, 1, path);
  }
});
test('CI permits exact preflight classifier maintenance but still rejects accompanying LAB logic', t => {
  const tooling = ['laboratorio/pos-lab/skill-preflight.mjs', 'tests/laboratorio-skill-preflight.test.mjs'];
  assert.equal(ciWithoutReceipt(t, tooling).status, 0);
  assert.equal(ciWithoutReceipt(t, [...tooling, 'laboratorio/pos-lab/js/payment.js']).status, 1);
});
