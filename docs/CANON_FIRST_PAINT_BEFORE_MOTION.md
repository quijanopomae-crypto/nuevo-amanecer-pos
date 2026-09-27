# CANON First Paint Before Motion

## Síntoma

En móvil real, tocar una tarjeta del menú puede congelar la interfaz antes de que el módulo llegue a verse.

## Causa técnica localizada

La navegación base ya difiere los renderers pesados. El bloqueo restante estaba en la capa visual:

1. `goPage()` marca la nueva `.page` como activa.
2. Antes de que el navegador pinte, el `MutationObserver` de `lab-parity-bridge.js` reacciona.
3. El bridge llama `motion.page.enter()`.
4. `page.enter()` terminaba en `core.restartClass()`, que lee `element.offsetWidth`.
5. Esa lectura fuerza layout síncrono del módulo completo.
6. En módulos con scroll preset, el mismo ciclo también mide `scrollHeight`.

En un teléfono con DOM grande, ese trabajo ocurre exactamente antes del primer paint y puede bloquear la transición visible.

## Corrección

- La página se activa primero.
- Motion espera dos `requestAnimationFrame`.
- Si la página sigue activa, recién entonces se aplica entrada visual y scroll preset.
- `page.enter()` reinicia la clase sin leer `offsetWidth`.
- Si la página dejó de estar activa, el Motion pendiente se descarta.

## No cambia

Ventas, stock, caja, créditos, gastos, persistencia, CANON sync, adapters, D1/R2 ni `goPage()`.
