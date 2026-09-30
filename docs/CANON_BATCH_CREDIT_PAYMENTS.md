# CANON — cobro múltiple de créditos

## Objetivo

Permitir que el cajero registre desde la ficha financiera de un cliente un único
monto recibido contra varias deudas seleccionadas, sin abrir y confirmar cada
crédito por separado.

## Flujo aprobado

1. En una categoría con deudas activas aparece **Cobro múltiple**.
2. El cajero puede usar **Seleccionar todo** o marcar deudas individualmente.
3. Ingresa el **Monto total que está abonando**.
4. **Aplicar automáticamente** selecciona deudas por antigüedad hasta cubrir el monto.
5. El preview distribuye el monto entre las deudas seleccionadas comenzando por la más antigua y nunca excede el saldo de una deuda.
6. El botón final muestra **Registrar pago S/X**.
7. Efectivo conserva el requisito de caja CANON abierta. Yape/Plin y transferencia conservan el número de operación.

El flujo individual **Registrar pago** continúa disponible dentro de cada crédito.

## Autoridad financiera

No existe un segundo ledger. Cada deuda del lote continúa registrada en D1 como una operación inmutable **`payment.create`**, con su propio `operation_id`, request hash y receipt.

Para eliminar la latencia de red multiplicada por el número de deudas, el Worker expone **`POST /commands/payment.batch` únicamente como transporte**. Ese endpoint no es un nuevo tipo de asiento financiero: empaqueta hasta 20 intents `payment.create` distintos y los valida/commitea juntos mediante una sola `db.batch()` de D1. Si cualquiera de las revisiones de crédito o la sesión de caja ya no coincide, la transacción completa falla y no se confirma ninguna deuda de ese chunk.

El `canonical-client` mantiene un único writer lock y un journal PENDING/CONFIRMED del chunk. Un cobro de 14 deudas pasa de **14 POST secuenciales a 1 POST**. Si alguna vez se seleccionan más de 20 deudas, el cliente las divide en chunks de 20 para respetar los límites de consultas/bindings del runtime sin volver a un POST por deuda.

Una vez confirmados los receipts durables, se dispara **una sola reconciliación CANON en segundo plano** para actualizar toda la vista.

## Fallo parcial

Para lotes de hasta 20 deudas, el primer intento es **atómico**: todos los `payment.create` hijos se confirman o ninguno se confirma.

- cada hijo conserva un `operation_id` estable;
- un CAS dentro de D1 comprueba simultáneamente las revisiones y saldos de todos los créditos;
- Efectivo comprueba además que la misma sesión CANON continúe abierta;
- un fallo en cualquier sentencia aborta/rollback de toda la `db.batch()`;
- ante ACK perdido se reenvía exactamente el mismo payload de lote y los mismos operation_id hijos;
- un replay completo devuelve los receipts ya procesados sin duplicar pagos.

Solo un lote excepcional de más de 20 deudas requiere varios chunks. Entre chunks sigue aplicando la regla de detenerse ante el primer rechazo o resultado incierto; los chunks ya confirmados no se repiten.

## Referencias digitales

Una sola transferencia/Yape puede cubrir varias deudas. El número de operación se valida como no usado antes de iniciar el lote y se conserva idéntico en cada asignación del mismo lote para que el historial apunte a la operación externa real. No se generan referencias ficticias ni sufijos.

## Fuera de alcance

- cambios de schema D1;
- nuevo tipo de ledger D1 `payment.batch` (el endpoint HTTP de transporte sí existe, pero persiste únicamente hijos `payment.create`);
- cambios de FIFO, Caja o evaluación crediticia;
- escritura directa en `creditos[]` o `cajMovs[]`;
- cambios en LAB;
- eliminación del flujo de pago individual.

## Rollback

Revertir el PR de esta tarea. No requiere reversión de migraciones ni de schema. Los pagos que ya hayan sido confirmados en producción son operaciones financieras reales y no deben borrarse; una corrección posterior debe usar los mecanismos de compensación existentes.


## Corrección de selección CANON

En la interacción de selección, **Seleccionar todo** completa automáticamente el
monto con la suma pendiente de las deudas seleccionadas. Mientras el monto siga
en modo automático, marcar o desmarcar deudas mantiene ese total sincronizado.
Si el cajero edita el monto manualmente, la selección posterior no lo
sobrescribe; **Aplicar automáticamente** conserva el monto escrito y decide qué
deudas necesita seleccionar.

El campo **Número de operación** permanece oculto con **Efectivo** y solo se
muestra para Yape/Plin o transferencia.


## Rendimiento del cobro múltiple

Antes del fast path, un lote de varias deudas ejecutaba el patrón
`payment.create -> refresh completo -> payment.create -> refresh completo`.
El refresh completo consulta múltiples rutas CANON y dominaba la latencia.

La primera optimización eliminó los refresh intermedios, pero todavía quedaba un
round-trip HTTP por deuda. En una prueba Android real con **14 deudas / S/ 88.60**
ese patrón todavía mantuvo `Procesando...` alrededor de 30 segundos.

El fast path actual elimina también esa serialización de red: hasta 20 deudas viajan
en **un solo POST** y D1 las ejecuta en una transacción `db.batch()`. Se conservan
las mismas escrituras `payment.create`, operation_id y receipts individuales, pero
sin pagar N veces la latencia navegador → Worker → D1 → navegador.

No se muestra éxito antes de recibir los receipts durables del Worker. La mejora
proviene de **eliminar trabajo y viajes de red redundantes**, no de ocultar el
indicador ni de simular un pago optimista.


## Optimización de latencia fase 2

Después de reducir el navegador a un solo POST batch, el Worker todavía ejecutaba
varias lecturas D1 independientes de forma secuencial antes de la transacción:
autoridad, replay, créditos y sesión de caja. Esas lecturas ahora arrancan juntas
con `Promise.all`; las validaciones permanecen iguales y la `db.batch()` final
continúa siendo la única decisión de escritura atómica.

Esta optimización no cambia saldos, receipts, revisiones ni reglas de caja. Solo
elimina espera serial dentro del Worker.


## Respuesta inmediata post-commit

La optimización de UX no marca una deuda como pagada de forma optimista. El orden es:

1. el Worker confirma y devuelve el receipt durable;
2. inmediatamente la fila muestra **Pagado ✓** (o **Abono confirmado ✓** si fue parcial);
3. se ajusta visualmente el pendiente de la cuenta;
4. la reconciliación CANON completa continúa en segundo plano;
5. al llegar la réplica autoritativa, reemplaza esa proyección temporal.

Para una sola deuda seleccionada, el cliente evita el overhead de `payment.batch` y
reutiliza el fast path `payment.create`: un solo POST y sin GET de status redundante
en el primer intento. Para varias deudas, el primer `payment.batch` también omite
ese GET redundante porque el Worker revalida autoridad, revisiones de todos los
créditos y sesión de caja dentro de la transacción. Cualquier retry mantiene la
verificación remota obligatoria.

El objetivo es que el POS no agregue espera innecesaria. La latencia absoluta de
Internet móvil no puede garantizarse por código cliente; nunca se muestra **Pagado**
antes de una confirmación durable.


## Simplificación de latencia — camino único del panel Cobro múltiple

La prueba Android posterior mostró aproximadamente **4 s** incluso con una sola
deuda. La causa era que esa única deuda se desviaba al endpoint genérico
`payment.create`, cuyo servidor ejecuta más comprobaciones D1 secuenciales que
el endpoint especializado de lote.

El panel **Cobro múltiple** ahora usa un solo camino para **1 a 20 deudas**:

`POST /commands/payment.batch`

Esto no cambia el ledger: una deuda sigue persistiendo como un único hijo
`payment.create` con su propio `operation_id`, receipt, evento PAYMENT, método,
referencia y efecto de caja.

En el Worker, las prelecturas independientes de autoridad, replay, créditos y
sesión de caja se envían mediante **una sola llamada `db.batch()` de lectura**,
mientras los hashes se calculan localmente en paralelo. Después se mantiene una
segunda `db.batch()` como frontera de escritura atómica con CAS.

Así se elimina transporte y espera del backend sin eliminar información ni
convertir el resultado en optimista. **Pagado** continúa apareciendo únicamente
después del receipt durable.
