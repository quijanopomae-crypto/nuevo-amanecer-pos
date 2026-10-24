import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/modules/clonar-venta.js', 'utf8');

function load(extra = {}) {
  const toasts = [];
  const ctx = vm.createContext({ toast: (m, t) => toasts.push([m, t]), confirm: () => true, ...extra });
  ctx.window = ctx;
  vm.runInContext(source, ctx);
  return { api: ctx.NA_CLONAR_VENTA, ctx, toasts };
}

const productos = [
  { id: 1, name: 'Arroz 1kg', precio: 4.5, stock: 10 },
  { id: 2, name: 'Aceite', precio: 9.9, stock: 1 },
  { id: 3, name: 'Inactivo', precio: 2, stock: 5, activo: false }
];

test('buildPlan copia productos y cantidades del catálogo, sin precios viejos', () => {
  const { api } = load();
  const sale = { id: 'V-10', clienteId: 7, items: [
    { id: 1, name: 'Arroz 1kg', qty: 2, precio: 3 }, { id: 1, name: 'Arroz 1kg', qty: 1, precio: 3 },
    { id: 2, name: 'Aceite', qty: 3, precio: 1 }, { id: 99, name: 'Borrado', qty: 1 },
    { id: -5, name: 'VARIOS', qty: 1, ventaLibre: true }, { id: 3, name: 'Inactivo', qty: 1 },
    { id: 1, name: 'Granel', qty: 0.5 }
  ] };
  const plan = api.buildPlan(sale, productos);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.lines)), [{ productId: 1, name: 'Arroz 1kg', qty: 3 }, { productId: 2, name: 'Aceite', qty: 3 }]);
  assert.equal(plan.lines.some(l => 'precio' in l), false, 'el precio sale del catálogo al agregar');
  assert.deepEqual(Array.from(plan.skipped, s => s.name), ['Borrado', 'VARIOS', 'Inactivo', 'Granel']);
  assert.equal(plan.clientId, '7');
});

test('las ventas anuladas no se clonan', () => {
  const { api } = load();
  for (const s of [{ anulada: true }, { anulado: true }, { estado: 'anulada' }]) {
    const plan = api.buildPlan({ id: 'V-1', items: [{ id: 1, qty: 1 }], ...s }, productos);
    assert.equal(plan.annulled, true);
    assert.equal(plan.lines.length, 0);
  }
});

test('clone usa solo posAdd, respeta el stock y no crea venta ni abre el cobro', () => {
  const cart = [{ id: 9, qty: 1 }];
  const added = [];
  const ventas = [{ id: 'V-10', clienteId: 7, items: [{ id: 1, qty: 2 }, { id: 2, qty: 3 }] }, { id: 'V-11', anulada: true, items: [{ id: 1, qty: 1 }] }];
  const pages = [];
  const { api, toasts } = load({
    ventas, productos, cart, goPage: p => pages.push(p), posUpdateCart: () => {},
    posAdd: id => { const p = productos.find(x => x.id === id); const used = cart.filter(x => x.id === id).length; if (used >= p.stock) return false; cart.push({ id }); added.push(id); return true; },
    abrirCobro: () => { throw new Error('no debe cobrar'); },
    NA_PERMISSIONS: { featureLocked: () => false }
  });
  const res = api.clone('V-10');
  assert.equal(res.ok, true);
  assert.deepEqual(added, [1, 1, 2]);
  assert.equal(cart.some(x => x.id === 9), false, 'el carrito anterior se vació');
  assert.deepEqual(JSON.parse(JSON.stringify(res.short)), [{ name: 'Aceite', added: 1, wanted: 3 }]);
  assert.deepEqual(pages, ['pagePOS']);
  assert.equal(ventas.length, 2, 'no se creó ninguna venta');
  assert.equal(api._pendingClient(), '7');
  assert.match(toasts.at(-1)[0], /stock insuficiente: Aceite \(1 de 3\)/);
  const annul = api.clone('V-11');
  assert.equal(annul.reason, 'annulled');
  assert.match(toasts.at(-1)[0], /anulada/);
});

test('bloqueado o con carrito y sin confirmar no toca el carrito', () => {
  const cart = [{ id: 9 }];
  const base = { ventas: [{ id: 'V-1', items: [{ id: 1, qty: 1 }] }], productos, cart, posAdd: () => { throw new Error('no'); } };
  assert.equal(load({ ...base, NA_PERMISSIONS: { featureLocked: () => true } }).api.clone('V-1').reason, 'locked');
  assert.equal(load({ ...base, confirm: () => false, NA_PERMISSIONS: { featureLocked: () => false } }).api.clone('V-1').reason, 'cancelled');
  assert.deepEqual(cart, [{ id: 9 }]);
});

test('sin innerHTML y cableado en index.html, sw.js y permisos', () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(source, /abrirCobro|confirmarVenta|ventas\.push|toFixed/);
  const html = readFileSync('POS/index.html', 'utf8'), sw = readFileSync('POS/sw.js', 'utf8');
  assert.ok(html.includes('<script src="js/modules/clonar-venta.js"></script>'));
  assert.ok(html.includes('href="css/clonar-venta.css"'));
  assert.ok(sw.includes("'./js/modules/clonar-venta.js'") && sw.includes("'./css/clonar-venta.css'"));
  // El candado de Próximamente lo quita PROGRAMADOR junto con las demás tarjetas.
  assert.match(readFileSync('POS/js/config/pos-permissions.js', 'utf8'), /'clonar-venta': true,/);
  assert.match(source, /featureLocked\(FEATURE\)/);
});

test('con el candado cerrado (por defecto) clonar-venta no instala observadores ni escuchas al iniciar', () => {
  let observers = 0, listeners = 0;
  class MO { constructor() { observers++; } observe() {} }
  const el = { querySelectorAll: () => [], classList: { contains: () => false } };
  const doc = { readyState: 'complete', getElementById: () => el, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) };
  const run = (locked) => {
    observers = 0; listeners = 0;
    const ctx = vm.createContext({ MutationObserver: MO, document: doc, NA_PERMISSIONS: { featureLocked: () => locked } });
    ctx.window = ctx; ctx.addEventListener = () => { listeners++; };
    vm.runInContext(source, ctx);
    return { observers, listeners };
  };
  assert.deepEqual(run(true), { observers: 0, listeners: 0 });
  assert.ok(run(false).observers >= 1, 'con el candado abierto sí se instala');
});
