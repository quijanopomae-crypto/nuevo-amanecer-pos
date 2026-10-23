# CANON inventario tanda 2 (solo lectura, Worker 76 / Web 198, Admin) — 2026-10-23 ~17:05 UTC
Ningún botón prohibido pulsado. Texto viejo tras «Nueva conversación»: SÍ en todas (respuesta previa visible + línea fija al pie del panel, probable live-region); el hilo enviado sí empieza limpio.

| Id | Tiempo | Resultado | Nota |
|---|---|---|---|
| INV-016 | ~4 s | FALLA | Solo tarjeta «Inventario valorizado» (Abrir documento), sin cifra |
| INV-017 | ~10–14 s | FALLA | Igual, sin ganancia; «Buscando» hasta 9 s |
| INV-018 | 6.1 s | PARCIAL | Tabla stock bebidas, sin total invertido |
| INV-019 | 5.7 s | PARCIAL | Tabla arroces con costo, sin valor a costo |
| INV-020 | 4.5 s | PASA | 29 sin costo, tabla (muestra 9) |
| INV-021 | 4.1 s | PASA | Tarjeta documento, no imprime solo |
| INV-022 | 6.1 s | FALLA | Tabla arroces, ignora «costeño», sin entradas/salidas |
| INV-023 | 4.6 s | FALLA | Resumen de ventas, no responde conteo Inca Kola |
| INV-024 | 4.6 s | PASA | Honesto: no hay compras guardadas + ruta |
| INV-025 | 6.1 s | FALLA | Azúcar -54, no explica baja 20→12 |
| INV-027 | 5.6 s | PARCIAL | 396/408 sin ventas; texto usa «producto #4» (códigos) para el Admin; tarjeta sí con nombres |
| INV-034 | 7.7 s | PASA | Honesto: no hay dato + ruta Kardex |

Hallazgos: patrón «tabla de stock como respuesta» (igual a H1 del arnés); texto viejo en el panel (hallazgo UI); INV-027 enmascara productos como «producto #N» en el texto al Admin.
