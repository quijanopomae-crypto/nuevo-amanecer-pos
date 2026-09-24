# Remediación Fase 5 — clasificación del checkpoint V1.3

Checkpoint protegido: `checkpoint/v1.3-pc-20260923`

Base analizada: `feature/v1.3-mobile-cloud@358bd9bc5fd38fda145b6f5a09ff6a449a97751f`

Regla: no borrar ni cherry-pickear el checkpoint completo. Integrar únicamente
bloques mínimos después de rebase semántico y CI.

## Clasificación por commit

- `7d1667f` — **REWORK / BLOCKED**. El código de sincronización CANON es valioso,
  pero los cambios `POS/**` disparan Pages automáticamente y pueden activar
  comportamiento remoto. No integrar hasta cerrar el gate de despliegue/activación.
- `afc17bf` — **REWORK**, excepto `d1-backup-workflow.test.mjs` = **INTEGRATE**
  en Fase 5A. El resto de tests depende de código/migraciones CANON todavía no promovidos.
- `1ee85a4` — **SPLIT**. `tools/cloudflare-backup/**` y documentación actualizada
  = **INTEGRATE**. El cambio antiguo de README = **SUPERSEDED/REWORK** para Fase 8.
- `34313fd` — **REWORK / BLOCKED**. Contiene migraciones y Worker CANON construidos
  sobre una base anterior. Existe conflicto de numeración con `0007_lab_workspace.sql`.
  `direct-prod-import.mjs` y `wrangler.prod.jsonc` permanecen **BLOCKED**.
- `051d38f` — **MIXED**. Evidencia del ciclo = **HISTORICAL**; `.gitignore` y
  `.dev.vars.example` = **REWORK** contra políticas actuales.

## Clasificación por archivo

### INTEGRATE — Fase 5A

- `tools/cloudflare-backup/src/backup-core.js`
- `tools/cloudflare-backup/src/workflow.js`
- `tools/cloudflare-backup/wrangler.jsonc`
- `tests/cloud-sync/d1-backup-workflow.test.mjs`
- `docs/V1.3_D1_BACKUP_AND_RECOVERY.md` (versión reescrita al estado actual)

### BLOCKED — no integrar mientras Pages/producción puedan activarse

- `POS/css/layout.css`
- `POS/index.html`
- `POS/js/legacy-inline/inline-02.js`
- `POS/js/legacy-inline/inline-03.js`
- `POS/js/legacy-inline/inline-12.js`
- `POS/js/sync/canonical-client.js`
- `POS/js/sync/canonical-sale-integration.js`
- `POS/js/sync/canonical-sale-intent.js`
- `POS/js/sync/canonical-sale-outbox.js`
- `POS/js/sync/canonical-sale-projection.js`
- `POS/js/sync/canonical-sale-view.js`
- `POS/js/sync/outbox.js`
- `POS/sw.js`
- `tools/cloudflare-lab/direct-prod-import.mjs`
- `tools/cloudflare-lab/wrangler.prod.jsonc`

### REWORK — rebase semántico obligatorio

- `tests/cloud-sync/a6-fixture.mjs`
- `tests/cloud-sync/canonical-activation.test.mjs`
- `tests/cloud-sync/canonical-client-browser.test.mjs`
- `tests/cloud-sync/canonical-client.test.mjs`
- `tests/cloud-sync/canonical-commerce.test.mjs`
- `tests/cloud-sync/canonical-financial.test.mjs`
- `tests/cloud-sync/canonical-promotion.test.mjs`
- `tests/cloud-sync/canonical-sale-integration.test.mjs`
- `tests/cloud-sync/canonical-sale-intent.test.mjs`
- `tests/cloud-sync/canonical-sale-outbox.test.mjs`
- `tests/cloud-sync/canonical-sale-projection.test.mjs`
- `tests/cloud-sync/canonical-sale-view.test.mjs`
- `tests/cloud-sync/client-renderer-collision.test.mjs`
- `tests/cloud-sync/d1-financial-local.test.mjs`
- `tests/cloud-sync/first-sale-recovery.test.mjs`
- `tests/cloud-sync/worker-fixture.mjs`
- `tools/cloudflare-lab/migrations/0007_canonical_commerce.sql`
- `tools/cloudflare-lab/migrations/0008_canonical_financial.sql`
- `tools/cloudflare-lab/migrations/0009_canonical_activation.sql`
- `tools/cloudflare-lab/scripts/build-reader.mjs`
- `tools/cloudflare-lab/src/a6-canonical.js`
- `tools/cloudflare-lab/src/a6-commerce.js`
- `tools/cloudflare-lab/src/a6-financial.js`
- `tools/cloudflare-lab/src/first-sale-recovery.mjs`
- `tools/cloudflare-lab/src/worker.js`
- `tools/cloudflare-lab/test/d1-canonical-local.test.mjs`
- `tools/cloudflare-lab/test/pwa-shell.test.mjs`
- `tools/cloudflare-lab/wrangler.jsonc`
- `tools/cloudflare-lab/.dev.vars.example`
- `.gitignore`

Migraciones: la serie del checkpoint no puede conservarse literalmente porque
`main` ya contiene `0007_lab_workspace.sql`. Si se promueven, deberán recibir
números nuevos después de validar dependencias y orden de aplicación; no se ejecutarán remotamente.

### SUPERSEDED / Fase documental

- `README.md` del checkpoint: no aplicar directamente; el README actual ya avanzó
  con las fases de remediación y se corregirá de forma canónica en Fase 8.

### HISTORICAL — conservar, no promover como estado vigente

- `evidence/v1.3/cycle-01/REPORT.md`
- `evidence/v1.3/cycle-01/pwa-audit.json`
- `evidence/v1.3/cycle-01/pwa-audit.mjs`

## Estado de hallazgos asociados

- H08: checkpoint preservado y clasificado; **parcialmente cerrado** hasta terminar
  las promociones REWORK/BLOCKED.
- H09: backup code promovible; migraciones aún **REWORK**.
- H12/H40: verificación operacional real de backup/restore = **OWNER_ONLY**.
- No se ha ejecutado ninguna migración CANON remota ni deploy Cloudflare.
