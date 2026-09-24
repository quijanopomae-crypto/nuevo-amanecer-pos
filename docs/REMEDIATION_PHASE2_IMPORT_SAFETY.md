# Remediación de auditoría — Fase 2: importación CANON -> LAB segura

- **Base autorizada:** `5142892e4131a621867e6b01dfdf43f5e0f492c9`
- **Rama objetivo:** `feature/v1.3-mobile-cloud`
- **Origen:** auditorías Work + Perplexity del 24-09-2026.
- **Hallazgos Work cubiertos:** H04, H10, H16.
- **H13:** queda pendiente de una fase de seguridad porque requiere separar secretos y aprovisionar valores nuevos.
- **Tipo de cambio:** validación fail-closed, CI y documentación; sin cambios de `POS/**`.

## Objetivo

Impedir que un SQL CANON llegue a D1 LAB si su manifiesto no demuestra procedencia e integridad, y evitar que un deploy remoto empiece antes de validar el backup que va a importar.

## Contrato de manifiesto aceptado

El par `.sql + .manifest.json` solo se acepta si el manifiesto:

1. usa formato `nuevo-amanecer-d1-backup-v1`;
2. tiene `status: PASS`;
3. identifica la base CANON esperada;
4. contiene bookmark;
5. referencia exactamente el `sql_key` descargado;
6. declara tamaño igual a los bytes descargados;
7. declara SHA-256 igual al SQL descargado.

Cualquier ausencia o diferencia detiene el flujo antes de escritura remota.

## Alcance real del snapshot

El conversor actual reconstruye únicamente:

- productos;
- clientes;
- créditos;
- pagos de crédito.

Por diseño deja vacíos:

- ventas;
- gastos;
- movimientos de caja;
- cierres;
- movimientos de inventario.

Esto debe declararse como snapshot parcial, no como espejo comercial completo.

## Gate remoto

Los workflows manuales de refresh/deploy:

- deben ejecutarse desde el HEAD vigente de `feature/v1.3-mobile-cloud`;
- deben correr tests de contrato;
- en deploy, deben descargar/verificar/convertir el backup **antes** de migraciones D1, deploy Worker o cualquier otra escritura remota;
- publican únicamente el snapshot ya prevalidado.

## Prohibido

- modificar `POS/**`;
- tocar producción;
- rotar secrets;
- crear migraciones nuevas;
- ampliar el snapshot a familias financieras sin especificación separada.

## Validación

- `node --test tools/cloudflare-lab/test/canon-backup-manifest.test.mjs`
- `python3 -m unittest tools/cloudflare-lab/test/test_lab_snapshot_from_sql.py`
- `node --test tests/laboratorio-remote-preflight-order.test.mjs`
- `node --test tests/laboratorio-*.test.mjs`
- LAB cloud CI;
- diff sin `POS/**`.
