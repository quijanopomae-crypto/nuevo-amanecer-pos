import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const testsDir = join(root, 'tests');

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error('LAB_VALIDATE_FAIL: ' + label);
    process.exit(result.status || 1);
  }
}

run('build-check', process.execPath, ['laboratorio/pos-lab/build-lab.mjs', '--check']);

const labTests = readdirSync(testsDir)
  .filter(name => /^laboratorio-.*\.test\.mjs$/.test(name))
  .sort()
  .map(name => join('tests', name));

if (!labTests.length) {
  console.error('LAB_VALIDATE_FAIL: no hay tests laboratorio-*.test.mjs');
  process.exit(1);
}
run('tests', process.execPath, ['--test', ...labTests]);

const taskArg = process.argv.find(arg => arg.startsWith('--task='));
const skipScope = process.argv.includes('--skip-scope');

if (taskArg) {
  run('scope', process.execPath, ['laboratorio/pos-lab/scope-guard.mjs', taskArg]);
  console.log('LAB_VALIDATE_PASS');
} else if (skipScope) {
  console.log('LAB_SCOPE_SKIPPED_EXPLICIT');
  console.log('LAB_VALIDATE_PARTIAL');
} else {
  console.error('LAB_VALIDATE_FAIL: se requiere --task=<contrato.json> para declarar PASS; usa --skip-scope solo para una validación parcial explícita');
  process.exit(2);
}
