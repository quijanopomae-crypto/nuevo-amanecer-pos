// Regresión de UI: la mascota flotante no debe tapar cifras ni filas en Ventas e Historial.
// Solo navegación/presentación; el asistente sigue disponible en los demás módulos permitidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');

test('la burbuja no está permitida en pageVentas pero sí en Inicio, Inventario y Clientes', () => {
  const list = ui.match(/var ADMIN_PAGES = (\[[^\n]+\]);/);
  assert.ok(list, 'debe existir una lista explícita de pantallas');
  const pages = JSON.parse(list[1].replaceAll("'", '"'));
  assert.ok(!pages.includes('pageVentas'), 'Ventas e Historial debe quedar libre de la mascota');
  for (const page of ['pageMenu', 'pageInventario', 'pageClientes'])
    assert.ok(pages.includes(page), page + ' debe conservar el asistente');
  assert.match(ui, /function allowedHere\(\) \{ return isAdmin\(\) && ADMIN_PAGES\.indexOf\(pageId\(\)\) >= 0; \}/);
  assert.match(ui, /rootEl\.style\.display = show \? '' : 'none'/);
});

test('al entrar a Ventas también se cierra el panel y se libera el espacio de la burbuja', () => {
  assert.match(ui, /!show && panelEl && !panelEl\.hidden && \(!isAdmin\(\) \|\| pageId\(\) === 'pagePOS' \|\| pageId\(\) === 'pageCaja' \|\| pageId\(\) === 'pageVentas'\)/);
  assert.match(ui, /raf = 0; applyPause\(\); place\(\);/);
  assert.match(ui, /new MutationObserver\(soon\)/, 'los cambios de pestaña deben actualizar visibilidad');
});
