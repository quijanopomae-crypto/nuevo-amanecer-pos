import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_BATCH_ITEMS,
  applyPreparedEntries,
  isSafeProductDataImage,
  runBatchFromManifest,
  validateManifest
} from '../laboratorio/pos-lab/js/product-image-batch.js';

const SAFE_IMAGE = 'data:image/jpeg;base64,AAAA';

function makeManifest(overrides = {}) {
  const entries = Array.from({ length: MAX_BATCH_ITEMS }, (_, index) => ({
    id: `p-${index}`,
    product_name: `P${index}`,
    expected_presentation: '90 g',
    action: 'apply',
    confidence: 'high',
    source_page: 'https://example.test/source',
    image_url: `https://example.test/image-${index}.jpg`
  }));
  return {
    schema: 'nuevo-amanecer.lab-product-image-batch/v1',
    batch_id: 'test',
    max_items: MAX_BATCH_ITEMS,
    entries,
    ...overrides
  };
}

test('manifest exige exactamente 10 candidatos', () => {
  assert.equal(validateManifest(makeManifest()).entries.length, 10);
  assert.throws(
    () => validateManifest(makeManifest({ entries: makeManifest().entries.slice(0, 9) })),
    /exactamente 10/
  );
});

test('data URL segura respeta raster y límite', () => {
  assert.equal(isSafeProductDataImage(SAFE_IMAGE), true);
  assert.equal(isSafeProductDataImage('https://example.test/a.jpg'), false);
  assert.equal(isSafeProductDataImage('data:image/svg+xml;base64,AAAA'), false);
});

test('coincidencia exacta única cambia solo imagen', () => {
  const products = Array.from({ length: 10 }, (_, index) => ({
    nombre: `P${index}`,
    stock: index + 1,
    precio: 2.5 + index,
    categoria: 'TEST'
  }));
  const before = structuredClone(products);
  const prepared = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`p-${index}`, SAFE_IMAGE]));
  const result = applyPreparedEntries(products, makeManifest(), prepared);

  assert.equal(result.applied.length, 10);
  for (let index = 0; index < products.length; index += 1) {
    assert.equal(products[index].imagen, SAFE_IMAGE);
    const { imagen: _afterImage, ...afterRest } = products[index];
    const { imagen: _beforeImage, ...beforeRest } = before[index];
    assert.deepEqual(afterRest, beforeRest);
  }
});

test('producto inexistente o nombre duplicado queda SKIP sin escritura', () => {
  const manifest = makeManifest();
  const products = [
    { nombre: 'P0', stock: 4 },
    { nombre: 'P0', stock: 9 },
    { nombre: 'OTRO', stock: 1 }
  ];
  const before = structuredClone(products);
  const result = applyPreparedEntries(products, manifest, { 'p-0': SAFE_IMAGE, 'p-1': SAFE_IMAGE });

  assert.equal(result.applied.length, 0);
  assert.ok(result.skipped.some(item => item.reason === 'PRODUCT_NAME_AMBIGUOUS'));
  assert.ok(result.skipped.some(item => item.reason === 'PRODUCT_NOT_FOUND_EXACT'));
  assert.deepEqual(products, before);
});

test('entrada declarada SKIP no requiere imagen ni modifica producto', () => {
  const manifest = makeManifest();
  manifest.entries[0] = {
    id: 'blocked-0',
    product_name: 'P0',
    expected_presentation: '80 g',
    action: 'skip',
    confidence: 'blocked',
    reason: 'Gramaje no verificado.'
  };
  const products = [{ nombre: 'P0', stock: 7 }];
  const before = structuredClone(products);
  const result = applyPreparedEntries(products, manifest, {});

  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped[0].reason, 'Gramaje no verificado.');
  assert.deepEqual(products, before);
});

test('imagen insegura no modifica el producto', () => {
  const products = [{ nombre: 'P0', stock: 8 }];
  const result = applyPreparedEntries(products, makeManifest(), { 'p-0': 'https://unsafe.test/a.jpg' });
  assert.equal(result.applied.length, 0);
  assert.equal(products[0].imagen, undefined);
});

test('fallo al persistir revierte todas las imágenes aplicadas', async () => {
  const manifest = makeManifest();
  const products = [{ nombre: 'P0', stock: 3, imagen: 'data:image/jpeg;base64,BBBB' }];
  const originalImage = products[0].imagen;
  const fetchFn = async url => {
    if (String(url).includes('manifest')) {
      return { ok: true, json: async () => manifest };
    }
    return { ok: true, blob: async () => ({ type: 'image/jpeg', size: 4 }) };
  };

  await assert.rejects(
    runBatchFromManifest({
      products,
      manifestUrl: 'https://lab.test/manifest.json',
      fetchFn,
      optimize: async () => SAFE_IMAGE,
      save: async () => { throw new Error('SAVE_FAILED'); }
    }),
    /SAVE_FAILED/
  );
  assert.equal(products[0].imagen, originalImage);
});
