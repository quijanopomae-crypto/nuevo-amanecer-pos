# Evidencia: inventario (INV-001..INV-065)

Resultados en `docs/auditoria-500/inventario.csv`; hallazgos en `docs/auditoria-500/hallazgos-inventario.md`.

| Etiqueta | Qué es |
|---|---|
| «CANON solo lectura, Worker 76 / Web 198, Admin» | 35 preguntas de solo lectura hechas a mano en CANON, usuario Admin, sin pulsar ningún botón. Notas originales en `canon/canon-inventario-1..3.md`. |
| «arnés, modelo real» | 30 preguntas que escriben o necesitan datos controlados: rutas del Worker en Node, en local, con el modelo real (`gpt-6.1-sol`, ohmyagent), base `0914ee23`, catálogo sintético (nunca CANON). Pasada oficial 2. Transcripción en `INV-0xx.json`. |

Los nombres de clientes van tapados como `[cliente #id]` / «cliente #N». No hay clave en ningún archivo.
