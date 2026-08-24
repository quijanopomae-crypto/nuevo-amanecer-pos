# BASELINE de caracterización — FASE4-CHARACTERIZATION-BASELINE

## Propósito

Caracterizar el monolito POS **antes** de cualquier modularización, **sin
cambiar comportamiento**. Este documento fija una línea base reproducible del
producto autorizado para que, tras cada extracción/refactor, se pueda detectar
una regresión de comportamiento comparando fingerprints, no suposiciones.

## Identidad del baseline

| Campo | Valor |
|-------|-------|
| `BASE_COMMIT` | `b4003e2f0d84cdb832de9eff730f60dc946cbbbe` |
| `PRODUCT_BLOB` | `2dec6363d8aeef52da64ba60ac8eac8eb14f75f7` |
| Archivo | `CVV2.4_backup_antes_demo-1.html` (7164 líneas) |
| Fixture | `tests/characterization/fixtures/CVV2.4_backup_antes_demo-1.baseline.html` |

## Fingerprints (evidence/characterization/MANIFEST.json)

| Fingerprint | SHA-256 |
|-------------|---------|
| domFingerprint | `49edad801e5261884f0ce3f2bf0482eb61d5408fbeaa706dbbb6ba9775bded39` |
| globalApiFingerprint | `34b44312e8c6e545d709a18353004a6658e99b91badb1d77751fc1c12f50703d` |
| overrideMapFingerprint | `ebb52a0c2dabf8e5baa2d3c8eed0b1752231603630f49f8eebec8a7dde15f43a` |
| storageFingerprint | `bebd7f0bb60731f0418f67f6c56e6f00a2cc917179891b21da33de58227dd426` |
| v9BaselineFingerprint | `371323a59b8cc83dedd263ff9a9b461d4884d104dce21bf6ed8665096dd8f87f` |
| v10BaselineFingerprint | `13257bf2807015d0b5ef954197239f60963fbc84a41d214b697bd10d4504bc8f` |
| knownFailuresFingerprint | `e7d01525c8a553d58cc49403e363dcda08fac4cc38f6e705038476a9143cf653` |

## Startup baseline

- Entry point: `document.addEventListener('DOMContentLoaded', async () => { … })` en **L4273**.
- Cadena del cuerpo async (**L4275** + `await saveAllData()` en **L4277**), en orden:
  1. `loadAllData()` (await)
  2. `loadAppState()`
  3. `loadMasterConfig()`
  4. `_naInitSecurity()`
  5. `_naNormalizeData()`
  6. `renderCategorySelects()`
  7. `_naApplyConfigUI()`
  8. `_naInitFreeSaleShortcut()`
  9. `_naInitBarcodeScanner()`
  10. `creditos.forEach(_naSyncCreditStatus)`
  11. `posRender()`
  12. `posUpdateCart()`
  13. `invRender()`
  14. `cfgUpdateStats()`
  15. `updateDashboard()`
  16. `saveAllData()` (await, al final)
- `beforeunload` registrado en **L2344** (`_naFlushRecoveryBeforeUnload`).

## Dependencias externas

- `EXTERNAL_NETWORK_REQUIRED = YES`
  - Google Fonts Nunito: `<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap">` en **L8**.
  - SheetJS: `<script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js" defer></script>` en **L9**.
- `SHEETJS_DEPENDENCY = CDN https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js` (defer).
- **Sin `fetch()`/XHR propio** en el monolito (verificado estáticamente).

## Protocolo de ejecución (dynamic)

- `FILE_PROTOCOL_SUPPORTED = NO` (bloqueo cross-origin observado)
- `HTTP_SUPPORTED = ENVIRONMENT_BLOCKED`

**Motivo (honesto):** se detectó Chrome en
`C:\Program Files\Google\Chrome\Application\chrome.exe` y el protocolo `file://`
SÍ ejecutó en Chrome headless (exit 0), pero el harness dinámico no puede
introspectar el `iframe` (SecurityError cross-origin / origen opaco), por lo que
no se pudo observar el arranque completo del app. Para caracterización dinámica
via iframe: `FILE_PROTOCOL_SUPPORTED=NO` (bloqueo cross-origin observado; ver
`evidence/characterization/dynamic-file-protocol-results.json`). El
comportamiento del app puro bajo `file://` sigue `UNVERIFIED` (no se pudo
observar arranque completo). HTTP: `ENVIRONMENT_BLOCKED` (ETIMEDOUT del headless
`--dump-dom` en este entorno; ver
`evidence/characterization/dynamic-ENVIRONMENT_BLOCKED.json`). El harness
(`tests/characterization/dynamic/characterization-harness.html`) y el test
(`tests/characterization/dynamic-characterization.test.mjs`) quedan listos para
re-ejecutarse en un entorno con red o con un runner de browser determinista que
permita inspeccionar el iframe.

## Override map (definiciones en línea; la última gana)

Cadena de capas:
`base(L2271-4390)` → `_naSecOriginal*(L4238-4266)` → `F7 crédito(L4447)` →
`F8 reportes(L4549)` → `F9 sugerencias(L4608)` → `F10 control maestro(L4697)` →
`F11 ticket(L4844)` → `F12 iconos(L5016)` → `na-security-*-render(L5096-6095)` →
`guardado crítico inventario(L6096-6119)` → `V10 núcleo(L6120-6642)` →
`V10 motor venta(L6645-6857)` → `V10 caja(L6858-7160, DORMANTE)`.

| Función | Definiciones | Efectiva | Capa efectiva |
|---------|--------------|----------|---------------|
| `confirmarVenta` | 3508, 4791 | **4791** | F10 wrapper → base |
| `guardarMovInv` | 3558, 4799, 6099 | **6099** | guardado crítico inventario |
| `posRender` | 3410, 5976 | **5976** | na-security-pos-render |
| `cliRender` | 3598, 5571 | **5571** | na-security-credit-render |
| `cajRender` | 3647, 5415 | **5415** | na-security-cash-render |
| `abrirCred` | 2712, 4501, 4805, 5603 | **5603** | na-security-credit-render |
| `ventasRender` | 3651, 4590, 5260 | **5260** | alias `_naSecRenderSales` |
| `gasRender` | 3016, 6060 | **6060** | na-security-expense-render |
| `posUpdateCart` | 3416, 6025 | **6025** | na-security-pos-render |
| `invRender` | 3745, 4649 | **4649** | F9 sugerencias |
| `previewImagen` | 3532, 5066, 5855 | **5855** | na-security-image-preview |

`ventasRender` en L5260 es una **asignación de alias**
(`ventasRender=_naSecRenderSales;`), capturada por el parser como definición.

## Estado global (línea de declaración)

| Global | Línea | kind |
|--------|-------|------|
| `storage` | 2273 | const (wrapper IIFE de persistencia) |
| `appConfig` | 2337 | let |
| `productos` | 2351 | let |
| `cart`, `posCat`, `posProc`, `posPayM`, `modoMayorista` | 2352 | let |
| `_NA_SEED_PRODUCTOS` | 2354 | const |
| `clientes` | 2687 | let |
| `creditos` | 2688 | let |
| `cajEstado` | 2727 | let |
| `cajMovs` | 2728 | let |
| `ventas` | 2751 | let |
| `gastos` | 3012 | let |

## Storage

- **IndexedDB** `NuevoAmanecerPOS`:
  - V9 (`open(_,1)`, L3335): store `state` (keyPath `null`), clave `snapshot_v9`.
  - V10 (`open(_,_NA_V10_DB_VERSION=2)`, L6168): stores
    `state` (keyPath `null`), `operations` (keyPath `operationId`),
    `checkpoints` (keyPath `key`).
- **localStorage (20 keys)**: `na_snapshot_v9`, `na_snapshot_v10`,
  `na_snapshot_v10_signal`, `na_snapshot_v10_conflict_<commitId>`,
  `na_security_v26`, `na_master_lock`, `na_readonly`,
  `na_lock_{productos,ventas,caja,clientes,gastos,importacion,configuracion}`,
  `na_app_initialized_v1`, `na_seed_catalog_version`,
  `na_seed_catalog_suppressed`, `na_cfg_category`, `na_cart_draft`,
  `na_pre_restore_snapshot_v1`.
- **sessionStorage (5 keys)**: `na_snapshot_v9_session`,
  `na_pre_restore_snapshot_v1_session`, `na_security_locked`, `na_v10_outbox`,
  `na_cart_draft`.
- **Legacy (solo lectura, 9 keys)**: `na_productos`, `na_ventas`,
  `na_clientes`, `na_creditos`, `na_gastos`, `na_cajMovs`, `na_cajEstado`,
  `na_app_state`, `na_cart`.

## V9 flows (INPUT → OUTPUT → STATE → STORAGE)

Todas las operaciones críticas exigen persistencia durable verificada antes de
dar éxito a la UI; en caso contrario revierten a un backup previo
(`_naWasPersisted(result)` con `durable && verified`).

- **Venta** (`confirmarVenta` 4791→3508): cart + `posPayM` + caja abierta +
  `mMontoRec`/`mCreditoCliente`/`mCreditoVence` → venta `V-###` +
  `cajMov ing` + stock decrementado (+ `creditDraft` si crédito) →
  `ventas.unshift`, `cajMovs.push`, `stock-=units`, `cart=[]` → `saveAllData()`.
- **Movimiento inventario** (`guardarMovInv` 6099): `mMovCant` + `invMovId`/`invMovT`
  → stock ± qty → `_naFinalizeOperationPersistence`.
- **Caja**: `abrirCaja` (4815→3603) crea `cajEstado` (sessionId, fondo, cajero);
  `guardarMovCaja` (3606) registra `cajMov` ing/egr/cob/gas; `cerrarCaja` (3627)
  calcula contado/esperado/diferencia.
- **Crédito + abono**: `guardarCred` (4509) evalúa línea y crea crédito con
  `fuenteLineaCredito`/`criterioCredito`; `confirmarPago` (4811→3590) registra
  `pago` + `cajMov cob` y actualiza `pagado`/`saldo`.
- **Gasto** (`guardarGasto` 3716): `gasDesc`/`gasMonto`/`gasMetodo`/`gasFecha` →
  `gastos.unshift` + `cajMov gas` (si caja abierta y fecha hoy).
- **Cliente** (`guardarCli` 3563): alta/edición con validación de código y margen.
- **Ticket** (F11 L4844-4973) / **anulación** (`anularV` L3685): reversión
  contable sin borrar la venta original.
- **Backup/restore**: `na_pre_restore_snapshot_v1`(+`_session`) en L4193 antes de
  una restauración; `_naBuildSnapshot`/`_naRestore` normalizan datos.

## V10 dormant

`V10_DORMANT = YES`:

- Sin callers de producción fuera del rango V10 (6120-7160): `_naV10*`,
  `_naRunCriticalOperation` y `_naNewOperationId` solo se referencian dentro de V10.
- El bootstrap (L4273-4285) **no** inicializa V10 ni llama `_naV10*`.
- Comentarios clave verbatim: `Nucleo V10 inactivo` (L6121),
  `sin reemplazar confirmarVenta todavía` (L6645),
  `DORMANTE, NO CONECTADO A V9` (L6855).
- `confirmarVenta` no tiene definición después de L6120.

## Riesgos conocidos registrados (NO corregidos)

- **R1 — last-writer-wins multipestaña V9 (P0 latente):** `loadAllData`
  (L3390-3397) elige snapshot por `updatedAt` descendente sin revisión/CAS;
  `_naCommitSnapshot` (L3351-3356) escribe el mismo snapshot a
  IDB+localStorage+sessionStorage. Dos pestañas pueden revertir una venta
  confirmada. REGISTRADO, NO CORREGIDO (caracterización read-only).
  Referencias: `docs/engineering/AI_PROJECT_CONTEXT.md`; núcleo transaccional
  V10 existe en el baseline como frontera futura (dormante).
- **R2 — beforeunload snapshot (P1 latente):** `_naFlushRecoveryBeforeUnload`
  (L3371, registrado en L2344) escribe un snapshot fresco a
  localStorage/sessionStorage al cerrar la pestaña sin comparación de
  revisiones — puede sobrescribir el último guardado de otra pestaña.
  REGISTRADO, NO CORREGIDO.

> Nota: estos riesgos son del producto caracterizado; cualquier corrección
> futura es alcance de otra fase con `CODEX_REVIEW_REQUIRED`.

## Known baselines (suites externas, distinguibles en el código)

| Área | Baseline | Notas |
|------|----------|-------|
| CASH | 11/13 | `HISTORICAL_COMMIT_UNVERIFIED x2` |
| CREDITS | 21/22 | `criterion/criterio` |
| sale-transaction | pendiente | — |
| INVENTORY | A_PLUS_B cerrado | 2 P1 + 1 P2 pendientes |

## Divergencia del árbol de trabajo (documentada, no es fallo)

El archivo **del árbol de trabajo** `CVV2.4_backup_antes_demo-1.html`
(blob `505859a2e3957acd653af3e1513a2af7ddc1caba`, HEAD `b7e2e83`) es **OTRA
versión** distinta del baseline autorizado. Respecto al baseline, el árbol de
trabajo perdió/eliminó (entre otros): el módulo de caja V10, la política de
crédito V10 espejo y la reconciliación `STALE_ATTEMPT` con validaciones de
cajero/pago mixto. En concreto, `_naV10ConfirmExpenseIntent` (presente en el
baseline L7129) **no existe** en el árbol de trabajo. Ver
`evidence/characterization/known-divergence.json`.

**Valor canónico de la divergencia:** **35 funciones removidas** y
**29 cambiadas** (0 añadidas). Este conteo queda congelado en
`evidence/characterization/known-divergence-historical.json` (artifact
estático `frozen:true`, **nunca** regenerado por tests), que sobrevive a la
canonicalización: el `known-divergence.json` vivo pasará a
`IDENTICAL_TO_BASELINE` en la rama canónica y servirá para comparar futuras
extracciones contra el registro histórico.

## Guía de uso

- Re-ejecutar caracterización estática:
  `node --test tests/characterization/baseline-fixture.test.mjs tests/characterization/static-*.test.mjs tests/characterization/generate-evidence.test.mjs`
- Re-ejecutar divergencia:
  `node --test tests/equivalence/equivalence-lib.test.mjs`
- Re-ejecutar dinámico (requiere navegador + entorno que permita al harness
  completar):
  `node --test tests/characterization/dynamic-characterization.test.mjs`
- **Detectar `NEW_REGRESSION` tras una extracción**: ejecutar `analyzeAll()` del
  producto extraído y comparar con el baseline usando
  `diffFingerprints()`/fingerprints de comportamiento (overrideMap, storage,
  startup, globals). Un cambio de `overrideMapFingerprint` o de la cadena de
  arranque sin causa de refactor es señal de regresión.
