# Permisos del empleado frente a CasaMarket (ítem 3)

Fuente del código: `POS/js/config/pos-permissions.js`, `POS/js/config/pos-roles-client.js` (OWNER_COMMANDS), `tools/cloudflare-lab/src/pos-roles.js` (ownerGate) y `tools/cloudflare-lab/src/worker.js`.

| Acción | CasaMarket | Nuevo Amanecer hoy | Brecha / propuesta |
|---|---|---|---|
| Anular venta (`sale.annul`) | PIN del dueño siempre | PIN del dueño siempre, también en su aparato (`ownerGate(..., true)`) | Igual. Sin cambio. |
| Ajustar stock (`inventory.adjust`, `adjustment.create`) | PIN solo al empleado | PIN solo al empleado | Igual. |
| Editar producto o precio (`product.update`) | PIN solo al empleado | PIN solo al empleado | Igual. |
| Límite de crédito (`customer.credit-policy.set`) | Sensible | PIN solo al empleado | Igual (criterio POS). |
| Compensación de caja (`compensation.create`) | Sensible | PIN solo al empleado | Igual. |
| **Registrar compra** (`/auth/purchases` POST) | **Sin PIN** | **PIN del dueño al empleado** (puerta `inventory.adjust`) | **Brecha.** Se propone un ajuste del dueño `compras.pin_empleado` (en `pos_settings`, sin migración). Por defecto sigue pidiendo PIN (no cambia nada al publicar). Si el dueño lo apaga, el empleado registra compras sin PIN, como CasaMarket. El empleado sigue sin ver proveedor ni costos en el historial. |
| Ver costos, reportes, cierres de caja | Solo dueño | Solo dueño (cliente y servidor) | Igual. |
| Crear producto (`product.create`) | No documentado | Empleado sin PIN | Sin cambio. Si el dueño lo quiere, se agrega a OWNER_COMMANDS en otro PR. |
| Gastos (`expense.create`) | No documentado | Empleado sin PIN; editar o anular, solo dueño | Sin cambio. |
| Descuento en venta | No documentado | Se marca para revisión del dueño (`flagSaleDiscount`) | Sin cambio. |

`pos-permissions.js` solo cambia para la tarjeta de Próximamente (`permisos-empleado`, Disponible y solo para el dueño): **publicar primero el Worker y después la web**. El ajuste vive en `pos_settings` (tabla existente; solo el dueño puede escribir `/settings`).
