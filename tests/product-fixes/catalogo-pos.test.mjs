import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('POS/js/modules/catalogo-pos.js', 'utf8');
const api = (() => { const ctx = vm.createContext({}); vm.runInContext(source, ctx); return ctx.NA_CATALOGO_POS; })();
const plain = v => JSON.parse(JSON.stringify(v));
const products = [
  { id: 1, name: 'Arroz Costeño', cat: 'abarrotes', precio: 4.5, costo: 3.1, stock: 10, imagen: 'data:image/png;base64,AAA' },
  { id: 2, name: 'Aceite', cat: 'abarrotes', precio: 1234.5, costo: 900, stock: 0, precioCaja: 50, unidCaja: 12 },
  { id: 3, name: 'Gaseosa', cat: 'bebidas', precio: 2, costo: 1, stock: 0, controlInventario: false },
  { id: 4, name: 'Inactivo', cat: 'bebidas', precio: 9, activo: false, stock: 5 },
  { id: 5, name: 'Sin precio', cat: 'limpieza', precio: 0, stock: 2, imagen: 'javascript:alert(1)' },
];

test('agrupa por categoría, ordena y omite inactivos', () => {
  const g = plain(api.buildCatalog(products));
  assert.deepEqual(g.map(x => x.key), ['abarrotes', 'bebidas', 'limpieza']);
  assert.deepEqual(g[0].items.map(i => i.name), ['Aceite', 'Arroz Costeño']);
  assert.equal(g[1].items.length, 1);
});
test('precio con coma de miles y sin precio dice Consultar', () => {
  const g = plain(api.buildCatalog(products));
  assert.equal(g[0].items[0].price, 'S/ 1,234.50');
  assert.equal(g[0].items[1].price, 'S/ 4.50');
  assert.equal(g[2].items[0].price, 'Consultar');
  assert.equal(api.money(1234567.891), 'S/ 1,234,567.89');
});
test('nunca expone costo, margen ni stock', () => {
  const json = JSON.stringify(api.buildCatalog(products, { mayorista: true }));
  assert.doesNotMatch(json, /costo|margen|stock|900|3\.1/i);
  assert.doesNotMatch(source, /\.costo|\bcost\b|margen|ganancia/i);
});
test('filtro por categoría y solo con stock (sin control de inventario cuenta como disponible)', () => {
  assert.deepEqual(plain(api.buildCatalog(products, { cat: 'bebidas' })).map(x => x.key), ['bebidas']);
  const s = plain(api.buildCatalog(products, { soloStock: true }));
  assert.deepEqual(s.flatMap(x => x.items.map(i => i.name)), ['Arroz Costeño', 'Gaseosa', 'Sin precio']);
});
test('precio mayorista opcional y fotos seguras', () => {
  const off = plain(api.buildCatalog(products))[0].items[0];
  assert.equal(off.wholesale, undefined);
  const on = plain(api.buildCatalog(products, { mayorista: true }))[0].items[0];
  assert.equal(on.wholesale, 'Caja x12 · S/ 50.00');
  const g = plain(api.buildCatalog(products));
  assert.equal(g[0].items[1].image, 'data:image/png;base64,AAA');
  assert.equal(g[2].items[0].image, '');
});
test('solo textContent, en español, imprime con window.print y A4', () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.match(source, /Generar catálogo/);
  assert.match(source, /root\.print\(\)/);
  assert.match(readFileSync('POS/css/catalogo-pos.css', 'utf8'), /@page\{size:A4/);
  assert.match(source, /isOwner/);
});
test('se carga en index.html y en la caché del service worker', () => {
  const index = readFileSync('POS/index.html', 'utf8'), sw = readFileSync('POS/sw.js', 'utf8');
  assert.match(index, /<script src="js\/modules\/catalogo-pos\.js"><\/script>/);
  assert.match(index, /href="css\/catalogo-pos\.css"/);
  assert.match(sw, /'\.\/js\/modules\/catalogo-pos\.js'/);
  assert.match(sw, /'\.\/css\/catalogo-pos\.css'/);
});

function fakeDoc() {
  const host = { children: [], appendChild(n) { n.parentNode = host; host.children.push(n); } };
  const made = [];
  const node = tag => ({ tag, attrs: {}, children: [], classList: { add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, append(...n) { this.children.push(...n); },
    appendChild(n) { this.children.push(n); }, querySelector: () => null, remove() { host.children = host.children.filter(c => c !== this); } });
  const doc = { readyState: 'complete', body: node('body'), made,
    createElement: t => { const n = node(t); made.push(n); return n; },
    getElementById: id => host.children.find(c => c.id === id) || null,
    querySelector: sel => (sel.includes('inv-secondary-menu') ? host : null),
    addEventListener() {} };
  return { doc, host };
}
function load({ lock, owner = true }) {
  const { doc, host } = fakeDoc();
  const ctx = vm.createContext({ document: doc, addEventListener() {}, NA_ROLES: { isOwner: () => owner },
    NA_PERMISSIONS: { featureLocked: id => { if (lock === 'throw') throw new Error('x'); return id === 'catalogo-desde-pos' ? lock : true; } } });
  ctx.window = ctx; vm.runInContext(source.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
  return { ctx, doc, host };
}
test('candado cerrado: el dueño no ve botón ni abre el catálogo', () => {
  const { ctx, doc, host } = load({ lock: true });
  assert.equal(host.children.length, 0);
  const before = doc.made.length; ctx.NA_CATALOGO_POS.open(); assert.equal(doc.made.length, before);
});
test('candado abierto y dueño: aparece «Generar catálogo»', () => {
  const { host } = load({ lock: false });
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].id, 'invCatalogoBtn');
  assert.equal(host.children[0].textContent, 'Generar catálogo');
});
test('candado abierto pero empleado: no hay botón', () => {
  assert.equal(load({ lock: false, owner: false }).host.children.length, 0);
});
test('si revisar el candado falla, queda cerrado', () => {
  const { ctx, doc, host } = load({ lock: 'throw' });
  assert.equal(host.children.length, 0);
  const before = doc.made.length; ctx.NA_CATALOGO_POS.open(); assert.equal(doc.made.length, before);
  assert.equal(load({ lock: false, owner: true }).host.children.length, 1);
});
test('sin NA_PERMISSIONS queda cerrado y el registro mantiene pending', () => {
  const { doc } = fakeDoc(); const ctx = vm.createContext({ document: doc, addEventListener() {}, NA_ROLES: { isOwner: () => true } });
  ctx.window = ctx; vm.runInContext(source.replace(/typeof window !== 'undefined' \? window : globalThis/, 'window'), ctx);
  assert.equal(doc.made.length, 0);
  assert.match(source, /featureLocked\('catalogo-desde-pos'\) === false/);
  assert.match(readFileSync('POS/js/modules/proximamente-registry.js', 'utf8'), /id: 'catalogo-desde-pos'[^\n]*pending: true/);
});
