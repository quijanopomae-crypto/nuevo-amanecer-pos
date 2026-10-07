# AGENTS.md — Modos de trabajo del proyecto Nuevo Amanecer

## Estado operativo del propietario

**CANON_DEFAULT = true**
**POS_LAB_RETIRED = true**
**BRANCH_PREVIEW_REQUIRED = true**

CANON es la única fuente funcional del producto. El antiguo POS-LAB deja de ser una zona de desarrollo activa.

Toda tarea normal del POS debe ejecutarse así:

1. partir del HEAD vigente de `feature/v1.3-mobile-cloud`;
2. crear una rama aislada `feature/*`, `fix/*`, `perf/*` o `arch/*`;
3. modificar únicamente el alcance autorizado;
4. ejecutar pruebas focalizadas y regresiones;
5. abrir Draft PR;
6. exigir CANON Critical CI + E2E Smoke CI cuando apliquen;
7. revisión independiente Reviewer/Forensic;
8. preview temporal del mismo SHA cuando la validación visual o de navegador sea necesaria;
9. solicitar autorización del owner antes de merge/deploy;
10. borrar la rama después del merge.

No existe promoción LAB -> CANON para trabajo nuevo.

## Regla principal

La solicitud explícita actual del propietario es la máxima autoridad para tareas normales de desarrollo del producto.

## Zonas y agentes

- **CANON** → `pos-canon-implementer`: producto `POS/**` y código CANON versionado dentro del alcance autorizado. No deploy remoto por defecto.
- **PREVIEW DE RAMA** → no es otra copia del producto: sirve exactamente el SHA del Draft PR/candidato.
- **POS-LAB histórico** → retirado. `laboratorio/pos-lab/**` no es destino de nuevas escrituras ni fuente de promoción.
- **SHADOW legacy** → `pos-implementer`: solo infraestructura/evidence shadow; `PRODUCT_WRITE = DENIED`.
- **PLANNER** → `pos-planner`: READ-ONLY.
- **REVIEWER** → `pos-reviewer`: READ-ONLY independiente.
- **TESTER** → `pos-tester`: TEST-ONLY; no cambia expectativas para fabricar PASS.

La referencia corta es `.opencode/ROLE_MAP.md`.

## Seguridad Git

Antes y después de cambios:

- confirmar rama y HEAD;
- `git status --short`;
- pruebas focalizadas;
- regresiones relevantes;
- `git diff --check`;
- revisar diff completo.

Prohibido en una rama de trabajo sin autorización separada:

- merge a CANON;
- deploy de producción;
- force-push;
- cambios de secrets;
- migraciones remotas;
- borrar datos;
- ocultar o saltar tests fallidos.

## Gates de rama

Un candidato solo puede solicitar merge cuando:

- el diff corresponde al alcance;
- CANON Critical CI está verde cuando aplica;
- E2E Smoke CI está verde cuando aplica;
- Reviewer no tiene P0/P1 abiertos;
- Forensic confirma integridad de datos/rutas sensibles;
- el preview, si se exige, ejecuta el mismo SHA revisado.

Un fallo de CI se clasifica primero como **REGRESIÓN REAL** o **TEST OBSOLETO**. No se debilitan assertions sin reemplazarlas por invariantes equivalentes o más fuertes.

## Retiro de POS-LAB

El POS-LAB activo queda retirado.

- no crear ramas `lab/*`;
- no ejecutar `/lab-preflight` ni `/lab-validate`;
- no publicar GitHub Pages LAB;
- no ejecutar deploy/refresh remoto LAB;
- no usar `laboratorio/pos-lab/**` como fuente de verdad;
- `POS/**` nunca depende en runtime de `laboratorio/**`.

Los contratos/evidence históricos pueden conservarse como auditoría hasta una limpieza posterior explícita.

**Importante:** `tools/cloudflare-lab/**` NO se borra por nombre. Parte de ese árbol contiene hoy el Worker/backend y harnesses usados también por CANON/producción. Su renombre o partición requiere una migración separada con pruebas.

Documentos vigentes:

- `docs/BRANCH_PREVIEW_WORKFLOW.md`
- `docs/LAB_RETIREMENT.md`
- `REPO_MAP.yaml`
- `docs/V1.3_STATUS.md`
- `AGENTS_Nuevo_Amanecer.md`

Los documentos LAB anteriores pasan a ser evidencia histórica y no habilitan un flujo LAB nuevo.

## Shadow mode legacy

El shadow mode sigue disponible únicamente cuando una tarea lo invoque explícitamente.

En shadow mode:

- `PRODUCT_WRITE = DENIED`;
- solo puede escribir infraestructura/evidence según su contrato;
- no gobierna automáticamente tareas normales del POS.
