---
description: "SHADOW legacy: ejecuta escenario shadow conocido; nunca para tareas CANON/LAB normales."
subtask: false
---

SHADOW_EXPLICIT_ONLY.

Si SHADOW no fue pedido explícitamente, DETENTE.

En SHADOW ejecuta `python -B orchestrator/shadow_cli.py run-scenario $ARGUMENTS`.
Solo están permitidos IDs de `fixtures/shadow/scenarios.json`.
`PRODUCT_WRITE = DENIED`.
