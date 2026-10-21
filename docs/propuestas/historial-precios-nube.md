# Propuesta: historial de precios en la nube (Misión 3)

> Solo propuesta. Este PR **no** incluye migración, código del Worker ni cambios en la web.
> Implementarlo requerirá: una migración (tabla nueva), rutas nuevas en el Worker, entradas en
> `pos-permissions.js` y despliegue del Worker **antes** de la web.

## 1. Situación actual

- `POS/js/products/price-history.js` guarda en `localStorage['na_price_history_v1']` un objeto
  `{ [productId]: Entry[] }` (máx. 200 por producto, el más nuevo primero).
- `Entry = { id, seq, at, user, userId, type: 'venta'|'mayorista'|'costo', before, after, origin: 'ficha'|'importacion'|'compra', ref? }`
  con `before/after` en soles (número o `null`) y `at` en ISO UTC.
- `id` = `productId:at:type:(ref|'change'):seq`. `seq` es un contador en memoria, así que **no es
  único entre aparatos ni entre recargas**. Por eso la nube no puede usarlo tal cual como clave.
- Cada aparato tiene su propio historial. Si se cambia de teléfono o se borra el navegador, se pierde.
- El costo solo se muestra al dueño confirmado (`NA_ROLES.isOwner()`), pero queda **en el aparato**
  aunque lo use un empleado. La nube debe corregir eso: el costo nunca debe salir del servidor hacia un no dueño.

## 2. Tabla propuesta (D1/Turso)

```sql
CREATE TABLE price_history (
  change_id     TEXT PRIMARY KEY,        -- clave única por cambio (ver §3)
  product_id    TEXT NOT NULL,
  field         TEXT NOT NULL CHECK (field IN ('venta','mayorista','costo')),
  before_cents  INTEGER,                 -- NULL = sin precio
  after_cents   INTEGER,
  origin        TEXT NOT NULL CHECK (origin IN ('ficha','importacion','compra','backfill')),
  ref           TEXT,                    -- p. ej. "PUR-…:3" (compra:línea) u operation_id de product.update
  user_name     TEXT NOT NULL,           -- se muestra como «Nombre · ID»
  user_id       TEXT,                    -- cajero/dispositivo; NULL si no se conoce
  changed_at    TEXT NOT NULL,           -- ISO 8601 en UTC (…Z). La web lo muestra en hora de Lima
  device_id     TEXT NOT NULL,           -- dispositivo que lo subió (lo pone el Worker desde la sesión)
  received_at   TEXT NOT NULL,           -- hora UTC del servidor
  legacy_id     TEXT,                    -- Entry.id local original (solo para backfill/auditoría)
  review_status TEXT CHECK (review_status IN ('pending','approved','rejected'))  -- costo de empleado sin compra válida (§7)
);
CREATE INDEX price_history_product ON price_history(product_id, changed_at DESC);
CREATE UNIQUE INDEX price_history_ref ON price_history(ref, field) WHERE ref IS NOT NULL;
```

- Montos en **céntimos enteros** (como `cost_cents`/`price_cents`), sin flotantes.
- `changed_at` siempre UTC; nunca hora local en la base. La web convierte con
  `timeZone: 'America/Lima'` (igual que `limaLabel` en Historial de compras).
- Usuario: se guarda separado (`user_name`, `user_id`) y se muestra «Nombre · ID» (sin ID: solo «Nombre»).
  Se sanea en el Worker: sin caracteres de control, máx. 80 caracteres cada uno.

## 3. Clave única e idempotencia

- `change_id` lo genera el aparato **una vez** al registrar el cambio y lo guarda en la entrada local
  (campo nuevo `cid`). Formato: `ph1:<device_id>:<uuid v4>`. Reenviar la misma entrada (reintento,
  pérdida de respuesta, sincronización repetida) usa el mismo `change_id`.
- El Worker inserta con `INSERT … ON CONFLICT DO NOTHING` **sin columna de destino**, así ninguna
  restricción única (`change_id` ni `(ref, field)`) produce un error. Si no se insertó ninguna fila
  (`changes = 0`), el Worker lee la fila existente (por `change_id` y, si no está, por `(ref, field)`) y clasifica:
  - mismo contenido (mismo producto, campo, montos, origen y ref) → `duplicate` (200), no se crea otra fila;
  - contenido distinto → `conflict` (409 por entrada), no se sobrescribe nada.
- Cambios que nacen de una compra ya tienen identidad durable (`ref = "<purchase_id>:<línea>"`).
  El índice único `(ref, field)` evita que dos aparatos que vean la misma compra la registren dos veces;
  el segundo recibe `duplicate`.

## 4. Backfill de los datos locales (sin pérdida)

**Orden:** el backfill corre **primero, al iniciar sesión** (después de `/auth/me`) y **antes** de activar
la función (antes de leer de la nube o de escribir cambios nuevos en ella). Mientras no termine, la
pantalla usa solo el historial local, como hoy.

1. Al iniciar sesión, la web lee `na_price_history_v1` **sin borrarlo**.
2. A cada entrada sin `cid` le asigna uno determinista:
   `ph1:legacy:<sha256(device_id + '|' + entry.id + '|' + entry.at + '|' + entry.type)>`,
   y lo escribe en la entrada local. Si la subida se repite (otra pestaña, reintento), sale el mismo
   `change_id` y el servidor responde `duplicate`.
3. Sube en lotes de ≤ 100 a `POST /price-history/batch` con el `origin` original y `legacy_id = entry.id`.
4. Solo marca la entrada como `synced: true` cuando el servidor confirma (`inserted` o `duplicate`).
   Lo no confirmado se reintenta en el próximo inicio de sesión. **Nunca** se borra una entrada local por la sincronización.
5. Cuando todas las entradas quedaron confirmadas (o en revisión, §7), la web guarda
   `na_price_history_backfill_v1 = { device_id, done_at }` y recién entonces activa la lectura y escritura en la nube.
6. El límite local de 200 por producto se mantiene solo para la caché; la nube conserva todo.
7. Un empleado también sube su historial local. El tratamiento del costo se explica en §7. Tras
   confirmarse, la web borra de ese aparato solo los montos de las entradas de costo, para que el
   costo no quede en claro en el teléfono del empleado (la nube conserva el dato).

## 5. Unión y eliminación de duplicados al leer

- La web muestra la unión de: filas del servidor + entradas locales aún no confirmadas.
- Clave de unión: `change_id`; si una entrada local no tiene `cid`, se usa `ref:field`.
  Si coincide con una fila del servidor, gana la del servidor.
- Orden: `changed_at DESC`, luego `change_id` (determinista entre aparatos).
- No se “resuelven” valores: el historial es solo de anexos (append-only). El precio vigente sigue
  siendo el de la ficha (`product.update`); el historial no reescribe productos.

## 6. Endpoints (Worker)

| Método | Ruta | Roles | Notas |
|---|---|---|---|
| `POST` | `/price-history/batch` | owner, empleado | ≤ 100 entradas. Respuesta por entrada: `inserted` / `duplicate` / `conflict` / `invalid`. `device_id` sale de la sesión, no del cuerpo. |
| `GET` | `/price-history?product_id=…&before=…&limit=50` | owner, empleado | Paginado por `changed_at`/`change_id`. |
| `GET` | `/price-history/changes?since=<received_at>&limit=200` | owner, empleado | Para refrescar la caché local entre aparatos. |

Validación en el Worker: `field` y `origin` de la lista, céntimos enteros `0…1e9` o `NULL`,
`changed_at` ISO válido y no más de 5 min en el futuro, textos saneados, `change_id` ≤ 120 caracteres
con el prefijo `ph1:`.

## 7. Costo solo para el dueño (filtro en el servidor)

- Acción nueva o reutilizada: `purchases.costs.view` (ya es solo dueño en `pos-permissions.js`).
- En **ambos** `GET`, si la sesión no tiene `purchases.costs.view`, el Worker **excluye las filas con
  `field = 'costo'`** en la consulta SQL (`AND field <> 'costo'`), no solo oculta columnas. Así el
  costo nunca viaja en claro a un aparato de empleado.
- En `POST`, la respuesta para un no dueño no repite montos de costo.
- **Costo escrito por un empleado:** se acepta directamente solo si `origin = 'compra'` y `ref` es válido,
  es decir, si existe en `pos_purchase_lines` una línea `(purchase_id, line_number)` aplicada para ese
  `product_id` y su `unit_cost_cents` coincide con `after_cents`. En cualquier otro caso (ficha, importación,
  backfill o ref inválido) la fila se guarda con `review_status = 'pending'` (columna nueva, `NULL` si no
  necesita revisión), no aparece en el historial y el dueño la ve en Revisiones para aprobarla o descartarla.
  El valor **nunca** cambia el costo del producto.
- La web sigue ocultando el costo con `NA_ROLES.isOwner()` dentro de `try/catch` como segunda barrera.

## 8. Permisos y despliegue

- `pos-permissions.js`: agregar las tres rutas a `API_ROUTES` (owner + empleado) y la acción
  `price-history.write`. **Cambio compartido con el Worker**: agruparlo con los demás cambios de
  permisos para desplegar el Worker una sola vez, antes de la web.
- Orden: migración → Worker → web. Si el servidor responde `404`/`schema_not_ready`, la web sigue
  usando solo el historial local (sin errores para el usuario).

## 9. Pruebas previstas (cuando se implemente)

- Reenvío del mismo lote: 0 filas nuevas (`duplicate`). Mismo `change_id` o `(ref, field)` con otro contenido: `conflict`.
- Costo de empleado con ref de compra válido: se acepta; sin ref o con ref inválido: queda en revisión del dueño.
- El backfill corre al iniciar sesión y la función no se activa hasta terminarlo.
- Backfill dos veces (dos pestañas): mismas filas, ningún dato local perdido.
- Empleado: `GET` no trae filas `costo`; el `POST` de costo se acepta y luego no se lee.
- Dos aparatos con la misma compra: una sola fila por `(ref, field)`.
- Fechas: `changed_at` en UTC, mostradas en hora de Lima (p. ej. 03:30Z → 22:30 del día anterior).
- Usuario con «·», «|» y comillas se guarda y muestra igual.
