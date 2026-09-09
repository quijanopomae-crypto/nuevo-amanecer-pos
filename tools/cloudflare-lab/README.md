# cloudflare-lab

Laboratorio aislado para la capa cloud del POS Nuevo Amanecer. **No toca el POS.**

```
POS V9 (autoridad local) → OUTBOX atómico → Worker (gateway) → D1 sync_operations
```

## Recursos

| Recurso | Valor |
|---|---|
| D1 | `nuevo-amanecer-lab` · `e734e6f1-41c4-4bfa-ab1f-5acbcdd2272e` · ENAM |
| Binding | `env.nuevo_amanecer_lab` |
| Worker | `nuevo-amanecer-sync-lab` (subido, sin ruta pública todavía) |

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

Los endpoints `/sync/*` exigen header `x-sync-token` igual al secreto `SYNC_TOKEN`. Sin secreto configurado el gateway responde `503 gateway_not_configured` (fail-closed).

## Ejecutar

```sh
npm install
cp .dev.vars.example .dev.vars      # poner un valor aleatorio largo
npm run migrate:local
npm run dev                         # en otra terminal:
SYNC_TOKEN=<mismo valor> npm run test:worker
npm run test:d1:local               # contrato a nivel SQL, sin Worker
```

Remoto (requiere `CLOUDFLARE_API_TOKEN` en el entorno, nunca en archivos):

```sh
npm run migrate:remote
npm run test:d1:remote              # mismo contrato contra la D1 real
npm run deploy                      # sube el Worker + binding D1
```

## Pendiente manual (una sola vez, en el dashboard / con permiso explícito)

1. Registrar un subdominio `workers.dev` en la cuenta (`dash.cloudflare.com/<account>/workers/onboarding`). Sin él, `wrangler deploy` sube el script pero no publica URL, y `wrangler dev --remote` no arranca.
2. `wrangler secret put SYNC_TOKEN` en el Worker.
3. Poner `"workers_dev": true` en `wrangler.jsonc` y redeploy; luego `node test/sync-operations.test.mjs https://<worker>.<sub>.workers.dev`.

## Seguridad

- `.dev.vars`, `.env*`, `.wrangler/` ignorados por git.
- El Worker no contiene ningún token de Cloudflare; el token administrativo solo vive en el entorno de la máquina que ejecuta wrangler.
- El POS nunca hablará con la API de Cloudflare: solo con el Worker, usando `SYNC_TOKEN`.
