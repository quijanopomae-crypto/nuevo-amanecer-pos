import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

function escapeRegex(text) {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

export function globToRegExp(glob) {
  const normalized = String(glob).replaceAll('\\', '/');
  const marker = '__DOUBLE_STAR__';
  let pattern = escapeRegex(normalized)
    .replaceAll('**', marker)
    .replaceAll('*', '[^/]*')
    .replaceAll(marker, '.*');
  return new RegExp('^' + pattern + '$');
}

function matchesAny(path, globs) {
  return globs.some(glob => globToRegExp(glob).test(path));
}

export function validateContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return ['contrato inválido'];
  if (!contract.task_id) errors.push('task_id requerido');
  if (contract.environment !== 'LABORATORIO') errors.push('environment debe ser LABORATORIO');
  if (!contract.base_ref) errors.push('base_ref requerido');
  if (!contract.objective) errors.push('objective requerido');
  if (!Array.isArray(contract.allowed_files) || !contract.allowed_files.length) errors.push('allowed_files no puede estar vacío');
  if (!Array.isArray(contract.forbidden_files)) errors.push('forbidden_files debe ser un array');
  if (!Array.isArray(contract.required_skills) || !contract.required_skills.length) errors.push('required_skills no puede estar vacío');

  const mustBeFalse = [
    ['production_data', contract.production_data],
    ['production_data_authority', contract.production_data_authority],
    ['production_credentials', contract.production_credentials],
    ['production_writes', contract.production_writes],
    ['canon_writes', contract.canon_writes]
  ];
  for (const [name, value] of mustBeFalse) {
    if (value === true) errors.push(name + ' debe ser false en LAB');
  }

  if (Number(contract.schema_version) >= 2) {
    for (const name of ['production_data_authority', 'production_credentials', 'production_writes', 'canon_writes']) {
      if (contract[name] !== false) errors.push(name + '=false requerido en schema_version>=2');
    }
    if (typeof contract.isolated_d1_data_allowed !== 'boolean') {
      errors.push('isolated_d1_data_allowed boolean requerido en schema_version>=2');
    }
  }
  return errors;
}

export function validateChangedFiles(changedFiles, contract) {
  const errors = validateContract(contract);
  const environment = contract?.environment;
  const allowed = Array.isArray(contract?.allowed_files) ? contract.allowed_files : [];
  const forbidden = Array.isArray(contract?.forbidden_files) ? contract.forbidden_files : [];

  for (const raw of changedFiles) {
    const path = String(raw).replaceAll('\\', '/');
    if (!path) continue;

    if (environment === 'LABORATORIO' && path.startsWith('POS/')) {
      errors.push('CANON prohibido en LAB: ' + path);
      continue;
    }
    if (matchesAny(path, forbidden)) {
      errors.push('Archivo prohibido: ' + path);
      continue;
    }
    if (!matchesAny(path, allowed)) {
      errors.push('Fuera de alcance: ' + path);
    }
  }
  return errors;
}

function readArg(prefix) {
  const arg = process.argv.find(item => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function gitNames(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
      .split(/\r?\n/)
      .map(x => x.trim())
      .filter(Boolean);
  } catch (error) {
    throw new Error('No se pudo leer git diff: ' + error.message);
  }
}

export function collectChangedFiles(baseRef) {
  const names = new Set();
  if (baseRef) for (const x of gitNames(['diff', '--name-only', '--diff-filter=ACMRD', baseRef + '...HEAD'])) names.add(x);
  for (const x of gitNames(['diff', '--name-only', '--diff-filter=ACMRD'])) names.add(x);
  for (const x of gitNames(['diff', '--cached', '--name-only', '--diff-filter=ACMRD'])) names.add(x);
  for (const x of gitNames(['ls-files', '--others', '--exclude-standard'])) names.add(x);
  return [...names].sort();
}

function main() {
  const taskArg = readArg('--task=');
  if (!taskArg) {
    console.error('Uso: node laboratorio/pos-lab/scope-guard.mjs --task=<archivo.json> [--base=<ref>]');
    process.exit(2);
  }

  const taskPath = resolve(repoRoot, taskArg);
  const contract = JSON.parse(readFileSync(taskPath, 'utf8'));
  const base = readArg('--base=') || contract.base_ref || null;
  const changed = collectChangedFiles(base);
  const errors = validateChangedFiles(changed, contract);

  if (errors.length) {
    console.error('LAB_SCOPE_FAIL');
    for (const error of errors) console.error('- ' + error);
    process.exit(1);
  }

  console.log('LAB_SCOPE_PASS');
  console.log(JSON.stringify({ task_id: contract.task_id, changed_files: changed }, null, 2));
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) main();
