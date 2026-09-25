import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export const REQUIRED_BASE_SKILLS = [
  'impact-analysis',
  'cross-module-impact',
  'lab-scope-guard'
];

export const LAB_SPECIFIC_SKILLS = [
  'lab-feature-edit',
  'lab-ui-edit',
  'lab-animation-edit'
];

const GUARDED_PREFIXES = [
  'laboratorio/pos-lab/',
  'tools/cloudflare-lab/',
  '.agents/skills/'
];

const GUARDED_EXACT = new Set([
  'AGENTS.md',
  '.opencode/commands/lab-preflight.md',
  '.opencode/agents/pos-lab-implementer.md',
  '.github/workflows/lab-cloud-ci.yml'
]);

function normalize(path) {
  return String(path || '').replaceAll('\\', '/');
}

function runGit(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function lines(value) {
  return String(value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8'));
}

function skillPath(skill) {
  return `.agents/skills/${skill}/SKILL.md`;
}

function gitBlobSha(relativePath) {
  return runGit(['hash-object', relativePath]);
}

function isTask(path) {
  return /^laboratorio\/pos-lab\/tasks\/[^/]+\.json$/.test(path);
}

function isReceipt(path) {
  return /^laboratorio\/pos-lab\/preflight\/[^/]+\.json$/.test(path);
}

function isGuarded(path) {
  path = normalize(path);
  if (/^tests\/laboratorio-[^/]+\.test\.mjs$/.test(path)) return true;
  if (GUARDED_EXACT.has(path)) return true;
  return GUARDED_PREFIXES.some(prefix => path.startsWith(prefix));
}

function isPreflightOnly(path) {
  return isTask(path) || isReceipt(path);
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item =>
    typeof item === 'string' ? item.trim().length > 0 : item && typeof item === 'object'
  );
}

export function validateSkillContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return ['contrato inválido'];
  if (Number(contract.schema_version) < 3) {
    errors.push('schema_version>=3 requerido para SKILL_PREFLIGHT');
    return errors;
  }
  if (contract.environment !== 'LABORATORIO') errors.push('environment debe ser LABORATORIO');
  if (!contract.task_id) errors.push('task_id requerido');
  if (!contract.base_ref) errors.push('base_ref requerido');
  if (!Array.isArray(contract.required_skills)) errors.push('required_skills requerido');
  const required = new Set(contract.required_skills || []);
  for (const skill of REQUIRED_BASE_SKILLS) {
    if (!required.has(skill)) errors.push('skill base requerida: ' + skill);
  }
  if (!LAB_SPECIFIC_SKILLS.some(skill => required.has(skill))) {
    errors.push('se requiere una skill LAB específica: ' + LAB_SPECIFIC_SKILLS.join(', '));
  }
  if (typeof contract.skill_preflight_receipt !== 'string' ||
      !/^laboratorio\/pos-lab\/preflight\/[^/]+\.json$/.test(contract.skill_preflight_receipt)) {
    errors.push('skill_preflight_receipt inválido o ausente');
  }
  return errors;
}

export function validateReceipt(contract, receipt, { verifyBlobs = true } = {}) {
  const errors = [...validateSkillContract(contract)];
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    errors.push('recibo de preflight inválido');
    return errors;
  }
  if (receipt.schema !== 'nuevo-amanecer.lab-skill-preflight/v1') errors.push('schema de recibo inválido');
  if (receipt.task_id !== contract.task_id) errors.push('task_id del recibo no coincide');
  if (receipt.base_ref !== contract.base_ref) errors.push('base_ref del recibo no coincide');
  if (receipt.phase !== 'BEFORE_WRITE') errors.push('phase debe ser BEFORE_WRITE');
  if (receipt.status !== 'SKILL_PREFLIGHT_PASS') errors.push('status debe ser SKILL_PREFLIGHT_PASS');
  if (receipt.applies_to_all_writers !== true) errors.push('applies_to_all_writers=true requerido');

  const writers = Array.isArray(receipt.writer_classes) ? receipt.writer_classes : [];
  for (const requiredWriter of ['ChatGPT', 'GitHub connector', 'OpenCode']) {
    if (!writers.includes(requiredWriter)) errors.push('writer_class requerido: ' + requiredWriter);
  }

  const analysis = receipt.analysis || {};
  for (const field of [
    'READS',
    'WRITES',
    'STATE_AFFECTED',
    'STORAGE_AFFECTED',
    'DOMAIN_INVARIANTS',
    'CROSS_MODULE_IMPACT',
    'RISKS',
    'ROLLBACK',
    'TESTS'
  ]) {
    if (!nonEmptyArray(analysis[field])) errors.push('analysis.' + field + ' debe ser no vacío');
  }
  if (!Array.isArray(analysis.DOM_AFFECTED)) errors.push('analysis.DOM_AFFECTED debe ser array');

  const skills = receipt.skills || {};
  for (const skill of contract.required_skills || []) {
    const entry = skills[skill];
    const expectedPath = skillPath(skill);
    if (!entry || entry.path !== expectedPath) {
      errors.push('recibo no acredita skill: ' + skill);
      continue;
    }
    if (!/^[0-9a-f]{40,64}$/.test(String(entry.git_blob_sha || ''))) {
      errors.push('git_blob_sha inválido para skill: ' + skill);
      continue;
    }
    if (verifyBlobs) {
      if (!existsSync(resolve(repoRoot, expectedPath))) {
        errors.push('SKILL.md ausente: ' + expectedPath);
      } else {
        const actual = gitBlobSha(expectedPath);
        if (actual !== entry.git_blob_sha) {
          errors.push('skill cambió desde el preflight: ' + skill + ' expected=' + entry.git_blob_sha + ' actual=' + actual);
        }
      }
    }
  }
  return errors;
}

function changedFiles(baseRef) {
  return lines(runGit(['diff', '--name-only', '--diff-filter=ACMRD', baseRef + '...HEAD']))
    .map(normalize);
}

function commitsSince(baseRef) {
  return lines(runGit(['rev-list', '--reverse', baseRef + '..HEAD']));
}

function changedInCommit(commit) {
  return lines(runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', commit])).map(normalize);
}

function firstCommitIndexForPath(commits, target) {
  for (let i = 0; i < commits.length; i += 1) {
    if (changedInCommit(commits[i]).includes(target)) return i;
  }
  return -1;
}

function verifyTemporalOrder(baseRef, taskPath, receiptPath) {
  const commits = commitsSince(baseRef);
  let firstImplementation = -1;
  for (let i = 0; i < commits.length; i += 1) {
    const changed = changedInCommit(commits[i]);
    if (changed.some(path => isGuarded(path) && !isPreflightOnly(path))) {
      firstImplementation = i;
      break;
    }
  }
  if (firstImplementation < 0) return [];

  const taskIndex = firstCommitIndexForPath(commits, taskPath);
  const receiptIndex = firstCommitIndexForPath(commits, receiptPath);
  const errors = [];
  if (taskIndex < 0) errors.push('Task Contract no aparece en historial del PR: ' + taskPath);
  if (receiptIndex < 0) errors.push('Recibo no aparece en historial del PR: ' + receiptPath);
  if (taskIndex >= firstImplementation) errors.push('Task Contract debe existir antes del primer cambio funcional');
  if (receiptIndex >= firstImplementation) errors.push('SKILL_PREFLIGHT_PASS debe existir antes del primer cambio funcional');
  return errors;
}

function verifyCi(baseRef, requireOrder) {
  const changed = changedFiles(baseRef);
  const guardedImplementation = changed.filter(path => isGuarded(path) && !isPreflightOnly(path));
  if (!guardedImplementation.length) {
    console.log('SKILL_PREFLIGHT_NOT_REQUIRED');
    return;
  }

  const taskPaths = changed.filter(isTask);
  const receiptPaths = changed.filter(isReceipt);
  const schema3Tasks = taskPaths
    .map(path => ({ path, value: readJson(path) }))
    .filter(item => Number(item.value.schema_version) >= 3);

  const errors = [];
  if (!schema3Tasks.length) errors.push('cambio LAB protegido requiere un Task Contract schema_version>=3 nuevo/modificado');
  if (!receiptPaths.length) errors.push('cambio LAB protegido requiere un recibo SKILL_PREFLIGHT nuevo/modificado');

  for (const item of schema3Tasks) {
    const contract = item.value;
    const receiptPath = contract.skill_preflight_receipt;
    if (!receiptPath || !changed.includes(receiptPath)) {
      errors.push('el recibo declarado debe formar parte del diff del PR: ' + String(receiptPath || 'ausente'));
      continue;
    }
    const receipt = readJson(receiptPath);
    errors.push(...validateReceipt(contract, receipt));
    if (requireOrder) errors.push(...verifyTemporalOrder(baseRef, item.path, receiptPath));
  }

  if (errors.length) {
    console.error('SKILL_PREFLIGHT_FAIL');
    for (const error of [...new Set(errors)]) console.error('- ' + error);
    process.exit(1);
  }

  console.log('SKILL_PREFLIGHT_PASS');
  console.log(JSON.stringify({
    base_ref: baseRef,
    require_order: requireOrder,
    guarded_files: guardedImplementation,
    task_contracts: schema3Tasks.map(item => item.path)
  }, null, 2));
}

function arg(prefix) {
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function main() {
  const ci = process.argv.includes('--ci');
  if (ci) {
    const base = arg('--base=');
    if (!base) {
      console.error('SKILL_PREFLIGHT_FAIL\n- --base requerido en modo CI');
      process.exit(2);
    }
    verifyCi(base, arg('--require-order=') === 'true');
    return;
  }

  const taskPath = arg('--task=');
  const receiptPath = arg('--receipt=');
  if (!taskPath || !receiptPath) {
    console.error('Uso: node laboratorio/pos-lab/skill-preflight.mjs --task=<task.json> --receipt=<receipt.json>');
    process.exit(2);
  }
  const contract = readJson(normalize(taskPath));
  const receipt = readJson(normalize(receiptPath));
  const errors = validateReceipt(contract, receipt);
  if (errors.length) {
    console.error('SKILL_PREFLIGHT_FAIL');
    for (const error of errors) console.error('- ' + error);
    process.exit(1);
  }
  console.log('SKILL_PREFLIGHT_PASS');
  console.log(JSON.stringify({
    task_id: contract.task_id,
    base_ref: contract.base_ref,
    skills: contract.required_skills
  }, null, 2));
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) main();
