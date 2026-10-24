// Candado 'importar-clientes' (#904): falla cerrado; no toca ownerAllowed() ni pos-permissions.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('POS/js/modules/clientes-importar.js', 'utf8');
class N { constructor(t) { this.tagName = t; this.hidden = false; this.attrs = {}; } setAttribute(k, v) { this.attrs[k] = v; } }
function load(perms) {
  const btn = new N('button'), panel = new N('section'), status = { textContent: '' };
  const ids = { naImportarClientesBtn: btn, naImportarClientes: panel, pageClientes: new N('div') };
  const doc = { readyState: 'complete', getElementById: id => ids[id] || null,
    querySelector: s => s === '#pageClientes .filter-bar' ? new N('div') : s.endsWith('[data-ic-status]') ? status : null };
  const ctx = { document: doc, addEventListener() {}, setTimeout() {}, calls: [] };
  ctx.guardarCli = async () => { ctx.calls.push('guardar'); return true; };
  if (perms !== undefined) ctx.NA_PERMISSIONS = perms;
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(SRC, ctx);
  return { api: ctx.NA_CLIENTES_IMPORTAR, btn, panel, status, ctx };
}
const closedVariants = { ausente: undefined, sinFuncion: {}, cerrado: { featureLocked: () => true },
  undefinedResult: { featureLocked: () => undefined }, error: { featureLocked() { throw new Error('x'); } } };
for (const [name, perms] of Object.entries(closedVariants)) test(`candado ${name}: botón y panel ocultos, no previsualiza ni importa`, async () => {
  const { api, btn, panel, ctx } = load(perms);
  assert.equal(api.unlocked(), false);
  api.render();
  assert.equal(btn.hidden, true); assert.equal(panel.hidden, true);
  assert.deepEqual({ ...api.loadText('nombre\nAna\n') }, { error: 'Disponible pronto.' });
  await api.confirmImport(); assert.deepEqual(ctx.calls, []);
});
test('candado en pos-permissions.js real (true): cerrado', () => {
  const c = vm.createContext({}); vm.runInContext(readFileSync('POS/js/config/pos-permissions.js', 'utf8'), c);
  assert.equal(c.NA_PERMISSIONS.featureLocked('importar-clientes'), true);
  assert.equal(load({ featureLocked: c.NA_PERMISSIONS.featureLocked }).api.unlocked(), false);
});
test('candado abierto: previsualiza (buildPreview sigue igual)', () => {
  const { api } = load({ featureLocked: id => id !== 'importar-clientes' });
  assert.equal(api.unlocked(), true);
  const res = api.buildPreview('nombre;documento\nAna;87654321\n', { docs: {}, phones: {} });
  assert.equal(res.valid, 1);
});
