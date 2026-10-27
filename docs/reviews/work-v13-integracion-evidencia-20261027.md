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

## Actualización 27/10/2026 (segunda pasada, SHA `9acd70ebe4166a94846f4c74b824a622a7d641b1`)

**Workflows de GitHub:** CANON Critical CI, E2E Smoke CI y Visual Regression de este SHA (y del anterior `47c0448b`) están en `action_required`: **no se ejecutaron**; un mantenedor debe aprobarlos en la pestaña Actions. **No hay CI real de este SHA y no se declara aprobado.**

**`vendedores-mismo-nombre.spec.ts:341`:** aislado pasa 22/22 en 49 s (6 workers no necesarios). En la corrida completa local (982 pruebas, 6 workers, `CI=1`) el runner se quedó inactivo (~2 % CPU) tras los reintentos de esas últimas pruebas, dos veces seguidas, sin emitir el resumen final; no hay evidencia de fallo de la prueba y se interpreta como cuelgue del runner local al cierre (no demostrado). **El E2E completo sigue sin resumen final: PENDIENTE.** Antes del cuelgue hubo reintentos (retry #1) en pruebas de empleado y de rendimiento/visuales bajo carga (cliente-historial-compras, clientes-reporte-deuda, costo-ausente-guion, dark-auditoria-contraste, inventory-thumbnails-scroll, product-image-review, reporte-productos-vencer); su resultado final no se pudo confirmar. Debe decidirlo el E2E Smoke CI oficial.

**Responsivo (capturas en `docs/reviews/capturas-work-20261027/`):** WORK en iframe con `?work=1`, Chromium de escritorio, anchos 320, 360, 390, 430, 768, 1024, 1366 y 1920: `scrollWidth == innerWidth` en los 8 (sin desbordamiento horizontal) y iframe presente. En 390 px se ve un solo Inicio, esfera Aurora, KPIs en 0 sin datos de demostración y «no se mostrarán operaciones de ejemplo». Datos sin sesión: es estado honesto, no datos reales.

**No realizado / no aprobado:** Chrome Android real y teclado virtual; auditoría de accesibilidad (axe/lector); comparación visual contra `Nuevo_Amanecer_WORK_Vista_Previa.html` (no está en el repo); prueba autenticada real de permisos/KPIs/chat con CANON; Visual Regression oficial; CodeQL (agotó el tiempo en la sesión anterior). Permisos empleado/dueño: solo cubiertos por las pruebas existentes (`work-*.spec.ts` 9/9, `tests/work` 134/134), no por una prueba nueva.

**Riesgos:** el E2E completo y CI oficial sin confirmar; Flash/Pro/Ultra y adjuntos siguen sin enrutamiento real; `tests/work/*.test.mjs` no está en el CI crítico (propuesta: añadirlo en un PR aparte).

**Reversión:** `git revert` del merge de este PR; sin migraciones, Worker, BD ni outbox.
