# LAB CANON Mirror — CANON -> D1 LAB -> POS-LAB

## Objetivo

Permitir que el POS-LAB pruebe con una copia real de los datos de CANON sin que ninguna
modificación experimental pueda regresar a CANON.

## Arquitectura

```text
R2 CANON backups
nuevo-amanecer-prod-v2-backups
          |
          | GET solamente
          | token R2 Storage Read
          v
Worker LAB
nuevo-amanecer-sync-lab
          |
          v
D1 LAB
nuevo-amanecer-lab
  + baseline inmutable
  + workspace revisionado/mutable
          |
          v
POS-LAB GitHub Pages
```

No existe ruta LAB -> R2 CANON ni LAB -> D1 de producción.

## Modelo de datos LAB

La migración `0007_lab_workspace.sql` crea:

- `lab_workspace_baselines`: copia inmutable de cada backup CANON aceptado;
- `lab_workspace_revisions`: cada modificación LAB crea una revisión nueva;
- `lab_workspace_control`: puntero a la revisión activa y baseline activo.

El workspace principal se llama `primary`.

## Refresh CANON -> LAB

El formato real del bucket es un par por respaldo:

```text
<timestamp>.manifest.json
<timestamp>.sql
```

La importación autoritativa se ejecuta desde GitHub Actions, no dentro del navegador ni
interpretando SQL en el Worker:

1. `fetch-latest-canon-backup.mjs` lista R2 con **GET** y selecciona el `.sql` más reciente.
2. Descarga el `.sql` y su `.manifest.json` compañero, también con **GET**.
3. `fetch-latest-canon-backup.mjs` exige un manifiesto compañero válido con formato
   `nuevo-amanecer-d1-backup-v1`, `status: PASS`, database ID esperado, bookmark,
   `sql_key`, tamaño y SHA-256 que coincidan exactamente con el SQL descargado. Si
   cualquiera falla, el flujo termina antes de cualquier escritura remota.
4. `lab-snapshot-from-sql.py` restaura el dump en SQLite temporal, ejecuta
   `PRAGMA integrity_check`, resuelve la promoción canónica activa y reconstruye un
   snapshot POS V9 **parcial y explícito**: productos, clientes, créditos y pagos de
   crédito. Ventas, gastos, movimientos de caja, cierres e inventory movements quedan
   vacíos por diseño y no deben interpretarse como espejo comercial completo.
5. `publish-lab-snapshot.mjs` firma `source_ref + source_hash + snapshot_hash`
   mediante HMAC-SHA256 usando `LAB_IMPORT_HMAC_SECRET`, independiente del token R2.
6. El Worker verifica la firma con ese secreto dedicado en `POST /lab/workspace/import-baseline`.
7. D1 LAB crea un baseline inmutable y una nueva revisión de trabajo.
8. Si `source_hash` ya es el baseline activo, responde `no_change` y no pisa las
   modificaciones LAB.

Workflow manual:

```text
Actions -> Refresh LAB Data -> Run workflow
```

El workflow de despliegue `Deploy LAB Cloud` también ejecuta una primera importación
del backup SQL más reciente después de actualizar Worker y migraciones.

## Alcance del snapshot importado

El baseline D1 LAB reconstruido desde SQL incluye únicamente:

- productos;
- clientes;
- créditos;
- pagos contenidos dentro de los créditos.

Por diseño actual, el conversor inicializa vacíos: `ventas`, `gastos`, `cajMovs`,
`cashClosures` e `inventoryMovements`. Por tanto, una pantalla LAB puede usar datos
reales para las entidades incluidas, pero no debe inferir que las familias omitidas
representan el histórico CANON completo.

## Escrituras experimentales

`POST /lab/workspace/save` requiere:

- dispositivo LAB `writer` activo;
- `expected_revision`;
- `operation_id` único;
- snapshot válido.

La actualización usa revisión optimista. Si otra pestaña/dispositivo avanzó la revisión,
devuelve `409 revision_conflict` en vez de sobrescribir silenciosamente.

El cliente conserva de forma durable la operación pendiente (`operation_id`, revisión esperada
y snapshot exacto) hasta recibir ACK. Un ACK perdido reintenta la misma operación, no crea otra.
Si existe una edición local pendiente durante el arranque, el snapshot D1 no se aplica encima de
ella: primero se intenta conciliar la intención local.

El Worker vuelve a comprobar dentro del commit que el dispositivo sigue siendo el writer activo
con la misma credencial; una revocación entre autenticación y commit falla cerrada.

Las revisiones anteriores permanecen en D1 LAB.

## Restaurar baseline

`POST /lab/workspace/reset` exige `expected_revision` y crea una nueva revisión copiando
el baseline activo. Un reset ciego o basado en una revisión vieja se rechaza; no borra historial
y no toca CANON.

## Lectura

`GET /lab/workspace` admite:

- `x-read-token`, o
- credenciales de un dispositivo LAB válido.

Los datos reales nunca se incorporan al HTML, GitHub Pages ni al repositorio.

## Frontera R2

La integración R2 ejecuta únicamente:

- `GET /accounts/{account}/r2/buckets/{bucket}/objects`
- `GET /accounts/{account}/r2/buckets/{bucket}/objects/{key}`

No existe PUT, POST, PATCH ni DELETE hacia R2 CANON.

`R2_CANON_READ_TOKEN` debe ser un **Cloudflare API Token** limitado al bucket
`nuevo-amanecer-prod-v2-backups` con permiso **Workers R2 Storage Read**. No usar
un token S3 Object Read-only para este workflow REST.

## Separación de secretos

Cada responsabilidad usa un secreto distinto:

```text
R2_CANON_READ_TOKEN
  -> solo GitHub Actions/CLI para GET de R2 CANON

LAB_IMPORT_HMAC_SECRET
  -> solo firma en GitHub Actions y verificación de /lab/workspace/import-baseline

DEVICE_CREDENTIAL_PEPPER
  -> solo HMAC de credenciales de dispositivos en el Worker
```

GitHub Actions requiere `CLOUDFLARE_ACCOUNT_ID`, `R2_CANON_READ_TOKEN` y
`LAB_IMPORT_HMAC_SECRET` para el refresh. La provisión de dispositivos usa
`DEVICE_CREDENTIAL_PEPPER` y `LAB_DEVICE_SYNC_TOKEN`, nunca el token R2.

El Worker no recibe `R2_CANON_READ_TOKEN`. Para local, `.dev.vars` contiene
únicamente secretos del Worker. El token R2 se pasa solo al proceso que ejecuta
`fetch-latest-canon-backup.mjs`.

Para remoto, nunca versionar valores. La configuración real de los secretos
nuevos es una acción OWNER_ONLY y debe realizarse antes de volver a ejecutar los
workflows manuales de deploy/refresh/provision.

## Configuración del celular

Abrir:

```text
https://quijanopomae-crypto.github.io/nuevo-amanecer-pos/laboratorio/pos-lab/index.html
```

Tocar la insignia **LAB** inferior y configurar una de estas opciones:

- READ_TOKEN para carga de solo lectura; o
- Device ID + SYNC_TOKEN LAB para cargar y guardar cambios.

Para usar **CANON -> LAB**, guardar Device ID + SYNC_TOKEN de un writer LAB.

Las credenciales solo se guardan en el almacenamiento del navegador si el usuario marca
"Recordar credenciales". Nunca se escriben en GitHub.

## Pruebas

```powershell
node --test tools/cloudflare-lab/test/lab-workspace.test.mjs
node --test tests/laboratorio-pos-html.test.mjs tests/laboratorio-html-build.test.mjs
node laboratorio/pos-lab/build-lab.mjs --check
```

## Invariantes

- CANON -> LAB: permitido.
- LAB -> CANON: no existe.
- R2 CANON: GET solamente.
- D1 LAB: mutable y revisionado.
- Datos reales en GitHub: prohibido.
- Valores de credenciales versionados en Git/repo: prohibidos.
- GitHub Actions Secrets cifrados: permitidos únicamente para workflows autorizados; nunca imprimir ni exponer sus valores.
- `POS/**`: no se modifica para esta integración.
