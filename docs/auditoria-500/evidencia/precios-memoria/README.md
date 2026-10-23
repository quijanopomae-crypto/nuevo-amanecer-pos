# Evidencia: precios (P-001..P-060) y memoria (M-001..M-035)

Resultados en `docs/auditoria-500/precios.csv` y `docs/auditoria-500/memoria.csv`. La columna `evidencia` empieza siempre con la fuente:

| Etiqueta | Qué es |
|---|---|
| «CANON en vivo, solo lectura, 2026-10-23» | Preguntas hechas a mano en CANON (Worker 76 / Web 198), usuario Admin, sin pulsar ningún botón (Confirmar/Cancelar/Llévame ahí). Tiempo medido desde Enter hasta que termina «Pensando» (aprox.). Notas originales en `canon/canon-tanda1..4.md`. |
| «arnés, modelo real» | `assistantChatRoute` / `belowCostRoute` del Worker ejecutados en Node, en local, con el modelo real `gpt-6.1-sol` (proveedor ohmyagent). Base y catálogo **sintéticos** (memoryReader + store en memoria), nunca CANON ni datos reales. Transcripción en `<id>.json`. |
| «arnés, modelo simulado» | El mismo arnés con un modelo falso (stub) en proceso: solo mide la lógica determinista del Worker (memoria, filtros, permisos). Salida en `arnes/arnes-resultados-simulado.json`. |

## Arnés (`arnes/`)

- `run.mjs`: el arnés. Uso: `node run.mjs <ruta-al-repo>`. Por defecto usa el modelo simulado y bloquea toda la red (`globalThis.fetch` lanza error).
- `REAL_MODEL=1 node run.mjs <repo>` (opt-in): usa el modelo real. La clave se lee **solo** de la variable de entorno `ASSISTANT_AI_API_KEY_4` ya presente en la máquina, se copia al objeto `env` en memoria y **nunca se imprime ni se escribe**. La red queda permitida solo hacia el host del proveedor (`ohhmyagent.com`).
- `merge_real.py`: une la calificación de la corrida real con la simulada. `consolidate.py`: arma los CSV finales con las notas de CANON.
- Las rutas dentro de los scripts son las de la máquina de auditoría (`/workspace/...`). Ajústalas si los corres en otro lugar.
- `real-run.log`: solo líneas de tiempos (`ms_model1`, `ms_total`, proveedor, modelo).

## Privacidad

- En las transcripciones los nombres de clientes van como `[cliente #id]`. Los clientes del catálogo sintético de `run.mjs` son inventados.
- Antes del commit se buscó en todo lo añadido la clave del proveedor (completa, primeros 12 y últimos 12 caracteres), además de `bearer` y `authorization`. No hubo ninguna coincidencia.
