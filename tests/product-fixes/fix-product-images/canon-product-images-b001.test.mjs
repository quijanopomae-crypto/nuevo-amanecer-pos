import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const overlayPath = 'POS/js/catalog/product-image-overlay-b001.js';
const inline13Path = 'POS/js/legacy-inline/inline-13.js';
const inline14Path = 'POS/js/legacy-inline/inline-14.js';

const expected = {
  'TRULULU AROS 90GR': './assets/product-images/b001/trululu-aros-90.webp',
  'TRULULU FRESITAS 90GR': './assets/product-images/b001/trululu-fresitas-90.webp',
  'TRULULU ORO 90GR': './assets/product-images/b001/trululu-oro-90.webp',
  'TRULULU SABORES 90GR': './assets/product-images/b001/trululu-sabores-90.webp',
  'TRULULU DINOS 90GR': './assets/product-images/b001/trululu-dinos-90.webp',
  'GOMITAS TRULULU SABORES 90 GR': './assets/product-images/b001/gomitas-trululu-sabores-90.webp',
  'GOMAS TRULULU DINOSS 90G*': './assets/product-images/b001/gomas-trululu-dinoss-90.webp',
  'TRULULU CASQUITOS VITAMINA C 90GR': './assets/product-images/b001/trululu-casquitos-vitamina-c-90.webp',
  'TRULULU PINGUINOS 80GR': './assets/product-images/b001/trululu-pinguinos-80.webp',
  'TRULULU SNACKS OSOS ORO 80G': './assets/product-images/b001/trululu-osos-oro-80.webp'
};

function loadOverlay() {
  assert.ok(existsSync(overlayPath), 'falta el overlay CANON del lote 001');
  const source = readFileSync(overlayPath, 'utf8');
  const context = { window: {} };
  runInNewContext(source, context, { filename: overlayPath });
  return JSON.parse(JSON.stringify(context.window.NuevoAmanecerProductImageOverlay));
}

test('batch 001 contiene exactamente los 10 productos aprobados y solo assets locales', () => {
  const overlay = loadOverlay();
  assert.deepEqual(overlay, expected);
  assert.equal(new Set(Object.keys(overlay)).size, 10);
  for (const [name, path] of Object.entries(overlay)) {
    assert.ok(name.length > 0);
    assert.match(path, /^\.\/assets\/product-images\/b001\/[a-z0-9-]+\.webp$/);
    assert.doesNotMatch(path, /https?:|javascript:|data:/i);
  }
});

test('cada entrada del overlay tiene un WebP versionado', () => {
  const overlay = loadOverlay();
  for (const path of Object.values(overlay)) {
    const diskPath = `POS/${path.replace(/^\.\//, '')}`;
    assert.ok(existsSync(diskPath), `falta asset ${diskPath}`);
    const bytes = readFileSync(diskPath);
    assert.ok(bytes.length > 100, `${diskPath} está vacío o corrupto`);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
  }
});

test('resolver CANON prioriza imagen propia válida y limita overlay a rutas locales', () => {
  const inline13 = readFileSync(inline13Path, 'utf8');
  assert.match(inline13, /function\s+_naProductImageSource\s*\(/);
  assert.match(inline13, /NuevoAmanecerProductImageOverlay/);
  assert.match(inline13, /assets\\\/product-images/);
  assert.match(inline13, /data:image\\\/(?:png|jpeg|webp|gif)/);
});

test('tarjetas y carrito usan un único resolver de imagen', () => {
  const inline14 = readFileSync(inline14Path, 'utf8');
  assert.match(inline14, /_naProductImageSource\(product\)/);
  assert.match(inline14, /_naProductImageSource\(item\)/);
  assert.doesNotMatch(inline14, /_naSafeProductImageSource\(product\.imagen\)/);
  assert.doesNotMatch(inline14, /_naSafeProductImageSource\(item\.imagen\)/);
});
