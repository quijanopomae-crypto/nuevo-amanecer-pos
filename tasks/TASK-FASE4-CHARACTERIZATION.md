# TASK — FASE4-CHARACTERIZATION-BASELINE

- **OBJECTIVE_ID:** `FASE4-CHARACTERIZATION-BASELINE`
- **BASE_COMMIT:** `b4003e2f0d84cdb832de9eff730f60dc946cbbbe`
- **PRODUCT_BLOB:** `2dec6363d8aeef52da64ba60ac8eac8eb14f75f7`
- **Rama:** `codex/preserve-current-infra-phase1` (HEAD `b7e2e83`, árbol divergente documentado)
- **Estado:** `IMPLEMENTATION_READY_FOR_TEST` — fix de harness CRLF aplicado, re-ejecución de equivalence completada (ver sección Resultados).

## Propósito

Caracterizar el monolito POS **antes** de cualquier modularización, **sin
cambiar comportamiento**: fingerprints estáticos, divergencia working-tree vs
baseline autorizado y protocolo de ejecución dinámico. No se modifica el
producto `CVV2.4_backup_antes_demo-1.html` (solo lectura).

## Identidad

| Campo | Valor |
|-------|-------|
| `BASE_COMMIT` | `b4003e2f0d84cdb832de9eff730f60dc946cbbbe` |
| `PRODUCT_BLOB` | `2dec6363d8aeef52da64ba60ac8eac8eb14f75f7` |
| HEAD rama actual | `b7e2e83` (working tree = OTRA versión, divergente) |
| Fixture autorizado | `tests/characterization/fixtures/CVV2.4_backup_antes_demo-1.baseline.html` |

## Archivos creados

### `tests/characterization/` (17 archivos + 2 helpers del tester)

Tests:

- `baseline-fixture.test.mjs`
- `generate-evidence.test.mjs`
- `dynamic-characterization.test.mjs`
- `static-v10-dormant.test.mjs`
- `static-structure.test.mjs`
- `static-storage.test.mjs`
- `static-startup.test.mjs`
- `static-overrides.test.mjs`
- `static-globals.test.mjs`

Lib (`tests/characterization/lib/`):

- `static-parse.mjs`
- `fingerprint.mjs`
- `extract-baseline.mjs`
- `evidence.mjs`
- `blob-hash.mjs`

Harness dinámico (`tests/characterization/dynamic/`):

- `characterization-harness.html`

Fixtures (`tests/characterization/fixtures/`):

- `CVV2.4_backup_antes_demo-1.baseline.html`
- `README.md`

Helpers del tester (NO forman parte del baseline):

- `_tester-sha256.mjs`
- `_tester-eol-check.mjs`

### `tests/equivalence/` (2 archivos)

- `fingerprint-diff.mjs`
- `equivalence-lib.test.mjs`

### `evidence/characterization/` (JSONs)

- `MANIFEST.json`
- `dom-ids.json`
- `globals.json`
- `overrides.json`
- `storage-static.json`
- `startup.json`
- `structural.json`
- `external-deps.json`
- `inline-handlers.json`
- `v10-dormancy.json`
- `known-divergence.json`
- `dynamic-run-errors.json`
- `dynamic-file-protocol-results.json`
- `dynamic-dump-http.html` (obsoleto, 0 bytes — ver NB-2 PENDING)
- `dynamic-ENVIRONMENT_BLOCKED.json`

### `docs/characterization/`

- `BASELINE.md`

## Comandos de re-ejecución

- **Estáticas:**
  `node --test tests/characterization/baseline-fixture.test.mjs tests/characterization/static-*.test.mjs tests/characterization/generate-evidence.test.mjs`
- **Equivalence (divergencia):**
  `node --test tests/equivalence/equivalence-lib.test.mjs`
- **Dinámico** (requiere navegador + entorno que permita inspeccionar el iframe):
  `node --test tests/characterization/dynamic-characterization.test.mjs`

## Resultados reales del tester

| Suite | Resultado |
|-------|-----------|
| Estáticas | **59 pass / 0 fail** |
| Equivalence | **2 pass / 1 fail** (fail por CRLF: `gitBlobSha1` sobre bytes crudos del checkout Windows) |
| Dinámico | **2 skip** — HTTP `ETIMEDOUT`; `file://` cross-origin bloqueado |

### Fix de harness aplicado (equivalence)

El fail de `equivalence-lib.test.mjs` era **bug de harness**, no del producto:
el blob del árbol de trabajo se calculaba sobre los bytes crudos del disco
(CRLF, checkout Windows `autocrlf`) en lugar del contenido canónico LF que Git
almacena. Verificado por el tester:

`gitBlobSha1(buffer normalizado a LF) === '505859a2e3957acd653af3e1513a2af7ddc1caba'`

que coincide con `git rev-parse HEAD:CVV2.4_backup_antes_demo-1.html`.

**Fix aplicado:** al leer el archivo del árbol de trabajo para el hash, se
normaliza fin de línea (`buffer.toString('utf8').replace(/\r\n/g,'\n')` →
`Buffer.from(...,'utf8')`) antes de `gitBlobSha1`. El `analyzeAll()` del árbol
de trabajo **no** se normaliza (los parsers trabajan por líneas y son inmunes a
CRLF).

### Dinámico (honesto)

- `file://` **SÍ** ejecutó en Chrome headless (exit 0), pero el harness no puede
  introspectar el `iframe` (SecurityError cross-origin / origen opaco).
  → `FILE_PROTOCOL_SUPPORTED = NO` (bloqueo cross-origin observado).
  → Comportamiento del app puro bajo `file://` sigue `UNVERIFIED`.
- HTTP: `ENVIRONMENT_BLOCKED` (ETIMEDOUT del headless `--dump-dom` en este
  entorno). Ver `evidence/characterization/dynamic-ENVIRONMENT_BLOCKED.json`.

## MANIFEST determinista

- `MANIFEST.json` sha256: `09e3449cd7de6fe9478034ee99febb265caf01a289ed32f0c9d3674532a95de0`
  (determinista; los fingerprints se computan sobre representación canónica).

## Anomalía observada (fuera de alcance, NO tocada)

- `.opencode/skills/deepseek-v4-pro-max/Videos.lnk` — accesos directos dentro de
  un directorio de skills. No forma parte del baseline ni del alcance; no se
  modificó ni incluyó.

## Divergencia working-tree vs baseline (documentada, no es fallo)

El árbol de trabajo (`CVV2.4_backup_antes_demo-1.html`, blob
`505859a2e3957acd653af3e1513a2af7ddc1caba`) es OTRA versión del baseline
autorizado. Respecto al baseline perdió/eliminó, entre otros, el módulo de caja
V10, la política de crédito V10 espejo y la reconciliación `STALE_ATTEMPT`.
`_naV10ConfirmExpenseIntent` (baseline L7129) **no existe** en el árbol de
trabajo → queda en `diff.removed`. Ver
`evidence/characterization/known-divergence.json`.

## Revisión independiente — hallazgos atendidos (APPROVED)

Tras revisión independiente `APPROVED`, se atendieron los no-bloqueantes:

- **NB-1 (P2):** eliminada la función `cleanupLegacyWrongPath()` y sus
  llamadas en `dynamic-characterization.test.mjs` — resolvía
  `path.resolve(__dirname,'..','..','..')` (padre del workspace) y ejecutaba
  `fs.rmSync`/`fs.rmdirSync` fuera del alcance permitido. Sustituida por una
  **guarda de alcance** que aborta si `EVIDENCE_DIR` queda fuera del workspace
  root (`if (!EVIDENCE_DIR.startsWith(WORKSPACE_ROOT)) throw …`).
- **NB-2 (P4):** PENDING — el artefacto huérfano
  `evidence/characterization/dynamic-dump-http.html` (0 bytes, obsoleto) NO pudo
  borrarse: `node -e`/`rm` bloqueados por permisos (PERMISSION_BLOCKED). El
  propietario puede ejecutar:
  `node -e "require('fs').unlinkSync('evidence/characterization/dynamic-dump-http.html')"`.
  Inofensivo (0 bytes) mientras tanto.

## Pendientes

- Dinámico: no se pudo observar arranque completo del app (`file://`
  cross-origin, HTTP `ENVIRONMENT_BLOCKED`). Requiere runner de browser que
  permita inspeccionar el iframe.
- Gate crítico posterior (finanzas/persistencia) termina en
  `CODEX_REVIEW_REQUIRED`: una sesión Codex READ-ONLY decide la aprobación de
  cualquier cambio futuro en esos dominios; este baseline es solo
  caracterización de solo lectura.
- `known-divergence.json` se regenera al correr `equivalence-lib.test.mjs` y
  debe mantener `_naV10ConfirmExpenseIntent` en `diff.removed`.

## Migración a rama canónica — preparación

### CHARACTERIZATION_FILES_TO_PRESERVE

- `tests/characterization/**` (excluye helpers `_tester-*`)
- `tests/equivalence/**`
- `evidence/characterization/**` (excluye `dynamic-dump-http.html`, obsoleto 0 bytes)
- `docs/characterization/BASELINE.md`
- `tasks/TASK-FASE4-CHARACTERIZATION.md`

### Notas de preparación

- `tests/equivalence/equivalence-lib.test.mjs` ya es **dual-mode**: calcula el
  blob esperado dinámicamente desde `HEAD` (`git rev-parse
  HEAD:CVV2.4_backup_antes_demo-1.html`), por lo que el test `known divergence`
  pasa tanto en la rama canónica (árbol == baseline `2dec6363` → diff vacío,
  `IDENTICAL_TO_BASELINE`) como en el workspace divergente (diff no vacío,
  `DIVERGES`).
- El fixture autorizado **se regenera solo** vía `ensureBaselineFixture()`
  (`git show b4003e2:CVV2.4_backup_antes_demo-1.html`); no requiere copiar el
  producto del workspace.
- **Conteo canónico de la divergencia** (pre-canonicalización): **35 funciones
  removidas / 29 cambiadas** (0 añadidas), verificado contra
  `evidence/characterization/known-divergence.json`.
- **Artifact histórico creado:**
  `evidence/characterization/known-divergence-historical.json` (`frozen:true`,
  nunca regenerado por tests), que congela el valor canónico 35/29 y sobrevive
  a la canonicalización.
- Estado: **preparado, pendiente de git por permisos** (el propietario ejecuta
  la migración de rama; este agente no hace `git add`/commit/merge).
- **Git pendiente del propietario:** `git branch`/`git checkout` para la
  migración queda pendiente (`PERMISSION_BLOCKED`: solo git read-only permitido
  al agente).
