// Memoria de la charla en el celular (contrato de #946), nombre del negocio, tapado de clientes solo con el nombre completo y arreglos
// de la UI (respuesta una vez, tarjetas con su respuesta, «Mostrando N de M» solo con cuentas, «Sin datos.», botón en Inicio/Inventario,
// Enter mientras responde, nada de la pregunta anterior). Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window = globalThis;
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const CSS = readFileSync('POS/css/asistente.css', 'utf8');

const pair = (i, extra = {}, len = 40) => [{ role: 'user', content: 'pregunta ' + i + ' ' + 'x'.repeat(len), ...extra }, { role: 'assistant', content: 'respuesta ' + i + ' ' + 'y'.repeat(len), ...extra }];
const hist = (n, len, f) => Array.from({ length: n }, (_, i) => pair(i, f ? f(i) : {}, len)).flat();
const signed = (i, iat) => ({ sig: 's' + i, n: i, iat });

test('nombre del negocio: el de Configuración; sin él «Nuevo Amanecer» (nunca «Botica» fijo)', () => {
  assert.equal(C.businessName({ business: { nombre: '  Bodega  Doña\nRosa ' } }), 'Bodega Doña Rosa');
  assert.equal(C.businessName({ business: { nombre: '' } }), 'Nuevo Amanecer');
  assert.equal(C.businessName(null), 'Nuevo Amanecer');
  assert.ok(!/'Botica Nuevo Amanecer'/.test(UI));
  assert.match(UI, /businessName: function \(\) \{ return C\.businessName \? C\.businessName\(g\('appConfig'\)\) : 'Nuevo Amanecer'; \}/);
});

test('Admin: manda MÁS de 8 turnos (hasta el tope del servidor) y lo que no entra pasa a «resumen»', () => {
  const mem = C.memNew(); C.memAfter([], mem, { memoria: { max_turnos: 40, max_bytes: 48000 } }, {});
  const h = hist(12, 40); const r = C.memRequest(h, mem, { role: 'owner' });
  assert.equal(r.history.length, 24, 'todo entra: 24 turnos, no 8'); assert.equal(r.resumen, null); assert.equal(r.folded, 0);
  const big = hist(60, 900); const r2 = C.memRequest(big, mem, { role: 'owner' });
  assert.ok(r2.history.length <= 40 && r2.history.length > 8, String(r2.history.length));
  const bytes = r2.history.reduce((s, m) => s + C.utf8Len(m.content), 0); assert.ok(bytes <= 48000 - 1024, String(bytes));
  assert.ok(r2.folded > 0 && typeof r2.resumen === 'string' && /(Persona|Asistente): (pregunta|respuesta) \d+ /.test(r2.resumen), r2.resumen && r2.resumen.slice(0, 40));
  assert.ok(r2.resumen.length <= 2000);
  assert.equal(big.length, r2.history.length, 'lo resumido sale del historial del aparato');
  assert.equal(r2.history[r2.history.length - 1].content, 'respuesta 59 ' + 'y'.repeat(900), 'lo más nuevo siempre va');
  assert.deepEqual(C.memAfter(big, mem, { memoria: { max_turnos: 40, max_bytes: 48000 } }, r2), { notice: true });
  const r3 = C.memRequest(big.concat(pair(60, {}, 900)), mem, { role: 'owner' });
  assert.deepEqual(C.memAfter([], mem, { memoria: { max_turnos: 40, max_bytes: 48000 } }, r3), { notice: false }, 'el aviso sale una vez por conversación');
  assert.equal(C.MEMORY.notice, 'Resumí la charla para seguir más rápido');
});

test('Admin: las notas de foto quedan fijas aunque sean viejas; el historial va limpio (sin celulares)', () => {
  const mem = C.memNew(); mem.maxBytes = 48000;
  const h = [{ role: 'user', content: 'Foto [Foto leída] Factura F001-123, 3 líneas, S/ 120.00' }, { role: 'assistant', content: 'Listo, armé la compra.' }].concat(hist(60, 900));
  const r = C.memRequest(h, mem, { role: 'owner' });
  assert.match(r.history[0].content, /\[Foto leída\] Factura F001-123/);
  const h2 = [{ role: 'user', content: 'llama al 987654321' }, { role: 'assistant', content: 'ok' }];
  assert.ok(!C.memRequest(h2, C.memNew(), { role: 'owner' }).history[0].content.includes('987654321'));
  const s = [{ role: 'user', content: 'Foto' }, { role: 'assistant', content: 'Leí la factura. Cel 987654321' }];
  C.memStore(s, 'owner', '[Foto leída] Factura B001-9'); assert.equal(s[0].content, '[Foto leída] Factura B001-9'); assert.ok(!s[1].content.includes('987654321'));
});

test('servidor viejo (sin «memoria»): como antes, los últimos 8 turnos', () => {
  const mem = C.memNew(); C.memAfter([], mem, { ok: true, reply: 'x' }, {});
  const r = C.memRequest(hist(12, 10), mem, { role: 'owner' }); assert.equal(r.history.length, 8); assert.equal(r.resumen, null);
});

test('empleado: solo pares firmados y vigentes; 2 pares viejos de más para que el servidor los resuma; resumen_sugerido vuelve como «resumen»', () => {
  const now = 1_800_000_000_000, mem = C.memNew(); mem.maxBytes = 24000; mem.maxTurns = 40;
  const h = hist(40, 600, (i) => signed(i, now - 1000));
  h.splice(2, 2, ...pair(99)); // un par sin firma: no se manda (el servidor lo tira)
  const r = C.memRequest(h, mem, { role: 'employee', now, bodyBase: { text: 'hola', context: {} } });
  assert.ok(r.history.every((m) => m.sig), 'sin pares sin firma');
  assert.ok(r.history.length <= 40);
  assert.equal(r.resumen, null, 'sin resumen firmado todavía');
  const oldest = r.history[0].n;
  C.memAfter(h, mem, { memoria: { max_turnos: 40, max_bytes: 24000, recortados: 4 }, resumen_sugerido: { texto: 'Persona: pregunta…', iat: now, sig: 'firma' } }, r);
  assert.deepEqual(mem.resumen, { texto: 'Persona: pregunta…', iat: now, sig: 'firma' });
  assert.ok(h[0].n > oldest, 'lo que el servidor resumió sale del aparato');
  const r2 = C.memRequest(h, mem, { role: 'employee', now: now + 1000, bodyBase: { text: 'hola' } });
  assert.deepEqual(r2.resumen, { texto: 'Persona: pregunta…', iat: now, sig: 'firma' });
  const r3 = C.memRequest(h, mem, { role: 'employee', now: now + 25 * 3600 * 1000, bodyBase: { text: 'hola' } });
  assert.equal(r3.resumen, null, 'más de 24 h: el servidor ya no lo acepta'); assert.equal(r3.history.length, 0);
});

test('empleado: el cuerpo nunca pasa el tope de 64 KB del servidor', () => {
  const now = 1_800_000_000_000, mem = C.memNew(); mem.maxBytes = 48000;
  const h = hist(20, 2400, (i) => signed(i, now));
  const base = { text: 'x'.repeat(500), context: { productos: 'p'.repeat(20000) } };
  const r = C.memRequest(h, mem, { role: 'employee', now, bodyBase: base });
  assert.ok(C.utf8Len(JSON.stringify({ ...base, history: r.history })) <= 60000);
  const s = [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'ok' }]; C.memStore(s, 'employee'); assert.equal(s.length, 0, 'sin firma no se guarda');
});

test('la UI: memoria en el envío, «Nueva conversación», aviso, nada en el almacenamiento', () => {
  assert.match(UI, /mreq = C\.memRequest\(history, mem, \{ role: role, now: Date\.now\(\) \+ clockOffset, bodyBase: body \}\); body\.history = mreq\.history; if \(mreq\.resumen\) body\.resumen = mreq\.resumen;/);
  assert.match(UI, /C\.memStore\(history, role, typeof d\.nota === 'string' \? d\.nota : null\); var ma = C\.memAfter\(history, mem, d, mreq\);/);
  assert.match(UI, /<button type="button" class="na-asst-reset" title="Empezar de cero">Nueva conversación<\/button>/);
  assert.match(UI, /panelEl\.querySelector\('\.na-asst-reset'\)\.onclick = newChat;/);
  assert.match(CSS, /\.na-asst-reset\{min-height:48px;/);
  assert.ok(!/(localStorage|sessionStorage)[^;\n]*setItem\([^)]*history/.test(UI));
});

test('tapado de clientes: nombre completo, dos palabras o una sola, nunca dentro de proveedor o producto', () => {
  const CLI = [{ id: 'c4', nombre: 'San Juan' }, { id: 'c1', nombre: 'Rosa Quispe Mamani' }, { id: 'c5', nombre: 'Gloria' }];
  const PROD = [{ id: 'P1', nombre: 'Galletas San Juan' }, { id: 'P2', nombre: 'Leche Gloria' }];
  const m = (t) => C.maskCustomers(t, CLI, PROD).text;
  assert.equal(m('compré a Distribuidora San Juan'), 'compré a Distribuidora San Juan');
  assert.equal(m('San Juan S.A.C. mandó la factura'), 'San Juan S.A.C. mandó la factura');
  assert.equal(m('stock de Galletas San Juan'), 'stock de Galletas San Juan');
  assert.equal(m('precio de Leche Gloria'), 'precio de Leche Gloria');
  assert.equal(m('cuánto debe San Juan'), 'cuánto debe cliente #c4');
  assert.equal(m('Rosa Quispe pagó y Quispe pagó'), 'cliente #c1 pagó y cliente #c1 pagó', 'el apellido suelto también se tapa');
  assert.equal(m('la bodega de Rosa Quispe Mamani'), 'la bodega de cliente #c1', 'con algo en medio, el nombre se tapa igual');
  assert.match(UI, /if \(C\.customerCodesIn && isAdmin\(\)\) linkCustomers\(bubble/, 'el Admin y el empleado ven el nombre real en el aparato (decisión del Admin 23-10)');
});

test('tapado de clientes: nombre o apellido SUELTO se tapa; dentro de un producto, proveedor conocido o contexto de proveedor no', () => {
  const CLI = [{ id: 'c7', nombre: 'Juan Pérez' }, { id: 'c8', nombre: 'Marta Andina Flores' }, { id: 'c9', nombre: 'Lucía Cárdenas' }];
  const PROD = [{ id: 'P1', nombre: 'Galletas San Juan' }, { id: 'P2', nombre: 'Arroz Costeño', proveedor: 'Alicorp Cárdenas' }];
  const PROV = ['Comercial Andina'];
  const m = (t) => C.maskCustomers(t, CLI, PROD, PROV).text;
  // sueltos: se tapan (la IA nunca ve el nombre de un cliente)
  assert.equal(m('cuánto debe Juan'), 'cuánto debe cliente #c7');
  assert.equal(m('Pérez pagó 20'), 'cliente #c7 pagó 20');
  assert.equal(m('juan pagó y luego perez volvió'), 'cliente #c7 pagó y luego cliente #c7 volvió', 'sin tildes ni mayúsculas');
  assert.equal(m('el proveedor me dijo que Juan no vino'), 'el proveedor me dijo que cliente #c7 no vino', 'con palabras en minúscula en medio no es contexto de proveedor');
  assert.equal(m('Flores debe 10'), 'cliente #c8 debe 10');
  assert.equal(m('Lucía trajo'), 'cliente #c9 trajo');
  // dentro de producto / proveedor conocido / contexto de proveedor: no
  assert.equal(m('stock de Galletas San Juan'), 'stock de Galletas San Juan', 'producto conocido');
  assert.equal(m('compré a Distribuidora San Juan'), 'compré a Distribuidora San Juan', 'contexto: Distribuidora …');
  assert.equal(m('San Juan S.A.C. mandó la factura'), 'San Juan S.A.C. mandó la factura', 'contexto: … S.A.C.');
  assert.equal(m('el proveedor Juan trajo arroz'), 'el proveedor Juan trajo arroz', 'contexto: proveedor …');
  assert.equal(m('Pérez Hermanos S.A.C. trajo arroz'), 'Pérez Hermanos S.A.C. trajo arroz', 'contexto con palabras en mayúscula en medio');
  assert.equal(m('pedido a Comercial Andina hoy'), 'pedido a Comercial Andina hoy', 'proveedor de la lista');
  assert.equal(m('factura de Alicorp Cárdenas'), 'factura de Alicorp Cárdenas', 'proveedor del campo proveedor del producto');
  assert.equal(m('Andina pagó'), 'cliente #c8 pagó', 'fuera del nombre del proveedor, la palabra suelta sí se tapa');
  assert.equal(m('Juan compró Galletas San Juan'), 'cliente #c7 compró Galletas San Juan', 'mismo texto: el cliente se tapa, el producto no');
  assert.equal(m('Marta Andina pagó'), 'cliente #c8 pagó', 'el nombre completo (dos palabras) se tapa igual');
  // la UI le pasa los proveedores que el aparato conoce (productos + movimientos de compra)
  assert.match(UI, /C\.maskCustomers\(text, deps\.clientes\(\), deps\.productos\(\), deps\.proveedores \? deps\.proveedores\(\) : \[\]\)/);
  assert.match(UI, /proveedores: function \(\) \{[^\n]*\n[^\n]*g\('inventoryMovements'\)[\s\S]{0,300}put\(x\.proveedor\); put\(x\.supplier\);/);
});

test('tarjetas: «Mostrando N de M» solo con cuentas (no con plata), tabla vacía dice «Sin datos.», sin repetir tablas', () => {
  const a = UI.indexOf('  function qCount(r)'), b = UI.indexOf('\n', a);
  const qCount = new Function(UI.slice(a, b) + '\nreturn qCount;')();
  assert.equal(qCount({ tipo: 'caja_abierta', total: 20 }), null, 'antes: «Mostrando 1 de 20» con S/ 20');
  assert.equal(qCount({ tipo: 'compras_recientes', total: 20 }), null);
  assert.equal(qCount({ tipo: 'top_productos', total: 300 }), null);
  assert.equal(qCount({ tipo: 'sin_costo', total: 7 }), 7);
  assert.equal(qCount({ tipo: 'creditos_atrasados', total: 3, total_soles: 250 }), 3);
  assert.equal(qCount({ tipo: 'deudas_clientes', total: 99.5, clientes: 4 }), 4);
  assert.match(UI, /!\(r\.filas && r\.filas\.length\) \? '<div class="note na-asst-empty">Sin datos\.<\/div>'/);
  assert.match(UI, /if \(sig && shownSigs\[sig\] != null && shownSigs\[sig\] !== turnNo\) return null;/);
  assert.match(UI, /cardAnchor = bubble;/);
});

test('UI: botón flotante en Inicio e Inventario; Enter mientras responde queda en fila; la pregunta anterior no se arrastra; respuesta una vez', () => {
  assert.match(UI, /var show = allowedHere\(\); rootEl\.style\.display = show \? '' : 'none';/);
  assert.match(UI, /'pageMenu', 'pageInventario'/);
  assert.match(UI, /if \(busy\) \{ if \(!image\) queueMsg\(text\); return; \}/);
  assert.match(UI, /queuedNote\.textContent = 'Te respondo esto apenas termine\.';/);
  assert.equal((UI.match(/drainQueue\(\); \}/g) || []).length, 3);
  assert.match(UI, /var prevLabels = !image && CONT_RE\.test\(text\) && lastCut/);
  const a = UI.indexOf('  var CONT_RE = '), b = UI.indexOf('\n', a); const CONT_RE = new Function(UI.slice(a, b) + '\nreturn CONT_RE;')();
  for (const t of ['sigue', 'Continúa', 'más', 'y el resto?']) assert.ok(CONT_RE.test(t), t);
  for (const t of ['¿cuánto stock hay de Inka Kola?', 'masa de pan', 'siguiente producto']) assert.ok(!CONT_RE.test(t), t);
  assert.match(UI, /liveEl\.style\.cssText = 'position:absolute;width:1px;height:1px;/);
});

// #962: el servidor sigue mandando status {s:'pensando'} mientras retiene texto (tras una palabra delicada), aunque ya haya texto pintado.
test('«Pensando…» con la burbuja ya abierta (status «pensando» de #962) y se quita con el siguiente texto, el final o un reset', () => {
  const pick = (start, endMark) => { const a = UI.indexOf(start); assert.ok(a > 0, start); const b = UI.indexOf(endMark, a); return UI.slice(a, b + endMark.length); };
  const src = [pick('    function ensureBubble()', '\n'), pick('    function writeText(t)', '\n'), pick('    function doneBubble()', '\n'), pick('    function backToThinking()', '\n'),
    pick('    function searching()', '\n')].join('\n') + '\nfunction finalLine() { ' + pick('          doneBubble();', '\n') + ' }';
  class N { constructor(tag, text) { this.tag = tag; this.nodeType = tag ? 1 : 3; this.data = text; this.childNodes = []; this.parentNode = null; this.attrs = {}; const cl = new Set(); this.classList = { add: (...c) => c.forEach((x) => cl.add(x)), remove: (...c) => c.forEach((x) => cl.delete(x)), has: (x) => cl.has(x) }; }
    get firstChild() { return this.childNodes[0] || null; }
    get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = v ? [Object.assign(new N(null, String(v)), { parentNode: this })] : []; }
    insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); n.parentNode = this; return n; }
    appendChild(n) { return this.insertBefore(n, null); }
    removeChild(n) { this.childNodes.splice(this.childNodes.indexOf(n), 1); n.parentNode = null; return n; }
    setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; } }
  const doc = { createElement: (t) => new N(t) };
  const env = { doc, mdOpts: {}, C: { createReplyRenderer: (_d, add) => ({ push: (t) => add(Object.assign(new N('p'), { className: '' }, { childNodes: [new N(null, t)] })) }) },
    setState: () => {}, painter: { reset: () => {} } };
  const make = new Function('env', 'var doc = env.doc, C = env.C, mdOpts = env.mdOpts, setState = env.setState, painter = env.painter;\n' +
    'var thinking = new (env.N)("div"), dots = new (env.N)("span"), bubble = null, panelEl = 1, mine = 1; thinking.textContent = "Pensando"; thinking.appendChild(dots);\n' + src +
    '\nreturn { searching: searching, writeText: writeText, doneBubble: finalLine, backToThinking: backToThinking, bubble: function () { return bubble; }, thinking: thinking, dots: dots };');
  env.N = N;
  const ui = make(env);
  ui.searching({ s: 'buscando' }); assert.equal(ui.thinking.firstChild.data, 'Buscando en su inventario', 'antes del primer texto: como siempre');
  ui.writeText('Listo, revisé '); const b = ui.bubble(); assert.ok(b);
  ui.searching({ s: 'buscando' }); assert.ok(!b.textContent.includes('Pensando'), 'con burbuja, «buscando» no cambia nada');
  ui.searching({ s: 'pensando' }); ui.searching({ s: 'pensando' });
  const holds = () => b.childNodes.filter((n) => n.className === 'na-asst-hold');
  assert.equal(holds().length, 1, 'un solo «Pensando…» aunque lleguen varios status'); assert.equal(holds()[0].textContent, 'Pensando…');
  assert.equal(b.childNodes.at(-1), ui.dots, 'debajo del texto, antes de los puntitos'); assert.equal(b.childNodes.at(-2), holds()[0]);
  ui.writeText('el inventario.'); assert.equal(holds().length, 0, 'vuelve el texto: se quita');
  ui.searching({ s: 'pensando' }); assert.equal(holds().length, 1); ui.doneBubble(); assert.equal(holds().length, 0, 'final: se quita');
  ui.searching({ s: 'pensando' }); ui.backToThinking(); assert.ok(!b.textContent.includes('Pensando…'), 'reset: se quita');
  assert.match(UI, /onStatus: searching \}\);/);
  assert.match(CSS, /\.na-asst-hold\{display:block;/);
});

test('códigos: el tapado nunca entra en un código de cliente («SIN-DOC-MISAEL», «#c7», «CLI_0042»); el nombre suelto fuera del código sí', () => {
  const CLI = [{ id: 'SIN-DOC-MISAEL', nombre: 'Misael Torres' }, { id: 'c7', nombre: 'Juan Pérez' }, { id: 'CLI_0042', nombre: 'Rosa Quispe' }, { id: 'c1', nombre: 'Cliente Varios' }];
  const m = (t) => C.maskCustomers(t, CLI, []).text;
  assert.equal(m('¿Cuánto debe el cliente SIN-DOC-MISAEL?'), '¿Cuánto debe el cliente SIN-DOC-MISAEL?', 'antes: «cliente #SIN-DOC-un cliente»');
  assert.equal(m('¿cuánto debe sin-doc-misael?'), '¿cuánto debe sin-doc-misael?', 'el código de la lista, aunque venga en minúsculas');
  assert.equal(m('cliente #c7 y cliente #SIN-DOC-MISAEL'), 'cliente #c7 y cliente #SIN-DOC-MISAEL');
  assert.equal(m('deuda de CLI_0042 y de JUAN-PEREZ-01'), 'deuda de CLI_0042 y de JUAN-PEREZ-01', 'códigos en MAYÚSCULAS/números con guion o guion bajo');
  assert.equal(m('Misael pagó; Torres también'), 'cliente #SIN-DOC-MISAEL pagó; cliente #SIN-DOC-MISAEL también', 'fuera del código, el nombre sí se tapa');
  assert.equal(m('el cliente Juan'), 'el cliente cliente #c7', '«cliente» (de «Cliente Varios») suelto no es un nombre');
  assert.equal(m('Cliente Varios compró'), 'cliente #c1 compró');
});

test('venta bajo costo: «perdiendo plata», «pierdo plata», «estoy perdiendo» (sin importar tildes ni mayúsculas)', () => {
  const re = new RegExp(UI.match(/var BELOW_RE = \/(.+)\/i;/)[1], 'i');
  for (const t of ['¿Estoy perdiendo plata?', 'creo que pierdo plata con el arroz', 'ESTOY PERDIENDO', 'estóy perdiendo', 'Perdiendo dinero en ventas', 'pierdo la plata', 'Ventas bajo costo', 'vendimos a pérdida'])
    assert.ok(re.test(t), t);
  for (const t of ['¿Cuánto vendimos hoy?', 'perdí el recibo', 'estoy perdido en la pantalla', 'Productos sin costo', 'perdiendo la señal']) assert.ok(!re.test(t), t);
  assert.match(UI, /canBelowCost\(\) && BELOW_RE\.test\(text\)/, 'Admin o nivel 3 con costos (auditoría 500, P-051)');
});

test('tarjetas: «Mostrando N de M» nunca con plata (no «8 de 650» ni «1 de 36»); cada tarjeta va con SU respuesta', () => {
  const a = UI.indexOf('  function qCount(r)'), b = UI.indexOf('\n', a);
  const qCount = new Function(UI.slice(a, b) + '\nreturn qCount;')();
  const h0 = UI.indexOf('  function cardHtml(p) {'), h1 = UI.indexOf('  function cardSig(p)');
  const Cs = { esc: (x) => String(x == null ? '' : x) };
  const cardHtml = new Function('C', 'qCount', 'CUSTOMER_DOCS', 'cliLabel', UI.slice(h0, h1) + '\nreturn cardHtml;')(Cs, qCount, [], (x) => x);
  const rows = (n) => Array.from({ length: n }, (_, i) => ['p' + i, i + 0.5]);
  const card = (tipo, n, extra) => cardHtml({ type: 'consulta', result: Object.assign({ tipo, titulo: tipo, columnas: ['a', 'b'], filas: rows(n) }, extra) });
  for (const [tipo, n, extra] of [['ventas_dia', 8, { total: 650 }], ['top_productos', 8, { total: 650 }], ['caja_abierta', 1, { total: 36 }], ['compras_recientes', 1, { total: 36 }],
    ['deudas_clientes', 8, { total: 650, clientes: 8 }], ['bajo_stock', 8, { total: 650.5 }], ['creditos_atrasados', 1, { total: 36.2, total_soles: 36 }]])
    assert.doesNotMatch(card(tipo, n, extra), /Mostrando/, tipo + ' total=' + extra.total);
  assert.match(card('bajo_stock', 8, { total: 650 }), /Mostrando 8 de 650\./, 'con cuenta de filas sí');
  assert.match(card('deudas_clientes', 8, { total: 999.9, clientes: 36 }), /Mostrando 8 de 36\./, 'deudas: cuenta clientes, no soles');
  // anclado: tarjetas del turno 1 bajo la respuesta 1 aunque el turno 2 ya esté en pantalla; la misma tabla de solo lectura no se repite
  class N { constructor(cls) { this.className = cls; this.parentNode = null; this.dataset = {}; } get nextSibling() { const k = this.parentNode ? this.parentNode.kids : []; return k[k.indexOf(this) + 1] || null; } querySelector() { return null; } querySelectorAll() { return []; } }
  const msgsEl = { kids: [], appendChild(n) { n.parentNode = this; this.kids.push(n); return n; }, insertBefore(n, r) { n.parentNode = this; this.kids.splice(this.kids.indexOf(r), 0, n); return n; },
    querySelectorAll() { return this.kids.filter((k) => k.className === 'na-asst-card'); } };
  const s0 = UI.indexOf('  function cardSig(p)'), s1 = UI.indexOf('  var cardAnchor = null;'), e1 = UI.indexOf('    if (cardAnchor) cardAnchor = c;', s1);
  let n = 0;
  const env = new Function('msgsEl', 'gate', 'el', 'cardHtml', 'shownSigs', 'S',
    UI.slice(s0, s1) + UI.slice(s1, e1) + '    if (cardAnchor) cardAnchor = c; return c; }\nreturn { addCard: addCard, setAnchor: function (x) { cardAnchor = x; }, turn: function (t) { turnNo = t; } };\nvar turnNo = 0;')(
    msgsEl, { add: () => 'k' + (++n) }, (t, cls) => new N(cls), (p) => p.title || '', {});
  const A = msgsEl.appendChild(new N('na-asst-msg a')); env.turn(1); env.setAnchor(A);
  const q = (t) => ({ type: 'consulta', title: t, result: { tipo: 'bajo_stock', titulo: t, filas: [[t, 1]] } });
  const c1 = env.addCard(q('stock'), 'x'), c2 = env.addCard({ type: 'pasos', title: 'ir', pasos: ['a'] }, 'x'); env.setAnchor(null);
  const B = msgsEl.appendChild(new N('na-asst-msg a')); env.turn(2); env.setAnchor(B);
  assert.equal(env.addCard(q('stock'), 'y'), null, 'la misma tabla de solo lectura del turno 1 no se repite');
  const c3 = env.addCard(q('ventas'), 'y'); env.setAnchor(null);
  assert.deepEqual(msgsEl.kids, [A, c1, c2, B, c3], 'cada tarjeta debajo de su respuesta, en orden');
});
