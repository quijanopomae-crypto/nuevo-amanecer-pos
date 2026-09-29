# CANON — Venta libre / VARIOS

## Objetivo

Permitir que el botón **+ / VARIOS** participe en la misma venta CANON autoritativa que los productos registrados, sin crear productos ficticios ni movimientos de inventario.

## Flujo

`mVentaLibre` → carrito temporal → `canonical-sale-intent` → outbox durable → `sale.create` → D1 → lectura CANON → historial/ticket.

## Decisión de dominio

Una línea VARIOS **no es un producto**.

Cada línea genérica recibe un identificador durable reservado `GENERIC:<uuid>` dentro de la intención de venta y conserva en D1:

- nombre;
- código opcional;
- cantidad;
- precio unitario;
- subtotal;
- venta / operación / número de línea.

La metadata vive en `canonical_generic_sale_lines`, enlazada a la misma `sale_items` de la venta.

## Invariantes

- No se inserta nada en `products` ni `canonical_live_products`.
- No se crea `inventory_movements` ni se modifica stock por una línea VARIOS.
- Una línea normal sigue requiriendo un producto IMPORT o LIVE.
- Una línea genérica solo puede autorizarse si existe metadata inmutable exacta para esa venta/línea.
- `sale.create` conserva sus reglas de pago, cliente, crédito, idempotencia y outbox.
- Un ACK perdido reintenta el mismo `operation_id`, `sale_id` y `GENERIC:<id>`.
- En CANON, agregar VARIOS al carrito no usa `saveAllData()`; la autoridad comercial nace al encolar/confirmar la venta.
- Los locks reales del usuario siguen aplicando mediante `canonicalSaleCapture:true`.

## Compatibilidad

Si la migración `0016_canonical_generic_sale_lines.sql` todavía no existe:

- ventas normales continúan con el contrato anterior;
- una venta que contenga VARIOS falla cerrada con `generic_sale_schema_not_ready`.

## Pruebas mínimas

- Venta VARIOS única persiste y se ve en segundo dispositivo.
- No aparecen productos ni inventario fantasma.
- Venta mixta descuenta stock únicamente al producto real.
- El nombre/código genérico llegan por lectura CANON.
- Proyección PENDING_SYNC no marca `PRODUCT_NOT_FOUND`.
- ACK perdido no duplica venta ni metadata.
