import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client=readFileSync('POS/js/modules/client-credit-accounts-v2.js','utf8');

test('Clientes V2 actively binds pageClientes to NA_MOTION page controller',()=>{
  assert.match(client,/function naBindClientMotion\(\)/);
  assert.match(client,/motion\.page\.bind\('pageClientes', \{ enterClass:'na-enter-fade' \}\)/);
  assert.match(client,/page\.classList\.add\('na-motion'\)/);
  assert.match(client,/naBindClientMotion\(\);/);
});

test('Clientes V2 registers an inspectable Motion consumer',()=>{
  assert.match(client,/registerController\('clientes-v2'/);
  assert.match(client,/workspaceState:screen \? naClientGetMotionState\(screen\) : 'closed'/);
  assert.match(client,/reducedMotion:naClientReducedMotion\(\)/);
});

test('internal client subview transitions complete from transitionend with timeout only as fallback',()=>{
  assert.match(client,/function naClientWatchTransition/);
  assert.match(client,/core\.whenTransitionEnds/);
  assert.match(client,/naClientWatchTransition\(current, 'transform', duration \+ 90/);
  assert.match(client,/naClientWatchTransition\(incoming, 'transform', duration \+ 90/);
  assert.match(client,/naClientSetMotionState\(content, 'closing'\)/);
  assert.match(client,/naClientSetMotionState\(content, 'opening'\)/);
  assert.match(client,/naClientSetMotionState\(content, 'open'\)/);
});

test('Clientes V2 does not register a second scroll controller',()=>{
  assert.doesNotMatch(client,/motion\.scroll\.register/);
  assert.doesNotMatch(client,/NA_MOTION\.scroll\.register/);
});

test('financial and persistence functions are not moved into Motion activation',()=>{
  const start=client.indexOf('function naBindClientMotion');
  const end=client.indexOf('function naBindRuntime',start);
  const block=client.slice(start,end);
  assert.doesNotMatch(block,/saveAllData|_naFinalizeOperationPersistence|abrirCobro|selPM|fetch\(|localStorage|sessionStorage|indexedDB/i);
});
