# WORK V1.3: reconciliación de #1079, causa del E2E fallido y estado

Fecha: 2026-10-27 (America/Lima). **Sin merge, sin despliegue, sin tocar datos de producción ni Worker.**
Base: CANON `50840635b6f89d1d63b8bd4934e8a5382a64a1d4` (HEAD consultado el 27/10/2026).

## Cómo se evita la duplicación

- Este PR **reutiliza** el diff de #1079 (`15e5dcd..fa9b0008`: `POS/index.html`, `POS/js/work-host.js`, `POS/work/work-canon-bridge.js`, `tests/e2e/work-default.spec.ts`, `tests/work/work-interface.test.mjs`, `docs/reviews/work-primary-ui-20261026.json`), aplicado limpio sobre el HEAD actual sin reescribir historia. No hay host, puente ni asistente nuevos.
- Reutiliza la auditoría de #1084 (`docs/reviews/work-ui-v13-auditoria-20261027.md`).
- #1052 no se integra (mismo objetivo, base obsoleta). Si este PR se acepta, #1079 queda redundante y puede cerrarse; no deben fusionarse ambos.
- Limitación: este entorno no puede empujar a la rama de #1079; por eso se incorpora su trabajo aquí.

## E2E fallido de #1079 (run 40422143936, `compras-factura-duplicada.spec.ts:76`, empleado)

- Los commits anteriores de #1079 (`fe08cb42`, `686ccb7f`) pasaron E2E; `fa9b0008` solo añadió un JSON de revisión. Ese commit no toca compras.
- **Reproducido con datos sintéticos sobre CANON puro (sin cambios de #1079): 14 de 15 ejecuciones fallan** con «Revisa la línea 1…» en vez del aviso de documento. **No es regresión de #1079: es fallo preexistente de fixture (carrera).**
- Causa: para el empleado, `cache-identity-guard.js` purga la identidad al confirmarse el rol y después `refreshFull` repuebla el catálogo. La prueba cargaba `productos` justo tras `NA_ROLES.confirmed`; si la purga/lectura llegaba después, la línea no encontraba el producto. (Los 8 «flaky» del mismo run son empleados con la misma carrera; no se tocaron.)
- Corrección mínima (solo prueba, sin debilitar aserciones): `setup()` espera a que `na_cache_identity_v1` quede `why==='confirmed'` con el rol esperado antes de cargar el catálogo. Resultado: 210/210 con `--repeat-each=15` (antes 14 fallos solo en esa prueba).

## Regresión real hallada en #1079 (no cubierta por CI)

Las pruebas `tests/work/*.test.mjs` **no están en el CI crítico**. Aplicado #1079, fallaban 7:

- `work-pre-flicker`: aseguraba que `?work=0` no marcaba la precarga. El contrato cambió a propósito (en producción `?work=0` ya no expone el Inicio heredado): se actualiza para exigir la marca y se mantiene el resto de casos.
- `work-capacidad` (6 pruebas de «cerrar WORK a mitad»): simulaban `na-work:close` con la configuración hospedada, que ahora se ignora. El fixture pasa a modo `?work=1` local (donde el cierre sigue permitido y lógica de tarjeta en vuelo idéntica) y se añade una prueba que exige que en modo hospedado `na-work:close` **no** cierra WORK.
- Resultado: `tests/work/*.test.mjs` 134/134.

## Referencia visual

`Nuevo_Amanecer_WORK_Vista_Previa.html` **no está en el repositorio**. No hay comparación visual fiable; la referencia provisional es `POS/work/index.html`. Sin capturas antes/después.

## Estado

| Estado | Detalle |
| --- | --- |
| IMPLEMENTADO | WORK como único Inicio hospedado (de #1079); `?work=0` y `na-work:close` no reabren el Inicio heredado; retirado «Volver al POS»; `#pageMenu` se conserva como DOM interno. Fixture del E2E de compras sin carrera. |
| PROBADO | `tests/work/*.test.mjs`, `tests/asistente/*`, `tests/repo-map.test.mjs`, `tests/security-secret-separation.test.mjs`; E2E `work-*.spec.ts` (9/9) y `compras-factura-duplicada.spec.ts` ×15. Ver CI del SHA final. |
| PENDIENTE | Comparación visual con el HTML de referencia; E2E autenticado real con CANON; Chrome Android y anchos 320–1920; Flash/Pro/Ultra (solo visual, sin enrutamiento real comprobado); adjuntos (solo vista previa local); voz por turnos con fallback, no Live; flakiness de otras pruebas de empleado (misma carrera de identidad). |
| BLOQUEADO | Publicación: requiere «Aprobado al canon» del dueño; no se publicó ni fusionó. |

## Reversión

Revertir este PR (un solo `git revert` del merge) restaura el comportamiento previo; no hay migraciones, Worker, BD ni outbox involucrados.
