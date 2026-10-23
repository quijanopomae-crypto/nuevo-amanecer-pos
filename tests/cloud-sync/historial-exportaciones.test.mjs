import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PERMISSIONS } from '../../tools/cloudflare-lab/src/pos-permissions.js';

// #95 Historial de archivos exportados. Datos sintéticos, sin DOM real.
const read = p => readFileSync(p, 'utf8');
const source = read('POS/js/modules/historial-exportaciones.js');
function memoryStorage() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
function context({ locked = false, permissions = true, role = 'owner', owner = true } = {}) {
  const clicks = [];
  class Anchor { constructor() { this.attrs = {}; this.href = ''; } setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } hasAttribute(k) { return k in this.attrs; } set download(v) { this.attrs.download = String(v); } }
  Anchor.prototype.click = function () { clicks.push(this.getAttribute('download')); };
  let n = 0;
  const URL = { createObjectURL: () => 'blob:x/' + (++n), revokeObjectURL: () => {} };
  const ctx = vm.createContext({
    localStorage: memoryStorage(), HTMLAnchorElement: Anchor, URL, setTimeout, Date, JSON, Map, Math, CustomEvent: class { constructor(t, d) { this.type = t; this.detail = d && d.detail; } },
    dispatchEvent() {}, addEventListener() {},
    NA_PERMISSIONS: permissions ? { featureLocked: id => id === 'historial-exportaciones' ? locked : true, canAccessScreen: (r, id) => r === 'owner' } : undefined,
    NA_ROLES: { role, label: 'Caja 1', isOwner: () => owner }
  });
  vm.runInContext(source, ctx);
  return { ctx, api: ctx.NA_HISTORIAL_EXPORTACIONES, clicks, Anchor, URL };
}
const plain = v => JSON.parse(JSON.stringify(v));
const tick = () => new Promise(r => setTimeout(r, 10));
function download(t, name, blob) { const a = new t.Anchor(); a.href = t.URL.createObjectURL(blob); a.download = name; a.click(); }

test('el candado sigue cerrado y es solo del dueño', () => {
  assert.equal(PERMISSIONS.featureLocked('historial-exportaciones'), true);
  assert.deepEqual(Array.from(PERMISSIONS.FEATURE_ROLES['historial-exportaciones']), ['owner']);
});

test('registra descarga CSV con reporte, tipo, filas y quién; la descarga no cambia', async () => {
  const t = context();
  const csv = '\uFEFF"Sin ventas del 01/10 al 15/10"\r\nProducto,Código\r\n"Leche, entera",A1\r\nPan,B2\r\n';
  download(t, 'kardex-2026-10-01-a-2026-10-15.csv', { size: csv.length, type: 'text/csv;charset=utf-8', text: async () => csv });
  assert.deepEqual(t.clicks, ['kardex-2026-10-01-a-2026-10-15.csv']);
  await tick();
  const [e] = plain(t.api.load());
  assert.equal(e.report, 'Kardex'); assert.equal(e.type, 'CSV'); assert.equal(e.by, 'Dueño · Caja 1');
  assert.equal(e.rows, 2); assert.match(e.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(!JSON.stringify(e).includes('Leche'), 'no guarda contenido del archivo');
});

test('empleado también queda registrado como quien exportó', () => {
  const t = context({ role: 'empleado', owner: false });
  download(t, 'comprobante-V001.pdf', { size: 10, type: 'application/pdf' });
  const [e] = plain(t.api.load());
  assert.equal(e.type, 'PDF'); assert.equal(e.report, 'Comprobante'); assert.equal(e.by, 'Empleado · Caja 1'); assert.equal(e.rows, null);
  assert.equal(t.api.available(), false);
});

test('candado cerrado o permisos sin cargar: no registra pero descarga igual', () => {
  for (const opts of [{ locked: true }, { permissions: false }]) {
    const t = context(opts);
    download(t, 'arqueo-caja-2026-10-01-a-2026-10-02.csv', { size: 1, type: 'text/csv' });
    assert.equal(t.clicks.length, 1); assert.equal(t.api.load().length, 0); assert.equal(t.api.available(), false);
  }
});

test('isOwner que lanza error falla cerrado', () => {
  const t = context(); t.ctx.NA_ROLES = { isOwner() { throw new Error('x'); } };
  assert.equal(t.api.available(), false);
});

test('tope de 200 entradas, la más reciente primero', () => {
  const t = context();
  for (let i = 0; i < 205; i++) t.api.record({ fileName: 'f' + i + '.json' });
  const list = t.api.load();
  assert.equal(list.length, 200); assert.equal(list[0].file, undefined); assert.equal(list[0].ext, 'json');
});

test('nombres y tipos', () => {
  const { api } = context();
  assert.equal(api.reportName('reporte_ganancias_2026-10-01_2026-10-15.xlsx'), 'Reporte de ganancias');
  assert.equal(api.reportName('nuevo_amanecer_respaldo_20261021.json'), 'Respaldo completo');
  assert.equal(api.reportName('ventas_2026-10-01.csv'), 'Ventas');
  assert.equal(api.fileType('x.xlsx'), 'Excel'); assert.equal(api.fileType('x', 'text/csv'), 'CSV');
  assert.equal(api.csvRows('a,b\n"x\ny",1\n\n'), 1);
});

test('enganchado en index.html y sw.js; módulo sin innerHTML', () => {
  const html = read('POS/index.html'), sw = read('POS/sw.js');
  for (const a of ['css/historial-exportaciones.css', 'js/modules/historial-exportaciones.js']) { assert.ok(html.includes(a)); assert.ok(sw.includes("'./" + a + "'")); }
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(source));
});

test('nunca guarda el nombre del archivo (puede tener nombres de clientes)', () => {
  const t = context();
  t.api.record({ fileName: 'comprobante-Juana-Perez-123.pdf' });
  t.api.record({ fileName: 'Juana Perez deudas.csv' });
  assert.doesNotMatch(t.ctx.localStorage.getItem(t.api.KEY) || '', /Juana|Perez/);
  const list = t.api.load();
  assert.equal(list[0].report, 'Otro archivo'); assert.equal(list[0].ext, 'csv');
  assert.equal(list[1].report, 'Comprobante');
});

test('si el registro falla, la descarga sigue igual (falla abierta para la descarga)', () => {
  const t = context();
  t.ctx.localStorage.setItem = () => { throw new Error('lleno'); };
  t.ctx.localStorage.getItem = () => { throw new Error('roto'); };
  download(t, 'kardex-2026-10-01.csv', { size: 3, type: 'text/csv', text: async () => 'a\n1' });
  assert.deepEqual(t.clicks, ['kardex-2026-10-01.csv']);
});
