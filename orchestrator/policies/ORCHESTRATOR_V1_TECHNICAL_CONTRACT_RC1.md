# ORCHESTRATOR_V1_TECHNICAL_CONTRACT_RC1

**Contract version:** `1.0.0-rc1`

**Decision:** `READY_FOR_INFRA_LAB`

**Implementation at approval:** `NOT_STARTED`

**Cutover:** `NOT_AUTHORIZED`

**OpenCode V2:** `UNCHANGED`

**Product:** `UNTOUCHED`

Este documento es la referencia normativa versionada para el laboratorio. Las cláusulas marcadas para fases posteriores no quedan implementadas por su mera presencia aquí.

## 1. MANIFEST.yaml

El manifiesto usa el identificador exacto `nuevo-amanecer.orchestrator/manifest@1.0.0-rc1`, `strict: true` y un `manifest_revision` entero positivo. Toda propiedad no declarada se rechaza. Los identificadores y referencias de modelos, roles, capacidades y skills deben ser válidos y únicos.

El routing estable se expresa por `model_ref`; no se admite routing temporal por worktree. `.agents/skills` es la fuente canónica cuando el runtime OpenCode la soporta y `.opencode/skills` está prohibido. Los paths son relativos a raíces permitidas, no aceptan traversal y solo pueden interpolar variables expresamente autorizadas.

La integridad normativa es SHA-256 sobre UTF-8 de la representación JSON canónica del manifiesto sin `integrity.manifest_sha256`, con claves ordenadas, separadores compactos, sin números flotantes y sin normalización ambiental. El valor almacenado tiene formato `sha256:<64 hex minúsculas>`.

## 2. Roles, modelos y capacidades

- `orchestrator`: coordina, aplica gates y registra estado; no sustituye al implementador o revisor.
- `deepseek`: ejecutor primario cuando una fase habilite implementación.
- `glm`: revisor independiente **condicional**, requerido por una regla de riesgo o por un resultado que solicite revisión; no es un gate universal.
- `codex`: revisor o escalación forense externo a OpenCode. No hereda estado conversacional implícito.

Las capacidades se conceden explícitamente por rol y la ausencia de una capacidad equivale a denegación.

## 3. State machine

Estados no terminales: `CREATED`, `PREFLIGHT`, `RESOURCE_CHECK`, `READY`, `DELEGATED`, `RUNNING`, `VALIDATING`, `CONDITIONAL_REVIEW`, `CODEX_HANDOFF`, `RESULT_INGESTION` y `RETRY_DECISION`.

Estados de bloqueo: `RESOURCE_BLOCKED`, `PERMISSION_BLOCKED`, `ENVIRONMENT_BLOCKED`, `WRONG_WORKTREE`, `CODEX_REVIEW_REQUIRED` y `CODEX_ESCALATION_REQUIRED`.

Estados terminales: `APPROVED`, `REJECTED`, `FAILED` y `CANCELLED`.

Transición base:

`CREATED → PREFLIGHT → RESOURCE_CHECK → READY → DELEGATED → RUNNING → VALIDATING`.

Desde `RESOURCE_CHECK`, un recurso insuficiente produce `RESOURCE_BLOCKED`; solo nueva evidencia de disponibilidad permite volver a `RESOURCE_CHECK`. Desde `VALIDATING`: éxito sin revisión requerida produce `APPROVED`; revisión GLM requerida produce `CONDITIONAL_REVIEW`; handoff requerido produce `CODEX_HANDOFF`; una falla reintentable produce `RETRY_DECISION`; una falla no reintentable produce el bloqueo o terminal correspondiente.

El avance es monotónico por ordinal de estado. No se permite reescribir historial ni retroceder a un estado previo. Un reintento crea un nuevo `cycle_id` y una nueva ejecución enlazada; no mueve hacia atrás la ejecución anterior.

## 4. Intentos, ciclos y retries

Un `cycle_id` permite como máximo **un intento por `model_ref`**. Un retry nunca repite el modelo dentro del mismo ciclo: crea el ciclo siguiente y debe aportar evidencia nueva o cambiar una variable experimental declarada. Una hipótesis demostrada admite como máximo tres ciclos. Una causa no demostrada no admite intentos especulativos y exige escalación inmediata. El agotamiento del tercer ciclo lleva a `CODEX_ESCALATION_REQUIRED`.

## 5. Permissions contract

- `read`: glob de lectura explícito; no concede escritura.
- `write`: glob explícito, propietario único y escritura solo mediante la herramienta autorizada.
- `tests`: comandos exactos o plantillas parametrizadas con argumentos validados.
- `git`: lectura por defecto; mutaciones enumeradas individualmente. Push, merge, rebase, reset, clean y stash están denegados salvo contrato posterior explícito.
- `protected_files`: denegación de máxima prioridad; no puede ser anulada por un allow más amplio.

`orch_write`, cuando sea implementado, deberá escribir a un archivo temporal en el mismo volumen, sincronizar, reemplazar atómicamente el destino y registrar digest anterior/nuevo. Un fallo antes del replace conserva el destino; un fallo posterior incierto se clasifica y verifica antes de reintentar. Fase 1 no implementa `orch_write`.

## 6. Delegation contract

Una delegación futura contendrá como mínimo: `contract_version`, `task_id`, `run_id`, `cycle_id`, `attempt_id`, `role_id`, `model_ref`, `objective`, `scope`, `permissions`, `protected_files`, `input_evidence_refs`, `acceptance_criteria`, `required_tests`, `wip_class`, `deadline_policy` y `output_schema_version`.

El rol devuelve un sobre estructurado con: `status`, `facts`, `hypotheses`, `actions`, `files_observed`, `files_changed`, `tests`, `evidence_refs`, `failure_code`, `risks`, `next_action` y `digest`. Texto libre puede acompañar el sobre, pero no reemplazarlo.

## 7. Independent context contract

GLM recibe objetivo, alcance, invariantes, diff/evidencia primaria, comandos y resultados; no recibe la conclusión, recomendación o veredicto de DeepSeek antes de emitir su propio resultado. Después se permite una fase de reconciliación que conserva ambos resultados originales.

Codex recibe un paquete forense cerrado y verificable: contrato, snapshot de Git, evidencia primaria, cronología, intentos, comandos/resultados, archivos/diffs autorizados, fallas y preguntas concretas. No recibe memoria conversacional implícita como fuente de verdad.

### External Codex handoff/result ingestion

El handoff exporta un `CODEX_HANDOFF` con ID, schema version, digests y nonce. El resultado externo debe ser `CODEX_RESULT`, referenciar exactamente ese handoff, incluir identidad del revisor, veredicto, hallazgos, evidencia, timestamp y digest. La ingestión verifica schema, correlación, nonce, digest, estado pendiente e idempotency key. Un resultado duplicado idéntico es idempotente; uno conflictivo es F9. Solo un resultado validado puede transicionar desde `RESULT_INGESTION`.

## 8. Gate contract

`preflight` verifica contrato/schema, identidad de repo y worktree, Git/WIP, permisos, archivos protegidos, versiones, comandos y ausencia de secretos. `RESOURCE_CHECK` verifica disponibilidad de runtime/modelo, cuotas, espacio, dependencias y canales externos declarados. `validation` ejecuta pruebas requeridas, comprueba diff/alcance, evidencia, integridad, WIP final y requisitos de revisión.

Ningún gate puede marcar PASS por lectura estática cuando el criterio exige ejecución.

## 9. WIP policy

- `CLEAN`: no hay diferencias locales.
- `EXPECTED_WIP`: cada diferencia está identificada, atribuida, protegida y admitida expresamente para la tarea.
- `UNKNOWN_WIP`: existe cualquier diferencia sin atribución verificable; bloquea escritura y se clasifica antes de continuar.

La clasificación se registra antes y después. El orquestador no limpia, restaura, stashea ni incorpora WIP ajeno.

## 10. Failure taxonomy F1–F11

| Código | Clase | Transición normativa |
|---|---|---|
| F1 | `CONTRACT_INVALID` | Desde preflight/gate a `FAILED`; no retry. |
| F2 | `PERMISSION_DENIED` | A `PERMISSION_BLOCKED`; reanudar solo con contrato nuevo. |
| F3 | `WRONG_WORKTREE` | A `WRONG_WORKTREE`; corregir entorno y ejecutar preflight nuevo. |
| F4 | `UNKNOWN_WIP` | A `PERMISSION_BLOCKED`; clasificar WIP y ejecutar preflight nuevo. |
| F5 | `RESOURCE_UNAVAILABLE` | De `RESOURCE_CHECK` a `RESOURCE_BLOCKED`; recheck con evidencia de cambio. |
| F6 | `ENVIRONMENT_FAILURE` | A `ENVIRONMENT_BLOCKED`; reparar entorno/harness antes de un ciclo nuevo. |
| F7 | `HARNESS_FAILURE` | A `ENVIRONMENT_BLOCKED`; no cuenta como fallo de hipótesis si está demostrado. |
| F8 | `EXECUTION_FAILURE` | A `RETRY_DECISION`; retry solo bajo la política de ciclos, o `FAILED`. |
| F9 | `EVIDENCE_INTEGRITY_FAILURE` | A `CODEX_ESCALATION_REQUIRED`; no ingerir ni retry automático. |
| F10 | `VALIDATION_FAILURE` | A `RETRY_DECISION` si la causa está demostrada; si no, `CODEX_ESCALATION_REQUIRED`. |
| F11 | `REVIEW_BLOCKING_FINDING` | A `CODEX_REVIEW_REQUIRED`, `REJECTED` o nuevo ciclo autorizado según severidad. |

Toda falla registra código, estado origen/destino, hechos, evidencia, causa demostrada o no, contador de ciclo y acción autorizada. Las fallas F2–F7 ambientales no consumen un intento de modelo cuando se demuestra que ocurrieron antes de ejecución útil.

## 11. Evidence pack y métricas mínimas

Un `EVIDENCE_PACK` contiene `schema_version`, IDs de tarea/run/ciclo/intento, timestamps, manifest revision/digest, repo/worktree/commit, WIP antes/después, rol/modelo, permisos, comandos, resultados con exit code, archivos/diffs con digests, gates, fallas, revisiones, chain digest y estado final.

Métricas mínimas: duración por gate/run, ciclos e intentos por modelo, tokens/costo cuando el proveedor los exponga, conteo F1–F11, pruebas pass/fail/pending, cambios por archivo, bytes de evidencia, WIP y veredicto. La ausencia de una métrica opcional es `null`, nunca un valor inventado.

## 12. Compatibilidad con OpenCode Desktop

Objetivo exacto de RC1: OpenCode Desktop/OpenCode `1.18.18`. Se conservan `.opencode/agents` y `.opencode/commands`. `.opencode/tools` solo puede declararse cuando existan tools reales requeridos; esta fase no lo declara ni crea placeholders. `.agents/skills` es la única fuente canónica y `.opencode/skills` se rechaza para evitar duplicación. El contrato no elimina, reemplaza ni hace cutover fuera de OpenCode Desktop.

## 13. Decisiones cerradas y prerequisitos de cutover

No quedan preguntas abiertas para iniciar el laboratorio: ciclos, Resource Check, F1–F11, routing estable, canonical skills, Codex externo, atomicidad, revisión GLM condicional y WIP quedaron decididos.

Antes de cualquier cutover se requieren: Fases de laboratorio completas; schemas versionados; state machine persistente; permisos enforceables; escritura atómica y recuperación probadas; delegación e independencia verificadas; Codex handoff/ingestion probado; Resource Check; gates; F1–F11; evidence/metrics; compatibilidad 1.18.18; pruebas de fallo/crash/idempotencia; auditoría independiente; rollback ensayado; autorización explícita del propietario. `READY_FOR_INFRA_LAB` no implica autorización de cutover.

## 14. Alcance implementable en Fase 1

Fase 1 implementa únicamente la estructura aislada, el schema estricto inicial, validación de referencias/paths/variables/duplicados/SHA-256/canonical skills y pruebas sintéticas. Quedan expresamente fuera `orch_run`, `orch_delegate`, `orch_write`, `orch_test`, `orch_evidence`, la máquina completa de estados, Codex handoff, crash recovery, Resource Check completo y routing real de modelos.
