# TASK — FASE 6: OFFLINE BOOTSTRAP + COMPATIBILITY

## Objetivo

Crear la infraestructura **FRÍA** de bootstrap para el POS derivado
(`POS/index.html`), sin conectarla al documento: un contrato de glóbulos V9
(`POS/js/compat/legacy-globals.js`) y un bootstrap pasivo (`POS/js/app.js`),
ambos classic scripts, más los parsers estructurales y las pruebas que
verifican la derivación sin números de línea fijos del canónico.

## Base y blob

- Rama: `modularization/fase6-offline-compat` (HEAD `e58cd7bb43d340b5666eaba38fb91d7932c41ccf`).
- Producto canónico: `CVV2.4_backup_antes_demo-1.html` (blob git
  `2dec6363d8aeef52da64ba60ac8eac8eb14f75f7`, PROHIBIDO modificar).
- Derivado: `POS/index.html` (blob git `b675a540c8fd153dc3d25fc70343ff6aad37fd2a`),
  byte-exacto tras la extracción de CSS de FASE 5.

## Decisiones de arquitectura

| Decisión | Detalle |
|----------|---------|
| **Infraestructura fría** | `app.js` y `legacy-globals.js` se CREAN pero NO se conectan a `index.html` (queda byte-exacto). Conexión = FASE 7, final del `<body>`, classic, sin defer (dos líneas reversibles, en orden: `js/compat/legacy-globals.js` → `js/app.js`). |
| **Classic only** | Sin ES modules, sin frameworks. `file://` no soporta modules (origin `null`) — observado en FASE 4 (`evidence/characterization/dynamic-file-protocol-results.json`). |
| **F6-ARC-0** | Toda derivación es ESTRUCTURAL: boundary = línea del PRIMER script SIN src vía `parseScriptBlocks`. PROHIBIDO usar líneas fijas del canónico. |
| **Template gap cerrado** | 84 nombres de handlers en templates JS (además de los 89 estáticos). |
| **SheetJS blanda** | `XLSX` es OPCIONAL con guardas `typeof XLSX !== 'undefined'` → fallback CSV. Guardas derivadas ESTRUCTURALMENTE (escaneo `typeof XLSX`, ≥6), sin líneas fijas. |

## Referencia semántica congelada (F6-ARC-0)

- 89 nombres estáticos (91 extraídos, falsos positivos `if`, `getElementById`).
- Ocurrencias `{onclick:277,onchange:57,oninput:31,onkeydown:2,ondrag*:1×4}` total 371.
- 28 overrides con conteos: confirmarVenta 2, guardarMovInv 3, posRender 2,
  cliRender 2, cajRender 2, abrirCred 4, ventasRender 3, gasRender 2,
  guardarProd 3, abrirModalProd 3, previewImagen 3, abrirCaja 2, abrirCobro 2,
  abrirDescuento 2, abrirModalCli 3, abrirModalGasto 3, cerrarCaja 2,
  confirmarPago 2, guardarCli 2, guardarConfig 2, guardarCred 3,
  guardarMovCaja 2, imprimirTicketSistema 2, invRender 2, selPM 2,
  switchCfgCategory 2, ventasSetTab 2, _naF8ExportReport 2.
- Boundary estructural del derivado: **816**.

## Archivos creados

| Archivo | Contenido |
|---------|-----------|
| `POS/js/compat/legacy-globals.js` | ÚNICA fuente de verdad: IIFE ES5 classic que setea `_NA_LEGACY_GLOBALS` con `requiredGlobals` (177), `overrideWinners` (28 `{name,count}`), `verify(win, lexicalProbe)` (typeof-only, dual window + sonda léxica para const/let top-level) y `isValidName(name)` (regex de seguridad). NO invoca negocio. |
| `POS/js/app.js` | Bootstrap pasivo NO conectado: `_NA_BOOT` (phase f6, connected false, fileProtocol, started, lastVerify, verify typeof-only vía `_NA_LEGACY_GLOBALS`), `DOMContentLoaded` → started+verify. Nada más. |
| `tests/offline-compat/lib/pos-parse.mjs` | Parsers puros: loadPosLines, posScriptRanges, posStaticBoundary, posStaticHandlerNames, posTemplateHandlerNames, posRequiredGlobals, posDefinitions, posOverrideWinners, posEntrySequence, posStyleRealBlocks. |
| `tests/offline-compat/fase6-offline-compat.test.mjs` | T1-T19 (node:test). |
| `evidence/offline-compat/{inventory,override-winners,bootstrap-contract,report}.json` | Evidencia determinista SIN timestamps. |
| `tasks/TASK-FASE6-OFFLINE-COMPAT.md` | Este documento. |

## Resultados reales (números)

| Métrica | Valor |
|---------|-------|
| Scripts / inline / external | 19 / 18 / 1 (CDN SheetJS defer) |
| type=module | 0 |
| Boundary estructural | 816 |
| Nombres estáticos / ocurrencias reales | 99 / 231 |
| Nombres template / ocurrencias reales | 90 / 135 |
| Asignaciones JS `.onclick=` excluidas | 6 |
| Handlers reales totales | 366 |
| REQUIRED_GLOBALS | 177 |
| Override winners (full) / (congelado) | 72 / 28 |
| Entry sequence | 16 tokens |
| Bloques `<style>` reales / `<style` en scripts | 0 / 2 |
| `MISSING_GLOBALS` | `[]` |
| `_NA_SNAPSHOT_KEY` | `snapshot_v9` (storage 20/5/9, V10 dormant) |

## Comandos de re-ejecución

```powershell
node --check tests/offline-compat/lib/pos-parse.mjs
node --check tests/offline-compat/fase6-offline-compat.test.mjs
node --check POS/js/compat/legacy-globals.js
node --check POS/js/app.js
node --test tests/offline-compat/fase6-offline-compat.test.mjs
node --test tests/equivalence/css-static-extraction.test.mjs
node --test tests/characterization/baseline-fixture.test.mjs tests/characterization/static-*.test.mjs tests/characterization/generate-evidence.test.mjs
node --test tests/equivalence/equivalence-lib.test.mjs
```

## Sección de revisión (post-APPROVED con condición)

Correcciones aplicadas tras la revisión APPROVED:

- **NB-1 (P2, corregido)** — `verify()` en `legacy-globals.js` ahora es dual:
  `typeof win[name]` **+** sonda léxica global (por defecto `Function('return typeof ' + name)`,
  typeof-only, nunca invoca). Detecta bindings `const`/`let` top-level (p.ej.
  `cerrarModal`, `_naEsc`) que NO son propiedades de `window`. Valida cada
  nombre contra `/^[A-Za-z_$][A-Za-z0-9_$]*$/` ANTES de cualquier uso dinámico
  (rechaza `if;alert(1)`). Retorna `{ok, missing, checked, lexical}` y acepta
  `lexicalProbe` inyectable (tests). Expone `isValidName`. ES5-vanilla + freeze.
- **NB-2 (P3, documentado)** — conexión FASE 7 = **DOS** líneas al final del
  `<body>` SIN defer, en orden: `<script src="js/compat/legacy-globals.js"></script>`
  y luego `<script src="js/app.js"></script>`. Cláusula E del contrato,
  comentario de `app.js` y este documento actualizados.
- **NB-3 (P3, derivación estructural)** — guardas SheetJS ahora se derivan
  escaneando `typeof XLSX` (`posSheetJsGuards`), sin líneas fijas; se escriben en
  `bootstrap-contract.json.sheetjsGuards` marcadas `derived:true`. El único
  hardcode remanente es el umbral mínimo `count >= 6`.

## CODEX REJECTION FIX (FASE 6)

Rechazo de Codex resuelto con correcciones **exactas** (v2).

### Root causes

1. **Regex de handler truncante** — `HANDLER_VALUE_REGEX`
   `\b(?:on\w+)\s*=\s*["']([^"']*)["']` cortaba los valores double-quoted en la
   primera comilla simple interna. Ej.: `onclick="cerrarModal('mCred');abrirEvaluacionCredito('…')"`
   solo capturaba `cerrarModal`, perdiendo la segunda llamada. Además `ondrop`
   estaba **fuera** de la whitelist (`ondrag\w*` no cubre `ondrop`): el handler
   `ondrop="ticketZoneDrop(event,'${code}')"` (POS L3363, función en L3372) no se
   extraía.
2. **Parser de scripts por-línea** — `parseScriptBlocks` de static-parse es
   por-línea: tags `<script>` multilínea y `</script>` dentro de strings/templates
   JS lo romperían (no disparado hoy, pero P1-2 exige solidez). Se añadió un
   scanner estructural propio `scanTags()`.
3. **Cláusula H inexacta** — decía "fallback CSV" sin distinguir export/import.
4. **Tests autorreferentes** — T6 embebido-vs-derivado usaba el mismo extractor;
   T15 sin anclaje de blob/sha; T16 sin completitud; T17 sin integridad de fallbacks.

### Fixes

- **FIX 1 — `tests/offline-compat/lib/pos-parse.mjs` v2**:
  - Whitelist explícita `HANDLER_ATTRS` con `ondrop`.
  - `HANDLER_VALUE_REGEX` quote-respecting `(?:"([^"]*)"|'([^']*)')` (valor completo).
  - `scanTags(text)`: máquina de estados sobre el texto completo (aperturas
    multilínea; strings/`//`/`/* */`/template con `${}` anidado/literales regex).
    `posScriptRanges()` usa el scanner robusto; `crossCheckVsStaticParse()`
    compara contra static-parse (hoy coinciden: 19 scripts, mismos rangos).
  - `posRequiredGlobals` v2 con el regex corregido.
- **FIX 2 — `legacy-globals.js`** regenerado: 168 `REQUIRED_GLOBALS`
  (+`ticketZoneDrop`). Sin hardcode mágico; verify dual + freeze intactos.
- **FIX 3 — XLSX_SCOPE_BLOCKED** (ver abajo) + cláusula H corregida.
- **FIX 4 — tests T1..T19** endurecidos (ver abajo).
- **FIX 5 — evidencia regenerada** (inventory/report con BEFORE/AFTER y delta).

### XLSX_SCOPE_BLOCKED (defecto LEGACY PREEXISTENTE)

`_naReadProductImportFile` (POS L2451 / canónico L3906) llama a
`_naParseXlsxBasic` cuando `typeof XLSX === 'undefined'` (import .xlsx sin CDN),
pero esa función **jamás se define** en el blob `2dec6363`. Impacto: import .xlsx
offline → `ReferenceError` capturado por `importProducts` → toast de error; **sin
corrupción de datos**. El export Excel SÍ degrada a CSV real. Corregirlo exige
modificar el producto canónico → **BLOQUEADO** (decisión del propietario en fase
separada). Embutido como `xlsxScopeBlocked` en `bootstrap-contract.json`. Nada de
catch vacío/mock/falso fallback: solo documentación honesta.

### Tests v2 (delta clave)

- **T6**: triple acuerdo `derivado === independiente === embebido` (extractor
  independiente con regex distinta), PINS `[ticketZoneDrop, abrirEvaluacionCredito,
  securityUnlock, abrirPago, posAdd]`, **sin** número mágico 167.
- **T15**: evidence anclada (`sourceBlob`, `posIndexSha256`, checksums de ambos
  extractores), determinismo doble corrida.
- **T16**: PINS + `count === independiente` + `isValidName` + rechaza `if;alert(1)`.
- **T17**: `undefinedFallbacks === ['_naParseXlsxBasic']` EXACTO + guards `typeof XLSX` ≥6.
- **T18**: adversarial F1 (tag multilínea), F2 (string JS con `<script>`/`</script>`),
  F3 (template con `<style>`), F4 (`</script>` en template literal) contra
  `scanTags`; documenta (asserts vivos) que el parser por-línea FALLA en F1/F2/F4.
- **T19**: `ondrop` contado + `ticketZoneDrop` en required.

### Conciliación REQUIRED 167 → 168

`ticketZoneDrop` es el **único** nombre nuevo con definición top-level. Los demás
nuevos son estructurales pero se filtran por falta de definición: `click`
(estático, por valor destruncado) y `String`/`add`/`preventDefault`/`setTimeout`/
`abrirVentaLibre` (template, por valores completos). `abrirEvaluacionCredito`
resuelto: se captura desde el lado template (POS L3056 `onclick='abrirEvaluacionCredito(${arg})'`),
no desde el HTML estático; ya estaba en required.

## Estado

`IMPLEMENTATION_READY_FOR_TEST` — T1-T19 PASS. Evidencia regenerable y
determinista (doble corrida mismo sha256). `POS/index.html` y el canónico quedan
sin diff.

## CODEX REJECTION #2 — cierre v3

La segunda revisión independiente detectó que v2 seguía limitando los nombres
estáticos al HTML anterior al primer script inline. La remediación final adopta
**full-document discovery**: todo HTML real fuera de todos los rangos
`<script>`, incluidos los segmentos entre bloques posteriores al primero.

- `REQUIRED_GLOBALS = 177`, derivados por acuerdo triple; no es fuente mágica.
- Se incorporaron los 9 globals reales omitidos por v2:
  `actualizarAdvertenciaLineaManual`, `guardarLineaCreditoManual`,
  `restaurarLineaCreditoAutomatica`, `_naF12RenderEmojiPicker`,
  `_naF12ChooseAutoSuggestion`, `_naF12DesignerReset`,
  `_naF12DesignerAddText`, `_naF12DesignerLoadImage` y
  `_naF12SaveCustomIcon`.
- Se excluyen 6 asignaciones JavaScript `.onclick=` que no son atributos HTML.
- `scanTags` v3 conserva offsets exactos, apertura/atributos estructurales y
  manejo de strings, templates, comentarios y literales regex.
- El oráculo independiente no reutiliza rangos, boundary, definiciones ni regex
  del extractor principal.
- T18 cubre F1-F12 más el caso Codex válido
  ``if (ok) /[`]/.test(x)``.
- T4 corrigió un `TEST_ORACLE_BUG` y protege **full-document discovery** del
  HTML real fuera de todos los rangos `<script>`, incluidos los segmentos
  posteriores al primer script y entre bloques script. El caso reproducido
  tiene 0 handlers después del último `</script>` y 21 después del primero,
  todos fuera de scripts y entre bloques; allí estaban los 9 globals omitidos.
- XLSX permanece `LEGACY_SCOPE_BLOCKED`: `_naParseXlsxBasic` no existe en el
  blob canónico y corregirlo requiere modificar producto legacy.

### Resultados finales reales

| Gate | Resultado |
|------|-----------|
| FASE 6 | **19 PASS / 0 FAIL** |
| Characterization completa | **59 PASS / 0 FAIL / 2 SKIP** |
| CSS/equivalence | **15 PASS / 0 FAIL** |

Los 2 SKIP de Characterization corresponden a tests dinámicos
`ENVIRONMENT_BLOCKED` por Chrome `ETIMEDOUT`/harness. No son PASS ni fallos de
producto.

Desglose de CSS/equivalence: `css-static-extraction` aportó 12 PASS y la
equivalence adicional 3 PASS; total ejecutado: **15 PASS / 0 FAIL**.

Estado final: `READY_FOR_INDEPENDENT_TEST`. No se inició FASE 7, no se realizó
freeze y no se modificó producto funcional.
