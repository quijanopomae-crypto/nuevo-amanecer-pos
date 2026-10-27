import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChanges } from '../../tools/ci/change-impact.mjs';

test('solo CSS o capturas y documentacion ordinaria reducen la suite', () => {
  assert.equal(classifyChanges(['POS/css/work.css']), 'visual');
  assert.equal(classifyChanges(['docs/reviews/a.png','POS/css/base.css']), 'visual');
});
test('cambios de negocio, permisos y pipelines son siempre criticos', () => {
  for (const p of ['POS/js/sync/outbox.js','POS/js/config/pos-permissions.js','POS/js/modules/ventas-stock.js','POS/js/inventory/stock-lots.js','tools/cloudflare-lab/src/worker.js','infra/database/migrations/999.sql','.github/workflows/e2e-smoke-ci.yml','tools/release/web-release.mjs','tools/ci/change-impact.mjs']) {
    assert.equal(classifyChanges(['POS/css/base.css',p]), 'critical', p);
  }
});
test('WORK aislado tiene pruebas específicas, nunca se confunde con CSS', () => {
  for (const p of ['POS/work/index.html','POS/work/work-canon-bridge.js','POS/js/work-host.js','tests/e2e/work-default.spec.ts']) {
    assert.equal(classifyChanges([p]), 'work-ui', p);
    assert.equal(classifyChanges(['POS/css/base.css',p]), 'work-ui', p);
  }
  assert.equal(classifyChanges(['POS/index.html']), 'critical');
  assert.equal(classifyChanges(['POS/js/sync/outbox.js','POS/work/index.html']), 'critical');
  assert.equal(classifyChanges(['POS/work/new-tool.js']), 'critical');
  assert.equal(classifyChanges(['POS/js/unknown-business.js']), 'critical');
});
test('sin diff o rutas sospechosas: seguridad por defecto', () => {
  assert.equal(classifyChanges([]), 'critical');
  assert.equal(classifyChanges(['../POS/css/base.css']), 'critical');
  assert.equal(classifyChanges(['\\secret']), 'critical');
});
