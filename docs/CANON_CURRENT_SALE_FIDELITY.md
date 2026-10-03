# CANON Current Sale Fidelity — CANON-CURRENT-SALE-001

## Autorización
Solicitud explícita del owner el 2026-10-02: ajustar exclusivamente la zona **Venta actual** del POS CANON usando la captura objetivo entregada en la conversación.

## Base
- Rama: `feature/v1.3-mobile-cloud`
- Base SHA: `9a5ebf3ce0a162db7b5b8abc91a6586ad8e00502`
- CANON directo.
- LAB fuera de alcance.

## Alcance exacto
1. Mantener intactos logo, branding, categorías y catálogo.
2. Acercar `Venta actual` a la referencia:
   - título y botón Limpiar;
   - selector de cliente funcional en la barra superior de venta;
   - líneas del carrito con imagen, nombre, unidades, controles - / +, importe y eliminar;
   - bloque de conteo, subtotal, IGV y total con la misma jerarquía visual;
   - Cantidad, Descuento y Cambiar precio;
   - Pago rápido y Pagar.
3. Mantener todas las acciones existentes funcionales.
4. NO añadir Nota de venta mientras el contrato CANON no la persista.

## Archivos permitidos
- `docs/CANON_CURRENT_SALE_FIDELITY.md`
- `POS/css/canon-pos-reference-ui.css`
- `POS/js/canon-pos-reference-ui.js`
- `tests/product-fixes/fix-pos-reference-ui/canon-pos-reference-ui.test.mjs`
- `tests/e2e/pos-reference-fidelity.spec.ts`

## Archivos prohibidos
- `laboratorio/**`
- branding/logo fuera de Venta actual
- backend / Worker / Turso / migraciones
- OUTBOX y persistencia
- inventario, créditos, caja y clientes fuera del selector de venta

## Invariantes
- No cambiar `posQty`, `posRm`, `abrirCobro`, `limpiarCarrito` ni contratos CANON.
- No añadir controles decorativos sin función.
- Cliente, Cantidad, Descuento, Cambiar precio, Limpiar, Pago rápido y Pagar deben seguir usando lógica real.
- Nota de venta queda fuera: el payload `sale.create`/intent actual no admite nota.

## Rollback
Revertir el PR de esta tarea. Sin migraciones ni cambios de datos.

## Nota de validación
- Un primer CANON Critical CI falló en T17 de cashClosures porque el fixture generó dos IDs iguales antes de la aserción de sessionId; es una prueba ajena a este cambio y no se modificó. Se reejecuta el pipeline sin alterar backup/caja.
