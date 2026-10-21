# Respaldos de Turso (migraciones CANON y respaldo diario): cómo restaurar

> **Aviso: los respaldos D1 ya no cubren producción.** Desde el corte a Turso, el Worker de producción usa `DB_PROVIDER=turso` y `wrangler.turso-prod.jsonc` no tiene binding D1. El respaldo diario de Cloudflare (`tools/cloudflare-backup`, 08:00 UTC) y el workflow `Owner Backup Recovery Drill` (`owner-backup-recovery-drill.yml`) siguen exportando solo el D1 `cf2c83d3-…`, que es la base anterior al corte: **respaldan datos viejos**. No se borraron, pero no sirven para recuperar producción. Los respaldos de Turso son los de esta página.

Hay tres fuentes de respaldo lógico de Turso, todas con el mismo contenido (esquema + todas las tablas, leídas en un solo batch transaccional con `backupSelectSql`) y el mismo sobre cifrado:

| Origen | Cuándo | Dónde queda | Clave de cifrado |
|---|---|---|---|
| `turso-daily-backup.yml` (`tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs`) | Diario 08:30 UTC (03:30 Lima) y manual | Artefacto de GitHub `turso-backup-<run>-<intento>`, **90 días** (máximo de GitHub), junto a su manifiesto y el informe de verificación | Secreto dedicado `TURSO_BACKUP_ENCRYPTION_KEY` |
| `canon-migration-00NN.yml` | Antes de cada migración | R2 `nuevo-amanecer-prod-v2-backups`, `canon-migration-00NN/…` | Derivada de `TURSO_PROD_AUTH_TOKEN` |
| `v1.3-turso-prod-worker-hotfix.yml` | Antes de cada deploy de Worker | R2 `nuevo-amanecer-prod-v2-backups`, `v1.3-turso-worker-hotfix/…` | Derivada de `TURSO_PROD_AUTH_TOKEN` |

El respaldo diario se restaura en cada corrida en un SQLite desechable del runner (pasos de abajo) y la corrida **falla** si algo no cuadra; solo se sube el artefacto si la verificación pasó. Los artefactos de GitHub se borran a los 90 días: una copia fuera de GitHub requiere un almacenamiento que elija el dueño (no se agregó ninguno). Ojo: el repositorio es público, así que cualquier usuario con cuenta de GitHub puede descargar el artefacto; está cifrado y su seguridad depende de que `TURSO_BACKUP_ENCRYPTION_KEY` sea larga, aleatoria y secreta.

Nota: `v1.3-turso-prod-debt-reconcile.yml` también toma un respaldo antes de escribir, pero es parcial (solo tablas de clientes/créditos), sin cifrar y con lecturas separadas; no sirve como respaldo completo.

### Migraciones
Cada workflow `canon-migration-00NN.yml` toma, **antes** de aplicar la migración, un respaldo lógico completo de Turso (esquema + todas las tablas, en una sola transacción de lectura). Lo cifra en el runner y lo sube a R2 (`nuevo-amanecer-prod-v2-backups`, clave `canon-migration-00NN/<fecha>-<commit>.json`). La clave R2 exacta y el sha256 quedan en el resumen del run.

## Cifrado (estado actual)
- AES-256-GCM. La clave se deriva con `sha256('nuevo-amanecer-contact-backup-v1\0' + <secreto>)`, donde `<secreto>` es `TURSO_BACKUP_ENCRYPTION_KEY` en el respaldo diario y `TURSO_PROD_AUTH_TOKEN` en los de migración y hotfix y se usa el AAD `nuevo-amanecer-contact-backup-v1` (ver `encryptBackup` en `tools/cloudflare-prod/scripts/turso-customer-contacts-maintenance.mjs`).
- El archivo es un JSON con `iv`, `tag` y `data` en base64.
- **Riesgo conocido (migración y hotfix):** la clave sale del token de producción de Turso. Si ese token se rota, los respaldos anteriores solo se pueden descifrar con el token viejo. Antes de rotarlo, descifra los respaldos que quieras conservar y vuelve a cifrarlos.
- El respaldo diario ya usa una clave dedicada (`TURSO_BACKUP_ENCRYPTION_KEY`), así que rotar el token de Turso no lo afecta. El dueño crea ese secreto (aleatorio, 32+ caracteres, p. ej. `openssl rand -base64 48`) y **guarda una copia fuera de GitHub**: sin ella, ningún respaldo diario se puede descifrar. Si falta, el workflow falla con un mensaje claro; no usa el token como respaldo. Si se rota esta clave, los artefactos anteriores solo se descifran con la clave vieja.
- **Propuesta pendiente:** pasar también los respaldos de migración y hotfix a `TURSO_BACKUP_ENCRYPTION_KEY` (cambio en `encryptBackup` y en cada workflow). No se hizo en este cambio.

## Restaurar (solo con autorización del dueño)
1. Obtén el archivo cifrado:
   - Respaldo diario: descarga el artefacto `turso-backup-<run>-<intento>` del run (Actions → run → Artifacts, o `gh run download <run-id> -n turso-backup-<run>-<intento>`). Trae `turso-backup.enc.json`, `turso-backup.manifest.json` y `turso-backup.verify-report.json`. Comprueba que el sha256 del `.enc.json` coincide con `encrypted_sha256` del manifiesto y con el resumen del run.
   - Migración o hotfix: `npx wrangler r2 object get "nuevo-amanecer-prod-v2-backups/<clave>" --remote --file=backup.enc.json` y comprueba que su sha256 coincide con el del run.
2. Descifra y restaura en una máquina de confianza, con el secreto disponible solo como variable de entorno (nunca lo pegues en archivos ni en logs). El script hace todo en memoria y solo escribe la base restaurada si pasas `--out`:
   ```bash
   # Respaldo diario (clave dedicada):
   read -rs TURSO_BACKUP_ENCRYPTION_KEY && export TURSO_BACKUP_ENCRYPTION_KEY
   node tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs verify turso-backup.enc.json \
     --manifest turso-backup.manifest.json --out restored.sqlite
   # Respaldo de migración/hotfix (clave derivada del token de Turso vigente al respaldar):
   read -rs TURSO_PROD_AUTH_TOKEN && export TURSO_PROD_AUTH_TOKEN
   node tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs verify backup.enc.json \
     --key-env TURSO_PROD_AUTH_TOKEN --out restored.sqlite
   ```
   Imprime `TURSO_BACKUP_RESTORE_VERIFY_PASS` o `..._FAIL` con la lista de fallas y sale con código 1 si falla.
3. Orden de restauración (es el que aplica el script; si restauras a mano, síguelo igual). El orden anterior de este documento, con claves foráneas activas, **falla** con `FOREIGN KEY constraint failed` en `canonical_cash_sessions`:
   1. Base destino **nueva y vacía** (nunca la de producción).
   2. `PRAGMA foreign_keys=OFF`.
   3. Crear las tablas (`schema` con `type='table'`).
   4. Insertar las filas de `tables`, todas en **una sola transacción** (`BEGIN` … `COMMIT`).
   5. Crear índices y vistas.
   6. Crear los triggers **al final**, para que no se disparen durante la carga (libro inmutable).
   7. `PRAGMA foreign_keys=ON`.
   8. `PRAGMA foreign_key_check` debe devolver **0 filas** y `PRAGMA quick_check` debe dar **`ok`**. Si no, aborta.
   9. Compara conteo y digest por tabla con el manifiesto (el script lo hace con `--manifest`), y revisa ventas, `sale_items`, caja (`canonical_cash_sessions`, `cash_movements`), `canonical_command_receipts`, stock (`canonical_live_products`) y `canonical_control`.
4. Para llevarlo a Turso: crea una base Turso **nueva o de staging** desde `restored.sqlite` (antes, pásala a WAL: `sqlite3 restored.sqlite "PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE);"`; luego `turso db create <nombre> --from-file restored.sqlite`), verifica conteos y `financial_revision`, y solo entonces cambia el Worker a esa base. Todo lo escrito después del respaldo (ventas, aparatos emparejados) se pierde y los aparatos no lo detectan (ver T-48); avisa antes de cambiar.
5. Limitaciones conocidas: `sqlite_sequence` no se respalda (los contadores AUTOINCREMENT se reinician) y se excluyen las filas `internal:img:%`/`internal:imgrate:%` de `pos_settings`. El formato JSON no representa BLOBs: si apareciera uno, la verificación falla en vez de restaurar mal.
6. Las migraciones son aditivas. Para deshacer solo una migración no hace falta restaurar: basta volver el Worker a un commit anterior. La tabla nueva queda sin uso.
7. Borra `backup.json`, `*.enc.json` y `restored.sqlite` al terminar: contienen datos de clientes.
