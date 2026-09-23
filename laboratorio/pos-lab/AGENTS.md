# POS-LAB — instrucciones locales para agentes

Estas reglas aplican a todo archivo bajo `laboratorio/pos-lab/` y son más específicas que las reglas generales del repositorio.

## Antes de modificar

1. Lee `../../AGENTS.md`.
2. Lee `../../.agents/skills/lab-scope-guard/SKILL.md`.
3. Lee la skill específica de la tarea:
   - UI: `lab-ui-edit`
   - animación: `lab-animation-edit`
   - función: `lab-feature-edit`
4. Lee `UI_MAP.yaml`.
5. Lee el contrato JSON de la tarea.
6. Confirma que cada archivo que planeas tocar aparece en `allowed_files`.

## Fronteras duras

- Este directorio es LABORATORIO, no producción.
- No escribir `../../POS/**` desde una tarea LAB.
- No usar datos comerciales reales.
- No usar credenciales ni endpoints de escritura de producción.
- No ampliar la allowlist por iniciativa propia.
- No editar `index.html` manualmente para cambios normales: es generado por `build-lab.mjs`.
- Cambios de estructura visual: `sections/**`.
- Cambios visuales: `styles/**`.
- Animaciones: `animations/**` y `js/motion/**`.
- Una animación jamás controla ventas, inventario, caja, créditos o persistencia.

## Antes de declarar PASS

Ejecuta:
```
node laboratorio/pos-lab/build-lab.mjs --check
node laboratorio/pos-lab/validate-lab.mjs --task=<contrato.json>
git diff --check
git diff
```

Si el scope guard reporta un archivo fuera de alcance, el resultado es FAIL.
Promover a CANON requiere `canon-promotion` y aprobación explícita del owner.
