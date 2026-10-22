import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

function sandbox(lockOpen) {
  const mem = new Map();
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const ctx = { console, Date, Math, JSON, localStorage };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('POS/js/config/pos-permissions.js'), ctx);
  if (lockOpen) {
    const P = ctx.NA_PERMISSIONS;
    ctx.NA_PERMISSIONS = { ...P, featureLocked: (id) => (id === 'ventas-espera' ? false : P.featureLocked(id)) };
  }
  const log = [];
  vm.runInContext(`let cart=[{id:1,precio:1250.5,qty:2},{id:2,precio:3,qty:1}];
    function toast(m,t){__log.push(m);} function posUpdateCart(){} async function saveAllData(){return true;}
    async function cargarBorrador(){ cart = JSON.parse(localStorage.getItem('na_cart_draft')); }`, Object.assign(ctx, { __log: log }));
  vm.runInContext(read('POS/js/modules/ventas-espera.js'), ctx);
  return { ctx, mem, log, cart: () => vm.runInContext('cart', ctx) };
}

test('el candado ventas-espera sigue cerrado en el repo', () => {
  const s = sandbox(false);
  assert.equal(s.ctx.NA_PERMISSIONS.FEATURE_LOCKS['ventas-espera'], true);
  assert.equal(s.ctx.NA_VENTAS_ESPERA.locked(), true);
});

test('con candado cerrado ponerEnEspera es no-op', async () => {
  const s = sandbox(false);
  await s.ctx.NA_VENTAS_ESPERA.ponerEnEspera();
  assert.equal(s.cart().length, 2);
  assert.equal(s.ctx.NA_VENTAS_ESPERA.list().length, 0);
});

test('varias ventas en espera, retomar y eliminar', async () => {
  const s = sandbox(true);
  const V = s.ctx.NA_VENTAS_ESPERA;
  await V.ponerEnEspera();
  assert.equal(s.cart().length, 0);
  vm.runInContext('cart.push({id:3,precio:10,qty:1})', s.ctx);
  await V.ponerEnEspera();
  const l = V.list();
  assert.equal(l.length, 2);
  assert.equal(l[0].total, 2504);
  s.mem.set('na_cart_draft', 'PREVIO');
  await V.retomar(l[0].id);
  assert.equal(s.cart().length, 2);
  assert.equal(V.list().length, 1);
  assert.equal(s.mem.get('na_cart_draft'), 'PREVIO', 'restaura el borrador simple');
  assert.equal(V.remove(V.list()[0].id), true);
  assert.equal(V.list().length, 0);
});

test('carrito vacío no se guarda y límite MAX', async () => {
  const s = sandbox(true);
  const V = s.ctx.NA_VENTAS_ESPERA;
  assert.equal(V.add([], '').ok, false);
  for (let i = 0; i < V.MAX; i++) assert.equal(V.add([{ id: 1, precio: 1, qty: 1 }]).ok, true);
  assert.equal(V.add([{ id: 1, precio: 1, qty: 1 }]).reason, 'full');
});

test('no usa innerHTML y el index carga el módulo; Venta sin botones nuevos', () => {
  const src = read('POS/js/modules/ventas-espera.js');
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(/.test(src));
  const html = read('POS/index.html');
  assert.ok(html.includes('<script src="js/modules/ventas-espera.js"></script>'));
  assert.ok(!html.includes('btnHoldSale'));
});

test('sw.js precachea ventas-espera.js, una sola vez, para que funcione sin internet', () => {
  const sw = read('POS/sw.js');
  const start = sw.indexOf('const PRECACHE_URLS = [');
  assert.ok(start >= 0);
  const block = sw.slice(start, sw.indexOf('];', start));
  const hits = block.match(/['"][^'"]*js\/modules\/ventas-espera\.js['"]/g) || [];
  assert.equal(hits.length, 1);
  assert.ok(read('POS/index.html').includes('js/modules/ventas-espera.js'));
});
