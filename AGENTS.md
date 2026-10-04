# AGENTS.md — Modos de trabajo del proyecto Nuevo Amanecer

## Estado operativo temporal del propietario

**LAB_TEMPORARILY_DISABLED = true**
**CANON_DEFAULT = true**

Por instrucción explícita del propietario, el laboratorio queda temporalmente fuera de servicio como destino de trabajo para IA, agentes, OpenCode, ChatGPT, Claude, DeepSeek, Codex y cualquier writer asistido.

Hasta que el propietario ordene explícitamente reactivar/habilitar el laboratorio:

- toda tarea normal del POS se interpreta como **CANON**;
- usar `pos-canon-implementer` para cambios funcionales del producto;
- `laboratorio/**` y `tools/cloudflare-lab/**` son **READ-ONLY / FROZEN**;
- no seleccionar `pos-lab-implementer`;
- no ejecutar `/lab-preflight` ni `/lab-validate`;
- no crear contratos, preflights, receipts, ramas ni PRs LAB;
- no desviar una solicitud CANON hacia LAB por seguridad, costumbre, documentación histórica o preferencia del agente;
- si una especificación histórica recomienda LAB, esta orden temporal del propietario prevalece;
- si una tarea requiere realmente reactivar LAB para poder completarse, detenerse e informar al propietario; no reactivarlo por cuenta propia.

El código y la documentación LAB se conservan únicamente como respaldo/referencia reversible. **Desactivar LAB no significa borrarlo ni promoverlo a CANON.**

## Regla principal

La solicitud explícita actual del propietario es la máxima autoridad para tareas normales de desarrollo del producto.

## Selección de agente OpenCode

Antes de actuar, identifica una sola zona y no mezcles permisos:

- **CANON** → `pos-canon-implementer`: producto `POS/**` y código CANON versionado dentro del alcance autorizado. No deploy ni remote por defecto.
- **LAB** → TEMPORALMENTE DESHABILITADO. No usar `pos-lab-implementer` ni escribir `laboratorio/**` / `tools/cloudflare-lab/**` hasta reactivación explícita del propietario.
- **SHADOW legacy** → `pos-implementer`: el nombre se conserva por compatibilidad con `MANIFEST.yaml`, pero `PRODUCT_WRITE = DENIED`.
- **PLANNER** → `pos-planner`: READ-ONLY; durante el freeze temporal debe seleccionar CANON para tareas normales del producto.
- **REVIEWER** → `pos-reviewer`: READ-ONLY independiente.
- **TESTER** → `pos-tester`: TEST-ONLY; no modifica expectativas.

La referencia corta es `.opencode/ROLE_MAP.md`.

Navegación del repositorio: `REPO_MAP.yaml`. Estado vigente de la línea V1.3:
`docs/V1.3_STATUS.md`. Los documentos de gates, freezes, snapshots y evidence
son evidencia histórica o específica de una fase y no sustituyen esas fuentes.

Comandos:
- CANON: `/canon-preflight`, `/canon-validate`.
- LAB: `/lab-preflight`, `/lab-validate` están TEMPORALMENTE DESHABILITADOS y deben redirigir a CANON.
- `/preflight`, `/validate`, `/feature-spec`, `/orchestrate` y `/resume`
  son comandos SHADOW legacy y requieren invocación explícita de SHADOW.

## Modo normal de producto

Cuando una tarea:
- viene explícitamente del propietario;
- tiene una especificación durable bajo docs/;
- trabaja sobre la rama activa del producto;

entonces se permite modificar los archivos expresamente autorizados por esa especificación.

Para estas tareas normales:

- PRODUCT_WRITE está permitido únicamente dentro del alcance autorizado.
- El destino por defecto es CANON mientras `LAB_TEMPORARILY_DISABLED = true`.
- No usar MANIFEST.yaml como gate.
- No usar shadow_write_policy como gate.
- No ejecutar el preflight global de shadow mode.
- No usar orchestrator shadow salvo que el propietario lo solicite explícitamente.
- AGENTS_Nuevo_Amanecer.md gobierna las reglas funcionales y de seguridad.
- La especificación durable en docs/ gobierna el alcance concreto.

## Shadow mode legacy

El shadow mode sigue disponible únicamente cuando una tarea lo invoque explícitamente.

En shadow mode:
- PRODUCT_WRITE = DENIED.
- Solo puede escribir infraestructura/evidence según MANIFEST.yaml.
- Sus agentes, políticas y preflight aplican exclusivamente a tareas shadow.

Shadow mode NO gobierna automáticamente tareas normales del POS.

## Seguridad Git

Antes y después de cambios:
- git status --short
- confirmar rama y HEAD
- pruebas focalizadas
- git diff --check
- revisar diff

No tocar cambios ajenos ni evidence/v1.3 salvo autorización explícita.

## Laboratorio y promoción a CANON — CONGELADO TEMPORALMENTE

Todo este bloque queda suspendido mientras `LAB_TEMPORARILY_DISABLED = true`.

- `laboratorio/` se conserva como zona histórica de experimentación, pero está READ-ONLY.
- `tools/cloudflare-lab/` se conserva como infraestructura histórica LAB, pero está READ-ONLY.
- No iniciar nuevos experimentos LAB.
- No crear ramas `lab/<nombre>` para tareas nuevas.
- `POS/` nunca debe depender en runtime de archivos bajo `laboratorio/`.
- No ejecutar promoción LAB→CANON durante el freeze; los cambios nuevos se implementan y validan directamente en CANON dentro del alcance autorizado.

Las reglas detalladas históricas permanecen documentadas en `docs/LABORATORIO_A_CANON.md`, pero no habilitan escritura mientras este freeze esté activo.

## Preflight POS-LAB — DESHABILITADO TEMPORALMENTE

No ejecutar el preflight LAB ni crear nuevos Task Contracts/receipts mientras `LAB_TEMPORARILY_DISABLED = true`.

Si cualquier writer intenta iniciar trabajo LAB:
1. detener la escritura;
2. informar `LAB_TEMPORARILY_DISABLED`;
3. reclasificar la tarea normal del producto como CANON;
4. usar `pos-canon-implementer` y los comandos CANON;
5. solo esperar una orden explícita del propietario si realmente se necesita reactivar LAB.

Esta regla aplica a **ALL_WRITERS** sin excepción: ChatGPT, ChatGPT Work, conector GitHub, OpenCode, Claude, DeepSeek, Codex, agentes futuros y humanos asistidos por IA.
