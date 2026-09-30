# CANON — persistencia local de configuración

## Objetivo

Permitir que la sección **Configuración** del CANON guarde sus ajustes de forma rápida y durable en el navegador y que esos ajustes sobrevivan una recarga, sin abrir la persistencia comercial legacy ni debilitar la autoridad D1/CANON.

## Estado observado

1. `isModuleLocked('configuracion')` devuelve `true` automáticamente cuando CANON está activo, aunque Control Maestro muestre cero módulos protegidos.
2. El wrapper de `guardarConfig()` muestra **“Configuración general protegida”** y detiene la acción.
3. Incluso si se omite ese guard, `saveAppState()` y `saveAllData()` convergen en `_naQueuePersist()`, que está correctamente bloqueado en CANON por `CANONICAL_LEGACY_PERSISTENCE_BLOCKED`.
4. Por ello, el estado `appConfig` no dispone de un canal de persistencia local separado de los datos comerciales y una recarga puede restaurar una copia antigua.

## Cambio autorizado

Archivos de producto:
- `POS/js/legacy-inline/inline-02.js`
- `POS/js/legacy-inline/inline-03.js`
- `POS/js/legacy-inline/inline-07.js`

Prueba:
- `tests/cloud-sync/canonical-config-persistence.test.mjs`

Este documento:
- `docs/CANON_CONFIG_PERSISTENCE.md`

## Diseño

- Mantener `saveAllData()` y el snapshot comercial V9 bloqueados cuando CANON está activo.
- Dar a `saveAppState()` un camino CANON separado que solo persiste configuración local:
  - `appConfig`;
  - estado UI necesario;
  - locks locales;
  - seguridad local.
- Guardar ese estado en una clave local versionada y verificar la lectura después de escribir.
- Al iniciar CANON, aplicar primero el snapshot legacy solo como compatibilidad y luego superponer la configuración local más reciente.
- Eximir únicamente `configuracion` del bloqueo automático impuesto por CANON. Los bloqueos explícitos (maestro, solo lectura, módulo Configuración, sesión bloqueada y permisos/PIN) siguen funcionando.
- Los cambios de cajeros/roles/PIN personales que viven dentro de `appConfig` usan `saveAppState()`, no `saveAllData()`.

## Invariantes

- CANON sigue siendo autoridad para productos, ventas, clientes, créditos, caja, gastos e inventario.
- `saveAllData()` continúa fallando cerrado en CANON.
- No se crea endpoint, tabla D1, migración ni escritura remota nueva.
- No se elimina autorización por PIN ni permisos de cajero.
- Una escritura local no confirmada nunca muestra “Configuración guardada”.
- La configuración guardada debe sobrevivir a `location.reload()` mientras el almacenamiento persistente del navegador esté disponible.

## Pruebas

1. Regresión estructural: CANON permite `configuracion` pero sigue cerrando módulos comerciales legacy.
2. `saveAppState()` usa el canal local CANON; `saveAllData()` sigue usando el canal comercial bloqueado.
3. El guardado local verifica escritura y lectura.
4. La carga CANON superpone configuración local a un snapshot V9 antiguo.
5. El botón **Guardar todo** persiste mediante `saveAppState()` y reporta éxito solo con persistencia durable.
6. Gestión de cajeros/roles/PIN personales usa persistencia de configuración.
7. Ejecutar `node --test tests/cloud-sync/*.test.mjs` mediante CANON Critical CI.

## Rollback

Revertir el PR. No hay migración ni transformación de datos.
