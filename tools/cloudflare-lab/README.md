# cloudflare-lab

Capa cloud de V1.2 del POS Nuevo Amanecer. V9 conserva la autoridad local; el
OUTBOX envía nuevas ventas, líneas y movimientos. El segundo dispositivo solo consulta.

```
POS V9 (autoridad local) → OUTBOX atómico → Worker (gateway) → D1 sync_operations
```

## Recursos

| Recurso | Valor |
|---|---|
| D1 | `nuevo-amanecer-lab` · `e734e6f1-41c4-4bfa-ab1f-5acbcdd2272e` · ENAM |
| Binding | `env.nuevo_amanecer_lab` |
| Worker | `nuevo-amanecer-sync-lab` |
| URL | `https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev` |

## Contrato de `sync_operations`

`operation_id` es la clave de idempotencia. El Worker hace `INSERT … ON CONFLICT(operation_id) DO NOTHING` y decide por el resultado:

| Situación | Respuesta |
|---|---|
| `operation_id` nuevo | `201 {status:"inserted"}` |
| mismo `operation_id`, mismo `payload_hash` | `200 {status:"already_processed"}` — no se inserta duplicado |
| mismo `operation_id`, `payload_hash` distinto | `409 {status:"conflict"}` — **no se sobrescribe** |
| `payload_hash` ≠ sha256(payload) | `400 payload_hash_mismatch` |

Nunca Last-Push-Wins sobre ventas, dinero o inventario.

Campos técnicos añadidos a los obligatorios: `received_at` (hora del servidor, default en D1) y el índice `(device_id, device_sequence)` para el futuro "¿última secuencia recibida de esta caja?".

## Endpoints

- `GET /health` → `{ok, d1}`; público.
- `POST /sync/operations` → inserta una operación (JSON con los 8 campos).
- `GET /sync/operations/:operation_id` → devuelve la fila.

Los endpoints `/sync/*` autentican el dispositivo contra D1. La PWA conserva su
configuración A1: envía su credencial en `x-sync-token` y el `device_id` estable en
la operación. `x-device-id` es obligatorio para consultas y, cuando se envía en un
POST, debe coincidir con el payload. Solo un dispositivo `writer` y `active` puede
escribir; `read_only`, `revoked` y credenciales inválidas se rechazan antes de la
escritura.

La migración `0003_device_auth.sql` crea el registro durable y un índice parcial
único que impide más de un writer activo. `credential_hash` guarda únicamente
`HMAC-SHA-256(DEVICE_CREDENTIAL_PEPPER, credencial)`. El pepper se configura como
secreto del Worker y nunca se almacena en D1; la credencial en texto plano tampoco.
`created_at` y `last_seen_at` usan hora del servidor.

Para preparar localmente el SQL de alta, definir `DEVICE_ID`, `DEVICE_ROLE`,
`DEVICE_CREDENTIAL` y `DEVICE_CREDENTIAL_PEPPER`, todos salvo el rol fuera de
archivos versionados, y ejecutar `node scripts/device-auth-sql.mjs register`.
La salida contiene solo el hash y se aplica mediante el flujo normal de D1. Para
revocar, basta `DEVICE_ID=<id> node scripts/device-auth-sql.mjs revoke`. No pasar
credenciales como argumentos de Wrangler ni conservar el SQL generado.

El alta requiere credencial y pepper distintos, cada uno generado con 32 bytes
aleatorios y codificado como 64 caracteres hexadecimales minúsculos. El pepper
debe ser el mismo en la provisión y el Worker; nunca se entrega al navegador.
Se provisiona el `device_id` que ya conserva `NuevoAmanecerOutbox.snapshot()`;
no se regenera la identidad ni se modifica el OUTBOX existente. La revocación se
aplica por SQL administrativo, no por un endpoint público de auto-registro.
Un cambio de writer exige revocar primero al anterior. No reutilizar credenciales.

A2 no aplica migraciones ni secretos a producción. El Worker V1.2 publicado no
cambia. La futura activación necesita primero la migración, el pepper y el alta
del dispositivo; sin ellos el nuevo Worker falla cerrado. El token global
`SYNC_TOKEN` por sí solo ya no autoriza. El visor A1 conserva su acceso de lectura
separado con `READ_TOKEN`, que nunca permite escribir.

Pruebas A2 desde la raíz (sin evidencia histórica, servicios remotos ni release gates):

```sh
node --test tests/cloud-sync/device-auth.test.mjs tests/cloud-sync/worker-cors.test.mjs tests/cloud-sync/read-only.test.mjs tests/cloud-sync/outbox-sync.test.mjs
node --test tools/cloudflare-lab/test/pwa-shell.test.mjs tests/release-local-server.test.mjs
node --test tools/cloudflare-lab/test/pwa-browser.test.mjs
```

Consultas autenticadas mediante `x-read-token` y el secreto independiente `READ_TOKEN`:

- `GET /read/status`
- `GET /read/sales`
- `GET /read/sales/{saleId}/items`
- `GET /read/inventory-movements`

Las listas aceptan `limit` (25 por defecto, máximo 100) y `cursor` opaco.
La lectura anuncia únicamente `GET, OPTIONS` y `x-read-token` en CORS;
las respuestas JSON usan `Cache-Control: no-store`.

`POS/read-only.html` carga exclusivamente el cliente de consulta. Se entrega junto
a `POS/js/sync/read-only.js`, conservando esa estructura. La clave de lectura se
introduce en el visor y permanece en la sesión; nunca usar allí la clave de escritura.

Visor publicado: `https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev/read-only.html`.
En esta rama V1.3, el build `scripts/build-reader.mjs` prepara 52 archivos de un
allowlist explicito: el visor y el shell PWA bajo `POS/`, en `.reader-assets/`
(ignorado por Git). Este cambio queda limitado a un nuevo preview HTTPS y prueba
Android fisica; no autoriza deploy de produccion ni cutover. Nunca publicar la raiz
del repositorio.

Pruebas focalizadas A1 desde la raiz del repositorio, sin regenerar evidencia historica:

```sh
node tools/cloudflare-lab/scripts/build-reader.mjs
node --test tools/cloudflare-lab/test/pwa-shell.test.mjs tests/release-local-server.test.mjs
```

El service worker conserva HTML y dependencias en la cache de su generacion,
tambien al recargar online. Una actualizacion espera al cierre de todas las pestanas
controladas; no fuerza recarga ni activacion durante una venta. Si falta un recurso
de esa cache responde 503, sin mezclarlo con otra generacion. El servidor local
calcula la generacion al arrancar: reiniciarlo despues de cambiar archivos del POS.

## Ejecutar

```sh
npm install
cp .dev.vars.example .dev.vars      # poner un valor aleatorio largo
npm run migrate:local
npm run dev                         # en otra terminal:
DEVICE_ID=<device_id provisionado> SYNC_TOKEN=<credencial del dispositivo> npm run test:worker
npm run test:d1:local               # contrato a nivel SQL, sin Worker
```

Remoto (requiere `CLOUDFLARE_API_TOKEN` en el entorno, nunca en archivos):

```sh
npm run migrate:remote
npm run test:d1:remote              # mismo contrato contra la D1 real
npm run deploy                      # sube el Worker + binding D1
```

## Estado de la verificación V1.2

El subdominio ya está registrado, `workers_dev` está activo y la migración
`0002_read_only_indexes.sql` fue aplicada a la D1 indicada. READ_TOKEN fue creado
sin reemplazar SYNC_TOKEN. El Worker publicado pasó 16 comprobaciones remotas de
lectura y rechazo de escrituras con credenciales de lectura.

El E2E remoto ya confirmó seis operaciones en D1 provenientes de dos ventas de
ensayo, recuperación offline e idempotencia. Otros 17 controles verificaron claves,
consultas y conflicto sin sobrescritura. Solo resta la confirmación del visor en un
segundo dispositivo físico. Consultar `docs/V1.2_STATUS.md`.

Prueba remota sin insertar registros, con READ_TOKEN cargado en el entorno:

```sh
node test/read-only-remote.test.mjs
```

Las pruebas de `sync-operations.test.mjs` sí insertan operaciones de laboratorio.
No ejecutarlas sobre datos comerciales sin identificar claramente el ensayo.

## Seguridad

- `.dev.vars`, `.env*`, `.wrangler/` ignorados por git.
- El Worker no contiene ningún token de Cloudflare; el token administrativo solo vive en el entorno de la máquina que ejecuta wrangler.
- El POS nunca habla con la API de Cloudflare: solo con el Worker, usando la
  credencial de su dispositivo. D1 conserva únicamente su hash HMAC.
