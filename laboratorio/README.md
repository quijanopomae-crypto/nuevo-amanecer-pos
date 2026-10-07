# Laboratorio — RETIRADO

El laboratorio permanente ya no es un entorno activo de desarrollo del POS.

## Estado

`POS_LAB_RETIRED = true`

Toda funcionalidad nueva se desarrolla desde CANON en una rama aislada y se valida mediante Draft PR + CI + preview temporal del mismo SHA.

Este árbol se conserva únicamente como archivo histórico mientras termina la limpieza documental controlada.

## Prohibido

- nuevas ramas `lab/*`;
- nuevas escrituras funcionales bajo `laboratorio/pos-lab/**`;
- publicación de POS-LAB por GitHub Pages;
- deploy o refresh remoto LAB;
- promoción LAB -> CANON;
- tratar contratos/preflights históricos como gates vigentes.

## Conservación temporal

Pueden permanecer Task Contracts, preflights, snapshots y assets antiguos para auditoría/referencia. Su presencia no reactiva LAB.

El flujo vigente está en:

- `docs/BRANCH_PREVIEW_WORKFLOW.md`
- `docs/LAB_RETIREMENT.md`
- `AGENTS.md`
