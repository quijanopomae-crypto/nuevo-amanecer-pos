// Publish only the canonical reader HTML/JS, never the writer or configuration.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, 'tools/cloudflare-lab/.reader-assets');
const files = ['read-only.html', 'js/sync/read-only.js'];
const allowed = new Set([...files, 'js', 'js/sync']);
function validate(directory, prefix = '') {
  if (!existsSync(directory)) return;
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Reader assets cannot contain symlinks');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!allowed.has(name) || entry.isSymbolicLink()) throw new Error('Unexpected reader asset');
    if (entry.isDirectory()) validate(path.join(directory, entry.name), name + '/');
    else if (!entry.isFile() || !files.includes(name)) throw new Error('Invalid reader asset');
  }
}
validate(output);
for (const file of files) {
  const destination = path.join(output, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(path.join(root, 'POS', file), destination);
}
validate(output);
console.log('Reader assets: read-only.html, js/sync/read-only.js (2 files, no credentials)');
