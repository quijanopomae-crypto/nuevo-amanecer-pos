// Sobre d72b7601 (Bots 3/4/5): confirm con señal débil y avisos de «ya se confirmó», de punta a punta en el celular. Sin red.
// 1) confirmRemote: UN reintento automático con el MISMO cuerpo («Reconectando…» por onRetry); sin respuesta, el error lleva ese cuerpo; con
//    opts.body se reenvía ese cuerpo tal cual (lo escrito no se vuelve a leer). 2) puerta: corte o 5xx → bloqueada («Sin conexión. Toque
//    Reintentar»), «Reintentar» manda el cuerpo guardado aunque cambien los campos o las filas; 200 o 4xx real → desbloqueada.
// 3) 409 already_confirmed_same_session con la propuesta firmada (sin manual) → «Nueva compra» con lo que este celular mandó y la nota.
// 4) «Ya se confirmó en otro aparato.» SOLO con 403 other_device + confirmed; servidor: other_device lleva confirmed solo si ya se usó.
// 5) tarjeta: campos y «Confirmar» bloqueados al confirmar, «Reconectando…», edición solo tras 200 o 4xx real.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { toProposal, issueConfirmToken, assistantConfirmRoute, createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
const sliceFn = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
const owner = { role: 'owner', isOwner: () => true };
const compra = (id) => { const p = { id, type: 'compra', needsConfirm: true, confirm_token: 'tok-' + id, proveedor: 'Bodega Juan', documento: 'F001-', completar: ['documento'], lineas: [{ nombre: 'Galleta', cantidad: 1, costo_unitario: 1 }] };
  Object.defineProperty(p, '_manual', { value: { documento: 'F001-00012345' }, enumerable: false, configurable: true }); return p; };

function loadConfirmRemote(post) {
  const ctx = vm.createContext({ C, post, setTimeout, Promise, Object, JSON, Error, Array });
  vm.runInContext(sliceFn(UI, '  async function confirmRemote(', '  // ---------- Funciones existentes del POS'), ctx);
  return ctx.confirmRemote;
}

test('confirmRemote: corte → UN reintento automático con el MISMO cuerpo y «Reconectando…»; sin respuesta, el error lleva ese cuerpo; «Reintentar» reenvía opts.body sin leer los campos', async () => {
  const sent = []; let mode = 'cut-once';
  const post = async (path, body) => { assert.equal(path, '/auth/assistant/confirm'); sent.push(body); if (mode === 'cut-all' || (mode === 'cut-once' && sent.length === 1)) throw new Error('cortada'); return { ok: true, operation_id: 'AST-1' }; };
  const confirmRemote = loadConfirmRemote(post);
  const p = compra('c1'); let retries = 0;
  const r = await confirmRemote(p, { op: 'AST-1', accept: [], drop: [] }, { onRetry: () => { retries++; } });
  assert.equal(r.ok, true); assert.equal(sent.length, 2, 'un solo reintento automático'); assert.equal(retries, 1, 'onRetry («Reconectando…») antes del reintento');
  assert.equal(sent[0], sent[1], 'el MISMO objeto de cuerpo'); assert.equal(JSON.stringify(sent[0]), JSON.stringify(sent[1]));
  assert.deepEqual(sent[0].manual, { documento: 'F001-00012345' }); assert.equal(sent[0].token, 'tok-c1'); assert.ok(!('confirm_token' in sent[0].proposal));
  assert.equal(r.sentBody, sent[0], 'la respuesta lleva el cuerpo enviado (no enumerable)'); assert.ok(!Object.keys(r).includes('sentBody'));
  // sin respuesta en los dos intentos: se lanza con el cuerpo
  sent.length = 0; mode = 'cut-all'; let err = null;
  try { await confirmRemote(p, null, { onRetry() {} }); } catch (e) { err = e; }
  assert.ok(err); assert.equal(sent.length, 2); assert.equal(err.sentBody, sent[0]); assert.equal(sent[0], sent[1]);
  // «Reintentar»: el dueño no puede editar, pero aunque _manual cambiara se manda el cuerpo guardado, idéntico
  const kept = err.sentBody, snap = JSON.stringify(kept); p._manual.documento = 'F001-99999999'; sent.length = 0; mode = 'cut-once';
  const r2 = await confirmRemote(p, { op: 'X', accept: [0], drop: [] }, { body: kept, onRetry() {} });
  assert.equal(r2.ok, true); assert.equal(sent[0], kept); assert.equal(sent[1], kept); assert.equal(JSON.stringify(sent[0]), snap, 'cuerpo idéntico byte a byte');
  // 4xx real: sin reintento automático
  sent.length = 0; const c4 = loadConfirmRemote(async (path, body) => { sent.push(body); return { ok: false, error: 'fields_required', status: 422, fields: ['documento'] }; });
  let rr = 0; const r4 = await c4(compra('c2'), null, { onRetry: () => { rr++; } }); assert.equal(sent.length, 1); assert.equal(rr, 0); assert.equal(r4.error, 'fields_required'); assert.equal(r4.status, 422);
});

test('puerta: corte o 5xx → bloqueada con «Sin conexión. Toque Reintentar» y el cuerpo guardado se reenvía igual; 200 o 4xx real → desbloqueada', async () => {
  let n = 0; const bodies = [], answers = [];
  const deps = { roles: () => owner, online: () => true, productos: () => [], openPurchase: () => ({ querySelector: () => null }), fillPurchase: () => true, navigate: () => {},
    confirm: async (pp, rv, o) => { n++; const body = (o && o.body) || { token: pp.confirm_token, manual: C.fillValues(pp), review: rv }; bodies.push(body); const a = answers.shift();
      if (a === 'cut') { const e = new Error('cortada'); e.sentBody = body; throw e; }
      if (a === '503') { const r = { ok: false, error: 'HTTP_503', status: 503 }; Object.defineProperty(r, 'sentBody', { value: body }); return r; }
      if (a === '422') { const r = { ok: false, error: 'fields_required', status: 422, fields: ['documento'] }; Object.defineProperty(r, 'sentBody', { value: body }); return r; }
      return { ok: true, operation_id: 'AST-9', type: 'compra', proposal: JSON.parse(JSON.stringify({ ...pp, confirm_token: undefined })) }; } };
  const g = C.createGate(deps), p = compra('c1'), key = g.add(p);
  answers.push('cut'); const r1 = await g.execute(key, { confirmed: true, review: { op: 'A', accept: [], drop: [] } });
  assert.equal(r1.locked, true); assert.equal(r1.msg, C.NO_LINK_MSG); assert.equal(C.NO_LINK_MSG, 'Sin conexión. Toque Reintentar'); assert.equal(g.locked(key), true); assert.equal(g.state(key), 'pending');
  const v = C.confirmFailureView(r1); assert.equal(v.locked, true); assert.equal(v.button, 'Reintentar'); assert.equal(v.again, false, 'sin «Pedir de nuevo» editable');
  // 5xx: sigue bloqueada, mismo cuerpo, aunque cambien lo escrito y las filas
  p._manual.documento = 'F001-77777777'; answers.push('503'); const r2 = await g.execute(key, { confirmed: true, review: { op: 'A', accept: [0], drop: [] } });
  assert.equal(r2.locked, true); assert.equal(bodies[1], bodies[0], '«Reintentar» manda el cuerpo guardado'); assert.equal(bodies[1].manual.documento, 'F001-00012345'); assert.deepEqual(bodies[1].review.accept, []);
  // 4xx real: se puede editar
  answers.push('422'); const r3 = await g.execute(key, { confirmed: true }); assert.equal(r3.code, 'fields_required'); assert.ok(!r3.locked); assert.equal(g.locked(key), false); assert.equal(bodies[2], bodies[0]);
  // ya sin bloqueo, el cuerpo nuevo se arma con lo corregido
  answers.push('ok'); const r4 = await g.execute(key, { confirmed: true }); assert.ok(r4.ok, JSON.stringify(r4)); assert.notEqual(bodies[3], bodies[0]); assert.equal(bodies[3].manual.documento, 'F001-77777777'); assert.equal(g.locked(key), false);
  assert.equal(C.RECONNECT_MSG, 'Reconectando…');
});

test('409 already_confirmed_same_session con la propuesta firmada (sin manual) → «Nueva compra» con lo que ESTE celular mandó y la nota exacta', async () => {
  let opened = 0, filled = null; const sentBody = { token: 'tok-c1', proposal: {}, manual: { documento: 'F001-00054321' } };
  const p = compra('c1'), signed = JSON.parse(JSON.stringify(p)); delete signed.confirm_token;
  const deps = { roles: () => owner, online: () => true, productos: () => [], navigate: () => {},
    openPurchase: () => { opened++; return { querySelector: () => null }; }, fillPurchase: (w, ap) => { filled = { proveedor: C.purchaseValue(ap, 'proveedor'), documento: C.purchaseValue(ap, 'documento') }; return true; },
    confirm: async () => { const r = { ok: false, error: 'already_confirmed_same_session', status: 409, operation_id: 'AST-1', type: 'compra', proposal: signed }; Object.defineProperty(r, 'sentBody', { value: sentBody }); return r; } };
  const g = C.createGate(deps), key = g.add(p); const r = await g.execute(key, { confirmed: true });
  assert.equal(r.ok, true); assert.equal(r.code, 'already_confirmed_same_session'); assert.equal(r.msg, 'Esta compra ya se confirmó. Corrija los datos en Nueva compra.'); assert.equal(C.SAME_SESSION_MSG, r.msg);
  assert.equal(opened, 1); assert.deepEqual(filled, { proveedor: 'Bodega Juan', documento: 'F001-00054321' }, 'lo escrito sale del cuerpo que guardó el celular, no del servidor');
  assert.equal(g.state(key), 'done'); assert.doesNotMatch(r.msg, /otro aparato|otra sesión/);
  // propuesta que no es la de la tarjeta → no se abre nada
  let op2 = 0; const g2 = C.createGate({ ...deps, openPurchase: () => { op2++; return null; }, confirm: async () => ({ ok: false, error: 'already_confirmed_same_session', proposal: { ...signed, id: 'otra' } }) });
  const k2 = g2.add(compra('c1')); const x = await g2.execute(k2, { confirmed: true }); assert.equal(x.ok, false); assert.equal(op2, 0); assert.equal(x.msg, C.SAME_SESSION_MSG);
  // la tarjeta muestra la nota en el aviso del POS
  const h = sliceFn(UI, '    if (ok) ok.onclick = async function () {', '  function wipeCard(card) {');
  assert.match(h, /r\.code === 'already_confirmed_same_session' && r\.ok\) posNotice\(r\.msg\)/);
});

test('«Ya se confirmó en otro aparato.» SOLO con 403 other_device + confirmed; already_confirmed dice «otra sesión»', async () => {
  const run = async (ans) => { const g = C.createGate({ roles: () => owner, online: () => true, productos: () => [], openPurchase: () => null, fillPurchase: () => true, navigate: () => {}, confirm: async () => ans });
    const k = g.add(compra('c1')); return g.execute(k, { confirmed: true }); };
  const a = await run({ ok: false, error: 'other_device', confirmed: true }); assert.equal(a.msg, 'Ya se confirmó en otro aparato.'); assert.equal(C.OTHER_DEVICE_DONE_MSG, a.msg);
  const b = await run({ ok: false, error: 'other_device' }); assert.doesNotMatch(b.msg, /ya se confirmó/i);
  const c = await run({ ok: false, error: 'already_confirmed' }); assert.equal(c.msg, 'Esta compra ya se confirmó en otra sesión.');
  for (const code of ['already_confirmed', 'already_confirmed_same_session', 'network', 'forbidden_role', 'HTTP_409']) assert.doesNotMatch(C.friendlyError(code).msg, /otro aparato/, code);
  // estático: la frase solo existe una vez en el celular (OTHER_DEVICE_DONE_MSG) y solo se usa con other_device + confirmed
  assert.equal((CORE.match(/Ya se confirmó en otro aparato/g) || []).length, 1); assert.ok(!/Ya se confirmó en otro aparato|ya se confirmó en otro aparato/.test(UI));
  assert.match(CORE, /c\.error === 'other_device'\) \{[^}]*c\.confirmed \? OTHER_DEVICE_DONE_MSG/);
});

const SECRET = 'secreto-de-prueba-1234567890', OWNER = { principalId: 'session:dueno', posRole: 'owner', sessionId: 'S-1', credentialHash: 'h1' };
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET };
const LINEAS = [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }];
const GOOD = { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321' };
function card() { return toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321', lineas: LINEAS } }, 'owner', { products: [] }, 1); }
async function send(token, proposal, extra, store, auth = OWNER, role = 'owner') {
  const res = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal, ...extra }) }), env, auth, jsonR,
    { store, resolveRole: async () => role, reader, audit: async () => {} });
  return { status: res.status, body: await res.json() };
}
test('servidor: 403 other_device lleva confirmed:true solo si la tarjeta ya se usó; nunca propuesta, operation_id ni lo escrito; empleado 403', async () => {
  const p = card(), store = createMemoryUsageStore(), token = await issueConfirmToken(p, 'owner', OWNER, SECRET, Date.now());
  const OTHER = { principalId: 'session:otro', posRole: 'owner', sessionId: 'S-9', credentialHash: 'h9' };
  const before = await send(token, p, { manual: GOOD }, store, OTHER); assert.equal(before.status, 403); assert.deepEqual(before.body, { error: 'other_device' });
  assert.equal((await send(token, p, { manual: GOOD }, store)).status, 200);
  const after = await send(token, p, { manual: GOOD }, store, OTHER); assert.equal(after.status, 403); assert.deepEqual(after.body, { error: 'other_device', confirmed: true });
  const emp = await send(token, p, { manual: GOOD }, store, OWNER, 'empleado:consultas_documentos'); assert.equal(emp.status, 403); assert.equal(emp.body.error, 'forbidden_role'); assert.ok(!emp.body.proposal && !emp.body.operation_id);
});

test('tarjeta: al confirmar, campos y «Confirmar» bloqueados; «Reconectando…» en el reintento; sin respuesta sigue bloqueada con «Reintentar»; edición solo tras 200 o 4xx real', () => {
  const h = sliceFn(UI, '    if (ok) ok.onclick = async function () {', '  function wipeCard(card) {');
  const iLock = h.indexOf('lockFields(true);'), iExec = h.indexOf('gate.execute(key'), iLocked = h.indexOf('if (r.locked) { lockFields(true);'), iUnlock = h.indexOf('lockFields(false);');
  assert.ok(iLock > 0 && iLock < iExec, 'bloquea antes de mandar'); assert.ok(iLocked > iExec && iUnlock > iLocked, 'sin respuesta queda bloqueada; desbloquea solo después');
  assert.match(h, /ok\.disabled = true; no\.disabled = true; ok\.textContent = gate\.locked && gate\.locked\(key\) \? C\.RECONNECT_MSG : 'Guardando…'/);
  assert.match(h, /onRetry: function \(\) \{ if \(!c\.isConnected\) return; ok\.textContent = C\.RECONNECT_MSG; res\.textContent = C\.RECONNECT_MSG; revealCard\(c, \[res, ok\]\); \}/); // (Bot 4 sobre f773911f) y se trae a la vista
  assert.match(h.slice(iLocked, iUnlock), /c\.dataset\.btn = 'Reintentar'/); assert.match(h.slice(iLocked, iUnlock), /again\.hidden = true/);
  const lf = sliceFn(UI, '    function lockFields(on) {', '    function syncOk()'); assert.match(lf, /i\.disabled = !!on; i\.readOnly = !!on/); assert.match(lf, /tr\.flag button/);
  assert.match(UI, /function syncOk\(\) \{ if \(!ok \|\| c\.dataset\.st !== 'pending' \|\| c\.dataset\.locked === '1'\) return;/, 'con bloqueo, escribir no reactiva «Confirmar»');
  assert.ok(!/innerHTML/.test(h.slice(iLock, iUnlock)));
});
