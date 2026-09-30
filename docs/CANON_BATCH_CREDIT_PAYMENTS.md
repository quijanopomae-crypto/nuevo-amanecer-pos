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

No existe un segundo ledger ni un nuevo comando backend. Cada asignación del lote se registra usando el `payment.create` CANON existente. El `canonical-client` continúa derivando la revisión del crédito, mantiene el journal PENDING/CONFIRMED y usa el mismo mecanismo idempotente de recibos.

Después de cada pago confirmado se refresca CANON antes de enviar la siguiente asignación. Esto evita reutilizar una réplica/revisión obsoleta.

## Fallo parcial

El backend actual define `payment.create` para un solo crédito, por lo que un cobro multi-crédito no es una transacción D1 única. Para preservar integridad:

- el lote se detiene ante el primer rechazo o estado incierto;
- una confirmación ya recibida nunca se vuelve a fabricar como un pago nuevo;
- ante ACK perdido se permite un único `retryPending()` de la misma `operation_id`;
- si ya hubo asignaciones confirmadas, la UI informa exactamente cuánto quedó aplicado y advierte que ese monto no debe repetirse;
- si no se puede refrescar después de una asignación confirmada, no se continúa con la siguiente.

## Referencias digitales

Una sola transferencia/Yape puede cubrir varias deudas. El número de operación se valida como no usado antes de iniciar el lote y se conserva idéntico en cada asignación del mismo lote para que el historial apunte a la operación externa real. No se generan referencias ficticias ni sufijos.

## Fuera de alcance

- cambios de schema D1;
- nuevo comando `payment.batch`;
- cambios de FIFO, Caja o evaluación crediticia;
- escritura directa en `creditos[]` o `cajMovs[]`;
- cambios en LAB;
- eliminación del flujo de pago individual.

## Rollback

Revertir el PR de esta tarea. No requiere reversión de migraciones ni de schema. Los pagos que ya hayan sido confirmados en producción son operaciones financieras reales y no deben borrarse; una corrección posterior debe usar los mecanismos de compensación existentes.
