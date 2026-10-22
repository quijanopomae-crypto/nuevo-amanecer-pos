// Sobre 36f6ae51 (Bot 2 INFORME 36f6ae51, Bot 5 ev-36f6ae51): 1) F1 salto de línea (y espacios) entre la comilla/envoltorio y el valor, con
// \n y \r\n, para TODAS las aperturas; 2) F2 ventana de 80 desde el valor y, sin cierre, hasta el final de la palabra (≤ +20): sin cola a la
// vista; comillas cerradas de 41–80 caracteres tapadas enteras; 3) cabecera con hasta 200 espacios (tab, NBSP, em) antes de la comilla;
// 4) bloque de código con lenguaje y «```valor```»; etiquetas HTML; 5) separadores -> => → — – |, cita «:\n>», «es para/en/de + valor»;
// 6) invisibles (U+200B…) en la racha de espacios tras la etiqueta; tope de la racha 120; 7) la palabra de precio nunca se tapa; 8) «documento
// ****5678» sin repetir la etiqueta; 9) dinero del dueño igual en tablas y con flechas; 10) campo con foco: tras un valor puesto por script el
// primer toque no manda. Todo en las 4 vías y en partes (todos los cortes). Sin red.
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

// documento falso con selección y beforeinput que se puede prevenir
function fakeDoc() { return { createElement: (tag) => ({ tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, style: {}, _v: '', selectionStart: 0, selectionEnd: 0, sets: 0,
  get value() { return this._v; }, set value(v) { this._v = String(v); this.selectionStart = this.selectionEnd = this._v.length; this.sets++; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
  appendChild(k) { this.children.push(k); return k; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t, ev = {}) { let p = false; (this.listeners[t] || []).forEach((f) => f({ target: this, preventDefault() { p = true; }, ...ev })); return p; }, focus() {} }) }; }
const prop = () => ({ id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: '', documento: '', completar: ['proveedor', 'documento'], lineas: [] });
// tecla como el navegador: beforeinput (se puede prevenir) y, si no, inserta en el cursor y manda input
function type(inp, ch) { if (inp.fire('beforeinput', { inputType: 'insertText', data: ch })) return false; const v = inp._v, s = inp.selectionStart, e = inp.selectionEnd; inp._v = v.slice(0, s) + ch + v.slice(e); inp.selectionStart = inp.selectionEnd = s + ch.length; inp.fire('input'); return true; }

const OPEN9 = ['"', '«', '“', '‘', '‹', '„', '‚', "'", '’', '»', '”', '**', '***', '__', '_', '*', '~~', '`', '``', '```', '(', '[', '<b>', '<code>', '<strong>', '<em>', '<i>', '**"'];
const LONGV = 'perro azul verde amarillo rojo naranja morado gris';

test('1) F1: espacios y UN salto (\\n o \\r\\n) entre la apertura y el valor: tapado en las 4 vías y en todos los cortes, para cada apertura (Bot 2 sobre 36f6ae51)', () => {
  for (const o of OPEN9) for (const nl of ['\n', '\r\n', ' \n ', '  \r\n\t']) {
    allCuts('la clave del wifi es ' + o + nl + 'tortuga', ['tortuga']);
    const t = 'password: ' + o + nl + 'perro azul y fin'; for (const [k, [red]] of Object.entries(VIAS)) { const f = red(t); assert.ok(!has(f, 'perro') && f.includes('[oculto]'), k + ' ' + JSON.stringify(f)); }
  }
  assert.equal(A.redactText('la clave del wifi es «\ntortuga»'), 'la clave del wifi es «\n[oculto]»');
  assert.equal(A.redactOwnerText('la clave del wifi es "\r\ntortuga"'), 'la clave del wifi es "\r\n[oculto]"');
});

test('2) F2: sin cierre se tapa hasta 80 caracteres desde el valor y luego hasta el final de la palabra (≤ +20): ninguna cola a la vista; cerrada de 41–80 entera', () => {
  for (const o of ['"', '«', '**', '`', '(']) {
    const t = 'la clave del wifi es ' + o + LONGV; for (const [k, [red]] of Object.entries(VIAS)) { const f = red(t); assert.equal(f, 'la clave del wifi es ' + o + '[oculto]', k); }
    allCuts(t + ' blanco negro celeste rosado', ['perro', 'gris', 'orado', 'blanco']);
  }
  // cerrada entre 41 y 80 caracteres: todo lo de dentro (Bot 5: antes «"[oculto]nco gris"»)
  assert.equal(A.redactText('la clave del wifi es "' + LONGV + ' blanco"'), 'la clave del wifi es "[oculto]"');
  // la palabra que cruza los 80 se tapa entera
  // (r10, Bot 2 sobre f773911f) con la supresión, sin cierre ni fin de frase se tapa hasta el final (antes quedaba « y sigue»)
  const w = 'clave: "' + 'abcd '.repeat(15) + 'supercalifragilistico y sigue'; const f = A.redactText(w); assert.ok(!/abcd|supercal|istico/.test(f), f); assert.equal(f, 'clave: "[oculto]');
  // nunca hasta el final del texto: con . ; ! ? (seguido de espacio) o salto se para antes, como siempre
  assert.equal(A.redactText('contraseña: "tortuga. Luego vamos'), 'contraseña: "[oculto]. Luego vamos');
});

test('3) cabecera con 17–200 espacios (tab, NBSP, em) antes de la comilla: tapado en las 4 vías y en partes (Bot 5 sobre 36f6ae51, regresión vs 39ccd25c)', () => {
  for (const [n, c] of [[17, ' '], [160, ' '], [200, '\t'], [180, '\u00a0'], [161, '\u2003']]) allCuts('clave del wifi:' + c.repeat(n) + '"tortuga"', ['tortuga']);
});

test('4) bloque de código con lenguaje, «```valor```» y etiquetas HTML de formato (Bot 5 sobre 36f6ae51)', () => {
  for (const [t, want] of [['clave del wifi:\n```text\ntortuga\n```', 'clave del wifi:\n```text\n[oculto]\n```'], ['clave del wifi: ```tortuga```', 'clave del wifi: ```[oculto]```'],
    ['la clave del wifi es <b>tortuga</b>', 'la clave del wifi es <b>[oculto]</b>'], ['la clave del wifi es <code>tortuga</code>', 'la clave del wifi es <code>[oculto]</code>'],
    ['contraseña: <strong>tortuga</strong>', 'contraseña: <strong>[oculto]</strong>']]) { for (const [k, [red]] of Object.entries(VIAS)) assert.equal(red(t), want, k + ' ' + JSON.stringify(t)); allCuts(t, ['tortuga']); }
});

test('5) separadores -> => → — – |, cita «:\\n>» y «es para/en/de» + valor; la palabra de enlace sola sigue visible (Bot 5 sobre 36f6ae51)', () => {
  for (const [t, v] of [['la clave es para Tortuga22', 'Tortuga22'], ['la contraseña es en Tortuga', 'Tortuga'], ['la clave del wifi es de Tortuga', 'Tortuga'], ['clave del wifi:\n> tortuga', 'tortuga'],
    ['| clave del wifi | tortuga |', 'tortuga'], ['clave del wifi -> tortuga', 'tortuga'], ['clave del wifi => tortuga', 'tortuga'], ['clave del wifi → tortuga', 'tortuga'], ['clave del wifi — tortuga', 'tortuga'],
    ['clave del wifi – tortuga', 'tortuga'], ['password:\n> tortuga', 'tortuga'], ['password es en Tortuga', 'Tortuga'], ['pin:\n> 4321', '4321']]) allCuts(t, [v]);
  assert.equal(A.redactText('la clave es para Tortuga22'), 'la clave es para [oculto]');
  assert.equal(A.redactText('| clave del wifi | tortuga |'), '| clave del wifi | [oculto] |');
  for (const t of ['la clave es para', 'la clave: de', 'la contraseña es para', 'la contraseña es para proteger tu cuenta', 'La clave del negocio en 2024 fue el arroz', '| Clave | Valor |\n|---|---|\n| wifi | tortuga |'])
    for (const [k, [red]] of Object.entries(VIAS)) assert.equal(red(t), t, k + ' ' + JSON.stringify(t));
});

test('6) invisibles (U+200B…) en la racha tras la etiqueta y tope de la racha 120: tapado, paridad, retención acotada (Bots 2/5 sobre 36f6ae51)', () => {
  for (const t of ['clave:' + ' \n\u200b'.repeat(70) + '4321', 'pin' + '\u200b'.repeat(200) + '4321', 'clave:' + ' \u200b'.repeat(50) + '4321', 'clave:' + '\ufeff \u2060 '.repeat(60) + '4321', 'pin' + ' '.repeat(500) + '4321']) allCuts(t, ['4321']);
  // los invisibles fuera de una racha tras la etiqueta no se tocan
  assert.equal(A.redactOwnerText('Arroz\u200b y azúcar'), 'Arroz\u200b y azúcar');
  // retención real (lo filtrado del prefijo menos lo emitido) con «pin» + 500 espacios + «4321», trozos de 1 y 5
  const t = ('pin' + ' '.repeat(500) + '4321 y sigue el texto normal. ').repeat(4);
  for (const [k, [red, hold]] of Object.entries(VIAS)) for (const step of [1, 5]) { let o = '', lag = 0, inq = 0; const e = A.createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red, hold);
    for (let i = 0; i < t.length; i += step) { e.push(t.slice(i, i + step)); const fed = Math.min(t.length, i + step); lag = Math.max(lag, red(t.slice(0, fed)).length - o.length); }
    const pre = o; e.flush(); assert.equal(o, red(t), k); assert.ok(pre.length <= Math.max(0, t.search(/pin|clave|contrase|password|token|api/i)) && o.startsWith(pre), k + '/' + step + ' antes de cerrar ' + pre.length + ' (lag ' + lag + ')'); } // (#962, diseño simple) antes: lag ≤ 170 // (auditoría 2026-10-22, ALTA) 130 -> 170: cerca de una etiqueta todo corte espera
  // su palabra entera y la prueba de texto entero (ver nearOnly); medido 161 en el empleado, fijo (no crece con más vueltas)
});

test('7) la palabra de precio nunca se tapa: «la clave es precio S/ 43.21» queda igual; el número entero sigue tapado (Bot 2 sobre 36f6ae51, INFO)', () => {
  for (const [k, [red]] of Object.entries(VIAS)) { assert.equal(red('la clave es precio S/ 43.21'), 'la clave es precio S/ 43.21', k); assert.equal(red('la clave es costo'), 'la clave es costo', k);
    assert.equal(red('la clave es precio 4321'), 'la clave es precio [oculto]', k); assert.equal(red('pin precio S/ 43.21'), 'pin precio S/ [oculto]', k); }
  allCuts('la clave es precio S/ 43.21 y listo', []);
});

test('8) «documento/doc/identidad» justo delante: sin repetir la etiqueta («documento ****5678»); más lejos o con DNI como siempre (Bot 5 sobre 36f6ae51)', () => {
  const e = A.redactFor(EMP);
  for (const [t, want] of [['documento 12345678', 'documento ****5678'], ['identidad: 12345678', 'identidad: ****5678'], ['Doc. 12345678', 'Doc. ****5678'], ['DNI: 12345678', 'DNI ****5678'],
    ['documento del cliente 12345678', 'documento del cliente DNI ****5678'], ['Escanee 77501234', 'Escanee código ****1234']]) { assert.equal(e(t), want, t); assert.equal(A.redactModelOwner(t), want, 'modelo ' + t); }
  assert.equal(A.redactOwnerText('documento 12345678'), 'documento 12345678', 'el dueño lo ve');
});

test('9) dinero del dueño (Bot 2): los 12 montos dan lo mismo en texto plano, en tabla y con flecha (9/12 visibles) y los 5 precios normales intactos', () => {
  const L = [['precio clave S/ 4.50', 1], ['La clave: el precio del arroz es S/ 4.50', 1], ['la clave del margen fue el costo de S/ 3.20', 1], ['La clave fue el precio: S/ 12.50 por caja', 1], ['precio clave del mes: S/ 1250.00', 1],
    ['Clave del día: efectivo S/ 830.40 y Yape S/ 120.00', 1], ['producto clave: Arroz a S/ 4.50, costo S/ 3.20', 1 /* (r10, Bots 2/5 sobre f773911f) excepción del adjetivo: «producto clave» + moneda con céntimos se ve (10/12) */], ['La clave fue comprar a S/ 3.20 y vender a S/ 4.50', 0], ['el efectivo de la caja chica es S/ 250.00', 1],
    ['En caja hay S/ 1250.50 en efectivo', 1], ['costo clave 4.50 soles', 1], ['La clave para vender es el precio S/ 2500', 0], ['Arroz a S/ 4.50', 1], ['El azúcar cuesta S/ 3.20', 1], ['Precio de venta: S/ 12.50', 1],
    ['Total del día S/ 1,250.00', 1], ['Aceite **S/ 9.90**', 1]];
  const amt = (t) => /(?:S\/\s?)?(\d[\d.,]*\d)(?: soles)?/.exec(t);
  for (const [t, vis] of L) { const m = amt(t), j = m.index, v = m[1];
    for (const x of [t, '| ' + t.slice(0, j).replace(/[\s:]+$/, '') + ' | ' + t.slice(j) + ' |', t.slice(0, j).replace(/[\s:]+$/, '') + ' → ' + t.slice(j), '| Producto | Precio |\n|---|---|\n| ' + t.slice(0, j).replace(/[\s:]+$/, '') + ' | ' + t.slice(j) + ' |'])
      for (const red of [A.redactOwnerText, A.redactModelOwner]) assert.equal(has(red(x), v), !!vis, JSON.stringify(x) + ' → ' + JSON.stringify(red(x))); }
});

test('10) campo con foco: el clic saca el foco antes; si el blur encuentra un valor puesto por script, el primer toque de Confirmar no manda (Bot 5 sobre 36f6ae51)', () => {
  const need = C.needFields(fakeDoc(), prop(), () => {}); const [pv, dv] = need.inputs;
  pv._v = 'Sur SAC'; pv.fire('input'); dv._v = 'F001-11'; dv.fire('input'); assert.equal(need.recheck(), false);
  dv._v = 'F001-\u202E99'; dv.fire('blur'); // el mousedown en Confirmar saca el foco: el blur limpia y recalcula
  assert.equal(dv.value, 'F001-99', 'limpio a la vista'); assert.equal(need.recheck(), true, 'primer toque: no manda'); assert.equal(need.recheck(), false, 'segundo toque: manda lo visible');
  assert.equal(need.values().documento, 'F001-99');
  // una entrada real borra la marca; un blur sin cambio no la pone
  dv._v = 'F001-77'; dv.fire('blur'); type(dv, '8'); assert.equal(need.recheck(), false, 'tras escribir de verdad se puede mandar');
  dv.fire('blur'); assert.equal(need.recheck(), false, 'blur sin cambio');
  // sin ninguna entrada antes: valor puesto por script sobre el inicio que trajo la propuesta
  const n2 = C.needFields(fakeDoc(), prop(), () => {}); const [p2, d2] = n2.inputs; d2._v = 'F001-55'; d2.fire('blur'); assert.equal(n2.recheck(), true, 'sin entrada previa: tampoco manda en el primer toque');
});

test('11) retención con la comilla repetida y los casos nuevos: acotada (≤ 135; con 150 espacios en la cabecera ≤ 310) y en partes = texto entero (trozos 1 y 5, 6000 caracteres)', () => {
  for (const u of ['clave "\nabcde ', 'la clave es "' + LONGV + ' ', 'clave del wifi:' + ' '.repeat(150) + '"perro" y ', 'clave del wifi → tortuga, ', 'clave "abcde ']) for (const [k, [red, hold]] of Object.entries(VIAS)) for (const step of [1, 5]) {
    const s = u.repeat(Math.ceil(6000 / u.length)).slice(0, 6000); let o = '', lag = 0; const e = A.createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red, hold);
    for (let i = 0; i < s.length; i += step) { e.push(s.slice(i, i + step)); const fed = Math.min(s.length, i + step); if (fed % 97 < step) lag = Math.max(lag, red(s.slice(0, fed)).length - o.length); }
    const pre = o; e.flush(); assert.equal(o, red(s), k + ' ' + JSON.stringify(u.slice(0, 30))); // (#962, diseño simple) antes: lag ≤ 135 / 310
    assert.ok(pre.length <= Math.max(0, s.search(/pin|clave|contrase|password|token|api/i)) && o.startsWith(pre), k + '/' + step + ' ' + JSON.stringify(u.slice(0, 30)) + ' antes de cerrar ' + pre.length + ' (lag ' + lag + ')'); }
});
