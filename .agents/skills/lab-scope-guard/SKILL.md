---
name: lab-scope-guard
description: "Impide que una tarea LAB escriba fuera de su contrato o toque CANON."
---

# LAB Scope Guard

Antes de cualquier escritura:
1. Lee `AGENTS.md`.
2. Lee `laboratorio/pos-lab/UI_MAP.yaml`.
3. Lee el contrato de tarea LAB indicado por el owner.
4. Declara `OBJECTIVE`, `ALLOWED_FILES`, `FORBIDDEN_FILES` y pruebas.

Reglas duras:
- Una tarea `environment=LABORATORIO` no modifica `POS/**`.
- No amplíes alcance por conveniencia.
- Un archivo no listado en `allowed_files` requiere detenerse y redefinir el contrato.
- No uses datos, tokens ni endpoints de escritura de producción.
- Después de editar ejecuta `node laboratorio/pos-lab/scope-guard.mjs --task=<contrato>`.
- Si el guard falla, la tarea está FAIL aunque la función parezca funcionar.
