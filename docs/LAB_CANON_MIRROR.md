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

`POST /lab/workspace/refresh-from-canon`:

1. autentica un dispositivo writer LAB;
2. lista objetos del bucket R2 usando un token server-side de solo lectura;
3. selecciona el JSON más reciente bajo el prefijo configurado;
4. descarga el objeto mediante GET;
5. verifica el wrapper `nuevo-amanecer-pos-backup` y SHA-256 `payload-json` cuando existe;
6. valida el snapshot V8/V9;
7. elimina `cloudSync`, carrito, borrador, seguridad y locks de producción;
8. guarda un baseline inmutable en D1 LAB;
9. crea una nueva revisión de trabajo LAB.

Si el SHA-256 del backup fuente es igual al baseline activo, devuelve `no_change` y
NO pisa las modificaciones actuales del workspace.

Un backup CANON nuevo requiere confirmación explícita desde el panel LAB y reemplaza
el workspace de prueba por la nueva copia.

## Escrituras experimentales

`POST /lab/workspace/save` requiere:

- dispositivo LAB `writer` activo;
- `expected_revision`;
- `operation_id` único;
- snapshot válido.

La actualización usa revisión optimista. Si otra pestaña/dispositivo avanzó la revisión,
devuelve `409 revision_conflict` en vez de sobrescribir silenciosamente.

Las revisiones anteriores permanecen en D1 LAB.

## Restaurar baseline

`POST /lab/workspace/reset` crea una nueva revisión copiando el baseline activo. No
borra historial y no toca CANON.

## Lectura

`GET /lab/workspace` admite:

- `x-read-token`, o
- credenciales de un dispositivo LAB válido.

Los datos reales nunca se incorporan al HTML, GitHub Pages ni al repositorio.

## Frontera R2

El Worker usa únicamente:

- `GET /accounts/{account}/r2/buckets/{bucket}/objects`
- `GET /accounts/{account}/r2/buckets/{bucket}/objects/{key}`

No implementa PUT, POST, PATCH ni DELETE contra R2 CANON.

El token `R2_CANON_READ_TOKEN` debe crearse con **Workers R2 Storage Read** solamente.

## Configuración del Worker

Variables/secretos requeridos:

```text
R2_CANON_ACCOUNT_ID=<account id>
R2_CANON_READ_TOKEN=<token de solo lectura>
```

Valores por defecto en código:

```text
R2_CANON_BUCKET=nuevo-amanecer-prod-v2-backups
R2_CANON_PREFIX=nuevo-amanecer-prod-v2/
```

Para local pueden colocarse en `tools/cloudflare-lab/.dev.vars`, que está ignorado por Git.

Para remoto, nunca versionar secretos:

```powershell
cd tools/cloudflare-lab
npx wrangler secret put R2_CANON_ACCOUNT_ID
npx wrangler secret put R2_CANON_READ_TOKEN
npm run migrate:remote
npm run deploy
```

Antes de `migrate:remote` o `deploy`, ejecutar pruebas locales.

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
- Credenciales en GitHub: prohibido.
- `POS/**`: no se modifica para esta integración.
