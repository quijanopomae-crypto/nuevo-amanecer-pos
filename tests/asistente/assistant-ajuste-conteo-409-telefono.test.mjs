// Teléfono de #983 (auditoría 500, VE-009): /auth/assistant/confirm contesta 409 stock_changed cuando la corrección de conteo se armó con un
// stock viejo. El celular muestra el «message» del servidor (no el aviso genérico) y dibuja la tarjeta NUEVA firmada que devuelve («proposal»).
// La tarjeta vieja no se aplica. Sin red: fetch falso; el confirmRemote real de asistente-ui.js y la puerta real de asistente-core.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

const MSG = 'El stock de Paracetamol cambió de 12 a 10 desde que preparé la tarjeta. Para llegar a 15 ahora es una entrada de 5. Revisa la tarjeta nueva.';
const OLD = { id: 'p1-ajuste', type: 'ajuste', needsConfirm: true, confirm_token: 'tok-viejo', product_id: 'P1', nombre: 'Paracetamol', tipo: 'entrada', cantidad: 3,
  motivo: 'Ajuste de inventario', stock_actual: 12, stock_despues: 15 };
const FRESH = { ...OLD, id: 'p1-ajuste-r', confirm_token: 'tok-nuevo', cantidad: 5, stock_actual: 10, stock_despues: 15, title: 'Entrada de stock' };
const BODY409 = { error: 'stock_changed', nombre: 'Paracetamol', stock_antes: 12, stock_ahora: 10, objetivo: 15, proposal: FRESH, message: MSG, operation_id: 'op-1' };

function loadConfirmRemote(reply) {
  const win = {}; const seen = [];
  const ctx = vm.createContext({ window: win, setTimeout, clearTimeout, setInterval, clearInterval, Date, AbortController, console, Intl, URL, TextEncoder, TextDecoder });
  vm.runInContext(CORE, ctx); const Cv = win.NA_ASISTENTE_CORE;
  win.addEventListener = () => {}; win.removeEventListener = () => {};
  win.fetch = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { status: reply.status, ok: reply.status < 300, json: async () => reply.body }; };
  const ui = vm.createContext({ C: Cv, root: win, reqInit: (path, body) => ({ url: path, init: { method: 'POST', body: JSON.stringify(body) } }), setTimeout, Promise, Object, JSON, Error, Array });
  vm.runInContext(sliceFn(UI, '  async function post(', '  // Confirmación: el MISMO token') + sliceFn(UI, '  async function confirmRemote(', '  // ---------- Funciones existentes del POS'), ui);
  return { confirmRemote: ui.confirmRemote, seen };
}
function gateDeps(confirm) {
  const calls = { stock: [] };
  return { calls, d: { roles: () => ({ role: 'owner', isOwner: () => true }), online: () => true, productos: () => [{ id: 'P1', name: 'Paracetamol', stock: 10, controla: true }],
    confirm, openStockMove: (id, tipo, cant, motivo) => { calls.stock.push([id, tipo, cant, motivo]); return true; }, navigate: () => {} } };
}

test('confirmRemote: el 409 stock_changed trae el message y la tarjeta nueva firmada (proposal)', async () => {
  const { confirmRemote, seen } = loadConfirmRemote({ status: 409, body: BODY409 });
  const out = await confirmRemote(OLD, null, {});
  assert.equal(seen.length, 1, 'un solo envío (un 409 no se reintenta)'); assert.equal(seen[0].url, '/auth/assistant/confirm'); assert.equal(seen[0].body.token, 'tok-viejo');
  assert.equal(out.ok, false); assert.equal(out.error, 'stock_changed'); assert.equal(out.status, 409);
  assert.equal(out.message, MSG); assert.equal(out.proposal.id, 'p1-ajuste-r'); assert.equal(out.proposal.confirm_token, 'tok-nuevo');
});

test('puerta: 409 stock_changed -> aviso del servidor + tarjeta nueva; la vieja queda sin aplicar (no abre «Registrar movimiento»)', async () => {
  const { confirmRemote } = loadConfirmRemote({ status: 409, body: BODY409 });
  const { d, calls } = gateDeps(confirmRemote); const g = C.createGate(d); const key = g.add(OLD);
  const r = await g.execute(key, { confirmed: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'stock_changed');
  assert.equal(r.msg, MSG, 'el message del servidor, no el genérico');
  assert.notEqual(r.msg, C.friendlyError('HTTP_409').msg);
  assert.equal(r.fresh && r.fresh.id, 'p1-ajuste-r'); assert.equal(r.fresh.confirm_token, 'tok-nuevo'); assert.equal(r.fresh.cantidad, 5);
  assert.equal(calls.stock.length, 0, 'la tarjeta vieja no se aplica'); assert.equal(g.state(key), 'denied');
  const f = C.confirmFailureView(r, { type: 'ajuste' });
  assert.equal(f.kind, 'stale'); assert.equal(f.msg, MSG); assert.equal(f.button, null, 'sin «Confirmar» en la vieja'); assert.equal(f.again, false, 'la nueva ya está: sin «Pedir de nuevo»');
  // la tarjeta nueva entra a la puerta con su propio token y se confirma como cualquier otra
  const ok = C.createGate(gateDeps(async () => ({ ok: true, confirmed: true, operation_id: 'op-2' })).d); const k2 = ok.add(r.fresh); assert.ok(k2); assert.notEqual(k2, key);
});

test('puerta: 409 stock_changed sin tarjeta («No hace falta el ajuste») -> solo el aviso y «Pedir de nuevo»', async () => {
  const msg = 'El stock de Paracetamol ya cambió a 15, que es el número contado. No hace falta el ajuste.';
  const { confirmRemote } = loadConfirmRemote({ status: 409, body: { ...BODY409, proposal: null, message: msg } });
  const { d, calls } = gateDeps(confirmRemote); const g = C.createGate(d); const key = g.add(OLD);
  const r = await g.execute(key, { confirmed: true });
  assert.equal(r.code, 'stock_changed'); assert.equal(r.msg, msg); assert.equal(r.fresh, null); assert.equal(calls.stock.length, 0);
  const f = C.confirmFailureView(r, { type: 'ajuste' }); assert.equal(f.kind, 'stale'); assert.equal(f.again, true);
});

test('guardas: tarjeta de otro producto, otro tipo, sin token o mismo id -> no se dibuja; mensaje técnico -> aviso amable', async () => {
  for (const bad of [{ ...FRESH, product_id: 'P2' }, { ...FRESH, type: 'precio' }, { ...FRESH, confirm_token: '' }, { ...FRESH, id: OLD.id }, 'x', [FRESH]])
    assert.equal(C.staleCountFresh(OLD, bad), null, JSON.stringify(bad));
  const { d } = gateDeps(async () => ({ ok: false, status: 409, error: 'stock_changed', message: 'stock_changed: error 409', proposal: FRESH }));
  const g = C.createGate(d); const r = await g.execute(g.add(OLD), { confirmed: true });
  assert.equal(r.msg, C.FRIENDLY.stock_changed[0]); assert.equal(r.fresh.id, 'p1-ajuste-r');
});

test('pantalla: la tarjeta vieja muestra el aviso, esconde Confirmar/Cancelar y la nueva se dibuja justo debajo (addCard con la tarjeta vieja como ancla)', () => {
  const h = sliceFn(UI, "        if (f.kind === 'stale')", "        if (f.kind === 'blocked')");
  assert.match(h, /res\.textContent = f\.msg/); assert.match(h, /ok\.hidden = true/); assert.match(h, /no\.hidden = true/);
  assert.match(h, /addCard\(r\.fresh, prompt, c\)/);
  assert.match(sliceFn(UI, '  async function confirmRemote(', '  // ---------- Funciones existentes del POS'), /d\.error === 'stock_changed'/);
});
