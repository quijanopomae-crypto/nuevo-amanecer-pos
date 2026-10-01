# CANON → Turso: reparación de ventas y recuperación

Base real inspeccionada: `11d044c15704dd6a86a5fbf8f84b26b6c9a2a585` en `feature/v1.3-mobile-cloud`.
Autorización: solicitud del propietario; contrato `docs/tasks/CANON-TURSO-SALE-ROOT-001.json`, preflight registrado y committed antes de editar producto.

## Causas reproducidas

1. **PRODUCT_NOT_FOUND era un conflicto falso de la proyección.** `a6-mapping` conserva exactamente el ID origen como `products.product_id`; `canonical-ui-adapter` expone ese mismo ID como `uiProduct.id` y `product_id`; el carrito y el intent preservan el ID. Pero integration/view pasan `canonical.snapshot()` (filas SQL con `product_id` / `current_stock_quantity`) al projector, que buscaba exclusivamente `candidate.id` / `stock`. Incluso un producto existente obtenía PRODUCT_NOT_FOUND. El projector ahora reconoce la identidad CANON exacta y su stock, conserva compatibilidad de fixtures legacy y respeta productos sin control de inventario. No compara nombres ni crea productos.
2. **La captura no sincronizaba.** No había ninguna llamada de producción a `canonical-sale-outbox.sync()`, ni arranque/reanudación del outbox CANON. La corrección encola, confirma readback durable, libera carrito/modales y llama sync; el arranque reanuda pendientes, online vuelve a intentar y los fallos transitorios tienen hasta tres reintentos diferidos. Un rechazo explícito sigue bloqueado.
3. **Efectivo era rechazado antes del POST.** El builder serializa `payment.digital_method:null`, pero `makeIntentPayload` rechazaba null como método inválido. Se omite el campo opcional nulo al construir el payload HTTP sin relajar la validación de métodos digitales presentes.
4. **Consecutivo repetido.** El generador consultaba solo ventas confirmadas. Ahora incluye pendientes/confirmadas; enqueue reserva de nuevo bajo Web Lock compartido y conserva `last_sale_number` en el mismo sobre durable, incluso vacío. Seed al drenar envelopes antiguos; tampoco depende de que funcione el refresh o de que sobreviva el único receipt journal. `operation_id` sigue siendo UUID y el retry conserva el payload.
5. **Estado/feedback de UI apuntaba a window.** La lectura léxica reciente se mantiene. La limpieza todavía escribía `root.cart`, la función fallback recursaba y toast/cerrarModal son `const` globales no propiedades de window. El adapter ofrece una frontera runtime explícita; el view actualiza el binding real `productos`, el carrito se vacía después de readback y se cierran cobro normal/rápido. Se elimina el fingerprint permanente que impedía vender un carrito idéntico después de la primera captura.
6. **Caja lenta y feedback incorrecto.** Apertura/cierre/ajustes/gastos hacían scan completo antes y después del comando y mantenían el modal en Procesando hasta terminar el segundo scan. `prepareCommand` reutiliza una réplica validada current; si no es apta, refresh y assertAction siguen siendo obligatorios. Se conserva GET status antes del POST, autoridad/CAS/transacción backend y journal; el UI libera al recibir receipt y refresca en background. Se corrigen bindings léxicos de toast/cerrarModal/cajMovTipo. Cobro de créditos mantiene su ruta ya optimizada y sus pruebas existentes.

## Recuperación selectiva de los dos intents de prueba

Los envelopes antiguos con un sale_id repetido quedan BLOCKED_DUPLICATE_SALE_ID antes de POST. Al arrancar, únicamente el par identificado por el propietario (exactamente dos V-001 de efectivo por 200 y 300 centavos) se archiva automáticamente si una lectura autenticada current demuestra que ninguna operación está confirmada y no hay journal PENDING/ACK desconocido. Se archivan ambas entradas con readback antes de quitar sus operation_ids del outbox; otras cantidades, IDs, operaciones confirmadas o incertidumbre no se reparan automáticamente. No se reinterpretan productos por nombre. Si falla la lectura autenticada, la reparación conserva ambas entradas y usa la misma política de tres reintentos diferidos; nunca envía ninguna de esas ventas para probar la reparación.

En el navegador que conserva esos datos, inspeccionar `NuevoAmanecerCanonicalSaleOutbox.snapshot().intents` y llamar, para cada operation_id seleccionado por el propietario:

```js
await NuevoAmanecerCanonicalSaleOutbox.rejectInvalidTestIntent(operationId)
```

La función solo admite V-001 de efectivo por 200/300 centavos y exige réplica remota current, ausencia de journal PENDING, ausencia de venta/receipt confirmado de esa operación y evidencia de producto ausente o sale_id duplicado. Conserva copia readback-verificada en `na_canonical_sale_outbox_v1_rejected_tests` antes de quitar exclusivamente la entrada seleccionada. La evidencia archivada del par permite rechazar la segunda entrada después de la primera. Otras entradas, datos confirmados y storage ajeno quedan intactos. No se accedió al localStorage privado del navegador del propietario desde esta tarea. La reparación estrecha se ejecutará en ese dispositivo al cargar el build nuevo; su ejecución efectiva debe comprobarse antes de la primera venta real.

## Regresiones y validación

`node --test tests/cloud-sync/canonical-sale-turso-root.test.mjs` prueba bindings let/const reales, producto exacto, stockless, durabilidad, pending/confirmed, número reservado entre capturas con snapshot obsoleto, upgrade de outbox, receipt/refresh, ACK perdido/replay, stock 173→172 exactamente una vez, caja exactamente una vez, F5/segundo dispositivo, reparación selectiva y orden/número de llamadas financieras sin scan redundante.

Los tests usan el Worker y el **TursoD1Adapter de producción** sobre un transporte Hrana v3 de prueba que ejecuta SQL/transactions/constraints SQLite reales. No afirman ser una prueba remota de Turso ni realizan ventas en producción. El binding D1 se reemplaza por uno que lanza error para detectar su uso en esa ruta.

```sh
node --test tests/cloud-sync/*.test.mjs
node --test tests/product-fixes/fix*/*.test.mjs tests/backup-complete.test.mjs tests/backup-restore.test.mjs
node tools/pos-experience/promote-lab-visuals.mjs --check
node --test tools/cloudflare-lab/test/turso-d1-adapter.test.mjs tests/cloud-sync/v1.3-pos-web-deploy.test.mjs tools/cloudflare-lab/test/canon-backup-manifest.test.mjs
python3 -m unittest tools/cloudflare-lab/test/test_lab_snapshot_from_sql.py
```

Base: la regresión global-let ya fallaba en el HEAD original; fix02 T17 no falló localmente y no fue modificado. GitHub CANON Critical del base: run 36793229090, failure en cloud-sync. Cutover Turso histórico confirmado por GitHub: 36787513754, success.

Promoción: PR a rama base, gates relacionados PASS y workflow oficial `v1.3-pos-web-deploy.yml` sobre merge HEAD exacto. Verificar hash público de los archivos modificados y del service worker. Worker/schema/Turso/D1 producción no cambian. No ejecutar automáticamente la primera venta comercial real.

Rollback: revert del PR y redeploy Hosted POS mediante el mismo workflow; conservar intent/outbox/journal. Nunca cambiar el provider a D1 para revertir la UI.

## Límites operativos

El consecutivo es durable y único dentro del almacenamiento compartido del navegador y considera la réplica confirmada. Dispositivos desconectados con réplicas obsoletas pueden competir por el mismo consecutivo global: la restricción única del backend rechaza la colisión, no duplica ventas. Garantizar secuencias globales offline entre dispositivos requeriría un contrato de asignación de IDs distinto y aprobación de ese cambio; esta reparación no inventa IDs ni modifica schema.


## Recuperación automática antes de cambiar la línea de crédito

El journal CANON continúa siendo la protección contra duplicados, pero una
`sale.create` recuperable ya no obliga al operador a salir del modal y resolverla
manualmente antes de guardar una política de crédito.

Cuando **Ajuste manual de línea** detecta una operación ajena PENDING sin rechazo
definitivo, ejecuta `retryPending()` con el mismo `operation_id`. Si Turso ya
había confirmado la venta y solo se perdió el ACK, el replay idempotente devuelve
el receipt sin duplicar venta, stock ni caja. Solo después de que el journal deja
de estar PENDING se crea `customer.credit-policy.set`.

Si la operación anterior tiene un rechazo definitivo o continúa incierta, la
línea no se modifica y se muestra el motivo real. No se borra el journal ni se
omite ninguna validación para desbloquear la interfaz.
