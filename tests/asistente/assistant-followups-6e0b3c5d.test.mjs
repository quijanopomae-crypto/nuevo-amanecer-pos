// Sobre 6e0b3c5d (Bots 5/2/3/4): 1) clave entre comillas tapada; 2) miles («4.321», «12.345», «1.234.567», «4,321», «4 321») como una pieza;
// 3) en partes = texto entero en TODOS los cortes (decimales/miles + unidad, «precio clave», comillas); 4) campo de la tarjeta: composición sin
// compositionend no deja «Confirmar» encendido con lo crudo a la vista, blur limpia, maxLength después de limpiar; 5) «negocio» (débil), artículo
// tras «:», año tras «,»; 6) etiqueta neutra «código ****1234» para 8 dígitos junto a código/EAN/barras; 7) dinero (regla final): solo montos con
// céntimos y palabra de precio justo antes, enteros siempre tapados, unidad no suelta con credencial ni pegada a la etiqueta; 8) Bot 3: una etiqueta
// repetida sin punto ya no retiene todo (tope) y el costo crece lineal; filtro previo sin etiqueta. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const SRC = readFileSync(new URL('../../tools/cloudflare-lab/src/pos-assistant.js', import.meta.url), 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas_documentos';
const has = (t, v) => new RegExp('(^|[^\\w])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])').test(t);
const vias = { emp: A.redactFor(EMP), own: A.redactFor('owner'), mEmp: A.redactText, mOwn: A.redactModelOwner };
function emit(role, t, cuts) { const red = A.redactFor(role); let o = '', seen = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else { o += d.t || ''; seen += d.t || ''; } }, A.REPLY_MAX, red, role === 'owner' ? null : A.ownerHold);
  let at = 0; for (const x of [...cuts, t.length]) { e.push(t.slice(at, x)); at = x; } e.flush(); return { o, seen }; }
const steps = (t, s) => { const c = []; for (let i = s; i < t.length; i += s) c.push(i); return c; };
function hidden(t, vals) {
  for (const [via, f] of Object.entries(vias)) for (const v of vals) assert.ok(!has(f(t), v), via + ' ve ' + v + ' en ' + JSON.stringify(t) + ' → ' + JSON.stringify(f(t)));
  for (const role of [EMP, 'owner']) for (const s of [1, 3, 7]) { const r = emit(role, t, steps(t, s)); for (const v of vals) assert.ok(!has(r.seen, v), role + '/' + s + ' ' + JSON.stringify(t) + ' → ' + r.seen); assert.equal(r.o, A.capReply(A.redactFor(role)(t))); }
}
const ownerSees = (t, v) => { for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.ok(has(f(t), v), JSON.stringify(t) + ' → ' + JSON.stringify(f(t))); };
// paridad en TODOS los cortes de una pieza, todos los pares (textos cortos) y pasos fijos, dueño y empleado
function allCuts(t) {
  for (const role of [EMP, 'owner']) { const full = A.capReply(A.redactFor(role)(t)); const C2 = [];
    for (let i = 1; i < t.length; i++) C2.push([i]); for (const s of [1, 2, 3, 5, 7, 11]) C2.push(steps(t, s));
    if (t.length <= 60) for (let i = 1; i < t.length; i++) for (let j = i + 1; j < t.length; j++) C2.push([i, j]);
    for (const c of C2) assert.equal(emit(role, t, c).o, full, role + ' cortes ' + JSON.stringify(c) + ' en ' + JSON.stringify(t)); }
}

test('1) clave entre comillas (" \' « » “ ” ‘ ’ ‹ › „): tapada en las 4 vías y en partes, con o sin credencial', () => {
  for (const t of ['la clave del wifi es "tortuga"', 'la clave del wifi es «tortuga»', "la clave del wifi es 'tortuga'", 'la clave del wifi es ‘tortuga’', 'la clave del wifi es “tortuga”', 'la clave del wifi es ‹tortuga›', 'la clave del wifi es „tortuga“',
    'clave: «tortuga»', 'la contraseña es "tortuga"', 'el pin es "tortuga"', 'password = "tortuga"', 'la clave del local "tortuga"', 'la clave es « tortuga »', 'la clave del wifi es "tortuga verde"']) hidden(t, ['tortuga']);
  assert.equal(vias.own('la clave del wifi es "tortuga", y el horario sigue'), 'la clave del wifi es "[oculto]", y el horario sigue');
  // lo normal sin etiqueta no cambia
  for (const t of ['el producto "Arroz Costeño" está en oferta', 'dijo «tortuga» y se fue']) assert.equal(vias.own(t), t);
});

test('2) miles como UNA pieza: «clave 4.321», «pin 4.321», «clave 12.345», «pin 1.234.567», «clave 4,321», «clave 4 321», «…caja es 43.210»', () => {
  for (const [t, v] of [['clave 4.321', '4.321'], ['pin 4.321', '4.321'], ['clave 12.345', '12.345'], ['pin 1.234.567', '1.234.567'], ['clave 4,321', '4,321'], ['clave 4 321', '4 321'], ['contraseña 12,345', '12,345'],
    ['la clave de la caja es 43.210', '43.210'], ['pin 1.500 unidades', '1.500'], ['el pin es 4\u00a0321', '4\u00a0321']]) { hidden(t, [v]); assert.ok(!/\d{3}/.test(vias.own(t).replace(/^[^\d]*\[oculto\]/, '')) || !has(vias.own(t), v.split(/[., \u00a0]/).pop()), JSON.stringify(t) + ' → ' + vias.own(t)); }
  // unidad tras miles (sin «:», «=», ser ni credencial, con una palabra en medio): se ve, como el entero
  ownerSees('clave del mes 1.500 bolsas', '1.500'); ownerSees('Producto clave de la semana 2.500 unidades', '2.500');
  // sin etiqueta: los montos y cantidades con miles del dueño no cambian (Bot 2)
  for (const t of ['precio S/ 1.234,50', 'costo 1.250 soles', 'stock 1.200 unidades', 'ventas del mes S/ 12.345', 'En caja hay S/ 1.250,50 en efectivo', 'Total del día: S/ 12.345,60', 'pedido de 1.500 unidades a S/ 4.50']) assert.equal(vias.own(t), t);
});

test('3) en partes = texto entero en TODOS los cortes: decimales/miles + unidad, «precio clave», comillas, etiqueta repetida', () => {
  for (const t of ['clave 2.5 kg', 'clave 12.50 soles', 'clave del arroz 1.5 kg y listo', 'clave 43.21 kg', 'costo clave 4.50 soles', 'precio clave S/ 4.50', 'precio clave del mes: S/ 1250.00', 'la clave 0.5 unidades',
    'clave 4.321 kg', 'clave del mes 1.500 bolsas', 'clave 4 321 kg', 'contraseña 3,75 litros', 'la clave del wifi es "tortuga"', 'la clave del wifi es « tortuga »', 'Código 77501234 listo', 'pin pin pin pin 4321 pin pin',
    'la contraseña es perrito, el pin 4321 la contraseña es perrito, el pin 4321', 'La clave fue el precio: S/ 12.50 por caja']) allCuts(t);
});

test('4) campo de la tarjeta: composición que termina SIN compositionend → «Confirmar» apagado con lo crudo a la vista; blur limpia y enciende', () => {
  const mk = (tag) => { const n = { tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, style: {}, _v: '', selectionStart: 0, selectionEnd: 0,
    get value() { return this._v; }, set value(v) { this._v = String(v); this.selectionStart = this.selectionEnd = this._v.length; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    appendChild(k) { this.children.push(k); return k; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t, ev = {}) { (this.listeners[t] || []).forEach((f) => f({ target: this, ...ev })); }, focus() {} }; return n; };
  const p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: '', documento: '', completar: ['proveedor', 'documento'], lineas: [] };
  let changes = 0; const need = C.needFields({ createElement: mk }, p, () => { changes++; }); const [pv, dv] = need.inputs;
  pv._v = 'Sur SAC'; pv.fire('input'); assert.equal(need.state.proveedor, 'Sur SAC');
  // composición sintética que nunca manda compositionend: el U+202E crudo queda a la vista y NO cuenta
  dv.fire('compositionstart'); dv._v = '\u202E1234-100F'; dv.selectionStart = dv.selectionEnd = dv._v.length; dv.fire('input', { isComposing: true });
  assert.equal(dv.value, '\u202E1234-100F', 'durante la composición no se reescribe'); assert.equal(need.state.documento, '', 'Confirmar apagado: se VE algo distinto de lo que se mandaría');
  assert.equal(need.missing(), 1); assert.equal(dv.attrs['aria-invalid'], 'true');
  // lo escrito después (composing colgado) tampoco cuenta mientras se vea crudo
  dv._v += '9'; dv.fire('input'); assert.equal(need.state.documento, '');
  // al salir del campo: se suelta la composición, se limpia y cuenta
  dv.fire('blur'); assert.equal(dv.value, '1234-100F9'); assert.equal(need.state.documento, '1234-100F9'); assert.equal(need.missing(), 0);
  // y ya no queda «composing»: lo pegado después se limpia al momento
  dv._v += '\u00AD1'; dv.selectionStart = dv.selectionEnd = dv._v.length; dv.fire('input'); assert.equal(dv.value, '1234-100F91');
  // blur sin cambios no rompe nada
  dv.fire('blur'); assert.equal(dv.value, '1234-100F91'); assert.ok(changes > 0);
});

test('4b) campo de la tarjeta: lo pegado con caracteres de formato se limpia ANTES del tope (no queda más corto que NEED_MAX); lo visible = lo enviado', () => {
  const mk = (tag) => { const n = { tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, style: {}, _v: '', selectionStart: 0, selectionEnd: 0, maxLength: -1,
    get value() { return this._v; }, set value(v) { this._v = String(v); this.selectionStart = this.selectionEnd = this._v.length; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    appendChild(k) { this.children.push(k); return k; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t, ev = {}) { (this.listeners[t] || []).forEach((f) => f({ target: this, ...ev })); }, focus() {} }; return n; };
  const p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: '', documento: '', completar: ['proveedor'], lineas: [] };
  const need = C.needFields({ createElement: mk }, p, () => {}); const [pv] = need.inputs;
  assert.ok(pv.maxLength >= 200, 'holgura para los invisibles: ' + pv.maxLength);
  // como el navegador: corta por maxLength y luego «input»
  const paste = (txt) => { pv._v = txt.slice(0, pv.maxLength); pv.selectionStart = pv.selectionEnd = pv._v.length; pv.fire('input'); };
  const visible = 'A'.repeat(120), dirty = visible.split('').map((c, i) => (i % 10 === 0 ? '\u200B' + c : c)).join('');
  paste(dirty); assert.equal(pv.value, visible, 'quedan 120 visibles (antes 108)'); assert.equal(need.state.proveedor, visible);
  // más largo que el tope, sin invisibles: se recorta en el campo (lo visible = lo enviado)
  paste('B'.repeat(150)); assert.equal(pv.value.length, 120); assert.equal(need.state.proveedor, pv.value);
});

test('5) «la clave del negocio es Gatito», «…es: el perro», «la clave, del año 2024» tapados; «la clave del negocio es la atención» se ve', () => {
  hidden('la clave del negocio es Gatito', ['Gatito']); hidden('la clave del negocio es: el perro', ['perro']); hidden('la clave, del año 2024', ['2024']);
  hidden('la clave del wifi es el perro', ['perro']); hidden('la clave del wifi: la tortuga', ['tortuga']); hidden('clave del artículo es código 4321', ['4321']);
  for (const [t, v] of [['la clave del negocio es la atención', 'atención'], ['la contraseña es la misma', 'misma'], ['la clave del wifi es la de siempre', 'siempre'], ['clave del año 2024', '2024'], ['Cambié la clave de la caja en 2024', '2024'], ['clave del producto Arroz código 77501234', '77501234']]) ownerSees(t, v);
});

test('6) 8 dígitos junto a código/EAN/barras o en columna «Código»: el empleado ve «código ****1234» (no «DNI»); igual en partes; con DNI, «DNI ****»', () => {
  const e = A.redactFor(EMP);
  assert.equal(e('El código de barras del arroz es 77501234.'), 'El código de barras del arroz es código ****1234.');
  assert.equal(e('Código 77501234'), 'Código ****1234'); assert.equal(e('barras: 77501234'), 'barras: ****1234'); assert.equal(e('Arroz 5kg (EAN-8 77501234)'), 'Arroz 5kg (EAN-8 ****1234)');
  assert.equal(e('| Producto | Código |\n|---|---|\n| Arroz | 77501234 |'), '| Producto | Código |\n|---|---|\n| Arroz | código ****1234 |');
  assert.equal(e('DNI 12345678'), 'DNI ****5678'); assert.equal(e('Escanee 12345678'), 'Escanee código ****5678'); // (Bot 4 sobre 39ccd25c) sin DNI delante: neutra assert.equal(e('el cliente con DNI: 12345678'), 'el cliente con DNI ****5678');
  assert.equal(A.redactModelOwner('Código 77501234'), 'Código 77501234', 'el dueño sigue viendo su código'); assert.equal(A.redactOwnerText('Código 77501234'), 'Código 77501234');
  assert.ok(A.MASK_LEFT_RE.test('código ****1234') && A.MASK_LEFT_RE.test('****1234'), 'sigue contando como tapado en una tarjeta');
  for (const t of ['| Producto | Código |\n|---|---|\n| Arroz Costeño | 77501234 |\n| Azúcar Rubia | 77505678 |\nlisto', 'El código de barras del arroz es 77501234 y el del azúcar 77505678.']) for (const s of [1, 2, 3, 5, 7, 13]) assert.equal(emit(EMP, t, steps(t, s)).o, A.capReply(e(t)), s + ' ' + t);
});

test('7) dinero tras clave/contraseña (regla final): céntimos + palabra de precio justo antes (o antes de «clave») se ve; enteros siempre tapados; tras pin nada', () => {
  // los montos reales del dueño (Bot 2): se ven
  for (const [t, v] of [['precio clave S/ 4.50', '4.50'], ['La clave: el precio del arroz es S/ 4.50', '4.50'], ['la clave del margen fue el costo de S/ 3.20', '3.20'], ['La clave fue el precio: S/ 12.50 por caja', '12.50'],
    ['precio clave del mes: S/ 1250.00', '1250.00'], ['Clave del día: efectivo S/ 830.40 y Yape S/ 120.00', '830.40'], ['producto clave: Arroz a S/ 4.50, costo S/ 3.20', '3.20'], ['La clave fue comprar a S/ 3.20 y vender a S/ 4.50', '4.50'],
    ['el efectivo de la caja chica es S/ 250.00', '250.00'], ['En caja hay S/ 1250.50 en efectivo', '1250.50'], ['costo clave 4.50 soles', '4.50'], ['la clave del costo es S/ 12.50', '12.50'], ['clave del total: S/ 99.90', '99.90'],
    ['la clave es el precio de S/ 1.234,50', '1.234,50'], ['clave del vuelto S/ 0.50', '0.50']]) { ownerSees(t, v); allCuts(t); }
  // enteros con dinero: tapados aunque haya palabra de precio; la palabra de precio NO se tapa
  for (const [t, v] of [['clave costo S/ 4321', '4321'], ['precio clave S/ 4321', '4321'], ['clave del precio: S/ 4521', '4521'], ['La clave para vender es el precio S/ 2500', '2500'], ['la clave del costo es S/ 1250', '1250']]) hidden(t, [v]);
  assert.equal(vias.own('clave costo S/ 4321'), 'clave costo S/ [oculto]');
  // sin palabra de precio, con credencial o tras «pin»: tapado
  for (const [t, v] of [['clave S/ 43.21', '43.21'], ['la clave es 43.21', '43.21'], ['la clave de la caja es costo S/ 12.50', '12.50'], ['pin precio S/ 4.50', '4.50'], ['el pin del costo es S/ 12.50', '12.50'], ['precio pin S/ 4.50', '4.50'], ['clave de cobro S/ 12.50', '12.50']]) hidden(t, [v]);
});

test('7b) unidad: no suelta con un sustantivo de credencial en la etiqueta ni con el número pegado a la etiqueta; sí con una palabra en medio y sin «:», «=» o ser', () => {
  for (const [t, v] of [['la clave de la caja 4321 unidades', '4321'], ['la clave de la caja 4321 unidad', '4321'], ['clave de la caja 4521 kg', '4521'], ['la clave del wifi 2500 unidades', '2500'], ['clave 43.21 kg', '43.21'], ['clave 2.5 kg', '2.5'], ['contraseña 1.250 unidades', '1.250'],
    ['La clave fue vender 1.200 unidades', '1.200']]) hidden(t, [v]);
  for (const [t, v] of [['Producto clave de la semana 2500 unidades', '2500'], ['clave del mes 1500 bolsas', '1500'], ['clave del arroz 1.5 kg', '1.5'], ['clave del verano 2500 botellas', '2500']]) ownerSees(t, v);
});

test('8) Bot 3: etiqueta repetida sin punto ya no retiene todo el texto (tope) ni lo vuelve a mirar; mismo resultado que el texto entero', () => {
  for (const [u, cap] of [['pin ', 130], ['la contraseña es perrito, el pin 4321 ', 130], ['producto clave, ', 130], ['clave S/ 4321 ', 150], ['pin S/ 43.21 ', 60], ['clave del local de la caja ', 140]])
    for (const role of ['owner', EMP]) for (const step of [1, 5]) { const s = u.repeat(Math.ceil(8000 / u.length)).slice(0, 8000); const red = A.redactFor(role); let o = '', held = 0;
      const full = red(s), ratio = s.length / full.length; // patrón que se repite: la salida es proporcional a la entrada (error < una vuelta del patrón)
      const em = A.createTextEmitter((d) => { if (d.t) o += d.t; }, 1e9, red, role === 'owner' ? null : A.ownerHold);
      for (let k = 0; k < s.length; k += step) { em.push(s.slice(k, k + step)); held = Math.max(held, Math.min(s.length, k + step) - Math.round(o.length * ratio)); }
      const pre = o; em.flush(); assert.equal(o, red(s), role + ' ' + JSON.stringify(u)); // (#962, diseño simple) antes: retiene ≤ cap; ahora con etiqueta todo espera al cierre
      assert.ok(cap > 0 && pre.length <= Math.max(0, s.search(/pin|clave|contrase|password|token|api/i)) && o.startsWith(pre), role + '/' + step + ' ' + JSON.stringify(u) + ' antes de cerrar ' + pre.length + ' (retenía ' + held + ')'); }
});

test('8b) Bot 3: costo lineal con «pin pin pin…» y «la contraseña es perrito, el pin 4321» repetidos (12/25/50/100 KB, trozos de 1)', () => {
  const run = (s, role) => { const em = A.createTextEmitter(() => {}, 1e9, A.redactFor(role), role === 'owner' ? null : A.ownerHold); for (let k = 0; k < s.length; k++) em.push(s[k]); em.flush(); };
  for (const u of ['pin ', 'la contraseña es perrito, el pin 4321 ']) for (const role of ['owner', EMP]) {
    const per = [12000, 100000].map((n) => { const s = u.repeat(Math.ceil(n / u.length)).slice(0, n); run(s, role); let best = Infinity; for (let j = 0; j < 3; j++) { const a = process.hrtime.bigint(); run(s, role); best = Math.min(best, Number(process.hrtime.bigint() - a) / 1e6); } return best / n; });
    assert.ok(per[1] <= per[0] * 1.6, role + ' ' + JSON.stringify(u) + ' µs/car. 12 KB ' + (per[0] * 1000).toFixed(2) + ' → 100 KB ' + (per[1] * 1000).toFixed(2));
  }
});

test('8c) filtro previo: sin pin/clave/contraseña/password/token/api no se prueban esas reglas; con la palabra en mayúsculas o con tilde sí', () => {
  assert.match(SRC, /const PIN_GATE = \/pin\|clave\|contrase\|password\|token\|api\/i;/);
  for (const [t, v] of [['CLAVE 4321', '4321'], ['Contraseña: tortuga', 'tortuga'], ['PIN 4.321', '4.321'], ['La CONTRASEÑA del wifi es "tortuga"', 'tortuga'], ['Password=Hola', 'Hola'], ['api key sk-123456', 'sk-123456']]) hidden(t, [v]);
  const t = 'del paracetamol quedan 24 cajas y conviene pedir 1500 unidades antes del viernes, total S/ 4.321,50';
  for (const f of Object.values(vias)) assert.equal(f(t), t);
});

test('4c) Bot 4: pegar/soltar se limpia en beforeinput con execCommand(insertText) (deshacer intacto), recorte DESPUÉS de limpiar; setRangeText solo si execCommand falla', () => {
  const mkDoc = (execOk) => { const calls = []; const doc = { calls, execCommand(cmd, ui, text) { calls.push([cmd, text]); if (!execOk) return false;
    const i = doc.active, v = i._v, s = i.selectionStart, e = i.selectionEnd; i._v = v.slice(0, s) + text + v.slice(e); i.selectionStart = i.selectionEnd = s + text.length; i.fire('input', { inputType: 'insertText' }); return true; } };
    doc.createElement = (tag) => { const n = { tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, style: {}, _v: '', selectionStart: 0, selectionEnd: 0, sets: 0, ownerDocument: doc,
      get value() { return this._v; }, set value(v) { this._v = String(v); this.selectionStart = this.selectionEnd = this._v.length; this.sets++; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
      setRangeText(t, a, b) { this._v = this._v.slice(0, a) + t + this._v.slice(b); this.selectionStart = this.selectionEnd = a + t.length; calls.push(['setRangeText', t]); },
      appendChild(k) { this.children.push(k); return k; }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, fire(t, ev = {}) { let prevented = false; (this.listeners[t] || []).forEach((f) => f({ target: this, preventDefault() { prevented = true; }, ...ev })); return prevented; }, focus() {} }; return n; };
    return doc; };
  const p = { id: 'c1', type: 'compra', needsConfirm: true, confirm_token: 't', proveedor: '', documento: '', completar: ['proveedor', 'documento'], lineas: [] };
  const paste = (i, data, type = 'insertFromPaste') => i.fire('beforeinput', { inputType: type, data: null, dataTransfer: { getData: (k) => (k === 'text/plain' ? data : '') } });
  { const doc = mkDoc(true), need = C.needFields(doc, p, () => {}), [pv, dv] = need.inputs; doc.active = pv;
    pv._v = 'Bodega Rosa'; pv.fire('input'); pv.setSelectionRange(7, 7); const sets0 = pv.sets;
    assert.equal(paste(pv, '\u202E9\u00AD8\u200B7'), true, 'se previene el pegado crudo');
    assert.deepEqual(doc.calls, [['insertText', '987']], 'entra limpio por execCommand (pila de deshacer del navegador)');
    assert.equal(pv.value, 'Bodega 987Rosa'); assert.equal(pv.sets, sets0, 'nunca inp.value = … (eso rompe deshacer)'); assert.equal(need.state.proveedor, 'Bodega 987Rosa');
    // pegado sin nada que limpiar: lo hace el navegador (no se previene)
    assert.equal(paste(pv, '12'), false); assert.equal(doc.calls.length, 1);
    // recorte DESPUÉS de limpiar: 300 caracteres con un ZWSP cada 3 → entran exactamente los 120 que caben
    pv._v = ''; pv.selectionStart = pv.selectionEnd = 0; doc.calls.length = 0; const t = Array.from({ length: 150 }, (_, i) => 'a\u200B' + String.fromCharCode(98 + (i % 20))).join('');
    paste(pv, t); assert.equal(pv.value.length, 120); assert.equal(pv.value, C.inputClean(t).slice(0, 120));
    // con algo ya escrito y una selección: cabe solo lo que falta para 120
    pv._v = 'x'.repeat(100); pv.setSelectionRange(10, 20); paste(pv, '\u200B' + 'y'.repeat(40)); assert.equal(pv.value.length, 120); assert.equal(pv.value.slice(10, 40), 'y'.repeat(30));
    // soltar (drop) y un reemplazo del corrector con caracteres de control: igual
    doc.active = dv; dv._v = 'F001-'; dv.selectionStart = dv.selectionEnd = 5; doc.calls.length = 0; paste(dv, '4321\u202E', 'insertFromDrop'); assert.equal(dv.value, 'F001-4321');
    dv.setSelectionRange(5, 9); assert.equal(dv.fire('beforeinput', { inputType: 'insertReplacementText', data: '\u200B4322' }), true); assert.equal(dv.value, 'F001-4322');
    // escribir normal NO pasa por aquí; durante una composición tampoco
    assert.equal(dv.fire('beforeinput', { inputType: 'insertText', data: '\u202E' }), false);
    dv.fire('compositionstart'); assert.equal(paste(dv, '\u202E1'), false); dv.fire('compositionend'); }
  { // sin execCommand que funcione: setRangeText (lo visible sigue siendo lo limpio)
    const doc = mkDoc(false), need = C.needFields(doc, p, () => {}), [pv] = need.inputs; doc.active = pv; pv._v = 'Sur'; pv.setSelectionRange(3, 3);
    paste(pv, ' S\u00ADAC'); assert.deepEqual(doc.calls.map((c) => c[0]), ['insertText', 'setRangeText']); assert.equal(pv.value, 'Sur SAC'); assert.equal(need.state.proveedor, 'Sur SAC'); }
  { // respaldo: un teclado/autocompletar que no manda beforeinput sigue limpiándose en «input»; «Confirmar» nunca con control a la vista
    const doc = mkDoc(true), need = C.needFields(doc, p, () => {}), [, dv] = need.inputs; dv._v = '\u202E1234-100F'; dv.selectionStart = dv.selectionEnd = dv._v.length; dv.fire('input');
    assert.equal(dv.value, '1234-100F'); assert.equal(need.state.documento, '1234-100F'); }
});
