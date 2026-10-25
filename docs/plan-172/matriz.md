# Plan maestro 172 — Matriz de estado real (primera entrega)

- Fecha: 23/10/2026 (hora de Lima)
- Rama auditada: `feature/v1.3-mobile-cloud`, HEAD `b0145097df67e200e9d49254b4756906d5fa424a` (merge #997)
- Fuente del catálogo: «Plan maestro de funciones · 172» (PDF del dueño), secciones 04–07.
- Este documento **no cambia código, candados ni datos**. No se publicó ni desplegó nada.

## Cómo se clasificó

| Estado | Criterio usado |
|---|---|
| EXISTE Y VERIFICADA | Código integrado en el flujo real, candado desbloqueado (o función núcleo sin candado) y pruebas automatizadas que **pasaron en este ciclo** sobre el HEAD indicado. No equivale a certificación E2E en producción. |
| EXISTE PARCIAL | Hay flujo usable, pero falta una capa de la aceptación del PDF (alcance, prueba, sincronización). |
| CÓDIGO SIN INTEGRAR | Hay código (en la rama o en un PR borrador abierto) pero el candado sigue en `true` o no está conectado. |
| NO EXISTE | Se buscó en `POS/js`, `POS/index.html` y `tools/cloudflare-lab/src` y no hay implementación. |
| BLOQUEADA | Solo tarjeta Próximamente con candado `true`, sin lógica. |
| FUERA DE ALCANCE | Excluida por el plan (CM-089, CM-090: banca). |
| REQUIERE VERIFICACIÓN | Hay indicios, pero sin prueba ni evidencia concluyente. |

Candados: única fuente `POS/js/config/pos-permissions.js` (`FEATURE_LOCKS`, 141 ids, 21 en `false`, id ausente = bloqueado). Registro: `POS/js/modules/proximamente-registry.js` (141 tarjetas).

Pruebas ejecutadas en este ciclo (Node 22, `node --test tests/cloud-sync/*.test.mjs`): **1604 pruebas, 1599 pasan, 3 fallan** por entorno, no por la función: `d1-backup-image-rows`, `d1-backup-workflow` y `migration-reconciliation` necesitan `esbuild`, que no está instalado en esta máquina. Las pruebas E2E/visuales (Playwright) **no** se corrieron en este ciclo.

El código del asistente del POS (`POS/js/modules/asistente/`, `tools/cloudflare-lab/src/pos-assistant*`) quedó fuera de la búsqueda de evidencia a pedido del dueño.

## Resumen por estado

| Estado | Cantidad |
|---|---|
| EXISTE Y VERIFICADA | 30 |
| EXISTE PARCIAL | 30 |
| CÓDIGO SIN INTEGRAR | 21 |
| NO EXISTE | 5 |
| BLOQUEADA | 78 |
| FUERA DE ALCANCE | 2 |
| REQUIERE VERIFICACIÓN | 6 |
| **Total** | **172** |

## Trabajo en curso y dependencias entre misiones

| Misión | Responsable | Depende de / choca con |
|---|---|---|
| CM-066 Unidades/factores | ASISTENTE 1 | Base de CM-013, CM-109 y CM-115. El modelo ya existe (`unidadCompra`, `factorCompra`, `unidCaja`, `precioCaja`, `purchase_factor`, `box_price_cents`): **reutilizarlo, no crear otro**. |
| CM-013 Venta por presentación | ASISTENTE 1 | Requiere CM-066 primero. Toca Venta, ticket (CM-034) y el TOTAL: cambio de UI mínimo detrás del candado `venta-por-presentacion` (true) y **OK del dueño** para Venta/TOTAL. El descuento de stock debe ser en unidad base para que CM-072 (lotes) y CM-082 (kardex) lo reciban bien. |
| CM-061 Precios masivos | ASISTENTE 2 (sobre #901) | #903 (CM-063 margen) está apilado sobre #901: integrar #901 antes. Debe decidir si también ajusta `precioCaja` (CM-013/066) y registrar cada cambio en el historial de precios (CM-162). No toca costo ni stock. |
| CM-062 Edición masiva | ASISTENTE 2 (#912) | Comparte selección/vista previa con CM-061; evitar dos motores de lote. Si edita `factorCompra`/`unidCaja`, choca con CM-066 (ASISTENTE 1): coordinar o excluir esos campos. |
| CM-073 Stock negativo | ASISTENTE 3 | Relacionado con PR #907 (recalcular stock). La regularización debe usar el ajuste auditable de CM-083 (`ajustes-inventario`) y aparecer en el kardex (CM-082). Con lotes (CM-072) activos, un negativo no tiene lote: definir regla con ASISTENTE 5. |
| CM-072 Lotes FEFO | ASISTENTE 5 | Código ya en la rama (`stock-lots*`, 6 pruebas pasan), candado `lotes-multiples-fefo`=true. Recibe salidas de CM-013 en unidad base y ajustes de CM-073. Alimenta CM-099 (por vencer). |
| CM-082 Kardex | ASISTENTE 5 | Debe conciliar ventas por presentación (CM-013), lotes (CM-072), ajustes (CM-073/083) y compras por empaque (CM-109). PR #919 (CM-085) también extiende `kardex.js`: posible conflicto. |

Orden sugerido para integrar sin conflictos: **CM-066 → CM-013** y **#901 (CM-061) → #903 (CM-063) → #912 (CM-062)**, en paralelo; luego **CM-072 → CM-073 → CM-082/085**.

## Matriz CM-001 … CM-172

| CM | Función (nombre original) | Oleada | Orden | Estado real | Candado | Evidencia (archivos) | PR abierto |
|---|---|---|---|---|---|---|---|
| CM-001 | Lista de ventas con filtros (doc, pago, estado, empleado, fechas) | 4 | P2 | EXISTE PARCIAL | — | Lista de ventas en Ventas (POS/index.html + legacy-inline); filtros por fecha/pago existen, filtro por empleado y estado sin prueba dedicada. | — |
| CM-002 | Exportar lista de ventas PDF/Excel por fechas | 4 | P2 | EXISTE Y VERIFICADA | `filtro-fechas-export` = false (desbloqueada) | Desbloqueada `filtro-fechas-export`; exportación en inline-05.js / a5-workbook.js. | — |
| CM-003 | Anular venta (con reposición stock/caja) | 0 | P0 | EXISTE Y VERIFICADA | — | `tools/cloudflare-lab/src/pos-sale-annul.js`, `POS/js/config/pos-annul-client.js`; test `pos-sale-annul.test.mjs`, `canonical-payment-annul.test.mjs` pasan. Falta E2E de reintento. | — |
| CM-004 | Conversión masiva de documento (a nota de venta/guía) | 4 | P3 | BLOQUEADA | `conversion-masiva-documentos` = true (bloqueada) | Candado `conversion-masiva-documentos`=true; solo registro Próximamente, sin código de función. | — |
| CM-005 | Nueva venta POS: búsqueda nombre/código, lector de barras | 0 | P0 | EXISTE PARCIAL | — | Búsqueda por nombre/código en Venta (legacy-inline); lector como teclado. Sin prueba E2E específica de lector. | — |
| CM-006 | Cuadrícula de productos por categoría con imagen/stock | 4 | P2 | EXISTE PARCIAL | — | Cuadrícula de productos en Venta (POS/index.html); sin prueba de categoría+imagen+stock. | — |
| CM-007 | Descuento por ítem y al carrito (% / monto) | 4 | P2 | EXISTE PARCIAL | — | `POS/js/modules/discount-sheet.js`; descuento por ítem/carrito sin prueba al céntimo dedicada. | — |
| CM-008 | Cambiar precio en venta con clave supervisor | 4 | P2 | REQUIERE VERIFICACIÓN | — | No se localizó cambio de precio en venta con supervisor; revisar permisos de empleado (`pos-employee-toggles.js`). | — |
| CM-009 | Borradores / ventas en espera | 4 | P2 | CÓDIGO SIN INTEGRAR | `ventas-espera` = true (bloqueada) | Candado `ventas-espera`=true; PR borrador #915. | #915 |
| CM-010 | Pago rápido | 0 | P0 | REQUIERE VERIFICACIÓN | — | Cobro en Venta existe (flujo canónico `canonical-sale-intent.js`); no hay "pago rápido" diferenciado. Idempotencia cubierta por `canonical-sale-intent.test.mjs`. | — |
| CM-011 | Venta a crédito (contado/crédito) | 0 | P0 | EXISTE Y VERIFICADA | — | Venta a crédito canónica: `canonical-sales-p0.test.mjs`, `canonical-credit-accounts-v2.test.mjs` pasan. | — |
| CM-012 | Selector de lista de precios en venta (mayorista) | 4 | P2 | NO EXISTE | — | No hay selector de lista mayorista en Venta; solo `precioCaja`. Depende de CM-065/CM-030. | — |
| CM-013 | Conversión de unidades / venta por presentación | 1 | P1 | BLOQUEADA | `venta-por-presentacion` = true (bloqueada) | Candado `venta-por-presentacion`=true. Modelo base existe (CM-066: `unidadCompra`, `factorCompra`, `precioCaja`, `unidCaja` en `inline-02.js`, `canonical-ui-adapter.js`, `a6-mapping.js` `purchase_factor`/`box_price_cents`), pero Venta no vende por presentación. **En curso: ASISTENTE 1 (parche).** | — |
| CM-014 | Venta pesable/granel con balanza | 1 | P3 | BLOQUEADA | `venta-granel` = true (bloqueada) | Candados `venta-granel` y `balanza`=true; sin código. | — |
| CM-015 | Cálculo IGV / ICBPER por línea | 0 | P0 | EXISTE PARCIAL | — | IGV en Venta/ajustes (`inline-17.js`, `inline-02.js`); ICBPER por línea sin prueba. Cambios aquí tocan el TOTAL: requieren OK del dueño. | #848 (resumen Total, toca TOTAL: requiere OK) |
| CM-016 | Multi-moneda en venta | 4 | P3 | BLOQUEADA | `multi-moneda` = true (bloqueada) | Candado `multi-moneda`=true; sin código. | — |
| CM-017 | Asignar vendedor/empleado a la venta | 4 | P2 | BLOQUEADA | `vendedor-en-venta` = true (bloqueada) | Candado `vendedor-en-venta`=true; la venta ya guarda el usuario de la sesión (`seller-labels.js`), sin selector de vendedor. | — |
| CM-018 | Atajos de teclado | 4 | P2 | CÓDIGO SIN INTEGRAR | `atajos-teclado` = true (bloqueada) | Candado `atajos-teclado`=true; PR borrador #902. | #902 |
| CM-019 | Comentario / tareas / consideraciones en la venta | 4 | P3 | BLOQUEADA | `comentarios-venta` = true (bloqueada) | Candado `comentarios-venta`=true; solo registro Próximamente, sin código de función. | — |
| CM-020 | Boleta / factura electrónica, envío a SUNAT (config-cuenta: sin configurar) | 4 | P3 | BLOQUEADA | `sunat-comprobantes` = true (bloqueada) | Candado `sunat-comprobantes`=true; sin integración fiscal (no simular). | — |
| CM-021 | Nota de venta (ticket interno) con serie/correlativo | 0 | P0 | EXISTE PARCIAL | — | Nota de venta: `pos-sale-notes.js` + `pos-sale-note-client.js`, test `pos-sale-notes.test.mjs` pasa; correlativo estable sin verificar entre aparatos. | — |
| CM-022 | Guías de remisión electrónicas (config-cuenta: OFF) | 4 | P3 | BLOQUEADA | `guias-remision` = true (bloqueada) | Candado `guias-remision`=true; solo registro Próximamente, sin código de función. | — |
| CM-023 | Cotizaciones (crear, listar, duplicar, convertir a venta, reservar stock) | 4 | P3 | BLOQUEADA | `cotizaciones` = true (bloqueada) | Candado `cotizaciones`=true; solo registro Próximamente, sin código de función. | — |
| CM-024 | Despacho de productos (estado de despacho) | 4 | P3 | BLOQUEADA | `despacho-productos` = true (bloqueada) | Candado `despacho-productos`=true; solo registro Próximamente, sin código de función. | — |
| CM-025 | Cuentas por cobrar con vencimiento | 3 | P2 | EXISTE PARCIAL | `creditos-vencimiento` = false (desbloqueada) | `creditos-vencimiento` desbloqueada; vencimiento en `client-credit-accounts-v2.js`; cobro múltiple aparte (CM-026 bloqueada). | — |
| CM-026 | Cobro múltiple / repartir abono entre deudas | 3 | P2 | BLOQUEADA | `reparto-abono-multiples-deudas` = true (bloqueada) | Candado `reparto-abono-multiples-deudas`=true; solo registro Próximamente, sin código de función. | — |
| CM-027 | Historial de pagos CxC | 0 | P0 | EXISTE Y VERIFICADA | — | `canonical-credit-payment-bridge.js`; tests `canonical-credit-payment-bridge`, `canonical-creditos-abonos`, `abono-p0-lost-response` pasan. | — |
| CM-028 | Enviar estado de cuenta/pago CxC por WhatsApp/correo, imprimir pago | 3 | P2 | CÓDIGO SIN INTEGRAR | — | Estado de cuenta en PR borrador #898; compartir por WhatsApp vía `share-receipt.js` solo comprobante. | #898 |
| CM-029 | Dashboard de ventas (ticket promedio, top productos/vendedores/clientes, categorías) | 4 | P2 | EXISTE PARCIAL | — | `POS/js/canon-desktop-dashboard.js` (Inicio); sin top vendedores/clientes verificado. | — |
| CM-030 | Listas de precios por cliente/empleado/tienda | 3 | P2 | BLOQUEADA | `listas-precios-asignacion-masiva` = true (bloqueada) | Candado `listas-precios-asignacion-masiva`=true; solo registro Próximamente, sin código de función. | — |
| CM-031 | Resumen diario de boletas y comunicación de baja | 4 | P3 | BLOQUEADA | `sunat-resumen-anulaciones` = true (bloqueada) | Candado `sunat-resumen-anulaciones`=true; solo registro Próximamente, sin código de función. | — |
| CM-032 | Compartir comprobante por WhatsApp | 4 | P2 | CÓDIGO SIN INTEGRAR | `compartir-pdf-whatsapp` = true (bloqueada) | `share-receipt.js`/`share-receipt-ui.js` existen; candado `compartir-pdf-whatsapp`=true; PDF en #913 sin publicar. | #913 (listo para publicar, no publicado) |
| CM-033 | Envío de comprobante por correo | 4 | P3 | BLOQUEADA | `comprobante-por-correo` = true (bloqueada) | Candado `comprobante-por-correo`=true; solo registro Próximamente, sin código de función. | — |
| CM-034 | Impresión de comprobante/ticket | 0 | P0 | EXISTE PARCIAL | — | Ticket en `POS/js/modules/ticket/*`; presentación por línea no existe (depende CM-013). | — |
| CM-035 | Ventas offline (con sincronización) | 0 | P0 | EXISTE PARCIAL | — | `canonical-sale-outbox.js`, `outbox.js`; tests outbox/no-drop/deferred-retry pasan. Mejoras pendientes en #891/#887/#888. | #891, #887, #888 (outbox/offline) |
| CM-036 | Pedidos desde POS (nuevo pedido, lista, estados) | 4 | P3 | BLOQUEADA | `pedidos-pos` = true (bloqueada) | Candado `pedidos-pos`=true; solo registro Próximamente, sin código de función. | — |
| CM-037 | Convertir pedido a venta/boleta | 4 | P3 | BLOQUEADA | `pedido-a-boleta` = true (bloqueada) | Candado `pedido-a-boleta`=true; solo registro Próximamente, sin código de función. | — |
| CM-038 | Nota de crédito / devolución parcial | 4 | P2 | BLOQUEADA | `nota-credito-devolucion-parcial` = true (bloqueada) | Candado `nota-credito-devolucion-parcial`=true; solo registro Próximamente, sin código de función. | — |
| CM-039 | Medios: Efectivo, transferencia, Yape, Plin | 0 | P0 | EXISTE Y VERIFICADA | — | Medios efectivo/Yape/Plin/transferencia registrados como externos en el flujo canónico; tests `payments-pr-a`, `canonical-sales-p0` pasan. | — |
| CM-040 | Yape/Plin con QR mostrado al cliente | 4 | P2 | CÓDIGO SIN INTEGRAR | `cobro-qr-yape-plin` = true (bloqueada) | Candado `cobro-qr-yape-plin`=true; PR borrador #906. | #906 |
| CM-041 | POS tarjeta Niubiz/Izipay/Vendemas con % comisión | 4 | P3 | BLOQUEADA | `tarjeta-recargo` = true (bloqueada) | Candado `tarjeta-recargo`=true; solo registro Próximamente, sin código de función. | — |
| CM-042 | Lista y alta/edición de clientes (DNI/RUC, teléfono) | 0 | P0 | EXISTE Y VERIFICADA | — | `canonical-customer-bridge.js`; tests `canonical-live-customers`, `canonical-customer-dedupe`, `canonical-customer-edit-ui` pasan. | — |
| CM-043 | Filtro por deuda | 3 | P2 | EXISTE Y VERIFICADA | `clientes-filtro-deuda` = false (desbloqueada) | Desbloqueada; `client-credit-accounts-v2.js`; test `clientes-filtro-deuda.test.mjs` pasa. | — |
| CM-044 | Grupos de clientes, CE/pasaporte | 3 | P3 | BLOQUEADA | `clientes-documentos-listas` = true (bloqueada) | Candado `clientes-documentos-listas`=true; solo registro Próximamente, sin código de función. | — |
| CM-045 | Importar clientes | 3 | P3 | CÓDIGO SIN INTEGRAR | `importar-clientes` = true (bloqueada) | Importación en Worker (`a6-customers.js`, `a6-customer-contacts.js`); UI en PR borrador #904; candado `importar-clientes`=true. | #904 |
| CM-046 | Límite de crédito por cliente | 0 | P0 | EXISTE Y VERIFICADA | — | `canonical-customer-credit-policy-bridge.js`; tests `canonical-customer-credit-policy(-turso)` pasan. | — |
| CM-047 | Máx. días de crédito por cliente | 3 | P2 | BLOQUEADA | `clientes-dias-credito` = true (bloqueada) | Candado `clientes-dias-credito`=true; solo registro Próximamente, sin código de función. | — |
| CM-048 | Descuento % por cliente | 3 | P3 | BLOQUEADA | `clientes-descuento` = true (bloqueada) | Candado `clientes-descuento`=true; solo registro Próximamente, sin código de función. | — |
| CM-049 | Frecuencia de compra | 3 | P2 | EXISTE Y VERIFICADA | `clientes-frecuencia` = false (desbloqueada) | Desbloqueada; `clientes-frecuencia.js`; test `clientes-frecuencia.test.mjs` pasa. | — |
| CM-050 | Direcciones múltiples | 3 | P3 | BLOQUEADA | `clientes-direcciones-multiples` = true (bloqueada) | Candado `clientes-direcciones-multiples`=true; solo registro Próximamente, sin código de función. | — |
| CM-051 | Ver ventas y productos del cliente / monto consumido / reporte de cliente | 3 | P2 | EXISTE Y VERIFICADA | `cliente-historial-compras` = false (desbloqueada) | Desbloqueada; `cliente-historial-compras.js`; tests `cliente-historial-compras(-filtros)` pasan. | — |
| CM-052 | Enviar mensaje WhatsApp al cliente | 3 | P2 | EXISTE PARCIAL | — | Enlace `wa.me` desde comprobante (`share-receipt.js`); sin mensaje libre al cliente. | — |
| CM-053 | Vendedor asignado por cliente | 3 | P3 | BLOQUEADA | `vendedor-por-cliente` = true (bloqueada) | Candado `vendedor-por-cliente`=true; solo registro Próximamente, sin código de función. | — |
| CM-054 | Consulta DNI/RUC automática (servicio) | 3 | P3 | CÓDIGO SIN INTEGRAR | `consulta-dni-ruc` = true (bloqueada) | `tools/cloudflare-lab/src/pos-dni-lookup.js` + `pos-dni-lookup-client.js`, test `pos-dni-lookup.test.mjs`; candado `consulta-dni-ruc`=true. | — |
| CM-055 | Puntos / loyalty (config-cuenta: OFF; reporte puntos canjeados) | 3 | P3 | BLOQUEADA | `clientes-puntos` = true (bloqueada) | Candado `clientes-puntos`=true; solo menciones en promoción canónica. | — |
| CM-056 | Lista y alta/edición de productos (código, nombre, categoría, costo, venta, stock) | 0 | P0 | EXISTE Y VERIFICADA | — | `canonical-product-bridge.js`; tests `canonical-product-update`, `canonical-live-products`, `costo-compra-ficha` pasan. | #886, #892 (costo empleado/«—») |
| CM-057 | Producto sin código / con código | 1 | P2 | EXISTE PARCIAL | — | Producto sin código permitido en ficha (`inline-02.js`); validación de código duplicado en CM-058. | — |
| CM-058 | Códigos alternos / otros códigos de barras | 1 | P2 | EXISTE Y VERIFICADA | — | `POS/js/inventory/codigos-duplicados.js`, `codigosAlternativos`; test `codigos-duplicados.test.mjs` pasa. | — |
| CM-059 | Stock mínimo | 0 | P0 | EXISTE PARCIAL | — | `stockMin` en ficha y avisos (`inline-02.js`, `sugerencia-compra.js`); sin prueba dedicada. | — |
| CM-060 | Activar/desactivar producto para la venta | 1 | P2 | BLOQUEADA | `producto-activo-venta` = true (bloqueada) | Candado `producto-activo-venta`=true; solo registro Próximamente, sin código de función. | — |
| CM-061 | Edición masiva de precios | 1 | P1 | CÓDIGO SIN INTEGRAR | `edicion-masiva-precios` = true (bloqueada) | Candado `edicion-masiva-precios`=true. Código en PR borrador #901. **En curso: ASISTENTE 2 (sobre #901/#903).** | #901 |
| CM-062 | Edición masiva de productos | 1 | P1 | CÓDIGO SIN INTEGRAR | `edicion-masiva-productos` = true (bloqueada) | Candado `edicion-masiva-productos`=true. Código en PR borrador #912. **En curso: ASISTENTE 2.** | #912 |
| CM-063 | Precio por utilidad / % margen sobre costo | 1 | P1 | CÓDIGO SIN INTEGRAR | `precio-por-margen` = true (bloqueada) | Candado `precio-por-margen`=true. PR borrador #903 apilado sobre #901. | #903 (sobre #901) |
| CM-064 | Precio mínimo y máximo de venta | 1 | P1 | BLOQUEADA | `precio-min-max` = true (bloqueada) | Candado `precio-min-max`=true; sin código. | — |
| CM-065 | Precios por mayor | 1 | P2 | EXISTE PARCIAL | — | Solo `precioCaja` (precio por caja); no hay precio mayorista por cantidad. | — |
| CM-066 | Unidades configurables (UND/KG pesable, colores) | 1 | P1 | EXISTE PARCIAL | — | Modelo de presentación existe: `unidad`, `unidadCompra`, `factorCompra`, `unidCaja`, `precioCaja` (`inline-02.js:666-690`, `inline-03.js:226-237`, `canonical-ui-adapter.js:76-77`, `a6-mapping.js:11-12`). Falta KG pesable y prueba de coherencia sin redondeo. **En curso: ASISTENTE 1 (junto con CM-013).** | — |
| CM-067 | Marcas | 1 | P3 | BLOQUEADA | `marcas-productos` = true (bloqueada) | Candado `marcas-productos`=true; solo registro Próximamente, sin código de función. | — |
| CM-068 | Subcategorías / características / atributos | 1 | P3 | BLOQUEADA | `subcategorias-atributos` = true (bloqueada) | Candado `subcategorias-atributos`=true; solo registro Próximamente, sin código de función. | — |
| CM-069 | Combos (producto compuesto) | 1 | P3 | EXISTE PARCIAL | `promociones-combos` = true (bloqueada) | `canonical-promotion` en Worker + test `canonical-promotion.test.mjs`; combos con componentes no existen; candado `promociones-combos`=true. | — |
| CM-070 | Producto manufacturado / receta de producción | 1 | P3 | BLOQUEADA | `produccion-recetas` = true (bloqueada) | Candado `produccion-recetas`=true; solo registro Próximamente, sin código de función. | — |
| CM-071 | Registro sanitario del producto | 1 | P3 | BLOQUEADA | `registro-sanitario` = true (bloqueada) | Candado `registro-sanitario`=true; solo registro Próximamente, sin código de función. | — |
| CM-072 | Lotes y fecha de vencimiento (config-cuenta: OFF) | 1 | P1 | CÓDIGO SIN INTEGRAR | `lotes-multiples-fefo` = true (bloqueada) | Candado `lotes-multiples-fefo`=true. Código: `POS/js/inventory/stock-lots.js`, `stock-lots-ui.js`, `tools/cloudflare-lab/src/stock-lots.js`; 6 tests `stock-lots-*` pasan. **En curso: ASISTENTE 5.** | — |
| CM-073 | Permitir stock negativo configurable | 1 | P1 | BLOQUEADA | `stock-negativo-configurable` = true (bloqueada) | Candado `stock-negativo-configurable`=true; sin módulo. PR #907 (recalcular stock con vista previa) es relacionado. **En curso: ASISTENTE 3.** | #907 (recalcular stock, relacionado) |
| CM-074 | Gestor de imágenes | 0 | P0 | EXISTE Y VERIFICADA | — | `image-sync.js`, `image-batch.js`, Worker `pos-product-images.js`; tests `pos-product-images*` pasan. | — |
| CM-075 | Productos maestros multi-comercio | 1 | P3 | NO EXISTE | — | No hay maestro multi-comercio; `reference-catalog` es catálogo de referencia local. | — |
| CM-076 | Transferencias entre tiendas / solicitar productos | 1 | P3 | BLOQUEADA | `transferencias-almacenes` = true (bloqueada) | Candado `transferencias-almacenes`=true; solo registro Próximamente, sin código de función. | — |
| CM-077 | Devoluciones entre tiendas | 1 | P3 | NO EXISTE | — | Sin multi-tienda; no existe. | — |
| CM-078 | Ubicación del producto | 1 | P3 | BLOQUEADA | `inventario-ubicacion-responsables` = true (bloqueada) | Candado `inventario-ubicacion-responsables`=true; solo registro Próximamente, sin código de función. | — |
| CM-079 | Etiquetas de precio | 1 | P2 | EXISTE Y VERIFICADA | `etiquetas-precios` = false (desbloqueada) | Desbloqueada; `etiquetas-precios.js`; e2e `etiquetas-precios.spec.ts` (no corrido en este ciclo). | — |
| CM-080 | Número de serie por producto | 1 | P3 | BLOQUEADA | `numero-serie-producto` = true (bloqueada) | Candado `numero-serie-producto`=true; solo registro Próximamente, sin código de función. | — |
| CM-081 | Inventario maestro / conteo físico con margen estimado | 1 | P2 | EXISTE PARCIAL | `conteo-fisico` = true (bloqueada) | Candado `conteo-fisico`=true; existe `POS/js/inventory/mobile-inventory.js` (conteo) sin integración de ajuste confirmado. | — |
| CM-082 | Kardex por producto / general | 1 | P1 | EXISTE Y VERIFICADA | `kardex` = false (desbloqueada) | Desbloqueada `kardex`; `POS/js/modules/kardex.js`; test `kardex.test.mjs` pasa. Falta conciliar con lotes y presentaciones. **En curso: ASISTENTE 5.** | — |
| CM-083 | Ingreso / egreso manual de inventario | 0 | P0 | EXISTE Y VERIFICADA | `ajustes-inventario` = false (desbloqueada) | Desbloqueada; `ajustes-inventario.js`; tests `ajustes-inventario`, `ajustes-inventario-canon-real`, `canonical-inventory-adjust` pasan. | — |
| CM-084 | Tipos de movimiento configurables y grupos | 1 | P3 | BLOQUEADA | `tipos-movimiento-inventario` = true (bloqueada) | Candado `tipos-movimiento-inventario`=true; solo registro Próximamente, sin código de función. | — |
| CM-085 | Movimientos kardex (lista de documentos) | 1 | P1 | CÓDIGO SIN INTEGRAR | `kardex` = false (desbloqueada) | Kardex por documento en PR borrador #919. | #919 |
| CM-086 | Inventario móvil | 1 | P2 | EXISTE PARCIAL | — | `POS/js/inventory/mobile-inventory.js` existe; sin prueba de no-movimiento accidental. | — |
| CM-087 | Movimientos de caja (ingresos/egresos) | 0 | P0 | EXISTE Y VERIFICADA | — | `caja-movimientos-historial.js`; test `caja-movimientos-historial.test.mjs` pasa. | — |
| CM-088 | Transferencia entre cajas | 5 | P3 | BLOQUEADA | `transferencias-cajas` = true (bloqueada) | Candado `transferencias-cajas`=true; solo registro Próximamente, sin código de función. | — |
| CM-089 | Cuentas bancarias, depósitos, movimientos de banco | X | NO HACER | FUERA DE ALCANCE | `bancos-depositos` = true (bloqueada) | Excluida por el plan (no banca). Candado `bancos-depositos`=true, no tocar. | — |
| CM-090 | Conciliación bancaria | X | NO HACER | FUERA DE ALCANCE | `conciliacion-bancaria` = true (bloqueada) | Excluida por el plan (no banca). Candado `conciliacion-bancaria`=true, no tocar. | — |
| CM-091 | Cajas múltiples (una por cajero) | 5 | P3 | EXISTE PARCIAL | `cajas-multiples` = true (bloqueada) | Sesión de caja por cajero (`cash-session-cashier.js`, test pasa); candado `cajas-multiples`=true. | — |
| CM-092 | Calendario de gastos (vencimientos, repetición, notificación) | 5 | P3 | BLOQUEADA | `calendario-gastos` = true (bloqueada) | Candado `calendario-gastos`=true; solo registro Próximamente, sin código de función. | — |
| CM-093 | Gastos con categoría | 5 | P2 | EXISTE Y VERIFICADA | `gastos` = false (desbloqueada) | Desbloqueada `gastos`; `canonical-expense-bridge.js`; tests `canonical-expenses-backend`, `canonical-expense-revisions` pasan. | — |
| CM-094 | Gasto con adjunto/foto | 5 | P3 | BLOQUEADA | `gasto-con-foto` = true (bloqueada) | Candado `gasto-con-foto`=true; solo registro Próximamente, sin código de función. | — |
| CM-095 | Listado de archivos exportados (historial de descargas) | 5 | P3 | CÓDIGO SIN INTEGRAR | `historial-exportaciones` = true (bloqueada) | Candado `historial-exportaciones`=true; PR borrador #917. | #917 |
| CM-096 | Reporte de ventas (17 tipos: detalle, por cliente, por artículo, por vendedor/marca) | 5 | P2 | EXISTE PARCIAL | `reportes` = false (desbloqueada) | Desbloqueada `reportes`; existen varios reportes, no los 17 tipos. | — |
| CM-097 | Venta por categoría | 5 | P3 | EXISTE PARCIAL | — | Por categoría en `rotacion-abc.js`; sin reporte de venta por categoría cuadrado contra total. | — |
| CM-098 | Reporte de rotación | 1 | P2 | EXISTE Y VERIFICADA | `rotacion-abc` = false (desbloqueada) | Desbloqueada; `rotacion-abc.js`; test `rotacion-abc.test.mjs` pasa. | — |
| CM-099 | Productos a vencer | 1 | P2 | EXISTE Y VERIFICADA | `reporte-productos-vencer` = false (desbloqueada) | Desbloqueada; `reporte-productos-vencer.js`; test pasa. Depende de lotes (CM-072) para 30/60/90 por lote. | — |
| CM-100 | Reporte stock mínimo | 1 | P2 | EXISTE PARCIAL | — | `sugerencia-compra.js`/`productos-sin-movimiento.js` usan stockMin; sin reporte de stock mínimo dedicado. | — |
| CM-101 | Costo general / costo por almacén | 1 | P1 | EXISTE Y VERIFICADA | `valorizacion-inventario` = false (desbloqueada) | Desbloqueada; `valorizacion-inventario.js`; test pasa (solo dueño). | — |
| CM-102 | Utilidad/beneficio por venta | 5 | P2 | EXISTE PARCIAL | — | Utilidad en reportes (`reportes`); costo a fecha de venta no verificado. | — |
| CM-103 | Arqueo / cierre de caja PDF | 5 | P2 | EXISTE Y VERIFICADA | `reporte-arqueo` = false (desbloqueada) | Desbloqueada; `reporte-arqueo.js`; test `reporte-arqueo.test.mjs` pasa. Filtro por cajero en #896. | #896 (filtro cajero) |
| CM-104 | Estado de cuenta de clientes | 3 | P2 | EXISTE PARCIAL | — | `clientes-reporte-deuda.js` (test pasa); estado de cuenta con movimientos en PR #898. | #898 |
| CM-105 | Reporte IGV / facturación totales | 5 | P3 | BLOQUEADA | `reporte-igv` = true (bloqueada) | Candado `reporte-igv`=true; solo registro Próximamente, sin código de función. | — |
| CM-106 | Catálogo de reportes asignables (internos/externos) | 5 | P3 | CÓDIGO SIN INTEGRAR | `catalogo-reportes` = true (bloqueada) | Candado `catalogo-reportes`=true; PR borrador #916. | #916 |
| CM-107 | Proveedores (alta, deuda, total compra) | 2 | P1 | BLOQUEADA | `proveedores` = true (bloqueada) | Candado `proveedores`=true; proveedor solo como texto en compras (`pos-purchases.js`). | — |
| CM-108 | Importar proveedores | 2 | P3 | BLOQUEADA | `importar-proveedores` = true (bloqueada) | Candado `importar-proveedores`=true; solo registro Próximamente, sin código de función. | — |
| CM-109 | Nueva compra con doc/serie, lector, gratis, actualiza PV y utilidad | 0 | P0 | EXISTE PARCIAL | — | `pos-purchases-client.js` + Worker `pos-purchases.js`, tests `pos-purchases`, `bot6-purchase-finish` pasan; compra por caja usa `factorCompra` pero sin prueba "1 caja de 12 = 12 UND". Depende de CM-066. | #900 (factura repetida) |
| CM-110 | Subir comprobante de compra | 2 | P1 | EXISTE PARCIAL | — | OCR: `POS/js/ocr/ocr-purchase-*.js`, tests en `tests/ocr`; revisión humana existe; integración completa sin E2E. | — |
| CM-111 | Historial de compras por producto | 2 | P1 | EXISTE Y VERIFICADA | `historial-compras-producto` = false (desbloqueada) | Desbloqueada; `inventory/historial-compras.js`; test pasa. | — |
| CM-112 | Cuentas por pagar / cuotas / pago múltiple | 2 | P1 | BLOQUEADA | `cuentas-pagar` = true (bloqueada) | Candado `cuentas-pagar`=true; solo registro Próximamente, sin código de función. | — |
| CM-113 | Órdenes de compra | 2 | P1 | BLOQUEADA | `ordenes-compra` = true (bloqueada) | Candado `ordenes-compra`=true; solo registro Próximamente, sin código de función. | — |
| CM-114 | Nota de crédito de compra | 2 | P3 | BLOQUEADA | `nota-credito-parcial-compras` = true (bloqueada) | Candado `nota-credito-parcial-compras`=true; solo registro Próximamente, sin código de función. | — |
| CM-115 | Compras sugeridas | 2 | P1 | EXISTE Y VERIFICADA | `sugerencia-compra` = false (desbloqueada) | Desbloqueada; `sugerencia-compra.js`; test pasa. Empaque/proveedor dependen de CM-066/CM-107. | — |
| CM-116 | Periodo contable / percepción | 2 | P3 | BLOQUEADA | `periodo-contable-percepcion` = true (bloqueada) | Candado `periodo-contable-percepcion`=true; solo registro Próximamente, sin código de función. | — |
| CM-117 | Catálogo/tienda online con secciones | 4 | P3 | BLOQUEADA | `catalogo-en-linea` = true (bloqueada) | Candado `catalogo-en-linea`=true; solo registro Próximamente, sin código de función. | — |
| CM-118 | Costo de envío por peso/ubigeo | 4 | P3 | NO EXISTE | — | Sin código. | — |
| CM-119 | Dashboard de pedidos online | 4 | P3 | BLOQUEADA | `bandeja-multicanal` = true (bloqueada) | Candado `bandeja-multicanal`=true; solo registro Próximamente, sin código de función. | — |
| CM-120 | Integración Shopify | 4 | P3 | BLOQUEADA | `shopify-woocommerce` = true (bloqueada) | Candado `shopify-woocommerce`=true; solo registro Próximamente, sin código de función. | — |
| CM-121 | Apertura / cierre de caja | 0 | P0 | EXISTE Y VERIFICADA | — | `canonical-cash-bridge.js`; tests `canonical-caja-p0`, `canonical-cash-close-*`, `cash-close-input-performance` pasan. | — |
| CM-122 | Historial de cierres | 0 | P0 | EXISTE Y VERIFICADA | — | `canonical-cash-history.js`, Worker `pos-cash-closes.js`; tests `canonical-cash-history`, `cash-closes-route` pasan. | — |
| CM-123 | Filtros de cierres por sucursal/moneda | 5 | P3 | BLOQUEADA | `cierres-sucursal-moneda` = true (bloqueada) | Candado `cierres-sucursal-moneda`=true; solo registro Próximamente, sin código de función. | — |
| CM-124 | Tipo de cierre | 5 | P3 | BLOQUEADA | `tipo-cierre` = true (bloqueada) | Candado `tipo-cierre`=true; solo registro Próximamente, sin código de función. | — |
| CM-125 | Ver caja desde POS (resumen) | 5 | P1 | EXISTE PARCIAL | — | Resumen de caja en pantalla Caja (`canonical-cash-bridge.js`); sin vista resumida desde Venta. | — |
| CM-126 | Pedidos delivery con repartidor asignado | 4 | P3 | BLOQUEADA | `delivery` = true (bloqueada) | Candado `delivery`=true; solo registro Próximamente, sin código de función. | — |
| CM-127 | Repartidores (alta, vehículo) | 4 | P3 | BLOQUEADA | `delivery` = true (bloqueada) | Candado `delivery`=true; sin código de repartidores. | — |
| CM-128 | Configuración de reparto (precio/km, comisión) | 4 | P3 | BLOQUEADA | `delivery` = true (bloqueada) | Candado `delivery`=true; sin código. | — |
| CM-129 | Promociones condición + acción (NxM, regalo, descuento por monto) | 4 | P3 | EXISTE PARCIAL | `promociones-combos` = true (bloqueada) | Promoción canónica en Worker (test `canonical-promotion` pasa); sin NxM/regalo en UI; candado `promociones-combos`=true. | — |
| CM-130 | Usuarios con roles | 0 | P0 | EXISTE Y VERIFICADA | — | `pos-roles.js` + `pos-roles-client.js`; tests `pos-roles`, `canon-role-permissions` pasan. | — |
| CM-131 | Permisos finos por usuario (editar precio, ocultar costo, egresos…) | 5 | P2 | EXISTE Y VERIFICADA | `permisos-por-empleado` = false (desbloqueada) | Desbloqueada `permisos-por-empleado`; `employee-perms-*`, `pos-employee-toggles.js`; tests pasan. Ajustes en #909. | #909 |
| CM-132 | Filtros de acceso por tienda/caja/lista | 5 | P3 | NO EXISTE | — | Sin multi-tienda; no existe. | — |
| CM-133 | Comisión por vendedor | 5 | P3 | BLOQUEADA | `metas-comisiones` = true (bloqueada) | Candado `metas-comisiones`=true; solo registro Próximamente, sin código de función. | — |
| CM-134 | Cambiar contraseña | 5 | P3 | BLOQUEADA | `cambiar-clave-usuarios` = true (bloqueada) | Candado `cambiar-clave-usuarios`=true; solo registro Próximamente, sin código de función. | — |
| CM-135 | Asistencia (marcar entrada/salida) | 5 | P3 | BLOQUEADA | `asistencia-empleados` = true (bloqueada) | Candado `asistencia-empleados`=true; solo registro Próximamente, sin código de función. | — |
| CM-136 | Desbloquear usuario | 5 | P3 | BLOQUEADA | `desbloquear-usuario` = true (bloqueada) | Candado `desbloquear-usuario`=true. | — |
| CM-137 | Datos de empresa / logo en ticket | 5 | P2 | REQUIERE VERIFICACIÓN | — | Logo/datos de empresa en ajustes y ticket (`POS/js/modules/ticket/*`); sin prueba. | — |
| CM-138 | Series y correlativos por punto de venta | 5 | P3 | BLOQUEADA | `serie-por-cajero` = true (bloqueada) | Candado `serie-por-cajero`=true. | — |
| CM-139 | Multi-RUC / sucursales / tiendas | 5 | P3 | BLOQUEADA | `multi-ruc` = true (bloqueada) | Candado `multi-ruc`=true; solo registro Próximamente, sin código de función. | — |
| CM-140 | Credenciales SUNAT / firma (config-cuenta: sin configurar) | 5 | P3 | BLOQUEADA | `firma-digital` = true (bloqueada) | Candado `firma-digital`=true; solo registro Próximamente, sin código de función. | — |
| CM-141 | Dispositivos conectados / cierre remoto de sesión | 0 | P0 | CÓDIGO SIN INTEGRAR | `sesion-unica-usuario` = true (bloqueada) | Candado `sesion-unica-usuario`=true; PR borrador #918. | #918 |
| CM-142 | Detracción / agente de retención | 5 | P3 | BLOQUEADA | `detraccion-retencion` = true (bloqueada) | Candado `detraccion-retencion`=true; solo registro Próximamente, sin código de función. | — |
| CM-143 | Cliente genérico por defecto | 5 | P2 | EXISTE Y VERIFICADA | — | Cliente genérico: `canonical-generic-sale.test.mjs` pasa. | — |
| CM-144 | Puntos de emisión múltiples por tienda | 5 | P3 | BLOQUEADA | `serie-por-cajero` = true (bloqueada) | Comparte candado `serie-por-cajero`=true. | — |
| CM-145 | Punto de equilibrio | 5 | P3 | CÓDIGO SIN INTEGRAR | `punto-equilibrio` = true (bloqueada) | Candado `punto-equilibrio`=true; PR borrador #910. | #910 |
| CM-146 | Cobro de servicios y recargas | 4 | P3 | BLOQUEADA | `servicios-recargas` = true (bloqueada) | Candado `servicios-recargas`=true; solo registro Próximamente, sin código de función. | — |
| CM-147 | Gaveta de dinero | 4 | P3 | BLOQUEADA | `gaveta-dinero` = true (bloqueada) | Candado `gaveta-dinero`=true; solo registro Próximamente, sin código de función. | — |
| CM-148 | Impresión directa XPrinter | 4 | P3 | BLOQUEADA | `impresion-directa-xprinter` = true (bloqueada) | Candado `impresion-directa-xprinter`=true. | — |
| CM-149 | CPE sin internet | 6 | P3 | BLOQUEADA | `cpe-sin-internet` = true (bloqueada) | Candado `cpe-sin-internet`=true; solo registro Próximamente, sin código de función. | — |
| CM-150 | App Android nativa | 4 | P3 | BLOQUEADA | `app-android-nativa` = true (bloqueada) | Candado `app-android-nativa`=true; PWA es la vía. | — |
| CM-151 | App almaceneros | 6 | P3 | BLOQUEADA | `app-almaceneros` = true (bloqueada) | Candado `app-almaceneros`=true; solo registro Próximamente, sin código de función. | — |
| CM-152 | Equipos POS compatibles | 4 | P3 | BLOQUEADA | `equipos-pos` = true (bloqueada) | Candado `equipos-pos`=true; solo registro Próximamente, sin código de función. | — |
| CM-153 | Crédito en cuotas | 3 | P3 | EXISTE PARCIAL | `credito-cuotas` = true (bloqueada) | Cuotas en Worker canónico (`a6-canonical.js`, `a6-commerce.js`); candado `credito-cuotas`=true. | — |
| CM-154 | Ventas de campo/distribuidor (rutas) | 4 | P3 | BLOQUEADA | `plan-distribuidor` = true (bloqueada) | Candado `plan-distribuidor`=true; solo registro Próximamente, sin código de función. | — |
| CM-155 | Inventario padre-hijo | 1 | P3 | BLOQUEADA | `inventario-padre-hijo` = true (bloqueada) | Candado `inventario-padre-hijo`=true; solo registro Próximamente, sin código de función. | — |
| CM-156 | Gasto a cuenta | 5 | P3 | BLOQUEADA | `gasto-a-cuenta` = true (bloqueada) | Candado `gasto-a-cuenta`=true; solo registro Próximamente, sin código de función. | — |
| CM-157 | Acreditar Yape/depósitos en el cierre | 0 | P0 | REQUIERE VERIFICACIÓN | — | Yape/Plin se registran como medio externo; no hay estado "acreditado" en cierre (y no debe afirmarse sin evidencia). | — |
| CM-158 | App de pedidos marca propia | 4 | P3 | BLOQUEADA | `app-pedidos-marca-propia` = true (bloqueada) | Candado `app-pedidos-marca-propia`=true; solo registro Próximamente, sin código de función. | — |
| CM-159 | Reporte de movimientos por medio de pago por turno | 0 | P0 | CÓDIGO SIN INTEGRAR | — | PR borrador #911; reporte por medio existe parcialmente en arqueo. | #911 |
| CM-160 | Clonar venta | 4 | P2 | CÓDIGO SIN INTEGRAR | `clonar-venta` = true (bloqueada) | Candado `clonar-venta`=true; PR borrador #905. | #905 |
| CM-161 | Imprimir comprobante en A4 | 4 | P2 | REQUIERE VERIFICACIÓN | — | Impresión del ticket existe; formato A4 no localizado. | — |
| CM-162 | Historial de cambios de precio por producto | 1 | P1 | EXISTE Y VERIFICADA | `historial-precios-producto` = false (desbloqueada) | Desbloqueada; `products/price-history.js`, `price-history-ui.js`; e2e `historial-precios.spec.ts`. Historial local, no sincronizado. | — |
| CM-163 | Cajas abiertas de todos los puntos de venta (cierre remoto) | 5 | P3 | BLOQUEADA | `cierre-remoto-cajas` = true (bloqueada) | Candado `cierre-remoto-cajas`=true; solo registro Próximamente, sin código de función. | — |
| CM-164 | Dashboard de tesorería (efectivo en cajas, saldo sin acreditar, capital acumulado) | 5 | P3 | CÓDIGO SIN INTEGRAR | `dashboard-tesoreria` = true (bloqueada) | Candado `dashboard-tesoreria`=true; PRs borrador #920 y #811 (duplicados entre sí). | #920, #811 |
| CM-165 | Orígenes / canales de venta configurables | 4 | P3 | BLOQUEADA | `canales-venta` = true (bloqueada) | Candado `canales-venta`=true; solo registro Próximamente, sin código de función. | — |
| CM-166 | Estado de recepción de compras / enviar al kardex | 2 | P1 | BLOQUEADA | `estado-recepcion-compras` = true (bloqueada) | Candado `estado-recepcion-compras`=true; solo registro Próximamente, sin código de función. | — |
| CM-167 | Adjuntar documentos al proveedor | 2 | P1 | BLOQUEADA | `adjuntos-proveedor` = true (bloqueada) | Candado `adjuntos-proveedor`=true; solo registro Próximamente, sin código de función. | — |
| CM-168 | Dashboard de compras con comparativos | 2 | P1 | CÓDIGO SIN INTEGRAR | `dashboard-compras` = true (bloqueada) | Candado `dashboard-compras`=true; PR borrador #914. | #914 |
| CM-169 | Comparación de ventas con periodo anterior (panel inicio) | 5 | P2 | REQUIERE VERIFICACIÓN | — | Panel de Inicio (`canon-desktop-dashboard.js`); comparación con periodo anterior no localizada. | — |
| CM-170 | Recargo al consumo (cargo por servicio) | 4 | P3 | BLOQUEADA | `recargo-servicio` = true (bloqueada) | Candado `recargo-servicio`=true; solo registro Próximamente, sin código de función. | — |
| CM-171 | Tipo de producto “Servicio” (sin stock) | 1 | P2 | EXISTE PARCIAL | `producto-servicio` = true (bloqueada) | `controlInventario` (sin control de stock) en ficha (`inline-03.js:226`); candado `producto-servicio`=true. | — |
| CM-172 | Generar catálogo desde el POS | 4 | P2 | CÓDIGO SIN INTEGRAR | `catalogo-desde-pos` = true (bloqueada) | Candado `catalogo-desde-pos`=true; PRs borrador #908 y #810 (duplicados). | #908, #810 |
