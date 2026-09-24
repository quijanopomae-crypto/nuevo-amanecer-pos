---
description: "SHADOW legacy: valida la superficie OpenCode viva solo cuando shadow fue invocado explícitamente."
subtask: false
---

SHADOW_EXPLICIT_ONLY.

Si el owner no pidió SHADOW explícitamente, DETENTE y usa `/canon-preflight`
o `/lab-preflight`.

En SHADOW ejecuta `python -B orchestrator/shadow_cli.py validate-project`.
Este comando valida la configuración OpenCode viva. El snapshot de
`infra/stable/SNAPSHOT.json` es un baseline histórico: la ejecución shadow que
dependa de él debe seguir fallando cerrado si ya no coincide con el árbol actual.
No regeneres ese snapshot automáticamente para obtener PASS.
