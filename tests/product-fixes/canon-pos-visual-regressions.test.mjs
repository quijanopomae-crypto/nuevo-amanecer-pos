import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = path => readFileSync(path,'utf8');
const index = read('POS/index.html');
const legacyToast = read('POS/js/legacy-inline/inline-01.js');
const legacyPos = read('POS/js/legacy-inline/inline-02.js');
const clientV2 = read('POS/js/modules/client-credit-accounts-v2.js');
const clientCss = read('POS/css/client-credit-accounts-v2.css');
const notificationCss = read('POS/css/motion/notifications.css');
const adapter = read('POS/js/adapters/canonical-ui-adapter.js');

test('CANON category, barcode, icon and inventory flags come from one adapter contract',()=>{
  assert.match(adapter,/cat:\s*category/);
  assert.match(adapter,/barcode:\s*barcode/);
  assert.match(adapter,/icon:\s*icon/);
  assert.match(adapter,/controlInventario:\s*tracks/);
  assert.match(adapter,/precioCaja:/);
  assert.match(adapter,/tipoImpuesto:/);
});

test('Clientes keeps one productive motion owner instead of a late cliRender wrapper',()=>{
  assert.equal(existsSync('POS/js/motion/client-list-motion.js'),false);
  assert.doesNotMatch(index,/js\/motion\/client-list-motion\.js/);
  assert.match(clientV2,/function naRenderClientList\(rows, list\)/);
  assert.match(clientV2,/na-client-refresh-out/);
  assert.match(clientV2,/na-client-refresh-in/);
  assert.match(clientV2,/850/);
  assert.doesNotMatch(clientV2,/\bcliRender\s*=/);
  assert.match(clientCss,/opacity\s+1300ms/);
  assert.match(clientCss,/transform\s+1400ms/);
});

test('cart and toast motion are connected to real POS events',()=>{
  assert.match(legacyPos,/NA_MOTION\.cart\.pulse\(badge\)/);
  assert.match(legacyToast,/NA_MOTION\.feedback\.enter\(t\)/);
  assert.match(notificationCss,/from\{opacity:0;translate:0 4px\}/);
  assert.match(notificationCss,/to\{opacity:1;translate:0 0\}/);
  assert.doesNotMatch(notificationCss,/na-feedback-in[\s\S]*?transform:translateY/);
});
