# AGENTS.md — Modos de trabajo del proyecto Nuevo Amanecer

## Regla principal

La solicitud explícita actual del propietario es la máxima autoridad para tareas normales de desarrollo del producto.

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
- LAB no usa datos comerciales reales, credenciales de producción ni escrituras de producción.
- `POS/` nunca debe depender en runtime de archivos bajo `laboratorio/`.
- Un experimento aprobado se promueve como parche mínimo revisado hacia `POS/`; nunca se sobrescribe CANON con todo LAB.
- Antes de promover: ejecutar `node laboratorio/check.mjs`, pruebas funcionales aplicables, revisar diff y definir rollback.
- Ver `docs/LABORATORIO_A_CANON.md` para el contrato durable.
