# CANON POS Reference UI — CANON-POS-REFERENCE-UI-001

## Autorización
Solicitud explícita del owner el 2026-10-02: aplicar directamente en CANON el rediseño visual del Punto de Venta tomando como referencia la segunda captura entregada en la conversación.

## Base
- Rama activa: `feature/v1.3-mobile-cloud`
- Base SHA: `03fb82a61ff5f6762c8dabe4f62e68bebdd02596`
- Zona: CANON `POS/**`
- LAB fuera de alcance.

## Objetivo
Transformar exclusivamente la interfaz del módulo `pagePOS` para que el flujo visual sea equivalente a la referencia aprobada:

1. Barra de operación clara con identidad POS, búsqueda/escáner y accesos rápidos.
2. Escritorio con tres zonas persistentes:
   - categorías a la izquierda;
   - productos al centro;
   - venta actual/carrito a la derecha.
3. Categorías en lista vertical compacta con icono + texto.
4. Productos en tarjetas densas, precio arriba, imagen central, stock visible y nombre debajo.
5. Venta actual siempre visible en escritorio, con artículos, cantidad, subtotal, IGV, total y botones de cobro.
6. En teléfono/tablet, conservar el carrito como drawer accesible y evitar scroll horizontal.
7. Mantener toda la lógica comercial existente: carrito, mayorista, descuentos, VARIOS, cobro, impuestos, stock, scanner, offline/outbox y persistencia.

## Principios
- La captura de referencia gobierna orden, jerarquía y proporciones.
- No copiar código ni assets externos de la referencia.
- No modificar reglas comerciales.
- No tocar datos reales.
- No tocar backend, Turso, Cloudflare API, OUTBOX ni autoridad CANON.
- No depender de LAB en runtime.

## Etapas
### Etapa 1 — Estructura
Reorganizar markup del POS para separar toolbar, categorías, catálogo y venta actual sin cambiar IDs ni handlers usados por la lógica actual.

### Etapa 2 — Visual desktop
Aplicar layout de tres columnas, tipografía, tarjetas, categorías y carrito fijo similares a la referencia.

### Etapa 3 — Carrito y microjerarquía
Mejorar presentación de ítems, conteo de productos, totales y CTAs manteniendo las mismas acciones y funciones existentes.

### Etapa 4 — Responsive
Asegurar 320, 360, 390, 430, 768, 1024, 1366 y 1920 px. En móvil el carrito vuelve a drawer y las categorías/productos siguen utilizables sin scroll horizontal.

### Etapa 5 — Regresión y despliegue
Ejecutar pruebas focalizadas + CANON Critical CI + E2E Smoke. Solo después fusionar y disparar el Hosted POS Web Deploy.

## Archivos permitidos
- `docs/CANON_POS_REFERENCE_UI.md`
- `POS/index.html`
- `POS/css/experience-v2/pages/pos.css`
- `POS/js/legacy-inline/inline-14.js`
- `tests/ui-polish/canon-pos-reference-ui.test.mjs`

## Archivos prohibidos
- `laboratorio/**`
- `tools/cloudflare-lab/src/**`
- `tools/cloudflare-prod/**`
- `infra/**`
- `POS/js/sync/**`
- `POS/js/adapters/**`
- módulos de inventario, ventas, clientes, caja o gastos fuera de la superficie POS
- datos comerciales, secretos, migraciones

## Invariantes
- Los IDs `posSearch`, `posArea`, `posSidebar`, `cartDrawer`, `cartItems`, `posSubtotal`, `posIgv`, `posTotal`, `btnRapido`, `btnPagar` y `cartBadge` permanecen.
- `posRender()`, `posUpdateCart()`, `posAdd()`, `posQty()`, `posRm()`, `abrirCobro()`, `toggleMayorista()` y `abrirVentaLibre()` mantienen semántica comercial.
- El cambio es visual/DOM presentacional salvo el conteo de ítems del carrito.
- El CANON local-first y su outbox no se modifican.

## Riesgos
- Regresión móvil por carrito fijo de escritorio.
- Doble scroll entre catálogo y carrito.
- Conflicto con CSS legacy de `base.css`.
- Cierre/overlay del carrito en desktop.
- Densidad excesiva en pantallas pequeñas.

## Mitigación
- Overrides finales en `experience-v2/pages/pos.css`.
- Breakpoint explícito para volver a drawer bajo 980 px.
- Pruebas estructurales sobre IDs, handlers y media queries.
- No modificar lógica de cobro/persistencia.

## Rollback
Revertir el PR de esta tarea. No existen migraciones, escrituras remotas de datos ni cambios de esquema asociados.
