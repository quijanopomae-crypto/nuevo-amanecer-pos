// A3 fase 0: la recarga por versión nueva no debe cortar un «Confirmar todo» en curso (tokens ya gastados).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const host = readFileSync(new URL('../../POS/js/work-host.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../../POS/index.html', import.meta.url), 'utf8');

test('WORK expone NAWorkBusy ligado a working/batchRunning', () => {
  assert.match(host, /root\.NAWorkBusy\s*=\s*function\s*\(\)\s*\{\s*return !!\(working \|\| batchRunning\);/);
});
test('moneyOpInProgress consulta NAWorkBusy sin quitar los chequeos de dinero existentes', () => {
  const m = /function moneyOpInProgress\(\) \{([\s\S]*?)\n    \}/.exec(index);
  assert.ok(m, 'moneyOpInProgress existe');
  for (const k of ['posProc', 'cart', 'NuevoAmanecerCanonicalSaleOutbox', 'NuevoAmanecerCanonicalCashBridge', 'NuevoAmanecerCanonicalCreditPaymentBridge', 'NAPurchaseBusy', 'NAOcrBusy', 'NAWorkBusy']) assert.ok(m[1].includes(k), k);
});
test('NAWorkBusy se declara después de working/batchRunning', () => {
  assert.ok(host.indexOf('var working = false, batchRunning = false') < host.indexOf('root.NAWorkBusy'));
});
