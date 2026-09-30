# Créditos y abonos: actualización al recibir confirmación

Solicitud del propietario: los abonos tardaban unos 30 segundos en verse y dar crédito unos 20 segundos. Ambos deben mostrarse casi al instante.

La interfaz actualiza el crédito desde el recibo confirmado y su intención durable, sin esperar la lectura completa del historial. Para ventas a crédito, el identificador `operation_id:credit` corresponde al contrato de `a6-commerce.js`; se conserva saldo, categoría y cuotas. Antes de recibir confirmación no se presenta el crédito como confirmado.

Los abonos siguientes pueden usar la proyección confirmada; el backend conserva las validaciones de autoridad, saldo y revisión. Otras operaciones continúan requiriendo conciliación. La conciliación no sustituye una vista ACTIVE por un bootstrap parcial y no puede sobrescribir recibos confirmados después de que comenzara su lectura. Sus rutas de historial se solicitan en paralelo. El outbox evita descargar dos veces la réplica antes de enviar una venta que ya tiene una vista validada.

Alcance: `POS/js/sync/canonical-client.js`, `canonical-credit-payment-bridge.js`, `canonical-sale-outbox.js` y pruebas cloud-sync relacionadas. No hay cambios de reglas comerciales, tablas ni migraciones.

Validación: regresiones con Worker real y SQLite sintético para créditos visibles antes de conciliar, dos abonos sin lecturas completas intermedias, historial bloqueado y conciliación anterior a un abono nuevo; además, suite completa cloud-sync y contrato UI. El tiempo total en el teléfono depende también de la red y del POST; las medidas locales no equivalen a latencia de producción.

Rollback: volver a publicar el frontend anterior, versión Worker web `3d480864-4db6-4d5a-81b5-411c16277e72`. El backend corregido para la consulta D1 permanece vigente.

## Segunda optimización: objetivo de 50 % adicional

La solicitud posterior pide aproximadamente 50 % más rapidez. Medición del camino real Worker/SQLite: un abono digital requería siete viajes a D1 (autenticación, lecturas previas y commit). Las precondiciones del pago se reúnen ahora en una sola consulta; el camino requiere tres viajes, una reducción de 57 % en viajes a D1. El pago en efectivo conserva el estado de caja y también usa tres viajes. Las validaciones CAS y autoridad permanecen dentro del mismo commit atómico; la recuperación posterior a un fallo consulta autoridad y recibos de nuevo.

Un crédito nuevo desde una réplica validada elimina el GET de estado inmediatamente anterior al POST: dos solicitudes HTTP pasan a una. El backend valida autoridad y stock, y los reintentos pendientes conservan la consulta de autoridad remota. Se prueba también la revocación de sesión entre la lectura agrupada y el commit.

Estos porcentajes corresponden a viajes de red eliminados; no garantizan que el tiempo total del teléfono baje exactamente en la misma proporción. La latencia del POST en la red del propietario sigue pendiente de medición.

Rollback de esta segunda optimización: frontend `c090e6c9-8ec6-437d-ad2d-3dceab058f02`, backend `4dfd94b6-51d4-4066-a57e-befb6d885b98`.
