import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { docHelpers } from '../helpers/doc-helpers.mjs';

const read = path => readFileSync(path, 'utf8');
const source = read('POS/js/core/seller-labels.js');
function load(extra = {}) {
  const ctx = vm.createContext({ module: { exports: {} }, ...extra });
  vm.runInContext(source, ctx);
  return { ctx, L: ctx.NA_SELLER_LABELS };
}
const { L } = load();
const plain = value => JSON.parse(JSON.stringify(value));

test('nombre único: sin sufijo y el texto queda igual', () => {
  const labels = L.create([{ id: 'CAJ-001', name: 'Ana' }, { id: 'CAJ-003', name: 'Luis' }, { id: 'CAJ-001', name: 'Ana' }]);
  assert.equal(labels.label('CAJ-001', 'Ana'), 'Ana');
  assert.equal(labels.label('CAJ-003', 'Luis'), 'Luis');
  assert.equal(labels.suffix('CAJ-003', 'Luis'), '');
  assert.equal(labels.collides('Ana'), false);
  // Mismo nombre y sin id en ninguna venta: una sola identidad, no hay choque.
  assert.equal(L.create([{ name: 'Rosa' }, { name: ' rosa ' }]).label('', 'Rosa'), 'Rosa');
  assert.equal(labels.label('', '', 'No registrado'), 'No registrado');
  // Venta antigua solo con nombre + un único id con ese nombre: la misma persona (#815), sin sufijo.
  const folded = L.create([{ name: ' luis ' }, { id: 'v1', name: 'Luis' }]);
  assert.equal(folded.label('v1', 'Luis'), 'Luis');
  assert.equal(folded.label('', ' luis '), 'luis');
});

test('mismo nombre, ids distintos: « · ID» corto para cada uno; mayúsculas y espacios no cuentan', () => {
  const labels = L.create([{ id: 'CAJ-001', name: 'Ana' }, { id: 'CAJ-002', nombre: '  ana ' }, { id: 'CAJ-003', name: 'Luis' }]);
  assert.equal(labels.label('CAJ-001', 'Ana'), 'Ana · CAJ-001');
  assert.equal(labels.label('CAJ-002', 'ANA'), 'ANA · CAJ-002');
  assert.notEqual(labels.label('CAJ-001', 'Ana'), labels.label('CAJ-002', 'Ana'));
  assert.equal(labels.label('CAJ-003', 'Luis'), 'Luis');
  assert.equal(labels.collides('ana'), true);
});

test('determinista: el orden de entrada no cambia ninguna etiqueta', () => {
  const entries = [
    { id: '4f2a9c1e-0000-4000-8000-aaaaaaaaaaaa', name: 'Rosa' }, { id: '4f2a7777-0000-4000-8000-cccccccccccc', name: 'Rosa' },
    { id: '9b11aaaa-0000-4000-8000-bbbbbbbbbbbb', name: 'Rosa' }, { id: 'CAJ-002', name: 'Ana' }, { id: 'CAJ-001', name: 'Ana' }, { name: 'Ana' },
  ];
  const ask = [['4f2a9c1e-0000-4000-8000-aaaaaaaaaaaa', 'Rosa'], ['4f2a7777-0000-4000-8000-cccccccccccc', 'Rosa'], ['9b11aaaa-0000-4000-8000-bbbbbbbbbbbb', 'Rosa'], ['CAJ-001', 'Ana'], ['CAJ-002', 'Ana'], ['', 'Ana']];
  const expected = ['Rosa · 4f2a9', 'Rosa · 4f2a7', 'Rosa · 9b11', 'Ana · CAJ-001', 'Ana · CAJ-002', 'Ana (sin id)'];
  const forward = L.create(entries), backward = L.create(entries.slice().reverse());
  assert.deepEqual(ask.map(([id, name]) => forward.label(id, name)), expected);
  assert.deepEqual(ask.map(([id, name]) => backward.label(id, name)), expected);
  assert.equal(new Set(expected).size, expected.length);
});

test('ids largos con prefijo «session:»: se usa la parte propia del id', () => {
  const labels = L.create([{ id: 'session:7e3d00112233', name: 'Dueño' }, { id: 'ab12cd34ef56gh78', name: 'Dueño' }]);
  assert.equal(labels.label('session:7e3d00112233', 'Dueño'), 'Dueño · 7e3d');
  assert.equal(labels.label('ab12cd34ef56gh78', 'Dueño'), 'Dueño · ab12');
});

test('key(): agrupa por id; sin id, por nombre normalizado', () => {
  assert.equal(L.key(' CAJ-002 ', 'Ana'), 'id:CAJ-002');
  assert.equal(L.key('', '  ANA  '), 'name:ana');
  assert.equal(L.key(null, ''), '');
});

test('cashiers(): universo = registro + ventas + cierres; mismo resultado en otra carga (recarga)', () => {
  const state = () => ({
    appConfig: { cashiers: [{ id: 'CAJ-001', nombre: 'Ana' }, { id: 'CAJ-002', nombre: 'Ana' }, { id: 'CAJ-003', nombre: 'Luis' }] },
    ventas: [{ id: 'v1', cajeroId: 'CAJ-004', cajeroNombre: 'Luis' }], cashClosures: [], cajEstado: null,
  });
  const a = load(state()).L, b = load(state()).L;
  for (const api of [a, b]) {
    assert.equal(api.cashierLabel('CAJ-002', 'Ana'), 'Ana · CAJ-002');
    assert.equal(api.cashierLabel('CAJ-004', 'Luis'), 'Luis · CAJ-004');
    assert.equal(api.cashierIdSuffix('', 'Ana'), '', 'ticket sin id: sin «(sin id)»');
  }
});

test('Reportes: dos cajeros con el mismo nombre quedan en filas separadas con sus propios totales', () => {
  const c = vm.createContext({ ...docHelpers, console, productos: [], ventas: [], clientes: [], creditos: [], gastos: [], cajMovs: [], ventasRender() {},
    document: { addEventListener() {}, getElementById() { return null; } }, _naNumber: (n, d = 0) => Number.isFinite(Number(n)) ? Number(n) : d,
    _naClean: n => String(n ?? '').trim(), _naEsc: n => String(n ?? ''), _naUnitsSold: i => i.qty ?? 0, _naCategoryLabel: x => x, totalV: v => v.total,
    fmt: n => `S/ ${n}`, _naIsSaleIncomeMove: () => false, _naIsSaleReversalMove: () => false, module: { exports: {} } });
  c.window = c;
  vm.runInContext(read('POS/js/core/lima-time.js'), c);
  vm.runInContext(source, c);
  vm.runInContext(read('POS/js/legacy-inline/inline-05.js'), c);
  const item = { id: 1, name: 'P', precio: 1, qty: 1 };
  c.appConfig = { cashiers: [{ id: 'CAJ-001', nombre: 'Ana' }, { id: 'CAJ-002', nombre: 'Ana' }, { id: 'CAJ-003', nombre: 'Luis' }] };
  c.ventas = [
    { id: 'a1', fecha: '2026-10-15', total: 10, cajeroId: 'CAJ-001', cajeroNombre: 'Ana', items: [item] },
    { id: 'a2', fecha: '2026-10-15', total: 5, cajeroId: 'CAJ-002', cajeroNombre: 'Ana', items: [item] },
    { id: 'a3', fecha: '2026-10-15', total: 7, cajeroId: 'CAJ-002', cajeroNombre: 'Ana', items: [item] },
    { id: 'l1', fecha: '2026-10-15', total: 3, cajeroId: 'CAJ-003', cajeroNombre: 'Luis', items: [item] },
  ];
  const rows = plain(c._naF8BuildReport({ from: '2026-10-15', to: '2026-10-15' }).cashiers);
  assert.deepEqual(rows.map(r => [r.name, r.sales, r.revenue]), [['Ana · CAJ-002', 2, 12], ['Ana · CAJ-001', 1, 10], ['Luis', 1, 3]]);
});

test('Arqueo: mismo nombre de usuarios distintos (ids de la réplica local) lleva sufijo; nombre único igual', () => {
  const snapshot = { cashSessions: [
    { session_id: 's1', opened_by_user_id: 'a1b2c3d4-0000-4000-8000-000000000001', opened_by_name: 'Rosa', closed_by_user_id: 'a1b2c3d4-0000-4000-8000-000000000001', closed_by_name: 'Rosa' },
    { session_id: 's2', opened_by_user_id: 'e5f6a7b8-0000-4000-8000-000000000002', opened_by_name: 'Rosa', closed_by_user_id: 'session:owner99', closed_by_name: 'Dueño' },
  ] };
  const ctx = vm.createContext({ module: { exports: {} }, NuevoAmanecerCanonical: { snapshot: () => snapshot } });
  vm.runInContext(source, ctx);
  vm.runInContext(read('POS/js/modules/reporte-arqueo.js'), ctx);
  // Respuesta del servidor: solo nombres; los ids salen de la réplica por session_id.
  const server = ['s1', 's2'].map((id, i) => ({ session_id: id, status: 'CLOSED', opened_at: '2026-10-10T13:00:00Z', closed_at: '2026-10-10T2' + i + ':00:00Z',
    expected_cents: 100, counted_cents: 100, difference_cents: 0, opened_by_name: 'Rosa', closed_by_name: i ? 'Dueño' : 'Rosa' }));
  const report = ctx.NA_REPORTE_ARQUEO.buildReport(server, { desde: '2026-10-01', hasta: '2026-10-16' });
  assert.deepEqual(plain(report.rows.map(r => [r.sessionId, r.openedByName, r.closedByName])),
    [['s2', 'Rosa · e5f6', 'Dueño'], ['s1', 'Rosa · a1b2', 'Rosa · a1b2']]);
  // Sin el módulo de etiquetas (o sin choque) los nombres quedan exactamente como antes.
  const bare = vm.createContext({ module: { exports: {} } });
  vm.runInContext(read('POS/js/modules/reporte-arqueo.js'), bare);
  assert.deepEqual(plain(bare.NA_REPORTE_ARQUEO.buildReport(server, { desde: '2026-10-01', hasta: '2026-10-16' }).rows.map(r => r.openedByName)), ['Rosa', 'Rosa']);
});

test('Historial del cliente: opciones del filtro Vendedor distintas para dos «Luis»', () => {
  const ventas = [
    { id: 'x1', clienteId: 'c1', fecha: '2026-10-15', total: 1, cajeroId: 'CAJ-001', cajeroNombre: 'Luis', items: [] },
    { id: 'x2', clienteId: 'c1', fecha: '2026-10-15', total: 1, cajeroId: 'CAJ-002', cajeroNombre: 'Luis', items: [] },
    { id: 'x3', clienteId: 'c1', fecha: '2026-10-15', total: 1, cajeroId: 'CAJ-003', cajeroNombre: 'Rosa', items: [] },
  ];
  const ctx = vm.createContext({ module: { exports: {} }, ventas, appConfig: { cashiers: [] } });
  vm.runInContext(source, ctx);
  vm.runInContext(read('POS/js/modules/cliente-historial-compras.js'), ctx);
  assert.deepEqual(plain(ctx.NA_CLIENTE_HISTORIAL.sellerOptions(ventas, 'c1')),
    [{ value: 'id:CAJ-001', label: 'Luis · CAJ-001' }, { value: 'id:CAJ-002', label: 'Luis · CAJ-002' }, { value: 'id:CAJ-003', label: 'Rosa' }]);
});
