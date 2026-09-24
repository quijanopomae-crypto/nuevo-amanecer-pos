# Remediación — Fase 4A: task guards LAB

- Base: `07952120f3aa2daeacec425f7eac870dae5fe796`
- Hallazgos Work: **H24, H25, H26**
- Alcance: validadores/contratos LAB únicamente.

## Cambios

1. `scope-guard.mjs` incluye archivos untracked mediante `git ls-files --others --exclude-standard`.
2. El guard valida campos ejecutables del contrato y conserva compatibilidad con contratos históricos schema v1 seguros.
3. Los contratos nuevos usan schema v2 con fronteras explícitas de datos, credenciales, producción y CANON.
4. `validate-lab.mjs` solo declara `LAB_VALIDATE_PASS` cuando se suministra un contrato y el scope guard pasa.
5. `--skip-scope` es diagnóstico explícito y produce `LAB_VALIDATE_PARTIAL`, nunca PASS.

## Invariantes

- `POS/**` continúa prohibido en tareas LAB.
- Ningún contrato puede autoampliar su allowlist.
- Un archivo nuevo no trackeado cuenta como cambio y debe estar autorizado.
- Una validación sin comprobación de alcance no puede presentarse como completa.

## Validación

```powershell
node --test tests/laboratorio-scope-guard.test.mjs
node laboratorio/pos-lab/validate-lab.mjs --task=laboratorio/pos-lab/tasks/LAB-TASK-GUARDS-REMEDIATION-001.json
```

No hay cambios de runtime CANON, D1, R2, Worker ni secrets.
