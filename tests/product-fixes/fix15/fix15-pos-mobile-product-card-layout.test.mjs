import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../POS/css/layout.css', import.meta.url), 'utf8');

test('POS móvil permite que cada tarjeta crezca con su contenido', () => {
  const mobile = css.match(/@media\(max-width:700px\)\{([\s\S]*?)\n        \}\n\n        \/\* CORRECCIÓN: mostrar el contenido completo/);
  assert.ok(mobile, 'debe existir la corrección móvil antes del bloque de escritorio');
  const block = mobile[1];
  assert.match(block, /#pagePOS \.products-area\{[\s\S]*grid-auto-rows:max-content;[\s\S]*align-items:start;/);
  assert.match(block, /#pagePOS \.product-card\{[\s\S]*height:auto;[\s\S]*max-height:none;[\s\S]*min-height:190px;/);
});

test('el nombre y el stock permanecen dentro de la tarjeta en pantallas móviles', () => {
  const mobileStart = css.indexOf('@media(max-width:700px){');
  const desktopStart = css.indexOf('@media(min-width:701px){', mobileStart);
  assert.ok(mobileStart >= 0 && desktopStart > mobileStart);
  const block = css.slice(mobileStart, desktopStart);
  assert.match(block, /#pagePOS \.p-name\{[\s\S]*min-height:2\.7em;[\s\S]*white-space:normal;[\s\S]*overflow-wrap:anywhere;[\s\S]*word-break:break-word;/);
  assert.match(block, /#pagePOS \.p-stock-badge\{[\s\S]*white-space:normal;[\s\S]*line-height:1\.25;/);
});
