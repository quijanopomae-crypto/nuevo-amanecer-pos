import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { visualAssets, canonicalVisualSource } from '../../tools/pos-experience/visual-assets.mjs';

const read = path => readFileSync(path,'utf8');

test('promotion manifest is unique, bounded and complete',()=>{
  assert.equal(visualAssets.length,23);
  assert.equal(new Set(visualAssets.map(asset=>asset.lab)).size,visualAssets.length);
  assert.equal(new Set(visualAssets.map(asset=>asset.canon)).size,visualAssets.length);
  assert.equal(visualAssets.filter(asset=>asset.transform==='canon-namespace').length,2);
  for(const asset of visualAssets){
    assert.match(asset.lab,/^laboratorio\/pos-lab\/(?:styles|animations)\//);
    assert.match(asset.canon,/^POS\/css\/experience-v2\//);
    assert.ok(['identity','canon-namespace'].includes(asset.transform));
    assert.equal(asset.href,asset.canon.replace(/^POS\//,''));
    assert.equal(asset.precache,'./'+asset.href);
  }
});

test('every approved LAB visual asset matches its deterministic CANON promotion output',()=>{
  for(const asset of visualAssets){
    assert.equal(
      read(asset.canon),
      canonicalVisualSource(asset,read(asset.lab)),
      `visual drift: ${asset.canon} != promoted output from ${asset.lab}`
    );
  }
});

test('identity assets remain byte-for-byte while runtime namespace assets are translated',()=>{
  for(const asset of visualAssets){
    const lab=read(asset.lab);
    const canon=read(asset.canon);
    if(asset.transform==='identity') assert.equal(canon,lab,`identity drift: ${asset.canon}`);
    else assert.notEqual(canon,lab,`runtime namespace asset must not remain raw LAB: ${asset.canon}`);
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

test('Clientes and shared transitions target the productive CANON runtime namespace',()=>{
  const clientes=read('POS/css/experience-v2/pages/clientes.css');
  assert.doesNotMatch(clientes,/\blab-(?:v2|client)-/);
  assert.match(clientes,/\bna-v2-/);
  assert.match(clientes,/\bna-client-/);

  const transitions=read('POS/css/experience-v2/animations/transitions.css');
  assert.doesNotMatch(transitions,/\blab-(?:enter|client|scroll|module|fade)-/);
  assert.match(transitions,/\bna-enter-fade\b/);
  assert.match(transitions,/\bna-client-refresh-(?:out|in)\b/);
  assert.match(transitions,/\bna-scroll-linked\b/);
  assert.match(transitions,/\bna-module-scroll-linked\b/);
  assert.match(transitions,/--na-motion-ease-standard\b/);
});

test('service worker precaches the full V2 visual layer',()=>{
  const sw=read('POS/sw.js');
  for(const asset of visualAssets){
    assert.ok(sw.includes(`'${asset.precache}'`),`missing precache: ${asset.precache}`);
  }
});
