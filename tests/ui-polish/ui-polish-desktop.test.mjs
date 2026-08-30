// UI DESKTOP HOTFIX — HEADER AUTO-HIDE EN PC (base f900608)
//
// En desktop el scroll real vive en el CONTENEDOR de la página activa
// (.main-scroll y equivalentes), no en window. Este test verifica que:
//   HEADER_CLASS_TOGGLES_DESKTOP      el scroll del contenedor activo (1024/1366)
//                                      oculta el header con la MISMA clase
//                                      g-topbar-hidden y la misma máquina de gestos.
//   HEADER_VISUALLY_COLLAPSES_DESKTOP  CSS desktop: body>.g-topbar.g-topbar-hidden
//                                      con margin-top:-58px (sin cambiar el layout).
//   HEADER_FREES_VERTICAL_SPACE_DESKTOP el layout del body NO se altera (las reglas
//                                      module-mobile-scroll siguen solo en móvil) y el
//                                      flex del page activo llena el alto liberado.
// Y que móvil (390/430) no se degrada (ruta window/module-mobile-scroll intacta).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPosSandbox, POS_DIR, tick } from './lib/sandbox.mjs';

const BASE_CSS = readFileSync(path.join(POS_DIR, 'css/base.css'), 'utf8');

function stripMediaBlocks(css) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (css[i] === '@' && css.startsWith('@media', i)) {
      const open = css.indexOf('{', i);
      if (open === -1) { out += css.slice(i); break; }
      let depth = 0;
      let j = open;
      for (; j < n; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (depth === 0) { j++; break; } }
      }
      i = j;
    } else {
      out += css[i];
      i++;
    }
  }
  return out;
}
const TOP = stripMediaBlocks(BASE_CSS);

function ruleBlockTop(startStr) {
  const i = TOP.indexOf(startStr);
  if (i < 0) return null;
  const j = TOP.indexOf('}', i);
  return j < 0 ? TOP.slice(i) : TOP.slice(i, j + 1);
}

function fresh(width) {
  const sb = createPosSandbox();
  sb.seed();
  sb.run("document.body.classList.remove('module-mobile-scroll')");
  sb.run(`
    window.scrollTo=function(){};saveAppState=function(){};updateDashboard=function(){};
    invRender=function(){};invBadges=function(){};cliRender=function(){};
    cajRender=function(){};ventasRender=function(){};gasRender=function(){};
    posRender=function(){};posUpdateCart=function(){};
    document.documentElement.style.setProperty=function(){};
  `);
  sb.run(`window.innerWidth=${width}`);
  return sb;
}

// Activa una página desktop con su contenedor de scroll real en el DOM del sandbox.
function buildPage(sb, pageId, containerClass) {
  sb.run(`document.getElementById('${pageId}').classList.add('active');var _naC=document.createElement('div');_naC.classList.add('${containerClass}');document.getElementById('${pageId}').appendChild(_naC);`);
  return sb.run('_naC');
}

async function containerScrollTo(sb, container, y) {
  sb.run(`_naC.scrollTop=${y};`);
  sb.fireDocument('scroll', { target: container });
  await tick();
}

async function windowScrollTo(sb, y) {
  sb.run(`window.scrollY=${y};document.documentElement.scrollTop=${y};`);
  sb.fireWindow('scroll', {});
  await tick();
}

async function upGesture(sb, px = 80) {
  sb.fireDocument('touchstart', { touches: [{ clientY: 500 }], target: {} });
  sb.fireDocument('touchmove', { touches: [{ clientY: 500 + px }] });
  sb.fireDocument('touchend', {});
  await tick();
}

test('HEADER_CLASS_TOGGLES_DESKTOP 1024 — scroll del contenedor activo oculta; 1↑ sigue, 2↑ muestra', async () => {
  const sb = fresh(1024);
  const container = buildPage(sb, 'pageInventario', 'table-wrap');
  await containerScrollTo(sb, container, 0);
  await containerScrollTo(sb, container, 200);
  assert.equal(sb.headerHidden(), true, 'delta 200 ≥ 80 en el contenedor oculta el header en desktop');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), true, '1 gesto arriba sigue oculto');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), false, '2 gestos arriba consecutivos muestran');
});

test('HEADER_CLASS_TOGGLES_DESKTOP 1366 — .main-scroll, wheel/trackpad y near-top', async () => {
  const sb = fresh(1366);
  const container = buildPage(sb, 'pageMenu', 'main-scroll');
  await containerScrollTo(sb, container, 0);
  // wheel/trackpad abajo sobre el contenedor oculta
  sb.fireDocument('wheel', { deltaY: 90, target: container });
  sb.fireDocument('wheel', { deltaY: 90, target: container });
  sb.run('_naC.scrollTop=150;');
  sb.fireDocument('scroll', { target: container });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(sb.headerHidden(), true, 'wheel/trackpad abajo oculta en desktop');
  // cerca del top del contenedor muestra inmediato
  await containerScrollTo(sb, container, 5);
  assert.equal(sb.headerHidden(), false, 'scrollTop≤12 del contenedor muestra inmediato');
  // POS desktop NO activa la máquina (layout propio)
  sb.run("document.getElementById('pageMenu').classList.remove('active')");
  const posArea = sb.run("document.getElementById('pagePOS').classList.add('active');var _p=document.createElement('div');_p.classList.add('products-area');document.getElementById('pagePOS').appendChild(_p);_p");
  sb.run('_naC=_p');
  sb.run('_naC.scrollTop=300;');
  sb.fireDocument('scroll', { target: posArea });
  await tick();
  assert.equal(sb.headerHidden(), false, 'POS desktop conserva el header (sin máquina de gestos)');
  assert.equal(sb.run('window._naTopbarGesture.isActive()'), false, 'gestos inactivos en POS desktop');
});

test('HEADER_CLASS_TOGGLES_DESKTOP — navegación y resize muestran/resetean', async () => {
  const sb = fresh(1366);
  const container = buildPage(sb, 'pageInventario', 'table-wrap');
  await containerScrollTo(sb, container, 0);
  await containerScrollTo(sb, container, 250);
  assert.equal(sb.headerHidden(), true);
  // navegar a Caja (página distinta) muestra el header y resetea la máquina
  sb.run("document.getElementById('pageInventario').classList.remove('active')");
  sb.run("document.getElementById('pageCaja').classList.add('active');var _n=document.createElement('div');_n.id='cajContent';document.getElementById('pageCaja').appendChild(_n);");
  sb.run("goPage('pageCaja')");
  await tick();
  assert.equal(sb.headerHidden(), false, 'navegar muestra el header en desktop');
  // scroll en #cajContent vuelve a ocultar
  const caj = sb.run("_naC=document.getElementById('pageCaja').querySelector('#cajContent')");
  await containerScrollTo(sb, caj, 180);
  assert.equal(sb.headerHidden(), true, '#cajContent oculta en desktop');
  // goMenu muestra
  sb.run('goMenu()');
  await tick();
  assert.equal(sb.headerHidden(), false, 'volver al menú muestra el header');
  // resize desktop conserva/muestra
  sb.run("document.getElementById('pageMenu').classList.add('active')");
  sb.fireWindow('resize', {});
  await tick();
  assert.equal(sb.headerHidden(), false, 'resize en desktop deja el header visible');
});

test('HEADER_VISUALLY_COLLAPSES_DESKTOP — CSS desktop con la misma clase g-topbar-hidden', () => {
  assert.match(BASE_CSS, /@media\(min-width:701px\)\{[^}]*body>\.g-topbar\{[^}]*transition:margin-top 0?\.28s ease!important;[^}]*\}[^}]*body>\.g-topbar\.g-topbar-hidden\{[^}]*margin-top:-58px!important;[^}]*\}/s, 'bloque desktop min-width:701px con la misma clase');
});

test('HEADER_FREES_VERTICAL_SPACE_DESKTOP — el layout del body NO cambia; móvil intacto', () => {
  // Las reglas module-mobile-scroll deben seguir DENTRO de @media(max-width:700px):
  assert.equal(ruleBlockTop('body.module-mobile-scroll{'), null, 'body.module-mobile-scroll ya NO existe a top-level');
  assert.equal(ruleBlockTop('body.module-mobile-scroll .g-topbar{'), null, 'sticky móvil ya NO existe a top-level');
  // La regla base del body queda intacta (flex column, overflow hidden):
  assert.match(TOP, /body\{[^}]*height:100vh;[^}]*display:flex;[^}]*flex-direction:column;[^}]*overflow:hidden;?\}/s, 'layout base del body sin cambios');
  // El bloque móvil sigue presente dentro de su media query:
  assert.match(BASE_CSS, /@media\(max-width:700px\)\{[^}]*body\.module-mobile-scroll\{[^}]*overflow-y:auto!important;[^}]*height:auto!important;/s, 'móvil sigue con su scroll de documento');
  assert.match(BASE_CSS, /body\.module-mobile-scroll \.g-topbar\.g-topbar-hidden\{[^}]*transform:translateY\(-100%\)!important;/s, 'ocultación móvil intacta');
});

test('MOBILE_390 — no degrada: ruta window/module-mobile-scroll', async () => {
  const sb = fresh(390);
  sb.run("document.body.classList.add('module-mobile-scroll')");
  sb.run("goPage('pageVentas')");
  await tick();
  await windowScrollTo(sb, 0);
  await windowScrollTo(sb, 200);
  assert.equal(sb.headerHidden(), true, 'móvil oculta con scroll de documento');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), true, '1 gesto arriba sigue oculto');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), false, '2 gestos arriba muestran');
});

test('MOBILE_430 — no degrada: near-top y navegación', async () => {
  const sb = fresh(430);
  sb.run("document.body.classList.add('module-mobile-scroll')");
  sb.run("goPage('pageInventario')");
  await tick();
  await windowScrollTo(sb, 300);
  assert.equal(sb.headerHidden(), true);
  await windowScrollTo(sb, 5);
  assert.equal(sb.headerHidden(), false, 'near-top muestra en móvil');
  sb.run('goMenu()');
  await tick();
  assert.equal(sb.headerHidden(), false);
});
