// GATE 3 — CREDIT WINNER
//
// Demuestra el winner final de guardarCred:
//   - la política activa de crédito es la de FASE 7 (inline-04: evaluación por
//     línea — _naEvaluateClientCredit), que reemplazó a la base antigua de
//     inline-02 (score sugerido con confirm());
//   - el wrapper de autorización F10 (inline-07) sigue siendo el WINNER;
//   - el winner PERSISTE vía saveAllData con verificación (_naWasPersisted);
//   - hay rollback ante fallo de persistencia (creditos restaurado);
//   - la identidad del crédito se preserva (id/cliId estable en memoria y durable).
//
// No se modifica código legacy: solo se caracteriza.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  localScriptOrder, scanDefinitions, readProductText, sliceBetween, fileMatchLines,
} from './lib/product.mjs';
import { createPosSandbox, json } from './lib/sandbox.mjs';
import { writeEvidence } from './lib/evidence.mjs';

const facts = { checks: [], winner: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const INLINE_02 = 'js/legacy-inline/inline-02.js';
const INLINE_04 = 'js/legacy-inline/inline-04.js';
const INLINE_07 = 'js/legacy-inline/inline-07.js';

const CLIENTE = {
  id: 'C1', nombre: 'Cliente Prueba', dni: '99999999', color: 0, totalCompras: 0,
  lineaCreditoManualActiva: true, lineaCreditoManual: 200, lineaCreditoManualMotivo: 'Linea manual de pruebas establecida',
};

function freshTab() {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('clientes', [{ ...CLIENTE }]);
  return sb;
}

function seedCreditForm(sb, monto) {
  sb.run(`cliCredId='C1';`);
  sb.el('crDesc').value = 'Préstamo prueba';
  sb.el('crMonto').value = String(monto);
  sb.el('crVence').value = '2026-12-31';
  sb.el('crTipo').value = 'contrato_privado';
}

test('G3.1 — Cadena de definiciones: inline-02 (legacy) → inline-04 (política F7) → inline-07 (wrapper F10 WINNER)', () => {
  const order = localScriptOrder();
  const idx = (rel) => order.indexOf(rel);
  check('G3.1a', 'orden de carga: inline-02 < inline-04 < inline-07',
    idx(INLINE_02) < idx(INLINE_04) && idx(INLINE_04) < idx(INLINE_07),
    `índices ${idx(INLINE_02)},${idx(INLINE_04)},${idx(INLINE_07)}`);

  const defs02 = scanDefinitions(INLINE_02, 'guardarCred');
  const defs04 = scanDefinitions(INLINE_04, 'guardarCred');
  const defs07 = scanDefinitions(INLINE_07, 'guardarCred');
  check('G3.1b', 'inline-02 define la base legacy de guardarCred', defs02.length > 0);
  check('G3.1c', 'inline-04 REDEFINE guardarCred con la política F7', defs04.some(Boolean), `líneas ${defs04}`);
  check('G3.1d', 'inline-07 captura la base y reasigna el wrapper',
    fileMatchLines(INLINE_07, 'const _naF10BaseGuardarCred\\s*=\\s*guardarCred').length === 1 &&
    defs07.some(Boolean));

  // Ningún archivo posterior redefine guardarCred → el wrapper de inline-07 es el winner.
  const later = order.slice(idx(INLINE_07) + 1).filter((rel) => /inline-\d+\.js$/.test(rel));
  const reassign = later.filter((rel) => scanDefinitions(rel, 'guardarCred').length > 0);
  facts.winner.laterRedefinitions = reassign;
  check('G3.1e', 'ningún archivo posterior a inline-07 redefine guardarCred', reassign.length === 0);

  const cap07 = readProductText(INLINE_07);
  const capLine = cap07.slice(cap07.indexOf('_naF10BaseGuardarCred=guardarCred'));
  check('G3.1f', 'el wrapper delega en la base capturada (_naF10BaseGuardarCred.apply)',
    /_naF10BaseGuardarCred\.apply\(this,\s*args\)/.test(capLine));
  facts.winner.chain = 'inline-02 (legacy) → inline-04 (política F7, base capturada) → inline-07 wrapper F10 = WINNER';
});

test('G3.2 — La política activa es la evaluación F7 por línea (no el score sugerido legacy)', () => {
  const base04 = sliceBetween(INLINE_04, 'guardarCred=async function(){', null) ?? '';
  check('G3.2a', 'la base F7 usa _naEvaluateClientCredit (línea automática/manual)',
    base04.includes('_naEvaluateClientCredit(cliCredId)'));
  check('G3.2b', 'la base F7 bloquea monto sobre la línea disponible',
    base04.includes('supera la línea disponible'));
  check('G3.2c', 'la base legacy de inline-02 (score con confirm) quedó REEMPLAZADA: el winner no la invoca',
    !sliceBetween(INLINE_07, 'guardarCred=async function', null).includes('calcularScoreCredito'));
  const legacy02 = sliceBetween(INLINE_02, 'guardarCred=async function(){', null) ?? '';
  check('G3.2d', 'la base legacy usaba línea sugerida con confirm() (comportamiento histórico caracterizado)',
    legacy02.includes('calcularScoreCredito') && legacy02.includes('confirm('));
});

test('G3.3 — RUNTIME: el winner final ES el wrapper de autorización F10', () => {
  const sb = freshTab();
  const src = sb.run('String(guardarCred)');
  check('G3.3a', 'guardarCred (runtime) contiene la autorización F10 de credits',
    src.includes("_naF10AuthorizePermission('credits'"));
  check('G3.3b', 'guardarCred (runtime) delega en la base F7 capturada',
    src.includes('_naF10BaseGuardarCred.apply(this,args)'));
  const baseSrc = sb.run('String(_naF10BaseGuardarCred)');
  check('G3.3c', 'la base capturada en runtime es la política F7 (línea + persistencia verificada)',
    baseSrc.includes('_naEvaluateClientCredit(cliCredId)') &&
    baseSrc.includes('lineaCreditoAsignada') &&
    baseSrc.includes('if(!_naWasPersisted(result)){creditos=backup;'));
  facts.winner.runtimeWinner = 'wrapper F10 (inline-07) sobre base F7 (inline-04)';
});

test('G3.4 — RUNTIME: el winner persiste el crédito (identidad preservada en memoria y durable)', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  seedCreditForm(sb, 50);
  await sb.run('guardarCred()');
  const mem = sb.memoryState();
  assert.equal(mem.creditos.length, 1, 'exactamente un crédito creado');
  const rec = mem.creditos[0];
  check('G3.4a', 'identidad: id numérico (Date.now), cliId y saldo correctos',
    Number.isFinite(rec.id) && String(rec.cliId) === 'C1' && rec.saldo === 50 && rec.pagado === 0);
  check('G3.4b', 'el crédito persistió: durable contiene el MISMO id y cliId',
    sb.durableSnapshot()?.data?.creditos?.[0]?.id === rec.id &&
    sb.durableSnapshot()?.data?.creditos?.[0]?.cliId === 'C1');
  check('G3.4c', 'snapshot de línea: guarda línea asignada y disponible previa (política F7)',
    rec.lineaCreditoAsignada === 200 && rec.lineaCreditoDisponibleAntes === 200);
  facts.winner.persistedIdentity = { id: rec.id, cliId: rec.cliId, saldo: rec.saldo };
});

test('G3.5 — RUNTIME: rollback ante fallo de persistencia (sin crédito huérfano ni identidad parcial)', async () => {
  const sb = freshTab();
  await sb.run('saveAllData()');
  const durableBefore = sb.durableSnapshot();
  seedCreditForm(sb, 50);
  sb.breakPersistent();
  await sb.run('guardarCred()');
  sb.restorePersistent();
  assert.equal(json(sb, 'creditos.length'), 0, 'no queda crédito parcial en memoria');
  check('G3.5a', 'rollback: memoria restaurada y durable previo intacto',
    sb.memoryState().creditos.length === 0 &&
    JSON.stringify(sb.durableSnapshot()) === JSON.stringify(durableBefore));
  // Reintento con persistencia sana: crea exactamente un crédito (sin duplicados del intento fallido).
  seedCreditForm(sb, 50);
  await sb.run('guardarCred()');
  assert.equal(json(sb, 'creditos.length'), 1, 'tras reintento existe exactamente un crédito');
  facts.winner.rollback = 'creditos restaurado; reintento produce exactamente 1 crédito';
});

test('G3.6 — RUNTIME: sin autorización F10 no se crea crédito (el wrapper es obligatorio)', async () => {
  const sb = freshTab();
  // NOTA de characterization: el rol 'cajero' del producto TRAE credits:true por
  // defecto (inline-07 _NA_F10_ROLE_DEFAULTS). La denegación se modela con un set
  // personalizado credits:false — exactamente lo que el editor de permisos F10 permite.
  sb.run(`
    appConfig.cashiers[0].role='personalizado';
    appConfig.cashiers[0].permissions={..._naF10RoleDefaults('admin'),credits:false};
  `);
  await sb.run('saveAllData()');
  seedCreditForm(sb, 50);
  await sb.run('guardarCred()');
  assert.equal(json(sb, 'creditos.length'), 0, 'sin permiso no se crea crédito');
  const toast = sb.toastText();
  check('G3.6', 'acceso denegado visible y sin registro',
    /permiso/i.test(toast) && json(sb, 'creditos.length') === 0, `toast: "${toast}"`);
});

after(() => {
  writeEvidence('gate3-credit-winner.json', {
    gate: 'GATE 3 — CREDIT WINNER',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    winner: facts.winner,
    ...facts,
  });
});
