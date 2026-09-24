# Laboratorio — Nuevo Amanecer

Este directorio es la zona aislada para experimentar sin modificar el POS canónico en `POS/`.

## Regla principal

```text
LABORATORIO -> validar -> revisar diff -> aprobar -> promover cambio mínimo -> POS/
```

Un experimento NO es producción y nunca obtiene autoridad comercial por existir aquí.

## Fronteras obligatorias

- No versionar, incrustar en HTML/fixtures/evidence ni publicar datos comerciales reales.
- D1 LAB puede contener una copia real aislada procedente del flujo autorizado `CANON -> backup R2 -> D1 LAB`; esa copia sigue siendo LAB y nunca autoridad CANON.
- Los fixtures y pruebas unitarias usan datos sintéticos por defecto.
- No guardar en Git, HTML, logs o cliente valores de SYNC_TOKEN, READ_TOKEN, API keys, PIN, contraseñas, cookies ni credenciales. GitHub Actions Secrets cifrados sí pueden usarse en workflows autorizados.
- No apuntar prototipos a endpoints de escritura de producción.
- No registrar operaciones reales de negocio en producción desde LAB; cualquier venta, caja, crédito o inventario modificado en D1 LAB es únicamente experimental.
- `POS/` no puede importar ni depender en runtime de archivos bajo `laboratorio/`.
- Un prototipo aprobado se promueve como un cambio mínimo revisado; no se copia todo el laboratorio encima de `POS/`.
- Todo trabajo experimental importante usa una rama `lab/<nombre>`.
- La promoción a CANON requiere pruebas, revisión del diff y rollback definido.

## Estructura

- `pos-lab/`: copia completa y aislada del HTML del POS para desarrollar funciones nuevas sin editar CANON.
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
