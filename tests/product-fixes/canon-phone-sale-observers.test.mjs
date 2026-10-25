// canon-phone-sale.js (#456): en PC/tablet solo debe quedar el observador de clase del <body> (detector de
// dispositivo). Los observadores de venta (menú de cobro, carrito, total y clase de #pagePOS) se conectan al
// entrar en modo teléfono y se desconectan (disconnect) al salir.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('POS/js/canon-phone-sale.js', 'utf8');
const between = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a, b); };

test('solo el detector de dispositivo observa el body de forma permanente', () => {
  const permanent = src.split('function connectPhoneObservers()')[0] + src.slice(src.indexOf('function syncDevice()'));
  const perms = permanent.match(/new MutationObserver\(/g) || [];
  assert.equal(perms.length, 1);
  assert.match(permanent, /new MutationObserver\(syncDevice\)\.observe\(document\.body,/);
});

test('los 4 observadores de venta se crean solo dentro de connectPhoneObservers', () => {
  const block = between('function connectPhoneObservers()', 'function disconnectPhoneObservers()');
  assert.equal((block.match(/new MutationObserver\(/g) || []).length, 1); // creados en bucle
  for (const target of ["checkout,", "getElementById('cartItems')", "getElementById('posTotal')", 'page,']) assert.ok(block.includes(target), target);
  assert.match(block, /if \(phoneObservers\.length\) return;/);
});

test('syncDevice conecta al entrar en teléfono y desconecta al salir', () => {
  const sync = between('function syncDevice()', "new MutationObserver(syncDevice)");
  assert.match(sync, /phone = enabled;\s*if \(phone\) connectPhoneObservers\(\);/);
  assert.match(sync, /\} else \{[\s\S]*disconnectPhoneObservers\(\);\s*\}\s*\}\s*$/);
  const disc = between('function disconnectPhoneObservers()', 'function syncDevice()');
  assert.match(disc, /observer\.disconnect\(\)/);
  assert.match(disc, /phoneObservers = \[\]/);
});
