# Contrato del asistente (prototipo aislado, rama feature/asistente-aislado)

Estado: prototipo. Apagado por defecto. No se publica, no se une y no se despliega. Alcance: **solo gestión (modo admin)**: documentos, mercadería, stock, compras y precios. **No vende ni llena carritos.**
Copia del contrato de pruebas de Bot 5 adaptada a esta rama: `docs/asistente/contrato-asistente-v2.json`.

## Rutas del Worker
| Ruta | Método | Roles (tabla `API_ROUTES`) | Qué hace |
|---|---|---|---|
| `/auth/assistant/chat` | POST | dueño, empleado (el servidor revisa el nivel) | Conversa con el proveedor de IA (DeepSeek por defecto; ver «Proveedor de IA») y devuelve propuestas. Nunca escribe datos del negocio. `{ping:true}` devuelve SOLO `{ok, enabled, role, level}` (nivel de ESTE aparato; nada del dueño, de otros aparatos ni de la configuración) sin llamar al modelo ni gastar cupo. El rol (y el 403 `reason:"sin_rol"`) se revisa ANTES que la clave: un Worker sin clave igual responde el ping; el chat falla cerrado con 503 `assistant_not_configured`. Empleado que pide un documento solo del dueño, o cualquier documento estando en «consultas»: **403 `forbidden_document`** con `allowed` para todo el pedido (no viaja ninguna tarjeta). |
| `/auth/assistant/confirm` | POST | solo dueño (rol y nivel revisados OTRA VEZ en cada pedido; empleado con cualquier nivel → 403 `forbidden_role`) | Gasta el token de UNA tarjeta (un uso, 5 min). Devuelve el `operation_id`. No escribe datos del negocio. Lo único que guarda es la marca de uso de esa tarjeta en `pos_settings` (clave `internal:asst:u:<n>`, con hashes); **nunca** guarda ni cambia el nivel de un empleado (eso solo lo hace `/auth/assistant/employee-access`, dueño + aprobación). Revisado sobre f773911f y en la prueba `assistant-followups-f773911f.test.mjs`. |
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
| `ASSISTANT_OWNER_BOOTSTRAP` | `1` para las rutas `owner-device`. Necesita el visto bueno del jefe y la migración 0036 (no aplicada). |
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
| Chat / confirm | sí | sí | sí | **403** `assistant_off` (empleado; o aparato sin fila cuya sesión no es Admin: `sin_rol`). Aparato sin fila con sesión Admin = Admin (ver «Rol del asistente») |
| Qué ve | tarjeta en Inicio (reemplaza la burbuja ahí) + burbuja flotante en el resto | solo la burbuja flotante con sus atajos | igual | **nada**: el cargador no baja ni un archivo del asistente (0 JS, 0 CSS) |
| `consultar` | todo: stock, bajo stock, sin costo, ventas, más vendidos, deudas, compras, resúmenes del día y del mes, ganancia, productos sin ventas, deuda de un cliente (por código), ventas por hora | stock, por reponer, precios de venta (sin costos, márgenes, caja ni deudas) | igual | — |
| `preparar_documento` | 6 tipos | solo `lista_precios`, `lista_pedido` (sin costos, armadas en el servidor) | **no** | — |
| `explicar_pasos` | sí | sí | sí | — |
| Proponer ajuste de stock, precio, compra, producto nuevo | sí; «Confirmar» de un toque, **sin PIN** (el servidor exige sesión dueño real) | **no** (sin tarjetas de cambio; el pedido se descarta `forbidden_role` y se le dice que lo hace el dueño) | no | — |
| `Actualizar costo` (tarjeta aparte) | sí, un toque sin PIN | no | no | — |
| Cambiar nivel de empleados / aparatos dueño | sí, con PIN (aprobación estricta) | no | no | — |

Revocar es inmediato: confirm vuelve a leer el rol y el nivel en cada pedido; una tarjeta emitida antes de apagar responde **403**. Confirm no persiste ninguna configuración de nivel de empleado (solo la marca de uso de la tarjeta).

## Herramientas (el modelo solo PROPONE)
| Herramienta | Tarjeta | Qué pasa al pulsar (pantalla o ruta que ya existe) |
|---|---|---|
| `consultar {tipo, producto?, periodo?, fecha?, desde?, hasta?, cliente_id?}` | `consulta` (solo lectura) | El Worker lee con las lecturas canónicas (`canonicalRead`) y manda al modelo **solo un resumen** (top 10). Medido: primer pedido ~6,8 KB; resumen ≤ 3,2 KB aun con 3.000 productos. |
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
`{device_id, operation_id, level:"off"|"consultas"|"consultas_documentos"}` (también `enabled: true→consultas, false→off`) + `x-owner-approval` (`assistant.employee_access`). Solo con la cabecera de aprobación (ya no hay PIN suelto en el cuerpo). El destino se revisa ANTES de gastar la aprobación: si no es un aparato empleado → 409 `not_employee_device`. Respuesta `{ok, device_id, level, logged}`. Se anota en `pos_assistant_access_log` si existe (migración 0035, **no aplicada**).

### Aparato del dueño (`owner-device`, detrás de bandera)
- `register {pin}`: solo un aparato **sin fila**; empleado → 409 `employee_device_cannot_register` (o 403 `forbidden_role` del gate), sin gastar intentos. PIN con el límite por aparato existente (5 fallos → 429, «Demasiados intentos. Espera 15 min.»). Con 0 dueños → `owner` (INSERT atómico). Con dueño → **202** `{pending:true, status:"esperando_aprobacion"}`.
- `approve {device_id, operation_id, decision}`: `approve` crea la fila owner; `reject` borra el pedido. Ambos piden aprobación estricta `assistant.owner_device`; un PIN suelto no basta.
- `revoke {device_id, operation_id}`: deja el aparato como `empleado`. El último dueño nunca se quita: **409 `{error:"last_owner", code:"last_owner"}`** (revisado antes de gastar la aprobación y otra vez dentro del UPDATE). La pantalla avisa antes de quitar cualquier aparato dueño.
- Cada escritura va en UN `db.batch`: cambio de rol, gasto estricto de la aprobación y fila de bitácora juntos (si algo falla, nada queda a medias). Al aprobar, la aprobación se gasta y el pendiente se borra DESPUÉS del INSERT del dueño y solo si ocurrió; si el aparato ya tenía rol → 409 `device_has_role` sin gastar la aprobación.
- Bitácora `pos_owner_device_log` (migración 0036, **no aplicada**). Sin la tabla: **503 `owner_device_log_missing`**, no se registra nada.

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
- Cargador `asistente-loader.js` (encendido por defecto, después de que el POS abrió; el servidor decide con `ASSISTANT_ENABLED` y el rol/nivel del aparato. Se apaga por aparato con «Asistente en este aparato» en Configuración > Personal y seguridad > Aparatos conectados, solo Admin, o con `?asistente=0`; `localStorage na_asistente_off`). `asistente-core.js` (`NA_ASISTENTE_CORE`), `asistente-ui.js` (`NA_ASISTENTE`), `POS/css/asistente.css` (sin imágenes: burbuja 100 % CSS).
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
- `assistantAccess` (Rol del asistente, aprobado por el Admin el 2026-10-22):
  - fila `owner` + sesión Admin = `owner` (sin cambios);
  - fila `empleado` = `empleado:<nivel>` (sin cambios, aunque la sesión diga otra cosa);
  - SIN fila: se usa la MISMA regla del POS (`posRoleFor` de `pos-roles.js`: sin fila = Admin) y además la sesión autenticada debe ser Admin → `owner`. Si la sesión no es Admin → `sin_rol` (403 `assistant_off`; así aparece en la bitácora). Así el PC del Admin activado de forma normal tiene el asistente sin registrar nada y sin migraciones;
  - error de base: `empleado:off` (falla cerrado).
  - Las rutas solo Admin del asistente (`employee-access`, proveedor, revisión, boleta, confirm) usan este mismo criterio. `/auth/assistant/confirm` sigue siendo solo Admin y solo para tarjetas de ESE aparato (`other_device` si es de otro).
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
- **Solo un sí/no** (desde 6280deae: sí/no + origen `'col'`/`'intro'`, ver «Seguimiento sobre 6280deae»): de la parte cortada pasa solo «había contexto del dueño abierto». Cuenta como sí: una presentación sin negar, la ventana de una palabra del dueño, una lista o tabla presentada por el dueño, o una tabla con columna del dueño. Nunca pasa el estado de una tabla de venta, de una zona negada ni de columnas.
- **Superconjunto por construcción**: con el sí, el filtro corre exactamente igual que sin contexto (mismo estado, mismas decisiones). Además la continuación arranca con la tabla pegajosa abierta (como si viniera de una presentación del dueño): toda fila `| … |` se tapa hasta el final, salvo que se suelte con las reglas de la regla pegajosa (ver «Seguimiento sobre 25ffde10»). Solo puede tapar más.
- **Diferencial**: 455 casos × 17 contextos, los 16 de Bot 5 más «sí» forzado, tratando también los avisos forjados como marcados (el peor caso): 0 destapes, 822 más estrictos, el contexto nunca sale, partes = entero. 30 000 textos al azar más el corpus de 710 frases, sí contra no: 0 destapes. Hay una prueba en el repo.

### Tope de 1200 (Bot 5)

- El corte nunca parte una etiqueta («[dato del dueño]», «[oculto]», «[imagen omitida]»). Nunca deja «S/ », «US$», «$» o «PEN» sin número, ni un monto a medias en el corte duro sin espacios: retrocede hasta antes de la etiqueta o la moneda, como mucho `CUT_SLACK` = 24 caracteres más.
- Lo pintado espera `CUT_ZONE + CUT_SLACK` = 184 caracteres cerca del tope (antes 160) y corta en el mismo lugar que `capReply`.
- Sonda de tope de Bot 5 (1586 casos): 0 fallas.

### Tabla del dueño con una línea en medio (Bot 5)

- Reemplazada por la **regla pegajosa** (ver «Seguimiento sobre 25ffde10»): una línea en blanco o de texto después de `|---|` no cambia nada; las filas `| … |` que siguen se tapan hasta el final del mensaje.

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
- «para el cliente» NO es excepción: «Compras para el cliente: Galleta S/ 1.80, Arroz S/ 3.10» se tapa, también como presentación de lista. «Compras de clientes: S/ 30» (sin artículo) vuelve a verse desde el seguimiento de a6d1d76e: «de clientes» cuenta como «de los clientes», solo si el título cuenta únicamente por «compras» («Costo de clientes: S/ 30» y «Compras para clientes: S/ 30» se tapan).
- «el cliente compró/pagó» ya no cuenta como palabra de compra del dueño en la ventana («Compras que el cliente compró…»).

### Párrafo neutro (Bot 2, regla refinada)

- Un párrafo neutro corta la presentación del dueño y la ventana de 60 solo si NO termina en «:» y tiene 8 palabras o más, o si lo sigue un título de venta. «Te paso los costos:\n\nSon de esta semana.\n\n| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |» se tapa.
- De los 9 casos de Bot 2, vuelve a taparse **c3.parrafosAtras** («El costo lo vemos luego.\n\nVale.\n\n| … |» y su variante con «Aquí va otro párrafo sin montos.»). Los otros 8 se siguen viendo.
- El tapado de «sigue» ya no usa esta regla: sigue la regla pegajosa (ver «Seguimiento sobre 25ffde10»).

### Tabla del dueño con huecos (Bot 5, FALLA en f3375c09)

- Reemplazada por la **regla pegajosa** (ver «Seguimiento sobre 25ffde10»): ni las líneas en blanco, ni el texto, ni un título de venta cierran una tabla del dueño. Los casos de Bot 5 («zz\nyy», 2 líneas en blanco, línea en blanco en medio) se siguen tapando y siguen en las pruebas.

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

- Mientras una etiqueta RUC, DNI, clave, pin, token, api key o «data:» espera su valor, una racha de espacios o saltos de más de 160 se junta en UN espacio. Vale para dueño y empleado (desde 25ffde10 el dueño ve el número de DNI/RUC; la racha se junta igual), en el texto entero (al inicio de `redactText`) y en partes. Es la misma función, así que el resultado es idéntico.
- Cambia la forma visible con clave o pin: «clave<500 espacios>1234» ahora sale «clave [oculto]». El valor sigue tapado.
- La retención baja de 515–565 a 31 como mucho (medida sin contar lo descartado). Las 22 sondas de etiquetas pendientes pasan.

### «data:» con espacios (Bot 5)

- «data:» + espacios o saltos + «image/png;base64,…» → «[imagen omitida]», entero y en partes.

### Celular (Bots 4/5/3)

- **Aviso de corte**: la respuesta (JSON y evento final en partes) lleva `cut: true|false`, puesto por el servidor. El celular pinta la última línea como nota (`.na-asst-note`) SOLO si `d.cut === true`. Nunca busca el texto del aviso: un aviso escrito por el modelo sale como texto normal.
- **Cabecera reusada**: en la respuesta que sigue a una cortada, las filas sueltas del inicio (con el mismo número de columnas) usan la cabecera de la última tabla de la burbuja anterior. Esa cabecera sale solo de lo que esa burbuja ya pintó (texto ya filtrado por el servidor), nunca de otros datos. Después de una tabla propia de la burbuja, una fila suelta con el mismo número de columnas usa la cabecera de ESA tabla (ver seguimiento de a6d1d76e).
- **360 px**: las burbujas llevan `overflow-wrap:anywhere`, así que un token largo sin espacios no desborda a lo ancho.
- **Cabecera de tabla (Bot 4, 1)**: `th` con color #0f172a, y #e5f3ea en modo oscuro.
- **«Ver nuevo ↓» y la nota de corte (Bot 4, 3)**: si la nota está a la vista, aunque sea en parte, el botón no aparece al terminar la respuesta. Si estaba visible, se esconde en cuanto la nota entra a la vista al desplazar. Así nunca la tapa.
- Opcional no hecho: etiquetas más cortas en los atajos del dueño a 360 px. La tarjeta de Inicio tiene alto fijo en 380-699, y no se probó a 360 en un navegador.

### Cambios en el corpus (723 frases, empleado, contra f3375c09)

- Cambian 10 frases, ninguna por la regla de costos:
  - 5 se tapan más: «Compras para el cliente…» ×2, «Compras de clientes: S/ 30», y c3.parrafosAtras ×2.
  - 4 solo cambian de forma: rachas largas → «[texto largo omitido]», espacios largos tras clave/PIN → uno.
  - 1 se ve: «No sé el costo.\nPrecio S/ 2.50 y <300 «a»> fin.». Antes se tapaba solo por la retención de la racha larga. Ahora da lo mismo que la frase corta equivalente «…Precio S/ 2.50 y a fin.», que ya se veía (precio con el costo negado).

## Seguimiento sobre a6d1d76e (Bots 5/2/4)

### Tabla del dueño abierta y párrafo neutro (Bot 5, 3 fugas, también en f3375c09)

- Reemplazada por la **regla pegajosa** (ver «Seguimiento sobre 25ffde10»). Ya no existe la tabla «dormida» ni el cierre por título de venta o por otra cantidad de columnas. Las 3 fugas de Bot 5, la tabla con columna «Costo» sin presentación y «Compras de clientes: S/ 30» (se ve) siguen en las pruebas.
- Diferencial de «sigue» de Bot 5 en esta ronda (455 casos × 23): 0 destapes. Al azar 2 × 20 000: 0 destapes, partes = entero.

### Corte de 1200: tampoco parte fechas, horas ni documentos (Bot 2, Bot 5 INFO)

- Una racha de letras y dígitos unidos por «/», «:», «-», «.» (y «%») que trae un dígito es una sola pieza de hasta 40 caracteres (`CUT_JOIN_MAX`): «17/10/2026», «12:30», «3/4», «F001-00012345», «B002-123», «2026-10-17», «10%». El corte retrocede hasta antes de la pieza.
- Si la racha es más larga (un enlace, texto pegado), se corta como antes, pero su núcleo de dígitos unidos queda entero («aaaa3/4aaaa» no se corta en «3/»).
- Al soltar en partes, cerca del tope (los últimos 41 caracteres antes de donde puede caer el corte) se espera a que termine la racha. Así lo pintado es igual a la respuesta final. Lejos del tope no cambia nada.
- Siguen igual las garantías de antes: ningún monto partido, ninguna etiqueta partida, nunca «S/ » suelto. Sonda de Bot 5 (`corte-numeros`, 7524 casos): 0 malos (antes 12: «3/», «12:», «10» de «10%»). Sonda del tope: igual que la base.

### Celular (Bot 4)

- Las filas que siguen a una tabla de la burbuja después de un párrafo (el servidor las sigue tratando como de esa tabla) se dibujan como filas, con la cabecera ya pintada de esa tabla (texto ya filtrado), solo con `createElement` y `textContent`. Nunca salen como texto con «|». Vale también para la última fila sin salto de línea. Desde 25ffde10 también las de otra cantidad de columnas salen como filas (ver abajo).

### Pruebas

- `tests/asistente/assistant-followups-a6d1d76e.test.mjs`: las 3 fugas (entero y en partes de 1, 2, 3, 7, 13 y 47), tablas de venta visibles, variante «sigue» (entero, partes y ruta con `capReply` + `cutPrime`), «Compras de clientes», corte con fechas/horas/documentos (casos fijos y propiedad al azar con ambos roles, partes = final) y el renderer del celular.

## Seguimiento sobre 25ffde10 (Bots 5, 4, 3 y 2)

### Regla pegajosa de tablas (empleado, Bot 5)

Reemplaza «Tabla del dueño con una línea en medio», «Tabla del dueño con huecos» y «Tabla del dueño abierta y párrafo neutro».

- En una respuesta al EMPLEADO, cuando se abre una tabla del dueño (cabecera con una columna del dueño, como «Costo», o cualquier tabla bajo una presentación del dueño, como «Te paso los costos:»), desde ahí se tapan los montos de TODA línea que traiga «|», hasta el final del mensaje. No importan las líneas en blanco, los párrafos largos, los títulos ni la cantidad de columnas.
- Se suelta SOLO con una cabecera nueva + `|---|`:
  - si la tabla pegajosa vino de una COLUMNA del dueño: cualquier cabecera nueva sin columna del dueño la suelta;
  - si vino de una PRESENTACIÓN del dueño: una cabecera neutra NO la suelta. La suelta una cabecera con columnas de venta explícitas (PVP, P. venta, Venta) o un título de venta (línea que empieza con «Precio(s)», «PVP» o «Lista de precios») seguido de una cabecera nueva + `|---|` sin columna del dueño.
  - Una cabecera con dígitos (por ejemplo un monto disfrazado de cabecera) no suelta nada y tapa todos los montos de sus filas.
- Columna de venta: el monto de una celda PVP / P. venta / Venta se ve solo si la fila tiene la misma cantidad de columnas que la cabecera y la celda cae en esa columna (se cuentan las columnas sin las celdas vacías de los bordes). Si no, se tapa la fila entera. «| PVP | S/ 2.50 |» (clave-valor de 2 columnas) se ve.
- La fila se tapa en cuanto aparece su «|», sin esperar más texto (sin retenciones nuevas). Las partes dan lo mismo que el texto entero; los topes de retención (20 / 160+24 / ~177) y el corte que no parte números no cambian. El dueño ve todo igual que antes.
- «sigue»: `cutPrime` dice si la parte cortada terminó con contexto del dueño (también con la tabla pegajosa abierta). La continuación arranca pegajosa: solo puede tapar más.
- Ya no existen la tabla «dormida», el cierre por título de venta solo, ni el cierre por otra cantidad de columnas.

### Celular (Bot 4)

- Las filas tapadas, también las de otra cantidad de columnas, se dibujan como filas de la tabla (fichas a 480 px o menos): las cortas se completan, las largas juntan las celdas de más con « · ».
- Si todos los montos de una tabla están tapados, va UNA nota corta debajo («Montos ocultos para empleado») y los tapados se ven compactos («•••»). Solo `createElement` y `textContent`.
- Dos o más filas seguidas sin cabecera y con la misma cantidad de columnas se dibujan como una tabla sin etiquetas (sin `thead`). Una sola fila suelta queda como texto.
- La tabla se crea con su primera fila: una cabecera seguida de un párrafo no deja una tabla vacía.
- «S/», «US$» y «PEN» se unen a su monto con un espacio que no se parte, solo en pantalla.
- La burbuja con tabla lleva la clase `na-asst-wide` (puesta desde JS) en lugar de la regla `:has`.
- Inicio a 360 px: atajos con texto corto en una fila («Factura» para leer factura) y `#naAsstHero` de 321 a 272 px. Nada fuera de la tarjeta del asistente cambia.

### Velocidad y corte (Bot 3)

- Etapa de espacios: un filtro previo (el carácter justo antes de la racha) decide si vale la pena probar `WS_KW_TAIL`. Mismo resultado (3000 casos al azar contra 25ffde10: 0 diferencias). La etapa sigue corriendo para el dueño (PIN, clave, token siguen tapados tras espacios largos).
- «[texto largo omitido]» (solo empleado) sale en cuanto la racha pasa de 160 caracteres, no al terminar la racha.
- El corte de 1200 nunca parte una salida de la redacción («DNI ****2345», «RUC *******5237»): se trata como una etiqueta. Tampoco separa un número de su unidad corta (unid., und., kg, g, L, ml, cajas, paq.). Al soltar en partes, si el número cae justo en el tope, se espera su posible unidad antes de cortar (lo pintado = la respuesta final).

### Comprobantes y DNI/RUC (Bots 4, 5 y 2)

- Excepción a la regla del DNI, solo para la serie de un comprobante o guía: `\b(?:[FBET][A-Z0-9]{3}|0\d{3})-\d{1,8}\b` («F001-00012345», «B001-00000123», «E001-12345678», «T001-00012345», «0001-00012345») queda intacta. «2024-12345678», «DNI-12345678», «DNI 12345678» siguen tapados para el empleado. Desde el seguimiento sobre 6280deae, delante del número va `(?<![0-9])` en vez de `\b` (DNI y RUC): «Doc:x12345678», «Doc:A12345678», «ref_12345678» también se tapan para el empleado y en lo que va al modelo.
- **Dueño**: la respuesta al dueño ya NO tapa DNI ni RUC (números de 8 y 11 dígitos, «RUC 20100055237», «Código interno 12345678»). Sigue tapado para el dueño: PIN, clave, contraseña, token, api key, «data:» (base64), correo y teléfono. El empleado sigue con todo el filtro de DNI/RUC.
- Lo que va AL modelo (mensaje, historial y resultados de herramientas) sigue pasando por `redactText` completo, también para el dueño. Así el modelo no recibe DNI/RUC; el cambio es solo de la salida al dueño.

### Línea siguiente con costo (Bot 2, regresión desde f3375c09)

- El monto al final de una línea se tapa si la línea SIGUIENTE empieza (tras «(», «-», espacios, «mi», «es el», «de») con costo, margen, ganancia o utilidad: «Galleta S/ 1.80\ncosto unitario», «es el costo», «de costo», «(mi costo)», «margen», «(costo por unidad)», «ganancia S/ 0.70».
- También si la línea siguiente es corta (termina en 40 caracteres o menos y con 5 palabras o menos) y trae una de esas palabras («el costo», «Ese es el margen»). Se decide con lo que llegó: pasados 40 caracteres o al empezar la 6.ª palabra ya no es corta.
- «El costo lo ve el dueño.» (6 palabras, no empieza con la palabra) no tapa. En un ítem de lista o una fila con tabulador o «|», la palabra del dueño sigue tapando solo su ítem (Bot 2 b).
- La retención de una línea normal con monto no cambia (medido igual que 25ffde10: 38, 31, 31 y 18 caracteres de la línea siguiente).

### Pruebas

- `tests/asistente/assistant-followups-25ffde10.test.mjs`: cada caso de la regla pegajosa (entero y en partes de 1, 2, 3, 7, 13 y 47, y la variante «sigue»), las dos reglas para soltar, columna de venta, casos de a6d1d76e y «Compras de clientes: S/ 30» (se ve), tapado inmediato al llegar «|», celular (filas, nota, tabla sin cabecera, tabla perezosa, espacio que no se parte, clase `na-asst-wide`), etapa de espacios, «[texto largo omitido]» temprano, corte con DNI/RUC y unidades, comprobantes y DNI/RUC del dueño, y la línea siguiente con costo (los 7 casos de Bot 2, el contraejemplo, ítems de lista y la retención).

## Seguimiento sobre 6280deae (Bot 5 FALLA; límites de Bots 3 y 5)

### 1. Línea siguiente tras un ítem de lista o una fila

- Ítem (`-`, `*`, `•`, `1.`, `1)`, `a)`) o fila (`|` o tabulador) sin presentación del dueño: la línea siguiente tapa el monto de ESE ítem/fila (solo ese, no la lista) si, quitando su viñeta, numeración, `|`, tabuladores, sangría y «(», «mi», «es el», «de» delante, EMPIEZA con costo, margen, ganancia o utilidad. «- Galleta S/ 1.80\ncosto unitario», «1. Galleta S/ 1.80\n(mi costo)», «• Galleta S/ 1.80\nganancia S/ 0.70», «| Galleta | S/ 1.80 |\ncosto unitario», «Galleta\tS/ 1.80\nutilidad», «- Galleta S/ 1.80\n- costo unitario», «| Galleta | S/ 1.80 |\n| costo unitario | |» se tapan.
- Límites (Bots 3/5): se decide con a lo sumo ~20 caracteres de esa línea (o su salto). En ítems y filas NO se usa la prueba de línea corta (40 caracteres / 5 palabras). Las líneas de texto siguen con la regla de siempre. (Desde el seguimiento sobre 84a49517, «el costo» y «Ese es el margen» tras un ítem o fila SÍ tapan: ver abajo.)
- Línea siguiente con SU monto (D', límite de Bot 3; vale para texto, ítems y filas): se mira la misma ventana (~20 caracteres tras quitar viñeta/`|`/tab/sangría, o hasta el salto). Si empieza con la palabra del dueño y NO aparece un monto en esa ventana, tapa el monto de arriba. Si aparece un monto en la ventana, se tapa SOLO ese monto y el de arriba se suelta: «Arroz S/ 4.20\nEl costo es S/ 1.80.», «- Galleta S/ 1.80\n- costo S/ 1.20», «Galleta S/ 1.80\nganancia S/ 0.70», «| Galleta | S/ 1.80 |\n| costo unitario | S/ 1.20 |» dejan ver el de arriba. «Galleta S/ 1.80\ncosto unitario de la casa: S/ 1.20» (monto pasado los 20) tapa los dos. Prueba de propiedad: ningún monto con la etiqueta del dueño delante se ve nunca.
- Tabla de VENTA (cabecera + `|---|` con PVP / P. venta / Venta / Precio de venta / Precio y sin columna del dueño): sus filas no miran la línea siguiente. Una fila cuya PRIMERA celda empieza con costo, margen, ganancia o utilidad tapa sus montos y abre la regla fija (origen «col», todo monto tapado) hasta una cabecera nueva sin columna del dueño. «| Producto | Precio |\n|---|---|\n| Galleta | S/ 1.80 |\n| costo unitario | S/ 1.20 |\n| Arroz | S/ 4.20 |» deja ver 1.80 y tapa 1.20 y 4.20.
- Retención por fila (empleado, trozos de 1, 120 filas/ítems; caracteres que llegan tras el monto hasta que sale), igual antes y después: tabla de venta y tabla neutra 27 (nombres con números) / 21 (nombres con letras); lista «- » 33 / 55; lista «1. » 25 / 24.

### 2. Punto al final de la línea del monto

- «Galleta S/ 1.80.\ncosto unitario» y «La galleta sale S/ 1.80.\nel costo.»: el «.» final (con espacios detrás) ya no corta; se mira la línea siguiente igual que sin punto. Una línea de texto con punto final espera ahora lo mismo que una sin punto (medido: 22 → 31 con números, 26 → 58 con letras; sin punto: 29 / 56). Topes de siempre (160) y decisión corta (40 / 5) sin cambios.

### 3. «sigue» con origen

- `cutPrime(reply, cut)` devuelve `false`, `'col'` o `'intro'`. `'col'` solo si lo único abierto al final de la parte cortada es la regla fija de una tabla con columna del dueño (o la abierta por una fila «costo…» en una tabla de venta); cualquier otra cosa abierta (presentación, ventana de una palabra del dueño, lista) da `'intro'`.
- El origen sale SOLO del texto firmado (el `raw` del par, dentro del HMAC, con `cut:true` firmado): el aparato no lo manda. Un campo agregado (`cut_src`, `src`…) se ignora; cambiar `cut` rompe la firma (par descartado, como antes). En el filtro, todo valor que no sea exactamente `'col'` (true, 'COL', objetos…) cuenta como `'intro'`.
- Con `'col'`, una cabecera nueva sin columna del dueño («| Producto | Monto |» + `|---|`) suelta la regla fija, como en la parte cortada. Nada más cambia: las columnas de venta de una cabecera nueva CON columna del dueño se leen como con `'intro'` («Precio» junto a «Costo» sigue tapado). La continuación nunca destapa respecto de sin contexto.

### 4. DNI / RUC

- `(?<![0-9])` en vez de `\b` delante del DNI (8 dígitos) y del RUC (11): «Doc:x12345678», «Doc:A12345678», «ref_12345678», «cod_20123456789» se tapan para el empleado y en lo que va al modelo. La etapa en partes usa el mismo límite para «RUC»/«DNI» esperando su número («costoRUC N° 20123456789»). La excepción de comprobantes `\b(?:[FBET][A-Z0-9]{3}|0\d{3})-\d{1,8}\b` no cambia. El dueño sigue viendo DNI/RUC exactos.

### 5. INFO hechos

- «data image/png;base64,…» sin «:» (también con «=», «es», «era», «de» y espacios/saltos) → «[imagen omitida]», dueño y empleado, entero y en partes.
- «La clave del wifi Zq9xK2mPw7» → «La clave del wifi [oculto]»: tras clave/contraseña/pin/token/password/api key + una palabra de enlace (del, de, la, el, los, mi, tu, su, para, en, que…), se tapa el valor (letras y dígitos mezclados, 6+ caracteres) dentro de las 4 palabras siguientes. Sin ese valor, como siempre (se tapa lo que sigue a la etiqueta). En partes se espera hasta esas 4 palabras.

### Pruebas

- `tests/asistente/assistant-followups-6280deae.test.mjs`: los mínimos de Bot 5 y sus variantes (ítems, filas, tab, viñetas, letra, sin bordes, punto final), límites de ítems, D' (línea siguiente con su monto, más prueba de propiedad), tabla de venta con fila «costo…», retención de 120 filas/ítems, origen de «sigue» (unitario, alterado → intro, ruta firmada con campo agregado), DNI/RUC con letra o «_», «data» sin «:» y «clave del wifi». Todo entero y en partes de 1, 2, 3, 7, 13 y 47.

## Seguimiento sobre 6280deae: Bot 2 (lo que va al modelo, tarjeta de compra, historial)

### A / A' / A''. Lo que va AL MODELO para el DUEÑO

- El filtro de entrada lo decide el rol de la sesión del servidor (`resolveRole`), nunca un campo del aparato ni del modelo. Para el dueño (`redactModelOwner`, mensaje, historial y nombres del contexto):
  - RUC de empresa (empieza con 20, 15 o 17) va exacto. RUC 10 (persona natural) sigue tapado para los dos roles.
  - 8 dígitos junto a «código», «cód.», «EAN», «barra(s)» (misma línea, pocas palabras), en una columna de tabla con esa cabecera o tras una serie de comprobante van exactos. 8 dígitos sueltos o junto a «DNI» siguen tapados.
  - PIN, clave, token, correo, teléfono, tarjeta y data: igual que siempre.
- Empleado, o cualquier rol que no sea exactamente `owner`: sin cambios (`redactText`, todo tapado).
- El celular del dueño hace lo mismo al armar el contexto (`redactOwnerContext`); el servidor vuelve a filtrar igual.

### B / B'. Tarjeta de compra

- Proveedor y documento pasan por el filtro del dueño. Si al campo le queda una máscara («***», «[… oculto]», «[dato …]»), se deja VACÍO (nunca se guarda la máscara) y su nombre va en `completar: ['proveedor'|'documento']`.
- La excepción sale del rol de la sesión del servidor. Si el empleado fuerza `preparar_compra` (aunque mande owner/rol en los argumentos), la tarjeta se descarta (`forbidden_role`), sin campos en la respuesta. Una compra firmada presentada desde una sesión de empleado no se confirma (≥400).

### B''. Celular: dato que falta

- Cada nombre de `completar` sale como un campo con borde de alerta (#b91c1c claro / #f87171 nocturno) y el texto «Complete este dato» (#991b1b sobre #fff, #fecaca sobre #10241a; contraste ≥ 4,5), con `aria-invalid` y `aria-describedby`.
- El foco va al primero. «Confirmar» queda apagado con «Complete N dato(s)» hasta llenarlos; una máscara escrita no cuenta.
- Se arma solo con createElement/textContent. Lo escrito queda fuera de la propuesta firmada (propiedad no enumerable, el hash de la tarjeta no cambia) y lo usa «Nueva compra»; nunca se escribe una máscara.

### C. Historial firmado

- El par firmado del dueño guarda el RUC de empresa exacto. El HMAC no cambia: la clase de rol va dentro de la firma, así que un par del dueño presentado por un empleado se descarta.

### INFO. Corte del dueño

- La parte del dueño (tope 1200) nunca termina en «RUC», «RUC N°», «RUC:» o «DNI» con el número en la parte siguiente: el corte retrocede antes de la etiqueta (entero = partes).

### Pruebas

- `assistant-followups-6280deae.test.mjs`: A (función, parseChatBody, sanitizeContext, ruta con el pedido al modelo capturado, dueño contra empleado), B (campos vacíos y `completar`), B' (empleado forzando la tarjeta y confirmando), B'' (DOM falso: foco, aviso, Confirmar, máscara escrita, contraste, cableado), C (par del dueño reusado por un empleado), D' y el corte.

## Seguimiento sobre 84a49517 (Bot 5 FALLA: «el costo» tras un ítem o una fila)

- En la mirada a la línea siguiente de un ítem de lista (`-`, `*`, `•`, `1.`, `1)`, `a)`) o de una fila (`|` o tabulador), además de la viñeta, numeración, `|`, tabuladores, sangría, «(», «mi» y «de», se quitan del comienzo «el», «es el», «ese es el» y «este es el» (sin importar mayúsculas) antes de ver si EMPIEZA con costo, margen, ganancia o utilidad. «- Galleta S/ 1.80\nel costo», «1. Galleta S/ 1.80\nEse es el margen», «| Galleta | S/ 1.80 |\nel costo», «Galleta\tS/ 1.80\neste es el costo», «- Galleta S/ 1.80\n- (el costo)» tapan el 1.80 (solo ese ítem/fila). El dueño ve todo.
- Sin cambios: la ventana de ~20 caracteres (tras quitar lo de delante), la regla D' (si en la ventana aparece el monto propio de esa línea, se tapa solo ese: «- Galleta S/ 1.80\nel costo S/ 1.20» deja ver 1.80), la tabla de venta (sus filas no miran la línea siguiente) y la regla de las líneas de texto sin viñeta: «Galleta S/ 2.50\nEl costo lo ve el dueño.» se sigue viendo.
- Tapa de más aceptado (a prueba de fallas): tras un ítem, «- El costo lo ve el dueño.» ahora tapa el monto del ítem de arriba («- Galleta S/ 2.50\n- El costo lo ve el dueño.»). Con «el/ese/este» seguido de otra palabra («- El precio es bueno», «- Ese es el más vendido», «- Esencia S/ 3.00») el ítem se ve.
- Una línea siguiente a medio llegar que todavía puede ser uno de esos comienzos («E», «Es», «Ese es e», «el») espera dentro de la misma ventana; en cuanto deja de serlo, sale.
- Retención por fila (empleado, trozos de 1, 120 filas/ítems, `b5fix/hold.mjs`), igual antes y después: tabla de venta/neutra/sin cabecera 27 (números) / 21 (letras); lista «- » 33 / 55; lista «1. » 25 / 24; texto 29 / 56 (con punto 31 / 58). Con nombres que empiezan por «Esencia», «Elefante», «El Chino», «Este mes», «Es de casa»: lista 61 y tabla neutra 21, iguales en 84a49517.

### Pruebas

- `tests/asistente/assistant-followups-84a49517.test.mjs`: 9 formas de ítem/fila × 19 comienzos («el costo», «Ese es el margen», «este es el costo», «(el costo)», «- el costo», «| el costo | |», «2. Ese es el margen»…) × 4 finales, tapados para el empleado e intactos para el dueño; hermanos de lista y tabla; el contraejemplo de texto «El costo lo ve el dueño.» visible; comienzos sin palabra del dueño visibles; D'; retención de 120 filas/ítems. Todo entero y en partes de 1, 2, 3, 7, 13 y 47.
- `assistant-followups-6280deae.test.mjs`: el límite «el costo / Ese es el margen tras un ítem se ve (INFO)» pasa a tapar, y «- Galleta S/ 2.50\n- El costo lo ve el dueño.» pasa a tapar el 2.50.

## Ampliación sobre 84a49517 (Bot 5: cantidades, ganancia/margen/utilidad, comienzos, «(mi costo)», claves; Bot 2 A/B; Bot 4)

### Línea siguiente (empleado)

- **Monto propio = solo con moneda (Bot 5, 1).** La regla D' suelta el monto de arriba solo si en la ventana (~20 caracteres) de la línea siguiente aparece un monto CON moneda (`S/`, `S/.`, `PEN`, `US$`, `$`). Un decimal suelto o un `%` no cuenta: «Arroz S/ 45.00\ncosto por 12.5 kg», «costo al 15%», «margen 30%», «costo 1,5 kg», «costo por caja de 12.5», «costo del pack 2.5», «(costo, 1.5 kg)» tapan el 45.00, en texto, listas, filas y tab.
- **Ganancia, margen y utilidad nunca sueltan (Bot 5, 2).** Aunque traigan su propio monto, tapan el de arriba y el suyo: «• Galleta S/ 1.80\nganancia S/ 0.70», «Galleta S/ 1.80\nmargen S/ 0.70», «Galleta S/ 1.80.\nmargen 30%» tapan los dos. D' vale solo si la línea siguiente (tras quitar lo de delante) empieza con «costo»: «Arroz S/ 4.20\nEl costo es S/ 1.80.» y «- Galleta S/ 1.80\n- costo S/ 1.20» dejan ver el de arriba. «precio de compra» en la línea siguiente sigue tapando el de arriba (la mirada de frases de compra; más estricto).
- **Comienzos (Bot 5, 3).** Tras un ítem, fila o tab se quitan del comienzo, repetidas: «mi», «de», «el», «la», «es», «ese», «esa», «este», «esta» (cubre «ese es el», «esta es la», «es el»). «- Galleta S/ 1.80\nla ganancia», «… \nEsa es la utilidad», «… \nes costo» tapan; «- La leche S/ 3.00», «- Esa marca», «- Es nuevo», «- Lavavajilla», «- Estofado» se ven.
- **Tapa de más aceptado:** «- Galleta S/ 2.50\n- Utilidades varias S/ 4.00» tapa los dos (utilidad nunca suelta; ante la duda se tapa), y «| Producto | Monto |\n|---|---|\n| Galleta | S/ 2.50 |\nEl margen lo ve el dueño.» (casos-1c17 titulo-leyenda) tapa el 2.50 tras una fila.
- **Tabla de venta (Bot 5, 4).** La 1.ª celda de una fila pasa por la misma limpieza de comienzo antes de mirar costo/margen/ganancia/utilidad: «| (mi costo) | S/ 1.20 |», «| mi costo |», «| el costo |», «| la ganancia |», «| Este es el margen |» tapan esa fila y abren la regla fija (las filas siguientes también, «| Arroz | S/ 1.21 |» tapado). «| (mi favorito) | S/ 1.20 |» se ve.
- Retención por fila (`b5fix/hold.mjs` y la prueba de 120 filas): igual que 84a49517 (27/21, 33/55, 25/24, 29/56, 31/58; lista con nombres «Es…/El…» 61, tabla neutra 21).

### Claves (los dos roles, Bot 5, 5)

- Tras pin/clave/contraseña/password/token/api key + una palabra de enlace (del, de, la, el, mi, para, en, que…) y hasta 3 palabras más (4 en total), se acepta `:` o `=` antes del valor, y el valor puede ser mezclado (6+ letras y dígitos) **o 4-8 dígitos** (para todas esas etiquetas; un número de 4-8 dígitos tras una etiqueta de clave es secreto): «La clave del wifi: Zq9xK2mPw7» → «La clave del wifi: [oculto]», «El pin para la caja 4321» → «El pin para la caja [oculto]», «La contraseña de mi correo es Zq9xK2mPw7» → «… es [oculto]», «la clave del pin es 1234» → «la clave del pin es [oculto]». La etapa en partes espera igual (hasta 4 palabras y el `:`/`=`). Con la clave en la 5.ª palabra o sin dígitos sigue como INFO.

### Tarjeta de compra (Bot 2 A)

- Un campo (proveedor, documento) con máscara ya no queda vacío: conserva la parte EXACTA antes de la primera máscara, sin una etiqueta suelta al final («RUC», «RUC N°:», «DNI», «pin:», «clave»): «F001-12345678 pedido DNI ****4321» → «F001-12345678 pedido», «Bodega Juan RUC *******9012» → «Bodega Juan», «DNI ****5678» → «». Sigue en `completar`; la máscara nunca se guarda.
- Celular: el campo «Complete este dato» empieza con esa parte exacta; cuenta como dato solo cuando se le agrega algo (la parte exacta sola, una máscara o espacios no cuentan).

### Confirm exige los datos (Bot 2 B, Bots 4 y 5)

- **Qué hace /confirm (revisado en el código):** no crea ningún registro. Comprueba el token y la propuesta firmada, marca la tarjeta usada (escritura condicional en el almacén de uso: un reenvío recibe `already_confirmed` con el mismo `operation_id`), cuenta el límite por minuto, escribe la bitácora y devuelve la propuesta aplicada. El celular abre «Nueva compra» ya llenada; la compra real se guarda en el formulario del núcleo (congelado, no se toca aquí). **El riesgo de duplicado está en ese guardado del núcleo**, no en /confirm. Por eso no hay clave de idempotencia nueva ni flujo de «revisando»: reintentar /confirm es seguro.
- El aparato manda lo escrito en `body.manual` (`{ proveedor?, documento? }`), FUERA de la propuesta firmada. La propuesta nunca cambia por /confirm (meter lo escrito dentro da 409 `proposal_changed`).
- El servidor acepta `manual` solo si: la sesión es del dueño (rol del servidor; cualquier otra sesión recibe 403 antes de leer el cuerpo); es un objeto plano; sus claves son un subconjunto del `completar` firmado; y cada valor es texto no vacío y sin máscara (tope 120/80, sin caracteres de control).
  - Otra clave (precio, cantidad, producto, product_id, lineas, fecha, completar…), `manual` que no es objeto, o cualquier clave cuando no hay `completar` → **400 `manual_not_allowed`** con `fields`.
  - Falta un campo de `completar`, valor vacío, con máscara o que no es texto, o una máscara en cualquier campo de texto de la propuesta (cualquier tipo de tarjeta, hasta 4 niveles) → **422 `fields_required`** con `fields`.
  - En los dos casos no se aplica nada, la tarjeta NO se marca usada y queda en la bitácora (`rejected:…`). Lo escrito va exacto (no pasa por el filtro: no va al modelo, solo a «Nueva compra»).
- Con todo completo: 200 y la propuesta aplicada lleva los valores escritos (también en el reenvío `already_confirmed`).
- Celular:
  - Mientras el pedido está en curso, «Confirmar» queda apagado con «Guardando…» (un doble toque no envía otro).
  - 4xx `fields_required`: la tarjeta sigue pendiente y editable; cada campo nombrado muestra «Complete este dato» (aria-invalid, foco en el primero) y conserva lo escrito; aviso general en la línea de estado con textContent («Complete los datos marcados y vuelva a confirmar.», o «Esta propuesta trae un dato tapado…» si el campo no es de la tarjeta, con «Pedir de nuevo»). `manual_not_allowed`: «Esa tarjeta no se puede cambiar así. Toque «Pedir de nuevo».».
  - Sin respuesta (corte o tiempo): «No se pudo confirmar: no llegó respuesta. Revise los datos y toque «Reintentar».»; la tarjeta sigue editable y reintentar es seguro.
  - Nunca texto técnico ni pantalla en blanco. Solo createElement/textContent.
  - Lo escrito (`_manual`, fuera de la propuesta firmada) pasa a la propuesta que devuelve /confirm, así «Nueva compra» abre con Proveedor y Documento (Bot 4 C3).

### Pantalla (Bot 4)

- Nocturno: `body.dark input.na-asst-need:not(...)×4` (y `.ok`) gana a `theme-dark.css` (`body.dark input:not(...)×4`): borde #f87171 (alerta) / #4ade80 (listo), contraste ≥ 3 sobre #10241a y #07130c (antes salía gris, 1.57).
- Los 0/1 de la mascota (`.na-asst-bits`) llevan `aria-hidden="true"`.
- ~~Serie con U+2011~~ (reemplazado sobre 58200f60, ver abajo: la serie va en una span nowrap con el guion ASCII).

### Pruebas

- `assistant-followups-84a49517.test.mjs` (ampliación): 12 cantidades × 6 formas × 3 finales; ganancia/margen/utilidad × 13 formas; 10 comienzos nuevos × 9 formas y 6 visibles; tabla de venta con 7 primeras celdas; claves en los dos roles; tapa de más aceptado. Todo entero y en partes de 1, 2, 3, 7, 13 y 47.
- `assistant-card-completar.test.mjs`: parte exacta en la tarjeta; servidor: 422 sin `manual` / vacío / con máscara / no texto / incompleto; 400 con claves fuera de `completar` (precio, cantidad, producto, product_id, lineas, completar, fecha), `manual` no objeto, o sin `completar`; 403 sesión de empleado; 409 si lo escrito va dentro de la propuesta; 200 con `manual` y valores en la propuesta aplicada; respuesta perdida + reintento → `already_confirmed`; máscara en proveedor/documento/título/filas y en otra tarjeta; celular (parte exacta de inicio, `manual` fuera de la propuesta, puerta pendiente con `fields`, aviso junto al campo, foco, lo escrito queda, «Guardando…», corte a medias + reintento con lo escrito en «Nueva compra», sin texto técnico); Nocturno (especificidad y contraste), `aria-hidden` de la mascota y serie en span nowrap con «-» ASCII (sin U+2011) en trozos de 1/2/3/7/47.
- `assistant-followups-6280deae.test.mjs`: D' con ganancia/margen ahora tapa los dos; «1. Arroz S/ 4.20\n2. Margen 30%» tapa el 4.20; «la clave del pin es 1234» tapa solo el valor; tarjeta B con la parte exacta.

## Ampliación sobre 58200f60 (Bot 2 serie copiable; Bots 3/5 reenvío del confirm; Bot 5 ev-58200f60; Bot 4 tarjeta)

### Serie de comprobante en pantalla (Bot 2, Bots 4/5)

- El guion de la serie sigue siendo el ASCII «-» en el texto del DOM: copiar y pegar da el texto original (ya no hay U+2011 en ningún lado).
- Cada serie (`\b(?:[FBET][A-Z0-9]{3}|0\d{3})-\d{1,8}\b`, la misma regla de siempre) va entera en `<span class="na-asst-code">`, armada SOLO con `createElement` + `textContent` (`codeSpan` / `appendCoded`; nunca `innerHTML` ni plantillas: el texto viene del modelo). Etiquetas dentro o alrededor salen como texto; no se crea ningún otro elemento.
- En partes: una serie que llega cortada entre trozos queda como texto hasta saber dónde termina (carácter siguiente o final de la respuesta) y recién ahí pasa a su span. Nunca dos spans para una serie, nunca otro guion. 9 dígitos (`F001-123456789`), `xB001-12`, `B001-12a` y fechas (`2024-12345`) no llevan span.
- También en celdas de tabla, en las tarjetas de tabla (≤ 480 px) y en la nota proveedor · documento · fecha de la tarjeta de compra (`data-docnote`, se llena con `appendCoded`).
- CSS: `.na-asst-code{white-space:nowrap;overflow-wrap:normal;word-break:keep-all;display:inline-block;max-width:100%;overflow-x:auto}`: el `overflow-wrap:anywhere` de la burbuja no corta dentro; una serie más ancha que la burbuja se desplaza dentro de su caja, nunca desborda. En tarjeta de tabla la celda con serie (`.na-asst-tvc`) baja bajo su etiqueta si no cabe al lado (`td{flex-wrap:wrap}`).
- Chrome real (proxy muerto, 0 salidas): 360/375/412, claro y Nocturno, texto/tabla, partes de 1/3/47: cada serie en 1 renglón, dentro de la burbuja, sin desplazar; la burbuja sin desborde; la serie gigante (60 px) desplaza dentro de su caja.

### Reenvío del confirm tras una respuesta perdida (Bots 3/5)

- Al marcar la tarjeta usada se guardan, en el MISMO registro del almacén de uso (`pos_settings`, clave `internal:asst:u:<n>`, sin migración): `s` = hash de la sesión dueño que confirmó (sesión del POS; si no hay, credencial; si no, aparato) y `rh` = hash de propuesta firmada + operation_id + lo escrito (normalizado) + filas aceptadas/quitadas. Ni la sesión ni lo escrito quedan en claro.
- Reenvío de ESA sesión con los mismos datos → 200 `{ ok, already_confirmed:true, replay:true, operation_id, proposal }` con la MISMA propuesta aplicada: el dueño abre «Nueva compra» llena igual (respuesta cortada a medias + reintento probado de punta a punta).
- MISMA sesión dueño en el mismo aparato con otro «manual» u otras filas (corrigió algo tras un corte) → 409 `{ error:'already_confirmed_same_session', already_confirmed:true, operation_id, type, role, proposal }` con la propuesta FIRMADA (filas aceptadas/quitadas del registro) y SIN lo escrito (solo se guarda su hash; lo escrito lo conserva el celular).
- Otra sesión dueño (mismo aparato), sin «manual» cuando hacía falta o un registro viejo sin hashes / con el sha256 viejo → 409 `{ error:'already_confirmed', already_confirmed:true, operation_id }`, sin propuesta ni lo escrito. Otro aparato → 403 `{ error:'other_device' }` (`confirmed:true` solo si la tarjeta ya se usó), sin propuesta ni operation_id. Empleado → 403 en todos los casos.
- Dos envíos a la vez: el que pierde la escritura condicional sigue la misma regla (misma sesión → reenvío; otra → 409).
- Celular: 409 `already_confirmed_same_session` (propuesta con el mismo id y tipo) → abre «Nueva compra» con la propuesta firmada + lo que ESTE celular mandó (`sentBody.manual`) y la nota «Esta compra ya se confirmó. Corrija los datos en Nueva compra.»; 409 `already_confirmed` → nota corta «Esta compra ya se confirmó en otra sesión.» («Este cambio ya se confirmó en otra sesión.» en otras tarjetas), sin abrir «Nueva compra» ni texto técnico; «Ya se confirmó en otro aparato.» SOLO con 403 `other_device` + `confirmed:true` (sin `confirmed`: «Esta propuesta es de otro aparato. Pídela aquí otra vez.»).

### Filtro del empleado (Bot 5, FALLAS 1 y 2)

- Línea de TEXTO siguiente: además de los comienzos de antes, se quita «ese/esa/este/esta/es» (+ «es») (+ «el/la»), «mi», «de», «(», «-»: «Galleta S/ 1.80\nEsa es la utilidad: S/ 0.70», «Ese es el margen: S/ 0.70», «Esa es la ganancia S/ 0.70» tapan el 1.80. Un «El/La» suelto no cuenta («El costo lo ve el dueño.» se ve). Ganancia/margen/utilidad nunca sueltan el de arriba.
- Tabla de VENTA con tabuladores (1.ª línea con tabulador, sin dígitos, sin columna del dueño y con PVP / P. venta / Venta / Precio de venta / Precio): sus filas no miran la línea siguiente; una fila cuya 1.ª celda (tras «(», «mi», «-», «1.», «esa es la»…) empieza con costo/margen/ganancia/utilidad tapa su monto y abre la regla fija (origen «col»): todas las filas con tabulador de abajo se tapan (`Arroz\tS/ 1.21`), igual que con «|».

### Máscaras y tarjeta (Bot 5, FALLA menor 3 y 4)

- `MASK_LEFT_RE` (servidor) y `MASK_LEFT` (celular): además `[*∗＊•●·]{2,}` pegado a dígitos, `[∗＊•●·]{3,}`, `…\d`, `\bx{3,}\d`, `(oculto)`/`(omitido)`. «**negrita**» no es máscara. Cuentan en «manual» (422), en los campos de la propuesta (completar) y en el celular.
- `cardPrefix`: la parte exacta nunca conserva una máscara (`F001-**345678 [oculto]` → `F001-`) ni una etiqueta pegada con guion, «(» o «/» (`F001-DNI`, `F001-RUC`, `F001-DNI ****5678` → `F001-`; `Ana (RUC ****` → `Ana`). `F001-0001` queda exacto.
- /confirm no revisa `lineas[].nombre` de una línea CON `product_id` («Nueva compra» toma el producto de la base por su id): «Leche 12345678» → «Leche DNI ****5678» ya se puede confirmar. Una línea sin `product_id` y los demás campos de la línea sí se revisan.

### PIN numérico (Bot 5, INFO; propuesta aceptada)

- Un valor de 4-8 dígitos cuenta como PIN por palabra de enlace solo tras «pin», «clave» o «contraseña», a lo sumo 2 palabras después del enlace (más «es/era» o «:»/«=»), sin unidad detrás (unidades, und, uds, kg, g, gr, l, lt, ml, soles, S/, %, paquetes, cajas, bolsas) y sin «en/del/de/desde/hasta/por/al/a/para/y/o/año/el/la» justo antes. Valor con letras y dígitos (6+): hasta 5 palabras tras el enlace (Bot 5, casos-5820 F-clave: «La clave del wifi de la tienda: Zq9xK2mPw7» se tapa; antes 3). Dueño, empleado y lo que va al modelo; en partes, la espera de la etiqueta (`PIN_LINK_END`) cubre las mismas 5 palabras.
- «clave de producto 4521», «El pin de la caja: 4321», «El pin de la caja es 4321» → tapados; «Producto clave de la semana 2500 unidades», «La clave del negocio en 2024…», «El token de la sesión del 2026 venció» → se ven.

### Tarjeta en el celular (Bot 4)

- Tras un 422 `fields_required`, el campo marcado conserva lo escrito pero no vuelve a contar como lleno: «Confirmar» sigue apagado hasta que ESE campo cambie.
- 422 sin nada que arreglar en la tarjeta (un campo que no es de la tarjeta, p. ej. `lineas`, o fuera del límite sin filas para quitar) → kind `blocked`: «No se puede confirmar esta compra desde el asistente. Ábrala en Nueva compra.» (en ajuste, el mensaje del servidor) y solo «Cancelar» (Confirmar y «Pedir de nuevo» ocultos).
- 403 `forbidden_role` al confirmar: manda el rol del servidor; no se mira el rol guardado en el aparato ni se reintenta. La tarjeta sale de la pantalla y la propuesta y lo escrito salen de la memoria (`gate.forget`, `wipeManual`); queda solo «Esta sesión ya no es de Admin. Vuelva a entrar como Admin y pida la compra de nuevo.» con «Cerrar».

### Pruebas

- `assistant-code-span-replay.test.mjs`: span de la serie en texto, tabla y tarjeta en trozos de 1/2/3/7/47 y entero; XSS (etiquetas alrededor/dentro: texto, 0 elementos fuera de la span, sin atributos); reenvío misma sesión (200, misma propuesta, hashes sin datos en claro), respuesta cortada + reintento de punta a punta («Nueva compra» llena), otra sesión / otro manual / otras filas / registro viejo → 409 sin propuesta, empleado 403, otro aparato 403, carrera; nota del celular.
- `assistant-followups-58200f60.test.mjs`: sondas de Bot 5 (línea de texto, tabla de venta con tabuladores, máscaras no ASCII en manual/propuesta/celular, prefijo, «Leche 12345678», PIN numérico en dueño/empleado/modelo y en partes), Bot 4 (Confirmar apagado tras 422 hasta cambiar el campo; 422 bloqueado con solo «Cancelar»), `cardPrefix` F001-DNI/F001-RUC/F001-0001, 403 `forbidden_role` (fuera de la memoria, sin reintento, igual con cualquier rol guardado).
- `assistant-card-completar.test.mjs`: la prueba de la serie ahora pide «-» ASCII, sin U+2011 y una span nowrap por serie en trozos de 1/2/3/7/47.


## Ampliación sobre d72b7601 (Bot 5 ev-d72b7601)

Reemplaza «PIN numérico (Bot 5, INFO; propuesta aceptada)» de la ampliación sobre 58200f60 y completa «403 `forbidden_role`» de la tarjeta.

### PIN numérico (decisión final; reemplaza FALLA 1 y la regla de 58200f60)

- **Misma regla para «pin», «clave» y «contraseña»** (`pinNumber`): se tapa cada tramo de 4-8 dígitos que esté a lo sumo a **60 caracteres** y a **5 palabras** de la etiqueta. No cuentan como palabra las de enlace (de, del, la, las, el, los, lo, mi, mis, tu, tus, su, sus, nuestra, nuestro, para, en, que) ni «es/era/fue/son/a»; «:», «=», «: es», «: era» se aceptan. Sin palabras de corte. No cruza «.», «;», «!», «?» ni salto de línea. Si hay varias etiquetas, cuenta la más cercana antes del número.
- **Excepciones**: (1) una unidad clara pegada detrás (unidades, unidad, unid, und, uds, kg, kilos, g, gr, gramos, l, lt, litros, ml, soles, sol, S/, %), solo tras «clave»/«contraseña»: un pin nunca es una cantidad, así que «pin de la caja 4321 unidades» (caso de Bot 5) sigue tapado; (2) un número justo detrás de «S/», «$», «US$» o «PEN»; (3) un número justo detrás de «código», «cód.», «EAN» o «barras» (el dueño ve su código de producto). **Cambiado sobre 3ee80c18** (ver abajo): (3) nunca tras «pin»; (3) tras clave/contraseña solo con «producto»/«artículo» en medio.
- Se tapan: «la clave de la caja fuerte 4321», «…caja fuerte: 4321», «la clave de la caja chica 4321», «clave de la caja en 2024 era 4321» (el 2024 y el 4321), «pin por favor 4321», «El pin del local nuevo de la esquina es 4321», «clave de producto 4521». Se ven: «Producto clave de la semana 2500 unidades», «clave de la caja chica: 2500 soles», «clave de la venta S/ 1250».
- Tapados de más aceptados (sin palabras de corte): «Cambié la clave de la caja en 2024», «La clave del negocio en 2024 fue el arroz», «contraseña del año 2024», «Mi clave para el año 2025», «La clave de este mes: vender 3000 paquetes», «pin 4321 unidades», «El pin de la impresora 1234 no funciona», «La clave del éxito: 5000 ventas».
- Va antes de la regla de la etiqueta; la regla general (que tapa la palabra que sigue a la etiqueta) no actúa si ya hay un «[oculto]» en los 60 caracteres siguientes, así «pin por favor 4321» queda «pin por favor [oculto]» y no «pin [oculto] favor [oculto]».
- **Valor con letras y dígitos**: la regla de 5 palabras tras el enlace queda igual (6 si una de esas palabras es de credencial: wifi, caja, local…).
- Vale para la respuesta al empleado, la respuesta al dueño y lo que va al modelo (redactText / redactModelOwner). En partes: mientras haya «pin/clave/contraseña» seguida de a lo sumo 61 caracteres sin fin de frase al final del texto, no se suelta (`PIN_NUM_WAIT`), y con «… 2500 » espera la unidad. Retenido máximo medido con la sonda de Bot 3: 54 caracteres (tope pedido 80); CPU empleado texto 4000 trozo 1: igual que d72b7601 en la misma máquina (ver informe).

### 403 `forbidden_role`: todas las tarjetas (FALLA menor 2)

- `roleLost` ya no olvida solo la tarjeta del 403: `gate.forgetAll()` (cada propuesta con su `_manual` y lo aplicado), TODAS las `.na-asst-card` salen del DOM y de la memoria (`wipeCard`: estado y campos de «Complete este dato», cualquier input de la tarjeta, `_manual`, `_naKey/_naNeed/_naP`).
- «Nueva compra» abierta y prellenada desde una tarjeta (marca `data-na-asst="1"` que pone `fillPurchase`; al guardar el POS la cierra solo, así que si está abierta no se guardó) → se vacían todos sus campos y se cierra con su propio botón «Cancelar» (`closeW` del POS; si no estuviera, se quita como al tocar fuera). Sin cambiar el núcleo de compras ni `codigos-duplicados.js`. Una «Nueva compra» abierta a mano no se toca.
- Luego `refreshAccess()` (con `lastPing = 0`) pregunta el rol al servidor. Sigue sin mirarse el rol guardado ni reintentarse el confirm. Si al cambiar de rol el panel se rearma (sin la charla) y el aviso ya no está, el aviso va por el aviso del POS (`toast`).
- Nada de propuestas ni de lo escrito va a localStorage, sessionStorage ni IndexedDB (el asistente solo guarda `na_asistente_acc`). El núcleo de compras guarda su propia huella de operación (`OPS`) solo después de «Registrar compra», para no duplicar; el asistente no la toca.

### Reenvío del confirm: HMAC (INFO)

- `s` = HMAC-SHA256(`ASSISTANT_CONFIRM_SECRET`, `confirm-replay:v1|s|` + sesión) (32 caracteres base64url) y `rh` = HMAC-SHA256(mismo secreto, `confirm-replay:v1|r|` + propuesta firmada + operation_id + lo escrito + filas) (48). Mismo secreto que firma las propuestas (sin secreto nuevo), con separación de dominio; ya no se pueden precalcular desde `h`/`op` del token. Un registro con el sha256 viejo no coincide → 409 `already_confirmed` sin propuesta.

### Máscaras (INFO)

- `MASK_LEFT_RE` / `MASK_LEFT`: además `_{2,}`, `#{2,}`, `~{2,}`, `?{2,}`, `-{3,}` pegados a dígitos («____6789», «####6789», «----6789»), `[▪■◦□▫]{2,}` («▪▪▪▪», «■■■■»), `XXX-XX-6789`, y UN carácter de máscara pegado a dígitos al inicio del valor o tras la serie («*6789», «•6789», «F001-*6789» → prefijo «F001-»). «Galleta #2», «Promo 2*1», «Ana_Lopez», «| --- |» no son máscara.

### fillPurchase (INFO)

- Sin el producto en el catálogo local, un `l.nombre` con máscara no se escribe: el campo queda vacío, con borde ámbar, `placeholder` «Complete el producto», `aria-invalid="true"` y `data-na-need="1"`.

### Lo escrito a mano: normalización (Bot 2, decisión final)

- Servidor (`normManual`/`manualBad`, en `fillCheck`) y celular (`C.normManual`/`C.manualBad`, en `needFields`, `fillValues`, `purchaseValue`), misma regla: fuera U+200B-U+200D, U+2060, U+FEFF y los de control; U+00A0, U+2007, U+202F → espacio; U+2010-U+2015 (U+2011 incluido) → «-»; recorte; tope del campo.
- Rechazo (422 `fields_required` con ese campo; en la tarjeta «Complete este dato» con el borde de alerta de siempre, no un error general): vacío tras quitar invisibles, sin ninguna letra o dígito, una tira de 2+ símbolos de relleno (*, ∗, ＊, •, ●, ·, _, #, ▪, ■, ×, …, ◦, □, ▫, ~; con o sin un espacio entre ellos) o una marca «[oculto]»/«(oculto)».
- **Solo documento (y RUC)**: además 2+ X/x seguidas de dígitos («XX6789», «xx-6789») y el resto de `MASK_LEFT_RE`. En el proveedor no: «Ferretería XXL SAC», «Distribuidora XX» pasan.
- Se guarda y se reenvía el valor normalizado (`body.manual`, la propuesta devuelta, el hash del reenvío).

### Tarjeta: nombre del catálogo (Bot 2, INFO)

- En la tarjeta de compra, una línea con `product_id` que está en el catálogo local muestra el nombre del catálogo (`lineName`), no el de la propuesta (que puede venir tapado). Sin el producto en el catálogo, el de la propuesta.

### Serie en la tabla del asistente: 14 px (Bot 4)

- `.na-asst-tbl .na-asst-code.na-asst-cc{font-size:14px}` (selector de la tabla del asistente; gana a `base.css` `td{font-size:12px}` sin tocar otras tablas). Con el `<wbr>` tras el guion no hizo falta reservar alto de fila: CLS del empleado (tabla de códigos, sonda de Bot 4) 0.0109 a 360, 0.0103 a 375, 0.0015 a 768, 0.0009 a 1280 (antes 0.0159/0.0152; tope 0.0137); dueño 0.

### Pruebas

- `assistant-followups-d72b7601.test.mjs`: 49 frases de PIN (las 45 de pin-d72b + 4) en las 4 vías y en partes de 1/3/7/48; unidad recién por llegar en partes de 1-9; máscaras nuevas en servidor y celular + `cardPrefix` + tarjeta; HMAC del reenvío (valor exacto, no sha256, registro viejo → 409, sin secreto nuevo); `fillPurchase` con nombre tapado; `roleLost` con 4 tarjetas y «Nueva compra» prellenada (código real de asistente-ui.js en un DOM mínimo con la forma de `openNew`), almacenamiento vacío, «Nueva compra» abierta a mano intacta.
- `assistant-followups-58200f60.test.mjs`: la revisión estática de `roleLost` acepta `refreshAccess` (rol del servidor) y `wipeCard(c)`; las máscaras con x/X o «…» del caso 3 se prueban en el documento.
- `assistant-normalize-d72b7601.test.mjs`: normalización igual en servidor y celular (U+2011/U+2010/U+2014, ZWSP, BOM, NBSP, U+202F, U+2007), rechazos («■■■■», «××××», «XX6789», solo invisibles, «▪▪▪▪», «____6789»…), «Ferretería XXL SAC» y «Distribuidora XX» pasan, 422 con el campo y valor normalizado en la respuesta, «Complete este dato» en la tarjeta, nombre del catálogo, texto del 403 igual al de CONTRATO.md, selector de 14 px.
- `assistant-reconnect-d72b7601.test.mjs`: `confirmRemote` con un solo reintento automático y el MISMO cuerpo («Reconectando…» por `onRetry`), error con el cuerpo enviado, «Reintentar» con `opts.body` idéntico byte a byte aunque cambie lo escrito, 4xx sin reintento; puerta bloqueada tras corte o 5xx («Sin conexión. Toque Reintentar», cuerpo guardado aunque cambien campos o filas) y desbloqueada tras 4xx real o 200; 409 `already_confirmed_same_session` → «Nueva compra» con lo que mandó el celular y la nota exacta (propuesta ajena → nada); «Ya se confirmó en otro aparato.» solo con 403 `other_device` + `confirmed`; servidor: `confirmed:true` solo si la tarjeta ya se usó, empleado 403; tarjeta: bloqueo antes de mandar, «Reconectando…», «Reintentar» y edición solo tras 200 o 4xx real.

## Ampliación sobre 3ee80c18 (Bot 5 ev-3ee80c18)

### PIN numérico: excepción de código (FALLA 1)

- La excepción (3) «número justo detrás de código/cód./EAN/barras» **nunca** vale tras «pin». Tras «clave»/«contraseña» vale **solo** si entre la etiqueta y el número aparece «producto(s)» o «artículo(s)», sin importar cuántos dígitos tenga el número (`PIN_NUM_PROD`).
- **Dinero (Bot 2)**: tras pin/clave/contraseña, «S/», «$», «US$» o «PEN» delante ya NO sueltan el número solos; lo sueltan solo si entre la etiqueta y el número aparece «precio», «costo» o «monto» (`PIN_NUM_AMOUNT`). Un monto con decimales («S/ 43.21», «S/ 4521.00») nunca entra en la regla (**cambiado sobre 5646a4c9**: ahora sí entra, ver abajo). Se tapan «clave de la caja S/ 4321», «pin de cobro S/ 1250», «clave de la venta S/ 1250»; se ven «clave del precio: S/ 4521», «la clave del costo es S/ 1250».
- **Unidades (Bot 2)** (**cambiado sobre 5646a4c9**: no con «:», «=» o es/era/fue en medio, ni si repite un sustantivo de la etiqueta): además paquete, caja, bolsa, docena, saco, botella y sus plurales, solo tras clave/contraseña (tras «pin» nunca): «La clave de este mes: vender 3000 paquetes» se ve.
- **Año (Bot 2)** (**cambiado sobre 5646a4c9**: no con «:», «=» o es/era/fue/será/sería en medio): tras clave/contraseña (tras «pin» nunca), un 19xx/20xx justo detrás de «del año», «el año» o «en» se ve («clave del año 2024», «la clave del éxito en 2024 fue el arroz»); la revisión sigue con los números que vienen después: «clave de la caja en 2024 era 4321» → «clave de la caja en 2024 era [oculto]».
- Corpus PIN (19493 textos, 4 vías) contra 3ee80c18: 9 textos con más tapado por vía (las fugas de código y dinero) y 12 con menos (solo años y «paquetes»; ningún secreto real destapado).
- Cosmético (sin fuga): cuando el número se ve, la regla de la etiqueta sigue tapando la palabra que sigue a la etiqueta («La clave [oculto] negocio en 2024 fue el arroz»), como antes con «Clave: [oculto] 2000 unidades».
- Regla de la etiqueta: no tapa la palabra que sigue si ya hay un «[oculto]» en los 62 caracteres siguientes, SALVO que ese «[oculto]» sea de otra etiqueta (un valor con dígito y luego pin/clave/contraseña/password/token/api key en medio): «api key sk-123456, la clave 4321» dejaba la api key a la vista en el texto entero.
- El punto de la abreviatura «cód.»/«cod.» no cuenta como fin de frase (ni en `pinNumber`, ni en `PIN_NUM_WAIT` en partes, ni en la regla de la etiqueta): «pin cód. 4321» → «pin cód. [oculto]».
- Se tapan (empleado, dueño, modelo y en partes de 1/3/7): «pin código 4321», «clave: código 4321», «contraseña cod 4321», «pin del EAN 4321», «pin cód. 4321», «PIN EAN-13 4321», «pin códigos 4321», «clave código: 4321», «el pin es el código 4321», «la clave de la caja es código 4321», «clave de barras 4321», «contraseña del código 4321», «pin de acceso código 4321», «la clave del wifi: cod 98765432», «clave del wifi código 12345678», «contraseña del local cod 12345678».
- El dueño ve: «clave del producto Arroz código 77501234», «clave del producto código 77501234». Tapado de más aceptado: «clave de barras del arroz 77501234» (sin «producto»).
- Sin «pin/clave/contraseña» no cambia nada («código de acceso 4321», «el código de la caja fuerte es 4321»): lo decide el dueño.

### Lo escrito a mano: formato y marcas (FALLA menor 2)

- `normManual` (servidor y celular, misma función): primero NFC («José» con acento combinante queda «José», válido); fuera todo `\p{Cf}` (dirección U+202A-202E y U+2066-2069, U+00AD, U+2061-2064, U+200E/F, etiquetas U+E0000-E007F…), selectores de variante U+FE00-FE0F, U+034F y toda marca combinante (`\p{M}`) que no vaya pegada a una letra (tras dígitos o símbolos de relleno: U+20DD, U+0301…); NFC otra vez; después lo de siempre (invisibles, control, espacios, guiones) y las mismas reglas de rechazo.
- «U+202E 1234-100F» se guarda «1234-100F» (ya no se ve como «F001-4321»); «*◌́*6789», «•⃝•6789», «*­*­*6789», «*⁡*6789», «*️*6789», «*͏*6789», «*󠀠*6789» → 422 en proveedor y documento.

### Lo escrito a mano: NFKC y relleno (Bot 2)

- `manualBad` revisa el valor NFC guardado Y una copia NFKC (malo si cualquiera falla): «＿＿＿＿6789», «＃＃＃＃6789», «＊6789» se rechazan; se guarda el NFC tal cual. Relleno también ∙ (U+2219), ✱ (U+2731), ⁎ (U+204E).
- Documento/RUC: también X separadas por espacio o guion («x x 6789», «X-X-6789», «F001-x x 6789»), no dentro de una palabra («Taxi x 6789» pasa).
- Todos los campos (proveedor incluido): «*» o «∗» pegado a dígitos al inicio de una palabra («*6789», «Bodega *6789»). «Promo 2*1 SAC» pasa. «XX6789» en proveedor sigue aceptado (regla XX solo documento/RUC).

### Documento / RUC de izquierda a derecha (Bot 4, FALLA)

- `asistente-ui.js` (sin tocar el núcleo de compras ni el core): en la tarjeta, proveedor (lleva el RUC) y documento van cada uno en su span con `dir="ltr"`, clase `na-asst-ltr` (`direction:ltr;unicode-bidi:isolate` en asistente.css) y el mismo estilo en línea; igual los campos de «Complete este dato» y, en «Nueva compra», `#naPurSupplier` y `#naPurDoc` al prellenar (`fillPurchase`). «U+202E 1234-100F» llega normalizado como «1234-100F» y además aislado.

### Celular: lo que entra a «Nueva compra» tras un 200 (INFO)

- Tras un 200 con propuesta, el `_manual` que sigue a la propuesta aplicada es `sentBody.manual` (el cuerpo que se mandó), no lo escrito en vivo en los campos. Sin cuerpo guardado (puerta usada sin `confirmRemote`), lo escrito como antes.

### Pruebas

- Expectativas cambiadas a propósito: `assistant-followups-d72b7601` («pin de cobro S/ 1250» y «clave de la venta S/ 1250» ahora tapados; años tras «en»/«del año» ahora visibles), `assistant-followups-58200f60` (años y «paquetes» visibles), `assistant-code-span-replay` (proveedor y documento en spans aislados).
- `assistant-followups-3ee80c18.test.mjs`: frases de PIN con código/EAN/barras de Bot 5 y Bot 2 (y las 3 de la sala) en las 4 vías y en partes de 1/3/7; dinero, unidades y año (Bot 2); otra etiqueta antes del «[oculto]»; NFKC, ∙ ✱ ⁎, «x x 6789», «*6789» en servidor y celular y en /confirm; `dir="ltr"` + isolate en la tarjeta y en «Nueva compra» con «U+202E 1234-100F»; «clave del producto Arroz código 77501234» visible al dueño; formato y marcas en servidor y celular (igualdad y 422), «José» combinante válido, bidi fuera; 200 usa `sentBody.manual`; esta sección de CONTRATO.md.

## Ampliación sobre 5646a4c9 (Bot 5 ev-5646a4c9, Bot 2 INFORME 5646a4c9)

Todo en las 4 vías (respuesta al empleado, respuesta al dueño, modelo-empleado `redactText`, modelo-dueño `redactModelOwner`) y en partes; la misma función sirve al texto entero y a las partes (prueba de paridad con cortes fijos 1/2/3/5/7/11 y 25 cortes al azar sobre los casos de Bot 2 y Bot 5).

### PIN numérico
- **Año (Bot 5 FALLA 1)**: el 19xx/20xx tras «del año/el año/en» queda visible SOLO si entre la etiqueta y el año no hay «:», «=» ni es/era/fue/será/sería (`PIN_NUM_ASSERT`). Se tapan «la clave es del año 2024», «la clave es en 2024», «contraseña: el año 1987», «clave = en 2020», «la clave del wifi es el año 2024», «la clave del wifi: del año 1987», «la clave de la caja es del año 2019». Se ven «clave del año 2024», «Cambié la clave de la caja en 2024», «Mi clave para el año 2025». INFO para el dueño, sin cambio: «clave de la caja en 2019» sigue visible.
- **Dinero (Bots 5/2)**: tras «pin» ninguna excepción de dinero («pin precio S/ 4321», «el pin del costo es $ 4321» se tapan). Tras clave/contraseña, «precio/costo/monto» (y «producto/artículo» para la excepción de código) cuentan solo si están en las primeras 5 palabras de la etiqueta (sin las de enlace), ANTES de cualquier «,», «:», «=» o verbo de ser, y sin una palabra de credencial antes (wifi, caja, local, acceso…: `PIN_CRED_WORD`) (`pinExcWord`). Se tapan «la clave, producto de mi trabajo, es código 4321», «la clave, como el precio, es S/ 4321», «clave: monto S/ 4321», «contraseña del wifi del producto código 4321», «la clave de la caja (producto nuevo) código 4321», «clave de la caja, ver producto código 4321», «la clave de la caja y su precio S/ 4321». Se ven «clave del producto Arroz código 77501234», «clave del artículo cód. 4521», «clave del precio: S/ 4521», «la clave del costo es S/ 1250».
- **Decimales (Bot 2)**: un número con decimales (con o sin S/, $, US$, PEN) en la ventana de pin/clave/contraseña es UNA pieza y se tapa entera (`pinDecimal`): tras «pin» siempre («pin S/ 43.21», «pin 4321.00» → «pin [oculto]»); tras clave/contraseña salvo precio/costo/monto (misma regla de arriba) o una unidad: se tapan «la clave es 43.21», «clave S/ 43.21», «clave de cobro S/ 12.50», «clave 4321,00» → «clave [oculto]»; se ven «clave del precio: S/ 43.21», «la clave del costo es S/ 12.50», «clave 2.5 kg». Sin etiqueta cerca no cambia nada («Total S/ 43.21»).
- **Unidades (Bot 2)**: la unidad detrás suelta el número (solo clave/contraseña) solo si entre la etiqueta y el número no hay «:», «=» ni es/era/fue/será/sería, y si la unidad no repite un sustantivo de la frase de la etiqueta (`pinUnitOk`). Se tapan «clave de la caja 4321 cajas», «la clave de la caja fuerte es 4321 botellas», «clave de la caja chica: 2500 soles», «La clave de este mes: vender 3000 paquetes», «la clave es comprar 2000 cajas» (tapado de más aceptado). Se ven «clave de la caja 4521 kg», «Producto clave de la semana 2500 unidades», «clave del mes 1500 bolsas». «clave 4321 paquetes» y «contraseña 1234 docenas» se tapaban ya en 5646a4c9 (la regla de la etiqueta toma la primera palabra tras la etiqueta) y siguen tapados.

### Valor de letras
- **Seguido de otra etiqueta (Bot 5 FALLA 2)**: la regla de la etiqueta tapa también cuando el «[oculto]» cercano es de OTRA etiqueta y el valor de la primera es una palabra de 3+ caracteres tras es/era/de/:/= que no es de enlace (antes solo un valor con dígito). Se tapan «la contraseña es perrito, el pin 4321», «la clave es Gatito y el pin 4321», «api key abcdefghij, la clave 4321», «password qwerty, clave 4321» en el texto entero (JSON, historial, modelo) igual que en partes. «la clave del pin es 4321» sigue «la clave del pin es [oculto]».
- **Clave de puras letras dicha como clave**: «clave del wifi: tortuga» (`pinAlpha`). Etiqueta pin/clave/contraseña/password + enlace + hasta 4 palabras + «:», «=» o es/era + la primera palabra (empieza con letra, 3+ caracteres): se tapa si esas palabras nombran una credencial (`PIN_CRED_WORD`) o si la etiqueta es «contraseña»/«password» (también sin enlace: «la contraseña es perrito, el saldo 4321» tapa «perrito»; el «4321» lo tapa la regla del PIN numérico, igual que antes). No se tapan palabras que no pueden ser la clave (la misma, nueva, personal, la que…: `PIN_ALPHA_SKIP`). «la clave del éxito es vender más» no entra (sin credencial; la regla de la etiqueta de siempre sigue tapando la palabra que sigue a «clave»: «la clave [oculto] éxito es vender más», como antes).

### Propuesta sin caracteres de formato (Bot 5 FALLA 3, Bot 2 punto 3)
- Servidor: `fmtClean` (NFC, fuera `\p{Cf}`, U+FE00-FE0F, U+034F, etiquetas U+E0000-E007F y marcas sueltas, NFC; lo mismo que el comienzo de `normManual`) en `cardField` antes del filtro (proveedor, documento), en la fecha y en el nombre de una línea sin producto. «U+202E 1234-100F» llega a la tarjeta como «1234-100F».
- Celular: `fmtClean` (misma función) en `purchaseValue` (lo que entra a «Nueva compra») y en `appendCoded` (tarjeta y celdas). Una propuesta con U+202E (servidor viejo o factura alterada) se muestra y se escribe sin él; `dir="ltr"` + isolate siguen puestos.

### Relleno
- Parecidos a un asterisco en el relleno y pegados a dígitos, servidor y celular (`FILL_RUN_RE`, `FILL_STAR1_RE`, `MASK_LEFT_RE`): ⁕ (U+2055), ⁑, ⁂, ✲-✽ (✻ U+273B), ❉-❋, ⚹, ⊛, ٭ (U+066D), ﹡ (U+FE61). «⁕6789», «✻✻6789», «٭٭6789» → 422. «Promo 2*1 SAC», «Estrella ✻ Lima», «José» pasan.

### Pruebas
- `assistant-followups-5646a4c9.test.mjs`: las sondas de Bot 5 (pin-5646, letras, propuesta-bidi, norm-5646) y de Bot 2 en las 4 vías y en partes de 1/3/7; paridad texto entero = partes (propiedad); propuesta con U+202E/U+2066 en servidor, `purchaseValue`, `appendCoded` y `fillPurchase` real; relleno ⁕ ✻ ٭ en servidor = celular; esta sección.
- Expectativas cambiadas a propósito: `assistant-followups-3ee80c18` («pin del precio S/ 4321» y «clave S/ 43.21» tapados; «La clave de este mes: vender 3000 paquetes», «la clave es comprar 2000 cajas», «la clave es pedir 1200 docenas», «la clave es tener 4000 sacos» tapados), `assistant-followups-d72b7601` («pin de cobro S/ 12.50», «clave de cobro S/ 12.50», «La clave para vender más es tener 1500 unidades.», «clave de la caja chica: 2500 soles» tapados), `assistant-followups-58200f60` («La clave de este mes: vender 3000 paquetes.» tapado).

## Ampliación sobre c16a407d (Bot 4, INFORME 5646a4c9)

- **El campo muestra lo limpio (FALLA 1b)**: en «Complete este dato» (proveedor, documento) cada evento `input` (escribir, pegar, soltar) pasa el valor por `inputClean` (= `normManual` sin el recorte de los extremos: NFC, fuera `\p{Cf}` (U+202E, U+2066-2069, U+00AD, U+200B…), U+FE00-FE0F, U+034F, etiquetas y marcas sueltas; NBSP → espacio, U+2010-2015 → «-»). Si cambia, se reescribe `input.value` y el cursor/selección retrocede lo quitado antes de él (pegar deja el cursor al final de lo pegado); si no cambia, no se toca. Durante una composición (`compositionstart`…`compositionend` o `isComposing`) no se reescribe; se limpia en `compositionend`. Lo que se ve = lo que se manda (`normManual(x) === inputClean(x).trim()`). El inicio que trae la propuesta («F001-») también pasa por `inputClean`.
- **Clases (menor 1c)**: el estado lleno/vacío/422 cambia solo la clase `ok` con `classList.toggle`; `na-asst-need` y `na-asst-ltr` (de `ltrIsolate`) se quedan.
- **U+00AD en la propuesta (1d)**: confirmado que `fmtClean` de c16a407d ya lo quita en el servidor (`cardField`, línea, fecha) y en el celular (`purchaseValue`, `appendCoded`): «F001-000-U+00AD/12345» → «F001-000-/12345».
- Pruebas: `assistant-followups-c16a407d.test.mjs` (U+202E/U+00AD/ZWSP/U+2066/etiquetas escritos y pegados, cursor en medio, selección, composición, clases en ciclos lleno → vacío → 422, U+00AD en la propuesta y en el inicio del campo).

## Ampliación sobre 6e0b3c5d (Bot 5 ev-6e0b3c5d, Bot 4 INFORME 6e0b3c5d, Bot 3 c16a407d, Bot 2 INFORME c16a407d)

### Clave entre comillas (Bot 5, 1)
- `PIN_QUOTE_RE` / `pinQuote`: pin/clave/contraseña/password (+ enlace y hasta 4 palabras) + `:`/`=` o `es`/`era`/`fue` (o nada) + texto entre comillas de 1 a 40 caracteres → se tapa TODO lo de adentro, con o sin palabra de credencial: «la clave del wifi es "[oculto]"». Comillas: " ' « » “ ” ‘ ’ ‹ › „. Igual en las 4 vías (empleado, dueño, modelo-empleado, modelo-dueño) y en partes (`PIN_QUOTE_OPEN` retiene mientras la comilla abierta tras una etiqueta no se cierra).

### Miles (Bot 5, 2)
- `PIN_DEC_SRC`: decimales y también miles como UNA pieza: «4.321», «12.345», «1.234.567», «4,321» y con espacio (normal, U+00A0, U+202F) «4 321». Misma regla que los decimales (abajo). Tras «pin» nunca hay excepción.

### Dinero tras clave/contraseña: regla final (Bot 2, pasos 1 y 4)
- Tras clave/contraseña, una palabra de precio (precio/costo/efectivo/monto/total/vuelto) **justo antes del monto** (solo moneda o ≤ 2 palabras que no son de enlace en medio) **o justo antes de «clave»** («precio clave S/ 4.50», «costo clave 4.50 soles») suelta el monto SOLO si tiene céntimos («4321.00», «1.234,50», «12.50»). Sin moneda también («clave del monto 99.90»).
- Enteros: SIEMPRE tapados, con o sin precio/costo/monto y con o sin moneda («clave del precio: S/ 4521», «la clave del costo es S/ 1250», «La clave para vender es el precio S/ 2500» → tapados).
- «clave costo S/ 4321» tapa el número, nunca la palabra de precio. «clave 4,321» y «la clave de la caja es 43.210» tapados.
- Tras «pin»: ninguna excepción (ni dinero, ni unidad, ni código, ni año).
- En partes, tras una palabra de precio no se corta si lo que sigue es (o puede ser aún) pin/clave/contraseña/password, tampoco dentro de los espacios que siguen (`priceKwNext`).

### Unidad (Bot 2, pasos 1 y 3)
- La unidad deja ver el número solo si: no hay sustantivo de credencial en la etiqueta (`PIN_CRED_WORD`: caja, local, wifi…; «la clave de la caja 4321 unidades» → tapado), hay al menos una palabra que no es de enlace entre la etiqueta y el número («clave 2.5 kg», «clave 43.21 kg», «clave 12.50 soles», «contraseña 3,75 litros» → tapados; «clave del arroz 1.5 kg» se ve) y no hay «:», «=» ni es/era/fue/será (ser) en medio.

### «negocio», artículo, año, código (Bot 5)
- «la clave del negocio es Gatito», «…es: el perro» → tapados (`pinAlpha` acepta artículo el/la/los/las/lo tras es/era si la etiqueta es fuerte: password, contraseña o un sustantivo de credencial). «negocio» es credencial DÉBIL: tapa solo con «:»/«=» o con el valor en mayúscula; «la clave del negocio es la atención» sigue visible.
- Año: «la clave, del año 2024» → tapado (con una coma entre la etiqueta y el año no hay excepción de año). «Cambié la clave de la caja en 2019» sigue visible (decisión del dueño pendiente).
- Código: «clave del artículo es código 4321» → tapado (con «:», «=» o ser en medio no hay excepción de código).

### Etiqueta neutra para 8 dígitos (Bots 4/5)
- Para el empleado, 8 dígitos junto a «código/cód./EAN/barra(s)» o en una columna «Código» de una tabla se tapan como «código ****1234» (o «****1234» si la etiqueta de código va justo delante); con «DNI» delante o sin ese contexto, «DNI ****1234» como siempre (`idMask`). En partes mira lo ya soltado (`redactTextCtx`, hasta 8000 caracteres); el corte no parte «código ****1234» (`cutSafe`). El dueño sigue viendo sus números.

### Streaming (Bot 5, 3; Bot 3, A/B)
- En partes = texto entero en TODOS los cortes (prueba de todos los cortes de una pieza, todos los pares en textos cortos y pasos 1/2/3/5/7/11), también con «clave 43.21 kg» y «costo clave 4.50 soles».
- `PIN_NUM_TAIL` también con decimales/miles y consciente de la unidad: decide solo la palabra que sigue al número; si está a medias y puede ser el comienzo de una unidad, espera (`'wait'` + `doRecheck`).
- Etiqueta repetida sin punto («pin pin pin…», «la contraseña es perrito, el pin 4321 …»): ya no se retiene todo el texto. Un corte que solo frenó `pinOpen` se prueba cuando tiene `SHIELD_M` (72) caracteres detrás, cada `SHIELD_EVERY` (8): vale solo si filtrar A y el resto por separado da EXACTAMENTE lo mismo que todo junto, ahora y con las continuaciones que podrían colgarse de una etiqueta de A (`SHIELD_PROBES`: número, decimal, «es Valor», «: Valor», valor con letras y dígitos, entre comillas, un «[oculto]» que viene; también desde el último espacio, por la palabra a medias). Las pruebas se omiten cuando desde el fin de la última etiqueta de A ya hay ≥ 72 caracteres y > 10 palabras (ninguna regla de etiqueta llega tan lejos). Retención medida (8000 caracteres, trozos de 1 y 5): 88-122 caracteres; costo lineal (exponente 0,96-1,01 a 12/25/50/100 KB).
- Filtro previo (`PIN_GATE`): si el texto no tiene pin/clave/contrase/password/token/api (sin distinguir mayúsculas), las reglas de PIN no se prueban (`PIN_GATED`). Solo se mira `pinOpen` si una etiqueta empezó en los últimos 170 caracteres.

### Campo de la tarjeta (Bot 4, Bot 3 C)
- Pegar/soltar (y un reemplazo del corrector con caracteres de control): se limpia en `beforeinput` (`insertFromPaste`, `insertFromDrop`, `insertReplacementText`): `preventDefault` + `document.execCommand('insertText', false, limpio)`, que deja entera la pila de deshacer de Chrome (Ctrl+Z quita lo pegado; rehacer no concatena). `setRangeText` solo si execCommand no está o devuelve false. Saltos de línea → espacio. El recorte a `NEED_MAX` va DESPUÉS de limpiar y cuenta lo que ya hay (menos la selección). Lo pegado sin nada que limpiar ni recortar lo inserta el navegador. Pegar 100 KB: se limpia solo lo que puede caber (0,5 ms en Chrome).
- Escribir normal sigue por `input` (solo reescribe si cambia); el `input` que sigue a un pegado ya limpiado no hace nada; durante una composición no se toca nada. `maxLength` = 2 × `NEED_MAX` para el camino de respaldo (autocompletar, teclados o arrastres sin `beforeinput`): se limpia y luego se recorta.
- «Confirmar» se enciende solo si `inputClean(valor) === valor` y el valor cabe en `NEED_MAX` (nunca con U+202E crudo a la vista, p. ej. una composición que termina sin `compositionend`). Al salir del campo (`blur`): `composing = false`, se limpia y se recalcula.

### Expectativas cambiadas a propósito (enmascarar ante la duda)
- Tapados ahora: «clave 2.5 kg» (antes visible), «clave de la caja 4521 kg», «clave del precio: S/ 4521», «la clave del costo es S/ 1250», «clave del monto PEN 3000», «clave del costo S/ 1250», «La clave para vender es el precio S/ 2500», «La clave fue vender 1.200 unidades», «La clave para la caja chica son 1200 soles», «la clave de la promo es 2x1 hasta 1.500 piezas». «Codigo del cliente: 12345678» → «código ****5678» (sigue tapado).
- Pruebas actualizadas: `assistant-followups-3ee80c18`, `-5646a4c9`, `-58200f60`, `-d72b7601`. Nuevas: `assistant-followups-6e0b3c5d.test.mjs` (13 pruebas; todas fallan contra 6e0b3c5d).

## Ampliación sobre 39ccd25c (Bot 2 INFORME 39ccd25c, Bot 5 ev-39ccd25c, Bot 3 asistente-39ccd25c, Bot 4)

### Valor entre comillas o envoltorios (Bot 2 FALLA, Bot 5 1)
- Tras una etiqueta de credencial (pin/clave/contraseña/password + enlace y hasta 4 palabras + «:»/«=»/es/era/fue + artículo), una comilla de
  cualquier tipo (" ' « » “ ” ‘ ’ ‹ › „ ‚, también sin cerrar o de otro tipo) o un envoltorio (`**` `__` `_` `` ` `` ```` ``` ```` `(` `[` `~~`) abre una
  ventana de 40 caracteres. Cerrado dentro de la ventana: se tapa lo de dentro y se conserva el envoltorio («"[oculto]"», «**[oculto]**»).
- Sin cerrar: se tapa desde la primera palabra hasta lo primero que llegue entre `.` `;` `!` `?` (seguido de espacio o fin), salto de línea o 40
  caracteres. Nunca hasta el final del texto. «la clave es «perro azul» → «la clave es «[oculto]».
- Envoltorios sin comilla siguen la regla de pinAlpha (palabra fuerte o «negocio» con «:»/mayúscula; artículo solo con «:» o palabra fuerte).
- Un monto envuelto («**S/ 4.50**», «`12.50`», «**4.50 soles**») decide la regla de dinero igual que sin envoltorio (ver abajo).
- La regla general de la etiqueta no vuelve a tapar un valor ya tapado dentro de su envoltorio (si no, el resultado dependía de lo que venía
  después y el texto en partes no podía soltarse).
- Mismo criterio en las 4 vías (empleado, dueño, modelo empleado, modelo dueño). redactModelOwner usa ahora el camino incremental (antes el de
  retención legada, que daba diferencias en «clave» + espacios).

### Palabra de enlace sola (Bot 4, INFO)
- «del», «para», «que», «en»… solos tras la etiqueta nunca se tapan: «La clave del negocio en 2024 fue el arroz» queda igual (antes «La clave
  [oculto] negocio»; solo se tapaba esa palabra y lo que seguía quedaba igual a la vista). El valor real sí: «la clave para Tortuga22» → «la clave
  para [oculto]», «clave de tortuga» → «clave de [oculto]».

### Espacios (Bot 5)
- (Tope 120 desde la ampliación sobre 36f6ae51.) Una racha de más de 160 espacios tras la etiqueta se junta en uno antes de las reglas del PIN (regla ya existente): «clave» + 200 espacios +
  «4321» → «clave [oculto]». La ventana de la etiqueta NO se suelta por los espacios.

### Dinero (decisión final: sin cambios)
- La regla de 39ccd25c queda igual. «la clave es precio S/ 43.21» → «la clave es [oculto] S/ 43.21» (el monto sigue visible, como en 39ccd25c; desde 36f6ae51+ la palabra «precio» tampoco se tapa, ver abajo). De los 12 montos del dueño de Bot 2, 9 visibles (igual que
  39ccd25c), también envueltos en `**` y `` ` ``.

### Etiqueta neutra para 8 dígitos (Bot 4)
- 8 dígitos sin DNI/documento/doc/identidad delante → «código ****1234» (también «Escanee 77501234» → «Escanee código ****1234» en las vías de empleado y del modelo). Con
  DNI/documento/doc/identidad delante o bajo una columna así → «DNI ****1234».

### Streaming
- Cada etiqueta o comilla abre su propia ventana; el texto en partes es igual al texto entero en todos los cortes (4 vías, 492 740 cortes, 0
  diferencias). Retención con la etiqueta o la comilla repetida: ≤ ~130 caracteres (máx. medido 132), también con 100 KB. Se prueban hasta 3
  cortes candidatos (SHIELD_TRIES) para no quedar en fase con un patrón que se repite. Los puntitos de «escribiendo» siguen visibles mientras se
  retiene texto (doneBubble solo al terminar el flujo).

### Campo de la tarjeta (Bots 4/5)
- Campo lleno = como maxlength nativo: escribir no inserta nada y el valor queda igual; lo que no cabe se quita de lo recién escrito (antes del
  cursor), no del final. Sin contador N/80 (opcional, no hecho).
- Valor puesto por script sin evento: al tocar «Confirmar» se revisa (recheck); si cambió, se limpia a la vista y ese toque no manda nada (lo visible
  = lo enviado). (36f6ae51+) también con el foco en el campo: el blur que hace el clic marca el cambio y el primer toque no manda.

### Confirmar con señal débil (Bot 3, 7a)
- Cada intento arma su propio límite (12 s) ANTES de llamar a fetch y lo quita solo en finally. Además un reloj de pared (Date.now) revisa el límite
  cada segundo y al volver la pantalla o la red (visibilitychange, focus, pageshow, online): si el navegador demora el temporizador largo, el intento
  se corta igual. 2 intentos, 600 ms entre ellos; «Reconectando…» a ~12,6 s, «Sin conexión» a ~24,6 s.

### Pruebas
- Nuevas: `assistant-followups-39ccd25c.test.mjs` (11) y `assistant-confirm-timeout-39ccd25c.test.mjs` (5, reloj falso; incluye 40 corridas
  simuladas de 7a). Contra 39ccd25c fallan 14 de 16 (pasan 3b, costo lineal, y 7, puntitos, que ya estaban bien).
- Actualizadas (etiqueta «código»): `assistant-followups-25ffde10`, `-6280deae`, `-6e0b3c5d`, `assistant-worker`. `assistant-live-access`: el patrón
  del doble toque admite la revisión síncrona de campos.

## Ampliación sobre 36f6ae51 (Bot 2 INFORME 36f6ae51, Bot 5 ev-36f6ae51)

### Comilla o envoltorio: salto de línea y ventana (Bot 2 F1/F2, Bot 5)
- Entre la apertura (cualquier comilla o envoltorio) y el valor se aceptan espacios y UN salto de línea (`\n` o `\r\n`): «la clave del wifi es
  "⏎tortuga» → «… "⏎[oculto]», «… «⏎tortuga»» → «… «⏎[oculto]»». Una línea en blanco entera (dos saltos) no entra en esta regla.
- La ventana cuenta desde el comienzo del valor y mide 80 caracteres (antes 40). Con cierre dentro de los 80 se tapa todo lo de dentro (una comilla
  cerrada de 41–80 caracteres ya no deja cola: «"[oculto]nco gris"» → «"[oculto]"»).
- Sin cierre: se tapa la primera palabra (siempre entera) y luego hasta lo primero entre `.` `;` `!` `?` seguido de espacio o fin, salto de línea, otra
  etiqueta o los 80 caracteres; si los 80 caen a mitad de palabra, se sigue hasta el final de esa palabra (a lo sumo 20 más). Nunca hasta el final
  del texto. «…es "perro azul verde amarillo rojo naranja morado gris» → «…es "[oculto]». Límite conocido: una sola «palabra» de más de 100
  caracteres sin espacios deja ver lo que pasa de 100.
- Bloque de código: la etiqueta de lenguaje cuenta solo si sigue un salto («```text⏎tortuga⏎```» → «```text⏎[oculto]⏎```»); «```tortuga```» →
  «```[oculto]```» (antes «```tortuga[oculto]»). Etiquetas HTML de formato `<b> <strong> <code> <em> <i> <u> <mark> <kbd> <pre>` abren y cierran con «</».

### Cabecera y separadores (Bot 5 1 y 3)
- Entre la etiqueta (y su frase) y la comilla: hasta 200 espacios de cualquier tipo (espacio, tab, NBSP, em…) en el separador (antes 16:
  «clave del wifi:» + 17–160 espacios + «"tortuga"» se veía; regresión frente a 39ccd25c). Con más de 200 no entra (límite conocido; tras «clave:»,
  «clave es» o «pin» sin frase la racha de más de 120 ya se junta en uno y sí entra).
- Separadores además de «:», «=», es/era/fue: «->», «=>», «→», «—», «–», «|» (tabla «| clave del wifi | tortuga |») y la cita de markdown
  «clave del wifi:⏎> tortuga» (también para el PIN numérico: «pin:⏎> 4321»).
- Tras es/era/fue, una palabra de enlace (para/en/de/del/que) y el valor: se tapa el valor si tiene letras y dígitos («la clave es para
  Tortuga22» → «… para [oculto]») o, con palabra fuerte (contraseña/password o sustantivo de credencial), si empieza con mayúscula («la contraseña es
  en Tortuga», «la clave del wifi es de Tortuga»). La palabra de enlace sola sigue visible («la clave es para», «la clave: de»); «la contraseña es
  para proteger tu cuenta» queda igual.
- Montos: con los separadores nuevos, en tablas y con flechas los 12 montos del dueño de Bot 2 dan lo mismo que en texto plano (9/12 visibles) y los
  5 precios normales quedan intactos.

### Palabra de precio (Bot 2, INFO)
- La palabra de precio (precio, costo, efectivo, monto, total, vuelto) nunca se tapa como «valor de la etiqueta»: «la clave es precio S/ 43.21» queda
  igual. El número lo sigue decidiendo la regla de dinero («la clave es precio 4321» → «… precio [oculto]», «pin precio S/ 43.21» → «… S/ [oculto]»).

### Espacios e invisibles (Bot 2 INFO, Bot 5 4b)
- La racha tras una etiqueta se junta en uno cuando pasa de 120 caracteres (antes 160). La etapa de espacios retiene a lo sumo 120: «pin» + 500
  espacios + «4321» retiene 123 (antes 163; medido como largo filtrado del prefijo menos lo emitido). Medido como «entrada − salida» sigue dando ~500
  porque los espacios descartados nunca salen: no es retención.
- Caracteres invisibles de formato (U+200B–U+200F, U+2060–U+2064, U+FEFF, U+180E, U+00AD, U+202A–U+202E, U+2066–U+2069) dentro de esa racha cuentan
  como parte de la racha y se quitan: «clave:» + « ⏎U+200B» ×70 + «4321» → «clave: [oculto]». Fuera de una racha tras etiqueta no se tocan; una racha
  corta de puros invisibles queda como estaba.

### DNI (Bot 5 4c)
- Con «documento», «doc.» o «identidad» justo delante (con «:», «#» o espacios) no se repite la etiqueta: «documento ****5678», «identidad: ****5678»
  (antes «documento DNI ****5678»). Más lejos («documento del cliente 12345678») sigue «DNI ****5678».

### Streaming y retención
- Mismo criterio en las 4 vías y en partes: 430 textos, 1 146 496 cortes, 0 diferencias, 0 fugas (b5fix/run-<hash>/ev/allcuts.txt).
- Retención (largo filtrado del prefijo − emitido, trozos 1 y 5, 8000 caracteres): casos normales y repetidos ≤ 130 (máx. medido 130, «pin » repetido);
  «pin» + 500 espacios 123; con la ventana nueva de 80+20, «clave "⏎abcde » repetido 110 y «la contraseña es **⏎perro azul** » 106. Máximo medido:
  298, solo con 200 espacios en la cabecera antes de la comilla («clave del wifi:» + 200 espacios + «"perro" y » repetido; 248 con 150): la cabecera
  entera más la ventana tiene que llegar junta. Los puntitos de «escribiendo» siguen visibles mientras se retiene.

### Campo de la tarjeta (Bot 5 4a)
- Con el foco en el campo, el clic en «Confirmar» saca el foco antes: si el blur encuentra un valor cambiado sin evento (script/extensión), lo limpia a
  la vista y el primer toque que sigue no manda nada; el siguiente manda lo visible. Una entrada real (input/composición) borra la marca. Sin
  temporizador.

### Pruebas
- Nueva: `assistant-followups-36f6ae51.test.mjs` (11). Contra 36f6ae51 fallan 9 de 11; pasan 9 (dinero en tablas/flechas: es una guarda de no
  regresión) y 11 (retención acotada y paridad con los repetidos nuevos: guarda).
- Actualizadas (etiqueta sin repetir): `assistant-followups-25ffde10` («Doc: ****5678»), `assistant-followups-39ccd25c` (documento/Doc:/identidad).

## Sobre f773911f (Bots 2/3/4/5) y mascota v11 (22-10)
- **Supresión** (servidor, texto entero y en partes, misma etapa `createSupStage`/`supQuotes`): comilla o envoltorio sin cerrar tras pin/clave/contraseña/password que a los 80 caracteres sigue sin cierre ni fin de frase → sale UN «[oculto]» y se descarta hasta el cierre, un salto, «. ; ! ?» + espacio, otra etiqueta o 400 caracteres (terminando la palabra). Paridad en todos los cortes = 0 (1 023 textos, 4 vías, 1,74 M cortes).
- Número tras «:»/es/era/fue con hasta 2 saltos y marca de cita o lista (`>`, `-`, `*`, `1.`): se tapa. `S/4.50`, `S/.4.50`, `S/. 4.50` y `S/ 4.50` son moneda siempre. Invisibles (U+200B…) en la cabecera de la etiqueta, flechas como «:», «>» pegado al valor, «—»/«–» solo con sustantivo de credencial o pin/contraseña/password, «…DNI … es ****8912» sin repetir la etiqueta. Excepción del adjetivo: tras «producto/cliente/proveedor/punto/dato/insumo clave» solo se ve un monto con moneda y céntimos, nunca cerca de pin/contraseña/password/wifi/caja/local/alarma.
- **Pendiente del dueño, SIN cambio:** «código de acceso 4321» y «Cambié la clave de la caja en 2019» se ven igual que en f773911f (prueba 6 de `assistant-followups-f773911f.test.mjs`).
- Pantalla (solo en el aparato, después del filtro del servidor y como texto): se quitan `<b> <strong> <code> <em> <i> <u> <mark> <kbd> <pre>` escritos como texto y las vallas ```; en partes se retiene a lo sumo la etiqueta incompleta del final; lo que se ve en partes = lo que se ve con el texto entero. Puntos «escribiendo» visibles dentro de la burbuja (color del texto, alto reservado, quietos con menos movimiento).
- `/confirm`: un 200 cuyo cuerpo no es JSON (cortado) cuenta como corte: «Reconectando…» y UN reintento con el mismo cuerpo; un 409/403 del reintento se muestra tal cual. El límite de cada intento usa `performance.now`.
- **Mascota v11 del dueño:** `POS/assets/asistente/mascota-v11.html` (el archivo que mandó el dueño, sin cambios; Three.js empaquetado adentro, sin pedidos a otros sitios ni claves) y `POS/js/modules/asistente/asistente-mascota.js`. Solo en la cabecera del panel del asistente, en el hueco de 46 px de la cara (el panel no cambia de alto y el diseño del celular del POS no cambia). Se pide al abrir el panel la primera vez, en un momento libre (el arranque del POS no baja nada); con «Ahorro de datos» no se baja. Marco del mismo sitio, sin foco ni toques ni lector de pantalla. «¡Listo!» → salto, «Algo falló» → sorpresa, respuesta → mueve la boca con el texto que se ve; con menos movimiento no salta ni habla. Si falla queda la cara de siempre. Fuera de línea no se guarda en caché (sw.js no se tocó): se ve la cara de siempre.

## 22-10: «Admin» en pantalla y migraciones renumeradas
- Todo texto que se ve en el asistente dice «Admin» en vez de «dueño» (cabecera «Gestión · Admin», «Registrar este teléfono como Admin», mensajes del servidor y del aparato, la etiqueta de montos ocultos «[dato del Admin]»). Los nombres internos de rol (`owner`, `empleado:*`), los códigos de error y la API no cambian.
- Migraciones del asistente renumeradas para no chocar con `0034_price_history.sql` de la base: `0035_pos_assistant_access_log.sql` y `0036_pos_owner_device_log.sql`. Solo se renombraron los archivos; **no se aplicó nada**.

## 22-10: Routeway por defecto, 429 y respaldo, sin <think>, sin markdown en pantalla
- Proveedor por defecto (solo configuración): Routeway, `https://api.routeway.ai/v1` (compatible OpenAI), modelo `gemma-4-26b-a4b-it-luminous:free` con respaldo `minimax-m2.7:free`. La clave es un secreto del Worker que pone el Admin: `ROUTEWAY_API_KEY` (o `AI_API_KEY` con `AI_PROVIDER=routeway`). Sin `AI_PROVIDER`: Routeway si tiene clave; si no, DeepSeek como antes. `AI_FALLBACK_MODEL` opcional. Lectura de fotos apagada para Routeway salvo `AI_VISION=1`.
- 429: el mismo modelo se reintenta una vez tras 0,8 s (o `Retry-After` de hasta 3 s); luego pasa al modelo de respaldo, con un reintento tras 1,5 s. Solo antes de que salga texto. La espera se corta con el pedido.
- `<think>…</think>` (y `<thinking>`) se quitan en el servidor ANTES de la redacción, en JSON y en partes; un bloque sin cierre se descarta.
- En pantalla (después del filtro del servidor y de `esc()`): `**`, `__` se quitan y las líneas «- » / «* » se ven con «• ». Misma regla en partes que con el texto entero.

## 22-10 (2): OhMyAgent principal y «Revisión del punto de venta»
- Proveedor principal por defecto (solo configuración): OhMyAgent, `https://ohhmyagent.com/v1` (compatible OpenAI), modelo `gpt-6.1-sol`. Respaldo: Routeway `https://api.routeway.ai/v1` con `gemma-4-26b-a4b-it-luminous:free` (y `minimax-m2.7:free`). Claves como secretos del Worker, una por proveedor: `OHMYAGENT_API_KEY`, `ROUTEWAY_API_KEY` (sin la de Routeway no hay respaldo; `AI_API_KEY` solo sirve al proveedor de `AI_PROVIDER`). Sin `AI_PROVIDER`: OhMyAgent si tiene clave, si no Routeway, si no DeepSeek. Fotos apagadas en ambos salvo `AI_VISION=1`.
- 429 y 5xx: un reintento con espera corta en el mismo modelo y luego el respaldo (otro modelo y otro proveedor), solo antes de que salga texto. 400/401/403/404 no se reintentan. Con foto, solo respaldos que leen fotos.
- «Revisión del punto de venta» (solo Admin). En el aparato del Admin (`na_asistente_acc=owner`) el cargador instala escuchas pasivas: `error`, `unhandledrejection`, respuestas 4xx/5xx de la API por `PerformanceObserver` (solo ruta y código) y clics por pantalla + función/id del botón (nunca textos). Se guarda en `localStorage` (`na_asst_rev`): últimos 200 errores agrupados con veces, 300 contadores, mensajes limpios (montos, correos, números largos, claves) y cortados a 160. No se envuelve `fetch` ni se toca el núcleo del POS. Empleado: no se instala nada.
- El Admin la pide (chip «Revisión del POS» o el texto «Revisión del punto de venta»), o al abrir el panel ve «Hay N errores nuevos» con «Ver revisión». El aparato manda su resumen pasado por el redactor del asistente a `POST /auth/assistant/review`; el servidor lo vuelve a limpiar, agrupa, arma el informe (el modelo lo redacta si hay proveedor; si no o si falla, informe fijo) y no guarda nada (solo el contador de uso de siempre). Empleado o sin rol: 403 `review_admin_only` (no quita el asistente). Sin migraciones.
- Límite conocido: solo se ven los errores del aparato del Admin (los de los aparatos de empleados no se juntan sin guardar en el servidor).

## 22-10 (3): «Leer boleta con IA», monitor de lentitud y cuelgues, informe a pedido, clientes por código, publicación en CANON

- **Leer boleta con IA (solo Admin).** `POST /auth/assistant/boleta` (misma bandera `ASSISTANT_ENABLED`). Una foto achicada en el aparato (EXIF respetado, lado máx. 2000 px, máx. 4 MB) va al modelo con visión (OhMyAgent `gpt-6.1-sol`); el respaldo Routeway Gemma no lee fotos y no se usa para fotos. Respuesta SOLO JSON `{numero, fecha, items[{cant, um, cod, descripcion, precio_unit, importe}], total, rotacion}`, null para lo ilegible. Tiempo máx. 90 s (504 `boleta_timeout`), JSON roto 422 `boleta_unreadable`, empleado 403 `boleta_admin_only`, sin visión 503 `image_unsupported`. Cuenta como pregunta con foto (mismos topes).
- **Revisión en el aparato.** Campos editables, null en amarillo, aviso si la suma de importes no da el total y si la foto parece borrosa o girada; botones 90° izq./der. y 180° vuelven a leer. Si el modelo dice `rotacion` distinta de 0 o casi todo vino null, se gira en el aparato y se lee UNA vez más (automático). «Confirmar» NO guarda nada: solo prellena «Nueva compra» (ruta de guardado congelada, sin tocar `codigos-duplicados.js`); boleta ya confirmada en este aparato pide «Sí, es otra compra».
- **Aprender de correcciones (no es entrenar al modelo).** Pares leído -> corregido de código, descripción y unidad en `localStorage na_asst_bol_learn` (máx. 300, sin 8+ dígitos ni correos). Coincidencia exacta se aplica en la próxima lectura (marcado «corregido por historial») y las 20 más usadas van como pistas. «correcciones guardadas» las muestra y permite borrarlas.
- **Monitor (solo Admin, pasivo).** Además de errores: API > 3 s (solo la ruta), tareas largas (`PerformanceObserver longtask`), pantallas > 1,5 s, cuelgues (latido de 1 s, pantalla visible congelada > 5 s, sin contar doble con la tarea larga) y lecturas de boletas (duración, fallas, tiempo, correcciones por boleta).
- **Clientes por código.** Si el problema pasa hasta 15 s después de tocar algo de un cliente (abono, venta a crédito, editar cliente), se guarda SOLO el id que ese cliente ya tiene en la lista de clientes del POS y la acción. Nunca nombre, DNI, teléfono, dirección ni montos. El informe dice «cliente #código»; en el aparato del Admin ese texto es un botón con el nombre buscado localmente que abre al cliente (`abrirCred`). El nombre nunca va al servidor ni al modelo.
- **Informe a pedido.** Chip «Revisión del POS» o frases como «hazme el informe»: errores, lentitud, cuelgues, lo más/menos usado, lectura de boletas y sugerencias. Empleado 403.
- **CANON.** `wrangler.turso-prod.jsonc` vars: `ASSISTANT_ENABLED=1`, `AI_PROVIDER=ohmyagent`, `AI_BASE_URL=https://ohhmyagent.com/v1`, `AI_MODEL=gpt-6.1-sol` (Routeway y sus modelos son valores de fábrica en el código). Secretos del Worker (el workflow del Worker los pasa por stdin, enmascarados): `ASSISTANT_AI_API_KEY_4` (OhMyAgent), `ASSISTANT_AI_API_KEY_2` (Routeway), `ASSISTANT_CONFIRM_SECRET` (firma de tarjetas). Sin migraciones para estas funciones; 0035 (bitácora de niveles) es opcional y 0036 solo hace falta para registrar aparatos dueño desde el asistente (`ASSISTANT_OWNER_BOOTSTRAP`, apagado).

## Resúmenes del día y del mes (`consultar` con `resumen_dia` / `resumen_mes`)

- **Quién:** solo el Admin. Empleado (cualquier nivel): 403 `summary_admin_only` — si lo pide con todas las letras («resumen del día», «resumen del mes», «resumen mensual», «resumen de ventas…») antes de abrir el canal, sin cupo ni DeepSeek; si el modelo igual pide esos tipos, también 403 (y a mitad del stream se corta). El enum del empleado no los trae. El celular lo muestra en palabras simples y no quita el asistente.
- **Períodos (hora de Lima):** día = el pedido (`hasta`, por defecto hoy) contra el día anterior. Mes = el mes del día pedido (`hasta` acepta `AAAA-MM-DD` o `AAAA-MM`); el mes en curso va del 1 a hoy y se compara con los mismos días del mes anterior (recortado al último día); un mes cerrado se compara completo. Fechas futuras quedan en hoy.
- **Qué se lee (solo lectura, sin migraciones):** lecturas canónicas `sales`, `sale-items`, `cash-movements` (parte crédito de las ventas mixtas), `credit-payments` (cobros: solo monto y fecha; un abono sin fecha conocida no cuenta) y la lista de anulaciones de siempre. Una lectura por colección para los dos períodos. Si `credit-payments` falla, los cobros salen «no disponible» (null); si falla `cash-movements` y hay ventas mixtas, contado/crédito salen «no disponible». La parte crédito usa `credit_cents` solo si es > 0; si no, el método (una venta «credito» con 0 sigue siendo crédito). Tope de lectura: la lectura canónica va por `sale_id`/`movement_id` (no por fecha) con tope de 5000 filas por colección; si `sales`, `sale-items`, `cash-movements` o `credit-payments` llegan al tope, el resumen lleva `truncado: true` (también al modelo) y la PRIMERA fila de la tabla avisa que pueden faltar ventas recientes. Leer solo las ventas del período necesitaría un filtro por fecha en `canonicalRead` (no existe hoy).
- **Pantalla del Admin:** tabla Detalle / actual / anterior / cambio %: ventas, n.º de ventas, ticket promedio, al contado, al crédito, cobros de créditos, por método, top 5 por monto y top 5 por unidades. Solo en esta tabla aparece el nombre del producto (junto a su código).
- **Al modelo:** `{ periodo, en_curso, actual, anterior, cambio_pct, top_por_monto, top_por_unidades }` con totales, conteos y productos SOLO como «producto #código» (un nombre de producto puede llevar el de un cliente, p. ej. «Encargo Sra. …»; mismo criterio que «Ventas bajo costo»). **Ningún dato de cliente** (ni nombre, DNI, teléfono, dirección ni código). Pasa por `redactText` con los «producto #código» protegidos (un código numérico largo no se tapa). La respuesta del chat también deja el código (vuelve al modelo como historial); el nombre solo se ve en la tabla. Prueba: `tests/asistente/assistant-resumenes.test.mjs`.

## Consultas nuevas: ganancia, productos sin ventas, deuda de un cliente, ventas por hora (rama feature/asist-consultas-nuevas)

Las cuatro son de solo lectura (sin migraciones ni cambios de esquema), filtran la fecha en la base con el rango de Lima (`created_at >= D 05:00Z AND < D+1 05:00Z`), en modo canónico ACTIVO leen por `canonical_sale_context` de la promoción activa, dejan fuera las ventas anuladas y llevan tope de filas (`NEW_QUERY_LIMITS`: 5000 filas de SQL, 50 filas de productos sin ventas). Todo lo que va al modelo pasa por `redactDeep` / `protectProductRefs` (productos solo como «producto #código»).

| `tipo` | Qué responde | Período por defecto | Quién |
|---|---|---|---|
| `ganancia` | ventas − costo de lo vendido (costo ACTUAL del producto), margen %, top por ganancia; las líneas sin costo van aparte («sin costo», nunca se adivina) | hoy | Admin, o un rol con `purchases.costs.view` (hoy solo el dueño) |
| `productos_sin_ventas` | productos del catálogo canónico actual sin ninguna venta en el período, de más stock a menos (hasta 50), con stock o «sin control» | últimos 30 días de Lima | Admin |
| `deuda_cliente` | saldo, créditos abiertos y cuál vence primero de UN cliente | — | Admin |
| `ventas_por_hora` | n.º de ventas y monto por hora de Lima (`strftime('%H', created_at, '-5 hours')`) | hoy | Admin |

- **Permiso de costos (`ganancia`):** `costQueryAllowed(role, tipo)` = `seesCosts(role)` para los tipos de `COST_QUERY_TYPES`. Se revisa en 4 lugares: el enum de la herramienta (solo aparece si el rol ve costos), `toProposal` (descarta con `forbidden_costs`), la guarda del texto en partes y la ruta (**403** `costs_admin_only`, «La ganancia usa los costos: es solo para el Admin.», sin leer la base ni hacer la 2.ª llamada al modelo), y otra vez antes de ejecutar la lectura (defensa). El empleado no tiene ninguno de los 4 tipos nuevos.
- **Privacidad (`deuda_cliente`):** solo por código (`cliente_id`, validado con `customerCode`; un nombre, DNI de 8 dígitos, teléfono o texto raro no sirve). Sin código responde filas vacías y `{falta: 'cliente_id'}` para que el modelo pida el código. Usa la MISMA lectura canónica de créditos que `deudas_clientes` (`reader.credits()`, sin SQL aparte ni cambios en esa lectura) y filtra por código; al modelo va solo código, saldo, n.º de créditos y el primer vencimiento — nunca nombre, DNI ni teléfono.
- **Palabras de fecha (hora de Lima):** `periodo` acepta `hoy`, `ayer`, `antier` (también «anteayer», «antes de ayer», «era antier»: hoy − 2), `mismo_dia_semana_pasada` («el mismo día de la otra semana», «hoy hace una semana»: el MISMO día de la semana, 7 días atrás; jueves 22 → jueves 15), `esta_semana` (de lunes a hoy), `semana_pasada`, `este_mes`, `mes_pasado`. `fecha: AAAA-MM-DD` pide un día exacto. Orden: `periodo` > `fecha` > `desde`/`hasta`; también vale en los resúmenes. La línea de calendario del prompt dice qué fecha es antier y el mismo día de la semana pasada, e indica que si la persona corrige la fecha («era antier») hay que volver a llamar `consultar` con el periodo nuevo, no repetir el anterior. (Prueba en vivo: «el mismo día de la otra semana» usaba el martes 13 en vez del jueves 15; «era antier» repetía ayer.)
- **Pruebas:** `tests/asistente/assistant-consultas-nuevas.test.mjs`.

## 22-10 (5): auditoría de privacidad (rama fix/asistente-privacidad)
- Clientes: antes de salir del aparato, los nombres y direcciones de clientes que el aparato ya conoce se cambian por «cliente #código» y «[dirección oculta]» (también una dirección genérica tipo «Av./Jr./Calle/Mz … número»). Un nombre suelto cuenta con 4+ letras si no es palabra de un producto; si lo comparten varios clientes se mandan hasta 3 códigos, si no «un cliente». Un código que el redactor taparía (8 dígitos) se manda como «un cliente». El historial guarda lo mismo. La respuesta pinta el nombre buscado en ESTE aparato.
- Estado de cuenta: la herramienta preparar_documento lleva `cliente_id` (código), nunca el nombre; el servidor solo acepta un código simple que el redactor no tape. El aparato busca al cliente por ese código (una tarjeta vieja con nombre se sigue buscando por nombre) y pone el nombre solo en la hoja y en la tarjeta.
- Monitor (Revisión del punto de venta): de un error de pantalla se guarda y se manda solo el TIPO (TypeError…), archivo y línea; nunca el mensaje. El envío se compacta (C.compactReview, hasta 64 KB: errores por veces y lo más reciente, lentos con cuelgues primero, contadores por veces, textos cortos) para no pasar el tope de 96 KB.
- Redactor (servidor y aparato): celular con +51/51 delante, teléfono fijo («01 234 5678», «(01) 234-5678», «044 123 456»), DNI con separadores («4567 8912», «45.678.912», «45 678 912») y correo disfrazado («(at)», «[at] … [dot]», «arroba … punto», «@» con espacios). Al Admin en pantalla el DNI se le sigue mostrando.
- Texto en partes (streaming): con una etiqueta de clave cerca, todo corte es candidato y solo se suelta cuando filtrar por partes da lo mismo que el texto entero (la palabra que sigue ya llegó entera y pasan las pruebas de continuación). Una etiqueta pegada a un dígito («4.321api key …») cuenta igual. El correo disfrazado espera su palabra «arroba»/«at».
- Pistas aprendidas de boletas: pasan por el mismo redactor en el aparato (al aprender y al enviar, también las guardadas antes) y en el servidor; si el redactor tapa algo, la pista no se manda.
- <datos_pos> y consultas: el nombre de producto pasa siempre por el redactor (Admin: redactModelOwner); cada texto del resumen de una consulta (p. ej. proveedor de compras recientes) pasa por redactText antes del modelo.
- Se quitó `assistantRole` (sin uso; el rol sale de assistantAccess).
- Decisiones del Admin, SIN cambios en esta rama: (4) las fotos (boleta, factura, producto) llegan completas al proveedor de IA; (5) el respaldo Routeway recibe el mismo contexto que el principal.

- Texto en partes (propiedad con las pruebas de #929/#930/#935/#938): «costo⏎la contraseña … S/ 1.80» se veía entero pero en partes salía «S/ [oculto]» (el corte antes del artículo «la» soltaba el tramo sin la palabra de precio). Ahora ese corte es candidato (priceKwNext con artículo); prueba 2d.
- Tabla de la consulta «deudas de clientes» (prueba en vivo): el servidor ya no manda nombres; filas y resumen al modelo con «cliente #código» (customerCode; si el id parece DNI/RUC/teléfono, «Cliente N»). En el aparato la celda es el mismo botón del chat («cliente #código (nombre de SU lista)»). Pie «Mostrando X de N»: N = clientes (antes salía el total en soles); en ventas no hay pie.
- Decisión del Admin (22-10): en modo Admin la tarjeta de la consulta y el texto muestran el NOMBRE real (buscado en la lista de ESTE aparato con el código); el empleado ve solo «cliente #código». Al modelo nunca va el nombre.
