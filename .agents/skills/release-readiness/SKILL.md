---
name: release-readiness
description: "Evalúa gates de release y exige la revisión de `docs/DEVELOPMENT_RISK_POLICY.md` para riesgo ALTO sin promover automáticamente."
---

# Release Readiness

Verifica pruebas, regresiones, evidencia, riesgos, fallback y diff. HIGH/release requiere la revisión independiente que fija `docs/DEVELOPMENT_RISK_POLICY.md` (puede ser automatizada y real); no hay gate nominal externo. Shadow mode nunca cambia autoridad ni inicia cutover.
