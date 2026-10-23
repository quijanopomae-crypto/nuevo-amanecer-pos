// Sobre d72b7601 (Bot 5, ev-d72b7601/LEEME.md). Sondas de Bot 5 como pruebas, sin red:
// 1) PIN numérico: tras «pin» 4-8 dígitos dentro de 6 palabras, sin palabras de corte ni excepción de unidad; tras clave/contraseña reglas
//    estrictas, «: es», y hasta 5 palabras si la frase es de una credencial (wifi, caja, local…). Las 45 frases de pin-d72b en las 4 vías
//    (empleado, dueño, modelo empleado, modelo dueño) y en partes = texto entero.
// 2) 403 forbidden_role: TODAS las tarjetas (4) y propuestas salen de pantalla y memoria, «Nueva compra» prellenada se vacía y se cierra con su
//    «Cancelar», refreshAccess, nada en localStorage/sessionStorage. 3) replayHash/sessionHash con HMAC (ASSISTANT_CONFIRM_SECRET + etiqueta).
// 4) máscaras «____6789», «####6789», «▪▪▪▪», «*6789». 5) fillPurchase no escribe un nombre tapado.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const PURCH = readFileSync(new URL('../../POS/js/config/pos-purchases-client.js', import.meta.url), 'utf8');
const EMP = 'empleado:consultas_documentos';
const VIAS = { emp: A.redactFor(EMP), own: A.redactFor('owner'), mEmp: A.redactText, mOwn: A.redactModelOwner };
const sees = (t, v) => new RegExp('(^|[^\\w])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])').test(t);
const emitN = (t, n, role) => { const red = A.redactFor(role); let o = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else o += d.t || ''; }, 1e9, red, role === 'owner' ? null : A.ownerHold); for (let i = 0; i < t.length; i += n) e.push(t.slice(i, i + n)); e.flush(); return o; };

// [texto, valor, 'secreto' (tapado en las 4 vías) | 'normal' (el dueño lo ve) | 'tapa' (tapado aceptado: decisión final, sin palabras de corte → los años tras la etiqueta también se tapan)]
const PIN = [
  ['El pin de la caja es 4321', '4321', 'secreto'], ['clave del wifi del local 12345678', '12345678', 'secreto'], ['pin por favor 4321', '4321', 'secreto'], ['la clave en el cuaderno: 4321', '4321', 'secreto'],
  ['El pin para la caja 4321 fin.', '4321', 'secreto'], ['El pin de la caja: 4321', '4321', 'secreto'], ['clave de producto 4521', '4521', 'secreto'], ['El pin de mi tarjeta es 98765432', '98765432', 'secreto'],
  ['pin 4321', '4321', 'secreto'], ['pin: 4321', '4321', 'secreto'], ['PIN 4321 de la caja', '4321', 'secreto'], ['clave 4321', '4321', 'secreto'], ['la contraseña es 4321', '4321', 'secreto'],
  ['El pin del local nuevo de la esquina es 4321', '4321', 'secreto'], ['clave del local en 4321', '4321', 'secreto'], ['clave del wifi por 4321', '4321', 'secreto'], ['el pin del año 4321', '4321', 'secreto'],
  ['La clave de la caja: es 4321', '4321', 'secreto'], ['pin de la caja = 4321', '4321', 'secreto'], ['El pin de la caja cambió a 4321', '4321', 'secreto'], ['clave para abrir 4321', '4321', 'secreto'],
  ['contraseña del wifi y el pin 4321', '4321', 'secreto'], ['pin de la caja 4321 unidades', '4321', 'secreto'], ['La clave del wifi de la tienda: Zq9xK2mPw7', 'Zq9xK2mPw7', 'secreto'], ['La clave del wifi de la tienda nueva: Zq9xK2mPw7', 'Zq9xK2mPw7', 'secreto'],
  ['La contraseña de mi correo es Zq9xK2mPw7', 'Zq9xK2mPw7', 'secreto'], ['clave del wifi del local de la esquina Zq9xK2mPw7', 'Zq9xK2mPw7', 'secreto'],
  ['pin, por favor, 4321', '4321', 'secreto'],
  // (Bot 2 sobre d72b7601) regresión frente a 58200f60: sin palabras de corte
  ['la clave de la caja fuerte 4321', '4321', 'secreto'], ['la clave de la caja fuerte: 4321', '4321', 'secreto'], ['la clave de la caja chica 4321', '4321', 'secreto'], ['clave de la caja en 2024 era 4321', '4321', 'secreto'],
  ['la contraseña de la caja fuerte es 87654321', '87654321', 'secreto'], ['El pin de la caja es 1111 y la clave del wifi 2222', '2222', 'secreto'], ['El pin de la caja es 1111 y la clave del wifi 2222', '1111', 'secreto'], ['El PIN de la caja: era 4321', '4321', 'secreto'], ['La contraseña del sistema cambió a 87654321', '87654321', 'secreto'], ['clave de acceso de la puerta trasera: es 2580', '2580', 'secreto'],
  ['contraseña del año 2024', '2024', 'normal'], ['La clave del negocio en 2024 fue el arroz.', '2024', 'normal'], ['Producto clave de la semana 2500 unidades', '2500', 'normal'],
  ['La clave para vender más es tener 1500 unidades.', '1500', 'tapa'] /* (Bot 2 sobre 5646a4c9, a propósito: unidad tras «es» no suelta) */, ['Cambié la clave de la caja en 2024 y anda bien.', '2024', 'normal'], ['El token de la sesión del 2026 venció', '2026', 'normal'],
  ['Mi clave para el año 2025: vender más', '2025', 'normal'], ['la clave de este mes son 3000 soles', '3000', 'normal'], ['clave del producto Arroz Costeño 5kg código 77501234', '77501234', 'normal'],
  ['La clave del pedido: Arroz 2024', 'Arroz', 'normal'], ['clave de la venta S/ 1250', '1250', 'secreto'], ['clave del precio de venta S/ 1250', '1250', 'tapa'] /* (Bots 2/5 sobre 6e0b3c5d, regla final: entero tras clave, tapado) */, ['clave de la caja chica: 2500 soles', '2500', 'tapa'] /* (Bot 2 sobre 5646a4c9, a propósito: unidad tras «:» no suelta) */, ['Producto clave de la semana: Galleta Soda 6x4', 'Soda', 'normal'],
  ['El producto clave es Leche Gloria 400g', 'Gloria', 'normal'],
  // tapados de más ACEPTADOS (un pin nunca es una cantidad; Bot 5 los dejó como INFO)
  ['pin 4321 unidades', '4321', 'tapa'], ['El pin de la impresora 1234 no funciona', '1234', 'tapa'], ['La clave del éxito: 5000 ventas', '5000', 'tapa'], ['La clave del negocio está en el arroz 5x2025', '5x2025', 'tapa']
];

test('1) PIN numérico (Bot 5 pin-d72b): secretos tapados en las 4 vías, normales visibles al dueño, en partes = texto entero', () => {
  for (const [t, v, k] of PIN) {
    for (const [via, f] of Object.entries(VIAS)) {
      const o = f(t);
      if (k === 'secreto' || k === 'tapa') assert.ok(!sees(o, v), via + ' ve ' + v + ' en ' + JSON.stringify(t) + ' → ' + JSON.stringify(o));
      if (k === 'normal' && (via === 'own' || via === 'mOwn' || !/^\d{8}$/.test(v))) assert.ok(sees(o, v), via + ' tapado de más ' + v + ' en ' + JSON.stringify(t) + ' → ' + JSON.stringify(o));
    }
    for (const role of [EMP, 'owner']) for (const n of [1, 3, 7, 48]) assert.equal(emitN(t + ' y sigue aquí.', n, role), A.redactFor(role)(t + ' y sigue aquí.'), role + ' en partes de ' + n + ': ' + JSON.stringify(t));
  }
  // la palabra «pin» va primero: «pin por favor 4321» ya no tapa «por» y deja el número (d72b7601)
  assert.equal(VIAS.emp('pin por favor 4321'), 'pin por favor [oculto]');
  assert.equal(VIAS.own('clave del wifi del local 12345678'), 'clave del wifi del local [oculto]');
  // las palabras no cruzan el fin de frase
  assert.equal(VIAS.own('Cambié el pin. Tengo 4321 cajas.'), 'Cambié el pin. Tengo 4321 cajas.');
  // ventana: más de 60 caracteres o más de 5 palabras (sin contar las de enlace) → ya no es PIN
  assert.ok(sees(VIAS.own('La clave del éxito según los expertos más conocidos del rubro comercial es 4321'), '4321'));
  assert.ok(sees(VIAS.own('pin ' + 'x'.repeat(60) + ' 4321'), '4321')); assert.ok(!sees(VIAS.own('pin ' + 'x'.repeat(50) + ' 4321'), '4321'));
  // un número detrás de «código»/«EAN» no es PIN (el dueño ve el código)
  assert.ok(sees(VIAS.own('clave del producto Arroz código 77501234'), '77501234'));
  // (Bot 2 sobre 3ee80c18) S/ o $ ya no sueltan el número solos: hace falta precio/costo/monto en medio (o decimales, que nunca entran)
  assert.ok(!sees(VIAS.own('pin de cobro S/ 1250'), '1250')); assert.ok(!sees(VIAS.own('clave del costo S/ 1250'), '1250')); /* (Bots 2/5 sobre 6e0b3c5d, regla final: entero tras clave, tapado) */ assert.ok(!sees(VIAS.own('pin de cobro S/ 12.50'), '12.50')); // (Bot 5 sobre 5646a4c9, a propósito) tras «pin» un monto con decimales tampoco se ve
  assert.ok(!sees(VIAS.own('clave de cobro S/ 12.50'), '12.50')); assert.ok(sees(VIAS.own('clave del costo S/ 12.50'), '12.50')); // (Bot 2 sobre 5646a4c9) decimal tras clave: solo con precio/costo/monto
});

test('1b) en partes: con la unidad recién por llegar («2500 » + «unidades») no se suelta antes de tiempo', () => {
  for (const t of ['Producto clave de la semana 2500 unidades vendidas', 'la clave de la caja chica 2500 soles y nada más', 'El pin de la caja cambió a 4321 ayer', 'La clave de la caja: es 4321 listo'])
    for (const role of [EMP, 'owner']) for (let n = 1; n <= 9; n++) assert.equal(emitN(t, n, role), A.redactFor(role)(t), role + ' ' + n + ': ' + t);
});

test('4) máscaras nuevas («____6789», «####6789», «▪▪▪▪», «*6789», «XXX-XX-6789») en servidor y celular; lo normal no', () => {
  for (const v of ['____6789', '####6789', '▪▪▪▪', '*6789', '•6789', '----6789', '~~~~6789', '????6789', 'XXX-XX-6789', '■■■■', '◦◦◦◦', 'F001-*6789', ' *6789']) {
    assert.ok(A.MASK_LEFT_RE.test(v), v); assert.ok(C.maskLeft(v), 'celular ' + v); }
  for (const v of ['**Galleta**', 'Galleta · S/ 1.80', 'F001-00012345', 'Caja x12', 'Pack xx2', 'Alicorp SAC', 'Galleta #2', 'Leche 12345678', 'Promo 2*1', 'Ana_Lopez', 'B001-0001', '| --- |']) {
    assert.ok(!A.MASK_LEFT_RE.test(v), v); assert.ok(!C.maskLeft(v), 'celular ' + v); }
  assert.equal(A.cardPrefix('F001-*6789'), 'F001-'); assert.equal(A.cardPrefix('F001-____6789'), 'F001-'); assert.equal(A.cardPrefix('####6789'), '');
  // la tarjeta no guarda la máscara: el campo queda para completar
  const p = A.toProposal({ name: 'preparar_compra', arguments: { proveedor: 'Bodega ▪▪▪▪', documento: 'F001-____6789', lineas: [{ nombre: 'Galleta', cantidad: 1, costo_unitario: 1 }] } }, 'owner', { products: [] }, 1);
  assert.ok(p.completar.includes('documento') && p.completar.includes('proveedor'), JSON.stringify(p.completar)); assert.equal(p.documento, 'F001-'); assert.ok(!/▪|_{2}/.test(JSON.stringify(p)));
});

// ---------- 3) HMAC del reenvío ----------
const SECRET = 'secreto-de-prueba-1234567890', OWNER = { principalId: 'session:dueno', posRole: 'owner', sessionId: 'S-1', credentialHash: 'h1' };
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET };
const GOOD = { proveedor: 'Bodega Juan RUC 10456789012', documento: 'F001-00012345 pedido 87654321' };
function card() { return A.toProposal({ name: 'preparar_compra', arguments: { proveedor: GOOD.proveedor, documento: GOOD.documento, lineas: [{ nombre: 'Galleta', cantidad: 3, costo_unitario: 1.2 }] } }, 'owner', { products: [] }, 1); }
async function send(token, proposal, extra, store, auth = OWNER) {
  const res = await A.assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal, ...extra }) }), env, auth, jsonR,
    { store, resolveRole: async () => 'owner', reader, audit: async () => {} });
  return { status: res.status, body: await res.json() };
}
test('3) sessionHash/replayHash: HMAC-SHA256 con ASSISTANT_CONFIRM_SECRET y etiqueta «confirm-replay:v1» (no sha256 sin clave); un registro con sha256 → 409', async () => {
  assert.equal(A.REPLAY_HMAC_LABEL, 'confirm-replay:v1');
  const p = card(), store = A.createMemoryUsageStore(), token = await A.issueConfirmToken(p, 'owner', OWNER, SECRET, Date.now());
  const first = await send(token, p, { manual: GOOD }, store); assert.equal(first.status, 200, JSON.stringify(first.body));
  const rec = [...store._map.entries()].find(([, r]) => r.value && r.value.op), saved = rec[1].value;
  const hm = (d) => createHmac('sha256', SECRET).update(d).digest('base64url');
  assert.equal(saved.s, hm('confirm-replay:v1|s|S-1').slice(0, 32));
  assert.notEqual(saved.s, createHash('sha256').update('s:S-1').digest('hex').slice(0, 32));
  assert.ok(!/^[0-9a-f]+$/.test(saved.rh) || saved.rh.length !== 48, 'rh ya no es sha256 hex');
  const again = await send(token, p, { manual: GOOD }, store); assert.equal(again.status, 200); assert.equal(again.body.replay, true);
  // un registro con el hash viejo (sha256 sin clave, precalculable) ya no abre el reenvío
  rec[1].value = { ...saved, s: createHash('sha256').update('s:S-1').digest('hex').slice(0, 32) };
  const old = await send(token, p, { manual: GOOD }, store); assert.equal(old.status, 409); assert.equal(old.body.error, 'already_confirmed'); assert.equal(old.body.proposal, undefined);
  const SRC = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant.js', import.meta.url), 'utf8');
  const fns = SRC.slice(SRC.indexOf('async function sessionHash'), SRC.indexOf('export function proposalHash'));
  assert.ok(!/sha256Hex/.test(fns) && /hmac\(secret, REPLAY_HMAC_LABEL \+ '\|s\|'/.test(fns) && /hmac\(secret, REPLAY_HMAC_LABEL \+ '\|r\|'/.test(fns));
  assert.ok(!/ASSISTANT_REPLAY|REPLAY_SECRET/.test(SRC), 'sin secreto nuevo');
});

// ---------- 2) y 5): DOM mínimo con el código REAL de asistente-ui.js (roleLost, wipeCard, closeAssistantPurchase, fillPurchase) ----------
class N {
  constructor(tag, opts = {}) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.className = opts.cls || ''; this.id = opts.id || ''; this.value = opts.value || '';
    this.dataset = {}; this.style = {}; this.attrs = {}; this.textContent = ''; this.placeholder = ''; this.onclick = null; this.events = []; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === DOC.body; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  matches(sel) { return sel.split(',').map((s) => s.trim()).some((s) => s.startsWith('.') ? this.className.split(/\s+/).includes(s.slice(1)) : s.startsWith('#') ? this.id === s.slice(1) : this.tagName === s.toUpperCase()); }
  querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  click() { if (this.onclick) this.onclick(); }
  dispatchEvent(e) { this.events.push(e.type); return true; }
  focus() {} scrollIntoView() {}
}
let DOC;
function purchaseDialog() { // la misma forma que openNew() de pos-purchases-client.js (ids y clases), «Cancelar» = closeW (w.remove())
  const w = new N('div', { id: 'naPurchaseDialog', cls: 'na-review-overlay na-pur-overlay' });
  w.appendChild(new N('input', { id: 'naPurSupplier' })); w.appendChild(new N('input', { id: 'naPurDoc' }));
  const lines = w.appendChild(new N('div', { cls: 'na-pur-lines' }));
  const line = () => { const r = lines.appendChild(new N('div', { cls: 'na-pur-line' })); for (const c of ['na-pur-prod', 'na-pur-qty', 'na-pur-cost']) r.appendChild(new N('input', { cls: c })); };
  line(); const add = w.appendChild(new N('button', { cls: 'na-pur-add' })); add.onclick = line;
  const cancel = w.appendChild(new N('button', { cls: 'na-pur-cancel' })); cancel.onclick = () => { w.cancelled = true; w.remove(); };
  return w;
}
function store() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; }
function sliceFn(src, from, to) { const i = src.indexOf(from), j = src.indexOf(to, i + 1); assert.ok(i >= 0 && j > i, from); return src.slice(i, j); }

test('5) fillPurchase: sin el producto en el catálogo local un nombre tapado NO se escribe; queda vacío y marcado para completar', () => {
  assert.ok(PURCH.includes("overlay('naPurchaseDialog'") && PURCH.includes('id="naPurSupplier"') && PURCH.includes('id="naPurDoc"') && PURCH.includes('na-pur-cancel') && PURCH.includes('na-pur-add') && PURCH.includes('na-pur-prod'));
  DOC = { body: new N('body') };
  const src = sliceFn(UI, 'fillPurchase: function (w, p) {', '    // Ficha EXISTENTE').replace(/^fillPurchase: /, '').replace(/,\s*$/, '');
  const missingRows = [];
  const ctx = vm.createContext({ C, purchaseProductButton: (w, row) => missingRows.push(row), Event: class { constructor(t) { this.type = t; } }, deps: { productos: () => [{ id: 'P1', nombre: 'Leche Gloria 400g' }] } });
  const fill = vm.runInContext('(' + src + ')', ctx);
  const w = DOC.body.appendChild(purchaseDialog());
  const p = { type: 'compra', proveedor: 'Bodega Juan', documento: 'F001-', lineas: [{ product_id: 'P1', nombre: 'Leche [dato del Admin]', cantidad: 2, costo_unitario: 3 }, { nombre: 'Arroz DNI ****5678', cantidad: 1, costo_unitario: 4 }, { nombre: 'Azúcar rubia', cantidad: 5, costo_unitario: 2 }, { nombre: '▪▪▪▪ Fideo', cantidad: 1 }] };
  fill(w, p);
  const prods = w.querySelectorAll('.na-pur-prod');
  assert.deepEqual(prods.map((i) => i.value), ['Leche Gloria 400g', '', 'Azúcar rubia', '']);
  assert.equal(prods[1].dataset.naNeed, '1'); assert.equal(prods[1].attrs['aria-invalid'], 'true'); assert.equal(prods[1].placeholder, 'Complete el producto'); assert.equal(prods[3].dataset.naNeed, '1');
  assert.equal(prods[2].dataset.naNeed, undefined); assert.equal(prods[0].dataset.naNeed, undefined);
  assert.ok(prods.every((i) => !C.maskLeft(i.value)));
  assert.equal(w.dataset.naAsst, '1', 'marcada como prellenada desde el asistente');
  assert.equal(missingRows.length, 3, 'solo las filas sin producto reciben el enlace de alta/vinculación');
});

test('2) 403 forbidden_role con 4 tarjetas: TODAS salen de pantalla y memoria (puerta, _manual, campos), «Nueva compra» prellenada se vacía y se cierra con su «Cancelar», refreshAccess; nada en el almacenamiento', async () => {
  DOC = { body: new N('body') };
  const doc = { body: DOC.body, createElement: (t) => new N(t), getElementById: (id) => DOC.body.all().find((n) => n.id === id) || null, querySelector: (s) => DOC.body.querySelector(s), querySelectorAll: (s) => DOC.body.querySelectorAll(s) };
  const ls = store(), ss = store(); ls.setItem('na_asistente_acc', 'owner');
  let confirmCalls = 0;
  const gate = C.createGate({ roles: () => ({ role: 'owner', isOwner: () => true }), online: () => true, productos: () => [],
    confirm: async (pp) => { confirmCalls++; return pp.id === 'c1' ? { ok: true, operation_id: 'op1', type: 'compra', proposal: { ...JSON.parse(JSON.stringify(pp)), proveedor: 'Bodega Juan', documento: 'F001-00012345' } } : { ok: false, error: 'forbidden_role' }; },
    openPurchase: () => DOC.body.appendChild(purchaseDialog()), fillPurchase: (w, ap) => { w.dataset.naAsst = '1'; w.querySelector('#naPurSupplier').value = C.purchaseValue(ap, 'proveedor'); w.querySelector('#naPurDoc').value = C.purchaseValue(ap, 'documento'); w.querySelector('.na-pur-prod').value = ap.lineas[0].nombre; w.querySelector('.na-pur-cost').value = String(ap.lineas[0].costo_unitario); return true; }, navigate: () => {} });
  const panel = DOC.body.appendChild(new N('div', { cls: 'na-asst-panel' })), msgs = panel.appendChild(new N('div', { cls: 'na-asst-msgs' }));
  const cards = [], props = [], needs = [];
  for (let i = 1; i <= 4; i++) {
    const p = { id: 'c' + i, type: 'compra', needsConfirm: true, confirm_token: 't' + i, proveedor: 'Bodega ' + i, documento: 'F001-', completar: ['documento'], lineas: [{ nombre: 'Galleta ' + i, cantidad: i, costo_unitario: 1.25 * i }] };
    const typed = 'F001-0000' + i + '99'; const inp = new N('input', { cls: 'na-asst-need-in', value: typed });
    const need = { state: { documento: typed }, inputs: [inp] }; Object.defineProperty(p, '_manual', { value: need.state, enumerable: false, configurable: true });
    const c = msgs.appendChild(new N('div', { cls: 'na-asst-card' })); c.appendChild(inp); c._naKey = gate.add(p); c._naNeed = need; c._naP = p;
    cards.push(c); props.push(p); needs.push(need);
  }
  // la 1.ª ya se confirmó: «Nueva compra» abierta y prellenada (sin guardar)
  const r1 = await gate.execute(cards[0]._naKey, { confirmed: true }); assert.ok(r1.ok, JSON.stringify(r1));
  const dlg = doc.getElementById('naPurchaseDialog'); assert.ok(dlg && dlg.querySelector('#naPurDoc').value === 'F001-0000199', 'lo escrito (_manual) llegó a «Nueva compra»');
  // la 3.ª recibe 403 forbidden_role
  const r3 = await gate.execute(cards[2]._naKey, { confirmed: true }); assert.equal(r3.code, 'forbidden_role');
  let refreshed = 0; const notices = [];
  const ctx = vm.createContext({ C, gate, doc, msgsEl: msgs, Event: class { constructor(t) { this.type = t; } }, Promise, Object, Array,
    el: (t, cls) => { const e = new N(t); if (cls) e.className = cls; return e; }, scrollEnd() {}, announce() {}, closePanel() {}, posNotice: (m) => notices.push(m),
    refreshAccess: () => { refreshed++; return Promise.resolve(null); }, lastPing: 12345, root: { localStorage: ls, sessionStorage: ss } });
  vm.runInContext(sliceFn(UI, '  function wipeCard(card) {', '  function accessLost(code) {'), ctx);
  ctx.roleLost(cards[2], cards[2]._naKey, props[2], needs[2]);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelectorAll('.na-asst-card').length, 0, 'ninguna tarjeta en pantalla');
  for (const c of cards) { assert.equal(c.isConnected, false); assert.equal(c._naKey, null); assert.equal(c._naNeed, null); assert.equal(c._naP, null); assert.equal(c.children[0].value, ''); }
  for (const p of props) assert.equal(p._manual, undefined, 'sin _manual');
  for (const n of needs) { assert.deepEqual(Object.keys(n.state), []); assert.equal(n.inputs[0].value, ''); }
  assert.equal(gate.size(), 0, 'la puerta olvidó TODAS las propuestas'); for (const c of ['c1', 'c2', 'c3', 'c4']) assert.equal(gate.proposal(c), null);
  assert.equal(doc.getElementById('naPurchaseDialog'), null, '«Nueva compra» cerrada'); assert.equal(dlg.cancelled, true, 'con su propio «Cancelar»');
  assert.ok(dlg.all().filter((n) => n.tagName === 'INPUT').every((i) => i.value === ''), 'campos vacíos'); assert.ok(dlg.events.includes('input'));
  assert.equal(refreshed, 1, 'refreshAccess'); assert.equal(ctx.lastPing, 0);
  const notice = doc.querySelector('.na-asst-rolelost'); assert.ok(notice); assert.equal(notice.children[0].textContent, C.ROLE_LOST_MSG); assert.equal(notice.children[1].textContent, 'Cerrar');
  assert.equal(confirmCalls, 2, 'sin reintento');
  // nada de la propuesta ni de lo escrito en el almacenamiento del navegador
  const dump = JSON.stringify([...ls._m, ...ss._m]); for (const s of ['Bodega', 'F001-0000', 'Galleta', 'c1', 'op1', 't1']) assert.ok(!dump.includes(s), s);
  // «Nueva compra» abierta a mano (no desde una tarjeta) NO se toca
  const own = DOC.body.appendChild(purchaseDialog()); own.querySelector('#naPurDoc').value = 'B001-5'; ctx.roleLost(null, 'x', null, null);
  assert.equal(own.isConnected, true); assert.equal(own.querySelector('#naPurDoc').value, 'B001-5');
  // estático: sin IndexedDB/sessionStorage y sin escribir propuestas en localStorage; el rol lo decide el servidor (no se mira access/roles)
  const CORE = readFileSync(new URL('../../POS/js/modules/asistente/asistente-core.js', import.meta.url), 'utf8');
  for (const s of [UI, CORE]) { assert.ok(!/indexedDB|sessionStorage\.setItem/.test(s)); assert.deepEqual((s.match(/localStorage\.setItem\('([^']+)'/g) || []).map((x) => x.slice(22, -1)).filter((k) => k !== 'na_asistente_acc'), []); }
  const fn = sliceFn(UI, 'function roleLost', 'function accessLost');
  assert.ok(/gate\.forgetAll\(\)/.test(fn) && /querySelectorAll\('\.na-asst-card'\)/.test(fn) && /closeAssistantPurchase\(\)/.test(fn) && /refreshAccess\(\)/.test(fn));
  assert.ok(!/access\b|roles\(|isOwner|setTimeout|send\(|innerHTML|localStorage/.test(fn));
  assert.ok(!/pos-purchases-client|codigos-duplicados/.test(sliceFn(UI, 'function closeAssistantPurchase', 'function roleLost')));
});
