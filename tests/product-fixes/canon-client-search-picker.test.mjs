import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inline02 = readFileSync(new URL('../../POS/js/legacy-inline/inline-02.js', import.meta.url), 'utf8');
const inline04 = readFileSync(new URL('../../POS/js/legacy-inline/inline-04.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../POS/css/base.css', import.meta.url), 'utf8');

test('payment client selectors are replaced by one searchable picker without changing selector ids', () => {
  assert.match(inline02, /function _naInstallClientPickers\(\)/);
  assert.match(inline02, /\['mVentaCliente','mCreditoCliente'\]/);
  assert.match(inline02, /select\.classList\.add\('na-client-picker-native'\)/);
  assert.match(inline02, /button\.addEventListener\('click',\(\)=>_naOpenClientPicker\(selectId\)\)/);
  assert.match(inline02, /input\.type='search'/);
  assert.match(inline02, /Buscar por nombre o DNI/);
});

test('search filters the currently rendered option text and preserves credit-line detail', () => {
  assert.match(inline02, /Array\.from\(select\.options\|\|\[\]\)/);
  assert.match(inline02, /_naClientPickerNormalize\(option\.textContent\)\.includes\(needle\)/);
  assert.match(inline04, /note=e\.eligible\?\` · disponible \$\{fmt\(e\.available\)\}\`:' · sin línea disponible'/);
  assert.match(inline04, /_naInstallClientPickers\(\);_naSyncClientPickerButtons\(\);/);
});

test('choosing a search result writes the existing select and emits the normal change event', () => {
  assert.match(inline02, /select\.value=String\(value\?\?''\)/);
  assert.match(inline02, /select\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);
  assert.match(inline02, /_naSyncClientPickerButton\(select\.id\)/);
});

test('picker is mobile-friendly and keeps the native select out of the visual flow', () => {
  assert.match(css, /\.na-client-picker-native\{position:absolute!important/);
  assert.match(css, /\.na-client-picker-trigger\{/);
  assert.match(css, /\.na-client-picker-search\{/);
  assert.match(css, /\.na-client-picker-list\{/);
  assert.match(css, /@media\(max-width:520px\)\{[\s\S]*\.na-client-picker-overlay\{padding:0;align-items:flex-end\}/);
});
