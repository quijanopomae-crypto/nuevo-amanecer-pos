import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync('POS/css/canon-mobile-home.css','utf8');
const nav=readFileSync('POS/js/navigation/menu-navigation.js','utf8');
const index=readFileSync('POS/index.html','utf8');
const sw=readFileSync('POS/sw.js','utf8');
const parityMenuCss=readFileSync('POS/css/experience-v2/pages/menu.css','utf8');
const labMenuCss=readFileSync('laboratorio/pos-lab/styles/pages/menu.css','utf8');
const menu=index.slice(index.indexOf('<div class="page active" id="pageMenu">'),index.indexOf('<!-- POS -->'));
const mobileStart=nav.indexOf('function ensureMobileStylesheet');
const mobileEnd=nav.indexOf('function bind()');
const mobileUi=mobileStart>=0&&mobileEnd>mobileStart?nav.slice(mobileStart,mobileEnd):'';
const phoneMediaStart=css.search(/@media\s*\(max-width:\s*767px\)/);
const cssBeforePhoneMedia=phoneMediaStart>=0?css.slice(0,phoneMediaStart):'';

test('mobile redesign stays isolated below tablet while source desktop modules remain intact',()=>{
  assert.match(css,/@media\s*\(max-width:\s*767px\)/);
  assert.match(nav,/MOBILE_HOME_MAX_WIDTH\s*=\s*767/);
  assert.match(nav,/css\/canon-mobile-home\.css/);
  assert.doesNotMatch(nav,/link\.media\s*=/,'the stylesheet must stay active after rotation so its >=768 hide guards still apply');
  assert.doesNotMatch(nav,/canon-desktop-dashboard/);
  assert.match(menu,/Módulos principales/);
  assert.match(menu,/module-label">Punto de Venta/);
  assert.match(menu,/module-label">Inventario/);
  assert.match(menu,/module-label">Ventas/);
  assert.match(menu,/module-label">Clientes/);
  assert.match(menu,/module-label">Caja/);
  assert.match(menu,/module-label">Gastos/);
});

test('phone home hides duplicate module navigation and exposes work-focused sections',()=>{
  assert.match(css,/#pageMenu\s+\.modules-grid\s*\{\s*display\s*:\s*none\s*!important/);
  assert.match(css,/#pageMenu\s+\.menu-modules-label\s*\{\s*display\s*:\s*none\s*!important/);
  assert.match(nav,/Acciones rápidas/);
  assert.match(nav,/Actividad reciente/);
  for(const label of ['Nueva venta','Registrar abono','Ingresar mercadería','Registrar gasto','Buscar cliente','Abrir \/ cerrar caja']){
    assert.match(nav,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
});

test('quick actions route only to existing CANON destinations',()=>{
  const routes=[
    ['Nueva venta','pagePOS'],
    ['Registrar abono','pageClientes'],
    ['Ingresar mercadería','pageInventario'],
    ['Registrar gasto','pageGastos'],
    ['Buscar cliente','pageClientes'],
    ['Abrir / cerrar caja','pageCaja']
  ];
  for(const [label,pageId] of routes){
    assert.match(nav,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[\\s\\S]{0,500}'+pageId));
  }
  assert.doesNotMatch(nav,/pageCompras|pageProveedores|pageFinanzas/);
});

test('mobile drawer contains supported navigation and closes through all expected paths',()=>{
  for(const label of ['Inicio','Punto de Venta','Ventas','Inventario','Clientes','Cuentas por cobrar','Caja','Gastos','Configuración']){
    assert.match(nav,new RegExp(label));
  }
  assert.match(nav,/NA_MENU_NAVIGATION/);
  assert.match(nav,/navigate\(pageId\)/);
  assert.match(nav,/na-mobile-drawer-overlay/);
  assert.match(nav,/Escape/);
  assert.match(nav,/closeMobileDrawer/);
});

test('mobile dashboard activity is read-only and uses existing UI/runtime state',()=>{
  assert.ok(mobileUi.length>0,'mobile-only decorator block must be present');
  assert.match(mobileUi,/qsPorCobrar/);
  assert.match(mobileUi,/qsStockCritico/);
  assert.match(mobileUi,/qsCaja/);
  assert.match(mobileUi,/root\.ventas/);
  assert.doesNotMatch(mobileUi,/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|saveAppState/i);
  assert.doesNotMatch(mobileUi,/sale\.create\s*\(|payment\.create\s*\(|cash\.open\s*\(|cash\.close\s*\(|inventory\.adjust\s*\(|credit-account\.create\s*\(/i);
});

test('CANON phone styles are production-only, offline-ready and LAB promotion source stays untouched',()=>{
  assert.equal(parityMenuCss,labMenuCss,'promoted menu.css must remain byte-for-byte aligned with LAB');
  assert.match(css,/\.na-mobile-drawer/);
  assert.match(css,/\.na-mobile-quick-grid/);
  assert.match(css,/\.na-mobile-quick-action/);
  assert.match(css,/\.na-mobile-activity/);
  assert.doesNotMatch(index,/canon-mobile-home\.css/,'phone stylesheet is injected only when the phone decorator initializes');
  assert.match(sw,/'\.\/css\/canon-mobile-home\.css'/,'phone stylesheet must be in the PWA shell for first-run offline use');
});

test('mobile-generated chrome stays hidden after crossing into tablet or desktop width',()=>{
  assert.ok(phoneMediaStart>0,'mobile stylesheet needs a non-mobile guard before its phone media block');
  assert.match(cssBeforePhoneMedia,/\.na-mobile-menu-toggle[\s\S]*display\s*:\s*none/);
  assert.match(cssBeforePhoneMedia,/\.na-mobile-drawer[\s\S]*display\s*:\s*none/);
  assert.match(cssBeforePhoneMedia,/#pageMenu\s+\.na-mobile-welcome[\s\S]*display\s*:\s*none/);
  assert.match(cssBeforePhoneMedia,/#pageMenu\s+\.na-mobile-home-section[\s\S]*display\s*:\s*none/);
});

test('approved visual refinement keeps phone chrome compact and professional',()=>{
  assert.match(css,/--na-mobile-header-h\s*:\s*56px/,'phone header must use the compact approved height');
  assert.match(css,/\.g-topbar[\s\S]{0,500}background\s*:\s*#fff/,'phone topbar must be white');
  assert.match(css,/#localStatus[\s\S]{0,120}display\s*:\s*none\s*!important/,'connection dot must not compete with the phone home header');
  assert.match(css,/\.na-mobile-welcome[\s\S]{0,2200}radial-gradient/,'hero must render a local sun layer');
  assert.match(css,/\.na-mobile-welcome[\s\S]{0,2200}linear-gradient/,'hero must render layered local landscape gradients');
  assert.match(css,/--na-mobile-stat-h\s*:\s*76px/,'summary cards must be compact');
  assert.match(css,/--na-mobile-action-h\s*:\s*62px/,'quick actions must be compact');
  assert.match(css,/--na-mobile-activity-h\s*:\s*44px/,'activity rows must be compact');
  assert.match(css,/\.na-mobile-drawer-nav::before[\s\S]{0,900}Administrador/,'drawer must expose the approved visual user card');
  assert.match(css,/data:image\/svg\+xml/,'visible phone icons must use local SVG artwork');
  assert.match(css,/\.na-mobile-quick-icon[\s\S]{0,400}font-size\s*:\s*0/,'quick-action emoji glyphs must be visually replaced');
  assert.match(css,/\.na-mobile-drawer-icon[\s\S]{0,400}font-size\s*:\s*0/,'drawer emoji glyphs must be visually replaced');
});
