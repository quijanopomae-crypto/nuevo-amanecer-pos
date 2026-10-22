import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

const source = readFileSync('POS/js/modules/cliente-historial-compras.js', 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function context(extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(source, ctx);
  return ctx;
}
const api = context().NA_CLIENTE_HISTORIAL;
const options = { days: 'all', now: '2026-10-16' };
const sale = (extra = {}) => ({ id: 'venta-prueba', clienteId: 'c1', fecha: '2026-10-15', cajeroId: 'v1', cajeroNombre: 'Ana', total: 10,
  items: [{ id: 'p1', name: 'Producto de prueba', qty: 1, subtotal: 10 }], ...extra });
const ids = rows => plain(rows.map(row => row.id));

test('date filters include both edges; empty bounds are unbounded and Desde posterior a Hasta is rejected without mutation', () => {
  const sales = Object.freeze([
    sale({ id: 'before', fecha: '2026-10-12' }), sale({ id: 'from', fecha: '2026-10-13' }),
    sale({ id: 'middle', fecha: '2026-10-14' }), sale({ id: 'to' }), sale({ id: 'after', fecha: '2026-10-16' })
  ].map(Object.freeze));
  const filters = Object.freeze({ from: '2026-10-13', to: '2026-10-15' });
  const before = JSON.stringify({ sales, filters });
  assert.deepEqual(ids(api.filterSales(sales, 'c1', filters)), ['from', 'middle', 'to']);
  assert.deepEqual(ids(api.filterSales(sales, 'c1', { from: filters.to, to: filters.from })), []);
  assert.equal(api.dateRange(filters.to, filters.from).invalid, true);
  assert.equal(api.dateRange(filters.from, filters.to).invalid, false);
  assert.equal(api.buildReport(sales, 'c1', { ...options, from: filters.to, to: filters.from }).sales.length, 0);
  assert.equal(api.filterSales(sales, 'c1', { from: '', to: '' }).length, 5);
  assert.deepEqual(ids(api.filterSales(sales, 'c1', { from: '2026-10-15' })), ['to', 'after']);
  assert.deepEqual(ids(api.filterSales(sales, 'c1', { to: '2026-10-13' })), ['before', 'from']);
  assert.deepEqual(ids(api.filterSales(sales, 'c1', { from: '2026-10-14', to: '2026-10-14' })), ['middle']);
  assert.equal(JSON.stringify({ sales, filters }), before);
});

test('date filters use fecha || timestamp and the Lima day across UTC midnight and Lima midnight', () => {
  const sales = [
    sale({ id: 'utc-next-day', fecha: '2026-10-16T04:30:00Z' }), // 15/10, 23:30 Lima.
    sale({ id: 'lima-offset', fecha: '2026-10-15T23:30:00-05:00' }),
    sale({ id: 'local-time', fecha: '2026-10-15T23:30:00' }),
    sale({ id: 'timestamp', fecha: '', timestamp: '2026-10-16T04:59:59Z' }),
    sale({ id: 'lima-next-day', fecha: '2026-10-16T05:00:00Z' }),
    sale({ id: 'fecha-wins', fecha: '2026-10-14', timestamp: '2026-10-16T04:30:00Z' }),
    sale({ id: 'invalid', fecha: 'invalid', timestamp: '2026-10-16T04:30:00Z' })
  ];
  const filters = { from: '2026-10-15', to: '2026-10-15' };
  assert.deepEqual(ids(api.filterSales(sales, 'c1', filters)), ['utc-next-day', 'lima-offset', 'local-time', 'timestamp']);
  assert.equal(api.buildReport(sales, 'c1', { ...options, ...filters }).purchases, 4);
});

test('seller options use recorded identity, distinct ids, legacy names and No registrado for this client only', () => {
  const sales = [sale(), sale({ cajeroNombre: 'Ana histórica' }), sale({ cajeroId: 'v2', cajeroNombre: 'Ana' }),
    sale({ cajeroId: undefined, cajeroNombre: '', cajero: 'Beatriz' }), sale({ cajeroId: undefined, cajeroNombre: 'Beatriz' }),
    sale({ cajeroId: 7, cajeroNombre: '', cajero: '' }), sale({ cajeroId: undefined, cajeroNombre: ' ' }),
    sale({ clienteId: 'c2', cajeroId: 'other', cajeroNombre: 'Otro cliente' }),
    sale({ anulada: true, cajeroId: 'void', cajeroNombre: 'Anulada' }), sale({ status: 'void', cajeroId: 'void2' }), null];
  assert.deepEqual(plain(api.sellerOptions(sales, 'c1')), [
    { value: 'id:7', label: '7' }, { value: 'id:v1', label: 'Ana' }, { value: 'id:v2', label: 'Ana' },
    { value: 'name:beatriz', label: 'Beatriz (sin id)' }, { value: 'missing:', label: 'No registrado' }
  ]);
  assert.deepEqual(plain(api.sellerOptions(sales, '')), []);
  assert.deepEqual(plain(api.sellerOptions(null, 'c1')), []);
  assert.equal(api.filterSales(sales, 'c1', { seller: 'id:v1' }).length, 2);
  assert.equal(api.filterSales(sales, 'c1', { seller: 'name:beatriz' }).length, 2);
  assert.equal(api.filterSales(sales, 'c1', { seller: 'missing:' }).length, 1);
  assert.equal(api.filterSales(sales, 'c1', { seller: 'id:7' }).length, 1);
  assert.equal(api.filterSales(sales, 'c1', { seller: 'id:other' }).length, 0);
  assert.equal(api.filterSales(sales, 'c1', { seller: '' }).length, 7);
});

test('combined filters apply before all report totals and product aggregation; Período no filtra', () => {
  const sales = [sale({ id: 'selected', total: 8, items: [{ id: 'p1', name: 'Producto elegido', qty: 2, subtotal: 8 }] }),
    sale({ id: 'wrong-seller', cajeroId: 'v2', total: 99 }), sale({ id: 'too-old', fecha: '2026-10-12', total: 88 }),
    sale({ id: 'wrong-client', clienteId: 'c2' }), sale({ id: 'void', anulada: true }),
    sale({ id: 'last-purchase-excluded', fecha: '2026-10-16', cajeroId: 'v2' })];
  const report = api.buildReport(sales, 'c1', { ...options, from: '2026-10-13', to: '2026-10-15', seller: 'id:v1' });
  assert.deepEqual(plain(report.sales.map(row => row.reference)), ['selected']);
  assert.equal(report.total, 8);
  assert.equal(report.purchases, 1);
  assert.equal(report.lastPurchase, '2026-10-15');
  assert.deepEqual(plain(report.products), [{ key: 'id:p1', name: 'Producto elegido', quantity: 2, amount: 8 }]);
  const oldSale = sale({ fecha: '2020-01-01' });
  // `days` ya no filtra: solo Desde/Hasta.
  assert.equal(api.buildReport([oldSale], 'c1', { ...options, days: 30, from: '2020-01-01' }).purchases, 1);
  assert.equal(api.buildReport([oldSale], 'c1', { ...options, from: '', to: '' }).purchases, 1);
  const empty = api.buildReport(sales, 'c1', { ...options, seller: 'id:absent' });
  assert.equal(empty.total, 0); assert.equal(empty.purchases, 0); assert.equal(empty.lastPurchase, '');
  assert.deepEqual(plain(empty.products), []);
});

test('CSV exports only filtered sales and products and guards every formula prefix, commas and quotes', () => {
  const sales = [sale({ id: 'included', comprobante: '=RECIBO', metodo: '@método', items: [{ id: 'p1', name: '-Producto, "prueba"', qty: 1, subtotal: 10 }] }),
    sale({ id: 'excluded-seller', cajeroId: 'v2', items: [{ id: 'p2', name: 'Producto excluido vendedor', qty: 1, subtotal: 99 }] }),
    sale({ id: 'excluded-date', fecha: '2026-10-12', items: [{ id: 'p3', name: 'Producto excluido fecha', qty: 1, subtotal: 88 }] })];
  const csv = api.toCsv(api.buildReport(sales, 'c1', { ...options, from: '2026-10-15', to: '2026-10-15', seller: 'id:v1' }));
  assert.match(csv, /"15\/10\/2026","'=RECIBO","10\.00","'@método"/);
  assert.ok(csv.includes('"\'-Producto, ""prueba""","1","10.00"'));
  assert.doesNotMatch(csv, /excluded|excluido/);
  for (const prefix of ['=', '+', '-', '@', '\t', '\r', '\n']) {
    assert.equal(api.csvCell(prefix + 'prueba'), '"\'' + prefix + 'prueba"');
  }
  assert.equal(api.csvCell('Seguro'), '"Seguro"');
  assert.equal(api.csvCell('a,b"c'), '"a,b""c"');
});

class Node {
  constructor() { this.children = []; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.hidden = false; this.disabled = false; this.dataset = {}; this.attrs = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  replaceChildren() { this.children = []; this.innerHTML = ''; }
  appendChild(node) { this.children.push(node); return node; }
  addEventListener(event, callback) { this[event] = callback; }
}
test('render and CSV button share current filters, reject inverted dates, default to the last 30 days and clear seller data on denied access', () => {
  const nodes = Object.fromEntries(['content', 'status', 'controls', 'search', 'customer', 'period', 'from', 'to', 'seller', 'export']
    .map(key => ['[data-ch-' + key + ']', new Node()]));
  for (const [key, value] of Object.entries({ customer: 'c1', period: 'all', from: '2026-10-13', to: '2026-10-15', seller: 'id:v1' })) {
    nodes['[data-ch-' + key + ']'].value = value;
  }
  const page = Object.assign(new Node(), { querySelector: s => nodes[s] || null, classList: { contains: () => true } });
  let owner = true, csv = '', clicks = 0;
  const ctx = context({ document: { readyState: 'loading', addEventListener() {}, getElementById: () => page,
    createElement: tag => tag === 'a' ? { click() { clicks++; }, remove() {} } : new Node() },
    NA_ROLES: { isOwner: () => owner, get role() { return owner ? 'owner' : 'empleado'; } }, NA_PERMISSIONS: PERMISSIONS, addEventListener() {}, setTimeout(callback) { callback(); },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }, Blob: class { constructor(parts) { csv = parts.join(''); } },
    clientes: [Object.freeze({ id: 'c1', nombre: 'Cliente de prueba' }), Object.freeze({ id: 'c2', nombre: 'Otro cliente' })],
    ventas: Object.freeze([Object.freeze(sale({ id: 'included' })), Object.freeze(sale({ id: 'excluded', cajeroId: 'v2', cajeroNombre: '<Vendedor>' }))]) });
  ctx.NA_CLIENTE_HISTORIAL.init();
  assert.equal(nodes['[data-ch-from]'].value, '2026-10-13'); // No pisa valores ya elegidos.
  assert.equal(nodes['[data-ch-to]'].value, '2026-10-15');
  assert.match(nodes['[data-ch-content]'].innerHTML, /included/);
  assert.doesNotMatch(nodes['[data-ch-content]'].innerHTML, /excluded/);
  assert.match(nodes['[data-ch-seller]'].innerHTML, /&lt;Vendedor&gt;/);
  assert.equal(nodes['[data-ch-export]'].disabled, false);
  nodes['[data-ch-export]'].click();
  assert.equal(clicks, 1); assert.match(csv, /included/); assert.doesNotMatch(csv, /excluded/);
  nodes['[data-ch-seller]'].value = 'id:v2';
  nodes['[data-ch-export]'].click(); // Relee los filtros aunque todavía no haya evento change.
  assert.equal(clicks, 2); assert.match(csv, /excluded/); assert.doesNotMatch(csv, /included/);
  nodes['[data-ch-from]'].value = '2026-10-16'; nodes['[data-ch-to]'].value = '2026-10-15';
  ctx.NA_CLIENTE_HISTORIAL.render();
  assert.match(nodes['[data-ch-status]'].textContent, /no puede ser posterior/);
  assert.equal(nodes['[data-ch-from]'].attrs['aria-invalid'], 'true');
  assert.equal(nodes['[data-ch-export]'].disabled, true);
  assert.equal(nodes['[data-ch-content]'].innerHTML, '');
  nodes['[data-ch-from]'].value = '2026-10-13';
  nodes['[data-ch-customer]'].value = 'c2';
  ctx.NA_CLIENTE_HISTORIAL.render();
  assert.equal(nodes['[data-ch-seller]'].value, '');
  assert.equal(nodes['[data-ch-seller]'].innerHTML, '<option value="">Todos</option>');
  owner = false;
  for (const key of ['clientes', 'ventas']) Object.defineProperty(ctx, key, { get() { throw new Error('unauthorized read'); } });
  nodes['[data-ch-export]'].click();
  assert.equal(clicks, 2);
  assert.equal(nodes['[data-ch-seller]'].innerHTML, '');
  assert.equal(nodes['[data-ch-export]'].disabled, true);
  assert.equal(nodes['[data-ch-content]'].innerHTML, '');
});

test('empty date inputs default once to the last 30 Lima days', () => {
  const nodes = Object.fromEntries(['content', 'status', 'controls', 'search', 'customer', 'period', 'from', 'to', 'seller', 'export']
    .map(key => ['[data-ch-' + key + ']', new Node()]));
  const page = Object.assign(new Node(), { querySelector: s => nodes[s] || null, classList: { contains: () => true } });
  const ctx = context({ document: { readyState: 'loading', addEventListener() {}, getElementById: () => page, createElement: () => new Node() },
    NA_ROLES: { isOwner: () => true, role: 'owner' }, NA_PERMISSIONS: PERMISSIONS, addEventListener() {}, clientes: [], ventas: [] });
  ctx.NA_CLIENTE_HISTORIAL.render();
  const expected = api.periodRange(30);
  assert.equal(nodes['[data-ch-from]'].value, expected.from);
  assert.equal(nodes['[data-ch-to]'].value, expected.to);
  nodes['[data-ch-from]'].value = ''; nodes['[data-ch-to]'].value = '';
  ctx.NA_CLIENTE_HISTORIAL.render(); // El usuario puede vaciarlas: sin límite.
  assert.equal(nodes['[data-ch-from]'].value, '');
});

function screen({ role = 'owner', ventas = [], clientes = [{ id: 'c1', nombre: 'Cliente de prueba' }] } = {}) {
  const keys = ['content', 'status', 'controls', 'search', 'customer', 'period', 'from', 'to', 'date-hint', 'seller', 'export'];
  const nodes = Object.fromEntries(keys.map(key => {
    const node = new Node(); node.selector = '[data-ch-' + key + ']'; node.matches = s => s.split(/,\s*/).includes(node.selector);
    return [node.selector, node];
  }));
  nodes['[data-ch-customer]'].value = 'c1';
  nodes['[data-ch-period]'].value = '30';
  const page = Object.assign(new Node(), { querySelector: s => nodes[s] || null, classList: { contains: () => true } });
  let csv = '', clicks = 0;
  const ctx = context({ document: { readyState: 'loading', addEventListener() {}, getElementById: () => page,
    createElement: tag => tag === 'a' ? { click() { clicks++; }, remove() {} } : new Node() },
    NA_ROLES: { isOwner: () => role === 'owner', role }, NA_PERMISSIONS: PERMISSIONS, addEventListener() {}, setTimeout(callback) { callback(); },
    URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }, Blob: class { constructor(parts) { csv = parts.join(''); } },
    clientes, ventas });
  ctx.NA_CLIENTE_HISTORIAL.init();
  const change = key => page.change({ target: nodes['[data-ch-' + key + ']'] });
  return { ctx, nodes, page, change, csv: () => csv, clicks: () => clicks };
}
const daysAgo = n => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);

test('Sin límite de fechas is rendered below the dates and visible only for Todo, including when Personalizado has empty dates', () => {
  const markup = readFileSync('POS/index.html', 'utf8');
  assert.match(markup, /data-ch-to[^>]*>\s*<\/label>\s*<p class="ch-date-hint" data-ch-date-hint hidden>Sin límite de fechas<\/p>/);
  const s = screen();
  const hint = s.nodes['[data-ch-date-hint]'];
  assert.equal(hint.hidden, true);
  s.nodes['[data-ch-period]'].value = 'all'; s.change('period');
  assert.equal(s.nodes['[data-ch-from]'].value, '');
  assert.equal(s.nodes['[data-ch-to]'].value, '');
  assert.equal(hint.hidden, false);
  s.ctx.NA_CLIENTE_HISTORIAL.render();
  assert.equal(hint.hidden, false);
  s.nodes['[data-ch-period]'].value = 'custom'; s.change('period');
  assert.equal(s.nodes['[data-ch-from]'].value, '');
  assert.equal(s.nodes['[data-ch-to]'].value, '');
  assert.equal(hint.hidden, true);
  for (const value of ['30', '90', '365']) {
    s.nodes['[data-ch-period]'].value = 'all'; s.change('period');
    assert.equal(hint.hidden, false);
    s.nodes['[data-ch-period]'].value = value; s.change('period');
    assert.equal(hint.hidden, true);
  }
});

test('Período is only a shortcut: it fills Desde/Hasta, a manual edit switches to Personalizado and Todo clears both', () => {
  const s = screen();
  const p30 = api.periodDates('30');
  assert.equal(s.nodes['[data-ch-from]'].value, p30.from);
  assert.equal(s.nodes['[data-ch-to]'].value, p30.to);
  s.nodes['[data-ch-period]'].value = '90'; s.change('period');
  assert.equal(s.nodes['[data-ch-from]'].value, api.periodDates('90').from);
  assert.equal(s.nodes['[data-ch-period]'].value, '90');
  s.nodes['[data-ch-from]'].value = daysAgo(10); s.change('from');
  assert.equal(s.nodes['[data-ch-period]'].value, 'custom');
  s.nodes['[data-ch-period]'].value = 'all'; s.change('period');
  assert.equal(s.nodes['[data-ch-from]'].value, '');
  assert.equal(s.nodes['[data-ch-to]'].value, '');
  assert.equal(s.nodes['[data-ch-period]'].value, 'all');
  assert.match(s.nodes['[data-ch-status]'].textContent, /^Todo el historial/);
  // Elegir «Personalizado» no toca las fechas.
  s.nodes['[data-ch-from]'].value = daysAgo(5); s.change('from');
  s.nodes['[data-ch-period]'].value = 'custom'; s.change('period');
  assert.equal(s.nodes['[data-ch-from]'].value, daysAgo(5));
  // Fechas que coinciden con un atajo vuelven a mostrar ese atajo: nunca se contradicen.
  s.nodes['[data-ch-from]'].value = p30.from; s.nodes['[data-ch-to]'].value = p30.to; s.change('to');
  assert.equal(s.nodes['[data-ch-period]'].value, '30');
  assert.equal(api.periodFor('2020-01-01', p30.to), 'custom');
});

test('Desde 90 days back wins over a 30-day Período: all 90 days are shown and the status shows only the date range', () => {
  const ventas = [0, 45, 89, 90, 120].map(n => sale({ id: 'd' + n, fecha: daysAgo(n) }));
  const s = screen({ ventas });
  assert.equal(s.nodes['[data-ch-period]'].value, '30');
  const html = () => s.nodes['[data-ch-content]'].innerHTML;
  assert.doesNotMatch(html(), /d45/);
  s.nodes['[data-ch-from]'].value = daysAgo(89); // 90 días contando hoy, con «Período» aún en 30 antes del cambio.
  s.change('from');
  for (const id of ['d0', 'd45', 'd89']) assert.match(html(), new RegExp(id));
  for (const id of ['d90', 'd120']) assert.doesNotMatch(html(), new RegExp(id + '\\b'));
  assert.equal(s.nodes['[data-ch-period]'].value, '90');
  assert.match(s.nodes['[data-ch-status]'].textContent, /^Desde \d{2}\/\d{2}\/\d{4} · Hasta \d{2}\/\d{2}\/\d{4} · hora de Lima/);
  assert.equal(api.buildReport(ventas, 'c1', { days: 30, from: daysAgo(89), to: daysAgo(0) }).purchases, 3);
});

test('sellers with id and name-only sales are grouped under the id, matching names case-insensitively and trimmed', () => {
  const ventas = [sale({ id: 'a1', cajeroId: 'v1', cajeroNombre: 'Ana Pérez' }), sale({ id: 'a2', cajeroId: undefined, cajeroNombre: '  ana   PÉREZ ' }),
    sale({ id: 'a3', cajeroId: undefined, cajeroNombre: '', cajero: 'Ana Pérez' }),
    sale({ id: 'b1', cajeroId: undefined, cajeroNombre: 'Beatriz' }), sale({ id: 'b2', cajeroId: undefined, cajeroNombre: ' BEATRIZ' }),
    sale({ id: 'x1', cajeroId: 'x1', cajeroNombre: 'Dup' }), sale({ id: 'x2', cajeroId: 'x2', cajeroNombre: 'dup' }), sale({ id: 'x3', cajeroId: undefined, cajeroNombre: 'Dup' })];
  assert.deepEqual(plain(api.sellerOptions(ventas, 'c1')), [
    { value: 'id:v1', label: 'Ana Pérez' }, { value: 'name:beatriz', label: 'Beatriz (sin id)' },
    { value: 'id:x2', label: 'dup' }, { value: 'id:x1', label: 'Dup' }, { value: 'name:dup', label: 'Dup (sin id)' }
  ]);
  assert.deepEqual(ids(api.filterSales(ventas, 'c1', { seller: 'id:v1' })), ['a1', 'a2', 'a3']);
  assert.deepEqual(ids(api.filterSales(ventas, 'c1', { seller: 'name:beatriz' })), ['b1', 'b2']);
  // Un nombre con dos ids distintos es ambiguo: no se adivina.
  assert.deepEqual(ids(api.filterSales(ventas, 'c1', { seller: 'name:dup' })), ['x3']);
});

test('CSV starts with Cliente/Desde/Hasta/Vendedor, then the header, guarding every cell', () => {
  const ventas = [sale({ id: 'v-ok', fecha: daysAgo(1), cajeroNombre: '=Ana' })];
  const s = screen({ ventas, clientes: [{ id: 'c1', nombre: '@Cliente "raro"' }] });
  s.nodes['[data-ch-seller]'].value = 'id:v1';
  assert.equal(s.ctx.NA_CLIENTE_HISTORIAL.exportCsv(), true);
  const lines = s.csv().replace(/^\ufeff/, '').split('\r\n');
  const p30 = api.periodDates('30'), label = d => d.split('-').reverse().join('/');
  assert.equal(lines[0], `"Cliente: @Cliente ""raro""","Desde: ${label(p30.from)}","Hasta: ${label(p30.to)}","Vendedor: =Ana"`);
  assert.equal(lines[1], '"Fecha","Comprobante / ID","Total","Método de pago"');
  assert.match(lines[2], /v-ok/);
  assert.equal(api.csvCell('=1'), `"'=1"`);
  assert.match(api.toCsv({ sales: [], products: [] }, { cliente: '+x', vendedor: '-y' }), /^\ufeff"Cliente: \+x".*"Vendedor: -y"/);
  s.nodes['[data-ch-from]'].value = ''; s.nodes['[data-ch-to]'].value = ''; s.nodes['[data-ch-seller]'].value = '';
  s.ctx.NA_CLIENTE_HISTORIAL.exportCsv();
  assert.match(s.csv(), /"Desde: sin límite","Hasta: sin límite","Vendedor: Todos"/);
});

test('non-owner: no CSV button is shown and the export function refuses', () => {
  const s = screen({ role: 'empleado', ventas: [sale()] });
  assert.equal(s.nodes['[data-ch-export]'].hidden, true);
  assert.equal(s.nodes['[data-ch-export]'].disabled, true);
  assert.equal(s.ctx.NA_CLIENTE_HISTORIAL.exportAllowed(), false);
  assert.equal(s.ctx.NA_CLIENTE_HISTORIAL.exportCsv(), false);
  s.nodes['[data-ch-export]'].click?.();
  assert.equal(s.clicks(), 0); assert.equal(s.csv(), '');
  // Dueño por isOwner pero con un rol que FEATURE_ROLES no permite: tampoco.
  const odd = screen({ role: 'invitado', ventas: [sale()] });
  assert.equal(odd.ctx.NA_CLIENTE_HISTORIAL.exportAllowed(), false);
  const owner = screen({ role: 'owner', ventas: [sale({ fecha: daysAgo(1) })] });
  assert.equal(owner.nodes['[data-ch-export]'].hidden, false);
  assert.equal(owner.ctx.NA_CLIENTE_HISTORIAL.exportCsv(), true);
});

test('choosing Personalizado keeps the dates, focuses Desde and stays until a date is edited', () => {
  const s = screen();
  const p30 = api.periodDates('30');
  let focused = 0; s.nodes['[data-ch-from]'].focus = () => { focused++; };
  s.nodes['[data-ch-period]'].value = 'custom'; s.change('period');
  assert.equal(focused, 1);
  assert.equal(s.nodes['[data-ch-from]'].value, p30.from);
  assert.equal(s.nodes['[data-ch-to]'].value, p30.to);
  assert.equal(s.nodes['[data-ch-period]'].value, 'custom');
  s.ctx.NA_CLIENTE_HISTORIAL.render(); s.ctx.NA_CLIENTE_HISTORIAL.render();
  assert.equal(s.nodes['[data-ch-period]'].value, 'custom');
  s.change('seller'); // Otros filtros no lo deshacen.
  assert.equal(s.nodes['[data-ch-period]'].value, 'custom');
  // Tras editar una fecha vuelve la derivación normal.
  s.nodes['[data-ch-from]'].value = api.periodDates('90').from; s.change('from');
  assert.equal(s.nodes['[data-ch-period]'].value, '90');
  s.nodes['[data-ch-period]'].value = 'custom'; s.change('period');
  s.nodes['[data-ch-period]'].value = '30'; s.change('period'); // Un atajo también lo libera.
  assert.equal(s.nodes['[data-ch-period]'].value, '30');
  assert.equal(s.nodes['[data-ch-from]'].value, p30.from);
});

// Texto visible del filtro «Vendedor» (select angosto): acorta el NOMBRE de un nombre repetido y largo, nunca el sufijo.
const labelsSource = readFileSync('POS/js/core/seller-labels.js', 'utf8');
function sellerTexts(sales, setup) {
  const ctx = vm.createContext({ ventas: sales });
  if (setup) vm.runInContext(setup, ctx);
  vm.runInContext(labelsSource, ctx);
  vm.runInContext(source, ctx);
  const opts = ctx.NA_CLIENTE_HISTORIAL.sellerOptions(sales, 'c1');
  return plain(opts.map((item, i) => [item.value, ctx.NA_CLIENTE_HISTORIAL.sellerOptionTexts(opts)[i]]));
}
const ID_C = 'a1b2c3d4-0000-4000-8000-000000000001', ID_D = 'a1b2d5e6-0000-4000-8000-000000000002';

test('Vendedor: nombre en NFD se acorta por grafema y en NFC; igual sin Intl.Segmenter o si falla', () => {
  const nfd = 'María Fernanda Quispe'.normalize('NFD');
  assert.notEqual(nfd, 'María Fernanda Quispe');
  const sales = [sale({ id: 's1', cajeroId: ID_C, cajeroNombre: nfd }), sale({ id: 's2', cajeroId: ID_D, cajeroNombre: nfd }), sale({ id: 's3', cajeroId: 'v9', cajeroNombre: 'Luis' })];
  const expected = { ['id:' + ID_C]: 'María Fer… · a1b2c', ['id:' + ID_D]: 'María Fer… · a1b2d', 'id:v9': 'Luis' };
  assert.deepEqual(Object.fromEntries(sellerTexts(sales)), expected);
  assert.deepEqual(Object.fromEntries(sellerTexts(sales, 'delete Intl.Segmenter;')), expected);
  assert.deepEqual(Object.fromEntries(sellerTexts(sales, 'Intl.Segmenter = function () { throw new Error("roto"); };')), expected);
});

test('Vendedor: si dos opciones distintas quedarían iguales al acortar, se muestran completas', () => {
  const ID_C2 = 'a1b2c999-0000-4000-8000-000000000003', ID_D2 = 'a1b2d999-0000-4000-8000-000000000004';
  const sales = [
    sale({ id: 's1', cajeroId: ID_C, cajeroNombre: 'María Fernanda Quispe' }), sale({ id: 's2', cajeroId: ID_D, cajeroNombre: 'María Fernanda Quispe' }),
    sale({ id: 's3', cajeroId: ID_C2, cajeroNombre: 'María Ferreyra López' }), sale({ id: 's4', cajeroId: ID_D2, cajeroNombre: 'María Ferreyra López' }),
    sale({ id: 's5', cajeroId: 'v7', cajeroNombre: 'Rosario Elena Paredes' }), sale({ id: 's6', cajeroId: 'v8', cajeroNombre: 'Rosario Elena Paredes' })
  ];
  const texts = Object.fromEntries(sellerTexts(sales));
  assert.equal(texts['id:' + ID_C], 'María Fernanda Quispe · a1b2c');
  assert.equal(texts['id:' + ID_D], 'María Fernanda Quispe · a1b2d');
  assert.equal(texts['id:' + ID_C2], 'María Ferreyra López · a1b2c');
  assert.equal(texts['id:' + ID_D2], 'María Ferreyra López · a1b2d');
  // Las que no chocan se siguen acortando.
  assert.equal(texts['id:v7'], 'Rosario E… · v7');
  assert.equal(texts['id:v8'], 'Rosario E… · v8');
  assert.equal(new Set(Object.values(texts)).size, Object.keys(texts).length);
});

test('Vendedor: con medidor, quita grafemas hasta que entra; sufijo entero y mínimo 1 grafema; sin choque', () => {
  const ctx = vm.createContext({ ventas: [sale({ id: 's1', cajeroId: ID_C, cajeroNombre: 'María Fernanda Quispe' }), sale({ id: 's2', cajeroId: ID_D, cajeroNombre: 'María Fernanda Quispe' })] });
  vm.runInContext(labelsSource, ctx); vm.runInContext(source, ctx);
  const opts = ctx.NA_CLIENTE_HISTORIAL.sellerOptions(ctx.ventas, 'c1'), width = value => Array.from(value).length * 7;
  for (const room of [500, 140, 100, 20]) {
    const texts = plain(ctx.NA_CLIENTE_HISTORIAL.sellerOptionTexts(opts, { room, width }));
    texts.forEach((text, i) => {
      const suffix = opts[i].label.slice(opts[i].label.lastIndexOf(' · '));
      if (room === 500) { assert.equal(text, opts[i].label); return; }
      assert.ok(text.endsWith('…' + suffix), text);
      const prefix = text.slice(0, -suffix.length - 1);
      assert.ok(prefix.length >= 1 && 'María Fernanda Quispe'.startsWith(prefix), text);
      if (room >= 100) assert.ok(width(text) <= room, text + ' cabe en ' + room);
      else assert.equal(prefix, 'M', 'mínimo 1 grafema');
    });
    assert.equal(new Set(texts).size, texts.length);
  }
});
