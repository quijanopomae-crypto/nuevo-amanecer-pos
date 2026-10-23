// fix/asist-confirm-fila-sin-cantidad (tras #997 y la revisión de #1002): la fila mixta «2 cajas y 3 sueltos» llega a la tarjeta de compra
// con cantidad vacía y «Falta cuántas trae la caja». El celular solo ofrece «Quitar fila», pero un celular viejo o modificado podía mandar
// «aceptar» esa fila: el servidor la rechazaba con over_limit («pasa el límite (cantidad mayor a 9999)»), un motivo que no es el real.
// Ahora /confirm responde 422 review_required (el camino markRows del celular) con esa fila y «Falta cuántas trae la caja», sin aplicar nada.
// Quitar la fila sigue confirmando las demás; las filas con cantidad no cambian; la firma de la propuesta no se puede saltar.
// Modelo siempre simulado (sin red), código REAL de chat y confirm.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../tools/cloudflare-lab/src/pos-assistant.js';

const { assistantChatRoute, assistantConfirmRoute, createMemoryUsageStore, readConfirmToken, issueConfirmToken, MISSING_BOX_TEXT } = A;
const SECRET = 'confirm-fila-sin-cantidad-secret-0123456789';
const env = { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: SECRET, OHMYAGENT_API_KEY: 'test-only' };
const auth = { principalId: 'owner-fsc', sessionId: 'session-fsc' };
const PRODUCTS = [
  { id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', controla: true, precio: 4, stock: 35, costo: 3.14, unidad: 'kilogramo' },
  { id: 'u07', nombre: 'ACEITE PRIMOR CLASICO 900ML X 12BOT', controla: true, precio: 10.5, stock: 8, costo: 8.3 }
];
const READER = { products: async () => PRODUCTS, purchases: async () => [], credits: async () => [], customers: async () => [] };
const NOW = 200000;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
const call = (name, args) => ({ content: '', tool_calls: [{ id: 'c-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

async function chat(text, message) {
  const res = await assistantChatRoute(new Request('https://w.test/auth/assistant/chat', { method: 'POST', body: JSON.stringify({ text, context: { products: PRODUCTS } }) }), env, auth, json, {
    store: createMemoryUsageStore(), now: () => NOW, resolveRole: async () => 'owner', audit: async () => {}, reader: READER,
    fetch: async () => new Response(JSON.stringify({ choices: [{ message }] }))
  });
  return { status: res.status, body: await res.json() };
}
function confirmer(store = createMemoryUsageStore()) {
  return async (token, proposal, review) => {
    const r = await assistantConfirmRoute(new Request('https://w.test/auth/assistant/confirm', { method: 'POST', body: JSON.stringify({ token, proposal, review }) }), env, auth, json, {
      store, now: () => NOW + 1000, resolveRole: async () => 'owner', audit: async () => {}, reader: READER });
    return { status: r.status, body: await r.json() };
  };
}
// Tarjeta REAL: «compre 10 azucar rubia y 2 cajas y 3 sueltos de primor» -> fila 0 azúcar (10, marcada «costo»: el costo no se dijo),
// fila 1 mixta (cantidad vacía). La fila 0 se acepta («Está bien») en las pruebas: es una fila con cantidad y sigue igual.
async function mixedCard() {
  const { body } = await chat('compre 10 azucar rubia y 2 cajas y 3 sueltos de primor',
    call('preparar_compra', { lineas: [{ product_id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', cantidad: 10, costo_unitario: 3.14 }] }));
  const p = body.proposals.find((x) => x.type === 'compra');
  assert.ok(p && p.confirm_token, 'hay tarjeta de compra firmada');
  assert.equal(p.lineas[1].cantidad, null); assert.ok(p.lineas[1].revisar.includes(MISSING_BOX_TEXT));
  const { confirm_token, ...clean } = p;
  return { token: confirm_token, proposal: clean, op: (await readConfirmToken(confirm_token, SECRET)).op };
}
const isMissingBox = (b, rows) => {
  assert.equal(b.error, 'review_required', JSON.stringify(b));
  assert.deepEqual(b.rows, rows);
  assert.ok(typeof b.message === 'string' && b.message.includes(MISSING_BOX_TEXT), 'el aviso conserva «Falta cuántas trae la caja»: ' + b.message);
};

test('«aceptar» la fila mixta sin cantidad -> 422 review_required con esa fila y «Falta cuántas trae la caja»; no se aplica nada', async () => {
  const { token, proposal, op } = await mixedCard();
  const send = confirmer();
  let r = await send(token, proposal, { op, accept: [0, 1] });
  assert.equal(r.status, 422); isMissingBox(r.body, [1]);
  assert.match(r.body.message, /«primor \(2 cajas y 3 sueltos\)»/, 'nombra la fila');
  assert.doesNotMatch(r.body.message, /límite|9999/, 'no es un tope: falta la cantidad');
  assert.equal(r.body.operation_id, op);
  assert.ok(!r.body.proposal && !r.body.ok, 'nada aplicado');
  // aceptar solo la mixta tampoco: las dos filas quedan marcadas, con el aviso
  r = await send(token, proposal, { op, accept: [1] });
  assert.equal(r.status, 422); isMissingBox(r.body, [0, 1]);
  // la tarjeta NO quedó usada: quitar la fila mixta confirma la otra con la misma tarjeta
  r = await send(token, proposal, { op, accept: [0], drop: [1] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.proposal.lineas.map((l) => [l.product_id, l.cantidad]), [['u13', 10]]);
  assert.deepEqual(r.body.proposal.quitadas, [1]); assert.deepEqual(r.body.proposal.aceptadas, [0]);
});

test('fila mixta sin decidir -> 422 review_required con la fila y el mismo aviso', async () => {
  const { token, proposal, op } = await mixedCard();
  const send = confirmer();
  for (const [review, rows] of [[undefined, [0, 1]], [{ op, accept: [] }, [0, 1]], [{ op, accept: [0] }, [1]]]) {
    const r = await send(token, proposal, review);
    assert.equal(r.status, 422, JSON.stringify(review)); isMissingBox(r.body, rows);
  }
});

test('un «aceptar» de otro token no cuenta: la fila sigue marcada', async () => {
  const { token, proposal } = await mixedCard();
  const r = await confirmer()(token, proposal, { op: 'AST-otro', accept: [0, 1] });
  assert.equal(r.status, 422); isMissingBox(r.body, [0, 1]);
});

test('celular modificado: poner cantidad o quitar la marca de la fila mixta cambia la firma -> 409, nada aplicado', async () => {
  const { token, proposal, op } = await mixedCard();
  const send = confirmer();
  const conCantidad = { ...proposal, lineas: proposal.lineas.map((l, i) => (i === 1 ? { ...l, cantidad: 3 } : l)) };
  let r = await send(token, conCantidad, { op, accept: [0, 1] });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'proposal_changed');
  const sinMarca = { ...proposal, lineas: proposal.lineas.map(({ revisar, limite, ...l }, i) => (i === 1 ? l : { ...l, ...(revisar ? { revisar } : {}), ...(limite ? { limite } : {}) })) };
  r = await send(token, sinMarca, { op, accept: [0, 1] });
  assert.equal(r.status, 409); assert.equal(r.body.error, 'proposal_changed');
  // sigue sin usarse: la tarjeta original con la fila quitada confirma
  r = await send(token, proposal, { op, accept: [0], drop: [1] });
  assert.equal(r.status, 200);
});

test('cantidad null, vacía, ausente o 0 en una tarjeta firmada: «aceptar» -> 422 review_required con el aviso; las filas con cantidad pasan', async () => {
  for (const variant of ['null', 'vacia', 'ausente', 'cero']) {
    const bad = { product_id: null, nombre: 'leche gloria (1 caja y 5 unidades)', costo_unitario: 2, costo_actual: null, revisar: [MISSING_BOX_TEXT], limite: ['cantidad'] };
    if (variant === 'null') bad.cantidad = null; else if (variant === 'vacia') bad.cantidad = ''; else if (variant === 'cero') bad.cantidad = 0;
    const proposal = { id: 'p1-preparar_compra', type: 'compra', needsConfirm: true, title: 'Preparar compra', proveedor: 'Prov', documento: 'F001-1', fecha: '',
      lineas: [{ product_id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', cantidad: 10, costo_unitario: 3.14, costo_actual: 3.14 }, bad], sinProducto: 1, revisarFilas: 1, fueraDeLimite: 1 };
    const token = await issueConfirmToken(proposal, 'owner', auth, SECRET, NOW);
    const op = (await readConfirmToken(token, SECRET)).op;
    const send = confirmer();
    let r = await send(token, proposal, { op, accept: [1] });
    assert.equal(r.status, 422, variant + ' ' + JSON.stringify(r.body)); isMissingBox(r.body, [1]);
    r = await send(token, proposal, { op, drop: [1] });
    assert.equal(r.status, 200, variant);
    assert.deepEqual(r.body.proposal.lineas.map((l) => l.cantidad), [10]);
  }
});

test('filas con cantidad válida no cambian: «aceptar» una fila marcada por costo raro sigue confirmando', async () => {
  const { body } = await chat('compre 10 azucar rubia a 30',
    call('preparar_compra', { lineas: [{ product_id: 'u13', nombre: 'AZUCAR RUBIA X 50KG', cantidad: 10, costo_unitario: 30 }] }));
  const p = body.proposals.find((x) => x.type === 'compra');
  assert.ok(p.lineas[0].revisar && p.lineas[0].revisar.length, 'fila marcada (costo raro)');
  const { confirm_token, ...clean } = p; const op = (await readConfirmToken(confirm_token, SECRET)).op;
  const send = confirmer();
  let r = await send(confirm_token, clean, undefined);
  assert.equal(r.status, 422); assert.equal(r.body.error, 'review_required'); assert.deepEqual(r.body.rows, [0]);
  assert.equal(r.body.message, undefined, 'sin fila sin cantidad: el 422 de siempre');
  r = await send(confirm_token, clean, { op, accept: [0] });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.proposal.aceptadas, [0]);
});
