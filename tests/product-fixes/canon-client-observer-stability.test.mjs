import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync('POS/js/modules/client-credit-accounts-v2.js','utf8');

function between(start,end){
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,'missing '+start);
  assert.ok(b>a,'missing '+end);
  return source.slice(a,b);
}

test('client uppercase normalization is mutation-idempotent',()=>{
  const block=between('function naUppercaseClientCards()','function naEnhanceClientCards()');
  assert.match(block,/var current=String\(node\.textContent\|\|''\)/);
  assert.match(block,/var next=current\.toUpperCase\(\)/);
  assert.match(block,/if\(current!==next\) node\.textContent=next/);
  assert.doesNotMatch(block,/forEach\(function \(node\) \{ node\.textContent=/);
});

test('client MutationObserver coalesces to one pending animation frame',()=>{
  const block=source.slice(source.lastIndexOf("if (typeof MutationObserver === 'function')"));
  assert.match(block,/var naClientEnhanceFrame=0/);
  assert.match(block,/if\(naClientEnhanceFrame\) return/);
  assert.match(block,/naClientEnhanceFrame=requestAnimationFrame/);
  assert.match(block,/naClientEnhanceFrame=0;\s*naEnhanceClientCards\(\)/);
  assert.doesNotMatch(block,/requestAnimationFrame\(naEnhanceClientCards\)/);
});

test('stability fix does not add storage, network or commerce writes',()=>{
  const block=between('function naUppercaseClientCards()','root.addEventListener(\'load\',naBindRuntime)');
  assert.doesNotMatch(block,/fetch\s*\(|localStorage|sessionStorage|indexedDB|createSale\(|createPayment\(|openCash\(|closeCash\(/);
});
