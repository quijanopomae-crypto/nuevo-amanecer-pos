// Publish only the explicitly listed reader and PWA shell assets.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, 'tools/cloudflare-lab/.reader-assets');
const readerFiles = ['read-only.html', 'js/sync/read-only.js'];
const posFiles = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/responsive.css',
  'css/print.css',
  'js/core/utils.js',
  'js/sync/outbox.js',
  'js/sync/canonical-client.js',
  'js/sync/canonical-sale-intent.js',
  'js/sync/canonical-sale-outbox.js',
  'js/sync/canonical-sale-projection.js',
  'js/sync/canonical-sale-integration.js',
  'js/sync/canonical-sale-view.js',
  'js/legacy-inline/inline-01.js',
  'js/modules/ticket/legacy.js',
  'js/legacy-inline/inline-02.js',
  'js/modules/ticket/overrides.js',
  'js/legacy-inline/inline-03.js',
  'js/core/state.js',
  'js/legacy-inline/inline-04.js',
  'js/legacy-inline/inline-05.js',
  'js/legacy-inline/inline-06.js',
  'js/legacy-inline/inline-07.js',
  'js/modules/ticket/zones.js',
  'js/legacy-inline/inline-08.js',
  'js/legacy-inline/inline-09.js',
  'js/legacy-inline/inline-10.js',
  'js/legacy-inline/inline-11.js',
  'js/legacy-inline/inline-12.js',
  'js/legacy-inline/inline-13.js',
  'js/modules/ticket/secure-print.js',
  'js/legacy-inline/inline-14.js',
  'js/legacy-inline/inline-15.js',
  'js/legacy-inline/inline-16.js',
  'js/legacy-inline/inline-17.js',
  'js/legacy-inline/inline-18.js',
  'js/compat/legacy-globals.js',
  'js/app.js',
  'js/ocr/vendor/tesseract-6.0.1/tesseract.min.js',
  'js/catalog/reference-catalog-data.js',
  'js/catalog/reference-catalog.js',
  'js/ocr/ocr-extract.js',
  'js/ocr/ocr-parse.js',
  'js/ocr/ocr-reference-matcher.js',
  'js/ocr/ocr-purchase-engine.js',
  'js/ocr/ocr-purchase-review.js',
  'js/ocr/ocr-purchase-apply.js',
  'js/ocr/ocr-purchase-integration.js',
  'js/ocr/vendor/tesseract-6.0.1/worker.min.js',
  'js/ocr/vendor/tesseract-6.0.1/tesseract-core-simd-lstm.wasm.js',
  'js/ocr/vendor/tesseract-6.0.1/lang/spa.traineddata.gz'
];
const files = [...readerFiles, ...posFiles.map((file) => `POS/${file}`)];
const allowed = new Set(files);
for (const file of files) {
  let parent = path.posix.dirname(file);
  while (parent !== '.') {
    allowed.add(parent);
    parent = path.posix.dirname(parent);
  }
}
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
  const source = file.startsWith('POS/')
    ? path.join(root, file)
    : path.join(root, 'POS', file);
  copyFileSync(source, destination);
}
const buildHash = createHash('sha256');
for (const file of files) {
  const source = file.startsWith('POS/')
    ? path.join(root, file)
    : path.join(root, 'POS', file);
  buildHash.update(file);
  buildHash.update(readFileSync(source));
}
const serviceWorker = path.join(output, 'POS/sw.js');
const serviceWorkerSource = readFileSync(serviceWorker, 'utf8');
if (!serviceWorkerSource.includes('__BUILD_HASH__')) throw new Error('Missing service worker build hash placeholder');
writeFileSync(serviceWorker, serviceWorkerSource.replace('__BUILD_HASH__', buildHash.digest('hex').slice(0, 16)));
validate(output);
console.log(`Published ${files.length} allowlisted reader/PWA assets (no credentials)`);
