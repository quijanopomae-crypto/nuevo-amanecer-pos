// FULL PAGE CHROME HOTFIX — auto-hide del header global + chrome del módulo.
//
// En desktop el scroll real vive en el CONTENEDOR de la página activa
// (.main-scroll y equivalentes), no en window. Este test verifica que:
//   CHROME_CLASS_TOGGLES_DESKTOP       usa g-topbar-hidden y una sola clase de página.
//   CHROME_VISUALLY_COLLAPSES_DESKTOP  .page-chrome sale del layout completo.
//   CHROME_FREES_VERTICAL_SPACE        topbar y chrome liberan altura real.
// Y que móvil (390/430) no se degrada (ruta window/module-mobile-scroll intacta).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPosSandbox, POS_DIR, tick } from './lib/sandbox.mjs';

const BASE_CSS = readFileSync(path.join(POS_DIR, 'css/base.css'), 'utf8');
const INDEX_HTML = readFileSync(path.join(POS_DIR, 'index.html'), 'utf8');

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
  assert.equal(sb.pageChromeHidden('pageInventario'), true, 'la misma transición oculta el chrome completo de Inventario');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), true, '1 gesto arriba sigue oculto');
  assert.equal(sb.pageChromeHidden('pageInventario'), true, '1 gesto arriba conserva el chrome del módulo oculto');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), false, '2 gestos arriba consecutivos muestran');
  assert.equal(sb.pageChromeHidden('pageInventario'), false, '2 gestos arriba muestran el chrome completo');
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
  assert.equal(sb.pageChromeHidden('pageMenu'), false, 'near-top limpia también el estado de chrome de página');
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

test('SCROLL_OWNER_REAL — un wrapper interno dinámico gana sobre su contenedor padre', async () => {
  const sb = fresh(1366);
  sb.run(`
    document.getElementById('pageVentas').classList.add('active');
    var _naOuter=document.createElement('div');_naOuter.id='ventasContent';
    _naOuter.clientHeight=400;_naOuter.scrollHeight=400;
    var _naInner=document.createElement('div');_naInner.classList.add('v-list-wrap');
    _naInner.clientHeight=300;_naInner.scrollHeight=1200;
    _naOuter.appendChild(_naInner);document.getElementById('pageVentas').appendChild(_naOuter);
    _naC=_naInner;
  `);
  await containerScrollTo(sb, sb.run('_naInner'), 220);
  assert.equal(sb.headerHidden(), true, 'el scroll emitido por .v-list-wrap oculta el chrome');
  assert.equal(sb.pageChromeHidden('pageVentas'), true);
  assert.equal(sb.run("window._naTopbarGesture.getScrollOwner()"), '.v-list-wrap');
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
  assert.equal(sb.pageChromeHidden('pageInventario'), false, 'navegar elimina el estado oculto de la página anterior');
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

test('CHROME_VISUALLY_COLLAPSES_DESKTOP — CSS retira topbar y page-chrome del layout', () => {
  assert.match(BASE_CSS, /@media\(min-width:701px\)\{[^}]*body>\.g-topbar\{[^}]*transition:margin-top 0?\.28s ease!important;[^}]*\}[^}]*body>\.g-topbar\.g-topbar-hidden\{[^}]*margin-top:-58px!important;[^}]*\}/s, 'bloque desktop min-width:701px con la misma clase');
  assert.match(TOP, /\.page-chrome\{[^}]*flex-shrink:0;[^}]*min-width:0;?\}/s, 'wrapper único del chrome conserva el layout visible');
  assert.match(TOP, /\.page\.g-page-chrome-hidden>\.page-chrome\{[^}]*display:none!important;?\}/s, 'el chrome del módulo sale por completo del layout');
});

test('DOM CONTRACT — cinco módulos comparten un único wrapper page-chrome; Menú fluye', () => {
  for (const id of ['pageInventario', 'pageVentas', 'pageClientes', 'pageCaja', 'pageGastos']) {
    assert.match(INDEX_HTML, new RegExp(`<div class="page" id="${id}">\\s*<div class="page-chrome">`), `${id} declara page-chrome`);
  }
  assert.doesNotMatch(INDEX_HTML, /<div class="page active" id="pageMenu">\s*<div class="page-chrome">/, 'Menú no duplica chrome: hero/KPIs viven dentro del scroll owner');
  assert.equal((INDEX_HTML.match(/class="page-chrome"/g) || []).length, 5, 'un wrapper por módulo, no cinco sistemas JS');
});

test('CHROME_FREES_VERTICAL_SPACE — body estable y móvil también libera los 58px globales', () => {
  // Las reglas module-mobile-scroll deben seguir DENTRO de @media(max-width:700px):
  assert.equal(ruleBlockTop('body.module-mobile-scroll{'), null, 'body.module-mobile-scroll ya NO existe a top-level');
  assert.equal(ruleBlockTop('body.module-mobile-scroll .g-topbar{'), null, 'sticky móvil ya NO existe a top-level');
  // La regla base del body queda intacta (flex column, overflow hidden):
  assert.match(TOP, /body\{[^}]*height:100vh;[^}]*display:flex;[^}]*flex-direction:column;[^}]*overflow:hidden;?\}/s, 'layout base del body sin cambios');
  // El bloque móvil sigue presente dentro de su media query:
  assert.match(BASE_CSS, /@media\(max-width:700px\)\{[^}]*body\.module-mobile-scroll\{[^}]*overflow-y:auto!important;[^}]*height:auto!important;/s, 'móvil sigue con su scroll de documento');
  assert.match(BASE_CSS, /body\.module-mobile-scroll \.g-topbar\.g-topbar-hidden\{[^}]*transform:translateY\(-100%\)!important;/s, 'ocultación móvil intacta');
  assert.match(BASE_CSS, /body\.module-mobile-scroll \.g-topbar\.g-topbar-hidden\{[^}]*margin-top:-58px!important;/s, 'móvil recupera también la altura del topbar');
  assert.match(BASE_CSS, /body\.module-mobile-scroll \.page\.active>\.page-chrome\{[^}]*position:sticky!important;[^}]*top:58px!important;/s, 'al reaparecer, el chrome móvil queda realmente visible sobre el contenido');
  assert.match(BASE_CSS, /@media\(max-width:480px\)\{body\.module-mobile-scroll \.page\.active>\.page-chrome\{top:60px!important\}\}/s, 'el offset móvil coincide con el topbar de 60px');
});

test('MOBILE_390 — no degrada: ruta window/module-mobile-scroll', async () => {
  const sb = fresh(390);
  sb.run("document.body.classList.add('module-mobile-scroll')");
  sb.run("goPage('pageVentas')");
  await tick();
  await windowScrollTo(sb, 0);
  await windowScrollTo(sb, 200);
  assert.equal(sb.headerHidden(), true, 'móvil oculta con scroll de documento');
  assert.equal(sb.pageChromeHidden('pageVentas'), true, 'móvil oculta el chrome completo de Ventas');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), true, '1 gesto arriba sigue oculto');
  await upGesture(sb, 80);
  assert.equal(sb.headerHidden(), false, '2 gestos arriba muestran');
  assert.equal(sb.pageChromeHidden('pageVentas'), false, '2 gestos muestran también el chrome del módulo');
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
