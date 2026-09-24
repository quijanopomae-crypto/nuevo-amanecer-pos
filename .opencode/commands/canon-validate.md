---
description: "Valida cambios CANON locales/GitHub sin deploy ni llamadas remotas."
---

CANON_COMMAND.

Valida únicamente el alcance autorizado:
1. revisa `git status --short`, rama y HEAD;
2. ejecuta pruebas focales y regresiones aplicables;
3. ejecuta `git diff --check`;
4. revisa `git diff`;
5. confirma que no aparecieron archivos LAB/shadow fuera del contrato.

No uses `wrangler --remote`, deploy, secrets ni producción. Un PASS local/CI no
equivale a autorización de cutover.
