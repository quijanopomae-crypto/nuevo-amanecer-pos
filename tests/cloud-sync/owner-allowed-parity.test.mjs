// ownerAllowed: cada copia local es un alias de NA_ROLES.isOwner (falla cerrada) que conserva
// sus comprobaciones extra (tabla de permisos cargada, interruptor de función). Solo fixtures locales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

// Las 12 copias locales de ownerAllowed y la página/función que protege cada una.
const COPIES = [
  { file: 'POS/js/config/pos-purchases-client.js' },
  { file: 'POS/js/inventory/codigos-duplicados.js' },
  { file: 'POS/js/inventory/historial-compras.js', exported: 'NA_HISTORIAL_COMPRAS' },
  { file: 'POS/js/modules/proximamente.js' },
  { file: 'POS/js/modules/clientes-frecuencia.js', page: 'pageClientesFrecuencia', policy: true, exported: 'NA_CLIENTES_FRECUENCIA' },
  { file: 'POS/js/modules/reporte-arqueo.js', page: 'pageReporteArqueo', policy: true },
  // #164: panel de tesorería dentro de pageReporteArqueo (candado propio aparte).
  { file: 'POS/js/modules/panel-tesoreria.js', page: 'pageReporteArqueo', policy: true },
  { file: 'POS/js/modules/reporte-productos-vencer.js', page: 'pageReporteProductosVencer', feature: 'reporte-productos-vencer', policy: true, exported: 'NA_REPORTE_PRODUCTOS_VENCER' },
  { file: 'POS/js/modules/rotacion-abc.js', page: 'pageRotacionAbc', policy: true, exported: 'NA_ROTACION_ABC' },
  { file: 'POS/js/modules/valorizacion-inventario.js', page: 'pageValorizacion', policy: true },
  { file: 'POS/js/modules/ventas-stock.js', page: 'pageVentasStock', policy: true, exported: 'NA_VENTAS_STOCK' },
  { file: 'POS/js/modules/kardex.js', page: 'pageKardex', policy: true, exported: 'NA_KARDEX' },
  { file: 'POS/js/modules/cliente-historial-compras.js', page: 'pageClienteHistorial', feature: 'cliente-historial-compras', policy: true, featureSwitch: true, exported: 'NA_CLIENTE_HISTORIAL' },
  // #833: el costo del historial de precios lo ve solo el dueño confirmado (misma regla, otro nombre).
  { file: 'POS/js/products/price-history.js', fn: 'canSeeCost' },
  // #858: el costo de última compra en la ficha y su actualización al comprar, solo dueño confirmado.
  { file: 'POS/js/products/costo-compra-ficha.js', fn: 'isOwner' }
];
const OWNER_COPIES = COPIES.filter(c => !c.fn);

// Copia exacta del texto de ownerAllowed (y de sus ayudantes isOwner/policyReady/featureUnlocked) del archivo real.
function ownerBlock(source, fn = 'ownerAllowed') {
  const def = source.search(new RegExp('function ' + fn + '\\(\\)|const ' + fn + ' = '));
  assert.ok(def >= 0, fn + ' definition');
  const helper = source.indexOf('function isOwner()');
  let start = helper >= 0 && helper < def ? helper : def;
  let i = source.indexOf('{', def), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1) + (source[i + 1] === ';' ? ';' : '');
}

// window mínimo para cargar los archivos reales pos-permissions.js y pos-roles-client.js.
function makeWindow({ creds = false, cache = null, me = null } = {}) {
  const store = new Map();
  if (creds) store.set('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://example.invalid', token: 't' }));
  if (cache) store.set('na_pos_role_v1', JSON.stringify({ role: cache }));
  const listeners = {};
  const classList = { toggle() {} };
  const doc = {
    readyState: 'complete', body: null, documentElement: { classList },
    addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
  };
  const ctx = vm.createContext({
    document: doc,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent() { return true; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    fetch: async () => {
      if (me === 'network') throw new Error('offline');
      if (typeof me === 'number') return { ok: false, status: me, json: async () => ({ error: 'unauthorized' }) };
      return { ok: true, status: 200, json: async () => ({ pos_role: me, owner_pin_set: true }) };
    }
  });
  ctx.window = ctx;
  ctx.fire = type => (listeners[type] || []).forEach(fn => fn({ type }));
  vm.runInContext(read('POS/js/config/pos-permissions.js'), ctx);
  vm.runInContext(read('POS/js/config/pos-roles-client.js'), ctx);
  return ctx;
}
function gates(ctx) {
  return COPIES.map(copy => ({
    copy,
    allowed: vm.runInContext('(function (root) { var PAGE_ID = ' + JSON.stringify(copy.page || 'pageX') + ', FEATURE_ID = ' + JSON.stringify(copy.feature || 'x') +
      ';\n' + ownerBlock(read(copy.file), copy.fn) + '\nreturn ' + (copy.fn || 'ownerAllowed') + '; })(globalThis)', ctx)
  }));
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function scenario(options, after) {
  const ctx = makeWindow(options);
  await settle(); // install() ya llamó a refresh() (/auth/me).
  if (after) await after(ctx);
  return ctx;
}

const ROLE_SCENARIOS = [
  ['dueño confirmado por /auth/me', { creds: true, me: 'owner' }, true],
  ['empleado confirmado', { creds: true, me: 'empleado' }, false],
  ['401 => rol unknown', { creds: true, cache: 'owner', me: 401 }, false],
  ['dueño en caché sin confirmar (falla de red)', { creds: true, cache: 'owner', me: 'network' }, false],
  ['dueño confirmado y luego evento offline', { creds: true, me: 'owner' }, false, ctx => ctx.fire('offline')],
  ['modo local sin credenciales', {}, true]
];

test('las 12 copias de ownerAllowed, canSeeCost (#833) e isOwner (#858) son alias de NA_ROLES.isOwner (sin depender del rol en caché)', () => {
  const found = [], cost = [], products = [];
  const walk = dir => readdirSync(new URL('../../' + dir, import.meta.url)).forEach(name => {
    const path = dir + '/' + name;
    if (statSync(new URL('../../' + path, import.meta.url)).isDirectory()) walk(path);
    else if (name.endsWith('.js') && /function ownerAllowed\(\)|const ownerAllowed = /.test(read(path))) found.push(path);
    if (name.endsWith('.js') && /function canSeeCost\(\)|const canSeeCost = /.test(read(path))) cost.push(path);
    // Fichas de producto: toda puerta propia isOwner() que muestra costos debe estar registrada aquí.
    if (path.startsWith('POS/js/products/') && name.endsWith('.js') && /function isOwner\(\)/.test(read(path))) products.push(path);
  });
  walk('POS/js');
  assert.deepEqual(found.sort(), OWNER_COPIES.map(c => c.file).sort());
  assert.deepEqual(cost.sort(), COPIES.filter(c => c.fn === 'canSeeCost').map(c => c.file).sort());
  assert.deepEqual(products.sort(), COPIES.filter(c => c.fn === 'isOwner').map(c => c.file).sort());
  for (const { file, fn } of COPIES) {
    const block = ownerBlock(read(file), fn);
    assert.match(block, /isOwner(\?\.)?\(\) === true/, file + ' isOwner() === true');
    assert.match(block, /\.isOwner\b/, file);
    assert.doesNotMatch(block, /canConfigure|role === 'owner'/, file);
    assert.match(block, /try \{/, file + ' falla cerrada');
  }
});

for (const [name, options, expected, after] of ROLE_SCENARIOS) {
  test('paridad con NA_ROLES.isOwner: ' + name, async () => {
    const ctx = await scenario(options, after);
    assert.equal(ctx.NA_ROLES.isOwner(), expected);
    for (const { copy, allowed } of gates(ctx)) assert.equal(allowed(), expected, copy.file);
  });
}

test('NA_ROLES ausente o isOwner que lanza error => false en todas las copias', async () => {
  const ctx = await scenario({ creds: true, me: 'owner' });
  const list = gates(ctx);
  ctx.NA_ROLES = undefined;
  for (const { copy, allowed } of list) assert.equal(allowed(), false, copy.file + ' sin NA_ROLES');
  ctx.NA_ROLES = { role: 'owner', confirmed: true, isOwner() { throw new Error('boom'); }, canConfigure() { throw new Error('boom'); } };
  for (const { copy, allowed } of list) assert.equal(allowed(), false, copy.file + ' isOwner lanza');
  ctx.NA_ROLES = { role: 'owner', confirmed: true };
  for (const { copy, allowed } of list) assert.equal(allowed(), false, copy.file + ' sin isOwner');
  ctx.NA_ROLES = { role: 'owner', isOwner: () => 'yes' };
  for (const { copy, allowed } of list) assert.equal(allowed(), false, copy.file + ' isOwner no booleano');
});

test('Compras: el dueño en caché sin confirmar ya no ve proveedor ni costos (más estricto)', async () => {
  const purchases = COPIES[0];
  const at = async options => gates(await scenario(options)).find(g => g.copy === purchases).allowed();
  assert.equal(await at({ creds: true, cache: 'owner', me: 'network' }), false, 'caché owner sin confirmar');
  // Antes bastaba el rol en caché: canDo(NA_ROLES.role, 'purchases.costs.view').
  const unconfirmed = await scenario({ creds: true, cache: 'owner', me: 'network' });
  assert.equal(unconfirmed.NA_ROLES.role, 'owner');
  assert.equal(unconfirmed.NA_PERMISSIONS.canDo(unconfirmed.NA_ROLES.role, 'purchases.costs.view'), true, 'la regla antigua habría mostrado costos');
  assert.equal(await at({ creds: true, me: 'owner' }), true, 'dueño confirmado');
  assert.equal(await at({ creds: true, me: 'empleado' }), false, 'empleado');
  assert.equal(await at({}), true, 'sin nube');
  // Sin tabla de permisos sigue fallando cerrado.
  const noPolicy = await scenario({ creds: true, me: 'owner' });
  const gate = gates(noPolicy).find(g => g.copy === purchases).allowed;
  noPolicy.NA_PERMISSIONS = undefined;
  assert.equal(gate(), false);
});

test('se conservan la tabla de permisos y el interruptor de función (dueño confirmado)', async () => {
  const ctx = await scenario({ creds: true, me: 'owner' });
  const list = gates(ctx);
  const permissions = ctx.NA_PERMISSIONS;
  ctx.NA_PERMISSIONS = undefined;
  for (const { copy, allowed } of list.filter(g => g.copy.policy)) assert.equal(allowed(), false, copy.file + ' sin NA_PERMISSIONS');
  ctx.NA_PERMISSIONS = { canAccessScreen() { throw new Error('boom'); }, featureLocked: () => false };
  for (const { copy, allowed } of list.filter(g => g.copy.policy)) assert.equal(allowed(), false, copy.file + ' canAccessScreen lanza');
  ctx.NA_PERMISSIONS = Object.assign({}, permissions, { featureLocked: id => id === 'cliente-historial-compras' });
  for (const { copy, allowed } of list) assert.equal(allowed(), !copy.featureSwitch, copy.file + ' con la función bloqueada');
});

test('módulos completos: ownerAllowed exportado sigue la regla y kardex.costsAllowed no lanza sin tabla', async () => {
  const ctx = await scenario({ creds: true, me: 'owner' });
  for (const copy of COPIES.filter(c => c.exported)) vm.runInContext(read(copy.file), ctx);
  for (const copy of COPIES.filter(c => c.exported)) assert.equal(ctx[copy.exported].ownerAllowed(), true, copy.exported);
  assert.equal(ctx.NA_KARDEX.costsAllowed(), true);
  const permissions = ctx.NA_PERMISSIONS;
  ctx.NA_PERMISSIONS = undefined;
  assert.equal(ctx.NA_KARDEX.costsAllowed(), false);
  ctx.NA_PERMISSIONS = permissions;
  ctx.fire('offline');
  for (const copy of COPIES.filter(c => c.exported)) assert.equal(ctx[copy.exported].ownerAllowed(), false, copy.exported + ' offline');
  assert.equal(ctx.NA_KARDEX.costsAllowed(), false);
  ctx.NA_ROLES = { role: 'owner', isOwner() { throw new Error('boom'); } };
  for (const copy of COPIES.filter(c => c.exported)) assert.equal(ctx[copy.exported].ownerAllowed(), false, copy.exported + ' isOwner lanza');
  assert.equal(ctx.NA_KARDEX.costsAllowed(), false);
});

test('un NA_ROLES con solo isOwner() (sin role) basta para las copias de rol puro', async () => {
  const ctx = await scenario({ creds: true, me: 'owner' });
  const list = gates(ctx);
  ctx.NA_ROLES = { isOwner: () => true };
  for (const { copy, allowed } of list.filter(g => !g.copy.file.endsWith('pos-purchases-client.js'))) assert.equal(allowed(), true, copy.file);
  // Compras además exige purchases.costs.view para el rol: sin rol no muestra costos.
  assert.equal(list[0].allowed(), false);
  ctx.NA_ROLES = { role: 'owner', isOwner: () => false };
  for (const { copy, allowed } of list) assert.equal(allowed(), false, copy.file + ' rol owner pero isOwner false');
});
