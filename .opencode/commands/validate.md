---
description: "SHADOW legacy: ejecuta validaciones de infraestructura shadow solo bajo invocación explícita."
subtask: false
---

SHADOW_EXPLICIT_ONLY.

Si el owner no pidió SHADOW explícitamente, DETENTE y usa `/canon-validate`
o `/lab-validate`.

En SHADOW ejecuta primero `python -B orchestrator/shadow_cli.py validate-project`
y luego `python -B -m unittest discover -s tests/infrastructure -p "test_*.py" -v`.
No cambies expectativas para obtener verde.
