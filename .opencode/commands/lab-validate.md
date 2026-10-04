---
description: "POS-LAB temporalmente deshabilitado; no valida ni habilita trabajo LAB."
---

`LAB_TEMPORARILY_DISABLED = true`

No ejecutar build, pruebas, scope guard ni validación LAB para habilitar nuevas escrituras.

Acción obligatoria:
1. detener cualquier flujo LAB;
2. informar `LAB_TEMPORARILY_DISABLED`;
3. para una tarea normal del producto, usar `/canon-validate` sobre el alcance CANON correspondiente;
4. no reactivar LAB sin una orden explícita del propietario.
