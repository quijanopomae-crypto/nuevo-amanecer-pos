---
description: "Ejecuta validaciones project-local y suite de infraestructura sin servidor persistente."
subtask: false
---

Ejecuta primero `python -B orchestrator/shadow_cli.py validate-project` y luego `python -B -m unittest discover -s tests/infrastructure -p "test_*.py" -v`. No cambies expectativas para obtener verde.
