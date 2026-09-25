# AGENTS.md — Modos de trabajo del proyecto Nuevo Amanecer

## Regla principal

La solicitud explícita actual del propietario es la máxima autoridad para tareas normales de desarrollo del producto.

## Selección de agente OpenCode

Antes de actuar, identifica una sola zona y no mezcles permisos:

- **CANON** → `pos-canon-implementer`: producto `POS/**` y código CANON versionado dentro del alcance autorizado. No deploy ni remote por defecto.
- **LAB** → `pos-lab-implementer`: solo `laboratorio/**` y pruebas LAB permitidas.
- **SHADOW legacy** → `pos-implementer`: el nombre se conserva por compatibilidad con `MANIFEST.yaml`, pero `PRODUCT_WRITE = DENIED`.
- **PLANNER** → `pos-planner`: READ-ONLY; declara CANON/LAB/SHADOW.
- **REVIEWER** → `pos-reviewer`: READ-ONLY independiente.
- **TESTER** → `pos-tester`: TEST-ONLY; no modifica expectativas.

La referencia corta es `.opencode/ROLE_MAP.md`.

Navegación del repositorio: `REPO_MAP.yaml`. Estado vigente de la línea V1.3:
`docs/V1.3_STATUS.md`. Los documentos de gates, freezes, snapshots y evidence
son evidencia histórica o específica de una fase y no sustituyen esas fuentes.

Comandos:
- CANON: `/canon-preflight`, `/canon-validate`.
- LAB: `/lab-preflight`, `/lab-validate`.
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

## Laboratorio y promoción a CANON

- `laboratorio/` es la zona general de experimentación del POS.
- `tools/cloudflare-lab/` conserva su función separada de laboratorio de infraestructura.
- Los experimentos importantes usan ramas `lab/<nombre>`.
- LAB no usa autoridad comercial de producción, credenciales de producción en cliente/repositorio ni escrituras de producción.
- Los datos comerciales reales pueden existir **solo** como copia aislada dentro de D1 LAB cuando provienen del flujo autorizado `CANON -> backup R2 -> D1 LAB`; nunca se versionan en Git/HTML/fixtures/evidence ni convierten LAB en autoridad CANON.
- Los fixtures y pruebas unitarias usan datos sintéticos por defecto. GitHub Actions Secrets cifrados pueden usarse en workflows autorizados; sus valores nunca se versionan, imprimen ni exponen al navegador.
- `POS/` nunca debe depender en runtime de archivos bajo `laboratorio/`.
- Un experimento aprobado se promueve como parche mínimo revisado hacia `POS/`; nunca se sobrescribe CANON con todo LAB.
- Antes de promover: ejecutar `node laboratorio/check.mjs`, pruebas funcionales aplicables, revisar diff y definir rollback.
- Ver `docs/LABORATORIO_A_CANON.md` para el contrato durable.


## Preflight obligatorio para POS-LAB

Esta regla aplica a **ALL_WRITERS** sin excepción: ChatGPT, ChatGPT Work, conector GitHub, OpenCode, Claude, DeepSeek, Codex, agentes futuros y humanos asistidos por IA.

Antes del **primer cambio funcional** en LAB:
1. leer este archivo;
2. leer `.agents/skills/impact-analysis/SKILL.md`;
3. leer `.agents/skills/cross-module-impact/SKILL.md`;
4. leer `.agents/skills/lab-scope-guard/SKILL.md`;
5. leer la skill específica (`lab-ui-edit`, `lab-animation-edit` o `lab-feature-edit`);
6. leer `laboratorio/pos-lab/UI_MAP.yaml` cuando aplique a POS-LAB;
7. leer/crear el contrato JSON schema v3 de la tarea y verificar `allowed_files`;
8. registrar un recibo `laboratorio/pos-lab/preflight/<TASK_ID>.json` con hashes de las skills y análisis de READS, WRITES, DOM, STATE, STORAGE, invariantes, impacto cruzado, riesgos, rollback y pruebas;
9. ejecutar `node laboratorio/pos-lab/skill-preflight.mjs --task=<contrato> --receipt=<recibo>`;
10. obtener `SKILL_PREFLIGHT_PASS`.

**NO SKILL_PREFLIGHT_PASS → NO WRITE.**

El Task Contract y el recibo deben estar versionados en Git **antes** del primer commit que cambie código/infraestructura LAB. En Pull Requests, CI verifica ese orden temporal. Crear o completar el preflight después de editar no satisface el gate.

Reglas duras:
- una tarea LAB no escribe `POS/**`;
- `laboratorio/pos-lab/index.html` es generado y no se edita manualmente para cambios normales;
- cambios de pantalla se realizan en `sections/` y capas `styles/` / `animations/`;
- ningún writer puede ampliar su propia allowlist;
- el gate aplica también cuando el writer opera mediante ChatGPT o el conector GitHub;
- cambios LAB protegidos se realizan en rama + Pull Request; no se usa push directo a la rama activa para saltar el orden temporal;
- al terminar ejecutar build/check, tests LAB, scope guard y revisar diff;
- cualquier archivo fuera de alcance convierte el resultado en FAIL;
- la promoción a CANON requiere la skill `canon-promotion` y aprobación explícita del owner.
