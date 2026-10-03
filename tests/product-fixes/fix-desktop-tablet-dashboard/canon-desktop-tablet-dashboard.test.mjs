import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../../POS/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../POS/css/canon-desktop-dashboard.css', import.meta.url), 'utf8');
const promotedMenuCss = readFileSync(new URL('../../../POS/css/experience-v2/pages/menu.css', import.meta.url), 'utf8');
const labMenuCss = readFileSync(new URL('../../../laboratorio/pos-lab/styles/pages/menu.css', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../../../POS/js/legacy-inline/inline-02.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../../../POS/sw.js', import.meta.url), 'utf8');

test('CANON incluye navegación lateral de Inicio para tablet y escritorio sin duplicar Nueva venta', () => {
  assert.match(html, /class="menu-desktop-sidebar"/);
  for (const target of ['pagePOS','pageVentas','pageInventario','pageClientes','pageCaja','pageGastos','pageConfig']) {
    assert.match(html, new RegExp(`data-menu-target="${target}"`));
  }
  assert.doesNotMatch(html, /class="menu-desktop-sidebar"[\s\S]{0,5000}\+ Nueva venta/);
});

test('CANON incorpora KPIs comparativos, actividad y pendientes en Inicio', () => {
  for (const id of [
    'qsVentasTrend','qsVentasPrev',
    'menuActivity0Label','menuActivity0Amount',
    'menuActivity1Label','menuActivity1Amount',
    'menuActivity2Label','menuActivity2Amount',
    'menuPendingCredits','menuPendingStock','menuPendingCash'
  ]) assert.match(html, new RegExp(`id="${id}"`));
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

test('updateDashboard calcula tendencia real de ventas contra ayer y llena actividad/pendientes', () => {
  assert.match(runtime, /qsVentasTrend/);
  assert.match(runtime, /qsVentasPrev/);
  assert.match(runtime, /ayerVentas/);
  assert.match(runtime, /menuActivity\$\{i\}Label/);
  assert.match(runtime, /menuPendingCredits/);
  assert.match(runtime, /menuPendingStock/);
  assert.match(runtime, /menuPendingCash/);
});

test('dashboard CANON usa stylesheet separado, preserva paridad LAB y queda precargado', () => {
  assert.equal(promotedMenuCss.replace(/\r\n/g, '\n'), labMenuCss.replace(/\r\n/g, '\n'));
  assert.match(html, /href="css\/canon-desktop-dashboard\.css"/);
  assert.match(sw, /'\.\/css\/canon-desktop-dashboard\.css'/);
});
