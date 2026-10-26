---
name: canon-promotion
description: "Integrar un candidato autorizado desde rama CANON; promoción LAB retirada."
---

# Integración CANON

El flujo LAB histórico está retirado; no exigir CANDIDATO_A_CANON ni build/test LAB para desarrollo actual. Partir de HEAD CANON vigente y seguir `AGENTS.md`, `docs/BRANCH_PREVIEW_WORKFLOW.md` y `docs/DEVELOPMENT_RISK_POLICY.md`.

El objetivo o pedido del propietario es la autorización y cubre pruebas, PR, merge y deploy de ese alcance (incluida la publicación al terminar), sin pedirla otra vez. Clasificar riesgo, registrar revisión proporcional, CI aplicable y rollback. Preview del SHA candidato cuando corresponde. El coordinador completa operaciones remotas; el subagente implementador conserva límites locales.

No copiar una app histórica entera, mezclar cambios ajenos, tocar datos reales para probar, omitir seguridad ni declarar PASS sin pruebas ejecutadas.
