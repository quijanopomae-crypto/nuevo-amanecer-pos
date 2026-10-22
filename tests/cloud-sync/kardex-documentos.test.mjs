import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync('POS/js/modules/kardex-documentos.js', 'utf8');
const plain = v => JSON.parse(JSON.stringify(v));
function context(extra = {}) { const c = vm.createContext(extra); vm.runInContext(source, c); return c; }
const api = context().NA_KARDEX_DOCUMENTOS;
const opt = { now: '2026-10-16T04:59:59Z', from: '2026-10-01', to: '2026-10-15' }; // hoy 15/10 en Lima

test('agrupa una fila por documento: venta, compra multi-línea y ajuste', () => {
  const moves = [
    { id: 'm1', productId: 'a', type: 'SALE', delta: -2, fecha: '2026-10-15', timestamp: '2026-10-15T10:00:00', referenceId: 'V-000001' },
    { id: 'm2', productId: 'b', type: 'SALE', delta: -1, fecha: '2026-10-15', timestamp: '2026-10-15T10:00:01', referenceId: 'V-000001' },
    { id: 'm3', productId: 'a', type: 'ENTRADA', delta: 5, fecha: '2026-10-14', timestamp: '2026-10-14T09:00:00', referenceId: 'PUR-9:1', reason: 'Compra F001-12' },
    { id: 'm4', productId: 'b', type: 'ENTRADA', delta: 3, fecha: '2026-10-14', timestamp: '2026-10-14T09:00:00', referenceId: 'PUR-9:2', reason: 'Compra F001-12' },
    { id: 'm5', productId: 'a', type: 'SALIDA', delta: -1, fecha: '2026-10-13', timestamp: '2026-10-13T08:00:00', reason: 'ajuste:v1:{"t":"merma","u":{"n":"Ana","i":"u1"},"n":""}' },
    { id: 'm5', productId: 'a', type: 'SALIDA', delta: -1, fecha: '2026-10-13' } // duplicado
  ];
  const sales = [{ id: 'V-000001', fecha: '2026-10-15', cajeroNombre: 'Luis', items: [{ id: 'a', qty: 2 }, { id: 'b', qty: 1 }] }];
  const r = api.buildDocuments(moves, sales, opt);
  assert.equal(r.total, 3);
  const [venta, compra, ajuste] = plain(r.rows);
  assert.deepEqual([venta.type, venta.reference, venta.productCount, venta.outgoing, venta.incoming, venta.user, venta.time], ['Venta', 'V-000001', 2, 3, 0, 'Luis', '10:00']);
  assert.deepEqual([compra.type, compra.productCount, compra.incoming], ['Compra', 2, 8]);
  assert.equal(ajuste.type, 'Ajuste'); assert.equal(ajuste.outgoing, 1);
  assert.ok(!JSON.stringify(r).match(/cost|costo|cents|S\//i), 'sin costos ni montos');
});

test('venta sin movimiento se reconstruye; anuladas no; filtro por tipo y rango en hora de Lima', () => {
  const sales = [
    { id: 'V-2', fecha: '2026-10-10', items: [{ id: 'a', qty: 4 }] },
    { id: 'V-3', fecha: '2026-10-10', anulada: true, items: [{ id: 'a', qty: 4 }] },
    { id: 'V-old', fecha: '2026-09-01', items: [{ id: 'a', qty: 1 }] }
  ];
  const canon = [{ movement_id: 'c1', sale_id: 'uuid-x', product_id: 'a', quantity: -1, created_at: '2026-10-16T04:30:00Z' }]; // 15/10 23:30 Lima
  const r = api.buildDocuments(canon, sales, opt);
  assert.deepEqual(plain(r.rows.map(x => [x.type, x.day, x.time])), [['Venta', '2026-10-15', '23:30'], ['Venta', '2026-10-10', '']]);
  assert.equal(api.buildDocuments(canon, sales, { ...opt, type: 'compra' }).total, 0);
  assert.equal(api.buildDocuments(canon, sales, { ...opt, from: '2026-09-01' }).total, 3);
  for (const bad of [{ from: '2026-10-15', to: '2026-10-14' }, { to: '2026-10-16' }, { from: 'x' }])
    assert.throws(() => api.buildDocuments([], [], { ...opt, ...bad }), /rango/);
});

test('UUID se muestra corto y sin número; registros inválidos se cuentan', () => {
  const r = api.buildDocuments([{ id: 'z', productId: 'a', type: 'ENTRADA', delta: 2, fecha: '2026-10-12', operation_id: '1b2c3d4e-0000-4000-8000-000000000000:1' }, { id: 'bad', productId: 'a', delta: 'x', fecha: '2026-10-12' }], [], opt);
  assert.equal(r.rows[0].reference, 'Ingreso sin número · #1b2c3d');
  assert.equal(r.skipped, 1);
});

test('solo dueño, falla cerrada; candado kardex-documentos ausente = bloqueado', () => {
  const perms = locked => ({ canAccessScreen: () => true, featureLocked: id => (id === 'kardex-documentos' ? locked : true) });
  const cases = [
    [undefined, false], [{}, false], [{ isOwner: 1 }, false], [{ isOwner: () => { throw new Error('x'); } }, false],
    [{ isOwner: () => 'true' }, false], [{ isOwner: () => false }, false], [{ isOwner: () => true }, true]
  ];
  for (const [roles, expected] of cases) assert.equal(context({ NA_ROLES: roles, NA_PERMISSIONS: perms(false) }).NA_KARDEX_DOCUMENTOS.canViewDocuments(), expected);
  assert.equal(context({ NA_ROLES: { isOwner: () => true } }).NA_KARDEX_DOCUMENTOS.canViewDocuments(), false);
  assert.equal(context({ NA_PERMISSIONS: perms(true) }).NA_KARDEX_DOCUMENTOS.featureUnlocked(), false);
  assert.equal(context({ NA_PERMISSIONS: perms(false) }).NA_KARDEX_DOCUMENTOS.featureUnlocked(), true);
  const real = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
  const c = vm.createContext({}); vm.runInContext(real, c);
  const P = c.NA_PERMISSIONS || c.globalThis?.NA_PERMISSIONS;
  if (P && typeof P.featureLocked === 'function') assert.equal(P.featureLocked('kardex-documentos'), true);
});

test('solo lectura y DOM seguro: sin innerHTML, sin fetch/api, sin storage', () => {
  for (const bad of [/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, /fetch\(|\.api\(|XMLHttpRequest|sendBeacon/, /localStorage|sessionStorage|indexedDB/, /\bownerAllowed\b/])
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ''), bad);
});

test('sin dueño o con candado cerrado se oculta toda la sección, sin aviso «Sin permiso»', () => {
  const node = () => ({ hidden: false, textContent: 'x', value: '', replaceChildren() {}, appendChild() {} });
  const make = () => { const parts = { '[data-kdoc-controls]': node(), '[data-kdoc-status]': node(), '[data-kdoc-content]': node() };
    const box = { __naKdocBound: true, hidden: false, querySelector: s => parts[s] || node() }; return { box, parts }; };
  const perms = locked => ({ canAccessScreen: () => true, featureLocked: id => (id === 'kardex-documentos' ? locked : true) });
  for (const [roles, permissions] of [[{ isOwner: () => false }, perms(false)], [undefined, perms(false)], [{ isOwner: () => true }, perms(true)], [{ isOwner: () => true }, undefined]]) {
    const { box, parts } = make();
    const document = { getElementById: () => ({ querySelector: () => box }), createElement: node };
    const c = context({ NA_ROLES: roles, NA_PERMISSIONS: permissions, document });
    assert.equal(c.NA_KARDEX_DOCUMENTOS.render(), false);
    assert.equal(box.hidden, true); assert.equal(parts['[data-kdoc-controls]'].hidden, true);
    assert.equal(parts['[data-kdoc-status]'].textContent, '');
  }
  assert.doesNotMatch(source, /Sin permiso/);
});

test('tarjeta kardex-documentos en Próximamente: pending, solo dueño, pageKardex', () => {
  const reg = readFileSync('POS/js/modules/proximamente-registry.js', 'utf8');
  const line = reg.split('\n').find(l => l.includes("id: 'kardex-documentos'"));
  assert.ok(line, 'falta la tarjeta');
  assert.match(line, /pending: true/); assert.match(line, /roles: \['owner'\]/); assert.match(line, /page: 'pageKardex'/);
});
