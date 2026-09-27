import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { visualAssets } from '../../tools/pos-experience/visual-assets.mjs';

const read = path => readFileSync(path,'utf8');
const promoted = visualAssets.map(({lab,canon}) => [lab,canon]);

test('promotion manifest is unique, bounded and complete',()=>{
  assert.equal(visualAssets.length,23);
  assert.equal(new Set(visualAssets.map(asset=>asset.lab)).size,visualAssets.length);
  assert.equal(new Set(visualAssets.map(asset=>asset.canon)).size,visualAssets.length);
  for(const asset of visualAssets){
    assert.match(asset.lab,/^laboratorio\/pos-lab\/(?:styles|animations)\//);
    assert.match(asset.canon,/^POS\/css\/experience-v2\//);
    assert.equal(asset.href,asset.canon.replace(/^POS\//,''));
    assert.equal(asset.precache,'./'+asset.href);
  }
});

test('every approved LAB visual asset is promoted byte-for-byte into CANON',()=>{
  for(const [lab,canon] of promoted){
    assert.equal(read(canon),read(lab),`visual drift: ${canon} != ${lab}`);
  }
});

test('CANON loads the complete V2 layer after its existing product CSS',()=>{
  const html=read('POS/index.html');
  const links=[...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/gi)].map(m=>m[1]);
  const existing=links.indexOf('css/client-credit-accounts-v2.css');
  assert.ok(existing>=0);
  let previous=existing;
  for(const asset of visualAssets){
    const at=links.indexOf(asset.href);
    assert.ok(at>previous,`missing or wrong order: ${asset.href}`);
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
  for(const asset of visualAssets){
    assert.ok(sw.includes(`'${asset.precache}'`),`missing precache: ${asset.precache}`);
  }
});
