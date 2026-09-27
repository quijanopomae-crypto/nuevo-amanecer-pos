import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(path,'utf8');

const promoted = [
  ['laboratorio/pos-lab/styles/tokens.css','POS/css/experience-v2/tokens.css'],
  ['laboratorio/pos-lab/styles/layout.css','POS/css/experience-v2/layout.css'],
  ['laboratorio/pos-lab/styles/responsive.css','POS/css/experience-v2/responsive.css'],
  ['laboratorio/pos-lab/styles/components/buttons.css','POS/css/experience-v2/components/buttons.css'],
  ['laboratorio/pos-lab/styles/components/cards.css','POS/css/experience-v2/components/cards.css'],
  ['laboratorio/pos-lab/styles/components/tables.css','POS/css/experience-v2/components/tables.css'],
  ['laboratorio/pos-lab/styles/components/forms.css','POS/css/experience-v2/components/forms.css'],
  ['laboratorio/pos-lab/styles/components/modals.css','POS/css/experience-v2/components/modals.css'],
  ['laboratorio/pos-lab/styles/components/navigation.css','POS/css/experience-v2/components/navigation.css'],
  ['laboratorio/pos-lab/styles/pages/menu.css','POS/css/experience-v2/pages/menu.css'],
  ['laboratorio/pos-lab/styles/pages/pos.css','POS/css/experience-v2/pages/pos.css'],
  ['laboratorio/pos-lab/styles/pages/inventario.css','POS/css/experience-v2/pages/inventario.css'],
  ['laboratorio/pos-lab/styles/pages/clientes.css','POS/css/experience-v2/pages/clientes.css'],
  ['laboratorio/pos-lab/styles/pages/caja.css','POS/css/experience-v2/pages/caja.css'],
  ['laboratorio/pos-lab/styles/pages/ventas.css','POS/css/experience-v2/pages/ventas.css'],
  ['laboratorio/pos-lab/styles/pages/gastos.css','POS/css/experience-v2/pages/gastos.css'],
  ['laboratorio/pos-lab/styles/pages/configuracion.css','POS/css/experience-v2/pages/configuracion.css'],
  ['laboratorio/pos-lab/animations/motion.css','POS/css/experience-v2/animations/motion.css'],
  ['laboratorio/pos-lab/animations/transitions.css','POS/css/experience-v2/animations/transitions.css'],
  ['laboratorio/pos-lab/animations/menu.css','POS/css/experience-v2/animations/menu.css'],
  ['laboratorio/pos-lab/animations/pos.css','POS/css/experience-v2/animations/pos.css'],
  ['laboratorio/pos-lab/animations/modals.css','POS/css/experience-v2/animations/modals.css'],
  ['laboratorio/pos-lab/animations/notifications.css','POS/css/experience-v2/animations/notifications.css']
];

test('every approved LAB visual asset is promoted byte-for-byte into CANON',()=>{
  for(const [lab,canon] of promoted){
    assert.equal(read(canon),read(lab),`visual drift: ${canon} != ${lab}`);
  }
});

test('CANON loads the complete V2 layer after its existing product CSS',()=>{
  const html=read('POS/index.html');
  const links=[...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(m=>m[1]);
  const existing=links.indexOf('css/client-credit-accounts-v2.css');
  assert.ok(existing>=0);
  let previous=existing;
  for(const [,canon] of promoted){
    const href=canon.replace(/^POS\//,'');
    const at=links.indexOf(href);
    assert.ok(at>previous,`missing or wrong order: ${href}`);
    previous=at;
  }
});

test('production explicitly excludes the LAB-only marker/runtime override stylesheet',()=>{
  const html=read('POS/index.html');
  assert.doesNotMatch(html,/lab-overrides\.css/);
  assert.doesNotMatch(html,/laboratorio\/pos-lab\/styles|laboratorio\/pos-lab\/animations/);
  assert.equal(existsSync('POS/css/experience-v2/lab-overrides.css'),false);
});

test('the approved LAB menu rule removes the old welcome hero seen in production',()=>{
  const menu=read('POS/css/experience-v2/pages/menu.css');
  assert.match(menu,/#pageMenu \.hero-dashboard\.hero-welcome-only\s*\{[\s\S]*?display:\s*none/);
});

test('service worker precaches the full V2 visual layer',()=>{
  const sw=read('POS/sw.js');
  for(const [,canon] of promoted){
    const url='./'+canon.replace(/^POS\//,'');
    assert.ok(sw.includes(`'${url}'`),`missing precache: ${url}`);
  }
});
