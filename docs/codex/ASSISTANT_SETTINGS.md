# Configuración desde el asistente

Base: CANON `873f5fd6`. Solo Admin; usa el permiso existente `settings.set`.

## Alcance

El chat conoce los apartados reales de Configuración y diez ajustes habilitados:
modo, tema, tamaño, lector activo/sonido/intervalo/largo mínimo, stock mínimo por
defecto, avisos de stock e impresión automática. Los primeros siete son de este
aparato; los tres últimos se guardan para todos los aparatos. Cambiar el mínimo
predeterminado no cambia los mínimos de los productos existentes.

El modelo propone `configurar_app`; una tarjeta firmada muestra valor anterior,
nuevo y alcance. Solo el botón Confirmar ejecuta el cambio. Los datos actuales
son una lista blanca de valores primitivos, sin PIN ni datos del negocio. El
catálogo se incorpora a las consultas sobre configuración, sin añadirlo a las
consultas normales de ventas o inventario.

No permite rediseñar pantallas, ejecutar código, cambiar claves arbitrarias,
PIN, reseteos, permisos de seguridad, reglas de crédito ni impuestos. Esos
apartados siguen en su pantalla normal. Los niveles del asistente conservan
su herramienta existente independiente.

## Persistencia y concurrencia

`config-v9.js` expone lectura y aplicación acotadas y reutiliza las funciones de
apariencia y lector existentes. Espera el guardado/rollback del lector.

`config-g.js:setAssistantFlag` lee el grupo `pos.flags` del servidor, valida el
valor esperado y usa `expected_revision` al guardar solo ese grupo con una
bandera modificada. Preserva el resto de sus valores remotos; rechaza cambios
locales pendientes y conflictos. No anuncia éxito cuando falla el guardado. Un
reintento que encuentra el valor ya aplicado no repite el POST. No modifica
ventas, stock físico, clientes, caja, outbox ni esquema de base de datos.

## Datos del negocio y del ticket (destino servidor, #967)

La misma herramienta `configurar_app` y la misma tarjeta `configuracion` cubren
también estas claves, que se guardan en el servidor para todos los aparatos:
`negocio_nombre`, `negocio_ruc`, `negocio_direccion`, `ticket_pie`,
`ticket_ancho`, `ticket_logo`, `ticket_igv`, `ticket_forma_pago` y `avisos`
(`pos.flags.alertsEnabled`, «Avisos y confirmaciones»; distinta de
`stock_avisos`). Lista cerrada en `pos-assistant-config-route.js`.

- La tarjeta lleva `destino: 'servidor'` además de `ajuste`, `nombre`,
  `alcance` (`todos los aparatos`), `antes` y `valor`. Sin `destino` la tarjeta
  es del aparato, como arriba. Un ajuste por tarjeta.
- El `antes` lo lee el servidor de `pos_settings`; los valores actuales
  (nombre, RUC, dirección, pie) no se envían al modelo. El catálogo de claves
  solo viaja en pedidos de configuración (mismo `settingsRequested`).
- Al confirmar, `/auth/assistant/confirm` valida el token firmado y guarda
  solo ese campo con `UPDATE ... WHERE revision = ?` (nunca inserta). Si otro
  aparato guardó antes, o el valor ya no es el `antes` de la tarjeta, responde
  409 `revision_conflict`. Escribe una fila de bitácora por cambio
  (`asistente.config`, `config:<clave>`, aparato y rol), sin valores.
- Permisos (servidor): estas claves, Admin y nivel 3 con «costos y cambios»;
  las claves del aparato (apariencia, lector, stock mínimo, avisos de stock,
  impresión automática), solo Admin. El nivel 3 con «costos y cambios» recibe
  `configurar_app` limitada a estas claves. Niveles 1, 2, 3 sin el permiso y
  roles desconocidos: 403 sin leer la base, en chat y en confirm.
- Pruebas: `tests/asistente/assistant-proponer-configuracion.test.mjs`.

### RUC tapado o vacío (decisión de alfa)
- El filtro de DNI/RUC no se afloja. Si `configurar_app` llega con `negocio_ruc` tapado (`10*******12`, `[RUC oculto]`, `XXXX…`) o vacío, la tarjeta sale igual, sin el número:
  `{type:'configuracion', destino:'servidor', ajuste:'negocio_ruc', nombre:'RUC', alcance:'todos los aparatos', antes:<RUC actual>, valor:'', completar:['valor'], confirm_token}`.
- Usa el mismo mecanismo que la tarjeta de compra (`completar` → `needFields`/`fillValues`). El celular pide el RUC y manda `POST /auth/assistant/confirm {token, proposal, manual:{valor:'…'}}`. `manual` va fuera de la propuesta firmada y no entra en el hash, así que el número nunca pasa por el modelo.
- En el servidor (`fillCheck` + `configFillNames`/`configFillValue`):
  - Solo se puede completar `valor` y solo en esa tarjeta. Cualquier otra clave, o `manual` en otra tarjeta, da 400 `manual_not_allowed`.
  - Si falta o viene tapado: 422 `fields_required`, `fields:['valor']`.
  - Si no son 11 dígitos: 400 `config_invalid` con «El RUC debe tener 11 dígitos.».
  - Si el prefijo no es 10/15/16/17/20 (validador `ruc` que ya existía): 400 `config_invalid` con «El RUC debe empezar con 10, 15, 16, 17 o 20.».
  - Espacios, puntos y guiones se quitan.
  - Lo demás no cambia: nada se guarda en un 400/422, `revision_conflict` 409, solo UPDATE, una fila de bitácora sin el número y los mismos permisos.
- Un RUC mal escrito que no está tapado (`123`) se sigue descartando con `bad_setting`. Las otras claves no usan `completar`.

## Verificación

- `node --test tests/asistente/assistant-settings.test.mjs`
- Suite del asistente y regresiones de configuración canónica.
- CI crítico, E2E y validación de tarjeta en navegador sobre versión publicada.

Prueba manual sin operaciones comerciales: preguntar qué puede configurar,
pedir modo noche o tamaño grande, revisar la tarjeta y su alcance; cancelar
no cambia nada. La aplicación y persistencia se prueban con datos sintéticos.
