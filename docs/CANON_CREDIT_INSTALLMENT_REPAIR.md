# CANON — reparación dirigida de cronogramas de crédito importados

## Problema observado

Los saldos de los dos clientes auditados coinciden al céntimo con la fuente, pero la UI CANON muestra `0 compras` y los créditos importados no tienen filas en `canonical_credit_installments`. Por eso el detalle permanece genérico y no aparece el cronograma.

## Causa

1. `purchaseCount` solo reconoce créditos con `sale_id`/tipo local, por lo que los créditos IMPORT válidos se contabilizan como cero.
2. Los créditos auditados conservan saldo/pagos, pero no tienen cronograma estructurado.
3. En los planes fuente, la suma del cronograma puede ser menor al monto original porque una parte ya había sido pagada antes del tramo reprogramado. El avance de cuotas debe descontar ese pago histórico base antes de aplicar pagos al cronograma.

## Reparación

- Persistir únicamente metadata de cuenta pequeña y cuotas faltantes para los documentos auditados.
- Identificar clientes/documentos por SHA-256 normalizado; no versionar nombres ni números en claro.
- No modificar saldos, pagos ni hechos financieros.
- Si existe metadata/cuota distinta a la esperada, abortar sin escribir.
- En UI, contar créditos activos importados como compras visibles.
- Derivar `scheduledPaid = totalPaid - max(0, originalAmount - scheduleTotal)`.
- Soportar estado de cuota parcial.

## Seguridad

Antes de la escritura remota:
- comprobar CANON ACTIVE;
- verificar 29 clientes con deuda positiva y S/ 23,684.95;
- verificar montos exactos de los créditos objetivo;
- crear backup lógico Turso;
- guardar y releer el backup desde R2;
- ejecutar inserts idempotentes;
- volver a verificar deuda, documentos y cronogramas.

No hay migración de schema.
