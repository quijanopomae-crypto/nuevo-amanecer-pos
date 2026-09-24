import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const inline02 = read('../../POS/js/legacy-inline/inline-02.js');
const inline03 = read('../../POS/js/legacy-inline/inline-03.js');
const inline12 = read('../../POS/js/legacy-inline/inline-12.js');
const index = read('../../POS/index.html');

test('canonical client renderer keeps fail-closed retry and advanced renderer', () => {
  assert.equal((inline12.match(/\bcliRender\s*=/g) || []).length, 0,
    'inline-12 must not replace the canonical cliRender wrapper');
  const scriptPaths = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/gi)]
    .map((match) => match[1]);
  const canonicalWrapperIndex = scriptPaths.indexOf('js/legacy-inline/inline-03.js');
  assert.notEqual(canonicalWrapperIndex, -1, 'index loads the canonical wrapper');
  for (const scriptPath of scriptPaths.slice(canonicalWrapperIndex + 1)) {
    const source = read(`../../POS/${scriptPath}`);
    assert.doesNotMatch(source, /\bcliRender\s*=/,
      `${scriptPath} must not override cliRender after inline-03`);
  }
  assert.match(inline12, /_baseCliRender\s*=\s*function\s*\(/,
    'inline-12 installs its advanced renderer as the dynamic base renderer');
  assert.match(inline12, /cliSearch/);
  assert.match(inline12, /cliSort/);
  assert.match(inline12, /_naSecClientCard/);
  assert.match(inline12, /Cr.*ditos activos/);
  assert.match(inline12, /Historial de cr.*ditos/);
  assert.doesNotMatch(inline12, /_naNormalizeCreditRecord|_naCreditCollectionsNetForDate|updateDashboard\s*\(/,
    'normalization, collection totals, and dashboard updates belong to inline-02');

  assert.match(inline03, /textContent='Reintentar conexión'/,
    'canonical errors render a connection retry action');
  assert.match(inline03, /_naLocalCliRender\(\)/,
    'canonical success delegates through inline-02');
  assert.match(inline02, /_baseCliRender\(\);updateDashboard\(\)/,
    'inline-02 dynamically calls the final base renderer before updating dashboard');
});
