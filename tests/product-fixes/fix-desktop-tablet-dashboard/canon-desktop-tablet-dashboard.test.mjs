import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../../POS/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../POS/css/canon-desktop-dashboard.css', import.meta.url), 'utf8');
const promotedMenuCss = readFileSync(new URL('../../../POS/css/experience-v2/pages/menu.css', import.meta.url), 'utf8');
const labMenuCss = readFileSync(new URL('../../../laboratorio/pos-lab/styles/pages/menu.css', import.meta.url), 'utf8');
const decorator = readFileSync(new URL('../../../POS/js/canon-desktop-dashboard.js', import.meta.url), 'utf8');
const sharedRuntime = readFileSync(new URL('../../../POS/js/legacy-inline/inline-02.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../../POS/sw.js', import.meta.url), 'utf8');

test('decorador CANON define navegación lateral sin duplicar Nueva venta', () => {
  assert.match(decorator, /menu-desktop-sidebar/);
  for (const target of ['pagePOS','pageVentas','pageInventario','pageClientes','pageCaja','pageGastos','pageConfig']) {
    assert.match(decorator, new RegExp(`['"]${target}['"]`));
  }
  assert.doesNotMatch(decorator, /\+ Nueva venta/);
});

test('decorador CANON incorpora KPIs comparativos, actividad y pendientes', () => {
  for (const id of [
    'qsVentasTrend','qsVentasPrev',
    'menuActivity0Label','menuActivity0Amount',
    'menuPendingCredits','menuPendingStock','menuPendingCash'
  ]) assert.match(decorator, new RegExp(id));
  assert.match(decorator, /ayerVentas/);
  assert.match(decorator, /Venta /);
});

test('layout mantiene móvil por defecto y activa shell específico solo cuando Inicio está activo desde 768 px', () => {
  assert.match(css, /\.menu-desktop-sidebar\s*\{[^}]*display\s*:\s*none/);
  assert.match(css, /@media\s*\(min-width\s*:\s*768px\)/);
  assert.match(css, /#pageMenu\.active\s*\{[^}]*grid-template-columns\s*:\s*220px\s+minmax\(0,1fr\)/);
  assert.match(css, /#pageMenu:not\(\.active\)\s*\{[^}]*display\s*:\s*none/);
  assert.match(css, /#pageMenu\s+\.menu-modules-label[^}]*display\s*:\s*none/);
  assert.match(css, /#pageMenu\s+\.modules-grid[^}]*display\s*:\s*none/);
  assert.match(css, /@media\s*\(min-width\s*:\s*1100px\)/);
  assert.match(css, /grid-template-columns\s*:\s*repeat\(4,minmax\(0,1fr\)\)/);
});

test('lógica compartida no contiene el decorador exclusivo de escritorio', () => {
  assert.doesNotMatch(sharedRuntime, /_naDashboardLocalIso|_naUpdateDesktopDashboard|qsVentasTrend/);
  assert.match(decorator, /bindDashboardRenderer/);
  assert.match(decorator, /updateDashboard/);
});

test('dashboard CANON usa assets separados, preserva paridad LAB y queda precargado', () => {
  assert.equal(promotedMenuCss.replace(/\r\n/g, '\n'), labMenuCss.replace(/\r\n/g, '\n'));
  assert.match(html, /href="css\/canon-desktop-dashboard\.css"/);
  assert.match(html, /src="js\/canon-desktop-dashboard\.js"/);
  assert.match(sw, /'\.\/css\/canon-desktop-dashboard\.css'/);
  assert.match(sw, /'\.\/js\/canon-desktop-dashboard\.js'/);
});
