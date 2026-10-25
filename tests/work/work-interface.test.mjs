import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=(p)=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const html=source('POS/work/index.html');
const bridge=source('POS/work/work-canon-bridge.js');
const host=source('POS/js/work-host.js');
const pos=source('POS/index.html');

test('WORK preserves the supplied design modules',()=>{
  for(const id of ['openMenu','drawer','workChat','chatComposeForm','brainLevelsButton','workDictation','workVoice','voiceMic','voiceStop','attachButton','modelOptions','voiceHistoryPanel']){
    assert.match(html,new RegExp('id="'+id+'"'),id);
  }
  for(const label of ['Flash','Pro','Ultra','NUEVO AMANECER','Aurora']){
    assert.ok(html.toLowerCase().includes(label.toLowerCase()),label);
  }
});
test('WORK is added in isolation without replacing canonical sales UI',()=>{
  assert.match(pos,/src="js\/work-host\.js" defer/);
  assert.match(host,/frame\.src='work\/index\.html'/);
  assert.match(host,/allowedPages/);
  assert.match(host,/event\.origin!==root\.location\.origin/);
  assert.match(html,/src="work-canon-bridge\.js" defer/);
});
test('WORK does not present the sample values as canonical data',()=>{
  assert.match(bridge,/v\.textContent='—'/);
  assert.match(bridge,/rows\.forEach\(function\(row\)\{row\.remove\(\);\}\)/);
  assert.match(bridge,/no se mostrarán operaciones de ejemplo/i);
});
test('WORK cannot create unapproved operations from the iframe',()=>{
  assert.match(host,/NA_ROLES\.api\('\/auth\/assistant\/chat'/);
  assert.doesNotMatch(host,/\/commands\//);
  assert.doesNotMatch(bridge,/\/commands\//);
  assert.match(bridge,/Generación de imágenes pendiente/);
  assert.match(bridge,/VOZ POR TURNOS/);
});
