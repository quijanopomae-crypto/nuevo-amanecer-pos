import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync('laboratorio/pos-lab/styles/pages/clientes.css','utf8');
const reference=css.slice(css.lastIndexOf('REFERENCE MATCH 004'));

test('client financial hero removes the center divider in base layout',()=>{
  const start=reference.indexOf('#pageClientes .lab-v2-head-money{');
  assert.notEqual(start,-1);
  const block=reference.slice(start,reference.indexOf('}',start)+1);
  assert.match(block,/padding-left:0/);
  assert.match(block,/border-left:0/);
  assert.doesNotMatch(block,/border-left:1px/);
});

test('mobile hero keeps the divider removed at 430px and 360px',()=>{
  const mobile=reference.slice(reference.indexOf('@media(max-width:430px)'));
  assert.match(mobile,/#pageClientes \.lab-v2-head-money\{[\s\S]*padding:0;[\s\S]*border-left:0/);
  assert.match(mobile,/@media\(max-width:360px\)[\s\S]*#pageClientes \.lab-v2-head-money\{[\s\S]*padding-left:0/);
  assert.doesNotMatch(mobile,/border-left:1px solid rgba\(15,118,110,\.24\)/);
});

test('hero still uses spacing between identity and debt blocks',()=>{
  assert.match(reference,/#pageClientes \.lab-v2-client-head\{[\s\S]*padding:22px 22px 20px/);
  assert.match(reference,/@media\(max-width:430px\)[\s\S]*gap:12px/);
});
