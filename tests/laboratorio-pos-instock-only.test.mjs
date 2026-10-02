import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const contract = JSON.parse(readFileSync('laboratorio/pos-lab/tasks/LAB-POS-INSTOCK-ONLY-001.json', 'utf8'));

function extractVisibleStockPredicate() {
  const start = source.indexOf('function labPosProductHasVisibleStock');
  const endMarker = '\n\n  if (labOriginalPosRender';
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, 'stock visibility predicate must exist');
  assert.ok(end > start, 'stock visibility predicate must be bounded before render hook');
  return source.slice(start, end);
}

test('POS-LAB visibility keeps positive controlled stock and hides zero/negative controlled stock', () => {
  const sandbox = {
    _naTracksStock(product) {
      return product.tracksStock !== false;
    },
    _naNumber(value) {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }
  };

  vm.runInNewContext(extractVisibleStockPredicate(), sandbox);

  assert.equal(sandbox.labPosProductHasVisibleStock({ stock: 4, tracksStock: true }), true);
  assert.equal(sandbox.labPosProductHasVisibleStock({ stock: 0, tracksStock: true }), false);
  assert.equal(sandbox.labPosProductHasVisibleStock({ stock: -3, tracksStock: true }), false);
  assert.equal(sandbox.labPosProductHasVisibleStock({ stock: 0, tracksStock: false }), true);
});

test('POS-LAB render filter is temporary and preserves authoritative inventory state', () => {
  assert.match(source, /var originalProducts = productos;/);
  assert.match(source, /productos = originalProducts\.filter\(labPosProductHasVisibleStock\);/);
  assert.match(source, /finally \{\s*productos = originalProducts;\s*\}/s);
  assert.match(source, /posRender\.__naLabInStockOnly = true;/);
});

test('task remains LAB-only and forbids CANON writes', () => {
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
  assert.ok(contract.allowed_files.includes('laboratorio/pos-lab/lab-overrides.js'));
});
