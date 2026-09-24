# Remediación de auditoría — Fase 1: políticas y fuentes de verdad

- **Base autorizada:** `1aeb998cf0504d4fb6700cf681bc10c130e28a85`
- **Rama objetivo:** `feature/v1.3-mobile-cloud`
- **Origen:** auditorías independientes Work + Perplexity del 24-09-2026.
- **Hallazgos Work cubiertos:** H03, H19, H20, H36.
- **Tipo de cambio:** gobernanza/documentación/guardas; sin cambios de runtime comercial ni datos.

## Objetivo

Unificar la interpretación de CANON, LAB, datos reales aislados y secretos para que humanos, OpenCode y skills no reciban reglas contradictorias.

## Invariantes

1. `POS/**` no depende en runtime de `laboratorio/**`.
2. LAB no puede escribir en producción ni adquirir autoridad CANON.
3. Los datos comerciales reales no se versionan en Git, HTML, fixtures, evidence ni logs.
4. Una copia real puede existir únicamente en D1 LAB aislada cuando proviene del flujo autorizado `CANON -> backup R2 -> D1 LAB`.
5. Fixtures y unit tests usan datos sintéticos por defecto.
6. GitHub Actions Secrets cifrados pueden usarse en workflows autorizados; sus valores jamás se versionan ni exponen al navegador.
7. Shadow mode solo aplica cuando se invoca explícitamente.

## Archivos permitidos

- `AGENTS.md`
- `AGENTS_Nuevo_Amanecer.md`
- `opencode.json`
- `laboratorio/LAB_POLICY.json`
- `laboratorio/README.md`
- `laboratorio/check.mjs`
- `laboratorio/pos-lab/UI_MAP.yaml`
- `.agents/skills/lab-feature-edit/SKILL.md`
- `.agents/skills/lab-scope-guard/SKILL.md`
- `docs/LABORATORIO_A_CANON.md`
- `docs/LAB_CANON_MIRROR.md`
- `tests/laboratorio-policy-contract.test.mjs`
- este documento.

## Prohibido

- modificar `POS/**`;
- desplegar Worker, D1 o R2;
- cambiar valores de secrets;
- borrar ramas/archivos históricos;
- promover código LAB a CANON.

## Validación requerida

- `node laboratorio/check.mjs`
- `node --test tests/laboratorio-boundary.test.mjs tests/laboratorio-policy-contract.test.mjs`
- `node laboratorio/pos-lab/build-lab.mjs --check`
- `node --test tests/laboratorio-*.test.mjs`
- diff sin `POS/**`.
