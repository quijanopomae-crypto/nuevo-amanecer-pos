import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const cssPath='POS/css/canon-mobile-home.css';
const jsPath='POS/js/canon-mobile-home.js';
const css=existsSync(cssPath)?readFileSync(cssPath,'utf8'):'';
const js=existsSync(jsPath)?readFileSync(jsPath,'utf8'):'';
const index=readFileSync('POS/index.html','utf8');
const sw=readFileSync('POS/sw.js','utf8');

const menu=index.slice(index.indexOf('<div class="page active" id="pageMenu">'),index.indexOf('<!-- POS -->'));

test('CANON ships isolated mobile-only home assets',()=>{
  assert.ok(existsSync(cssPath),'missing mobile-only CSS asset');
  assert.ok(existsSync(jsPath),'missing mobile-only JS asset');
  assert.match(index,/css\/canon-mobile-home\.css/);
  assert.match(index,/js\/canon-mobile-home\.js/);
  assert.match(sw,/'\.\/css\/canon-mobile-home\.css'/);
  assert.match(sw,/'\.\/js\/canon-mobile-home\.js'/);
});

test('mobile redesign is hard-scoped below tablet and keeps desktop decorator separate',()=>{
  assert.match(css,/@media\s*\(max-width:\s*767px\)/);
  assert.doesNotMatch(css,/@media\s*\(min-width:\s*768px\)[\s\S]*#pageMenu\.active\s*\{[^}]*grid-template-columns/);
  assert.match(js,/MOBILE_MAX_WIDTH\s*=\s*767/);
  assert.doesNotMatch(js,/canon-desktop-dashboard/);
  assert.match(index,/css\/canon-desktop-dashboard\.css[\s\S]*css\/canon-mobile-home\.css/);
});

test('mobile home replaces duplicate module cards with quick work surfaces',()=>{
  assert.match(js,/Acciones rápidas/);
  assert.match(js,/Actividad reciente/);
  for(const label of ['Nueva venta','Registrar abono','Ingresar mercadería','Registrar gasto','Buscar cliente','Abrir \/ cerrar caja']){
    assert.match(js,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(css,/#pageMenu\s+\.modules-grid\s*\{\s*display\s*:\s*none\s*!important/);
  assert.match(css,/#pageMenu\s+\.menu-modules-label\s*\{\s*display\s*:\s*none\s*!important/);
  assert.match(menu,/Módulos principales/,'desktop/tablet source modules must remain in canonical HTML');
});

test('drawer contains only supported CANON destinations and reuses safe navigation',()=>{
  for(const label of ['Inicio','Punto de Venta','Ventas','Inventario','Clientes','Cuentas por cobrar','Caja','Gastos','Configuración']){
    assert.match(js,new RegExp(label));
  }
  assert.match(js,/NA_MENU_NAVIGATION/);
  assert.match(js,/\.navigate\(pageId\)/);
  assert.doesNotMatch(js,/pageCompras|pageProveedores|pageFinanzas/);
  assert.match(js,/Escape/);
  assert.match(js,/na-mobile-drawer-overlay/);
});

test('mobile decorator remains read-only with respect to business persistence and network',()=>{
  assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|\.open\(['"](?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(js,/sale\.create|payment\.create|cash\.open|cash\.close|inventory\.adjust|credit-account\.create/i);
});
