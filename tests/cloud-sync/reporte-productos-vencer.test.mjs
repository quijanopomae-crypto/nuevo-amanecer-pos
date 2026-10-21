import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

const read = path => readFileSync(path, 'utf8');
const source = read('POS/js/modules/reporte-productos-vencer.js');
const plain = value => JSON.parse(JSON.stringify(value));
const unlocked = { ...PERMISSIONS, featureLocked: id => id === 'reporte-productos-vencer' ? false : PERMISSIONS.featureLocked(id) };
function context(extra = {}) {
  const ctx = vm.createContext(extra);
  vm.runInContext(read('POS/js/inventory/stock-lots.js'), ctx);
  vm.runInContext(source, ctx);
  return ctx;
}
const api = context().NA_REPORTE_PRODUCTOS_VENCER;
const now = '2026-10-16T04:59:59Z'; // Todavía 15 de octubre en Lima.
const lot = (lot_id, expiry_date, quantity = 5) => ({ lot_id, lot_code: lot_id, expiry_date, quantity });
const products = [
  { product_id: 'b', name: 'Producto B', lots: [lot('day31', '2026-11-15'), lot('expired-new', '2026-10-14'), lot('day90', '2027-01-13'), lot('day60', '2026-12-14')] },
  { id: 'a', nombre: 'Producto A', lots: [lot('day30', '2026-11-14'), lot('today-z', '2026-10-15'), lot('expired-old', '2026-09-01'), lot('day61', '2026-12-15'), lot('day91', '2027-01-14'), lot('today-a', '2026-10-15')] }
];
const ids = report => Array.from(report.rows, row => row.lot_id);

test('default horizon 30 includes expired first, today and last day; FEFO order has deterministic ties', () => {
  const report = api.buildReport(products, { now });
  assert.deepEqual(plain(report.range), { days: 30, today: '2026-10-15', through: '2026-11-14' });
  assert.deepEqual(ids(report), ['expired-old', 'expired-new', 'today-a', 'today-z', 'day30']);
  assert.equal(report.expired, 2);
  assert.deepEqual(Array.from(report.rows, row => row.days), [-44, -1, 0, 0, 30]);
  assert.deepEqual(Array.from(report.rows, row => row.expired), [true, true, false, false, false]);
  assert.deepEqual(plain(api.buildReport(products.slice().reverse().map(p => ({ ...p, lots: p.lots.slice().reverse() })), { now })), plain(report));
});

test('30/60/90 are inclusive, exclude later lots and preserve all expired lots for every horizon', () => {
  assert.deepEqual(ids(api.buildReport(products, { days: '60', now })), ['expired-old', 'expired-new', 'today-a', 'today-z', 'day30', 'day31', 'day60']);
  assert.deepEqual(ids(api.buildReport(products, { days: 90, now })), ['expired-old', 'expired-new', 'today-a', 'today-z', 'day30', 'day31', 'day60', 'day61', 'day90']);
  for (const value of [null, 0, 45, 'expired', 'invalid']) assert.equal(api.horizonRange(value, now).days, 30);
});

test('days remaining use Lima midnight independently of machine timezone, with leap day and date-only lots', () => {
  const before = api.buildReport([{ id: 'a', lots: [lot('date', '2026-10-15')] }], { now });
  const after = api.buildReport([{ id: 'a', lots: [lot('date', '2026-10-15')] }], { now: '2026-10-16T05:00:00Z' });
  assert.equal(before.rows[0].days, 0);
  assert.equal(after.rows[0].days, -1);
  assert.equal(api.horizonRange(30, Date.parse(now)).today, '2026-10-15');
  assert.equal(api.horizonRange(30, '2026-10-16T01:00:00+02:00').today, '2026-10-15');
  assert.equal(api.horizonRange(30, '2026-10-15').today, '2026-10-15');
  const leap = api.buildReport([{ id: 'a', lots: [lot('leap', '2024-03-01')] }], { now: '2024-02-28T23:00:00-05:00' });
  assert.equal(leap.rows[0].days, 2);
  assert.throws(() => api.horizonRange(30, 'invalid'), /INVALID_LOT_DATE/);
});

test('existing lots and lots_json helpers are reused; malformed dates/rows and exhausted lots are omitted', () => {
  const report = api.buildReport([null, { id: 'bad', lots_json: 'invalid' }, { id: 'empty' },
    { id: 'json', nombre: 'Lotes JSON', lots_json: JSON.stringify([lot('json', '2026-10-16', 1.25)]) },
    { id: 'array', lots: [null, lot('zero', '2026-10-15', 0), lot('negative', '2026-10-15', -1),
      lot('nan', '2026-10-15', NaN), lot('infinite', '2026-10-15', Infinity), lot('invalid', '2026-02-30'),
      lot('no-date', ''), lot('string-stock', '2026-10-15', '5')] }], { now });
  assert.deepEqual(ids(report), ['json']);
  assert.equal(report.rows[0].quantity, 1.25);
  assert.equal(report.rows[0].name, 'Lotes JSON');
  assert.equal(api.buildReport(null, { now }).rows.length, 0);
});

test('frozen lot inputs remain unchanged; returned rows are detached from stock and pending operations', () => {
  const input = Object.freeze([Object.freeze({ id: 'a', name: 'Frozen', lots: Object.freeze([Object.freeze(lot('frozen', '2026-10-16'))]) })]);
  const before = JSON.stringify(input);
  const report = api.buildReport(input, { now });
  report.rows[0].quantity = 99;
  assert.equal(JSON.stringify(input), before);
});

test('CSV first row describes the active filter and Lima range; columns match UI, negatives remain numeric', () => {
  const csv = api.toCsv(api.buildReport(products, { now, days: 60 }));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(lines[0], 'Filtro: próximos 60 días (15/10/2026 al 14/12/2026) + vencidos · día de Lima');
  assert.equal(lines[1], 'Producto,Lote,Fecha vencimiento,Días restantes,Stock');
  assert.equal(lines[2], 'Producto A,expired-old,01/09/2026,-44,5');
  assert.equal(lines.at(-1), '');
});

test('CSV formula guard covers = + @ tab CR LF - and leading spaces; quotes, commas and lines round-trip', () => {
  for (const prefix of ['=', '+', '@', '\t', '\r', '\n', '-']) {
    for (const spaces of ['', '  ']) {
      const raw = spaces + prefix + 'formula,"texto"';
      const cell = api.csvCell(raw);
      assert.equal(cell, '"\'' + raw.replace(/"/g, '""') + '"');
    }
  }
  assert.equal(api.csvCell(-1), '-1');
  assert.equal(api.csvCell('Producto'), 'Producto');
  assert.equal(api.csvCell(null), '');
  const malicious = api.buildReport([{ id: 'a', name: '\n=1+1', lots: [{ ...lot('code', '2026-10-15'), lot_code: '\t+1' }] }], { now });
  assert.ok(api.toCsv(malicious).includes('"\'\n=1+1",\'\t+1,15/10/2026,0,5'));
});

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.value = ''; this.hidden = false; this._text = ''; this.classList = { contains: () => true }; }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  setAttribute(key, value) { this.attrs[key] = value; }
  set innerHTML(_) { throw new Error('Product text must never become HTML'); }
}
function harness(extra = {}) {
  const content = new Node(), status = new Node(), controls = new Node(), horizon = new Node();
  horizon.value = '30';
  const nodes = { '[data-rpv-content]': content, '[data-rpv-status]': status, '[data-rpv-controls]': controls, '[data-rpv-horizon]': horizon };
  const page = { querySelector: selector => nodes[selector] || null };
  const ctx = context({ document: { readyState: 'loading', addEventListener() {}, getElementById: () => page, createElement: tag => new Node(tag) },
    NA_ROLES: { isOwner: () => true }, NA_PERMISSIONS: unlocked,
    fetch() { throw new Error('No network'); }, localStorage: { setItem() { throw new Error('No writes'); } }, ...extra });
  return { ctx, api: ctx.NA_REPORTE_PRODUCTOS_VENCER, content, status, controls, horizon };
}
test('literal text render reads the already-built lot projection without rebuild, stock mutations or network', () => {
  const name = '<img src=x onerror=alert(1)> & "Producto"';
  const code = '<script>lot</script>';
  const today = api.horizonRange(30).today;
  const base = [{ id: 'base', name: 'Base stock', lots: [lot('base', today, 20)] }];
  const projection = { products: [{ id: 'projected', name, lots: [{ ...lot('lot', today, 3), lot_code: code }] }] };
  const pending = [{ operation_id: 'synthetic-pending', payload: { quantity: 17 } }];
  const before = JSON.stringify({ base, projection, pending });
  const h = harness({ NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => base },
    NuevoAmanecerCanonicalSaleView: { lastView: () => projection, rebuild() { throw new Error('Read-only report cannot rebuild'); } },
    NA_STOCK_LOTS_UI: { currentProducts() { throw new Error('Mutating helper'); } },
    NuevoAmanecerCanonicalSaleOutbox: { snapshot() { throw new Error('Pending data need not be read'); } } });
  assert.equal(h.api.render(), true);
  assert.ok(h.content.textContent.includes(name));
  assert.ok(h.content.textContent.includes(code));
  assert.ok(!h.content.textContent.includes('Base stock'));
  const walk = node => [node, ...node.children.flatMap(walk)];
  assert.equal(walk(h.content).filter(n => ['img', 'script'].includes(n.tagName)).length, 0);
  const headers = walk(h.content).filter(n => n.scope === 'col');
  assert.deepEqual(headers.filter(n => n.className === 'rpv-num').map(n => n.textContent), ['Días restantes', 'Stock']);
  assert.equal(JSON.stringify({ base, projection, pending }), before);
  h.ctx.NA_ROLES = { isOwner: () => false };
  Object.defineProperty(h.ctx, 'NuevoAmanecerCanonical', { get() { throw new Error('Unauthorized state read'); } });
  assert.equal(h.api.render(), false);
  assert.equal(h.content.children.length, 0);
  assert.equal(h.controls.hidden, true);
  assert.match(h.status.textContent, /Sin permiso/);
  assert.equal(h.api.exportCsv(), false);
});

test('read-only fallback uses canonical snapshot or in-memory products, including lots_json', () => {
  const today = api.horizonRange(30).today;
  const data = [{ id: 'a', name: 'Snapshot product', lots_json: JSON.stringify([lot('a', today)]) }];
  for (const extra of [
    { NuevoAmanecerCanonical: { enabled: () => true, snapshot: () => ({ products: data }) }, productos: [] },
    { productos: data }
  ]) {
    const h = harness(extra);
    assert.equal(h.api.render(), true);
    assert.match(h.content.textContent, /Snapshot product/);
  }
});

test('owner export reads the active horizon and creates only a download; permission is rechecked on every export', () => {
  const h = harness({ productos: [{ id: 'a', name: '=Producto', lots: [lot('export', api.horizonRange(30).today)] }] });
  const blobs = [], revoked = [];
  let clicked = 0, removed = 0;
  h.horizon.value = '90';
  h.ctx.document.createElement = tag => {
    assert.equal(tag, 'a');
    return { click() { clicked++; }, remove() { removed++; } };
  };
  h.ctx.document.getElementById = () => ({ querySelector: selector => selector === '[data-rpv-horizon]' ? h.horizon : null, appendChild() {} });
  h.ctx.Blob = class { constructor(parts, options) { this.parts = parts; this.options = options; } };
  h.ctx.URL = { createObjectURL(blob) { blobs.push(blob); return 'blob:synthetic'; }, revokeObjectURL(url) { revoked.push(url); } };
  h.ctx.setTimeout = fn => fn();
  assert.equal(h.api.exportCsv(), true);
  assert.equal(clicked, 1);
  assert.equal(removed, 1);
  assert.deepEqual(revoked, ['blob:synthetic']);
  assert.match(blobs[0].parts[0], /^\uFEFFFiltro: próximos 90 días/);
  assert.ok(blobs[0].parts[0].includes("\r\n'=Producto,export,"));
  assert.equal(blobs[0].options.type, 'text/csv;charset=utf-8');
  h.ctx.NA_PERMISSIONS = { ...PERMISSIONS, featureLocked: () => true };
  assert.equal(h.api.exportCsv(), false);
  assert.equal(blobs.length, 1);
});

test('owner/permission guard fails closed and locked default denies both rendering and CSV before state reads', () => {
  assert.deepEqual(Array.from(PERMISSIONS.SCREENS.pageReporteProductosVencer), ['owner']);
  assert.deepEqual(Array.from(PERMISSIONS.FEATURE_ROLES['reporte-productos-vencer']), ['owner']);
  // Misión 4: desbloqueada en Próximamente; el rol dueño sigue siendo obligatorio.
  assert.equal(PERMISSIONS.FEATURE_LOCKS['reporte-productos-vencer'], false);
  assert.equal(PERMISSIONS.featureLocked('reporte-productos-vencer'), false);
  for (const role of ['empleado', 'unknown', '', null]) assert.equal(PERMISSIONS.canAccessScreen(role, 'pageReporteProductosVencer'), false);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(Array.from(PERMISSIONS.routeRoles('/features/reporte-productos-vencer', method)), ['owner']);
  const locked = { ...PERMISSIONS, featureLocked: id => id === 'reporte-productos-vencer' ? true : PERMISSIONS.featureLocked(id) };
  for (const extra of [{ NA_PERMISSIONS: locked }, { NA_ROLES: undefined }, { NA_PERMISSIONS: undefined },
    { NA_ROLES: { role: 'owner', confirmed: false } }, { NA_ROLES: { isOwner: () => false } },
    { NA_PERMISSIONS: { ...unlocked, canAccessScreen: () => false } }]) {
    const h = harness(extra);
    Object.defineProperty(h.ctx, 'productos', { get() { throw new Error('Denied state read'); } });
    Object.defineProperty(h.ctx, 'NuevoAmanecerCanonical', { get() { throw new Error('Denied canonical read'); } });
    assert.equal(h.api.render(), false);
    assert.equal(h.api.exportCsv(), false);
    assert.equal(h.controls.hidden, true);
    assert.equal(h.content.children.length, 0);
  }
});

test('registry entry is unlocked (not pending) with the new page; navigation denies employees without adding drawer items; assets precache', () => {
  const ctx = context();
  vm.runInContext(read('POS/js/modules/proximamente-registry.js'), ctx);
  const entry = ctx.NA_PROXIMAMENTE_REGISTRY.find(f => f.id === 'reporte-productos-vencer');
  assert.equal(entry.page, 'pageReporteProductosVencer');
  assert.equal(entry.pending, undefined);
  const navigation = read('POS/js/navigation/menu-navigation.js');
  const c = vm.createContext({ document: { readyState: 'loading', addEventListener() {} }, innerWidth: 390 });
  c.window = c;
  vm.runInContext(navigation, c);
  assert.ok(c.NA_MENU_NAVIGATION.pages.includes('pageReporteProductosVencer'));
  for (const permissions of [undefined, PERMISSIONS]) {
    c.NA_PERMISSIONS = permissions;
    for (const roles of [undefined, { role: 'owner' }, { isOwner: () => false }]) {
      c.NA_ROLES = roles;
      assert.equal(c.NA_MENU_NAVIGATION.canShowDrawerPage('pageReporteProductosVencer'), false);
    }
    c.NA_ROLES = { isOwner: () => true };
    assert.equal(c.NA_MENU_NAVIGATION.canShowDrawerPage('pageReporteProductosVencer'), true);
  }
  assert.doesNotMatch(navigation.slice(navigation.indexOf('function renderDrawerItems()'), navigation.indexOf('function openMobileDrawer')), /pageReporteProductosVencer/);
  const html = read('POS/index.html'), sw = read('POS/sw.js');
  assert.match(html, /id="pageReporteProductosVencer"/);
  for (const asset of ['css/reporte-productos-vencer.css', 'js/modules/reporte-productos-vencer.js']) {
    assert.ok(html.includes(asset)); assert.ok(sw.includes("'./" + asset + "'"));
  }
  // Única escritura permitida: la marca de sesión del aviso cerrado (sessionStorage, sin datos).
  assert.deepEqual(source.match(/\.setItem\s*\([^)]*\)/g), [".setItem(ALERT_SESSION_KEY, '1')"]);
  assert.match(source, /root\.sessionStorage\.setItem\(ALERT_SESSION_KEY, '1'\)/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|indexedDB|\.innerHTML\s*=|\b(?:POST|PUT|PATCH|DELETE)\b/);
});

// ---- Misión 4: tramos, filtro por lote y aviso del dueño ----
test('tramos vencido / 30 / 60 / 90 y resumen en español', () => {
  assert.deepEqual([-1, 0, 30, 31, 60, 61, 90].map(api.bucketOf), ['vencido', '30', '30', '60', '60', '90', '90']);
  const report = api.buildReport(products, { days: 90, now });
  assert.deepEqual(plain(report.counts), { vencido: 2, '30': 3, '60': 2, '90': 2 });
  assert.equal(api.summaryLabel(report.counts), 'Vencidos: 2 · Hasta 30 días: 3 · 31 a 60 días: 2 · 61 a 90 días: 2');
});

test('filtro por lote: contiene, sin mayúsculas ni tildes; el CSV indica el lote', () => {
  const report = api.buildReport(products, { days: 90, now, lot: ' DAY6 ' });
  assert.deepEqual(ids(report), ['day60', 'day61']);
  assert.equal(report.lot, 'DAY6');
  assert.equal(api.buildReport([{ id: 'x', name: 'X', lots: [lot('LOTE-ÑU', '2026-10-20')] }], { now, lot: 'lote-nu' }).rows.length, 1);
  assert.match(api.toCsv(report).split('\r\n')[0], /lote contiene «DAY6»$/);
  assert.equal(api.buildReport(products, { now, lot: '' }).rows.length, 5);
});

test('aviso del dueño: vencidos y por vencer en 30 días con el día de Lima', () => {
  assert.deepEqual(plain(api.alertSummary(products, now)), { today: '2026-10-15', expired: 2, soon: 3 });
  const h = harness({ productos: products });
  h.ctx.NA_ROLES = { isOwner() { throw new Error('rol roto'); } };
  assert.equal(h.api.showAlert(), false, 'si NA_ROLES falla, no hay aviso');
});
