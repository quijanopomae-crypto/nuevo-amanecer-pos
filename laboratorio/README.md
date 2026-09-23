# Laboratorio — Nuevo Amanecer

Este directorio es la zona aislada para experimentar sin modificar el POS canónico en `POS/`.

## Regla principal

```text
LABORATORIO -> validar -> revisar diff -> aprobar -> promover cambio mínimo -> POS/
```

Un experimento NO es producción y nunca obtiene autoridad comercial por existir aquí.

## Fronteras obligatorias

- No usar datos comerciales reales.
- No guardar SYNC_TOKEN, READ_TOKEN, API keys, PIN, contraseñas, cookies ni credenciales.
- No apuntar prototipos a endpoints de escritura de producción.
- No registrar ventas reales, movimientos de caja, créditos ni inventario real.
- `POS/` no puede importar ni depender en runtime de archivos bajo `laboratorio/`.
- Un prototipo aprobado se promueve como un cambio mínimo revisado; no se copia todo el laboratorio encima de `POS/`.
- Todo trabajo experimental importante usa una rama `lab/<nombre>`.
- La promoción a CANON requiere pruebas, revisión del diff y rollback definido.

## Estructura

- `experimentos/`: prototipos y pruebas aisladas.
- `fixtures/`: datos sintéticos exclusivamente.
- `evidence/`: evidencia de pruebas del laboratorio, sin datos reales.
- `plantilla-experimento/`: contrato mínimo para iniciar un experimento.
- `LAB_POLICY.json`: política legible por herramientas.
- `check.mjs`: guardia local de fronteras LAB/CANON.

## Comprobación

Desde la raíz del repositorio:

```powershell
node laboratorio/check.mjs
node --test tests/laboratorio-boundary.test.mjs
```

El resultado esperado del primer comando es `LAB_BOUNDARY_PASS`.

## Promoción

La política completa está en `docs/LABORATORIO_A_CANON.md`.
