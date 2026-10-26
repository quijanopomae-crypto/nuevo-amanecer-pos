---
name: add-screen
description: "Agregar una pantalla/página nueva al POS respetando layouts protegidos (Venta, Inicio), permisos y breakpoints 1366/768/390."
---

# Add screen

1. Lee `AGENTS.md`, `docs/codex/BUSINESS_CONTEXT.md` y `docs/codex/ARCHITECTURE.md`.
2. **No cambies el layout de `#pagePOS` (Venta) ni `#pageMenu` (Inicio) salvo que el pedido del owner nombre esa pantalla (ese pedido basta).** WORK es una excepción autorizada para el Inicio, no para Venta. Ni enlaces nuevos en Inicio fuera de ese alcance.
3. Marcado: `<div class="page" id="pageX">` en `POS/index.html`; lógica en `POS/js/modules/x.js` (IIFE, `'use strict'`, sin globals nuevos salvo un namespace `NA_X`); estilos en `POS/css/x.css` acotados por `#pageX`. Prefiere una hoja `canon-*.css` propia; `experience-v2/pages/*.css` ya es CSS de producción (laboratorio retirado).
4. Permiso: agrega `pageX` a `SCREENS` en `POS/js/config/pos-permissions.js` (ver skill `add-permission`).
5. Navegación: agrega `pageX` a `ALLOWED_PAGES` y, si corresponde, una fila en `renderDrawerItems()` de `POS/js/navigation/menu-navigation.js`; cachea el script nuevo en `POS/sw.js` si debe funcionar offline.
6. Teléfono primero; las pruebas e2e cubren 390, 768 y 1366 px; revisa modo oscuro (`body.dark`) si el cambio añade colores.
7. Pruebas: unit para la lógica y e2e (skill `write-e2e-test`) en los tres anchos; luego `pre-publish-verification`.
