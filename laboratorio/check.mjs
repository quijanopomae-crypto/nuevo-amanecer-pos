import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lab = join(root, 'laboratorio');
const canon = join(root, 'POS');
const policy = JSON.parse(readFileSync(join(lab, 'LAB_POLICY.json'), 'utf8'));

const failures = [];
function fail(message) { failures.push(message); }

if (policy.laboratory_path !== 'laboratorio/') fail('LAB_POLICY laboratory_path inválido');
if (policy.canonical_product_path !== 'POS/') fail('LAB_POLICY canonical_product_path inválido');
for (const key of [
  'production_data_allowed',
  'production_credentials_allowed',
  'credentials_versioned_or_client_exposed_allowed',
  'production_writes_allowed',
  'canonical_runtime_dependency_on_lab_allowed'
]) {
  if (policy[key] !== false) fail('LAB_POLICY debe mantener ' + key + '=false');
}
for (const key of [
  'isolated_canon_copy_in_d1_lab_allowed',
  'encrypted_ci_secrets_allowed'
]) {
  if (policy[key] !== true) fail('LAB_POLICY debe mantener ' + key + '=true');
}
if (policy.real_commercial_data_versioning_allowed !== false) {
  fail('LAB_POLICY debe mantener real_commercial_data_versioning_allowed=false');
}
if (policy.required_branch_prefix !== 'lab/') fail('La rama de laboratorio debe usar prefijo lab/');
if (policy.promotion_mode !== 'reviewed-minimal-patch') fail('La promoción debe ser reviewed-minimal-patch');

const forbiddenNames = new Set([
  '.env', '.env.local', '.dev.vars', 'secrets.json', 'credentials.json',
  'production.json', 'prod.json'
]);
const forbiddenExt = ['.pem', '.key', '.p12', '.pfx'];
const textExt = ['.html','.js','.mjs','.cjs','.css','.json','.md','.txt','.yaml','.yml','.webmanifest'];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (stat.isFile()) out.push(path);
  }
  return out;
}

for (const file of walk(lab)) {
  const rel = relative(root, file).replaceAll('\\', '/');
  const name = rel.split('/').at(-1).toLowerCase();
  if (forbiddenNames.has(name) || forbiddenExt.some(ext => name.endsWith(ext))) {
    fail('Archivo sensible prohibido en LAB: ' + rel);
  }
}

for (const file of walk(canon)) {
  const lower = file.toLowerCase();
  if (!textExt.some(ext => lower.endsWith(ext))) continue;
  let content = '';
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  if (/(?:^|['"`(=:\s])(?:\.\.\/)+laboratorio\//i.test(content) ||
      /(?:^|['"`(=:\s])\/laboratorio\//i.test(content)) {
    fail('CANON no puede depender de LAB: ' + relative(root, file).replaceAll('\\', '/'));
  }
}

const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
for (const required of [
  'laboratorio/private/**',
  'laboratorio/**/.env*',
  'laboratorio/**/.dev.vars',
  'laboratorio/**/node_modules/**'
]) {
  if (!gitignore.split(/\r?\n/).includes(required)) fail('.gitignore no protege: ' + required);
}

if (failures.length) {
  console.error('LAB_BOUNDARY_FAIL');
  failures.forEach(item => console.error('- ' + item));
  process.exit(1);
}

console.log('LAB_BOUNDARY_PASS');
