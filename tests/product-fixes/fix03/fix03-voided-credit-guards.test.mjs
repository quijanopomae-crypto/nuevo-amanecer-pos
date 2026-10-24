// Crédito anulado solo por status/estado/source_status (sin anulado:true): los chequeos de pago, reversión y UI
// usan _naIsCreditVoided. Pagar, abonar o revertir queda bloqueado; los controles (LIVE, RECONCILED, 'no anulado') siguen igual.
// App real cargada en el orden de index.html (utils.js primero). Datos sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';
import { readFileSync } from 'node:fs';

async function tabWithPaidCredit() {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('clientes', [{ id:1001, nombre:'Cliente Prueba', color:1, lineaCreditoManualActiva:true, lineaCreditoManual:1000 }]);
  sb.el('cajFondo').value = '100'; sb.el('cajCajero').value = 'CAJ-001';
  assert.equal(await sb.run('abrirCaja()'), true);
  sb.run('cliCredId=String(clientes[0].id);');
  sb.el('crDesc').value = 'Crédito de prueba'; sb.el('crMonto').value = '200'; sb.el('crVence').value = '2099-12-31'; sb.el('crTipo').value = 'venta';
  await sb.run('guardarCred()');
  await pay(sb, 50);
  assert.equal(json(sb, 'creditos[0].pagado'), 50);
  return sb;
}
async function pay(sb, amount) {
  sb.run('pagoCredId=String(creditos[0].id);');
  sb.el('pagoMonto').value = String(amount); sb.el('pagoMetodo').value = 'efectivo'; sb.el('pagoOperacion').value = '';
  await sb.run('confirmarPago()');
}
const mark = (sb, patch) => sb.run(`Object.assign(creditos[0], ${JSON.stringify(patch)})`);
const state = sb => json(sb, '({ pagado:creditos[0].pagado, pagos:creditos[0].pagos.map(p => [p.monto, p.status || null]), movs:cajMovs.length })');

const VOIDED = [{ status:'ANULADO' }, { estado:'anulado', status:'vigente' }, { source_status:' Anulada ' }, { status:'anulada' }];
for (const patch of VOIDED) {
  test(`anulado por ${JSON.stringify(patch)}: abrir pago, abonar y revertir quedan bloqueados; la ficha no ofrece acciones`, async () => {
    const sb = await tabWithPaidCredit();
    const pagoId = json(sb, 'creditos[0].pagos[0].pagoId');
    mark(sb, patch);
    const before = state(sb);
    sb.run('abrirPago(String(creditos[0].id))');                       // inline-01
    assert.match(sb.toastText(), /No se pueden registrar pagos en un crédito anulado/);
    await pay(sb, 20);                                                  // inline-02 confirmarPago
    assert.match(sb.toastText(), /No se pueden registrar pagos en un crédito anulado/);
    assert.deepEqual(state(sb), before, 'ni pagado, ni pagos, ni caja cambian');
    await sb.run(`revertirPagoCredito(${JSON.stringify(json(sb, 'String(creditos[0].id)'))}, ${JSON.stringify(String(pagoId))})`);
    assert.match(sb.toastText(), /No se pueden revertir pagos de un crédito anulado/);
    assert.deepEqual(state(sb), before);
    sb.run('abrirDetalleCredito(String(creditos[0].id))');             // inline-12
    const text = sb.renderText();
    assert.doesNotMatch(text, /Registrar pago/);
    assert.doesNotMatch(text, /Revertir pago/);
  });
}

const CONTROLS = [{ status:'LIVE' }, { status:'RECONCILED', estado:'RECONCILED' }, { estado:'no anulado' }];
for (const patch of CONTROLS) {
  test(`control ${JSON.stringify(patch)}: no es anulado; abonar y revertir funcionan como siempre`, async () => {
    const sb = await tabWithPaidCredit();
    mark(sb, patch);
    assert.equal(json(sb, '_naIsCreditVoided(creditos[0])'), false);
    await pay(sb, 30);
    assert.equal(json(sb, 'creditos[0].pagado'), 80);
    assert.equal(json(sb, 'creditos[0].pagos.length'), 2);
    assert.equal(json(sb, '_naCreditOutstanding(creditos[0])'), 120);
    sb.run('abrirDetalleCredito(String(creditos[0].id))');
    assert.match(sb.renderText(), /Revertir pago/);
    const pagoId = json(sb, 'creditos[0].pagos[1].pagoId');
    await sb.run(`revertirPagoCredito(${JSON.stringify(json(sb, 'String(creditos[0].id)'))}, ${JSON.stringify(String(pagoId))})`);
    assert.equal(json(sb, 'creditos[0].pagado'), 50);
  });
}

test('anulado:true sigue bloqueado como antes', async () => {
  const sb = await tabWithPaidCredit();
  mark(sb, { anulado:true });
  const before = state(sb);
  await pay(sb, 20);
  assert.match(sb.toastText(), /No se pueden registrar pagos en un crédito anulado/);
  assert.deepEqual(state(sb), before);
});

// inline-04 reemplaza calcularScoreCredito en la app (su versión ya usa el helper desde #752); aquí se ejecuta la de inline-02 tal cual.
const inline02 = readFileSync(new URL('../../../POS/js/legacy-inline/inline-02.js', import.meta.url), 'utf8');
const score02 = inline02.match(/^calcularScoreCredito=(function\(clienteId\)\{.*\};)$/m)[1].slice(0, -1);
test('calcularScoreCredito (inline-02): un anulado por estado con abonos no suma puntualidad; LIVE/RECONCILED sí', async () => {
  const sb = createPosSandbox();
  sb.seed();
  sb.run('var __score02=' + score02 + ';');
  sb.seedData('clientes', [{ id:2002, nombre:'Cliente Puntaje', color:1, totalCompras:1000 }]);
  const score = patch => {
    sb.run(`creditos.length=0;creditos.push(${JSON.stringify({ id:9001, cliId:2002, clienteId:2002, monto:100, pagado:20, saldo:80, fecha:'2026-09-01', vence:'2099-12-31', status:'vigente', estado:'vigente', anulado:false, pagos:[], items:[] })});Object.assign(creditos[0], ${JSON.stringify(patch)});`);
    return json(sb, '__score02(2002)');
  };
  sb.run('creditos.length=0;');
  const empty = json(sb, '__score02(2002)');
  for (const patch of [{ status:'ANULADO' }, { estado:'anulada', status:'vigente' }, { source_status:'ANULADO' }, { anulado:true }]) {
    assert.deepEqual(score(patch), empty, JSON.stringify(patch));
  }
  const plain = score({});
  assert.notDeepEqual(plain, empty, 'un crédito vigente con abonos sí cambia el puntaje');
  for (const patch of [{ status:'LIVE' }, { status:'RECONCILED', estado:'RECONCILED' }, { estado:'no anulado' }]) {
    assert.deepEqual(score(patch), plain, JSON.stringify(patch));
  }
});

test('render antiguo _naCreditCardHtml / _naCreditDetailHtml (inline-02): anulado sin botón de pago; vigente igual que antes', async () => {
  const sb = createPosSandbox();
  sb.seed();
  const base = { id:9101, cliId:1, clienteId:1, desc:'Crédito render', monto:100, pagado:20, saldo:80, fecha:'2026-09-01', vence:'2099-12-31', status:'vigente', estado:'vigente', anulado:false, pagos:[], items:[] };
  const html = (patch, fn) => { sb.run(`creditos.length=0;creditos.push(Object.assign(${JSON.stringify(base)}, ${JSON.stringify(patch)}));`); return json(sb, `${fn}(creditos[0])`); };
  for (const patch of [{ status:'ANULADO' }, { source_status:'anulado' }, { estado:'Anulada', status:'vigente' }]) {
    const card = html(patch, '_naCreditCardHtml'), detail = html(patch, '_naCreditDetailHtml');
    assert.match(card, /Crédito anulado/); assert.match(card, /cs-m/);
    assert.doesNotMatch(card, /btn-pago-cr/); assert.doesNotMatch(detail, /abrirPago/);
    assert.match(detail, /<span>Saldo anulado<\/span><strong class="credit-saldo-anulado">/); assert.doesNotMatch(detail, /Saldo pendiente/);
  }
  for (const patch of [{}, { status:'LIVE' }, { estado:'no anulado' }]) {
    assert.match(html(patch, '_naCreditCardHtml'), /btn-pago-cr/, JSON.stringify(patch));
    assert.match(html(patch, '_naCreditDetailHtml'), /abrirPago/, JSON.stringify(patch));
    assert.match(html(patch, '_naCreditDetailHtml'), /<span>Saldo pendiente<\/span><strong>/); assert.doesNotMatch(html(patch, '_naCreditDetailHtml'), /Saldo anulado|credit-saldo-anulado/);
  }
});
