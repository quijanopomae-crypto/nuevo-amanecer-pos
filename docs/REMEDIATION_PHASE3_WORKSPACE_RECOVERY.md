# Remediación de auditoría — Fase 3: recuperación e idempotencia del workspace LAB

- **Base autorizada:** `4b526e656592acd49d30297f771956c43b3af3ae`
- **Rama objetivo:** `feature/v1.3-mobile-cloud`
- **Origen:** auditorías Work + Perplexity del 24-09-2026.
- **Hallazgos Work cubiertos:** H05, H06, H07, H14, H15, H41.
- **Tipo de cambio:** LAB-only; no modifica `POS/**` ni producción.

## Objetivo

Evitar pérdida o duplicación de intención cuando:
- se pierde el ACK de un save;
- se recarga el navegador con cambios locales pendientes;
- D1 responde después de una edición temprana;
- un writer es revocado entre autenticación y commit;
- se intenta resetear con una revisión obsoleta.

## Contrato

1. Una intención LAB conserva el mismo `operation_id`, `expected_revision` y snapshot hasta ACK.
2. La operación pendiente se persiste localmente antes del POST remoto.
3. Un snapshot D1 nunca pisa una intención local pendiente.
4. Una edición hecha antes de conocer la revisión D1 queda marcada pendiente y se envía después de resolver la revisión remota.
5. El servidor no introduce campos volátiles en el hash de un replay de LAB_SAVE.
6. El commit de save/reset exige que el mismo dispositivo siga siendo writer activo y conserve la misma credencial.
7. Reset exige `expected_revision` y falla cerrado ante revisión distinta.

## Archivos permitidos

- `tools/cloudflare-lab/src/lab-workspace.js`
- `tools/cloudflare-lab/test/lab-workspace.test.mjs`
- `laboratorio/pos-lab/js/lab-workspace.js`
- `laboratorio/pos-lab/tasks/LAB-WORKSPACE-RECOVERY-REMEDIATION-001.json`
- `tests/laboratorio-workspace-recovery.test.mjs`
- `docs/LAB_CANON_MIRROR.md`
- este documento.

## Prohibido

- modificar `POS/**`;
- migraciones D1;
- deploy remoto;
- cambios de secrets;
- limpieza de ramas o histórico.

## Validación

- `node --test tools/cloudflare-lab/test/lab-workspace.test.mjs`
- `node --test tests/laboratorio-workspace-recovery.test.mjs`
- `node --test tests/laboratorio-*.test.mjs`
- `node laboratorio/pos-lab/build-lab.mjs --check`
- `node laboratorio/check.mjs`
- LAB Canon Mirror CI;
- diff sin `POS/**`.
