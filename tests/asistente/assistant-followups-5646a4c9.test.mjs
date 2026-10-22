// Sobre 5646a4c9 (Bot 5 ev-5646a4c9): 1) un año ya no suelta la clave si la frase la DICE («:», «=», es/era/fue/será/sería entre la etiqueta y el
// año); 2) un valor de letras seguido de OTRA etiqueta con su «[oculto]» ya no queda a la vista; 3) la propuesta (modelo o factura) sale sin
// caracteres de formato (U+202E…) en el servidor (cardField, fecha, nombre de línea) y en el celular (purchaseValue, appendCoded); 4) tras «pin»
// ninguna excepción de dinero (tampoco montos con decimales) y «producto/artículo»/«precio/costo/monto» cuentan solo en las primeras 5 palabras,
// antes de «,», «:», «=» o un verbo de ser y sin palabra de credencial antes; 5) clave de puras letras dicha como clave («clave del wifi: tortuga»);
// 6) relleno parecido a un asterisco (⁕ ✻ ٭ …) en servidor y celular. Las 4 vías (empleado, dueño, modelo-empleado, modelo-dueño) y en partes 1/3/7.
// Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI_SRC = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas_documentos';
const has = (t, v) => new RegExp('(^|[^\\w])' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])').test(t);
const vias = { emp: A.redactFor(EMP), own: A.redactFor('owner'), mEmp: A.redactText, mOwn: A.redactModelOwner };
function stream(role, t, step) { const red = A.redactFor(role); let o = '', seen = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else { o += d.t || ''; seen += d.t || ''; } }, A.REPLY_MAX, red, role === 'owner' ? null : A.ownerHold);
  for (let i = 0; i < t.length; i += step) e.push(t.slice(i, i + step)); e.flush(); return { o, seen }; }
// tapado en las 4 vías y en partes de 1/3/7 (empleado y dueño), con el final igual al texto entero
function hidden(t, vals) {
  for (const [via, f] of Object.entries(vias)) for (const v of vals) assert.ok(!has(f(t), v), via + ': ' + JSON.stringify(t) + ' → ' + JSON.stringify(f(t)));
  for (const role of [EMP, 'owner']) for (const step of [1, 3, 7]) { const s = stream(role, t, step);
    assert.equal(s.o, A.capReply(A.redactFor(role)(t)), role + '/' + step + ' ' + JSON.stringify(t));
    for (const v of vals) assert.ok(!has(s.seen, v), 'se vio en partes ' + role + '/' + step + ' ' + JSON.stringify(t) + ' → ' + JSON.stringify(s.seen)); }
}
const ownerSees = (t, v) => { for (const f of [A.redactOwnerText, A.redactModelOwner]) assert.ok(has(f(t), v), JSON.stringify(t) + ' → ' + JSON.stringify(f(t))); };

test('1) año: con «:», «=» o es/era/fue/será/sería entre la etiqueta y el año, el año se tapa (4 vías y en partes)', () => {
  for (const [t, v] of [['la clave es del año 2024', '2024'], ['la clave es en 2024', '2024'], ['contraseña: el año 1987', '1987'], ['clave = en 2020', '2020'],
    ['la clave del wifi es el año 2024', '2024'], ['la clave del wifi: del año 1987', '1987'], ['la contraseña del local es el año 1999', '1999'], ['la clave fue en 2019', '2019'],
    ['la contraseña será el año 2030', '2030'], ['la clave sería del año 2001', '2001'], ['el pin es el año 2024', '2024'], ['pin del año 2024', '2024'], ['mi clave es 2024', '2024'],
    ['clave de la caja en 2024 era 4321', '4321'], ['la clave del año 2024 es 4321', '4321'], ['contraseña del año 2024: 5678', '5678']]) hidden(t, [v]);
  for (const [t, v] of [['clave del año 2024', '2024'], ['Cambié la clave de la caja en 2024', '2024'], ['Mi clave para el año 2025', '2025'], ['la clave de la caja en 2024 era otra', '2024']])
    for (const f of Object.values(vias)) assert.ok(has(f(t), v), JSON.stringify(t) + ' → ' + JSON.stringify(f(t)));
});

test('2) valor de letras y después OTRA etiqueta con su «[oculto]»: los dos tapados en el texto entero (JSON, historial, modelo) y en partes', () => {
  for (const [t, vals] of [['la contraseña es perrito, el pin 4321', ['perrito', '4321']], ['la clave es Gatito y el pin 4321', ['Gatito', '4321']],
    ['api key abcdefghij, la clave 4321', ['abcdefghij', '4321']], ['password qwerty, clave 4321', ['qwerty', '4321']], ['la clave era Tortuga, el pin 9876', ['Tortuga', '9876']],
    ['contraseña: Manzana y clave 4321', ['Manzana', '4321']], ['clave del wifi: tortuga, pin del local 4321', ['tortuga', '4321']],
    ['la contraseña es perrito, el pin es 4321 y listo', ['perrito', '4321']], ['la clave del pin es 4321', ['4321']], ['clave 4321, clave 9876', ['4321', '9876']]]) hidden(t, vals);
  // «la clave del pin es 4321» sigue «la clave del pin es [oculto]» (no tapa «del»)
  for (const f of Object.values(vias)) assert.equal(f('la clave del pin es 4321'), 'la clave del pin es [oculto]');
  // historial (cleanFor de cada turno = redactText / redactModelOwner) y resultado de herramienta: mismo filtro
  for (const t of ['la contraseña es perrito, el pin 4321', 'api key abcdefghij, la clave 4321', 'password qwerty, clave 4321']) {
    const j = JSON.stringify({ reply: A.redactOwnerText(t), history: [A.redactText(t), A.redactModelOwner(t)] }); for (const v of ['perrito', 'abcdefghij', 'qwerty', '4321']) assert.ok(!has(j, v), j); }
});

test('3) propuesta con U+202E/U+2066 (preparar_compra / leer_factura_compra): el servidor la limpia; el celular también (purchaseValue, appendCoded)', async () => {
  const ctx = { products: [{ id: 'P1', nombre: 'Arroz', precio: 2.5, costo: 1.8, stock: 5 }] };
  for (const name of ['preparar_compra', 'leer_factura_compra']) {
    const p = A.toProposal({ name, arguments: JSON.stringify({ proveedor: '\u2066Sur SAC 20123456789\u2069', documento: '\u202E1234-100F', fecha: '\u202E2026-10-17',
      lineas: [{ product_id: 'P1', cantidad: 2, costo_unitario: 1.5 }, { nombre: 'Galleta\u202E Soda', cantidad: 1, costo_unitario: 1 }] }) }, 'owner', ctx, 0);
    assert.equal(p.documento, '1234-100F', name); assert.equal(p.proveedor, 'Sur SAC 20123456789', name);
    for (const v of [p.documento, p.proveedor, p.fecha, ...p.lineas.map((l) => l.nombre)]) assert.ok(!/[\p{Cf}]/u.test(String(v)), name + ' ' + JSON.stringify(v));
    assert.equal(p.lineas[1].nombre, 'Galleta Soda');
    // empleado: igual de limpio antes de filtrar
    const pe = A.toProposal({ name, arguments: JSON.stringify({ proveedor: 'Sur SAC', documento: '\u202EF001-77\u202C', lineas: [{ product_id: 'P1', cantidad: 2 }] }) }, 'owner', ctx, 0);
    assert.equal(pe.documento, 'F001-77');
  }
  assert.equal(A.fmtClean('Jose\u0301 \u200E\uFE0F'), 'José ');
  // celular: aunque llegue una propuesta con U+202E (factura alterada / servidor viejo), se muestra y se escribe sin él
  const p = { type: 'compra', proveedor: '\u2066Sur SAC\u2069', documento: '\u202E1234-100F', lineas: [] };
  assert.equal(C.purchaseValue(p, 'documento'), '1234-100F'); assert.equal(C.purchaseValue(p, 'proveedor'), 'Sur SAC');
  assert.equal(C.fmtClean('\u202E1234-100F'), A.fmtClean('\u202E1234-100F'));
  const nodes = []; const doc = { createTextNode: (t) => ({ t }), createElement: (tag) => ({ tag, kids: [], className: '', set textContent(v) { this.t = v; }, get textContent() { return this.t; }, appendChild(k) { this.kids.push(k); } }) };
  const parent = { appendChild: (k) => nodes.push(k) }; C.appendCoded(doc, parent, '\u202E1234-100F \u2066F001-00012345\u2069');
  const txt = (n) => n.t != null ? n.t : (n.kids || []).map(txt).join(''); const all = nodes.map(txt).join('');
  assert.ok(!/[\p{Cf}]/u.test(all), JSON.stringify(all)); assert.equal(all, '1234-100F F001-00012345');
  // «Nueva compra» real (fillPurchase de asistente-ui.js) con la propuesta tal cual
  const vm = await import('node:vm');
  const j0 = UI_SRC.indexOf('fillPurchase: function (w, p) {'), j1 = UI_SRC.indexOf('    // Ficha EXISTENTE', j0); assert.ok(j0 > 0 && j1 > j0);
  const src = UI_SRC.slice(j0, j1).replace(/^fillPurchase: /, '').replace(/,\s*$/, '');
  const mk = (id) => ({ id, attrs: {}, className: '', style: {}, value: '', dataset: {}, setAttribute(k, v) { this.attrs[k] = String(v); } });
  const sup = mk('naPurSupplier'), dn = mk('naPurDoc');
  const w = { dataset: {}, querySelector: (q) => (q === '#naPurSupplier' ? sup : q === '#naPurDoc' ? dn : null), querySelectorAll: () => [], dispatchEvent() {} };
  const fill = vm.runInContext('(' + src + ')', vm.createContext({ C, Event: class { constructor(t) { this.type = t; } }, deps: { productos: () => [] } }));
  fill(w, p); assert.equal(dn.value, '1234-100F'); assert.equal(sup.value, 'Sur SAC');
});

test('4) tras «pin» ninguna excepción de dinero; producto/precio solo en las primeras 5 palabras, antes de «,» «:» «=» o es/era y sin credencial', () => {
  for (const [t, v] of [['pin precio S/ 4321', '4321'], ['pin S/ 43.21', '43.21'], ['pin S/ 4321.00', '4321.00'], ['el pin del costo es $ 4321', '4321'], ['pin del monto US$ 12.50', '12.50'],
    ['pin de cobro PEN 1,234.50', '1,234.50'], ['la clave, producto de mi trabajo, es código 4321', '4321'], ['la clave, como el precio, es S/ 4321', '4321'], ['clave: monto S/ 4321', '4321'],
    ['contraseña del wifi del producto código 4321', '4321'], ['la clave es el producto código 4321', '4321'], ['clave de la caja del local precio S/ 4321', '4321'],
    // (Bots 2/5 sobre 6e0b3c5d, regla final, a propósito) entero tras clave + dinero: tapado aunque haya precio/costo/monto
    ['clave del precio: S/ 4521', '4521'], ['la clave del costo es S/ 1250', '1250'], ['clave del monto PEN 3000', '3000'],
    // (Bots 2/5 sobre 6e0b3c5d, a propósito) número justo después de la etiqueta, aunque lleve unidad: tapado («clave 2.5 kg» antes se veía)
    ['clave 2.5 kg', '2.5']]) hidden(t, [v]);
  // el dueño sigue viendo lo suyo
  for (const [t, v] of [['clave del producto Arroz código 77501234', '77501234'], ['clave del artículo cód. 4521', '4521'],
    ['clave del precio S/ 4321.00', '4321.00'], ['la clave del costo es S/ 12.50', '12.50'], ['Factura F001-00012345 total S/ 4521.00', '4521.00'], ['Total S/ 43.21', '43.21'], ['el pin. Total S/ 43.21', '43.21']]) ownerSees(t, v);
});

test('5) clave de puras letras dicha como clave (credencial o «contraseña»/«password»): tapada para los dos roles, de entrada y de salida', () => {
  for (const [t, v] of [['clave del wifi: tortuga', 'tortuga'], ['la clave del wifi es tortuga', 'tortuga'], ['la contraseña del correo es Mariposa', 'Mariposa'], ['clave de la caja = girasol', 'girasol'],
    ['la clave del local de la esquina es: Pelota', 'Pelota'], ['la contraseña de mi hermano es perrito', 'perrito'], ['el password de la cuenta: Sol!Luna', 'Sol!Luna'],
    ['la clave de acceso al sistema era ventana', 'ventana'], ['pin de la tarjeta: abcd', 'abcd'], ['clave del wifi: tortuga y la del router: conejo', 'tortuga']]) hidden(t, [v]);
  // prosa: sin credencial no se tapa la palabra que sigue a «es»; palabras que no pueden ser la clave tampoco
  for (const [t, v] of [['la clave del éxito es vender más', 'vender'], ['la clave del negocio es la atención', 'atención'], ['la contraseña del wifi es la misma', 'misma'],
    ['la clave del wifi es nueva', 'nueva'], ['la contraseña del correo es personal', 'personal']]) for (const f of Object.values(vias)) assert.ok(has(f(t), v), JSON.stringify(t) + ' → ' + JSON.stringify(f(t)));
});

test('6) relleno parecido a un asterisco (⁕ ✻ ٭ ⁑ ⁂ ✲-✽ ❉-❋ ⚹ ⊛ ﹡): 422 en servidor y celular; «Promo 2*1 SAC» y «José» siguen válidos', () => {
  const BAD = [['proveedor', '⁕6789'], ['proveedor', '✻✻6789'], ['proveedor', '٭٭6789'], ['proveedor', '﹡6789'], ['documento', '⁕⁕⁕⁕6789'], ['documento', '✻6789'], ['proveedor', 'Bodega ٭6789'],
    ['proveedor', '⁑⁑⁑⁑'], ['proveedor', '⁂ ⁂'], ['documento', '✲✲6789'], ['documento', '❋❋6789'], ['proveedor', '⚹⚹⚹'], ['documento', 'F001-⁕6789'], ['proveedor', '⊛⊛6789']];
  const OK = [['proveedor', 'Promo 2*1 SAC'], ['proveedor', 'José Pérez'], ['proveedor', 'Estrella ✻ Lima'], ['documento', 'F001-00012345'], ['proveedor', 'Ferretería XXL SAC']];
  for (const [n, v] of BAD) { const s = A.normManual(v), c = C.normManual(v); assert.equal(c, s); assert.equal(A.manualBad(n, s), true, n + ' ' + v); assert.equal(C.manualBad(n, c), true, n + ' celular ' + v); }
  for (const [n, v] of OK) { const s = A.normManual(v), c = C.normManual(v); assert.equal(c, s); assert.equal(A.manualBad(n, s), false, n + ' ' + v); assert.equal(C.manualBad(n, c), false, n + ' celular ' + v); }
  // la propuesta con «⁕⁕⁕⁕6789» en documento va vacía y en «completar» (servidor) y el celular no la escribe
  assert.equal(A.MASK_LEFT_RE.test('⁕⁕6789'), true); assert.equal(C.maskLeft('⁕⁕6789'), true); assert.equal(C.maskLeft('٭6789'), true);
  for (const v of ['F001-00012345', 'Promo 2*1 SAC', 'Arroz ✻ Extra']) { assert.equal(A.MASK_LEFT_RE.test(v), false, v); assert.equal(C.maskLeft(v), false, v); }
});

// ---------- Bot 2 sobre 5646a4c9 ----------
test('Bot 2 / 1) decimales: tras pin siempre tapados; tras clave/contraseña solo se ven con precio/costo/monto (o una unidad); una sola pieza', () => {
  for (const [t, v] of [['la clave es 43.21', '43.21'], ['clave S/ 43.21', '43.21'], ['pin S/ 43.21', '43.21'], ['la contraseña: 1,234.50', '1,234.50'], ['clave de cobro S/ 12.50', '12.50']]) hidden(t, [v]);
  for (const [t, v] of [['pin 4321.00', '00'], ['clave 4321,00', '00'], ['pin S/ 4321.00', '00']]) { hidden(t, ['4321']); for (const f of Object.values(vias)) { assert.ok(!f(t).includes('[oculto].') && !f(t).includes('[oculto],'), t + ' → ' + f(t)); assert.ok(!has(f(t), v), t + ' → ' + f(t)); } }
  for (const [t, v] of [['clave del precio: S/ 43.21', '43.21'], ['la clave del costo es S/ 12.50', '12.50'], ['clave del monto 99.90', '99.90'], ['Total S/ 43.21 hoy', '43.21']]) ownerSees(t, v);
});

test('Bot 2 / 2) unidad: suelta el número solo sin «:», «=», es/era/fue entre la etiqueta y el número y sin repetir un sustantivo de la etiqueta', () => {
  for (const [t, v] of [['clave de la caja 4321 cajas', '4321'], ['la clave de la caja fuerte es 4321 botellas', '4321'], ['clave de la caja chica: 2500 soles', '2500'], ['la clave del saco es 4321 sacos', '4321'],
    ['contraseña de la bolsa 1234 bolsas', '1234'], ['la clave fue 4321 unidades', '4321'], ['clave 4321 paquetes', '4321'], ['contraseña 1234 docenas', '1234'], ['pin 4321 cajas', '4321'],
    ['clave de la caja 4521 kg', '4521'] /* (Bot 2 sobre c16a407d, a propósito: credencial en la etiqueta, la unidad no suelta) */]) hidden(t, [v]);
  for (const [t, v] of [['Producto clave de la semana 2500 unidades', '2500'], ['clave del mes 1500 bolsas', '1500'], ['clave del verano 2500 botellas', '2500']]) ownerSees(t, v);
  // INFO del dueño (sin cambio): «clave de la caja en 2019» sigue visible
  ownerSees('clave de la caja en 2019', '2019');
});

test('Bot 2 / 3-4) «pin precio S/ 4321» tapado; «la contraseña es perrito, el saldo 4321» tapa «perrito»; producto/precio con credencial o coma antes no sueltan', () => {
  hidden('pin precio S/ 4321', ['4321']); hidden('la contraseña es perrito, el saldo 4321', ['perrito']); hidden('el password es Girasol, el total 99', ['Girasol']);
  for (const t of ['la clave de la caja (producto nuevo) código 4321', 'clave de la caja, ver producto código 4321', 'la clave de la caja y su precio S/ 4321', 'la clave de la caja es del año 2019',
    'la clave del producto de la caja fuerte es 4321', 'clave del artículo: 4321', 'contraseña producto 4321', 'clave producto wifi 12345678', 'pin del producto 4321']) hidden(t, [/\d{4,}/.exec(t)[0]]);
});

// paridad: el texto entero (respuesta JSON, historial, modelo) y las partes dan LO MISMO, con cortes fijos y al azar, para los casos de Bot 2 y Bot 5
const BOT5_CASES = ["el pin es el año 2024", "pin del año 2024", "la clave es del año 2024", "la clave es en 2024", "contraseña: el año 1987", "la clave del wifi es el año 2024", "pin: en 2024", "mi clave es 2024", "la contraseña del local es el año 1999", "clave = en 2020", "la clave del wifi: del año 1987", "clave del año 2024", "Cambié la clave de la caja en 2024", "clave de la caja en 2024 era 4321", "la clave del año 2024 es 4321", "contraseña del año 2024: 5678", "clave: monto \"s\"/ 4321", "la clave del monto 4321", "pin monto 4321", "clave precio 4321", "la contraseña es costo 4321", "clave \"s\"/ 4321.00", "pin \"s\"/ 43.21", "clave 43.21", "clave de la caja \"s\"/ 4321", "pin \"s\"/ 4321", "clave PEN 4321", "pin precio \"s\"/ 4321", "el pin del costo es $ 4321", "clave del precio: \"s\"/ 4521", "la clave, como el precio, es \"s\"/ 4321", "pin US$ 4321", "la clave de la caja 4321", "clave de la caja: 4321", "clave caja 4321", "contraseña de la botella 4321", "clave del saco 4321", "la clave es 4321 cajas", "pin 4321 cajas", "pin 4321 paquetes", "clave 4321 docenas", "la clave del wifi es 4321 botella", "clave 4321 bolsas", "vender 3000 paquetes es la clave", "la clave es vender 3000 paquetes", "contraseña del wifi del producto código 4321", "la clave, producto de mi trabajo, es código 4321", "clave artículo 4321", "pin del producto código 4321", "clave del producto: 4321", "clave del producto Arroz código 77501234", "clave del artículo cód. 4521", "la clave del wifi no es el código del producto, es 4321", "pin cód. 4321", "clave cód. 4321", "cód. 4521", "Arroz cód. 4521", "pin. cód. 4521", "la clave cambió. cód. 4521 es el arroz", "clave: EAN 4321", "la clave es cód 4321", "contraseña: barras 87654321", "clave de acceso, código 12345678", "clave del wifi código 12345678", "contraseña del local cod 12345678", "clave del wifi del local 12345678", "pin código 4321", "clave: código 4321", "contraseña cod 4321", "pin del EAN 4321", "clave código: 4321", "PIN EAN-13 4321", "pin códigos 4321", "el pin es el código 4321", "la clave de la caja es código 4321", "clave de barras 4321", "contraseña del código 4321", "pin de acceso código 4321", "la clave del wifi: cod 98765432", "la clave de la caja fuerte 4321", "la clave de la caja chica 4321", "la clave de la caja fuerte: 4321", "pin por favor 4321", "El pin del local nuevo de la esquina es 4321", "pin de la caja 4321 unidades", "código 12345678", "EAN 7751234567890", "token sk-test-FAKE-1abc, api key sk-test-FAKE-2def", "clave 4321, clave 9876", "pin 1234 y pin 5678", "email a@b.co clave 4321", "api key sk-123456, la clave 4321", "api key abcdefghij, la clave 4321", "la contraseña es perrito, el pin 4321", "la clave es Gatito y el pin 4321", "contraseña Zq9xK2mPw7 y pin 4321", "token abc123xyz, pin 4321", "password qwerty, clave 4321", "la clave del pin es 4321", "teléfono 987654321 y clave 4321", "la clave es mesa; el pin 4321", "api key sk-test-FAKE-9zz y token 4321", "clave del wifi: tortuga, pin del local 4321"];
const BOT2_CASES = ["la clave de la caja (producto nuevo) código 4321", "clave de la caja, ver producto código 4321", "la clave, producto de mi trabajo, es código 4321", "la clave del producto código 4321", "contraseña del artículo cód. 4321", "la clave es del año 2024", "la clave es en 2024", "contraseña: el año 1987", "clave = en 2020", "la clave del wifi es el año 2024", "clave de la caja en 2019", "la clave de la caja es del año 2019", "pin precio S/ 4321", "la clave de la caja y su precio S/ 4321", "la clave del precio: S/ 4521", "pin S/ 43.21", "clave S/ 43.21", "la clave es 43.21", "pin 4321.00", "clave 4321,00", "la contraseña es perrito, el pin 4321", "la clave es Gatito y el pin 4321", "api key abcdefghij, la clave 4321", "password qwerty, clave 4321", "la contraseña es perrito, el saldo 4321", "clave de la caja 4321 cajas", "la clave de la caja fuerte es 4321 botellas", "clave 4321 paquetes", "contraseña 1234 docenas", "pin 4321 cajas", "api key sk-123456, la clave 4321", "la clave del producto de la caja fuerte es 4321", "clave del artículo: 4321", "contraseña producto 4321", "clave producto wifi 12345678", "pin del producto 4321", "clave en 1234", "la clave del año es 4321", "clave en 2024 era 4321", "pin en 2019", "Producto clave de la semana 2500 unidades", "vender 3000 paquetes", "la clave del éxito en 2024", "clave del producto Arroz código 77501234"];
test('paridad (propiedad): partes de 1/2/3/5/7/11 y 25 cortes al azar = texto entero, empleado y dueño, casos de Bot 2 y Bot 5 (solos y en medio de un texto)', () => {
  let seed = 5646; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const run = (role, t, cuts) => { const red = A.redactFor(role); let o = ''; const e = A.createTextEmitter((d) => { if (d.reset) o = ''; else o += d.t || ''; }, A.REPLY_MAX, red, role === 'owner' ? null : A.ownerHold);
    let at = 0; for (const c of cuts) { e.push(t.slice(at, c)); at = c; } e.push(t.slice(at)); e.flush(); return o; };
  let n = 0;
  for (const base of [...BOT2_CASES, ...BOT5_CASES]) for (const t of [base, 'Hola. ' + base + ' y sigue aquí.']) for (const role of [EMP, 'owner']) {
    const fin = A.capReply(A.redactFor(role)(t));
    for (const st of [1, 2, 3, 5, 7, 11]) { const cuts = []; for (let i = st; i < t.length; i += st) cuts.push(i); assert.equal(run(role, t, cuts), fin, role + '/' + st + ' ' + JSON.stringify(t)); n++; }
    for (let r = 0; r < 25; r++) { const cuts = []; for (let i = 0; i < t.length;) { i += 1 + Math.floor(rnd() * 9); if (i < t.length) cuts.push(i); } assert.equal(run(role, t, cuts), fin, role + '/azar ' + JSON.stringify(t) + ' ' + cuts); n++; }
  }
  assert.ok(n > 9000);
});

test('CONTRATO.md: año con «:»/«=»/es, letras + otra etiqueta, propuesta sin formato, pin sin dinero, claves de letras, relleno ⁕ ✻ ٭', () => {
  const md = readFileSync(new URL('../../docs/asistente/CONTRATO.md', import.meta.url), 'utf8');
  for (const re of [/5646a4c9/, /es\/era\/fue\/será\/sería/, /clave del wifi: tortuga/, /fmtClean/, /pin S\/ 43\.21/, /⁕/, /la contraseña es perrito, el pin 4321/, /pinDecimal/, /pinUnitOk/, /clave de la caja 4321 cajas/, /la contraseña es perrito, el saldo 4321/]) assert.match(md, re);
});
