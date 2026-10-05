import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync('POS/css/canon-mobile-home.css','utf8');
const nav=readFileSync('POS/js/navigation/menu-navigation.js','utf8');
const index=readFileSync('POS/index.html','utf8');
const parityMenuCss=readFileSync('POS/css/experience-v2/pages/menu.css','utf8');
const labMenuCss=readFileSync('laboratorio/pos-lab/styles/pages/menu.css','utf8');
const menu=index.slice(index.indexOf('<div class="page active" id="pageMenu">'),index.indexOf('<!-- POS -->'));
const mobileStart=nav.indexOf('function ensureMobileStylesheet');
const mobileEnd=nav.indexOf('function bind()');
const mobileUi=mobileStart>=0&&mobileEnd>mobileStart?nav.slice(mobileStart,mobileEnd):'';

test('mobile redesign stays isolated below tablet while source desktop modules remain intact',()=>{
  assert.match(css,/@media\s*\(max-width:\s*767px\)/);
  assert.match(nav,/MOBILE_HOME_MAX_WIDTH\s*=\s*767/);
  assert.match(nav,/css\/canon-mobile-home\.css/);
  assert.match(nav,/link\.media\s*=\s*['"]\(max-width:\s*767px\)['"]/);
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
  for(const pageId of ['pagePOS','pageInventario','pageClientes','pageGastos','pageCaja']){
    assert.match(nav,new RegExp("quickAction\\([^)]*['\"]"+pageId+"['\"]"));
  }
  assert.match(nav,/Registrar abono[\s\S]{0,500}pageClientes/);
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
  assert.doesNotMatch(mobileUi,/sale\.create|payment\.create|cash\.open|cash\.close|inventory\.adjust|credit-account\.create/i);
});

test('CANON phone styles are production-only and LAB promotion source stays untouched',()=>{
  assert.equal(parityMenuCss,labMenuCss,'promoted menu.css must remain byte-for-byte aligned with LAB');
  assert.match(css,/\.na-mobile-drawer/);
  assert.match(css,/\.na-mobile-quick-grid/);
  assert.match(css,/\.na-mobile-quick-action/);
  assert.match(css,/\.na-mobile-activity/);
  assert.doesNotMatch(index,/canon-mobile-home\.css/,'phone stylesheet is loaded lazily only on <=767px');
});