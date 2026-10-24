# Respaldos de Turso (diario, hotfix y migraciones CANON): cómo restaurar

> **Aviso: los respaldos D1 ya no cubren producción.** Desde el corte a Turso, el Worker de producción usa `DB_PROVIDER=turso` y `wrangler.turso-prod.jsonc` no tiene binding D1. El respaldo diario de Cloudflare (`tools/cloudflare-backup`, 08:00 UTC) y el workflow `Owner Backup Recovery Drill` (`owner-backup-recovery-drill.yml`) siguen exportando solo el D1 `cf2c83d3-…`, que es la base anterior al corte: **respaldan datos viejos**. No se borraron, pero no sirven para recuperar producción. Los respaldos de Turso son los de esta página.

## Qué respaldo es cuál, qué clave lo abre y dónde está

| Tipo de respaldo | Workflow (cuándo) | Contenido | Qué lo abre | Dónde está |
|---|---|---|---|---|
| **Diario** | `turso-daily-backup.yml` (diario 08:30 UTC = 03:30 Lima, y manual) | Completo (esquema + todas las tablas) | **`TURSO_BACKUP_ENCRYPTION_KEY`** (clave dedicada). La huella de la clave va en el `.enc.json` y en el manifiesto | R2 privado `nuevo-amanecer-prod-v2-backups`: `turso-daily-backup/<fecha>-<commit>.json` + `.manifest.json` (manifiesto también cifrado) |
| **Hotfix de Worker** | `v1.3-turso-prod-worker-hotfix.yml` (antes de cada deploy; si la verificación falla, **no despliega**) | Completo (el mismo script que el diario) | **`TURSO_BACKUP_ENCRYPTION_KEY`** (clave dedicada), con huella igual que el diario | R2 privado: `v1.3-turso-worker-hotfix/<fecha>-<commit>.json` + `.manifest.json` |
| **Migración CANON** | `canon-migration-00NN.yml` (antes de cada migración) | Completo | **`TURSO_PROD_AUTH_TOKEN` vigente cuando se tomó** (clave derivada del token, sin huella) | R2 privado: `canon-migration-00NN/<fecha>-<commit>.json` |
| **Conciliación de deuda** | `v1.3-turso-prod-debt-reconcile.yml` (antes de escribir) | **Parcial** (solo tablas de clientes y créditos, con lecturas separadas) | **Ninguna: no está cifrado** (JSON en claro) | R2 privado: `v1.3-debt-reconcile-turso/<fecha>-<commit>.json` |

Los tres cifrados usan el mismo sobre y el mismo snapshot: esquema + todas las tablas, leídas en un solo batch transaccional con `backupSelectSql`. El de conciliación de deuda no sirve como respaldo completo.

El respaldo diario y el del hotfix se restauran en cada corrida en un SQLite desechable del runner (pasos de abajo). Si algo no cuadra, la corrida **falla** y no se sube nada: solo llegan a R2 si la verificación pasó.
- **El repositorio es público.** Por eso no se usan artefactos de GitHub. El log y el resumen del run muestran solo PASS/FAIL, el número de tablas, si el digest total cuadra, `quick_check`/`foreign_key_check`, la huella de la clave y «tamaño OK / NEAR LIMIT». Los conteos por tabla y los totales de dinero y stock van solo **cifrados**: en el respaldo y en el manifiesto. En R2 quedan en claro solo el formato, la huella y el sha256.
- **Caducidad en R2:** no hay regla en el repo, así que los objetos se conservan hasta que el dueño defina una (decisión del dueño, p. ej. para `turso-daily-backup/` y `v1.3-turso-worker-hotfix/`).
- **Token de Cloudflare:** el diario usa `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` solo en el paso de R2. Ese token lo comparten unos 27 workflows de deploy, así que **no se puede limitar al bucket** sin romperlos. Lo recomendado es que el dueño decida crear un secreto aparte solo para R2 (Object Read & Write sobre `nuevo-amanecer-prod-v2-backups`) y usarlo en ese paso. No se agregó en este cambio. En el hotfix, los secretos de Cloudflare están a nivel de job desde antes de este cambio; los pasos de respaldo y verificación los reciben vacíos.
- **Escala no verificada:** el snapshot lee todas las tablas en un solo batch (una transacción, una respuesta HTTP) para que sea consistente. Con datos reales grandes podría chocar con límites de tamaño o de tiempo de respuesta de Turso. Paginar por tabla en varias peticiones rompería la consistencia, porque el adaptador no mantiene una transacción entre peticiones. Si el snapshot supera 16 MiB (el mismo tope de seguridad del respaldo D1; se cambia con `TURSO_BACKUP_WARN_BYTES`), la corrida emite un `::warning::` sin cifras y el resumen dice «NEAR LIMIT». En ese caso hay que rediseñarlo (p. ej. con `turso db shell .dump` o un export del proveedor).

## Cifrado y custodia de la clave
- AES-256-GCM. La clave se deriva con `sha256('nuevo-amanecer-contact-backup-v1\0' + <secreto>)`, con AAD `nuevo-amanecer-contact-backup-v1` (ver `encryptBackup` en `tools/cloudflare-prod/scripts/turso-customer-contacts-maintenance.mjs`). `<secreto>` es el de la tabla de arriba. El archivo es un JSON con `iv`, `tag` y `data` en base64; el diario y el hotfix agregan `key_fingerprint`.
- **Huella de la clave:** los primeros 16 hex de `sha256('nuevo-amanecer-backup-key-fingerprint-v1\0' + clave)`. No es la clave ni permite descifrar, pero dice qué clave abre cada respaldo después de una rotación. `verify` compara la huella **antes** de descifrar y, si no coincide, falla con `… was encrypted with a different key: fingerprint X, provided key Y`.
- **Paso obligatorio del dueño al crear `TURSO_BACKUP_ENCRYPTION_KEY`** (genérala **solo** con `openssl rand -base64 48`; nunca una frase, palabra o PIN: la huella se publica en el resumen sin sal, así que solo es segura si la clave es de verdad aleatoria):
  1. Guarda la clave **fuera de GitHub**, en un lugar que solo controle el dueño. Por ejemplo, un gestor de contraseñas o una copia en papel en un lugar seguro; el lugar lo elige el dueño. Los GitHub Secrets no se pueden leer: si la clave solo vive ahí, **ningún respaldo diario ni del hotfix se puede restaurar** fuera del runner.
  2. Comprueba que tu copia es la correcta: en una máquina de confianza, `read -rs TURSO_BACKUP_ENCRYPTION_KEY && export TURSO_BACKUP_ENCRYPTION_KEY` y `node tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs fingerprint`. La huella impresa tiene que ser igual a «Backup key fingerprint» del resumen del run. Con un archivo descargado de R2, `… fingerprint turso-backup.enc.json` imprime también `"match":true/false`. El comando nunca imprime la clave.
  3. Una vez, haz una restauración de prueba local con tu copia sobre un respaldo de R2 (`verify … --manifest …`, abajo).
- **Rotación de la clave dedicada:** los respaldos anteriores solo se abren con la clave vieja. Conserva cada clave vieja, anotando su huella, mientras queden en R2 respaldos con esa huella, o descifra y vuelve a cifrar los que quieras conservar.
- **Riesgo conocido (migraciones):** su clave sale del token de producción de Turso. Si ese token se rota, los respaldos anteriores solo se pueden descifrar con el token viejo. Antes de rotarlo, descifra los respaldos que quieras conservar y vuelve a cifrarlos. **Propuesta pendiente:** pasar las migraciones a `TURSO_BACKUP_ENCRYPTION_KEY` (cambio en `encryptBackup` y en cada `canon-migration-00NN`); no se hizo en este cambio.

## Restaurar (solo con autorización del dueño)
1. Obtén el archivo (la clave R2 exacta y el sha256 están en el resumen del run):
   - **Diario u hotfix:** `npx wrangler r2 object get "nuevo-amanecer-prod-v2-backups/<clave>.json" --remote --file=turso-backup.enc.json` y lo mismo con `<clave>.manifest.json` → `turso-backup.manifest.json`. Comprueba que el sha256 del `.enc.json` coincide con el del run y con `backup_encrypted_sha256` del manifiesto.
   - **Migración CANON:** `npx wrangler r2 object get "nuevo-amanecer-prod-v2-backups/canon-migration-00NN/<…>.json" --remote --file=backup.enc.json` y comprueba su sha256 con el del run.
   - **Conciliación de deuda:** no está cifrado y es parcial; no se restaura con este procedimiento.
2. Descifra y restaura en una máquina de confianza, con el secreto solo como variable de entorno (nunca lo pegues en archivos ni en logs). El script trabaja en memoria y solo escribe la base restaurada si pasas `--out`:
   ```bash
   # Diario u hotfix (clave dedicada; antes comprueba la huella con `… fingerprint turso-backup.enc.json`):
   read -rs TURSO_BACKUP_ENCRYPTION_KEY && export TURSO_BACKUP_ENCRYPTION_KEY
   node tools/cloudflare-prod/scripts/turso-scheduled-backup.mjs verify turso-backup.enc.json \
     --manifest turso-backup.manifest.json --out restored.sqlite --report verify-report.json
   # Migración CANON (clave derivada del TURSO_PROD_AUTH_TOKEN vigente cuando se tomó; sin manifiesto):
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
   - **Vuelve a revocar las sesiones de aparatos revocadas después del respaldo (la copia las revive).** `/auth/devices/revoke` solo pone `status='revoked'` en `devices` y `auth_sessions`, sin fecha de revocación. Cómo encontrarlas: si la base anterior (la dañada) todavía se puede leer, compara `SELECT device_id,status FROM devices WHERE device_id LIKE 'session:%'` y `SELECT session_id,status FROM auth_sessions` entre esa base y la copia. Todo lo que allí está `revoked` y en la copia `active` se vuelve a revocar desde Configuración → «PIN del dueño y roles» → «Aparatos conectados». Si no se puede leer, revoca todos los aparatos que no reconozcas y vuelve a emparejar los que sigan en uso. Revisa también `pos_device_roles`: un rol de empleado asignado después del respaldo no existe en la copia, y ese aparato contaría como **dueño** (un aparato sin fila es del dueño).
   - **Vuelve el PIN del dueño anterior.** Si `pos_owner_pin.updated_at` de la base anterior es posterior al `created_at` del respaldo, o si el dueño recuerda haberlo cambiado, el PIN vigente pasa a ser el viejo, junto con su `failed_count`/`locked_until`. El dueño debe fijarlo de nuevo («Cambiar PIN del dueño», en la misma sección) antes de reabrir.
   - **Aprobaciones del dueño y códigos de emparejamiento.** Las `pos_owner_approvals` creadas después del respaldo no existen en la copia. Las de la copia con `used_at IS NULL` y `expires_at` en el futuro vuelven a poder usarse, igual que los `pos_pairing_codes` sin `used_at` y sin vencer. Antes de reabrir, invalida o deja vencer esas filas y vuelve a pedir las aprobaciones que hagan falta.
   - Aplica de nuevo todas las revocaciones y cambios de PIN hechos después del respaldo **antes** de reabrir el POS.
6. **Operaciones posteriores al respaldo que se pierden sin rastro.** Las anulaciones (`pos_sale_annulments`), compras y cierres de compra (`pos_purchases`, `pos_purchase_lines`, `pos_purchase_closures`), notas de venta (`pos_sale_notes`) y ajustes de inventario (`canonical_inventory_operations`, `canonical_manual_inventory_movements`) hechos después del respaldo **no quedan en ninguna cola ni diario de los aparatos**: el aparato las borra al confirmarlas. Tampoco las ventas confirmadas (ver T-48). Se pierden sin aviso y hay que **volver a ingresarlas a mano**, a partir de papeles, fotos o de la base anterior si aún se puede leer (filtra por `created_at` posterior al `created_at` del respaldo en esas tablas).
7. Limitaciones conocidas: `sqlite_sequence` no se respalda (los contadores AUTOINCREMENT se reinician) y se excluyen las filas `internal:img:%`/`internal:imgrate:%` de `pos_settings`. El formato JSON no representa BLOBs: si apareciera uno, la verificación falla en vez de restaurar mal.
8. Las migraciones son aditivas. Para deshacer solo una migración no hace falta restaurar: basta volver el Worker a un commit anterior. La tabla nueva queda sin uso.
9. Borra `backup.json`, `*.enc.json`, `verify-report.json` y `restored.sqlite` al terminar: contienen datos de clientes.
