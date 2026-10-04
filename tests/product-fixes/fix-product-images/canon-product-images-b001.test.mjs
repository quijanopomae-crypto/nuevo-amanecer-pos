import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const overlayPath = 'POS/js/catalog/product-image-overlay-b001.js';
const inline13Path = 'POS/js/legacy-inline/inline-13.js';
const inline14Path = 'POS/js/legacy-inline/inline-14.js';
const indexPath = 'POS/index.html';
const serviceWorkerPath = 'POS/sw.js';

const expected = {
  'TRULULU AROS 90GR': 'https://trululustore.wordpress.com/wp-content/uploads/2022/11/trululu-aros-1.jpg?w=1024',
  'TRULULU FRESITAS 90GR': 'https://trululustore.wordpress.com/wp-content/uploads/2022/11/trululu-fresa-1.jpg?w=1024',
  'TRULULU ORO 90GR': 'https://trululustore.wordpress.com/wp-content/uploads/2022/11/trululu-oro-12b-x-90g-v3.jpg?w=1024',
  'TRULULU SABORES 90GR': 'https://trululustore.wordpress.com/wp-content/uploads/2022/11/trululu-sabores-12b-x-90g-v20.jpg?w=1024',
  'TRULULU DINOS 90GR': 'https://firebasestorage.stagebeta.kyte.site/v0/b/kyte-7c484.appspot.com/o/8x5kblSeRMWUzzF9K1Awa7foUQw1%2Fthumb_280_3406a3c4-734c-4b9f-a22e-b1301cbaae69.jpg?alt=media',
  'GOMITAS TRULULU SABORES 90 GR': 'https://aceleralastatic.nyc3.cdn.digitaloceanspaces.com/files/uploads/1499/1671033109-35-trululu-sabores-90g-jpg.jpg',
  'GOMAS TRULULU DINOSS 90G*': 'https://firebasestorage.stagebeta.kyte.site/v0/b/kyte-7c484.appspot.com/o/8x5kblSeRMWUzzF9K1Awa7foUQw1%2Fthumb_280_3406a3c4-734c-4b9f-a22e-b1301cbaae69.jpg?alt=media',
  'TRULULU CASQUITOS VITAMINA C 90GR': 'https://firebasestorage.stagebeta.kyte.site/v0/b/kyte-7c484.appspot.com/o/8x5kblSeRMWUzzF9K1Awa7foUQw1%2Fthumb_280_b4aeab63-4486-49c3-93e3-eabf5e3e67dd.jpg?alt=media',
  'TRULULU PINGUINOS 80GR': 'https://domun.co/default/image-tool-lambda?new-height=700&new-quality=80&new-width=700&url-image=https%3A%2F%2Fsumerlabs.com%2Fsumer-app-90b8f.appspot.com%2Fproduct_photos%252Ffd0aa6876516aef8f062203b07b2e439%252Fe003f880-ff3c-11ec-9263-67049881eeef%3Falt%3Dmedia%26token%3D9cbe4add-c612-4f9b-b3b0-899148471547',
  'TRULULU SNACKS OSOS ORO 80G': 'https://caest-imagenes.s3.us-east-2.amazonaws.com/products/local/1040784_1_z.webp'
};

const allowedHosts = new Set([
  'trululustore.wordpress.com',
  'firebasestorage.stagebeta.kyte.site',
  'aceleralastatic.nyc3.cdn.digitaloceanspaces.com',
  'domun.co',
  'caest-imagenes.s3.us-east-2.amazonaws.com'
]);

function loadOverlay() {
  assert.ok(existsSync(overlayPath), 'falta el overlay CANON del lote 001');
  const source = readFileSync(overlayPath, 'utf8');
  const context = { window: {} };
  runInNewContext(source, context, { filename: overlayPath });
  return JSON.parse(JSON.stringify(context.window.NuevoAmanecerProductImageOverlay));
}

test('batch 001 contiene exactamente los 10 productos y URLs aprobadas', () => {
  const overlay = loadOverlay();
  assert.deepEqual(overlay, expected);
  assert.equal(new Set(Object.keys(overlay)).size, 10);
  for (const [name, source] of Object.entries(overlay)) {
    assert.ok(name.length > 0);
    const url = new URL(source);
    assert.equal(url.protocol, 'https:');
    assert.ok(allowedHosts.has(url.hostname), `host no autorizado: ${url.hostname}`);
    assert.doesNotMatch(source, /^http:|javascript:|data:/i);
  }
});

test('resolver CANON prioriza imagen propia válida y limita overlay a HTTPS allowlist', () => {
  const inline13 = readFileSync(inline13Path, 'utf8');
  assert.match(inline13, /function\s+_naProductImageSource\s*\(/);
  assert.match(inline13, /NuevoAmanecerProductImageOverlay/);
  assert.match(inline13, /_naSafeProductImageSource\(product\?\.imagen\)/);
  assert.match(inline13, /new\s+URL\(/);
  for (const host of allowedHosts) assert.ok(inline13.includes(host), `resolver no autoriza explícitamente ${host}`);
  assert.match(inline13, /data:image\\\/(?:png|jpeg|webp|gif)/);
});

test('tarjetas y carrito usan un único resolver y degradan a icono si la URL falla', () => {
  const inline14 = readFileSync(inline14Path, 'utf8');
  assert.match(inline14, /_naProductImageSource\(product\)/);
  assert.match(inline14, /_naProductImageSource\(item\)/);
  assert.doesNotMatch(inline14, /_naSafeProductImageSource\(product\.imagen\)/);
  assert.doesNotMatch(inline14, /_naSafeProductImageSource\(item\.imagen\)/);
  assert.match(inline14, /addEventListener\(['"]error['"]/);
});

test('shell carga y precachea el overlay antes del resolver sin precachear hosts externos', () => {
  const html = readFileSync(indexPath, 'utf8');
  const sw = readFileSync(serviceWorkerPath, 'utf8');
  const overlayScript = 'js/catalog/product-image-overlay-b001.js';
  const inline13Script = 'js/legacy-inline/inline-13.js';
  const overlayPosition = html.indexOf(overlayScript);
  const resolverPosition = html.indexOf(inline13Script);
  assert.ok(overlayPosition >= 0, 'index.html no carga el overlay del lote 001');
  assert.ok(resolverPosition >= 0 && overlayPosition < resolverPosition, 'el overlay debe cargar antes de inline-13.js');
  assert.ok(sw.includes(`./${overlayScript}`), 'service worker no precachea el JS del overlay');
  for (const host of allowedHosts) assert.ok(!sw.includes(host), `service worker no debe precachear URL externa ${host}`);
});
