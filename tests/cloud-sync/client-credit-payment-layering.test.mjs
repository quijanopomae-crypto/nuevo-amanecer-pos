import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync('POS/css/client-credit-accounts-v2.css','utf8');

function z(selector){
  const esc=selector.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
  const m=css.match(new RegExp(esc+'\\s*\\{[^}]*z-index\\s*:\\s*(\\d+)','s'));
  return m?Number(m[1]):null;
}

test('payment modal is stacked above the financial client workspace',()=>{
  const workspace=z('#pageClientes .na-client-account-screen');
  const payment=z('#mPagoCred');
  assert.equal(workspace,1200);
  assert.ok(Number.isFinite(payment),'#mPagoCred must declare an explicit z-index');
  assert.ok(payment>workspace,'payment modal must be above client workspace');
  assert.ok(payment<9999,'payment modal must remain below the master security screen');
});
