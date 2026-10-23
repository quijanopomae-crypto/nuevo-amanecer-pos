// Auditoría 500 (pedido de alfa sobre #984): employeeQueryResult deja pasar el `texto` de la consulta tal cual al empleado.
// Aquí se comprueba, por la entrada real del chat (assistantChatRoute, modelo simulado que llama «consultar»), que NINGÚN nivel de
// empleado llega a una consulta cuyo texto traiga montos: ventas, ganancia, costos, caja, deudas, compras. Datos sembrados con
// cifras únicas para que cualquier fuga se vea. Control positivo: el Admin, con las mismas llamadas, SÍ ve esas cifras (la prueba
// no pasa por vacía). Lado de ENTRADA (lo que entrega la consulta); el tapado de la respuesta final es de fix/asist-seguridad-500.
// Precio de venta: permitido (es la misma columna «Precio S/» de la lista de precios del empleado).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assistantChatRoute, employeeQueryResult } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { memoryReader, runAssistantQuery, QUERY_TYPES, stockLabel } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';
import { LEVEL_NAMES, COSTS_ROLE, capabilitiesFor, seesOwnerData } from '../../tools/cloudflare-lab/src/pos-assistant-levels.js';

import { NOW, DATA, ARGS, chatWith, amounts, assertNoMoney } from './empleado-montos-datos.mjs';

const EMPLOYEE_ROLES = LEVEL_NAMES.map((n) => 'empleado:' + n).concat(['empleado', 'sin_rol', 'empleado:desconocido']);
// Nivel 3 + «costos y cambios»: ve ventas y ganancia a propósito (lo da el Admin), pero nunca deudas, caja, créditos, sugerencias ni resúmenes.
const COSTS_FORBIDDEN = ['deudas_clientes', 'deuda_cliente', 'creditos_atrasados', 'caja_abierta', 'sugerencias_compra', 'resumen_dia', 'resumen_mes'];

const chat = (role, tipo, o) => chatWith(assistantChatRoute, role, tipo, o);

test('control: con estos datos el Admin SÍ recibe montos en el texto (la prueba no es vacía)', async () => {
  for (const [tipo, fig] of [['ventas_periodo', '2222.22'], ['ganancia', ''], ['deudas_clientes', '1197.63'], ['caja_abierta', '666.66'], ['compras_recientes', '43210.99'], ['ventas_por_hora', ''], ['top_productos', '1234.57']]) {
    const r = await chat('owner', tipo);
    assert.equal(r.status, 200, tipo);
    assert.ok(amounts(r.out).length > 0, `${tipo}: el Admin ve S/ en el texto: ${r.out.slice(0, 300)}`);
    if (fig) assert.ok(r.out.includes(fig), `${tipo}: el Admin ve ${fig}`);
  }
  // y la consulta cruda trae montos en el texto en cada tipo con plata
  for (const tipo of ['ventas_periodo', 'top_productos', 'ganancia', 'deudas_clientes', 'deuda_cliente', 'creditos_atrasados', 'caja_abierta', 'compras_recientes', 'ventas_por_hora', 'sugerencias_compra']) {
    const q = await runAssistantQuery(memoryReader(DATA), { tipo, ...ARGS }, NOW);
    assert.ok(amounts(q.texto).length > 0, `${tipo} trae S/ en el texto: ${q.texto}`);
  }
});

test('niveles de empleado sin «costos»: solo stock_producto y bajo_stock están permitidos (fuente única de niveles)', () => {
  for (const role of EMPLOYEE_ROLES) {
    assert.equal(seesOwnerData(role), false, role);
    const c = capabilitiesFor(role).consultas;
    assert.ok(Array.isArray(c) && c.every((t) => ['stock_producto', 'bajo_stock'].includes(t)), `${role}: ${JSON.stringify(c)}`);
  }
});

for (const stream of [false, true]) {
  test(`empleado (todos los niveles sin «costos»${stream ? ', en partes' : ''}): ninguna consulta le entrega montos; las de plata ni se leen`, async () => {
    for (const role of EMPLOYEE_ROLES) for (const tipo of QUERY_TYPES) {
      const label = `${role} / ${tipo}${stream ? ' / partes' : ''}`;
      const r = await chat(role, tipo, { stream });
      assert.ok([200, 403].includes(r.status), `${label}: ${r.status}`);
      assertNoMoney(label, r.out);
      assertNoMoney(label + ' (al modelo)', r.toModel);
      if (!['stock_producto', 'bajo_stock'].includes(tipo)) {
        const money = r.reads.filter((k) => k !== 'products' && k !== 'productsById');
        assert.deepEqual(money, [], `${label}: no lee ventas, créditos, caja ni compras`);
      }
    }
  });
}

test('empleado nivel 1-3: stock_producto solo trae el precio de venta y bajo_stock ninguna cifra en soles', async () => {
  for (const role of ['empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo']) {
    const s = await chat(role, 'stock_producto');
    assert.equal(s.status, 200, role);
    assert.ok(s.out.includes('Arroz 1 kg'), `${role}: la consulta sí corrió: ${s.out.slice(0, 300)}`);
    assert.deepEqual([...new Set(amounts(s.out))], ['4.50'], `${role}: solo el precio de venta`);
    const b = await chat(role, 'bajo_stock');
    assert.equal(b.status, 200, role); assert.ok(b.out.includes('Arroz 1 kg'), role);
    assert.deepEqual(amounts(b.out), [], `${role}: bajo_stock sin S/`);
  }
});

test(`${COSTS_ROLE}: nunca llega a deudas, caja, créditos atrasados, sugerencias ni resúmenes`, async () => {
  for (const tipo of COSTS_FORBIDDEN) for (const stream of [false, true]) {
    const r = await chat(COSTS_ROLE, tipo, { stream });
    assert.ok([200, 403].includes(r.status), `${tipo}: ${r.status}`);
    assertNoMoney(`${COSTS_ROLE} / ${tipo}`, r.out); assertNoMoney(`${COSTS_ROLE} / ${tipo} (al modelo)`, r.toModel);
    assert.deepEqual(r.reads.filter((k) => k !== 'products' && k !== 'productsById'), [], `${tipo}: no se lee`);
  }
});

test('employeeQueryResult: para las consultas del empleado el texto que deja pasar no trae montos (solo precio de venta)', async () => {
  for (const tipo of ['stock_producto', 'bajo_stock']) {
    const e = employeeQueryResult(await runAssistantQuery(memoryReader(DATA), { tipo, ...ARGS }, NOW));
    assertNoMoney(tipo, JSON.stringify(e));
  }
});

// ---------- Segunda barrera (pedido de alfa sobre #989) ----------
// Si un día la lista de consultas de un nivel se abre por error, employeeQueryResult NO debe dejar pasar el texto ni el total de la
// consulta: el texto del empleado se arma solo con los campos permitidos (columnas y resumen de la lista blanca).
const MONEY_TYPES = QUERY_TYPES.filter((t) => !['stock_producto', 'bajo_stock'].includes(t));
const EMPLOYEE_LEVEL_ROLES = ['empleado:consultas', 'empleado:consultas_documentos', 'empleado:completo'];
const ROUTE_OPENED = ['ventas_periodo', 'top_productos', 'deudas_clientes', 'compras_recientes', 'ventas_por_hora']; // de verdad leen plata

// Junta TODOS los fallos (no solo el primero) para que se vea cada fuga.
function collector() {
  const errs = [];
  return { check: (fn) => { try { fn(); } catch (e) { errs.push(String(e.message).split('\n')[0].slice(0, 260)); } }, done: (what) => assert.deepEqual(errs, [], what + ':\n' + errs.join('\n')) };
}
function openedList(open, roles) {
  const env = { ...process.env, LISTA_ABIERTA: JSON.stringify(open), ROLES: JSON.stringify(roles) };
  delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS; // proceso normal, no un hijo del corredor de pruebas
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./empleado-lista-abierta.mjs', import.meta.url))], { env, encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, 'proceso de la lista abierta: ' + String(r.stderr).slice(0, 800));
  const i = r.stdout.indexOf('@@LISTA_ABIERTA@@'); assert.ok(i >= 0, 'sin resultado: ' + String(r.stderr).slice(0, 800));
  return JSON.parse(r.stdout.slice(i + 17));
}

test('lista abierta por error (nivel 1-3 con ventas, deudas, compras…): el empleado y el modelo no reciben montos ni total', () => {
  const res = openedList(MONEY_TYPES, EMPLOYEE_LEVEL_ROLES);
  assert.equal(res.length, MONEY_TYPES.length * EMPLOYEE_LEVEL_ROLES.length * 2);
  const c = collector();
  for (const x of res) {
    const label = `${x.role} / ${x.tipo}${x.stream ? ' / partes' : ''} (lista abierta)`;
    assert.ok([200, 403].includes(x.status), `${label}: ${x.status}`);
    if (ROUTE_OPENED.includes(x.tipo)) { // la simulación sí abrió la puerta: la consulta corrió y leyó datos de plata
      assert.equal(x.status, 200, label);
      assert.ok(x.reads.some((k) => k !== 'products' && k !== 'productsById'), `${label}: la consulta corrió: ${x.reads}`);
      assert.ok(x.results.length >= 1, `${label}: llegó la tarjeta de consulta: ${x.out.slice(0, 300)}`);
    }
    c.check(() => assertNoMoney(label, x.out));
    c.check(() => assertNoMoney(label + ' (al modelo)', x.toModel));
    for (const q of x.results) c.check(() => assert.equal(q.total ?? null, null, `${label}: total ${q.total} en la pantalla`));
  }
  c.done('fugas con la lista abierta');
});

test('employeeQueryResult: con cualquier consulta (también caja, créditos, sugerencias, ganancia, resúmenes) no pasa texto con montos ni total', async () => {
  const c = collector();
  for (const tipo of QUERY_TYPES) {
    const raw = await runAssistantQuery(memoryReader(DATA), { tipo, ...ARGS }, NOW);
    const e = employeeQueryResult(raw);
    c.check(() => assertNoMoney(tipo, JSON.stringify(e)));
    c.check(() => assert.equal(e.total, null, `${tipo}: total ${e.total}`));
    c.check(() => assert.equal(typeof e.texto, 'string', `${tipo}: hay texto`));
    if (!['stock_producto', 'bajo_stock'].includes(tipo)) c.check(() => assert.notEqual(e.texto, raw.texto, `${tipo}: pasa el texto original`));
  }
  c.done('employeeQueryResult');
});

test('employeeQueryResult: stock_producto y bajo_stock se leen igual que antes (con el precio de venta)', async () => {
  const cases = [
    [DATA, { tipo: 'stock_producto', producto: 'arroz' }], [DATA, { tipo: 'stock_producto', producto: 'a' }], [DATA, { tipo: 'stock_producto', producto: 'zzz-no-existe' }],
    [DATA, { tipo: 'bajo_stock' }]
  ];
  const edge = { products: [
    { id: 'E1', nombre: 'Sal', precio: 1, costo: 0.5, stock: 0, min: 2, controla: true },
    { id: 'E2', nombre: 'Azúcar', precio: null, costo: 1, stock: -3, min: 2, controla: true },
    { id: 'E3', nombre: 'Bolsa', precio: 0.1, costo: 0.05, stock: 0, min: 0, controla: false },
    { id: 'E4', nombre: 'Leche', precio: 3.8, costo: 3, stock: 1.25, min: 6, controla: true },
    { id: 'E5', nombre: 'Fideo', precio: 2.2, costo: 1.9, stock: 1, min: 1, controla: true }
  ] };
  cases.push([edge, { tipo: 'stock_producto', producto: 'a' }], [edge, { tipo: 'bajo_stock' }], [{ products: [] }, { tipo: 'bajo_stock' }],
    [{ products: [edge.products[2]] }, { tipo: 'stock_producto', producto: 'bolsa' }]);
  for (const [data, q] of cases) {
    const raw = await runAssistantQuery(memoryReader(data), q, NOW);
    const e = employeeQueryResult(raw);
    assert.equal(e.texto, raw.texto, `${q.tipo} ${q.producto || ''}: mismo texto`);
    assert.equal(e.total, null);
  }
  const s = employeeQueryResult(await runAssistantQuery(memoryReader(DATA), { tipo: 'stock_producto', producto: 'arroz' }, NOW));
  assert.equal(s.texto, 'Arroz 1 kg (S/ 4.50): ' + stockLabel(2)); // «2 unid.» ya termina en punto
});

test('employeeQueryResult: lista larga de bajo_stock conserva el aviso «se revisaron los primeros»', async () => {
  const many = { products: Array.from({ length: 30 }, (_, i) => ({ id: 'M' + i, nombre: 'Prod ' + i, precio: 1, costo: 0.5, stock: i % 3, min: 5, controla: true })) };
  const rd = memoryReader(many), base = rd.products;
  rd.products = async (...a) => { const l = await base(...a); return Object.assign(l.slice(0, 20), { truncated: true }); };
  const raw = await runAssistantQuery(rd, { tipo: 'bajo_stock' }, NOW);
  assert.ok(raw.truncado && /se revisaron los primeros/.test(raw.texto), raw.texto);
  assert.equal(employeeQueryResult(raw).texto, raw.texto);
});

test(`Admin y ${COSTS_ROLE}: la consulta les llega exactamente como antes (texto y total)`, async () => {
  for (const [role, tipos] of [['owner', ['ventas_periodo', 'deudas_clientes', 'caja_abierta', 'compras_recientes', 'stock_producto']], [COSTS_ROLE, ['ventas_periodo', 'top_productos', 'ganancia', 'compras_recientes', 'stock_producto']]]) {
    for (const tipo of tipos) {
      const raw = await runAssistantQuery(memoryReader(DATA), { tipo, ...ARGS }, NOW);
      const r = await chat(role, tipo);
      assert.equal(r.status, 200, `${role} / ${tipo}`);
      const body = JSON.parse(r.out), q = body.proposals.find((p) => p.type === 'consulta')?.result;
      assert.equal(q.texto, raw.texto, `${role} / ${tipo}: mismo texto`);
      assert.equal(q.total, raw.total ?? null, `${role} / ${tipo}: mismo total`);
    }
  }
});
