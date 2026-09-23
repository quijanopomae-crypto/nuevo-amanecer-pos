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
if (taskArg) {
  run('scope', process.execPath, ['laboratorio/pos-lab/scope-guard.mjs', taskArg]);
} else {
  console.log('LAB_SCOPE_SKIPPED: usa --task=<contrato.json> para validar alcance git');
}

console.log('LAB_VALIDATE_PASS');
