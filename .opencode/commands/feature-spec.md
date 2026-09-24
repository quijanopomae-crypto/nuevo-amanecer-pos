---
description: "SHADOW legacy: genera Feature Spec solo cuando el owner invoque shadow explícitamente."
subtask: false
---

SHADOW_EXPLICIT_ONLY.

Si la solicitud actual no invoca SHADOW de forma explícita, DETENTE y usa
`/canon-preflight` o `/lab-preflight` según corresponda.

Solicitud: $ARGUMENTS

En SHADOW usa `feature-spec`, después `impact-analysis` y `dependency-map`.
La salida es READ-ONLY e incluye riesgo, archivos esperados/prohibidos y NEXT_ACTION.
