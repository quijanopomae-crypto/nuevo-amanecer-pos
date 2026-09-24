# Contratos de tarea LAB

Cada modificación del POS-LAB debe tener un contrato JSON derivado de `../LAB_TASK.example.json`.

## Schema vigente

Los contratos nuevos usan `schema_version: 2` y deben declarar:

- `task_id`, `environment=LABORATORIO`, `base_ref` y `objective`;
- `allowed_files` y `forbidden_files`;
- `required_skills`;
- `production_data_authority=false`;
- `isolated_d1_data_allowed=true|false` según la tarea;
- `production_credentials=false`;
- `production_writes=false`;
- `canon_writes=false`.

`isolated_d1_data_allowed=true` no autoriza versionar datos reales: solo permite que la tarea interactúe con la copia aislada ya autorizada dentro de D1 LAB.

Los contratos schema v1 históricos siguen siendo legibles por el guard cuando usan los aliases antiguos seguros, pero no deben copiarse para tareas nuevas.

## Regla de alcance

No reutilices un contrato para ampliar una tarea. Si cambia el alcance, crea o actualiza el contrato antes de escribir.

La validación completa siempre se ejecuta con:

```powershell
node laboratorio/pos-lab/validate-lab.mjs --task=laboratorio/pos-lab/tasks/<TAREA>.json
```

Ejecutar `validate-lab.mjs` sin contrato ya no puede producir `LAB_VALIDATE_PASS`. `--skip-scope` existe únicamente para diagnóstico parcial y devuelve `LAB_VALIDATE_PARTIAL`.
