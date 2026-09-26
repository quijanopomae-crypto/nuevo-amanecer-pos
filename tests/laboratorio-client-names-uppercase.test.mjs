import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js=readFileSync('laboratorio/pos-lab/lab-overrides.js','utf8');
const css=readFileSync('laboratorio/pos-lab/styles/pages/clientes.css','utf8');

test('client list names are uppercased visually without mutating stored data',()=>{
  assert.match(css,/#pageClientes #cliList \.c-name\{\s*text-transform:uppercase/);
  assert.doesNotMatch(js,/client\.nombre\s*=\s*.*toUpperCase/);
  assert.doesNotMatch(js,/c\.nombre\s*=\s*.*toUpperCase/);
});

test('financial client name uses a dedicated uppercase display helper',()=>{
  const start=js.indexOf('function labClientDisplayName');
  assert.notEqual(start,-1);
  const block=js.slice(start,js.indexOf('}',start)+1);
  assert.match(block,/String\(client && client\.nombre \|\| 'Cliente'\)\.toUpperCase\(\)/);
  assert.match(js,/labEsc\(labClientDisplayName\(client\)\)/);
});

test('client-name breadcrumbs are uppercase without affecting category breadcrumbs',()=>{
  const matches=js.match(/labBackButton\(labClientDisplayName\(client\)\)/g)||[];
  assert.ok(matches.length>=4);
  assert.match(js,/labBackButton\(LAB_SMALL_ACCOUNT_NAME\)/);
  assert.match(js,/labBackButton\(account\.categoryName\)/);
});

test('search and sorting continue to use original client names',()=>{
  assert.doesNotMatch(js,/clientes\.map\([^)]*toUpperCase/);
  assert.doesNotMatch(js,/sort\([^)]*toUpperCase/);
});
