// static-structure.test.mjs — structural tripwires for the authorized baseline
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureBaselineFixture, readFixtureText } from './lib/extract-baseline.mjs';
import { analyzeAll } from './lib/static-parse.mjs';
import { canonicalJson } from './lib/fingerprint.mjs';

const SHEETJS_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
const GOOGLE_FONTS_NUNITO = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';

const CRITICAL_IDS = [
  'pageMenu', 'pagePOS', 'pageInventario', 'pageClientes', 'pageCaja', 'pageVentas',
  'pageGastos', 'pageConfig', 'posSearch', 'cartDrawer', 'mCobro', 'mProd', 'mMovInv',
  'mCli', 'mCred', 'mPagoCred', 'mApertura', 'mMovCaja', 'mCierre', 'mTicket', 'mPrinter', 'mGasto',
];

let _cached = null;
function analyzed() {
  if (!_cached) {
    ensureBaselineFixture();
    _cached = analyzeAll(readFixtureText());
  }
  return _cached;
}

test('script tags: 18 inline + 1 external CDN (defer), total 19', () => {
  const a = analyzed();
  const inline = a.scripts.filter((s) => s.src == null);
  const external = a.scripts.filter((s) => s.src != null);
  assert.equal(a.scripts.length, 19, 'total script tags must be 19');
  assert.equal(inline.length, 18, 'inline scripts must be 18');
  assert.equal(external.length, 1, 'external scripts must be 1');
  assert.equal(external[0].src, SHEETJS_CDN);
  assert.equal(external[0].defer, true, 'SheetJS script must be defer');
  assert.equal(external[0].startLine, 9, 'SheetJS CDN must be at line 9');
});

test('style blocks: exactly 8 real DOM style blocks', () => {
  const a = analyzed();
  assert.equal(a.styles.length, 8, 'real style blocks must be 8');
});

test('no type=module scripts and no <form> elements', () => {
  const a = analyzed();
  assert.equal(a.typeModuleCount, 0, 'must be 0 type=module scripts');
  assert.equal(a.formsCount, 0, 'must be 0 <form> elements');
});

test('external dependencies are only SheetJS CDN + Google Fonts Nunito', () => {
  const a = analyzed();
  const scriptUrls = a.deps.scripts.map((s) => s.src);
  const linkUrls = a.deps.links.map((l) => l.href);
  assert.deepEqual(scriptUrls, [SHEETJS_CDN]);
  assert.deepEqual(linkUrls, [GOOGLE_FONTS_NUNITO]);
});

test('no fetch() or XMLHttpRequest in source', () => {
  const src = readFixtureText();
  assert.equal(/\bfetch\s*\(/.test(src), false, 'no fetch(');
  assert.equal(/XMLHttpRequest/.test(src), false, 'no XMLHttpRequest');
});

test('critical static DOM ids are all present', () => {
  const a = analyzed();
  const ids = new Set(a.domIds.staticIds);
  for (const id of CRITICAL_IDS) {
    assert.ok(ids.has(id), `missing critical id: ${id}`);
  }
});

test('parser is deterministic: two runs produce identical canonical output', () => {
  ensureBaselineFixture();
  const src = readFixtureText();
  const first = canonicalJson(analyzeAll(src));
  const second = canonicalJson(analyzeAll(src));
  assert.equal(second, first, 'analyzeAll must be deterministic');
});
