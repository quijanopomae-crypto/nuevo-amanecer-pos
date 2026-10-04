# OpenCode role map — Nuevo Amanecer

Este archivo es la referencia corta para elegir agente y zona. No sustituye
`AGENTS.md` ni `AGENTS_Nuevo_Amanecer.md`.

## Estado temporal

`LAB_TEMPORARILY_DISABLED = true`

Mientras el propietario no ordene explícitamente reactivar/habilitar LAB, toda tarea normal del POS se dirige a CANON. LAB se conserva solo como referencia/backup de código y no recibe nuevas escrituras.

| Zona / rol | Agente | Escritura | Regla principal |
|---|---|---|---|
| CANON | `pos-canon-implementer` | Sí, solo alcance autorizado y local/GitHub | Zona por defecto; nunca deploy/remote sin autorización separada |
| LAB | `pos-lab-implementer` | **DESHABILITADA** | No seleccionar ni escribir; redirigir tareas normales a CANON |
| SHADOW legacy | `pos-implementer` | Solo infraestructura/evidence shadow | `PRODUCT_WRITE = DENIED`; filename legacy |
| PLANNER | `pos-planner` | No | Para producto normal debe declarar CANON mientras LAB esté congelado |
| REVIEWER | `pos-reviewer` | No | Revisión independiente; no hereda PASS |
| TESTER | `pos-tester` | No | Ejecuta pruebas locales; nunca cambia expectativas |

## Selección rápida

- Cambio funcional del POS o código CANON versionado → `pos-canon-implementer`.
- Solicitud que antes habría ido a `laboratorio/pos-lab/**` → trabajar directamente en CANON dentro del alcance autorizado.
- Si una tarea exige realmente reactivar LAB → detenerse y pedir orden explícita al propietario; no reactivarlo automáticamente.
- Orquestador histórico, evidence o infraestructura shadow → `pos-implementer`, solo si shadow fue pedido explícitamente.
- Investigación/plan → `pos-planner`, clasificando producto normal como CANON.
- Segunda revisión → `pos-reviewer`.
- Pruebas independientes → `pos-tester`.

## Skills

- `lab-scope-guard`, `lab-ui-edit`, `lab-animation-edit`, `lab-feature-edit`: congeladas mientras LAB esté deshabilitado.
- `canon-promotion`: no se usa para trabajo nuevo durante el freeze; no hay promoción implícita.
- `feature-spec`, `impact-analysis`, `dependency-map`: análisis READ-ONLY reutilizable.
- `inventory-integrity`, `cash-integrity`, `credits-integrity`, `cross-module-impact`,
  `evidence-pack`, `release-readiness`: nacieron en shadow legacy; no conceden escritura CANON por sí mismas.

## Comandos

- CANON: `/canon-preflight`, `/canon-validate`.
- LAB: `/lab-preflight`, `/lab-validate` deben detenerse con `LAB_TEMPORARILY_DISABLED` y redirigir a CANON.
- Los comandos genéricos legacy `/preflight`, `/validate`, `/feature-spec`,
  `/orchestrate`, `/resume` son **SHADOW_EXPLICIT_ONLY** por compatibilidad.

No existe promoción implícita entre zonas. La solicitud explícita actual del propietario prevalece sobre documentos LAB históricos.
