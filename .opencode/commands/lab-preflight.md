---
description: "POS-LAB temporalmente deshabilitado; redirige el trabajo a CANON."
---

`LAB_TEMPORARILY_DISABLED = true`

No ejecutar preflight LAB mientras dure el freeze ordenado por el propietario.

Acción obligatoria:
1. no escribir ningún archivo LAB;
2. no crear Task Contract ni receipt LAB;
3. no ejecutar `skill-preflight.mjs`;
4. informar `LAB_TEMPORARILY_DISABLED`;
5. reclasificar una tarea normal del producto como CANON y usar `/canon-preflight`;
6. solo esperar una orden explícita del propietario si realmente se necesita reactivar LAB.
