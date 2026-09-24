# OpenCode role map — Nuevo Amanecer

Este archivo es la referencia corta para elegir agente y zona. No sustituye
`AGENTS.md` ni `AGENTS_Nuevo_Amanecer.md`.

| Zona / rol | Agente | Escritura | Regla principal |
|---|---|---|---|
| CANON | `pos-canon-implementer` | Sí, solo alcance autorizado y local/GitHub | Nunca deploy/remote sin autorización separada |
| LAB | `pos-lab-implementer` | Solo `laboratorio/**` + tests LAB autorizados | Nunca `POS/**` ni autoridad comercial |
| SHADOW legacy | `pos-implementer` | Solo infraestructura/evidence shadow | `PRODUCT_WRITE = DENIED`; filename legacy |
| PLANNER | `pos-planner` | No | Declara CANON/LAB/SHADOW antes de planificar |
| REVIEWER | `pos-reviewer` | No | Revisión independiente; no hereda PASS |
| TESTER | `pos-tester` | No | Ejecuta pruebas locales; nunca cambia expectativas |

## Selección rápida

- Cambio funcional del POS o código CANON versionado → `pos-canon-implementer`.
- Experimento de UI/feature bajo `laboratorio/pos-lab/**` → `pos-lab-implementer`.
- Orquestador histórico, evidence o infraestructura shadow → `pos-implementer`, solo si shadow fue pedido explícitamente.
- Investigación/plan → `pos-planner`.
- Segunda revisión → `pos-reviewer`.
- Pruebas independientes → `pos-tester`.

## Skills

- `lab-scope-guard`, `lab-ui-edit`, `lab-animation-edit`, `lab-feature-edit`: solo LAB.
- `canon-promotion`: promoción LAB→CANON; requiere aprobación explícita del owner.
- `feature-spec`, `impact-analysis`, `dependency-map`: análisis READ-ONLY reutilizable.
- `inventory-integrity`, `cash-integrity`, `credits-integrity`, `cross-module-impact`,
  `evidence-pack`, `release-readiness`: nacieron en shadow legacy; no conceden escritura CANON por sí mismas.

## Comandos

- CANON: `/canon-preflight`, `/canon-validate`.
- LAB: `/lab-preflight`, `/lab-validate`.
- Los comandos genéricos legacy `/preflight`, `/validate`, `/feature-spec`,
  `/orchestrate`, `/resume` son **SHADOW_EXPLICIT_ONLY** por compatibilidad.
  Si el owner no pidió shadow, deben detenerse y redirigir a CANON/LAB.

No existe promoción implícita entre zonas.
