---
description: "SHADOW legacy: valida manifiesto/snapshot solo cuando shadow fue invocado explícitamente."
subtask: false
---

SHADOW_EXPLICIT_ONLY.

Si el owner no pidió SHADOW explícitamente, DETENTE y usa `/canon-preflight`
o `/lab-preflight`.

En SHADOW ejecuta `python -B orchestrator/shadow_cli.py validate-project`.
No modifiques producto. Reporta cada gate y detente si alguno falla.
