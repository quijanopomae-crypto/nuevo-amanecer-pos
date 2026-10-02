# CANON Turso — auditoría READ-ONLY de documentos de crédito

## Objetivo

Comprobar en la autoridad Turso de producción, sin escrituras, la correspondencia entre saldos/documentos de crédito capturados por el owner y el estado CANON actual.

## Alcance

- Solo lecturas `SELECT` sobre Turso.
- No se crean sesiones, pagos, créditos, clientes, ajustes, ventas ni movimientos.
- No se ejecutan migraciones, deploys, D1 writes ni Worker commands.
- Los nombres y números de documento objetivo no se versionan en claro; el trigger guarda únicamente hashes SHA-256 y montos esperados.
- La salida del workflow usa aliases A/B y hashes de documentos para evitar exponer datos privados en logs.

## Invariantes

- `canonical_control.mode` debe ser `ACTIVE`.
- La suma de saldos CANON del cliente se compara contra el saldo esperado.
- Cada documento esperado se compara por hash con su total, pagado derivado y saldo actual.
- Créditos adicionales sin documento o de reconciliación se reportan por tipo y monto, sin identificadores privados.
- El script falla si detecta más de un cliente para el mismo hash de nombre o si el estado de autoridad no es válido.

## Rollback

No hay rollback de datos porque la auditoría no escribe. Para retirar la herramienta basta revertir los archivos de esta tarea.
