// Bot 2 sobre 87c6fe8e: el tope de 1200 ya no corta en silencio (dueño y empleado): corte en línea entera + aviso, en la respuesta final y
// en lo pintado. Bot 5: «sigue» del empleado arranca el filtro con la cola de la parte cortada (solo estado, nunca sale); sin eso no.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantChatRoute, createMemoryUsageStore, createTextEmitter, redactFor, redactOwnerData, redactText, capReply, cutPrime, CUT_NOTICE, REPLY_MAX } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('red prohibida en las pruebas'); };
test.after(() => { globalThis.fetch = realFetch; });
const EMP = 'empleado:consultas';
const rows = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
const OWNER_TABLE = 'Te paso los costos:\n| Producto | Precio |\n|---|---|\n' + rows(40, (i) => '| Producto número ' + i + ' | S/ 1.' + String(i).padStart(2, '0') + ' |\n') + 'Fin de la lista.';
const SALE_TABLE = 'Precios de venta de hoy:\n| Producto | PVP |\n|---|---|\n' + rows(40, (i) => '| Producto número ' + i + ' | S/ 2.' + String(i).padStart(2, '0') + ' |\n') + 'Fin.';
function emit(text, role, n, max = REPLY_MAX, prime = '') { let o = ''; const e = createTextEmitter((d) => { if (d.t) o += d.t; }, max, redactFor(role), null, prime); for (let i = 0; i < text.length; i += n) e.push(text.slice(i, i + n)); e.flush(); return o; }
const filtered = (t, role, prime = '') => (role === 'owner' ? redactText(t) : redactOwnerData(redactText(t), prime));

test('tope: bajo 1200 no cambia nada; una tabla de 40 filas se corta en el fin de una fila y lleva el aviso (dueño y empleado)', () => {
  assert.equal(capReply('Hola.'), 'Hola.'); assert.equal(capReply('x'.repeat(1200)), 'x'.repeat(1200));
  for (const role of ['owner', EMP]) {
    const f = filtered(OWNER_TABLE, role); assert.ok(f.length > 1200, role + ' ' + f.length);
    const c = capReply(f); assert.ok(c.endsWith('\n\n' + CUT_NOTICE) || c.endsWith('\n' + CUT_NOTICE)); const body = c.slice(0, -CUT_NOTICE.length).replace(/\n+$/, '');
    assert.ok(body.length <= 1200 && body.length >= 1200 - 160, role + ' ' + body.length);
    const last = body.slice(body.lastIndexOf('\n') + 1); assert.match(last, /^\| Producto número \d+ \| .+ \|$/, 'la última fila está entera: ' + last);
    assert.ok(f.startsWith(body + '\n'), 'lo que queda es el comienzo exacto del texto filtrado');
  }
  // una frase larga sin saltos: corte en espacio
  const long = ('palabra ').repeat(300); const c = capReply(long); assert.ok(c.endsWith('\n\n' + CUT_NOTICE)); assert.ok(long.startsWith(c.slice(0, c.indexOf('\n\n'))));
});
for (const n of [1, 5, 47, 100]) {
  test('tope en partes de ' + n + ': lo pintado es igual a la respuesta final (corte en la fila + aviso); bajo el tope igual que antes', () => {
    for (const role of ['owner', EMP]) for (const t of [OWNER_TABLE, SALE_TABLE, 'Hay 3 galletas.\nY 4 arroces.', ('El arroz está bien de stock. ').repeat(60)]) {
      const o = emit(t, role, n), want = capReply(filtered(t, role)); assert.equal(o, want, role + ' ' + n + ' ' + t.slice(0, 30));
      if (filtered(t, role).length <= 1200) assert.ok(!o.includes(CUT_NOTICE)); else assert.ok(o.endsWith(CUT_NOTICE));
    }
    const emp = emit(OWNER_TABLE, EMP, n); assert.ok(!/S\/ 1\.\d\d/.test(emp), 'el aviso va después del filtro: nada destapado'); assert.match(emp, /\[dato del dueño\]/);
  });
}
test('«sigue» (filtro del empleado): tras una parte cortada con presentación del dueño, las filas que siguen se tapan; tras una parte solo de venta, se ven', () => {
  const part1 = capReply(filtered(OWNER_TABLE, EMP)), prime = cutPrime(part1);
  assert.ok(prime && !prime.includes(CUT_NOTICE) && prime.length <= 700 && /Te paso los costos:/.test(prime), JSON.stringify(prime));
  const cont = '| Arroz | S/ 1.80 |\n| Leche | S/ 2.20 |\nEso es todo.';
  assert.ok(!/1\.80|2\.20/.test(redactOwnerData(cont, prime)), redactOwnerData(cont, prime));
  assert.ok(/1\.80/.test(redactOwnerData(cont)), 'sin contexto se vería (por eso el contexto)');
  for (const n of [1, 5, 47]) assert.equal(emit(cont, EMP, n, REPLY_MAX, prime), redactOwnerData(cont, prime), 'partes = entero, con contexto');
  const sale1 = capReply(filtered(SALE_TABLE, EMP)), sp = cutPrime(sale1); assert.ok(sale1.endsWith(CUT_NOTICE) && sp);
  assert.equal(redactOwnerData(cont, sp), cont, 'tras una parte solo de venta sigue visible');
  assert.equal(cutPrime('Hola, sin corte.'), '', 'sin aviso no hay contexto');
});
test('«sigue»: el contexto nunca sale y casi no cuesta (CPU y retención)', () => {
  const part1 = capReply(filtered(OWNER_TABLE, EMP)), prime = cutPrime(part1);
  const cont = rows(20, (i) => '| Item ' + i + ' | S/ 3.' + String(i).padStart(2, '0') + ' |\n');
  const o = emit(cont, EMP, 5, 1e9, prime); assert.ok(!o.includes('Te paso') && !o.includes('Producto número'), 'nada del contexto en la salida');
  const time = (p) => { const r = []; for (let k = 0; k < 9; k++) { const t0 = performance.now(); emit(cont, EMP, 5, 1e9, p); r.push(performance.now() - t0); } r.sort((a, b) => a - b); return r[4]; };
  const a = time(''), b = time(prime); console.log('# contexto «sigue»: ' + prime.length + ' caracteres; sin ' + a.toFixed(2) + ' ms, con ' + b.toFixed(2) + ' ms');
  assert.ok(b - a < 2, 'extra ' + (b - a).toFixed(2) + ' ms');
});

// ---------- en la ruta: par firmado cortado -> el siguiente turno del empleado tapa; sin firma o dueño, nada ----------
const SECRET = 'secreto-de-prueba-1234567890';
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const TEXT = (t) => ({ choices: [{ message: { content: t } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
const reader = { products: async () => [], productsById: async () => new Map(), purchases: async () => [] };
function route(body, role, reply) {
  return assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-test-FAKE' }, { principalId: 'session:x', posRole: role === 'owner' ? 'owner' : 'empleado' }, jsonR,
    { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: async () => jsonR(TEXT(reply)), reader, audit: async () => {}, mockChunkMs: 0 });
}
test('ruta: la respuesta final lleva el aviso; «sigue» con el par FIRMADO cortado tapa las filas siguientes; sin par válido no hay contexto', async () => {
  const d1 = await (await route({ text: 'dame los costos' }, EMP, OWNER_TABLE)).json();
  assert.equal(d1.ok, true); assert.ok(d1.reply.endsWith(CUT_NOTICE), d1.reply.slice(-120)); assert.ok(!/S\/ 1\.\d\d/.test(d1.reply));
  const cont = '| Arroz | S/ 1.80 |\n| Leche | S/ 2.20 |';
  const d2 = await (await route({ text: 'sigue', history: d1.turns }, EMP, cont)).json();
  assert.ok(!/1\.80|2\.20/.test(d2.reply), 'con el par firmado: ' + d2.reply);
  const unsigned = [{ role: 'user', content: 'dame los costos' }, { role: 'assistant', content: d1.reply }];
  const d3 = await (await route({ text: 'sigue', history: unsigned }, EMP, cont)).json();
  assert.match(d3.reply, /1\.80/, 'sin firma no hay contexto (y el turno tampoco va al modelo)');
  const d4 = await (await route({ text: 'sigue', history: d1.turns }, 'owner', cont)).json();
  assert.equal(d4.reply, cont, 'dueño: sin filtro ni contexto');
  const short = await (await route({ text: 'hola' }, 'owner', 'Hola, ¿en qué te ayudo?')).json(); assert.equal(short.reply, 'Hola, ¿en qué te ayudo?');
});
