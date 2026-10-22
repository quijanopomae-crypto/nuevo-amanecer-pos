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
