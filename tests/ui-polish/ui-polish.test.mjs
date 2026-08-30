// UI POLISH — HEADER AUTO-HIDE POR GESTOS + CIERRE DE MODAL POR BACKDROP
//
// T1  scroll abajo significativo oculta el header.
// T2  jitter/minidesplazamientos no lo ocultan.
// T3  primer gesto ascendente NO muestra el header.
// T4  segundo gesto ascendente consecutivo SÍ lo muestra.
// T5  un descenso significativo corta la secuencia ascendente.
// T6  volver cerca del top (scrollTop≈0) lo muestra inmediatamente.
// T7  config-page-scroll conserva el scroll documental y la misma clase de ocultación.
// T8  click en el backdrop de un modal cerrable con X lo cierra.
// T9  click dentro del contenido NO cierra; modal sin X no se cierra por backdrop.
// T10 todos los guards de procesamiento impiden cierre por backdrop.
// T11 el cierre por backdrop usa exactamente el mismo camino que la X (cerrarModal(id)).
// T12 navegación y scroll existentes siguen funcionando (gestos repetibles, desktop inmune).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPosSandbox, POS_DIR, tick } from './lib/sandbox.mjs';

const STATE_SOURCE = readFileSync(path.join(POS_DIR, 'js/core/state.js'), 'utf8');
const BASE_CSS = readFileSync(path.join(POS_DIR, 'css/base.css'), 'utf8');

function fresh() {
  const sb = createPosSandbox();
  sb.seed();
  return sb;
}

// scroll hacia una posición absoluta del documento (modo module-mobile-scroll)
async function scrollTo(sb, y) {
  sb.run(`window.scrollY=${y};document.documentElement.scrollTop=${y};`);
  sb.fireWindow('scroll', {});
  await tick();
}

// un "gesto ascendente" físico: el dedo baja ≥px en pantalla (= volver hacia el inicio)
async function upGesture(sb, px = 80, target = {}) {
  sb.fireDocument('touchstart', { touches: [{ clientY: 500 }], target });
  sb.fireDocument('touchmove', { touches: [{ clientY: 500 + px }] });
  sb.fireDocument('touchend', {});
  await tick();
}

function overlayWithX(sb, id) {
  const overlay = sb.el(id);
  overlay.classList.add('modal-overlay', 'open');
  const close = sb.run(`document.createElement('button')`);
  close.classList.add('btn-close-m');
  overlay.appendChild(close);
  return overlay;
}

test('T1 — scroll abajo significativo oculta el header', async () => {
  const sb = fresh();
  assert.equal(sb.headerHidden(), false, 'el header inicia visible');
  await scrollTo(sb, 0);
  await scrollTo(sb, 140);
  assert.equal(sb.headerHidden(), true, 'delta 140 ≥ 80 oculta el header');
});

test('T2 — jitter/minidesplazamientos no lo ocultan', async () => {
  const sb = fresh();
  await scrollTo(sb, 0);
  await scrollTo(sb, 40);
  assert.equal(sb.headerHidden(), false);
  await scrollTo(sb, 55);
  assert.equal(sb.headerHidden(), false, 'delta 15 no oculta');
  await scrollTo(sb, 45);
  assert.equal(sb.headerHidden(), false, 'rebote hacia arriba pequeño no cambia nada');
  await scrollTo(sb, 79);
  assert.equal(sb.headerHidden(), false, 'delta 34 acumulada desde el ancho no oculta');
  await scrollTo(sb, 70);
  assert.equal(sb.headerHidden(), false);
  await upGesture(sb, 30);
  assert.equal(sb.run('window._naTopbarGesture.getCount()'), 0, 'un gesto ascendente menor al umbral tampoco cuenta');
});

test('T3 — primer gesto ascendente NO muestra el header', async () => {
  const sb = fresh();
  await scrollTo(sb, 0);
  await scrollTo(sb, 160);
  assert.equal(sb.headerHidden(), true);
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), true, 'con un solo gesto claro permanece oculto');
});

test('T4 — segundo gesto ascendente consecutivo SÍ lo muestra', async () => {
  const sb = fresh();
  await scrollTo(sb, 0);
  await scrollTo(sb, 160);
  assert.equal(sb.headerHidden(), true);
  await upGesture(sb, 80);
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), false, '2 gestos consecutivos muestran el header');
});

test('T5 — un descenso significativo corta la secuencia ascendente', async () => {
  const sb = fresh();
  await scrollTo(sb, 0);
  await scrollTo(sb, 200);
  assert.equal(sb.headerHidden(), true);
  await upGesture(sb, 80);
  assert.equal(sb.run('window._naTopbarGesture.getCount()'), 1);
  sb.fireDocument('touchstart', { touches: [{ clientY: 500 }], target: {} });
  sb.fireDocument('touchmove', { touches: [{ clientY: 400 }] });
  sb.fireDocument('touchend', {});
  await tick();
  assert.equal(sb.run('window._naTopbarGesture.getCount()'), 0, 'bajar significativamente reinicia la secuencia');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), true, 'el siguiente ascenso vuelve a ser el primero');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), false, 'solo el segundo ascenso consecutivo muestra');
});

test('T6 — volver cerca del top muestra el header inmediatamente', async () => {
  const sb = fresh();
  await scrollTo(sb, 0);
  await scrollTo(sb, 200);
  assert.equal(sb.headerHidden(), true);
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), true, 'primer ascenso aún no muestra');
  await scrollTo(sb, 8);
  assert.equal(sb.headerHidden(), false, 'scrollTop≤12 muestra inmediato');
  assert.equal(sb.run('window._naTopbarGesture.getCount()'), 0, 'volver al top limpia la secuencia');
  sb.fireDocument('touchstart', { touches: [{ clientY: 500 }], target: {} });
  sb.fireDocument('touchmove', { touches: [{ clientY: 400 }] });
  sb.fireDocument('touchend', {});
  await tick();
  assert.equal(sb.headerHidden(), false, 'un gesto sin desplazamiento real no puede ocultar cerca del top');
});

test('T7 — config-page-scroll conserva scroll y reutiliza g-topbar-hidden', async () => {
  const sb = fresh();
  const configContent = sb.run("var shell=document.createElement('div');shell.classList.add('cfg-shell');var content=document.createElement('div');content.classList.add('cfg-content');shell.appendChild(content);document.body.appendChild(shell);content");
  sb.run("document.body.classList.remove('module-mobile-scroll');document.documentElement.classList.add('config-page-scroll')");
  await scrollTo(sb, 0);
  await scrollTo(sb, 140);
  assert.equal(sb.headerHidden(), true, 'Configuración también oculta tras descenso significativo');
  await upGesture(sb, 80, configContent);
  assert.equal(sb.headerHidden(), true);
  await upGesture(sb, 80, configContent);
  assert.equal(sb.headerHidden(), false, 'Configuración muestra con la misma máquina de gestos');
  assert.equal(sb.run("document.documentElement.classList.contains('config-page-scroll')"), true, 'el modo de scroll de Config no se altera');
  assert.match(BASE_CSS, /body\.module-mobile-scroll \.g-topbar\.g-topbar-hidden\s*\{[^}]*translateY\(-100%\)/s);
  assert.match(BASE_CSS, /html\.config-page-scroll body>\.g-topbar\.g-topbar-hidden\s*\{[^}]*translateY\(-100%\)/s);
});

test('T8 — click en el backdrop de un modal cerrable con X lo cierra', async () => {
  const sb = fresh();
  const overlay = overlayWithX(sb, 'mGasto');
  assert.equal(overlay.classList.contains('open'), true);
  sb.fireDocument('click', { target: overlay });
  assert.equal(overlay.classList.contains('open'), false, 'el backdrop ejecutó el cierre');
});

test('T9 — click dentro del contenido NO cierra; modal sin X no se cierra por backdrop', async () => {
  const sb = fresh();
  // click dentro del contenido (target hijo, no overlay)
  const overlay = overlayWithX(sb, 'mProd');
  const inside = sb.run(`document.createElement('div')`);
  inside.classList.add('modal');
  overlay.appendChild(inside);
  sb.fireDocument('click', { target: inside });
  assert.equal(overlay.classList.contains('open'), true, 'click interno no cierra');
  // el propio overlay sí cierra (es el backdrop)
  sb.fireDocument('click', { target: overlay });
  assert.equal(overlay.classList.contains('open'), false);
  // modal sin botón X: el backdrop NO debe cerrarlo
  const noX = sb.el('mSinX');
  noX.classList.add('modal-overlay', 'open');
  sb.fireDocument('click', { target: noX });
  assert.equal(noX.classList.contains('open'), true, 'modal no cerrable con X queda intacto');
});

test('T10 — todos los guards de procesamiento bloquean el backdrop', async () => {
  const sb = fresh();
  const overlay = overlayWithX(sb, 'mCobro');
  const guards = ['posProc', 'pagoProc', 'pagoRevProc', 'cajMovProc', 'cajCloseProc', 'gastoProc', '_naInventoryMoveBusy', '_naQuickPaymentProc', '_naSaleAnnulmentProc'];
  for (const guard of guards) {
    sb.run(`${guard}=true`);
    sb.fireDocument('click', { target: overlay });
    assert.equal(overlay.classList.contains('open'), true, `${guard} impide cerrar`);
    sb.run(`${guard}=false`);
  }
  sb.fireDocument('click', { target: overlay });
  assert.equal(overlay.classList.contains('open'), false, 'sin guards procede el cierre');
});

test('T11 — el backdrop invoca cerrarModal(id), el mismo camino que la X', async () => {
  const sb = fresh();
  assert.match(STATE_SOURCE, /typeof cerrarModal==='function'&&overlay\.id\)cerrarModal\(overlay\.id\)/, 'el listener delega explícitamente en cerrarModal');
  const viaBackdrop = overlayWithX(sb, 'mCli');
  const viaX = overlayWithX(sb, 'mCred');
  sb.fireDocument('click', { target: viaBackdrop });
  sb.run(`cerrarModal('mCred')`);
  assert.equal(viaBackdrop.classList.contains('open'), viaX.classList.contains('open'), 'mismo efecto exacto que la X');
  assert.equal(viaBackdrop.classList.contains('open'), false);
  // y el resto de clases del overlay no se tocan
  viaBackdrop.classList.add('prueba-clase');
  const overlay2 = overlayWithX(sb, 'mPagoCred');
  overlay2.classList.add('otra-clase');
  sb.fireDocument('click', { target: overlay2 });
  assert.equal(overlay2.classList.contains('otra-clase'), true, 'solo se retira open, como cerrarModal');
});

test('T12 — navegación y scroll existentes siguen funcionando', async () => {
  const sb = fresh();
  await scrollTo(sb, 0);
  // varios ciclos ocultar/mostrar seguidos con gestos y scroll reales
  await scrollTo(sb, 200);
  assert.equal(sb.headerHidden(), true);
  await upGesture(sb, 70);
  await upGesture(sb, 70);
  assert.equal(sb.headerHidden(), false);
  await scrollTo(sb, 350);
  assert.equal(sb.headerHidden(), true);
  await scrollTo(sb, 0);
  assert.equal(sb.headerHidden(), false, 'volver al menú/top siempre muestra');
  // clicks ajenos (nav/cards) no rompen ni alteran el header
  const card = sb.run(`document.createElement('div')`);
  card.classList.add('module-card');
  sb.fireDocument('click', { target: card });
  assert.equal(sb.headerHidden(), false);
  // gestures activos solo en modos de scroll de documento: en desktop no hace nada
  sb.run("document.body.classList.remove('module-mobile-scroll')");
  await scrollTo(sb, 200);
  assert.equal(sb.headerHidden(), false, 'fuera del modo móvil el header no se oculta');
  await scrollTo(sb, 5);
  // reactivar el modo sigue funcionando
  sb.run("document.body.classList.add('module-mobile-scroll')");
  await scrollTo(sb, 200);
  assert.equal(sb.headerHidden(), true, 'el sistema sigue operativo tras desactivar/activar');
});
