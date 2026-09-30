# Créditos y abonos: actualización al recibir confirmación

Solicitud del propietario: los abonos tardaban unos 30 segundos en verse y dar crédito unos 20 segundos. Ambos deben mostrarse casi al instante.

La interfaz actualiza el crédito desde el recibo confirmado y su intención durable, sin esperar la lectura completa del historial. Para ventas a crédito, el identificador `operation_id:credit` corresponde al contrato de `a6-commerce.js`; se conserva saldo, categoría y cuotas. Antes de recibir confirmación no se presenta el crédito como confirmado.

Los abonos siguientes pueden usar la proyección confirmada; el backend conserva las validaciones de autoridad, saldo y revisión. Otras operaciones continúan requiriendo conciliación. La conciliación no sustituye una vista ACTIVE por un bootstrap parcial y no puede sobrescribir recibos confirmados después de que comenzara su lectura. Sus rutas de historial se solicitan en paralelo. El outbox evita descargar dos veces la réplica antes de enviar una venta que ya tiene una vista validada.

Alcance: `POS/js/sync/canonical-client.js`, `canonical-credit-payment-bridge.js`, `canonical-sale-outbox.js` y pruebas cloud-sync relacionadas. No hay cambios de reglas comerciales, tablas ni migraciones.

Validación: regresiones con Worker real y SQLite sintético para créditos visibles antes de conciliar, dos abonos sin lecturas completas intermedias, historial bloqueado y conciliación anterior a un abono nuevo; además, suite completa cloud-sync y contrato UI. El tiempo total en el teléfono depende también de la red y del POST; las medidas locales no equivalen a latencia de producción.

Rollback: volver a publicar el frontend anterior, versión Worker web `3d480864-4db6-4d5a-81b5-411c16277e72`. El backend corregido para la consulta D1 permanece vigente.
