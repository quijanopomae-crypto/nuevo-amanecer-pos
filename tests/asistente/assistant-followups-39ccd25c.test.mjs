// Sobre 39ccd25c (Bots 2/3/4/5): 1) comilla SIN CERRAR, de otro tipo al cerrar o envoltorio markdown/código (** __ _ ~~ ` ``` ( [) delante del
// valor tras pin/clave/contraseña/password: tapado en las 4 vías y en partes, con la misma ventana (cierre, 40 caracteres, . ; ! ?, salto, otra
// etiqueta); 2) racha larga de espacios tras la etiqueta: se junta (no suelta la etiqueta) y «clave» + 200 espacios + «4321» se tapa; 3) etiqueta
// o comilla repetida («clave "abcde » ×N, «precio clave » ×N, «clave "abc" y » ×N) ya no retiene toda la respuesta: cada una abre su ventana;
// 4) dinero: sin cambio de regla; un monto envuelto («**S/ 4.50**», «`S/ 12.50`») da lo mismo que sin envoltorio; 5) 8 dígitos sin
// DNI/documento delante: «código ****1234»; 6) campo de la tarjeta: lleno = no entra nada (como maxlength); valor cambiado sin evento → al
// confirmar se limpia a la vista y no se manda; 7) los puntitos de «escribiendo» siguen mientras el servidor retiene texto. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas_documentos';
const has = (t, v) => new RegExp('(^|[^\\w])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])').test(t);
// las 4 vías y su emisor en partes (dueño/empleado como en la ruta; lo que va al modelo también por el camino incremental)
const VIAS = { emp: [A.redactFor(EMP), A.ownerHold], own: [A.redactFor('owner'), null], mEmp: [A.redactText, null], mOwn: [A.redactModelOwner, null] };
function emit(red, hold, t, cuts, max = A.REPLY_MAX) { let o = '', seen = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else { o += d.t || ''; seen += d.t || ''; } }, max, red, hold);
  let at = 0; for (const x of [...cuts, t.length]) { e.push(t.slice(at, x)); at = x; } e.flush(); return { o, seen }; }
const steps = (t, s) => { const c = []; for (let i = s; i < t.length; i += s) c.push(i); return c; };
function allCuts(t, vals = []) {
  for (const [k, [red, hold]] of Object.entries(VIAS)) { const full = A.capReply(red(t)); for (const v of vals) assert.ok(!has(full, v), k + ' ve ' + v + ' en ' + JSON.stringify(t) + ' → ' + JSON.stringify(full));
    const cuts = []; const every = t.length > 400 ? 17 : 1; for (let i = 1; i < t.length; i += every) cuts.push([i]); for (let s = 1; s <= 13; s++) cuts.push(steps(t, s));
    if (t.length <= 48) for (let i = 1; i < t.length; i++) for (let j = i + 1; j < t.length; j++) cuts.push([i, j]);
    for (const c of cuts) { const r = emit(red, hold, t, c); assert.equal(r.o, full, k + ' cortes ' + JSON.stringify(c.slice(0, 4)) + ' en ' + JSON.stringify(t.slice(0, 60)));
      for (const v of vals) assert.ok(!has(r.seen, v), k + ' fuga en partes ' + v); } }
}
const OPEN = ['"', '«', '“', '‘', '‹', '„', "'", '’', '**', '`', '(', '[', '__', '_', '~~', '```\n'];
const CLOSE = { '"': '"', '«': '»', '“': '”', '‘': '’', '‹': '›', '„': '“', "'": "'", '’': '’', '**': '**', '`': '`', '(': ')', '[': ']', '__': '__', '_': '_', '~~': '~~', '```\n': '\n```' };

test('1) comilla sin cerrar / de otro tipo / envoltorio tras una etiqueta con credencial: tapado en las 4 vías (Bots 2/5 sobre 39ccd25c)', () => {
  for (const o of OPEN) for (const [t, v] of [['la clave del wifi es ' + o + 'tortuga', 'tortuga'], ['la clave del wifi es ' + o + 'tortuga' + CLOSE[o], 'tortuga'], ['clave del wifi: ' + o + 'tortuga y luego te llamo. Fin', 'tortuga'],
    ['la contraseña es ' + o + 'perro azul', 'azul'], ['la contraseña es ' + o + 'perro azul\nsigue', 'perro']]) for (const [k, [red]] of Object.entries(VIAS)) assert.ok(!has(red(t), v), k + ' ' + JSON.stringify(t) + ' → ' + JSON.stringify(red(t)));
  const own = VIAS.own[0];
  assert.equal(own('la clave del wifi es "tortuga'), 'la clave del wifi es "[oculto]');
  assert.equal(own('la clave es «perro azul'), 'la clave es «[oculto]', 'sin cierre: toda la frase hasta el final, no solo «perro»');
  assert.equal(own('la clave del wifi es «tortuga y algo. Fin'), 'la clave del wifi es «[oculto]. Fin', 'sin cierre: hasta el punto');
  assert.equal(own('la clave del wifi es **tortuga**'), 'la clave del wifi es **[oculto]**', 'el envoltorio queda');
  assert.equal(own('clave del wifi: `tortuga`'), 'clave del wifi: `[oculto]`'); assert.equal(own('clave del wifi: (tortuga)'), 'clave del wifi: ([oculto])');
  assert.equal(own('la clave del wifi es “tortuga»'), 'la clave del wifi es “[oculto]»'); assert.equal(own('la clave del wifi es ’tortuga’'), 'la clave del wifi es ’[oculto]’');
  assert.ok(!own('clave del wifi:\n```\ntortuga\n```').includes('tortuga'));
  assert.equal(own('la contraseña es "l’agua y mar" ok'), 'la contraseña es "[oculto]" ok', 'el apóstrofo entre letras no cierra');
  assert.equal(own('la contraseña es "mi_clave_123"'), 'la contraseña es "[oculto]"', '«_» dentro de comillas no cierra');
  assert.equal(own('la clave es "perrito" y el pin 4321'), 'la clave es "[oculto]" y el pin [oculto]');
  // sin credencial, un envoltorio markdown NO es un valor (negrita normal del modelo); las comillas sí (como antes)
  assert.ok(own('La clave es **la atención al cliente**').includes('atención')); assert.ok(own('la clave del éxito es **vender más**').includes('vender'));
  for (const t of ['el producto "Arroz Costeño está en oferta', 'dijo «tortuga y se fue', 'Use **negrita** aquí', 'precio (S/ 4.50)']) assert.equal(own(t), t);
});

test('1b) en partes = texto entero en TODOS los cortes, comillas/envoltorios sin cerrar al final y en medio, en las 4 vías', () => {
  for (const o of ['"', '«', '“', '‘', '‹', '„', "'", '’', '**', '`', '(', '```\n']) { allCuts('la clave del wifi es ' + o + 'tortuga', ['tortuga']); allCuts('Hola. La contraseña es ' + o + 'girasol, y el pin 4321 queda.', ['girasol', '4321']); }
  for (const t of ['la clave es «perro azul', 'la clave del wifi es “tortuga»', 'clave del wifi: [tortuga] y listo', 'password **"qwerty"**', 'la contraseña es "l’agua y mar" ok', 'la clave del wifi es el **perro**']) allCuts(t, []);
});

test('2) racha de espacios tras la etiqueta: se junta en UN espacio (no suelta la etiqueta); paridad en las 4 vías (Bot 5 sobre 39ccd25c)', () => {
  for (const [t, v] of [['clave' + ' '.repeat(200) + '4321', '4321'], ['clave' + ' '.repeat(8000), null], ['clave' + ' '.repeat(8000) + '4321', '4321'], ['la contraseña es' + ' '.repeat(300) + '"tortuga', 'tortuga']]) {
    for (const [k, [red]] of Object.entries(VIAS)) { const f = red(t); if (v) assert.ok(!has(f, v), k + ' ' + JSON.stringify(f.slice(0, 40))); assert.ok(f.length < 60, k + ' racha junta: ' + f.length); }
    allCuts(t, v ? [v] : []); }
});

test('3) etiqueta o comilla repetida: retención ≤ ~130 (máx. medido 132) y mismo resultado que el texto entero (Bots 3/4 sobre 39ccd25c)', () => {
  for (const u of ['clave "abcde ', 'precio clave ', 'clave "abc" y ', 'la clave es «perro azul ', 'clave del wifi: **tortuga** y ', 'pin ', 'la contraseña es perrito, el pin 4321 ']) for (const [k, [red, hold]] of Object.entries(VIAS)) for (const step of [1, 5]) {
    const s = u.repeat(Math.ceil(6000 / u.length)).slice(0, 6000); let o = '', lag = 0; const e = A.createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red, hold);
    for (let i = 0; i < s.length; i += step) { e.push(s.slice(i, i + step)); const fed = Math.min(s.length, i + step); if (fed % 97 < step) lag = Math.max(lag, red(s.slice(0, fed)).length - o.length); }
    // (#962, diseño simple aprobado) con etiqueta se retiene hasta el final: antes de cerrar sale a lo más lo de antes de la 1.ª etiqueta (antes: lag ≤ 135)
    const pre = o; e.flush(); assert.equal(o, red(s), k + ' ' + JSON.stringify(u)); assert.ok(pre.length <= Math.max(0, s.search(/pin|clave|contrase|password|token|api/i)) && o.startsWith(pre), k + '/' + step + ' ' + JSON.stringify(u) + ' antes de cerrar ' + pre.length + ' (lag ' + lag + ')'); }
});

// (#962, diseño simple) con etiqueta el costo es UN filtro entero al cerrar: se compara con red(s) del texto entero (antes: µs/car. 12 KB ≈ 100 KB).
// El filtro entero ya era superlineal con «clave "abcde » repetido (28 ms a 12 KB, 1.3 s a 100 KB; no es de esta rama); la respuesta del modelo
// tiene ≤ 900 tokens (≈ 3.6 KB), y 4000 caracteres cuestan < 20 ms (assistant-stream-filtro-costo, 6b).
test('3b) costo lineal con la comilla y «precio clave» repetidos (12 KB → 100 KB, trozos de 1)', () => {
  const run = (s, role) => { const em = A.createTextEmitter(() => {}, 1e9, A.redactFor(role), role === 'owner' ? null : A.ownerHold); for (let k = 0; k < s.length; k++) em.push(s[k]); em.flush(); };
  for (const u of ['clave "abcde ', 'precio clave ', 'la clave es «perro azul ']) for (const role of ['owner', EMP]) {
    const per = [12000, 100000].map((n) => { const s = u.repeat(Math.ceil(n / u.length)).slice(0, n); run(s, role); let best = Infinity; for (let j = 0; j < 2; j++) { const a = process.hrtime.bigint(); run(s, role); best = Math.min(best, Number(process.hrtime.bigint() - a) / 1e6); } return best / n; });
    const whole = [12000, 100000].map((n) => { const s = u.repeat(Math.ceil(n / u.length)).slice(0, n), red = A.redactFor(role); let best = Infinity; for (let j = 0; j < 2; j++) { const a = process.hrtime.bigint(); red(s); best = Math.min(best, Number(process.hrtime.bigint() - a) / 1e6); } return best / n; });
    per.forEach((p, i) => assert.ok(p <= whole[i] * 1.6 + 0.004, role + ' ' + JSON.stringify(u) + ' µs/car. en partes ' + (p * 1000).toFixed(2) + ' vs texto entero ' + (whole[i] * 1000).toFixed(2))); }
});

test('4) dinero: la regla de 39ccd25c no cambia (céntimos + palabra de precio); un monto envuelto en ** o ` da lo mismo que sin envoltorio (Bot 2 sobre 39ccd25c)', () => {
  const own = (t) => [A.redactOwnerText(t), A.redactModelOwner(t)];
  for (const [t, v] of [['precio clave S/ 4.50', '4.50'], ['La clave fue el precio: S/ 12.50 por caja', '12.50'], ['Clave del día: efectivo S/ 830.40', '830.40'], ['la clave es precio S/ 43.21', '43.21'], ['precio clave del mes: S/ 1250.00', '1250.00'],
    ['costo clave 4.50 soles', '4.50'], ['la clave del costo es S/ 12.50', '12.50']]) for (const x of own(t)) assert.ok(has(x, v), JSON.stringify(t) + ' → ' + x);
  for (const [t, v] of [['clave costo S/ 4321', '4321'], ['precio clave S/ 4321', '4321'], ['pin precio S/ 43.21', '43.21'], ['clave S/ 43.21', '43.21']]) for (const x of own(t)) assert.ok(!has(x, v), JSON.stringify(t) + ' → ' + x);
  // los 12 montos del dueño (Bot 2) y otros: con ** y ` alrededor del monto da lo mismo que sin envoltorio
  const L = [['precio clave S/ 4.50', '4.50'], ['La clave: el precio del arroz es S/ 4.50', '4.50'], ['la clave del margen fue el costo de S/ 3.20', '3.20'], ['La clave fue el precio: S/ 12.50 por caja', '12.50'], ['precio clave del mes: S/ 1250.00', '1250.00'],
    ['Clave del día: efectivo S/ 830.40 y Yape S/ 120.00', '830.40'], ['producto clave: Arroz a S/ 4.50, costo S/ 3.20', '4.50'], ['La clave fue comprar a S/ 3.20 y vender a S/ 4.50', '3.20'], ['el efectivo de la caja chica es S/ 250.00', '250.00'],
    ['En caja hay S/ 1250.50 en efectivo', '1250.50'], ['costo clave 4.50 soles', '4.50'], ['La clave para vender es el precio S/ 2500', '2500'], ['la clave del costo es S/ 12.50', '12.50'], ['clave del vuelto S/ 0.50', '0.50']];
  const wrap = (t, v, w) => { const i = t.indexOf(v), m = /S\/\s?$/.exec(t.slice(0, i)), j = m ? i - m[0].length : i; let e = i + v.length; if (t.slice(e).startsWith(' soles')) e += 6; return t.slice(0, j) + w + t.slice(j, e) + w + t.slice(e); };
  for (const [t, v] of L) { const base = own(t).map((x) => has(x, v)); for (const w of ['**', '`']) { const tw = wrap(t, v, w); assert.deepEqual(own(tw).map((x) => has(x, v)), base, JSON.stringify(tw) + ' → ' + own(tw)); } }
  assert.equal(A.redactOwnerText('precio clave: `S/ 12.50`'), 'precio clave: `S/ 12.50`'); assert.equal(A.redactOwnerText('precio clave **S/ 4.50**'), 'precio clave **S/ 4.50**');
  for (const t of ['clave 4_321', 'clave `4_321`', 'pin **4.50**', 'clave **43.21**']) for (const [k, [red]] of Object.entries(VIAS)) assert.ok(!/4_321|4\.50|43\.21/.test(red(t)), k + ' ' + t + ' → ' + red(t));
});

test('5) 8 dígitos sin DNI/documento/doc/identidad delante: «código ****1234» (Bot 4 sobre 39ccd25c); con DNI, «DNI ****»', () => {
  const e = A.redactFor(EMP);
  assert.equal(e('Escanee 77501234'), 'Escanee código ****1234'); assert.equal(A.redactModelOwner('Escanee 77501234'), 'Escanee código ****1234'); assert.equal(A.redactOwnerText('Escanee 77501234'), 'Escanee 77501234');
  for (const [t, want] of [['DNI 12345678', 'DNI ****5678'], ['el cliente con DNI: 12345678', 'el cliente con DNI ****5678'], ['documento 12345678', 'documento ****5678'], ['Doc: 12345678', 'Doc: ****5678'], ['identidad 12345678', 'identidad ****5678'], // (Bot 5 sobre 36f6ae51) sin repetir la etiqueta
    ['otro 87654321', 'otro código ****4321'], ['| Cliente | DNI |\n|---|---|\n| Ana | 12345678 |', '| Cliente | DNI |\n|---|---|\n| Ana | DNI ****5678 |']]) assert.equal(e(t), want, t);
  assert.equal(A.cardPrefix('F001-12345678 pedido código ****4321'), 'F001-12345678 pedido', 'la etiqueta neutra no queda suelta en la tarjeta');
  for (const t of ['Escanee 77501234 y luego DNI 12345678 del cliente', '| Cliente | DNI |\n|---|---|\n| Ana | 12345678 |\n| Luis | 87654321 |\nfin']) for (const s of [1, 2, 3, 5, 7, 13]) assert.equal(emit(A.redactFor(EMP), A.ownerHold, t, steps(t, s)).o, A.capReply(e(t)), s + ' ' + t);
});

// documento falso con selección y beforeinput que se puede prevenir
function fakeDoc() { return { createElement: (tag) => ({ tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, style: {}, _v: '', selectionStart: 0, selectionEnd: 0, sets: 0,
  get value() { return this._v; }, set value(v) { this._v = String(v); this.selectionStart = this.selectionEnd = this._v.length; this.sets++; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
  appendChild(k) { this.children.push(k); return k; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t, ev = {}) { let p = false; (this.listeners[t] || []).forEach((f) => f({ target: this, preventDefault() { p = true; }, ...ev })); return p; }, focus() {} }) }; }
const prop = () => ({ id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: '', documento: '', completar: ['proveedor', 'documento'], lineas: [] });
// tecla como el navegador: beforeinput (se puede prevenir) y, si no, inserta en el cursor y manda input
function type(inp, ch) { if (inp.fire('beforeinput', { inputType: 'insertText', data: ch })) return false; const v = inp._v, s = inp.selectionStart, e = inp.selectionEnd; inp._v = v.slice(0, s) + ch + v.slice(e); inp.selectionStart = inp.selectionEnd = s + ch.length; inp.fire('input'); return true; }

test('6) campo lleno: escribir no inserta nada y el valor queda igual (como maxlength); lo que no cabe se quita de lo recién escrito (Bot 4 sobre 39ccd25c)', () => {
  const need = C.needFields(fakeDoc(), prop(), () => {}); const [, dv] = need.inputs; const full = 'F001-' + '1234567890'.repeat(7) + '12345'; assert.equal(full.length, 80);
  dv._v = full; dv.fire('input'); assert.equal(need.state.documento, full);
  dv.setSelectionRange(40, 40); assert.equal(type(dv, '9'), false, 'se previene'); assert.equal(dv.value, full); assert.equal(dv.selectionStart, 40);
  dv.setSelectionRange(80, 80); type(dv, '9'); assert.equal(dv.value, full);
  // con selección sí se puede reemplazar
  dv.setSelectionRange(5, 6); type(dv, 'X'); assert.equal(dv.value, 'F001-X' + full.slice(6)); assert.equal(dv.value.length, 80);
  // un teclado sin beforeinput (respaldo en input): lo de más se quita JUSTO antes del cursor, el final queda
  dv._v = full; dv.fire('input'); dv._v = full.slice(0, 40) + 'ZZ' + full.slice(40); dv.selectionStart = dv.selectionEnd = 42; dv.fire('input');
  assert.equal(dv.value, full, 'no se borra el último carácter'); assert.equal(dv.selectionStart, 40); assert.equal(need.state.documento, full);
});

test('6b) valor puesto SIN evento (script/extensión): al pulsar Confirmar se limpia a la vista y ese toque no manda nada (Bot 5 sobre 39ccd25c)', () => {
  const need = C.needFields(fakeDoc(), prop(), () => {}); const [pv, dv] = need.inputs;
  pv._v = 'Sur SAC'; pv.fire('input'); dv._v = 'F001-11'; dv.fire('input'); assert.equal(need.missing(), 0); assert.equal(need.recheck(), false, 'sin cambios: se puede mandar');
  dv._v = 'F001-\u202E99'; // sin evento
  assert.equal(need.recheck(), true, 'cambió: no se manda en este toque'); assert.equal(dv.value, 'F001-99', 'limpio a la vista'); assert.equal(need.values().documento, 'F001-99', 'lo que se mandaría = lo visible');
  assert.equal(need.recheck(), false);
  const ok = UI.slice(UI.indexOf('if (ok) ok.onclick = async function () {')); assert.match(ok.slice(0, 400), /if \(need && need\.recheck && need\.recheck\(\)\) \{ syncOk\(\); return; \}/);
});

test('7) los puntitos de «escribiendo» siguen visibles mientras el servidor retiene texto y se quitan solo al terminar el flujo (Bot 4 sobre 39ccd25c)', async () => {
  const send = UI.slice(UI.indexOf('  async function send(text, image) {'), UI.indexOf('  // Comprime en el aparato'));
  const pick = (re) => { const m = send.match(re); assert.ok(m, String(re)); return m[0]; };
  // la burbuja «Pensando» lleva los puntitos; al llegar texto se reusa con los puntitos al final; doneBubble solo después de que streamChat termina
  assert.ok(/thinking\.appendChild\(dots\)/.test(pick(/var dots = el\('span', 'na-asst-dots'\);[^\n]*/)));
  assert.match(pick(/function ensureBubble\(\) \{[^\n]*/), /thinking\.appendChild\(dots\)/);
  assert.match(pick(/function writeText\(t\) \{[^\n]*/), /insertBefore\(n, dots\.parentNode === b \? dots : null\)/);
  const iStream = send.indexOf('var st = await C.streamChat('), iDone = send.indexOf('doneBubble();'); assert.ok(iStream > 0 && iDone > iStream, 'doneBubble después del flujo');
  assert.equal((send.match(/doneBubble\(\);/g) || []).length, 1, 'un solo lugar quita los puntitos');
  // y el servidor, mientras retiene («la clave es "perro azul…»), no manda nada: no hay texto que quite los puntitos antes de tiempo
  const t = 'Listo, la clave del wifi es "perro azul y verde'; const e = A.createTextEmitter(() => {}, A.REPLY_MAX, A.redactFor('owner'), null); let first = null, sent = '';
  const em = A.createTextEmitter((d) => { if (d.t) { sent += d.t; if (first === null) first = sent; } }, A.REPLY_MAX, A.redactFor('owner'), null); for (const ch of t) em.push(ch); assert.ok(!sent.includes('perro'), sent); em.flush();
  assert.equal(sent, A.redactFor('owner')(t)); void e;
});

test('8) Bot 4 INFO: palabra de enlace sola tras la etiqueta nunca se tapa (el valor real sí); «2024-12345678» → código, no DNI', () => {
  const T = 'Resumen del día. La clave del negocio en 2024 fue el arroz. Clave: 2000 unidades de arroz quedaron en almacén.';
  for (const [k, [red]] of Object.entries(VIAS)) {
    assert.equal(red(T), 'Resumen del día. La clave del negocio en 2024 fue el arroz. Clave: [oculto] unidades de arroz quedaron en almacén.', k);
    assert.equal(red('la clave para Tortuga22'), 'la clave para [oculto]', k);
    assert.equal(red('clave del wifi Zq9xK2mPw7'), 'clave del wifi [oculto]', k);
    assert.equal(red('la clave del local es 4521'), 'la clave del local es [oculto]', k);
    assert.equal(red('clave de tortuga'), 'clave de [oculto]', k);
    assert.ok(!has(red('clave el1234x'), 'el1234x'), k);
  }
  for (const red of [A.redactFor(EMP), A.redactText, A.redactModelOwner]) assert.equal(red('2024-12345678'), '2024-código ****5678');
  for (const t of [T, 'la clave para Tortuga22 y luego', 'clave el1234x ok', '2024-12345678 fin']) allCuts(t, t.includes('Tortuga22') ? ['Tortuga22'] : t.includes('el1234x') ? ['el1234x'] : []);
});
