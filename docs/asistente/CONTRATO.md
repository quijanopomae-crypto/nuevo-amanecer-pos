# Contrato del asistente (prototipo aislado, rama feature/asistente-aislado)

Estado: prototipo. Apagado por defecto. No se publica, no se une y no se despliega. Alcance: **solo gestión (modo admin)**: documentos, mercadería, stock, compras y precios. **No vende ni llena carritos.**
Copia del contrato de pruebas de Bot 5 adaptada a esta rama: `docs/asistente/contrato-asistente-v2.json`.

## Rutas del Worker
| Ruta | Método | Roles (tabla `API_ROUTES`) | Qué hace |
|---|---|---|---|
| `/auth/assistant/chat` | POST | dueño, empleado (el servidor revisa el nivel) | Conversa con el proveedor de IA (DeepSeek por defecto; ver «Proveedor de IA») y devuelve propuestas. Nunca escribe datos del negocio. `{ping:true}` devuelve SOLO `{ok, enabled, role, level}` (nivel de ESTE aparato; nada del dueño, de otros aparatos ni de la configuración) sin llamar al modelo ni gastar cupo. El rol (y el 403 `reason:"sin_rol"`) se revisa ANTES que la clave: un Worker sin clave igual responde el ping; el chat falla cerrado con 503 `assistant_not_configured`. Empleado que pide un documento solo del dueño, o cualquier documento estando en «consultas»: **403 `forbidden_document`** con `allowed` para todo el pedido (no viaja ninguna tarjeta). |
| `/auth/assistant/confirm` | POST | dueño, empleado (nivel revisado OTRA vez) | Gasta el token de UNA tarjeta (un uso, 5 min). Devuelve el `operation_id`. No escribe datos del negocio. |
| `/auth/assistant/audit` | GET | dueño (fila `owner` explícita; si no 403 `admin_only`) | Bitácora A20: una fila por llamada a herramienta (`proposed`/`dropped:<motivo>`) y por confirmación (`confirmed`, con `operation_id`). Sin textos, argumentos, PIN ni DNI. También las confirmaciones RECHAZADAS (`rejected:<error>`); 429 y 403 de rol agrupados (`internal:asst:audit:a:<minuto>:<aparato>:<resultado>`, con `count`). Cajones con tope propio en `pos_settings`: `o:` dueño 1000, `r:` empleados/rechazos 300, `a:` agrupados 300; sin migración. Respuesta `{entries, keep, caps, write_errors, last_write_error_at}` (`write_errors`: fallos al anotar en esta instancia del Worker; el chat y el confirm nunca se cortan por eso, y el Worker deja un `console.warn` con solo el código de error). |
| `/auth/assistant/employee-access` | GET, POST | dueño | Lista los aparatos de empleado con su nivel / cambia el nivel (dueño + aprobación estricta). |
| `/auth/assistant/provider` | GET | dueño (si no 403 `admin_only`) | Proveedores del catálogo con `status` «Conectado» / «Falta clave», el que está en uso y los modelos que se pueden elegir. **Nunca** la clave ni la URL. |
| `/auth/assistant/provider/test` | POST | dueño | `{provider, model?}` «Probar»: una llamada chica sin herramientas ni datos del negocio (máx. 6 por minuto y por aparato dueño, 429 después; si no se puede contar, 503 y no se prueba). Devuelve `{ok, status, message, ms}` en palabras simples. |
| `/auth/assistant/provider/select` | POST | dueño | Dos pasos, sin PIN. «Usar» `{provider, model?}` → el servidor arma la tarjeta con `operation_id` propio (un solo uso, vence en 5 min, uno pendiente por aparato). «Confirmar» `{operation_id, confirm:true}` aplica lo guardado: repetido 409 `already_confirmed`, vencido 410 `confirm_expired`, otro aparato o id inventado 409 `bad_operation`. 400 proveedor o modelo fuera de la lista; 409 `provider_not_ready` sin clave. Guarda solo `{provider, model}`. |
| `/auth/assistant/owner-device` | GET | dueño | Aparatos dueño y pendientes de aprobar. **Bandera `ASSISTANT_OWNER_BOOTSTRAP=1`.** |
| `/auth/assistant/owner-device/register` | POST | aparato sin fila de rol | «Registrar este teléfono como dueño» `{pin}`. **Bandera.** |
| `/auth/assistant/owner-device/approve` | POST | dueño | `{device_id, operation_id, decision:"approve"|"reject"}` + `x-owner-approval`. **Bandera.** |
| `/auth/assistant/owner-device/revoke` | POST | dueño | `{device_id, operation_id}` + `x-owner-approval`. **Bandera.** |

- Todas responden **404** sin `ASSISTANT_ENABLED=1` (antes de pedir sesión). Las de `owner-device` además responden 404 sin `ASSISTANT_OWNER_BOOTSTRAP=1`.
- No existe `/auth/assistant/tool`: el modelo no ejecuta nada.
- Sesión: `authorizeSession` (Bearer). Rol y nivel se calculan **en cada pedido** con `assistantAccess(db, auth)` (sin caché en el cliente): `owner` solo con `pos_device_roles.pos_role='owner'` explícito; si no, `empleado:<nivel>` (nivel en `pos_settings`, clave `internal:asst:lvl:<hash del aparato>`, por defecto `off`). Sin tabla o con error: `off`.

### Variables del Worker
| Variable | Uso |
|---|---|
| `ASSISTANT_ENABLED` | `1` para encender. Otro valor: 404. |
| `ASSISTANT_OWNER_BOOTSTRAP` | `1` para las rutas `owner-device`. Necesita el visto bueno del jefe y la migración 0035 (no aplicada). |
| `AI_PROVIDER` | Proveedor por defecto: `deepseek`, `openai`, `xai`, `openrouter`, `groq`, `mistral`, `together`, `anthropic`, `gemini`. Sin esta variable y con `DEEPSEEK_API_KEY`: DeepSeek (como antes). |
| `AI_MODEL` | Modelo del proveedor de `AI_PROVIDER` (si falta, el de fábrica; ver tabla abajo). |
| `AI_BASE_URL` | Opcional. Solo `https`, sin usuario/clave, sin `?`/`#`, y de la lista de hosts conocidos salvo `AI_ALLOW_CUSTOM_BASE=1`. Si no pasa: 503 (falla cerrado). |
| `AI_ALLOW_CUSTOM_BASE` | `1` permite un host propio (proxy), igual solo `https`. |
| `AI_VISION` | `1`/`0` fuerza si el modelo de `AI_PROVIDER` lee fotos (si falta, se deduce del nombre del modelo). |
| Claves (secretos) | Una por proveedor (tabla abajo). `AI_API_KEY` sirve de respaldo SOLO para el proveedor de `AI_PROVIDER`. Sin proveedor listo: 503 `assistant_not_configured`, salvo `ASSISTANT_DEMO=1`. |
| `ASSISTANT_DEMO` | Solo prototipo local y pruebas (respuestas de demostración). Nunca en un Worker real. |
| `DEEPSEEK_BASE_URL` | Nombre viejo de `AI_BASE_URL` para DeepSeek, con la MISMA revisión: un mock local necesita `https` y `AI_ALLOW_CUSTOM_BASE=1` (`http://127.0.0.1:4599` ya no se acepta). |
| `ASSISTANT_CONFIRM_SECRET` | HMAC de los tokens (16+ caracteres). Sin él no se confirma nada (503). |
| Límites `ASSISTANT_*` | Por minuto (dueño 30, empleado 10), fotos, por día, tope mensual, confirms por minuto. |

### Proveedor de IA (capa de proveedores, 17-10)
- **Solo del Worker.** El celular nunca manda proveedor, URL ni clave (si los manda, se ignoran). Las claves no se guardan en la base ni salen hacia el celular; la respuesta de `/provider` no trae claves ni URLs.
- **Elección del dueño:** Configuración › Aparatos › «Asistente: proveedor de IA» (solo sesión dueño en el aparato dueño, en modo Admin). «Usar» abre una tarjeta Confirmar; sin PIN. Solo se puede elegir un proveedor que ya tenga clave y un modelo de la lista del servidor. Se guarda `{provider, model, at}` en `pos_settings` con clave interna `internal:asst:provider` (la lista pública `/auth/settings` excluye `internal:%`): **sin migración**. Si después quitan la clave del elegido, se vuelve a `AI_PROVIDER`.
- **Adaptadores** (mismos eventos internos: texto, herramienta, uso, fin, error): OpenAI compatible (`/chat/completions` con SSE y `tool_calls`), Anthropic Messages (`/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, `tool_use`/`input_json_delta`) y Gemini (`:streamGenerateContent?alt=sse`, clave en la cabecera `x-goog-api-key`, nunca en la URL; `functionCall`). Errores: 429 (y 529 Anthropic, 503 Gemini) → `upstream_busy`; otro → `upstream_error`; corte/tiempo/celular ido → `upstream_timeout`. Nunca se reenvía el texto de error del proveedor.
- **Igual para todos:** puertas (rol, nivel, cupo, documento, foto solo del dueño), filtro del empleado en cada trozo y en `final`, guardia de herramientas a mitad, tiempos y corte (Bot 3), demostración sin cambios. **Foto** con un modelo que no lee fotos: 422 `image_unsupported` «Leer fotos no está disponible por ahora.» sin cupo ni llamada.
- DeepSeek sigue igual: `deepseek-flash`, `thinking: {type:"disabled"}` (solo DeepSeek), `tool_choice:"auto"`. `mode` en la respuesta = id del proveedor (`deepseek`, `anthropic`, …) o `mock`.

| Proveedor | `AI_PROVIDER` | Clave (secreto) | Modelo de fábrica | Fotos |
|---|---|---|---|---|
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-flash` | sí (como antes) |
| OpenAI | `openai` | `OPENAI_API_KEY` | `gpt-4o-mini` | gpt-4o, 4.1, 5, o-series |
| xAI Grok | `xai` | `XAI_API_KEY` | `grok-3-mini` | grok-4 / vision |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-4o-mini` | según el modelo |
| Groq | `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | llama-4 / vision |
| Mistral | `mistral` | `MISTRAL_API_KEY` | `mistral-small-latest` | pixtral, small, medium |
| Together | `together` | `TOGETHER_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | vision / VL / llama-4 |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` | sí |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | sí |

Las claves se ponen con `wrangler secret put NOMBRE` (nunca en el repo ni en `wrangler.jsonc`). `AI_API_KEY` = respaldo del proveedor de `AI_PROVIDER`.

## Matriz de roles
| | Dueño | Empleado «Consultas y documentos» | Empleado «Solo consultas» | Empleado «Apagado» (por defecto) / sin rol |
|---|---|---|---|---|
| Chat / confirm | sí | sí | sí | **403** `assistant_off` (empleado) / `admin_only` + `reason:"sin_rol"` (aparato sin fila) |
| Qué ve | tarjeta en Inicio (reemplaza la burbuja ahí) + burbuja flotante en el resto | solo la burbuja flotante con sus atajos | igual | **nada**: el cargador no baja ni un archivo del asistente (0 JS, 0 CSS) |
| `consultar` | todo: stock, bajo stock, sin costo, ventas, más vendidos, deudas, compras | stock, por reponer, precios de venta (sin costos, márgenes, caja ni deudas) | igual | — |
| `preparar_documento` | 6 tipos | solo `lista_precios`, `lista_pedido` (sin costos, armadas en el servidor) | **no** | — |
| `explicar_pasos` | sí | sí | sí | — |
| Proponer ajuste de stock, precio, compra, producto nuevo | sí; «Confirmar» de un toque, **sin PIN** (el servidor exige sesión dueño real) | **no** (sin tarjetas de cambio; el pedido se descarta `forbidden_role` y se le dice que lo hace el dueño) | no | — |
| `Actualizar costo` (tarjeta aparte) | sí, un toque sin PIN | no | no | — |
| Cambiar nivel de empleados / aparatos dueño | sí, con PIN (aprobación estricta) | no | no | — |

Revocar es inmediato: confirm vuelve a leer el nivel; una tarjeta emitida antes de apagar responde **403**.

## Herramientas (el modelo solo PROPONE)
| Herramienta | Tarjeta | Qué pasa al pulsar (pantalla o ruta que ya existe) |
|---|---|---|
| `consultar {tipo, producto?, desde?, hasta?}` | `consulta` (solo lectura) | El Worker lee con las lecturas canónicas (`canonicalRead`) y manda al modelo **solo un resumen** (top 10). Medido: primer pedido ~6,8 KB; resumen ≤ 3,2 KB aun con 3.000 productos. |
| `preparar_documento {tipo, desde?, hasta?, cliente?}` | `documento` | Vista previa imprimible «No es comprobante SUNAT». `tipo`: `inventario_valorizado`, `lista_precios`, `lista_pedido`, `reporte_ventas`, `estado_cuenta`, `resumen_cierre`. Reusa `NA_VALORIZACION`, `NA_REPORTE_ARQUEO`, `NA_CLIENT_CREDIT_ACCOUNTS_V2` (sin cuentas propias). |
| `proponer_ajuste_stock {product_id, tipo, cantidad, motivo}` | `ajuste` | Abre «Registrar movimiento» (`abrirMovInv`) lleno; Guardar sigue la regla propia del POS (`ownerGate inventory.adjust`, núcleo sin cambios). |
| `proponer_cambio_precio` | `precio` | Abre la ficha (`editProd`); Guardar → `product.update` (`ownerGate`). |
| `preparar_compra` / `leer_factura_compra` | `compra` | Abre «Nueva compra» (`NA_PURCHASES.open`) llena; filas fuera de rango bloquean Confirmar. La compra NO cambia el costo: «Actualizar costo» es tarjeta aparte por `product.update`. |
| `proponer_producto_nuevo` | `producto` | Abre el formulario de producto lleno; confirm exige sesión dueño. |
| `explicar_pasos` | `pasos` | Nada se escribe; «Llévame ahí» navega. |

**Lista de pedido del empleado:** el servidor la arma y la pasa por lista blanca: la tarjeta solo trae `id, type, needsConfirm, title, tipo, fiscal, data{campos:["producto","stock","cantidad_sugerida"], columnas, filas}`. Costos, totales o inversión que mande el modelo se descartan (probado con los canarios 4321.97 / 999.11). La versión del dueño puede traer costo e inversión.

## Aprobación estricta (PIN del dueño)
`POST /auth/owner-approval {pin, action, operation_id}` → `approval_id`. La ruta que la usa la gasta con
`UPDATE pos_owner_approvals SET used_at=? WHERE approval_id=? AND device_id=? AND action=? AND expires_at>? AND operation_id=? AND used_at IS NULL` y solo vale con `changes===1`.
Acciones: `inventory.adjust`, `product.update`, `product.create`, `assistant.employee_access`, `assistant.owner_device` (agregadas a `APPROVAL_ACTIONS` en `pos-roles.js`, cambio aditivo).

### `POST /auth/assistant/employee-access`
`{device_id, operation_id, level:"off"|"consultas"|"consultas_documentos"}` (también `enabled: true→consultas, false→off`) + `x-owner-approval` (`assistant.employee_access`). Solo con la cabecera de aprobación (ya no hay PIN suelto en el cuerpo). El destino se revisa ANTES de gastar la aprobación: si no es un aparato empleado → 409 `not_employee_device`. Respuesta `{ok, device_id, level, logged}`. Se anota en `pos_assistant_access_log` si existe (migración 0034, **no aplicada**).

### Aparato del dueño (`owner-device`, detrás de bandera)
- `register {pin}`: solo un aparato **sin fila**; empleado → 409 `employee_device_cannot_register` (o 403 `forbidden_role` del gate), sin gastar intentos. PIN con el límite por aparato existente (5 fallos → 429, «Demasiados intentos. Espera 15 min.»). Con 0 dueños → `owner` (INSERT atómico). Con dueño → **202** `{pending:true, status:"esperando_aprobacion"}`.
- `approve {device_id, operation_id, decision}`: `approve` crea la fila owner; `reject` borra el pedido. Ambos piden aprobación estricta `assistant.owner_device`; un PIN suelto no basta.
- `revoke {device_id, operation_id}`: deja el aparato como `empleado`. El último dueño nunca se quita: **409 `{error:"last_owner", code:"last_owner"}`** (revisado antes de gastar la aprobación y otra vez dentro del UPDATE). La pantalla avisa antes de quitar cualquier aparato dueño.
- Cada escritura va en UN `db.batch`: cambio de rol, gasto estricto de la aprobación y fila de bitácora juntos (si algo falla, nada queda a medias). Al aprobar, la aprobación se gasta y el pendiente se borra DESPUÉS del INSERT del dueño y solo si ocurrió; si el aparato ya tenía rol → 409 `device_has_role` sin gastar la aprobación.
- Bitácora `pos_owner_device_log` (migración 0035, **no aplicada**). Sin la tabla: **503 `owner_device_log_missing`**, no se registra nada.

## Confirm
Pide `{token, proposal}`. **Sin PIN (pedido del dueño, 17-10):** ya no hay cabecera `x-owner-approval` ni `owner_approval_required`; si llega una cabecera vieja se ignora. Lo que protege es la **sesión dueño verificada en el servidor**: `assistantAccess` da `owner` solo con fila `owner` en `pos_device_roles` **y** sesión `posRole` owner; cualquier otro rol con asistente → **403 `forbidden_role`** (aunque traiga un token válido de una tarjeta del dueño), sin rol / apagado → **403 `assistant_off`**. Orden: firma, aparato, **rol y nivel actuales** (solo dueño), parámetros, id y hash, ya usada (`already_confirmed`, mismo `operation_id`), vencida (410), revisión de filas (422 `review_required`), **tope duro** (422 `over_limit` con `rows`, `total`, `limits`, `message`), **control de inventario** releído en la base, fallando cerrado (503 `stock_check_unavailable` sin base, con lectura caída o lista cortada sin el producto; 409 `product_missing` si se borró; 409 `sin_control_stock` con `nombres`, `message`), límite por minuto (429 `rate_limited`), y recién ahí se marca la tarjeta usada con CAS (`store.put(..., revision)`). **Doble toque:** el botón se apaga al instante, la puerta del celular reusa el pedido en curso y el segundo envío recibe `already_confirmed` con el mismo `operation_id` (un solo efecto, probado con 3 envíos a la vez). Un 422/409/429/503 no marca la tarjeta: se reintenta con un toque. El PIN sigue solo en Configuración (niveles de empleado y aparatos dueño).

### Tope duro de compras (solo en el camino del asistente)
`PURCHASE_HARD_LIMITS = {maxQty: 5000, maxUnitCost: 10000, maxLineTotal: 50000, maxTotal: 200000}`. Las filas que lo pasan llegan con `limite:[...]` y la tarjeta con `fueraDeLimite`; en pantalla solo tienen «Quitar fila» (no «Está bien»). En confirm, aceptar la fila no basta: hay que quitarla. Ajuste de stock con cantidad > 5000: no se propone. La ruta de compras del POS no tiene tope (pendiente del jefe).

### Sin control de inventario
El contexto del celular manda `controla:false`; el servidor además lee `tracks_inventory` de su base. Ajustes de esos productos no se proponen; en compras la fila se quita y va en `omitidas`. El texto dice ««X» no lleva control de stock, así que no preparo compras ni ajustes de ese producto.». Compra fuera de tope: una sola frase («Arroz» pasa el límite (cantidad mayor a 5000): corrige la factura o quita la fila.). Singular y plural escritos bien (nunca «fila(s)»/«producto(s)»).

### Tarjeta que nunca queda trabada (cliente)
422 `review_required`/`over_limit`: filas en rojo («Revisa este dato» / «pasa el límite»). 429: «Espera un momento e intenta de nuevo» + «Reintentar» (misma tarjeta). Corte de red o tiempo agotado: «Reintentar» (nunca un «Pensando» sin fin: chat 30 s, confirm 12 s × 2). Siempre «Pedir de nuevo» (tarjeta nueva). La tarjeta de cambio tiene dos botones: «Confirmar» y «Cancelar». Antes de enviar, el celular revisa si puede abrir la pantalla (producto existe, controla inventario, «Registrar movimiento» cargado) y dice el motivo real sin gastar nada. El `id` de cada tarjeta lo crea el servidor (`crypto.randomUUID()`) y va firmado.

### Errores en palabras simples (cliente)
La persona nunca ve un código (403, 409, 429, 503, `assistant_off`, `forbidden_document`…). `C.friendlyError(code, serverMsg)` traduce cada código a una frase («Eso solo lo puede hacer el dueño.», «Sin conexión. Toca «Reintentar» cuando vuelva el internet.», «Espera un momento e intenta de nuevo.», «Está tardando mucho. Toca «Reintentar».»); un código desconocido o `HTTP_xxx` cae en «No se pudo completar. Toca «Reintentar».». Un `message` del servidor solo se muestra si no trae nada técnico (`C.looksTechnical`). `retry:true` pone el botón «Reintentar», que manda otra vez lo mismo.

### Respuesta en partes (chat)
- **Cómo se pide:** `stream: true` en el cuerpo JSON de `/auth/assistant/chat`. No hay cabeceras nuevas, así que el CORS de `worker.js` no cambia y las fotos del dueño siguen igual. Sin `stream:true`, la ruta responde el JSON de siempre (vuelta atrás para navegadores sin `ReadableStream`/`TextDecoder`/`AbortController`).
- **Puertas primero:** rol (antes de leer el cuerpo), `image_owner_only`, 503 sin clave (salvo `ASSISTANT_DEMO=1`), cuerpo, cupo/429. Si una corta, la respuesta es **JSON** con su código y bitácora de siempre. Recién después se abre el canal `text/event-stream`.
- **Eventos:** `open` (enseguida), `status {s:'buscando'}` (aviso liviano mientras corre una búsqueda o herramienta y todavía no hay texto: enseguida y cada `STATUS_EVERY_MS` = 8 s hasta el primer texto; nunca después de texto ni de `final`), `text {t}` (trozos ya tapados; filtro incremental: solo espera la última palabra y, para un empleado, un monto mientras se decide; lo primero que sale tiene al menos 20 caracteres y lo liberado de golpe va en tandas de ~48 caracteres) o `text {reset:true}` (antes de la explicación de una consulta), `final {…mismo cuerpo que el JSON…}`, `error {error, status}`. **Las tarjetas solo vienen en `final`**, validadas igual que antes (inventario releído, topes, tarjeta repetida fuera, firma). Las llamadas a herramientas se juntan en el servidor; una herramienta a medias nunca da tarjeta. Si DeepSeek se corta a mitad: `error upstream_error` (sin `final`). **Corte del pedido a DeepSeek (Bot 3):** si el celular se va (deja de leer), pasa el tope del servidor (`SERVER_MAX_MS` = 90 s, contado desde que el cuerpo y la foto ya se leyeron) o vence un tiempo, el Worker aborta el pedido a DeepSeek (`AbortController`) y deja de recibir; al celular le llega `error upstream_timeout` si todavía está. **Relojes del celular con foto:** el reloj del primer trozo (10 s) y el tope (90 s) suman el tiempo de subida (`STREAM.uploadBps` = 12 KB/s, como mucho 120 s), así en 3G lento los 10 s cuentan desde que la foto terminó de subir. **Foto de un empleado:** el celular avisa «Eso solo lo puede hacer el dueño.» al instante, sin subirla (el servidor igual responde 403 `image_owner_only`).
- **Demostración** también en partes (palabra por palabra).
- **Plan gratis:** un `TransformStream` por pedido; sin Durable Objects ni nada pago. La espera de red no gasta CPU. El canal se cierra después de anotar la bitácora.
- **DeepSeek en partes:** `stream:true`; el tiempo cuenta desde el último trozo (`timeoutMs`).
- **Celular:** pinta por tandas de ~100 ms (`requestAnimationFrame`), nunca letra por letra. Primer trozo ~10 s (`C.STREAM.firstMs`, cuenta el primer byte: el `open` llega apenas pasan las puertas); después 30 s **desde el último trozo** (`idleMs`; los `status` también cuentan como trozo). Tope duro de 90 s por respuesta (`C.STREAM.maxMs`): se corta aunque sigan llegando trozos o avisos. Con `status` y sin texto, la burbuja de «Pensando…» dice «Buscando en su inventario…». El texto de `final.reply` reemplaza al pintado solo si cambió. Corte a mitad: el texto recibido queda con «Respuesta incompleta» y «Reintentar» (sin reintento automático; Reintentar quita esa respuesta y su pregunta y las manda de nuevo, sin texto repetido). Sin nada recibido: frase simple + «Reintentar». Errores siempre sin códigos. El tope de 90 s se trata igual (con texto: «Respuesta incompleta» + «Reintentar»).
- **Vista (Bot 4):** «Pensando…» se vuelve la respuesta en el mismo lugar; la mascota queda en «hablando» mientras llega. Se baja sola solo si la persona ya estaba abajo; si subió a leer, aparece «Ver nuevo ↓». Las tarjetas se agregan debajo del texto terminado sin mover lo leído (como mucho se baja hasta el inicio de la respuesta). La lista de mensajes no es `aria-live`: una región oculta anuncia la respuesta completa una sola vez al final (y los errores).
- **Empleado (Bot 5):** las consultas permitidas (`stock_producto`, `bajo_stock`) pasan por `employeeQueryResult` (lista blanca de columnas y resumen) justo después de leer la base y antes de la pantalla y del modelo; las del dueño se descartan antes de leer. Costos, márgenes, ganancia, caja y deudas nunca salen en ningún trozo, ni a medias. Las puertas de rol y nivel siguen respondiendo JSON 403 antes de abrir el canal.
- **Bot 5:** un `data:` (base64) pegado en el texto se cambia por «[imagen omitida]» antes de ir a DeepSeek (`redactText`), también con espacios después de la coma o con el base64 cortado en líneas.
- **Documento del dueño pedido por un empleado (Bot 5, sin esperar toda la respuesta):** (a) el modelo del empleado solo ve `lista_precios`/`lista_pedido` y `stock_producto`/`bajo_stock` (enum recortado; con «Solo consultas» no ve `preparar_documento`); (b) un pedido claro («inventario valorizado», «reporte de ventas», «estado de cuenta», «cierre de caja»… o cualquier documento con «Solo consultas») recibe **403 `forbidden_document` en JSON antes de abrir el canal**, sin DeepSeek ni cupo, con bitácora; (c) si el modelo igual llama a una herramienta prohibida a mitad, el servidor corta ahí: lo que esperaba no sale, manda `text {reset:true}` y luego `error forbidden_document` (o, si era un cambio, `final` con la frase simple y sin tarjeta). El celular borra lo pintado y muestra solo la frase. El empleado ve sus primeras palabras igual de rápido que el dueño.
- **Datos del dueño en los trozos (empleado, regla de la sala sobre c97c41ca):** se tapa **solo el monto** con «[dato del dueño]» («El costo es [dato del dueño]»), en cada trozo, en `final.reply` y en el JSON (`redactOwnerData`). Una palabra del dueño entera (costo / costó / costos / costaron / costo unitario / cto. / c. unit / precio de compra / precio (al) proveedor / «el proveedor (nos) lo vende» / margen / ganancia / utilidad / inversión / invertí / ganaste / ganamos / gané / cost / frases de bodega: «lo que pagué», «pagué», «me salió a», «me sale a», «me costó», «nos costó», «lo traje a», «mi costo»; «el cliente pagó» y «pagó con Yape» NO cuentan) abre una ventana de 60 caracteres y el primer monto que llegue se tapa, **aunque haya en medio punto, punto y coma, salto de línea, «pero», «aunque», «sino» o «mientras»** (Bot 2 sobre c97c41ca: «El costo. S/ 1.80», «Margen\n30%», «costo, pero S/ 1.80»); «compré a / lo compré a / compramos a» igual con 40 y el monto después de «a», «por» o «en». **Solo una etiqueta de venta explícita** cierra la ventana y deja ver el monto que le sigue: «precio de venta», «P. venta», «PVP», «se vende a», «(lo) vendemos a», «vendo a» (no después de proveedor/nos, ni negada: «sin PVP», «no es precio de venta»). «precio» solo, «se vende» sin «a», «vendemos»/«vendo» sin «a» NO son etiquetas («costo, precio S/ 1.80», «El costo, se vende S/ 1.80» se tapan). La etiqueta va antes del monto: «costo… S/ 5.00 de precio de venta» se tapa (a prueba de fallas). **Bot 5 (f6061e85):** una etiqueta de venta pegada a la palabra del dueño (hasta 3 palabras entre medio, sin monto) no deja ver: «costo, se vende a S/ 1.80», «costo PVP S/ 1.80» se tapan. La ventana dura 60 caracteres **y** hasta el fin de la frase de la palabra (un monto a más de 60 en la misma frase se tapa). Palabra **negada** («no tengo / no sé / no hay / no lo tengo / sin dato / desconozco» + palabra del dueño): **zona negada** por el resto de esa frase y la frase o línea siguiente (el «;» no termina la frase; «.\n» cuenta como un solo fin). En la zona todo monto se tapa salvo detrás de una etiqueta de venta, y aquí también cuenta «precio» solo: «No sé el costo.\nEra S/ 1.80» y «No tengo el costo. Hay 24 unidades a S/ 2.50» se tapan (a prueba de fallas); «No sé el costo.\nEl precio es S/ 2.50» y «Desconozco el margen. El precio es S/ 2.50.» se ven. Una etiqueta del dueño al final de la línea tapa el monto de la línea de abajo («Costo unitario:\nS/ 1.80», «P. compra\n1.80»). «P. de compra» cuenta como precio de compra. **Monto antes de la palabra** («S/ 1.80 es el costo», «S/ 1.80 de costo»): el monto (y lo que sigue) espera hasta el fin de la frase; con una palabra del dueño en la frase se tapa, con etiqueta de venta o fin de frase sale; a los 160 caracteres sin fin de frase se tapa (a prueba de fallas). Límites de palabra que entienden acentos: «Arroz Costeño», «Galletas Costa», «Margarina Primor», «Ganadero» no cuentan; una palabra con mayúscula detrás de otra con mayúscula es parte de un nombre («Distribuidora Inversiones Lima»), salvo costo / precio de compra / proveedor, y salvo margen / ganancia / utilidad / inversión seguidas de un modificador del dueño (Bruto/a, Neto/a, Total, Unitario/a, Mensual, Anual, Real, Estimado/a): «Margen Bruto 30%» y «Arroz Margen Bruto 30%» se tapan. **Monto** = con S/, PEN o $ delante; o con decimales; o seguido de soles/sol/PEN/%/por ciento. Un entero solo no es monto. **Cantidad** (se salta) = número con unidad o «x12». Tablas (markdown con `|` o tabulador): si el encabezado de una columna es costo, precio de compra, proveedor, margen, ganancia, utilidad o cost (también abreviado: «P. compra», «P.compra», «Pr. compra», «Costo unit.», «C. unit», «Cto.»), sus celdas se tapan; «Precio», «P. venta» y «P. unit» quedan visibles. Encabezado = solo la primera fila de la tabla o la fila justo antes de `|---|`, con palabra entera sin tildes («Arroz Costeño», «Galletas Costa» no son encabezado: la lista de 480 filas queda intacta); la fila espera entera solo mientras esa tabla sigue. **En partes (Bot 3):** un solo lector de izquierda a derecha, el mismo para el texto entero, con estado chico entre trozos (ventana abierta, etiqueta de venta, estado de tabla, monto esperando); lo que no es monto sale enseguida, también después de una palabra del dueño. Sin freno de 160 ni cola fija. Medido (4000 caracteres en trozos de 5): CPU total 1-7 ms dueño/empleado (antes 20-42 ms; 3,3 s con 4000 dígitos); primera letra a los 25 caracteres, igual dueño y empleado; peor caso (monto al inicio y una línea de 4000 sin punto): el empleado espera 205 caracteres (el tope de 160) y luego sigue, ~9 µs por trozo. Prueba de propiedad: con cortes al azar lo enviado es exactamente el filtro del texto entero. Correo: expresión acotada (local 1-64, dominio 1-63 × hasta 8, final 2-24), lineal: 50 KB adversarios en ~12-18 ms (antes ~1,9 s). La tarjeta de documento solo muestra el cliente en el estado de cuenta. Con `text {reset:true}` el celular borra lo pintado y vuelve a «Pensando» con puntitos (Bot 4).
- **Zona negada y «precio» (Bot 5 sobre f58a3947):** en la zona negada «precio» solo deja ver el monto pegado: «precio es/sería/será S/ …», «precio: S/ …», o «Precio S/ …» al empezar frase o línea. Con palabras en medio («precio al que lo traje:», «precio anterior del proveedor», «precio de antes fue») o «No sé el costo, precio S/ 1.80» (misma frase, coma) se tapa. «precio anterior/actual/… del proveedor» cuenta como palabra del dueño también fuera de la zona. **Tablas** (| o tabulador, con o sin separadora): la ventana del dueño y la zona negada abiertas antes de una fila con 2+ celdas no pasan a la fila siguiente; se sueltan al cerrar la primera celda con texto de esa fila (un monto en esa primera celda sigue tapado; si la línea siguiente no es fila, nada cambia).
- **Presentación del dueño antes de una tabla o lista (Bot 3/4/5 sobre 1c17310c):** si alguna de las 3 últimas frases del bloque de texto (líneas en blanco valen) tiene una palabra del dueño (negada o no), y la línea siguiente empieza una tabla (`|`, o un tabulador antes de cualquier monto) o una lista (`-`, `*`, `•`, `1.`, `1)`), se tapan sus montos a medida que llegan: tabla, salvo columnas con encabezado de venta (PVP, P. venta, Precio de venta, Venta, con «(S/)», «S/» o negrita; nunca si nombran al dueño: «Costo de venta», «Venta (costo)», «P. venta / costo»; «Precio» solo vale si otra columna es del dueño o la presentación fue negada); lista, salvo ítems con etiqueta de venta. Una línea que no es tabla ni lista sigue como texto normal: **no se retiene nada extra** (Bot 3: la línea siguiente ya no se retiene; 20 caracteres como en 7150d291). Las filas de tabla no cuentan como presentación. La separadora `|---|` y una 1.ª fila clave-valor no sueltan la ventana del dueño; «PVP» bajo «Costo» no se tapa. **Venta con dueño detrás:** un monto con etiqueta de venta en la zona negada, en una celda o en una lista espera hasta el fin de su frase/celda/ítem (cruza hasta 2 saltos de línea, tope 160) y se tapa si después nombra al dueño; no lo tapa otro monto ni una frase del dueño que mira adelante tras «y» («Precio S/ 2.50 y lo traje a S/ 1.80» deja ver 2.50). Verbos: pagamos, lo/la pagué/pagamos a, me/nos sale/salió/salieron a, te salió a, lo/la/los/las traje/trajimos/conseguí/conseguimos a, compraste. «te sale a» (precio a un cliente) no cuenta.
- **Datos que llegan al modelo, por rol (defensa en datos, Bot 5):** DUEÑO: system prompt, `<datos_pos>` con productos {id, nombre, precio, stock, costo}, historial tal cual, herramientas del dueño, resúmenes de consultas completos (incluye costos, compras con proveedor y soles, ventas, deudas), foto. EMPLEADO: system prompt de empleado (sin datos), `<datos_pos>` con {id, nombre, precio, stock, controla} (el costo y cualquier otro campo del aparato se descartan, lista blanca), historial donde todo turno que nombra al dueño (costo, compré, margen, proveedor, pagué…) se cambia por «[mensaje anterior omitido]» y el resto pasa por el filtro de montos, herramientas explicar_pasos/consultar (solo stock_producto y bajo_stock)/preparar_documento (solo lista_precios y lista_pedido, si el nivel lo permite), resumen de consulta por lista blanca {encontrados, productos{nombre, stock, minimo}, total, revisados, primeros} y además sin ninguna clave del dueño, documentos NO van al modelo (filas del servidor solo al aparato), sin foto (403). El texto que el empleado escribe va tal cual (lo escribió él); si pega una factura y el modelo repite costos, la respuesta se tapa. Prueba: `assistant-employee-data.test.mjs` captura cada pedido al proveedor (OpenAI compatible, Anthropic, Gemini, JSON y en partes).

### Foto solo del dueño (servidor, Bot 5)
En `/auth/assistant/chat` el rol se resuelve primero. Sin rol / apagado: 403 `assistant_off` sin leer el cuerpo. Empleado con nivel que manda foto: **403 `image_owner_only`** (`message: "Eso solo lo puede hacer el dueño."`) antes de leer o interpretar la foto: cabecera `x-assistant-image: 1` o tipo `multipart/`/`image/`, `content-length` > 64 KB, lectura con tope de 64 KB (`readBounded`, corta sin bajar el resto) y búsqueda del campo `"image"` sin `JSON.parse` (`hasImageField`); respaldo tras el parse. Sin cupo y sin DeepSeek. Bitácora: agrupada por aparato y minuto como los otros 403 de rol (`img_owner_only`). No es `forbidden_role` para que el celular no quite el asistente; el celular lo muestra como «Eso solo lo puede hacer el dueño.», sin «Reintentar».

### Una sola tarjeta por acción (servidor)
`dedupeActions`: si el modelo propone dos veces el mismo cambio para el mismo producto (mismo tipo + `product_id`; compra: una por pedido; producto nuevo: por nombre), queda la primera y las demás van a `dropped` como `duplicate_action`. Consultas y documentos no se tocan.

## Lo que NO existe (a propósito)
Ventas o carrito, comprobantes SUNAT, importar, descuentos, anular ventas, reset o respaldo, cajeros, PIN, abrir o cerrar caja, gastos y **abonos** (un abono futuro iría por `canonical-credit-payment-bridge.js`).

## Cliente
- Cargador `asistente-loader.js` (solo con `?asistente=1`, después de que el POS abrió). `asistente-core.js` (`NA_ASISTENTE_CORE`), `asistente-ui.js` (`NA_ASISTENTE`), `POS/css/asistente.css` (sin imágenes: burbuja 100 % CSS).
- Cargador: antes de bajar el asistente hace UN ping (`POST /auth/assistant/chat {"ping":true}`, cuerpo de 13 bytes, sin modelo ni cupo). Solo con 200 (dueño o empleado encendido) o 403 `reason:"sin_rol"` carga `asistente.css`, `asistente-core.js` y `asistente-ui.js`. Empleado en Apagado: 0 archivos, su POS arranca igual que hoy (prueba `assistant-loader.test.mjs` y medición en navegador). Sin internet solo carga si el último ping dijo dueño (`localStorage na_asistente_acc`). Vuelve a preguntar al volver a la app, al reconectar y al entrar a Inicio (máx. una vez cada 10 s; si se cortó internet, al volver pregunta enseguida). El pedido corre en un momento libre después de abrir el POS, se corta a los 3 s (AbortController) y si falla queda lo que había.
- Ping → 200 `{ok, enabled, role, level, vision}` (`PING_FIELDS`). `vision` es `true` solo para el dueño y solo si el modelo en uso lee fotos (proveedor/modelo activo o `AI_VISION`; demostración: `true`; sin proveedor: `false`); nunca dice qué proveedor ni qué modelo. Con `vision:false` el celular NO sube la foto: muestra «Leer fotos no está disponible por ahora.» al instante (igual que «Eso solo lo puede hacer el dueño.» para el empleado).
- Foto: el celular agrega `?image=1` a `/auth/assistant/chat` cuando manda una foto (no se usa encabezado nuevo para no tocar CORS; el servidor también acepta `x-assistant-image: 1` o un `content-type` de imagen/multipart). El servidor decide si el modelo lee fotos ANTES de leer el cuerpo: si no lee y la foto viene avisada, o el `content-length` pasa de 256 KB, responde 422 `image_unsupported` sin leer nada; sin aviso lee como mucho 256 KB, corta y responde 422 si trae `image`. Sin cupo, sin llamar al proveedor.
- Inicio: tarjeta **solo para el dueño**, ARRIBA (zona «Hola, ¿qué deseas hacer hoy?»). Si el último ping guardado dice dueño, un `<script>`/`<style>` mínimo en el `<head>` de `index.html` reserva ese alto desde el primer pintado (margen sobre `.quick-stats`: 353/304/398/314 px = alto + márgenes + gap) y el cargador lo cambia por el hueco real de alto fijo (`#naAsstHero`: 321 px <380, 272 px 380-699 (valor de Bot 4), 364 px ≥700, 280 px ≥1100). Ese alto es EXACTAMENTE el de la tarjeta: `asistente.css` fija las líneas por tramo (título y texto en 2 líneas; atajos en 2 filas bajo 380 px, en 1 fila con texto corto de 380 a 699, en 2 filas en tableta; 1 línea y 1 fila en PC), así no queda franja vacía ni atajos cortados. Primera visita (sin rol guardado) con Inicio a la vista: la tarjeta no se inserta (se ve la burbuja); entra al salir de Inicio o en el próximo arranque, así el CLS sigue en 0 sin mover nada (CLS del asistente = 0 a 390/768/1280); ese dato guardado SOLO reserva espacio, todo lo demás lo decide el servidor. Si el ping (o una respuesta del servidor) dice que no es dueño: se borra el dato y en ese instante sale del DOM TODO el contenido de la tarjeta (atajos, campo, datos); el hueco queda con su alto y solo el aviso «El asistente no está disponible en este aparato.» (sin datos del dueño, sin botones ni enlaces) hasta salir de Inicio, y ahí se libera. Así no salta la pantalla. Sin internet: «Asistente no disponible sin internet.»; el resto de Inicio sigue igual. Burbuja flotante abajo a la derecha sin tapar nada; en Inicio la reemplaza la tarjeta. El menú desplegable del celular (Inicio, Punto de Venta, Ventas, Inventario, Clientes, Caja, Gastos, Configuración) no se tocó.
- Configuración > Personal y seguridad > Aparatos conectados: selector de 3 niveles por aparato de empleado (se guarda solo, pide PIN), aparatos dueño con «Quitar» (aviso previo) y «Pendiente de aprobar» con Aprobar/Rechazar. En un teléfono sin rol: «Registrar este teléfono como dueño».
- Servidor local: `node tools/asistente-proto/dev-server.mjs 4471` (rol simulado con `x-proto-role`: dueño, `empleado`, `sinrol`; nivel con `x-proto-level`; PIN `0000` simula PIN incorrecto).
- Burbuja y tarjeta de Inicio: se pausan con la pestaña oculta, con una ventana del POS abierta, mientras se desplaza la pantalla o se escribe (vuelven tras ~0,7 s quietas) y tras 9 s en reposo; despiertan al llegar una respuesta. Con «reducir movimiento» del sistema no se animan. En toda página donde se ve la burbuja se agrega espacio abajo a la página para que la última fila no quede debajo.

## Bitácora y control de inventario (sobre 1b87710d: Bot 2, Bot 3 y Bot 5)
- Cajones con tope propio, decididos por el rol que lee el SERVIDOR (resuelto antes de leer el cuerpo, en chat y confirm):
  `o` acciones del dueño (1000) · `or` rechazos del dueño uno por uno (300) · `oa` 429/403 de rol del dueño agrupados por minuto (100) ·
  `r` acciones de empleados (300) · `a` TODO rechazo de un aparato que no es dueño (empleado o sin rol), agrupado por aparato, minuto, ruta y motivo con `count` (300).
  Nada de otro teléfono (bad_token, cuerpo malo, 429, 403...) puede sacar filas del dueño.
- `/auth/assistant/chat` anota sus rechazos igual que el confirm (`src:"chat"`, clave `...:c<motivo>`; confirm `...:k<motivo>`). Nunca el texto, la foto, el PIN ni secretos.
- `GET /auth/assistant/audit?limit=N[&grupo=o|or|oa|r|a]`: sin grupo, `entries` trae primero las filas del dueño, luego sus rechazos y al final las de empleados; `grupos` cuenta cada cajón; con grupo, solo ese cajón (grupo inválido: 400). Cada entrada lleva `grupo`.
- Control de inventario de una tarjeta (chat y confirm): `canonicalReader().productsById(ids)` lee SOLO esos ids (`product_id IN (...)`, tramos de hasta 50 ids con parámetros enlazados; importados + creados en vivo de la promoción activa). Sin tope de 5000 productos. Consulta caída -> 503 `stock_check_unavailable`; id que no vuelve -> 409 `product_missing`; no se gasta ni la aprobación ni la tarjeta.

## Permiso que cambia con la app abierta (sobre 50b6716b: Bots 2, 3, 4 y 5)
- `assistantAccess`: teléfono SIN fila de rol = `sin_rol` (antes `empleado:off`); así aparece en la bitácora. Sigue sin asistente (403 `assistant_off`, `reason:"sin_rol"`). Error de base: `empleado:off` (falla cerrado).
- Chat: si la lectura por id del inventario FALLA, no se ofrece ninguna tarjeta de compra ni de ajuste (ni las de costo que salen de la compra); `dropped: stock_unavailable` y un mensaje simple. El confirm ya fallaba cerrado (503).
- UI: 403 `assistant_off` / `forbidden_role` / `admin_only` en chat o confirm → se cierra el panel y se QUITAN del DOM burbuja, panel y tarjeta; se borra `na_asistente_acc` (un recargo no reserva hueco). `assistant_off`: aviso neutro con el `toast` del POS sin tipo: «El asistente fue desactivado por el dueño». `forbidden_role`/`admin_only`: ping enseguida y, si todavía tiene asistente, se arma de nuevo con su rol y nivel.
- UI: 403 `forbidden_document` (bajaron «Consultas y documentos» a «Solo consultas») → el panel sigue abierto, salen las tarjetas de documento (y su vista previa) y el nivel pasa a `consultas` (atajos nuevos); un ping lo confirma.
- UI: re-chequeo con el mismo ping al entrar a Inicio, al reconectar y al volver a la app (máx. 1 cada 10 s, en momento libre, corte a 3 s). Sin permiso: fuera la UI.
- Relleno bajo la burbuja: se MIDE. Con el contenedor que de verdad desplaza la última opción tocable (en la franja de la burbuja), se calcula dónde quedaría con todo desplazado abajo (`C.padOverlap`); solo si la burbuja la taparía (borde de arriba − 12 px) se agrega lo que falta (+8 px). En el celular se tiene en cuenta lo que la cabecera de Clientes/Inventario/Ventas se achica al desplazar (`NA_MOTION.scroll.inspect`, solo lectura). En tableta/PC nunca se rellena `#pageMenu` (solo su `.main-scroll` si tapa) y nada se rellena antes de saber el permiso.

## Ronda Bot 2 sobre 1c17310c

- **Monto al final de línea**: espera solo los primeros ~20 caracteres con texto de la línea siguiente (o una línea en blanco). Si ahí empieza una frase de dueño, también entre paréntesis («(lo que pagué)», «Eso es lo que pagué»), se tapa; si no, sale enseguida. La retención llega a 65 caracteres en el peor caso (20 más lo que hace falta para decidir una frase que empieza dentro de esos 20) y siempre queda debajo del tope de 160.
- **Títulos de compras/proveedor**: «Resumen de compras:», «Compras de hoy:», «Factura del proveedor», «Boleta del proveedor» cuentan como presentación del dueño para la tabla o lista que sigue (barras, tabuladores, viñetas). En prosa normal, compras/proveedor NO tapan nada.
- **Mayúsculas tras artículo o posesivo** («El Margen», «Tu Inversión», «La Ganancia») son palabras del dueño; la excepción de nombre propio ya no vale ahí.
- **Título de precios corta la presentación**: una línea en blanco y luego un título propio («Precios de hoy:», «Precios:», «Lista de precios») corta la presentación del dueño anterior. Una columna «Precio» sola es de venta (visible), salvo que la MISMA tabla tenga una columna del dueño.
- **Historial firmado**: el servidor ya no cree las marcas de rol que manda el cliente. Cada respuesta trae `turns` firmados con HMAC (ASSISTANT_CONFIRM_SECRET, sobre versión, clase, dispositivo/sesión, rol y texto). En pedidos de empleado solo vuelven al modelo los pares (usuario, asistente) firmados como empleado para ese mismo dispositivo. Los turnos sin firma, firmados como dueño, de otro dispositivo o alterados se descartan junto con su respuesta. Sin secreto, no viaja historial de empleado. Como segunda capa, los turnos con palabras del dueño se siguen cambiando por «[mensaje anterior omitido]».
- **Cliente**: el chat vive solo en memoria. Al cambiar de rol (dueño→empleado) o al cerrar sesión se borran el historial y la interfaz.

## Ajuste sobre 43a80dbc: «Precio» solo

- Si una presentación del dueño SIN negar va justo antes de la tabla, una columna «Precio» sola se tapa: el modelo puede llamar «Precio» al costo. Solo las etiquetas de venta explícitas (PVP, P. venta, Precio de venta, Venta…) siguen visibles.
- «Precio» solo queda visible cuando: no hay presentación del dueño; la presentación está cortada por una línea en blanco más un título de VENTA («Precios de hoy:», «Precios:», «Lista de precios», «PVP», «Precios de venta»); o la presentación está negada y la tabla no tiene columna del dueño.
- La negación vale antes de la palabra («No tengo el costo, …») y también detrás, en la misma frase y a menos de 24 caracteres («El costo no lo tengo, pero esta es la lista:», «El costo no lo sé», «lo desconozco»). Si en la misma presentación hay otra frase del dueño sin negar, la presentación cuenta como NO negada.
- Un título neutro tras la línea en blanco («Detalle:», «Aquí va:», «Resumen:») NO corta la presentación.
- En las listas no cambia nada: un ítem con «Precio» solo bajo una presentación del dueño sigue tapado.
- Velocidad (Bot 3): la llave HMAC se importa una vez por secreto, y mientras se espera el mismo monto no se relee su cabeza. No se aflojó ningún tapado.

## Bot 5 sobre 43a80dbc

- **Celda de venta con dueño delante**: una palabra del dueño en la MISMA celda antes del monto («| costo S/ 1.80 |», «| Costo: S/ 1.80 |» bajo PVP) tapa el monto. Antes solo se miraba lo que venía después.
- **Título de precios con dueño**: un título que nombra compra, proveedor o costo («Precios del proveedor:», «Precios de hoy (compra):», «Precios de compra:») NO corta la presentación del dueño y además cuenta como presentación. Plural nuevo: «precios de compra», «precios del proveedor».
- **Título en la misma línea**: hasta 5 palabras y 40 caracteres antes de «:», con compras/proveedor o una palabra del dueño sin negar («Compras de hoy: Galleta S/ 1.80», «Los precios de compra: Galleta S/ 1.80, Arroz S/ 3.10»). Todo monto que sigue en ESA línea se tapa, salvo los que llevan etiqueta de venta. En una frase larga («Las compras de hoy fueron buenas: …») no se aplica.
- **Listas**: también cuentan «-Galleta» sin espacio y «a) Galleta». Tras una presentación del dueño sin negar que termina en «:», las líneas seguidas sin viñeta son ítems y se tapan todas, hasta una línea en blanco.
- **Monto al final de línea**: las líneas en blanco no cortan la mirada. Se miran los primeros 20 caracteres con texto de la siguiente línea que tenga texto, dentro del tope de 160 («Galleta S/ 1.80\n\n(lo que pagué)» se tapa).
- **Partes**: en una celda o etiqueta de venta, si llega otro monto a medias («10 por ciento» partido entre partes), se espera a tenerlo entero antes de decidir. Así el resultado en partes es igual al del texto entero.
- **Historial firmado por par**: una sola firma HMAC ata pregunta y respuesta, junto con versión p2, clase, aparato, número de par y hora de emisión (`n`, `iat`). En pedidos de empleado se descartan:
  - pares empalmados (pregunta de un par con respuesta de otro);
  - números o horas cambiados;
  - pares repetidos o fuera de orden (solo valen números crecientes);
  - pares con más de 24 h, o con hora más de 5 min en el futuro.
  El número del par nuevo sigue al último par válido. El cliente guarda `n` e `iat` tal como llegan.

## Bot 5 y Bot 3 sobre a82a747f

- **Título largo en la misma línea**: además del título corto (hasta 5 palabras y 40 caracteres), cuenta como título del dueño sin importar las palabras, hasta 120 caracteres antes de «:», si EMPIEZA con «Compras» («Compras de hoy en la tienda: Galleta S/ 1.80») o nombra «proveedor», «de compra» o «costo» sin negación en la línea («Compras de hoy del proveedor Lima Norte: Galleta S/ 1.80»). Todo monto que sigue en esa línea se tapa, salvo con etiqueta de venta.
- **«cliente» solo anula «compras»**: si lo que va antes de «:» dice «cliente» y el título cuenta SOLO por la palabra «compras» (regla larga «empieza con Compras» o regla corta sin otra palabra), no cuenta: «Las compras del cliente: S/ 30», «El cliente pagó sus compras: S/ 30» y «Compras del cliente Juan: S/ 30» se ven. Con «proveedor», «de compra», «costo» u otra palabra del dueño sin negar sigue contando: «Costo del pedido del cliente: S/ 1.80», «Compras al proveedor para el cliente Juan: S/ 1.80» y «Precio de compra del cliente: S/ 1.80» se tapan.
- **Sin espera extra**: el título se marca palabra por palabra mientras pasa la línea; no se retiene nada esperando el «:». Si no llega «:», el monto lo decide la regla normal (500 caracteres que empiezan con «Compras», sin «:», monto en 30 o 130: retención máx. 175-179, igual que antes).
- **Rachas de espacios (Bot 3)**: las líneas en blanco hechas de espacios ya no se retienen enteras en la etapa de datos sensibles (se corta también entre dos espacios, salvo si «clave», «RUC», «DNI» o una foto «data:» esperan su valor). Así cuentan dentro del tope de 160: 30 líneas de 10 espacios tras un monto retenían 355, ahora 180-184.

### Queda como INFO (sin arreglar, a propósito)

- Tras una presentación del dueño sin línea en blanco, «Para vender, el precio es S/ 2.50» también se tapa (tapa de más, no fuga).
- Un chat nuevo reinicia el número de par: un par viejo (menos de 24 h) puede repetirse o mezclarse con otro chat. No es fuga: siempre es texto del mismo empleado en el mismo aparato.
- Leyenda después de la tabla, «El precio\nes», más de 20 caracteres en el renglón siguiente y «Precios:» genérico (ya anotadas antes).

## Celular (Bot 4/3/5 sobre 66f1ecb5), sin cambios en el servidor

- **Foto con `vision:false`**: si el ping dice que el proveedor en uso no lee fotos, no se muestran el botón de foto ni el chip «Leer factura», tampoco al dueño. El aviso «Leer fotos no está disponible por ahora.» de `send()` queda de respaldo. Si `vision` cambia, el panel se vuelve a pintar.
- **Proveedor en uso desde el inicio**: arriba de la lista sale «En uso: <proveedor> · <modelo>» con lo que ya trae `GET /auth/assistant/provider` (`current`, también cuando viene del servidor: «(del servidor)»). Sin proveedor listo: «En uso: ninguno todavía…» o «Falta poner una clave en el servidor». A menos de 768 px la lista deja 96 px abajo para que la burbuja no tape el último «Usar».
- **Tablas en la respuesta**: una línea «| … |» seguida de «|---|» se dibuja como tabla. Se trabaja sobre el texto que YA llegó filtrado (el servidor tapó los costos): solo se le da forma, nunca se agrega ni se recupera nada.
  - Solo `createElement` + `textContent`; nunca `innerHTML`; ningún texto del modelo va en atributos (solo `scope="col"` y `aria-hidden="true"` fijos). `<img onerror>` o `<script>` en una celda se ven como texto.
  - En partes: cada fila se dibuja al cerrar su línea; el estado se guarda y no se relee el mensaje. Solo espera una línea que empieza con «|» (hasta su salto) y la cabecera (hasta ver si sigue «|---|»). El resto del texto sale enseguida, como antes.
  - A 480 px o menos, cada fila es una ficha «Columna: valor». «[dato del dueño]» va en un span que no se parte.
  - El texto final del servidor reemplaza al pintado solo si cambió (se compara con el texto crudo recibido).
  - Las respuestas tienen un tope de 1200 caracteres (unas 30 filas). La prueba de 480 filas mide el peor caso.

## Servidor sobre 87c6fe8e (Bot 3, Bot 2, Bot 5)

- **Espacios sin redactText (Bot 3)**: en la etapa de datos sensibles, un tramo soltado que es solo espacios sale tal cual, sin pasar por `redactText` (ningún patrón puede tapar solo espacios). Dónde se corta no cambia: con una clave/pin/token, RUC, DNI o `data:` esperando su valor no se suelta nada, tampoco durante una racha de espacios. 3300 espacios en trozos de 1: dueño 2,4 → 0,6 ms; empleado 3,2 → 1,2–2,1 ms. La salida es la misma.
- **Tope de 1200 con aviso (Bot 2)**: igual para dueño y empleado, contado sobre el texto YA filtrado (lo que se ve). Si se pasa, se corta en el último salto de línea dentro de los últimos 160 caracteres (una fila no queda a medias); si no hay, en el último espacio; si tampoco, en 1200. Después va una línea en blanco y «Respuesta cortada por largo. Escriba "sigue" para ver el resto, o pida el documento.». Pasa igual en la respuesta final (`capReply`) y en lo pintado: cerca del tope el emisor espera a lo más 160 caracteres para saber si se pasa, así las dos coinciden. `max_tokens` no cambia.
- **«sigue» del empleado (Bot 5)**: si el último par FIRMADO y válido terminó con el aviso, el filtro del empleado arranca con un contexto (`cutPrime`): la cola del párrafo anterior (~150), más el comienzo del último párrafo (presentación y encabezado, ~300, en líneas enteras), más su última línea. Unos 300–600 caracteres. El contexto pone el estado (presentación, zona negada, tabla abierta) y nunca sale. No hay contexto para el dueño ni sin par válido. Costo: unos 0,1 ms; la retención no cambia (40 → 40).

## Servidor sobre 5c19afb8 (Bot 5 «sigue», tope y tabla; Bot 2 tapado de más)

### «sigue»: el contexto solo puede tapar más (Bot 5, FALLA en 5c19afb8)

- **Marca de corte firmada**: el SERVIDOR marca el par que él mismo cortó (`cut: true` en el turno del asistente). La marca va DENTRO de la firma HMAC del par: solo se agrega `"cut"` a lo firmado cuando es true, así que los pares sin corte firman igual que antes. Si el aparato agrega `cut:true` a un par sin corte, o se lo quita a uno cortado, la firma no verifica y el par se descarta entero. El celular guarda `cut` tal cual con el turno.
- **Nunca por el texto**: `cutPrime(reply, cut)` ya no mira si la respuesta termina con el aviso. Sin la marca firmada devuelve false. Una respuesta del modelo que trae el aviso no prepara nada.
- **Solo un sí/no**: de la parte cortada pasa solo «había contexto del dueño abierto». Cuenta como sí: una presentación sin negar, la ventana de una palabra del dueño, una lista o tabla presentada por el dueño, o una tabla con columna del dueño. Nunca pasa el estado de una tabla de venta, de una zona negada ni de columnas.
- **Superconjunto por construcción**: con el sí, el filtro corre exactamente igual que sin contexto (mismo estado, mismas decisiones). Además tapa todo monto que dejaría ver, mientras dure: hasta la fila `|---|` de una tabla NUEVA (desde ahí deciden sus columnas: una tabla de venta nueva se ve) o hasta el 2.º párrafo de la continuación.
- **Diferencial**: 455 casos × 17 contextos, los 16 de Bot 5 más «sí» forzado, tratando también los avisos forjados como marcados (el peor caso): 0 destapes, 822 más estrictos, el contexto nunca sale, partes = entero. 30 000 textos al azar más el corpus de 710 frases, sí contra no: 0 destapes. Hay una prueba en el repo.

### Tope de 1200 (Bot 5)

- El corte nunca parte una etiqueta («[dato del dueño]», «[oculto]», «[imagen omitida]»). Nunca deja «S/ », «US$», «$» o «PEN» sin número, ni un monto a medias en el corte duro sin espacios: retrocede hasta antes de la etiqueta o la moneda, como mucho `CUT_SLACK` = 24 caracteres más.
- Lo pintado espera `CUT_ZONE + CUT_SLACK` = 184 caracteres cerca del tope (antes 160) y corta en el mismo lugar que `capReply`.
- Sonda de tope de Bot 5 (1586 casos): 0 fallas.

### Tabla del dueño con una línea en medio (Bot 5)

- UNA línea, en blanco o de texto, justo después de `|---|` ya no corta la tabla, ni en la capa de columnas ni en la de presentación. Ejemplo: «Te paso los costos:\n| Producto | Precio |\n|---|---|\n\n| Producto 0 | S/ 1.80 |» se tapa. Una tabla de venta con esa línea se sigue viendo.

### Tapado de más (Bot 2 sobre 66f1ecb5)

- **(a)** En la línea SIGUIENTE (mirada de 20) solo cuentan frases de compra: «lo que pagué», «me costó», «costó», «(costo)», «costo:» + monto, «a costo», «de compra», «precio de compra», «lo pagamos», «me salió», «lo traje», «lo conseguí», «proveedor». «costo» suelto no cuenta: «Arroz S/ 4.20\nEl costo lo ve el dueño.» deja ver 4.20.
- **(b)** La palabra del dueño dentro de un ítem de lista tapa solo ese ítem: «Precios de hoy:\n- Arroz: costo S/ 1.80\n- Leche: S/ 3.80» tapa 1.80 y deja 3.80. Una presentación del dueño antes de la lista sigue tapando todos los ítems. Lo mismo vale para las filas con tabulador.
- **(c)** «Compras del cliente:» (título solo por «compras», con «cliente») no presenta la lista ni la tabla de abajo. Con costo, proveedor o «de compra» en el ítem, ese ítem se tapa igual.
- **(d)** La presentación del dueño, y la ventana de 60 de una palabra del dueño, alcanzan su párrafo y el inmediatamente siguiente. Un párrafo neutro en medio las corta.
- Los 9 casos del informe de Bot 2 pasan a verse. En el corpus de 710 frases solo cambian esos 9, y ninguna prueba de tapado existente cambió.

### Queda como INFO (sin arreglar, a propósito)

- **factura**: los montos de una factura de compra (eco de la foto, lista o tabla «De tu factura:», «Según la factura…») se siguen viendo para el empleado. Es el mismo INFO de antes. El empleado no puede leer facturas: la foto es solo del dueño.
- **Soltar los espacios mientras una etiqueta espera su valor (Bot 3, opcional)**: (reemplazado más abajo, «Espacios largos tras una etiqueta») no se hizo, porque el texto visible no queda igual. Con RUC, DNI y «data:», la redacción del texto entero se traga los espacios («RUC:<500 espacios>20123456789» → «RUC *******6789», «DNI ****5678», «[imagen omitida]»), así que soltarlos antes cambia la forma. Con clave o pin haría falta un estado nuevo sin la palabra en el mismo tramo, con riesgo de soltar el valor. La retención de esas rachas sigue igual (515–565).
- Texto sin ningún espacio: la etapa de datos sensibles retiene todo hasta el final (1547 en la sonda de Bot 5). Sin fuga. (Para el empleado ya no: ver «[texto largo omitido]» más abajo. El dueño sigue igual.)
- Un par cortado de una charla anterior (<24 h) se puede repetir y vuelve a preparar el filtro. Ahora solo tapa más.
- ~~«Compras para el cliente: Galleta S/ 1.80, Arroz S/ 3.10»~~ (ya se tapa, ver abajo) y los límites ya conocidos (más de 20 caracteres en la línea siguiente, «Precios:», títulos de más de 120 caracteres o sin «:»).

## Servidor y celular sobre f3375c09 (Bots 2, 3, 4 y 5)

### «cliente» acotado (Bot 2)

- La excepción de «cliente» vale solo para «del cliente», «de los/las clientes» y «el/los cliente(s) (ya) pagó/compró/pagaron/compraron». «Compras del cliente: S/ 30» se ve.
- «para el cliente» NO es excepción: «Compras para el cliente: Galleta S/ 1.80, Arroz S/ 3.10» se tapa, también como presentación de lista. «Compras de clientes: S/ 30» (sin artículo) ahora se tapa: se prefiere tapar.
- «el cliente compró/pagó» ya no cuenta como palabra de compra del dueño en la ventana («Compras que el cliente compró…»).

### Párrafo neutro (Bot 2, regla refinada)

- Un párrafo neutro corta la presentación del dueño y la ventana de 60 solo si NO termina en «:» y tiene 8 palabras o más, o si lo sigue un título de venta. «Te paso los costos:\n\nSon de esta semana.\n\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |» se tapa.
- De los 9 casos de Bot 2, vuelve a taparse **c3.parrafosAtras** («El costo lo vemos luego.\n\nVale.\n\n| … |» y su variante con «Aquí va otro párrafo sin montos.»). Los otros 8 se siguen viendo.
- La misma regla para el tapado forzado de «sigue»: ya no para en el 2.º párrafo. Para solo en una cabecera `|---|` nueva o en un párrafo neutro de 8 palabras o más sin «:». «Siguen:\n\n| Galleta | S/ 1.80 |» se tapa.

### Tabla del dueño con huecos (Bot 5, FALLA en f3375c09)

- La tabla del dueño (capa de columnas y capa de presentación) aguanta cualquier cantidad de líneas en blanco y de líneas cortas de texto, entre `|---|` y las filas y en medio. Termina solo con la regla del párrafo neutro, con un título de venta (una línea que EMPIEZA con «Precio(s)», «PVP» o «Lista de precios») o con una cabecera `|---|` nueva.
- Se tapan: 2 líneas en blanco antes de la fila, «zz\nyy» antes de la fila, y una línea en blanco en medio antes de «| Producto 1 | S/ 1.81 |». La tabla de venta con huecos se sigue viendo.
- Retención sin cambios: igual a la base en la sonda de retención (máx. 184).

### Corte de 1200: nunca parte un número (Bots 2/4/5, invariante)

- El corte nunca parte un número, con o sin moneda o separadores («S/ 1,250.40», «S/1,250», «aS/2», «US$2», «1,250 unid.», «12.5 kg»). Retrocede hasta antes de la moneda o del inicio del número, aunque pase de `CUT_SLACK`, y prefiere un salto de línea cercano.
- Hay una prueba de propiedad en el repo: textos al azar con montos cerca de 1200. Cada número de lo que queda aparece entero en el texto completo en la misma posición. Partes = final. En la base de pruebas: 3 × 2000 textos, 0 malos.
- Si lo que queda es vacío (por ejemplo, 4000 dígitos seguidos), lo pintado lleva el mismo aviso que `capReply`.

### «[texto largo omitido]» (Bot 3/2, solo empleado)

- En los turnos del EMPLEADO, una racha de más de 160 caracteres sin espacio (URL, base64, texto pegado) se cambia por «[texto largo omitido]» y lo demás sigue en partes. Se hace igual en el texto entero y en partes (partes = entero).
- Se deja el primer carácter de la racha («h[texto largo omitido]»): así la etapa de datos sensibles puede soltar hasta ahí sin esperar.
- Las imágenes «data:…;base64,» siguen saliendo como «[imagen omitida]».
- El dueño (texto y documentos) ve los enlaces y códigos largos enteros.
- Una etiqueta pendiente (RUC, DNI, clave, pin, token, api key) sigue pendiente después del tramo quitado: «RUC:» + 300 caracteres basura + « 20123456789» sale tapado.
- En el celular sale como texto normal, sin estilo especial.
- **INFO (Bot 4)**: idea para después, un campo del servidor que marque el tramo quitado y que el celular lo muestre como nota. No se hizo.

### Espacios largos tras una etiqueta (Bot 3)

- Mientras una etiqueta RUC, DNI, clave, pin, token, api key o «data:» espera su valor, una racha de espacios o saltos de más de 160 se junta en UN espacio. Vale para dueño y empleado, en el texto entero (al inicio de `redactText`) y en partes. Es la misma función, así que el resultado es idéntico.
- Cambia la forma visible con clave o pin: «clave<500 espacios>1234» ahora sale «clave [oculto]». El valor sigue tapado.
- La retención baja de 515–565 a 31 como mucho (medida sin contar lo descartado). Las 22 sondas de etiquetas pendientes pasan.

### «data:» con espacios (Bot 5)

- «data:» + espacios o saltos + «image/png;base64,…» → «[imagen omitida]», entero y en partes.

### Celular (Bots 4/5/3)

- **Aviso de corte**: la respuesta (JSON y evento final en partes) lleva `cut: true|false`, puesto por el servidor. El celular pinta la última línea como nota (`.na-asst-note`) SOLO si `d.cut === true`. Nunca busca el texto del aviso: un aviso escrito por el modelo sale como texto normal.
- **Cabecera reusada**: en la respuesta que sigue a una cortada, las filas sueltas del inicio (con el mismo número de columnas) usan la cabecera de la última tabla de la burbuja anterior. Esa cabecera sale solo de lo que esa burbuja ya pintó (texto ya filtrado por el servidor), nunca de otros datos. No se reusa después de una tabla propia de la burbuja.
- **360 px**: las burbujas llevan `overflow-wrap:anywhere`, así que un token largo sin espacios no desborda a lo ancho.

### Cambios en el corpus (723 frases, empleado, contra f3375c09)

- Cambian 10 frases, ninguna por la regla de costos:
  - 5 se tapan más: «Compras para el cliente…» ×2, «Compras de clientes: S/ 30», y c3.parrafosAtras ×2.
  - 4 solo cambian de forma: rachas largas → «[texto largo omitido]», espacios largos tras clave/PIN → uno.
  - 1 se ve: «No sé el costo.\nPrecio S/ 2.50 y <300 «a»> fin.». Antes se tapaba solo por la retención de la racha larga. Ahora da lo mismo que la frase corta equivalente «…Precio S/ 2.50 y a fin.», que ya se veía (precio con el costo negado).
