// Sobre f3375c09 (Bots 2/3/4/5): «cliente» acotado, regla del párrafo neutro, tabla del dueño con huecos, el corte de 1200 nunca parte un
// número, «[texto largo omitido]» (solo empleado), espacios largos tras una etiqueta pendiente, y en el celular: aviso de corte solo con
// final.cut === true, cabecera reusada solo de lo ya pintado, sin desborde a 360 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assistantChatRoute, createMemoryUsageStore, createTextEmitter, redactFor, redactText, redactEmployeeText, capReply, ownerHold, CUT_NOTICE, REPLY_MAX } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const UI = read('POS/js/modules/asistente/asistente-ui.js'), CSS = read('POS/css/asistente.css');

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas', ROLES = ['owner', EMP];
const red = (t, role = EMP) => redactFor(role)(t);
function emit(text, role, n, max = 1e9) { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, max, redactFor(role), role === 'owner' ? null : ownerHold); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const same = (t, role) => { const f = red(t, role); for (const n of [1, 3, 7, 47]) assert.equal(emit(t, role, n), f, role + ' trozos de ' + n + ': ' + JSON.stringify(t.slice(0, 40))); return f; };

test('«cliente» (Bot 2): solo «del cliente», «de los clientes», «el cliente pagó/compró» quedan visibles; «para el cliente» se tapa', () => {
  for (const t of ['Compras para el cliente: Galleta S/ 1.80, Arroz S/ 3.10', 'Compras para el cliente:\n- Galleta S/ 1.80\n- Arroz S/ 3.10']) {
    const f = same(t, EMP); assert.ok(!/1\.80|3\.10/.test(f), f); }
  for (const t of ['Compras del cliente: S/ 30', 'Las compras de los clientes: S/ 30', 'El cliente pagó sus compras: S/ 30', 'El cliente compró: S/ 30']) assert.equal(same(t, EMP), t);
});

test('párrafo neutro (Bot 2): corta la presentación del dueño solo si NO termina en «:» y tiene 8 palabras o más (o viene un título de venta)', () => {
  const t = 'Te paso los costos:\n\nSon de esta semana.\n\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |';
  assert.ok(!/1\.80/.test(same(t, EMP)));
  assert.ok(!/1\.80/.test(same('Te paso los costos:\n\nY también estos de abajo:\n\n- Galleta S/ 1.80', EMP)), 'termina en «:»: sigue');
  const long = 'Te paso los costos:\n\nAhora te cuento otra cosa distinta sobre la tienda de hoy.\n\n- Galleta S/ 1.80';
  assert.match(same(long, EMP), /1\.80/, '8 palabras o más sin «:»: ya no es la lista del dueño');
});

test('tabla del dueño con huecos (Bot 5): líneas en blanco y líneas cortas de texto no la cortan; párrafo largo, título de venta o cabecera nueva sí', () => {
  const H = 'Te paso los costos:\n| Producto | Precio |\n|---|---|\n';
  for (const t of [H + '\n\n| Producto 0 | S/ 1.80 |', H + 'zz\nyy\n| Producto 0 | S/ 1.80 |', H + '| Producto 0 | S/ 1.80 |\n\n| Producto 1 | S/ 1.81 |',
    H + '\n\n\n\nzz\n\nyy\n\n| Producto 0 | S/ 1.80 |\n\n\n| Producto 1 | S/ 1.81 |', '| Producto | Costo |\n|---|---|\n\n\nzz\n| Producto 0 | S/ 1.80 |\n\n| Producto 1 | S/ 1.81 |']) {
    const f = same(t, EMP); assert.ok(!/1\.8[01]/.test(f), JSON.stringify(f)); }
  assert.match(same(H + '| Producto 0 | S/ 1.80 |\n\nAhora te cuento otra cosa distinta sobre la tienda de hoy.\n\nArroz S/ 4.20', EMP), /4\.20/, 'párrafo largo: termina');
  assert.match(same(H + '| Producto 0 | S/ 1.80 |\n\nPrecios de venta:\n| Producto | PVP |\n|---|---|\n| Arroz | S/ 4.20 |', EMP), /4\.20/, 'título de venta + cabecera nueva: termina');
  assert.match(same('Precios de venta:\n| Producto | PVP |\n|---|---|\n\n\n| Arroz | S/ 4.20 |', EMP), /4\.20/, 'tabla de venta con huecos: se ve');
});

test('corte de 1200 (Bots 2/4/5, invariante): ningún número sale partido, con o sin moneda o separadores; partes = final (propiedad)', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), pick = (a) => a[Math.floor(rnd() * a.length)];
  const AM = ['1,250 unid.', '12.5 kg', 'S/ 1,250.40', 'S/1,250', 'aS/2', 'US$2', 'US$ 1,999.99', '$2', 'PEN 3.50', 'S/. 12.5', '1,250.40', '12x', '3.80', '1.234.567,89', 'S/2'];
  const NUM = /(?:S\/\.?|US\$|\$|PEN)?[ \t]*\d[\d.,]*/gi;
  let cuts = 0;
  for (let c = 0; c < 600; c++) {
    const spaces = rnd() < 0.5; let t = '';
    while (t.length < 1100 + rnd() * 80) t += spaces ? pick(['palabra ', 'texto ', 'y ', 'Se vende a ']) : 'a';
    while (t.length < 1320) { t += pick(AM); t += spaces ? pick(['a', ' ', '\n', 'palabra ', '| ', ' |\n']) : pick(['a', 'b', '']); }
    for (const role of ROLES) {
      const f = red(t, role), cut = capReply(f); if (!cut.endsWith(CUT_NOTICE)) continue; cuts++;
      const body = cut.slice(0, -CUT_NOTICE.length).replace(/\n+$/, ''); assert.ok(f.startsWith(body));
      for (const m of body.matchAll(NUM)) { const at = new RegExp(NUM.source, 'giy'); at.lastIndex = m.index; const w = at.exec(f);
        assert.equal(w && w[0], m[0], 'número partido en ' + m.index + ': ' + JSON.stringify(body.slice(-25)) + ' | ' + JSON.stringify(f.slice(body.length, body.length + 12))); }
      assert.ok(!/(?:S\/\.?|US\$|\$|PEN)[ \t]*$/i.test(body) && !/\[[^\]]*$/.test(body), JSON.stringify(body.slice(-20)));
      const n = 1 + Math.floor(rnd() * 9); assert.equal(emit(t, role, n, REPLY_MAX), cut, role + ' partes de ' + n);
    }
  }
  assert.ok(cuts > 800, 'casos cortados ' + cuts);
});

test('«[texto largo omitido]» (Bot 3/2): solo en turnos del empleado; el dueño ve enlaces y códigos enteros; partes = entero', () => {
  const url = 'https://ejemplo.com/' + 'a1'.repeat(100), t = 'Mira ' + url + ' y listo';
  const e = same(t, EMP); assert.ok(e.includes('[texto largo omitido]') && !e.includes('a1a1a1') && e.endsWith(' y listo'), e);
  assert.equal(same(t, 'owner'), t, 'dueño: intacto');
  assert.equal(redactEmployeeText('x'.repeat(160)), 'x'.repeat(160), '160 exactos: igual');
  assert.ok(redactEmployeeText('x'.repeat(161)).includes('[texto largo omitido]'));
  const img = 'data:image/png;base64,' + 'QUJD'.repeat(100) + ' fin'; for (const role of ROLES) assert.equal(same(img, role), '[imagen omitida] fin', 'imágenes: igual que antes');
  // etiqueta pendiente: sigue pendiente tras el tramo quitado
  const ruc = same('RUC:' + 'x'.repeat(300) + ' 20123456789', EMP); assert.ok(!/20123456789|0123456/.test(ruc), ruc);
  const k = same('clave:' + 'x'.repeat(300) + ' abc123', EMP); assert.ok(!/abc123/.test(k), k);
  // texto plano: ninguna marca especial en el celular
  assert.ok(!/texto largo omitido/.test(UI));
});

test('espacios largos tras etiqueta pendiente (Bot 3): >160 se juntan en uno, entero y en partes, dueño y empleado; el valor sigue tapado', () => {
  for (const role of ROLES) {
    for (const [t, v] of [['RUC:' + ' '.repeat(500) + '20123456789 ok', /20123456789/], ['clave' + ' '.repeat(500) + 'abc123 ok', /abc123/], ['pin:\n' + ' '.repeat(450) + '4321 ok', /4321/],
      ['token = ' + '\n'.repeat(300) + 'abcdef123456 ok', /abcdef123456/]]) {
      const f = same(t, role); assert.ok((role === 'owner' && /^RUC/.test(t) ? v.test(f) : !v.test(f)) && !/\s{2,}/.test(f.replace(/^\S+/, '')), role + ' ' + JSON.stringify(f)); }
    const plain = 'texto ' + ' '.repeat(500) + 'normal'; assert.equal(same(plain, role), plain, 'sin etiqueta: no cambia');
  }
});

test('ruta: la respuesta (JSON y final en partes) lleva cut true/false del servidor', async () => {
  const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
  const rows = (n) => Array.from({ length: n }, (_, i) => '| Producto número ' + i + ' | S/ 2.' + String(i).padStart(2, '0') + ' |\n').join('');
  const call = (reply, stream) => assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'precios', ...(stream ? { stream: true } : {}) }) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', DEEPSEEK_API_KEY: 'k' }, { principalId: 'session:x', posRole: 'owner' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => 'owner', reader: { products: async () => [] }, audit: async () => {},
      fetch: async () => stream ? new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
        : jsonR({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }) });
  const big = 'Precios de venta:\n| Producto | PVP |\n|---|---|\n' + rows(45);
  const finalOf = async (r) => { const out = []; const p = C.createSseParser((e, d) => out.push({ e, d })); const rd = r.body.getReader(), dec = new TextDecoder(); for (;;) { const { value, done } = await rd.read(); if (done) break; p.feed(dec.decode(value, { stream: true })); } return out.find((x) => x.e === 'final').d; };
  assert.equal((await (await call(big)).json()).cut, true);
  const forged = 'Hola.\n\n' + CUT_NOTICE; const small = await (await call(forged)).json(); assert.equal(small.cut, false, 'aviso escrito por el modelo: cut false');
  assert.equal((await finalOf(await call(big, true))).cut, true); assert.equal((await finalOf(await call(forged, true))).cut, false);
});

test('celular: aviso como nota SOLO con final.cut === true (nunca por el texto); cabecera reusada solo de lo pintado; sin desborde a 360 px', () => {
  assert.match(UI, /if \(d\.cut === true\) \{[^\n]*paintCut\(bubble, d\.reply, mdOpts\)/);
  assert.ok(!/cortada por largo|CUT_NOTICE|sigue" para/.test(UI), 'el celular no busca el texto del aviso');
  assert.match(UI, /lastCut\._md\.labels\(\)/, 'la cabecera sale del renderer de la burbuja anterior (texto ya filtrado y pintado)');
  assert.match(CSS, /\.na-asst-msg\{[^}]*overflow-wrap:anywhere/);
  // renderer: filas sueltas al inicio usan la cabecera dada; con otro número de columnas, o tras una tabla propia, no
  const fake = () => { const kids = []; const mk = (tag) => ({ tagName: tag, childNodes: [], className: '', attrs: {}, appendChild(k) { this.childNodes.push(k); return k; }, setAttribute(a, v) { this.attrs[a] = v; }, set textContent(v) { this.childNodes = [{ nodeType: 3, data: v }]; } });
    return { kids, doc: { createElement: mk, createTextNode: (t) => ({ nodeType: 3, data: t }) } }; };
  const run = (txt, labels) => { const f = fake(); const r = C.createReplyRenderer(f.doc, (n) => f.kids.push(n), labels ? { labels } : undefined); r.push(txt); r.finish(); return { kids: f.kids, rows: r.rows(), labels: r.labels() }; };
  const a = run('| Arroz | [dato del Admin] |\n| Leche | [dato del Admin] |\nFin.', ['Producto', 'Precio']); assert.equal(a.rows, 2); assert.deepEqual(a.labels, ['Producto', 'Precio']);
  assert.equal(run('| Arroz | x | y |\n', ['Producto', 'Precio']).rows, 1, '(Bot 4 sobre 25ffde10) columnas distintas: fila igual (sobrantes juntas en la última)');
  assert.equal(run('| Arroz | x |\n', null).rows, 0, 'sin cabecera previa: texto');
  const prev = run('Lista:\n| Producto | Precio |\n|---|---|\n| Arroz | [dato del Admin] |\n'); assert.deepEqual(prev.labels, ['Producto', 'Precio'], 'la cabecera reusable sale de lo pintado');
  const own = run('| A | B |\n|---|---|\n| 1 | 2 |\n\n| x | y |\n', ['Producto', 'Precio']); assert.equal(own.rows, 1, 'tras una tabla propia no se reusa');
  // un aviso escrito por el modelo sale como texto normal (el renderer nunca crea notas)
  const fk = run('Hola.\n\n' + CUT_NOTICE); assert.ok(fk.kids.every((k) => k.nodeType === 3), 'texto plano');
});

test('celular (Bot 4, 1 y 3): cabecera de tabla legible en claro y oscuro; «Ver nuevo ↓» nunca tapa la nota de corte', () => {
  assert.match(CSS, /\.na-asst-tbl th\{[^}]*color:#0f172a/); assert.match(CSS, /body\.dark \.na-asst-tbl th\{[^}]*color:#e5f3ea/);
  assert.match(UI, /function showNew\(\) \{ if \(!newBtn \|\| !msgsEl \|\| noteSeen\(\) \|\| \(liveCard && inView\(liveCard\)\)\) return;/, 'con la nota (o la tarjeta que se confirma, Bot 4 sobre f773911f) a la vista no se muestra');
  assert.match(UI, /if \(!newBtn\.hidden && \(atBottom\(\) \|\| noteSeen\(\)\)\) newBtn\.hidden = true;/, 'al llegar la nota a la vista se esconde');
  assert.match(UI, /m\.appendChild\(n\); cutNote = n; \}/, 'la nota que se mira es la que pintó paintCut (solo con final.cut === true)');
  // noteSeen con rectángulos de mentira: a la vista (aunque sea en parte) -> true; debajo de lo visible -> false
  const src = UI.match(/function noteSeen\(\) \{[^\n]*/)[0];
  const f = (top, bottom) => new Function('cutNote', 'msgsEl', src + '; return noteSeen();')({ isConnected: true, getBoundingClientRect: () => ({ top, bottom }) }, { getBoundingClientRect: () => ({ top: 100, bottom: 600 }) });
  assert.equal(f(560, 590), true); assert.equal(f(590, 620), true); assert.equal(f(610, 640), false); assert.equal(f(40, 90), false);
});
