import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChanges } from '../../tools/ci/change-impact.mjs';

test('solo CSS o capturas y documentacion ordinaria reducen la suite', () => {
  assert.equal(classifyChanges(['POS/css/work.css']), 'visual');
  assert.equal(classifyChanges(['docs/reviews/a.png','POS/css/base.css']), 'visual');
});
test('cambios de negocio, permisos y pipelines son siempre criticos', () => {
  for (const p of ['POS/js/sync/outbox.js','POS/js/config/pos-permissions.js','POS/js/modules/ventas-stock.js','POS/js/inventory/stock-lots.js','tools/cloudflare-lab/src/worker.js','infra/database/migrations/999.sql','.github/workflows/e2e-smoke-ci.yml','tools/release/web-release.mjs']) {
    assert.equal(classifyChanges(['POS/css/base.css',p]), 'critical', p);
  }
});
test('cambios funcionales de UI y pruebas no pueden presentarse como visuales', () => {
  assert.equal(classifyChanges(['POS/index.html']), 'standard');
  assert.equal(classifyChanges(['POS/work/index.html']), 'standard');
  assert.equal(classifyChanges(['tests/e2e/work-default.spec.ts']), 'standard');
});
test('sin diff o rutas sospechosas: seguridad por defecto', () => {
  assert.equal(classifyChanges([]), 'critical');
  assert.equal(classifyChanges(['../POS/css/base.css']), 'critical');
  assert.equal(classifyChanges(['\\secret']), 'critical');
});
