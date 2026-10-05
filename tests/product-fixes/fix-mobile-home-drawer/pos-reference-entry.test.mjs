import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('tests/e2e/pos-reference-fidelity.spec.ts', 'utf8');
const helperStart = source.indexOf('async function enterPos(page: Page)');
const helperEnd = source.indexOf('\n}\n\nasync function prepare', helperStart);
const enterPos = helperStart >= 0 && helperEnd > helperStart
  ? source.slice(helperStart, helperEnd)
  : '';

test('mobile POS entry uses the approved Nueva venta action before the legacy module-card fallback', () => {
  assert.ok(enterPos, 'enterPos helper must exist');
  const quickAction = enterPos.indexOf("getByRole('button', { name: 'Nueva venta', exact: true })");
  const quickClick = enterPos.indexOf('await quickSale.click()');
  const fallback = enterPos.indexOf("page.locator('.module-card').first().click()");

  assert.ok(quickAction >= 0, 'mobile entry must locate the Nueva venta quick action');
  assert.ok(quickClick > quickAction, 'mobile entry must click Nueva venta when visible');
  assert.ok(fallback > quickClick, 'legacy module-card navigation must remain only as a fallback');
});
