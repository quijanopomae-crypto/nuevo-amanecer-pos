# Auditoría de 500 pruebas del asistente

Un CSV por área en esta carpeta, con las columnas de `PLANTILLA.csv`:
`id,area,pregunta,objetivo,esperado,criterio,resultado,evidencia`.

- `resultado`: `pasa`, `falla` o `parcial` (vacío si aún no se corrió).
- En CANON solo lectura: nada de ventas, «Aplicar» ni «Confirmar».
- Cada uno empuja solo su archivo, sin forzar el push.
