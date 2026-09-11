# Restricción de release V9: UNA SOLA PESTAÑA ACTIVA DE ESCRITURA

BASE: 1faf1062b9e30c96b1cdb71bf717ec03c8441e3e

## Caracterización demostrada (GATE 1)

1. **Serialización in-tab**: `saveAllData()` encadena cada guardado en
   `_naPersistChain` (inline-02). Dos escrituras concurrentes en la MISMA
   pestaña se aplican en orden FIFO; no se pierden entre sí.
2. **Sin CAS cross-tab**: el código V9 no usa Web Locks, ni BroadcastChannel,
   ni escucha el evento `storage`, ni compara revisiones al escribir.
3. **Last-writer-wins**: cada guardado escribe el snapshot COMPLETO tomado de
   la memoria de esa pestaña (`_naCommitSnapshot` → overwrite de `na_snapshot_v9`).
   El runtime de este gate demostró, con dos contextos reales compartiendo
   localStorage, que el último guardado pisa todo lo hecho por la otra pestaña
   (un producto creado solo en B desapareció del durable cuando A guardó) y que
   V9 NO reporta ningún conflicto (`_naLastPersistOK === true`).
4. **Mitigación futura**: el núcleo V10 (inline-17) ya contiene Web Locks
   exclusivos, BroadcastChannel y CAS por `expectedRevision`, pero está DORMANTE
   (ver gate 8): ningún camino activo del producto lo invoca.

## Condición de release

El release V9 es válido ÚNICAMENTE bajo la operación **UNA SOLA PESTAÑA
ACTIVA DE ESCRITURA**. Abrir el POS en dos o más pestañas del mismo dispositivo
puede provocar pérdida silenciosa de datos (ventas, pagos, movimientos) por
last-writer-wins. Esta restricción es de operación, no de código: el producto
hoy no la detecta ni la avisa.
