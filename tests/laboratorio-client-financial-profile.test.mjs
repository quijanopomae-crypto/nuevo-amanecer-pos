import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('laboratorio/pos-lab/lab-overrides.js', 'utf8');
const css = readFileSync('laboratorio/pos-lab/styles/pages/clientes.css', 'utf8');

function makeContext() {
  const dueMap = new Map([
    ['2026-09-20', -5],
    ['2026-09-25', 0],
    ['2026-09-28', 3],
    ['2026-10-08', 13]
  ]);
  const ctx = {
    console: { info() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); return 1; },
    document: {
      documentElement: {
        classList: { remove() {} },
        removeAttribute() {}
      },
      querySelectorAll() { return []; },
      getElementById() { return null; }
    },
    creditos: [],
    clientes: [],
    diasHasta(value) { return dueMap.has(value) ? dueMap.get(value) : null; },
    _naSyncCreditStatus(cr) { return cr.status; },
    _naCreditOutstanding(cr) { return Math.max(0, Number(cr.monto || 0) - Number(cr.pagado || 0)); },
    _naEvaluateClientCredit(clientId) {
      if (String(clientId) === 'D') return { exists:false };
      return {
        exists:true,
        enabled:true,
        eligible:String(clientId) !== 'B',
        manualActive:String(clientId) === 'C',
        assignedLine:String(clientId) === 'A' ? 1000 : 500,
        automaticLine:500,
        available:String(clientId) === 'A' ? 650 : 0,
        history:{ debt:String(clientId) === 'A' ? 350 : 500, total:3, punctual:2, late:1, behavior:'irregular' }
      };
    },
    _naCreditRequirementText(e) {
      if (e.manualActive) return 'Excepción manual registrada';
      return e.eligible ? 'Cumple la evaluación vigente' : 'Tiene deuda vencida; requiere revisión';
    },
    _naCreditBehaviorLabel(value) { return value === 'irregular' ? 'Irregular' : 'Sin historial'; },
    _NA_CREDIT_METHOD_LABELS: { efectivo:'Efectivo', transferencia:'Transferencia', yape:'Yape / Plin' },
    fmt(value) { return 'S/ ' + Number(value).toFixed(2); },
    _naEsc(value) { return String(value); }
  };
  ctx.window = ctx;
  ctx.window.__NA_LAB__ = true;
  ctx.window.matchMedia = () => ({ matches:false });
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename:'lab-overrides.js' });
  return ctx;
}

function cr(id, due, monto, pagado=0, status='vigente', extra={}) {
  return { id, cliId:'A', desc:'Crédito '+id, vence:due, monto, pagado, status, pagos:[], ...extra };
}

test('classifies and orders urgency vencido -> hoy -> próximo -> vigente -> anterior', () => {
  const ctx = makeContext();
  const api = ctx.NA_LAB_CLIENT_FINANCIAL_PROFILE;
  const rows = [
    cr('vigente','2026-10-08',100,0),
    cr('cerrado','2026-09-20',100,100,'cancelado'),
    cr('proximo','2026-09-28',100,0),
    cr('vencido','2026-09-20',100,0,'vencido'),
    cr('hoy','2026-09-25',100,0)
  ];
  assert.equal(api.classifyCredit(rows[0]), 'activos');
  assert.equal(api.classifyCredit(rows[1]), 'anteriores');
  assert.equal(api.classifyCredit(rows[2]), 'proximos');
  assert.equal(api.classifyCredit(rows[3]), 'vencidos');
  assert.equal(api.classifyCredit(rows[4]), 'hoy');
  assert.deepEqual(
    Array.from(api.sortCredits(rows), item => api.classifyCredit(item)),
    ['vencidos','hoy','proximos','activos','anteriores']
  );
});

test('financial summary excludes closed credits and preserves real pending balances', () => {
  const ctx = makeContext();
  ctx.creditos.push(
    cr('A1','2026-09-20',500,230,'vencido'),
    cr('A2','2026-09-28',200,120,'vigente'),
    cr('A3','2026-10-08',150,150,'cancelado')
  );
  const summary = ctx.NA_LAB_CLIENT_FINANCIAL_PROFILE.summarizeClient({ id:'A', nombre:'Cliente A' });
  assert.equal(summary.active.length, 2);
  assert.equal(summary.closed.length, 1);
  assert.equal(summary.debt, 350);
  assert.equal(summary.overdue, 270);
  assert.equal(summary.urgent.id, 'A1');
  assert.equal(summary.nextFuture.id, 'A2');
  assert.equal(summary.evaluation.available, 650);
});

test('client without credits or line degrades to empty/unknown without inventing financial data', () => {
  const ctx = makeContext();
  const summary = ctx.NA_LAB_CLIENT_FINANCIAL_PROFILE.summarizeClient({ id:'D', nombre:'Cliente D' });
  assert.equal(summary.active.length, 0);
  assert.equal(summary.closed.length, 0);
  assert.equal(summary.debt, 0);
  assert.equal(summary.overdue, 0);
  assert.equal(summary.nextFuture, null);
  assert.equal(summary.urgent, null);
  assert.equal(summary.evaluation.exists, false);
});

test('synthetic LAB fixtures cover A punctual, B overdue, C manual, D no history and E closed', () => {
  const ctx = makeContext();
  ctx.creditos.push(
    cr('A1','2026-09-28',500,150,'vigente',{ cliId:'A' }),
    cr('B1','2026-09-20',500,0,'vencido',{ cliId:'B' }),
    cr('C1','2026-10-08',300,100,'vigente',{ cliId:'C' }),
    cr('E1','2026-09-20',200,200,'cancelado',{ cliId:'E' })
  );
  const api = ctx.NA_LAB_CLIENT_FINANCIAL_PROFILE;
  const a = api.summarizeClient({ id:'A', nombre:'Cliente A' });
  const b = api.summarizeClient({ id:'B', nombre:'Cliente B' });
  const c = api.summarizeClient({ id:'C', nombre:'Cliente C' });
  const d = api.summarizeClient({ id:'D', nombre:'Cliente D' });
  const e = api.summarizeClient({ id:'E', nombre:'Cliente E' });
  assert.equal(a.debt, 350);
  assert.equal(a.evaluation.available, 650);
  assert.equal(b.overdue, 500);
  assert.equal(b.evaluation.eligible, false);
  assert.equal(c.evaluation.manualActive, true);
  assert.equal(d.active.length, 0);
  assert.equal(d.evaluation.exists, false);
  assert.equal(e.active.length, 0);
  assert.equal(e.closed.length, 1);
});

test('late cliRender binding is idempotent and reattaches after replacement', () => {
  const ctx = makeContext();
  const api = ctx.NA_LAB_CLIENT_FINANCIAL_PROFILE;
  let calls = 0;

  const firstRender = () => { calls += 1; };
  ctx.cliRender = firstRender;
  assert.equal(api.ensureRenderHook(), true);
  const wrapper = ctx.cliRender;
  assert.notEqual(wrapper, firstRender);
  assert.equal(wrapper.__naLabFinancialWrapper, true);

  assert.equal(api.ensureRenderHook(), true);
  assert.equal(ctx.cliRender, wrapper);
  ctx.cliRender();
  assert.equal(calls, 1);

  const replacementRender = () => { calls += 10; };
  ctx.cliRender = replacementRender;
  assert.equal(api.ensureRenderHook(), true);
  assert.equal(ctx.cliRender, wrapper);
  ctx.cliRender();
  assert.equal(calls, 11);

  assert.match(source, /new MutationObserver/);
  assert.match(source, /labClientProfilesNeedEnhancement/);
});

test('financial profile supports current secure client DOM and legacy cc-* panels', () => {
  assert.match(source, /function labClientIdForPanel/);
  assert.match(source, /\.client-card\[data-client-id\]/);
  assert.match(source, /String\(panel\.id \|\| ''\)/);
  assert.match(source, /list\.querySelectorAll\('\.client-creds'\)/);
  assert.match(source, /labClientPanelForId\(clientId\)/);
  assert.doesNotMatch(
    source.slice(source.indexOf('function labRenderClientProfiles'), source.indexOf('window.naLabClientFinancialSetView')),
    /client-creds\[id\^=/
  );
});

test('profile reuses existing payment/detail/evaluation actions and adds no financial persistence path', () => {
  const start = source.indexOf('// ===== LAB ETAPA 01: FICHA FINANCIERA DE CLIENTE =====');
  const end = source.indexOf('// ===== FIN LAB ETAPA 01: FICHA FINANCIERA DE CLIENTE =====');
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /onclick="abrirPago\(/);
  assert.match(block, /onclick="abrirDetalleCredito\(/);
  assert.match(block, /onclick="abrirEvaluacionCredito\(/);
  assert.match(block, /onclick="abrirCred\(/);
  assert.doesNotMatch(block, /saveAllData|saveAppState|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(block, /score\s*[:=]|Score\s*\d|\/100/);
});

test('secondary information is folded and line evaluation is no longer in the main flow', () => {
  assert.match(source, /<details><summary>Historial de pagos/);
  assert.match(source, /<details><summary>Créditos cerrados/);
  assert.match(source, /<details><summary>Línea de crédito \/ evaluación/);
  assert.match(source, /<details><summary>Comportamiento del cliente/);
  assert.doesNotMatch(source, /<details\s+open/);

  const start = source.indexOf('function labProfileHtml(client)');
  const end = source.indexOf('function labClientIdForPanel', start);
  const profile = source.slice(start, end);
  assert.doesNotMatch(profile, /SITUACIÓN ACTUAL/);
  assert.doesNotMatch(profile, /labUrgentActionHtml\(summary\)/);
  assert.match(profile, /labCompactActionHtml\(summary\)/);
  assert.match(profile, /labActiveCreditsHtml\(client, summary\)/);
});

test('compact credit cards show payment count and do not invent installment schedules', () => {
  const ctx = makeContext();
  const api = ctx.NA_LAB_CLIENT_FINANCIAL_PROFILE;
  const credit = cr('A1','2026-09-28',500,230,'vigente',{
    pagos:[
      { id:'P1', status:'REGISTRADO' },
      { id:'P2', status:'REGISTRADO' },
      { id:'P3', status:'REVERTED', reversalId:'R1' }
    ]
  });
  assert.equal(api.effectivePaymentCount(credit), 2);

  const start = source.indexOf('function labCreditCardHtml(cr)');
  const end = source.indexOf('function labCreditViewHtml', start);
  const card = source.slice(start, end);
  assert.match(card, /Pagos realizados:/);
  assert.match(card, /Pagado <b>/);
  assert.doesNotMatch(card, /Próxima cuota/);
  assert.doesNotMatch(card, /lab-fin-credit-metrics/);
});

test('mobile CSS prioritizes the compact list and tactile actions', () => {
  assert.match(css, /\.lab-fin-profile-compact\{gap:8px;padding-top:8px\}/);
  assert.match(css, /\.lab-fin-credit-summary/);
  assert.match(css, /\.lab-fin-credit-actions-compact/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /min-height:42px/);
  assert.match(css, /overflow-wrap:anywhere/);
});

test('payment history surface preserves audit fields and reversal visibility', () => {
  for (const field of ['pagoId','fecha','hora24','metodo','cajeroNombre','monto','saldoAnterior','saldoActual','operacion','reversalId']) {
    assert.match(source, new RegExp(field));
  }
});
