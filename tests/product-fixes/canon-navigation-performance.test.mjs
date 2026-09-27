import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inline2=readFileSync('POS/js/legacy-inline/inline-02.js','utf8');
const inline3=readFileSync('POS/js/legacy-inline/inline-03.js','utf8');

function between(source,start,end){
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,`missing start marker: ${start}`);
  assert.ok(b>a,`missing end marker: ${end}`);
  return source.slice(a,b);
}

test('goPage activates first and schedules heavy render after a paint opportunity',()=>{
  const block=between(inline2,'goPage=function(id){','goMenu=function(){');
  assert.match(block,/target\.classList\.add\('active'\)/);
  assert.match(block,/_naSchedulePageRender\(id\)/);
  assert.doesNotMatch(block,/posRender\(\)|invRender\(\)|cliRender\(\)|cajRender\(\)|ventasRender\(\)|gasRender\(\)/);
  const scheduler=between(inline2,'function _naSchedulePageRender(id){','goPage=function(id){');
  assert.match(scheduler,/requestAnimationFrame\(\(\)=>setTimeout\(\(\)=>/);
  assert.match(scheduler,/!target\.classList\.contains\('active'\)/);
});

test('page renderer keeps the same module renderers but only dispatches the selected page',()=>{
  const block=between(inline2,'function _naRenderPageNow(id){','function _naSchedulePageRender(id){');
  for(const marker of ['posRender()','invRender()','cliRender()','cajRender()','ventasRender()','gasRender()','updateDashboard()']){
    assert.ok(block.includes(marker),`missing renderer: ${marker}`);
  }
});

test('CANON updates no longer render every hidden module in one event',()=>{
  const block=between(inline3,"window.addEventListener('na:canonical-updated'", "window.addEventListener('storage'");
  assert.match(block,/_naSchedulePageRender\(_naActivePageId\(\)\)/);
  assert.doesNotMatch(block,/posRender\(\);posUpdateCart\(false\);invRender\(\);cfgUpdateStats\(\);updateDashboard\(\);cliRender\(\)/);
  assert.doesNotMatch(block,/\bposRender\(\)/);
  assert.doesNotMatch(block,/\binvRender\(\)/);
});

test('CANON bootstrap does not eagerly render all hidden modules',()=>{
  const block=between(inline3,"document.addEventListener('DOMContentLoaded'", "if(typeof NuevoAmanecerOutbox");
  assert.match(block,/_naSchedulePageRender\(_naActivePageId\(\)\)/);
  assert.doesNotMatch(block,/posRender\(\);posUpdateCart/);
  assert.doesNotMatch(block,/invRender\(\);cfgUpdateStats\(\);updateDashboard\(\);cliRender\(\)/);
});

test('menu restore is also scheduled instead of blocking startup with dashboard work',()=>{
  const load=between(inline2,'loadAppState=function(){','getLunesSemana=function(){');
  assert.match(load,/_naSchedulePageRender\('pageMenu'\)/);
});
