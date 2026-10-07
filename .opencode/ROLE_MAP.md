# OpenCode role map — Nuevo Amanecer

Referencia corta para elegir agente y zona. `AGENTS.md` gobierna el flujo vigente.

## Estado

`CANON_DEFAULT = true`
`POS_LAB_RETIRED = true`
`BRANCH_PREVIEW_REQUIRED = true`

| Zona / rol | Agente | Escritura | Regla principal |
|---|---|---|---|
| CANON branch | `pos-canon-implementer` | Sí, solo rama/alcance autorizado | Nunca merge/deploy remoto implícito |
| Preview | mismo candidato | No código distinto | Debe servir el mismo SHA del Draft PR |
| SHADOW legacy | `pos-implementer` | Solo infraestructura/evidence shadow | `PRODUCT_WRITE = DENIED` |
| PLANNER | `pos-planner` | No | Diagnóstico/plan |
| REVIEWER | `pos-reviewer` | No | Revisión independiente |
| TESTER | `pos-tester` | No | Ejecuta pruebas; no modifica expectativas |

## Selección rápida

- Cambio funcional/UI/performance del POS → rama desde CANON + `pos-canon-implementer`.
- Bug → `fix/*`.
- Rendimiento → `perf/*`.
- Arquitectura/higiene → `arch/*`.
- Investigación → `pos-planner`.
- Segunda revisión → `pos-reviewer`.
- Pruebas independientes → `pos-tester`.
- POS-LAB histórico → READ-ONLY; no se reactiva como destino de producto.

## Comandos

- CANON: `/canon-preflight`, `/canon-validate`.
- LAB: retirados del flujo activo.
- Comandos legacy `/preflight`, `/validate`, `/feature-spec`, `/orchestrate`, `/resume` son **SHADOW_EXPLICIT_ONLY**.

## Skills

- `feature-spec`, `impact-analysis`, `dependency-map`: análisis reutilizable.
- `inventory-integrity`, `cash-integrity`, `credits-integrity`, `cross-module-impact`, `evidence-pack`, `release-readiness`: no conceden escritura CANON por sí mismas.
- skills LAB antiguas quedan retiradas; no son parte del flujo activo.

No existe promoción implícita entre zonas. El cambio probado debe llegar a CANON mediante la misma rama/PR/SHA que fue revisada.
