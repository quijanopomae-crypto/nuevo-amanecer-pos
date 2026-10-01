# CANON PWA Update Action — CANON-PWA-UPDATE-001

## Estado
APROBADO por solicitud explícita del owner el 2026-10-01.

## Base
- Rama objetivo: `feature/v1.3-mobile-cloud`
- Base SHA: `686dfa96d05fb6ec068fee881ca66ac9e0c4c56d`
- Zona: CANON `POS/**`
- LAB queda fuera de alcance.

## Objetivo único
Cuando Chrome detecte una versión nueva del shell PWA de Nuevo Amanecer, mostrar una ventana visible con el botón **Actualizar ahora**. El botón debe ejecutar una actualización real del Service Worker, activar el worker preparado y recargar una sola vez cuando tome control.

La actualización normal debe ser más rápida: los binarios pesados e inmutables de Tesseract/OCR no deben bloquear cada instalación de una nueva versión del shell.

## Comportamiento actual observado
- `POS/index.html` registra `sw.js`, ejecuta `registration.update()` y emite `na:version-update-pending`.
- El estado del encabezado puede indicar `Nueva versión pendiente`, pero no existe un botón de actualización accionable.
- `POS/sw.js` usa `skipWaiting()` durante `install`, por lo que el usuario no controla el momento de aplicar la nueva versión.
- El precache del shell incluye los binarios de Tesseract/OCR, de varios MB, y por tanto los vuelve parte del camino crítico de cada nuevo cache de build.

## Resultado esperado
1. Una nueva versión detectada muestra un aviso móvil/desktop con:
   - `Nueva versión disponible`
   - estado de progreso
   - botón `Actualizar ahora`.
2. Al pulsar el botón:
   - se fuerza `registration.update()`;
   - se espera al worker si todavía está instalando;
   - se envía `NA_ACTIVATE_UPDATE` al worker preparado;
   - el worker ejecuta `skipWaiting()`;
   - `controllerchange` provoca una sola recarga.
3. Si falla, el aviso muestra `Reintentar`.
4. La primera transición desde el shell legacy se autoactiva una sola vez para evitar dejar usuarios antiguos atrapados sin botón; al cargar el nuevo shell se habilita el modo manual persistente para actualizaciones siguientes.
5. La instalación de una nueva build no espera la descarga de los binarios pesados de OCR.
6. Los recursos OCR siguen disponibles mediante caché lazy independiente y estable.
7. No se modifican ventas, inventario, caja, créditos, persistencia, OUTBOX ni APIs CANON.

## Archivos permitidos
- `docs/CANON_PWA_UPDATE_ACTION.md`
- `POS/index.html`
- `POS/css/components.css`
- `POS/sw.js`
- `tests/product-fixes/fix-pwa-update-action/canon-pwa-update-action.test.mjs`
- `tests/cloud-sync/v1.3-pos-web-deploy.test.mjs`

## Archivos prohibidos
- `laboratorio/**`
- `tools/cloudflare-lab/**`
- `tools/cloudflare-prod/**`
- `infra/**`
- módulos de ventas/inventario/caja/créditos
- workflows, secrets y despliegues

## Riesgos y mitigación
- **Recarga durante uso:** solo ocurre tras acción explícita del usuario.
- **Doble recarga:** guard de recarga única en la página.
- **Worker todavía instalando:** se espera estado `installed` antes de activar.
- **OCR offline:** recursos pesados pasan a caché lazy independiente; una vez descargados permanecen cacheados entre builds.

## Pruebas obligatorias
- Prueba focalizada de contrato PWA.
- Regresiones CANON Critical CI.
- E2E Smoke CI.
- Revisión del diff.
- Confirmar que no se tocó LAB.

## Rollback
Revertir el commit/PR de esta tarea. No hay migraciones, cambios de datos ni escrituras remotas.

## Fuera de alcance
- Deploy/cutover de producción.
- Cambios de datos o infraestructura.
- Rediseños de otros módulos.
