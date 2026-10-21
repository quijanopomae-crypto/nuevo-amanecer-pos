# Respaldos de Turso (migraciones CANON y respaldo diario): cómo restaurar

> **Aviso: los respaldos D1 ya no cubren producción.** Desde el corte a Turso, el Worker de producción usa `DB_PROVIDER=turso` y `wrangler.turso-prod.jsonc` no tiene binding D1. El respaldo diario de Cloudflare (`tools/cloudflare-backup`, 08:00 UTC) y el workflow `Owner Backup Recovery Drill` (`owner-backup-recovery-drill.yml`) siguen exportando solo el D1 `cf2c83d3-…`, que es la base anterior al corte: **respaldan datos viejos**. No se borraron, pero no sirven para recuperar producción. Los respaldos de Turso son los de esta página.

Hay tres fuentes de respaldo lógico de Turso, todas con el mismo contenido (esquema + todas las tablas, leídas en un solo batch transaccional con `backupSelectSql`) y el mismo sobre cifrado:

| Origen | Cuándo | Dónde queda | Clave de cifrado |
|---|---|---|---|
| `turso-daily-backup.yml` (`tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs`) | Diario 08:30 UTC (03:30 Lima) y manual | R2 privado `nuevo-amanecer-prod-v2-backups`, `turso-daily-backup/<fecha>-<commit>.json` + `.manifest.json` | Secreto dedicado `TURSO_BACKUP_ENCRYPTION_KEY` |
| `canon-migration-00NN.yml` | Antes de cada migración | R2 `nuevo-amanecer-prod-v2-backups`, `canon-migration-00NN/…` | Derivada de `TURSO_PROD_AUTH_TOKEN` |
| `v1.3-turso-prod-worker-hotfix.yml` (mismo script) | Antes de cada deploy de Worker; si la verificación falla, **no despliega** | R2 privado, `v1.3-turso-worker-hotfix/<fecha>-<commit>.json` + `.manifest.json` | Secreto dedicado `TURSO_BACKUP_ENCRYPTION_KEY` |

El respaldo diario y el del hotfix se restauran en cada corrida en un SQLite desechable del runner (pasos de abajo); si algo no cuadra la corrida **falla** y no se sube nada. Solo se suben a R2 si la verificación pasó.
- **El repositorio es público.** Por eso no se usan artefactos de GitHub, y el log y el resumen del run muestran solo PASS/FAIL, el número de tablas, si el digest total cuadra y el resultado de `quick_check`/`foreign_key_check`. Los conteos por tabla y los totales de dinero y stock quedan solo en el respaldo cifrado y en el manifiesto `.manifest.json` del R2 privado.
- El R2 no tiene regla de caducidad en el repo, así que los objetos se conservan hasta que el dueño defina una. El token de Cloudflare (`CLOUDFLARE_API_TOKEN`) debería tener permiso solo sobre ese bucket (acción del dueño).

Nota: `v1.3-turso-prod-debt-reconcile.yml` también toma un respaldo antes de escribir, pero es parcial (solo tablas de clientes/créditos), sin cifrar y con lecturas separadas; no sirve como respaldo completo.

### Migraciones
Cada workflow `canon-migration-00NN.yml` toma, **antes** de aplicar la migración, un respaldo lógico completo de Turso (esquema + todas las tablas, en una sola transacción de lectura). Lo cifra en el runner y lo sube a R2 (`nuevo-amanecer-prod-v2-backups`, clave `canon-migration-00NN/<fecha>-<commit>.json`). La clave R2 exacta y el sha256 quedan en el resumen del run.

## Cifrado (estado actual)
- AES-256-GCM. La clave se deriva con `sha256('nuevo-amanecer-contact-backup-v1\0' + <secreto>)`, donde `<secreto>` es `TURSO_BACKUP_ENCRYPTION_KEY` en el respaldo diario y `TURSO_PROD_AUTH_TOKEN` en los de migración y hotfix y se usa el AAD `nuevo-amanecer-contact-backup-v1` (ver `encryptBackup` en `tools/cloudflare-prod/scripts/turso-customer-contacts-maintenance.mjs`).
- El archivo es un JSON con `iv`, `tag` y `data` en base64.
- **Riesgo conocido (migraciones):** la clave sale del token de producción de Turso. Si ese token se rota, los respaldos anteriores solo se pueden descifrar con el token viejo. Antes de rotarlo, descifra los respaldos que quieras conservar y vuelve a cifrarlos.
- El respaldo diario ya usa una clave dedicada (`TURSO_BACKUP_ENCRYPTION_KEY`), así que rotar el token de Turso no lo afecta. El dueño crea ese secreto (aleatorio, 32+ caracteres, p. ej. `openssl rand -base64 48`) y **guarda una copia fuera de GitHub**: sin ella, ningún respaldo diario se puede descifrar. Si falta, el workflow falla con un mensaje claro; no usa el token como respaldo. Si se rota esta clave, los respaldos anteriores solo se descifran con la clave vieja.
- **Propuesta pendiente:** pasar también los respaldos de migración a `TURSO_BACKUP_ENCRYPTION_KEY` (cambio en `encryptBackup` y en cada `canon-migration-00NN`). No se hizo en este cambio.
- **Escala no verificada:** el snapshot lee todas las tablas en un solo batch (una transacción, una respuesta HTTP) para que sea consistente. Con datos reales grandes podría chocar con límites de tamaño o de tiempo de respuesta de Turso. Paginar por tabla en varias peticiones rompería la consistencia, porque el adaptador no mantiene una transacción entre peticiones. Si la corrida diaria empieza a fallar por tamaño, hay que rediseñarlo (p. ej. con `turso db shell .dump` o un export del proveedor).

## Restaurar (solo con autorización del dueño)
1. Obtén el archivo cifrado:
   - Respaldo diario o de hotfix: `npx wrangler r2 object get "nuevo-amanecer-prod-v2-backups/<clave>.json" --remote --file=turso-backup.enc.json` y `… <clave>.manifest.json … --file=turso-backup.manifest.json` (la clave sale del resumen del run). Comprueba que el sha256 del `.enc.json` coincide con `encrypted_sha256` del manifiesto y con el resumen del run.
   - Migración o hotfix: `npx wrangler r2 object get "nuevo-amanecer-prod-v2-backups/<clave>" --remote --file=backup.enc.json` y comprueba que su sha256 coincide con el del run.
2. Descifra y restaura en una máquina de confianza, con el secreto disponible solo como variable de entorno (nunca lo pegues en archivos ni en logs). El script hace todo en memoria y solo escribe la base restaurada si pasas `--out`:
   ```bash
   # Respaldo diario (clave dedicada):
   read -rs TURSO_BACKUP_ENCRYPTION_KEY && export TURSO_BACKUP_ENCRYPTION_KEY
   node tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs verify turso-backup.enc.json \
     --manifest turso-backup.manifest.json --out restored.sqlite --report verify-report.json
   # Respaldo de migración/hotfix (clave derivada del token de Turso vigente al respaldar):
   read -rs TURSO_PROD_AUTH_TOKEN && export TURSO_PROD_AUTH_TOKEN
   node tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs verify backup.enc.json \
     --key-env TURSO_PROD_AUTH_TOKEN --out restored.sqlite
   ```
   Imprime `TURSO_BACKUP_RESTORE_VERIFY_PASS` o `..._FAIL` con la lista de fallas, sin conteos, y sale con código 1 si falla. `--report` escribe el informe completo (conteos y totales por tabla) en un archivo local con permisos 0600: no lo subas a GitHub.
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
4. Para llevarlo a Turso (todavía **sin abrir el POS**): crea una base Turso **nueva o de staging** desde `restored.sqlite` (antes, pásala a WAL: `sqlite3 restored.sqlite "PRAGMA journal_mode=WAL; PRAGMA wal_checkpoint(TRUNCATE);"`; luego `turso db create <nombre> --from-file restored.sqlite`), verifica conteos y `financial_revision`, y solo entonces cambia el Worker a esa base. Todo lo escrito después del respaldo (ventas, aparatos emparejados) se pierde y los aparatos no lo detectan (ver T-48); avisa antes de cambiar.
5. **Antes de reabrir el POS: seguridad y accesos posteriores al respaldo.** La copia vuelve al estado de `created_at` del respaldo, así que:
   - **Revive sesiones de aparatos revocadas después del respaldo.** `/auth/devices/revoke` solo pone `status='revoked'` en `devices` y `auth_sessions`, sin fecha de revocación. Cómo encontrarlas: si la base anterior (la dañada) todavía se puede leer, compara `SELECT device_id,status FROM devices WHERE device_id LIKE 'session:%'` y `SELECT session_id,status FROM auth_sessions` entre esa base y la copia. Todo lo que allí está `revoked` y en la copia `active` se vuelve a revocar desde Configuración → «PIN del dueño y roles» → «Aparatos conectados». Si no se puede leer, revoca todos los aparatos que no reconozcas y vuelve a emparejar los que sigan en uso. Revisa también `pos_device_roles`: un rol de empleado asignado después del respaldo no existe en la copia, y ese aparato contaría como **dueño** (un aparato sin fila es del dueño).
   - **Vuelve el PIN del dueño anterior.** Si `pos_owner_pin.updated_at` de la base anterior es posterior al `created_at` del respaldo, o si el dueño recuerda haberlo cambiado, el PIN vigente pasa a ser el viejo, junto con su `failed_count`/`locked_until`. El dueño debe fijarlo de nuevo («Cambiar PIN del dueño», en la misma sección) antes de reabrir.
   - **Aprobaciones del dueño y códigos de emparejamiento.** Las `pos_owner_approvals` creadas después del respaldo no existen en la copia. Las de la copia con `used_at IS NULL` y `expires_at` en el futuro vuelven a poder usarse, igual que los `pos_pairing_codes` sin `used_at` y sin vencer. Antes de reabrir, invalida o deja vencer esas filas y vuelve a pedir las aprobaciones que hagan falta.
   - Aplica de nuevo todas las revocaciones y cambios de PIN hechos después del respaldo **antes** de reabrir el POS.
6. **Operaciones posteriores al respaldo que se pierden sin rastro.** Las anulaciones (`pos_sale_annulments`), compras y cierres de compra (`pos_purchases`, `pos_purchase_lines`, `pos_purchase_closures`), notas de venta (`pos_sale_notes`) y ajustes de inventario (`canonical_inventory_operations`, `canonical_manual_inventory_movements`) hechos después del respaldo **no quedan en ninguna cola ni diario de los aparatos**: el aparato las borra al confirmarlas. Tampoco las ventas confirmadas (ver T-48). Se pierden sin aviso y hay que **volver a ingresarlas a mano**, a partir de papeles, fotos o de la base anterior si aún se puede leer (filtra por `created_at` posterior al `created_at` del respaldo en esas tablas).
7. Limitaciones conocidas: `sqlite_sequence` no se respalda (los contadores AUTOINCREMENT se reinician) y se excluyen las filas `internal:img:%`/`internal:imgrate:%` de `pos_settings`. El formato JSON no representa BLOBs: si apareciera uno, la verificación falla en vez de restaurar mal.
8. Las migraciones son aditivas. Para deshacer solo una migración no hace falta restaurar: basta volver el Worker a un commit anterior. La tabla nueva queda sin uso.
9. Borra `backup.json`, `*.enc.json`, `verify-report.json` y `restored.sqlite` al terminar: contienen datos de clientes.
