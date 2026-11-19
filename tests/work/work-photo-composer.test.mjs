import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../../POS/work/index.html',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../../POS/work/work-canon-bridge.js',import.meta.url),'utf8');

test('adjuntar foto cambia el boton de voz a Enviar y explica el siguiente toque',()=>{
  const start=html.indexOf('function renderAttachments(){');
  const end=html.indexOf('filePicker.addEventListener',start);
  assert.ok(start>=0&&end>start);
  const renderer=html.slice(start,end);
  assert.match(renderer,/updateComposerVisual\(\);/);
  assert.match(renderer,/attachmentSendHint/);
  assert.match(renderer,/Foto lista/);
  assert.match(html,/const hasText=!!chatInput\.value\.trim\(\) \|\| attachments\.length>0/);
  assert.match(html,/chatSend\.setAttribute\('aria-label', hasText \? 'Enviar mensaje' : 'Iniciar modo voz'\)/);
  assert.match(html,/<div id="attachmentSendHint"[^>]+>/);
});

test('la foto no se borra durante otra consulta ni antes de pasar por el puente',()=>{
  const form=bridge.slice(bridge.indexOf("intercept($('#chatComposeForm')"),bridge.indexOf("var ci=$('#chatInput')"));
  assert.match(form,/if\(pending\.size\)/);
  assert.match(form,/La foto sigue adjunta/);
  assert.match(form,/Preparando foto para enviar/);
  assert.match(form,/await encodePhoto\(attached\[0\]\.file\)/);
  assert.match(form,/if\(ask\(txt\|\|'Analiza esta imagen'/);
  assert.match(form,/if\(store&&typeof store\.clear==='function'\)store\.clear\(\)/);
});
