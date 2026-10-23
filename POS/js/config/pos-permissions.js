/* Shared browser and Worker role policy. Unknown identities always fail closed. */
(function (root) {
  'use strict';
  var owner = ['owner'], both = ['owner', 'empleado'];
  var SCREENS = {};
  ['pageMenu', 'pagePOS', 'pageInventario', 'pageVentas', 'pageClientes', 'pageCaja'].forEach(function (id) { SCREENS[id] = both; });
  ['pageGastos', 'pageConfig', 'pageProximamente', 'pageValorizacion', 'pageRotacionAbc', 'pageClientesFrecuencia', 'pageReporteProductosVencer', 'pageKardex', 'pageVentasStock', 'pageReporteArqueo', 'pageHistorialCompras', 'pageClienteHistorial', 'pageEtiquetasPrecios', 'pageProductosSinMovimiento', 'pageSugerenciaCompra', 'pageAjustesInventario', 'pageEdicionPrecios', 'ventas:reportes'].forEach(function (id) { SCREENS[id] = owner; });
  var ACTIONS = {};
  ['cash.closes.view', 'purchases.costs.view', 'expense.create', 'expense.update', 'expense.void', 'settings.set', 'product-images.write', 'reports.view', 'devices.manage', 'owner-pin.set', 'pairing-code.create', 'reviews.resolve'].forEach(function (id) { ACTIONS[id] = owner; });
  ['cash.expense', 'sync.write'].forEach(function (id) { ACTIONS[id] = both; });
  // Asistente (prototipo): SOLO dueño (modo admin). No vende ni llena carritos.
  ['assistant.chat', 'assistant.query', 'assistant.document', 'assistant.price.propose', 'assistant.purchase.propose', 'assistant.stock.propose', 'assistant.product.propose', 'assistant.levels.set'].forEach(function (id) { ACTIONS[id] = owner; });
  SCREENS['pageReporteDeuda'] = owner;
  SCREENS['pageCodigosDuplicados'] = owner;
  var SYNC_ENTITIES = {};
  ['products','sales','sale_items','customers','credits','credit_payments','cash_closures','inventory_movements'].forEach(function (id) { SYNC_ENTITIES[id] = 'sync.write'; });
  SYNC_ENTITIES.expenses = 'cash.expense';
  SYNC_ENTITIES.cash_movements = 'cash.expense';
  var API_ROUTES = [
    { path: '/features/:id', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], roles: both },
    { path: '/auth/reviews', methods: ['GET'], roles: both },
    { path: '/auth/reviews/resolve', methods: ['POST'], roles: owner, action: 'reviews.resolve' },
    { path: '/auth/me', methods: ['GET'], roles: both },
    { path: '/auth/cash-closes', methods: ['GET'], roles: owner, action: 'cash.closes.view' },
    { path: '/auth/owner-pin', methods: ['POST'], roles: owner, action: 'owner-pin.set' },
    { path: '/auth/owner-approval', methods: ['POST'], roles: both },
    { path: '/auth/pairing-code', methods: ['POST'], roles: owner, action: 'pairing-code.create' },
    { path: '/auth/pair', methods: ['POST'], roles: both },
    { path: '/auth/devices', methods: ['POST'], roles: owner, action: 'devices.manage' },
    { path: '/auth/devices/revoke', methods: ['POST'], roles: owner, action: 'devices.manage' },
    { path: '/settings', methods: ['GET'], roles: both },
    { path: '/settings', methods: ['POST'], roles: owner, action: 'settings.set' },
    { path: '/auth/product-images', methods: ['GET'], roles: both },
    { path: '/auth/product-images', methods: ['POST', 'DELETE'], roles: owner, action: 'product-images.write' },
    { path: '/auth/product-images/item', methods: ['GET'], roles: both },
    { path: '/commands/expense.create', methods: ['POST'], roles: both, action: 'cash.expense' }
  ];
  ['sale.create','cash.open','cash.close','payment.create','payment.batch','credit-account.create','product.create','product.update','customer.create','customer.contact.set','customer.credit-policy.set','inventory.adjust','adjustment.create','compensation.create','sale.annul'].forEach(function (name) { API_ROUTES.push({ path: '/commands/' + name, methods: ['POST'], roles: both }); });
  API_ROUTES.push({ path: '/commands/import.stage', methods: ['POST'], roles: owner });
  API_ROUTES.push({ path: '/auth/dni-lookup', methods: ['POST'], roles: both });
  // Asistente (prototipo): solo dueño; el Worker responde 403 admin_only a cualquier otro rol.
  // Asistente: el dueño siempre; un aparato empleado solo si el dueño le dio un nivel (el servidor lo revisa en cada pedido).
  API_ROUTES.push({ path: '/auth/assistant/chat', methods: ['POST'], roles: ['owner', 'empleado'] });
  API_ROUTES.push({ path: '/auth/assistant/confirm', methods: ['POST'], roles: ['owner', 'empleado'] });
  API_ROUTES.push({ path: '/auth/assistant/employee-access', methods: ['GET', 'POST'], roles: owner });
  API_ROUTES.push({ path: '/auth/assistant/audit', methods: ['GET'], roles: owner });
  // Niveles 0..3 del asistente por persona: solo Admin, sin PIN (el Worker responde 403 admin_only a cualquier otro).
  API_ROUTES.push({ path: '/auth/assistant/levels', methods: ['GET', 'POST'], roles: owner });
  // Proveedor del asistente: solo dueño (el Worker responde 403 admin_only a cualquier otro).
  API_ROUTES.push({ path: '/auth/assistant/provider', methods: ['GET'], roles: owner });
  ['test', 'select'].forEach(function (k) { API_ROUTES.push({ path: '/auth/assistant/provider/' + k, methods: ['POST'], roles: owner }); });
  // Registro del aparato dueño (detrás de ASSISTANT_OWNER_BOOTSTRAP=1). register: aparato sin fila (cuenta como dueño); el servidor rechaza empleados (409).
  API_ROUTES.push({ path: '/auth/assistant/owner-device', methods: ['GET'], roles: owner });
  ['register', 'approve', 'revoke'].forEach(function (k) { API_ROUTES.push({ path: '/auth/assistant/owner-device/' + k, methods: ['POST'], roles: owner }); });
  API_ROUTES.push({ path: '/commands/sale.annul', methods: ['GET'], roles: both });
  ['/auth/session','/auth/record-meta','/auth/sale-annulments'].forEach(function (path) { API_ROUTES.push({ path: path, methods: ['GET'], roles: both }); });
  ['/auth/sale-notes','/auth/purchases'].forEach(function (path) { API_ROUTES.push({ path: path, methods: ['GET','POST'], roles: both }); });
  API_ROUTES.push({ path: '/auth/purchases/close-partial', methods: ['POST'], roles: both });
  API_ROUTES.push({ path: '/sync/operations', methods: ['POST'], roles: both });
  API_ROUTES.push({ path: '/sync/operations/:id', methods: ['GET'], roles: both });
  API_ROUTES.push({ path: '/imports/:id', methods: ['GET'], roles: both });
  ['status','sales','inventory-movements','sales/:id/items'].forEach(function (name) { API_ROUTES.push({ path: '/read/' + name, methods: ['GET'], roles: owner, action: 'reports.view' }); });
  ['status','snapshot','products','customers','credits','credit-payments','credit-accounts','sales','sale-items','inventory-movements','cash-movements','cash-sessions','financial-events'].forEach(function (name) { API_ROUTES.push({ path: '/read/canonical/' + name, methods: ['GET'], roles: both }); });
  ['expense.update', 'expense.void'].forEach(function (action) { API_ROUTES.push({ path: '/commands/' + action, methods: ['POST'], roles: owner, action: action }); });
  API_ROUTES.push({ path: '/read/canonical/expenses', methods: ['GET'], roles: owner, action: 'reports.view' });
  var PRODUCT_IMAGE_PATHS = Array.from(new Set(API_ROUTES.filter(function (r) { return r.path.indexOf('/auth/product-images') === 0; }).map(function (r) { return r.path; })));
  var ROLE_PATHS = ['/auth/reviews','/auth/reviews/resolve','/auth/me','/auth/owner-pin','/auth/owner-approval','/auth/pairing-code','/auth/pair','/auth/devices','/auth/devices/revoke','/settings'];
  function allowed(role, roles) { return (role === 'owner' || role === 'empleado') && roles.indexOf(role) >= 0; }
  function routeRoles(path, method) {
    var feature = /^\/features\/([a-z0-9-]+)(\/|$)/.exec(path); if (feature) return FEATURE_ROLES[feature[1]] || (featureLocked(feature[1]) ? both : owner);
    if (/^\/read\/sales\/[^/]+\/items$/.test(path)) path = '/read/sales/:id/items';
    if (/^\/sync\/operations\/[^/]+$/.test(path)) path = '/sync/operations/:id';
    if (/^\/imports\/[^/]+$/.test(path)) path = '/imports/:id';
    var route = API_ROUTES.find(function (r) { return r.path === path && (!r.methods || r.methods.indexOf(String(method || 'GET').toUpperCase()) >= 0); });
    return route ? route.roles : owner;
  }
  // Bloqueo de funciones Próximamente por id estable (única fuente, cliente y servidor).
  // true = bloqueada (sin rutas de escritura). Desbloquear = cambiar UNA línea a false.
  // Id ausente = bloqueada (default-deny).
  var FEATURE_ROLES = { 'asistencia-empleados': owner, 'asistente-virtual': owner, 'valorizacion-inventario': owner, 'rotacion-abc': owner, 'clientes-frecuencia': owner, 'kardex': owner, 'reporte-ventas-stock': owner, 'reporte-arqueo': owner, 'historial-compras-producto': owner, 'lotes-multiples-fefo': owner, 'stock-negativo-configurable': owner, 'app-pedidos-marca-propia': owner, 'cambiar-clave-usuarios': owner, 'conversion-masiva-documentos': owner, 'vendedor-en-venta': owner, 'comentarios-venta': owner, 'despacho-productos': owner, 'cliente-historial-compras': owner, 'vendedor-por-cliente': owner, 'consulta-dni-ruc': owner, 'edicion-masiva-productos': owner, 'marcas-productos': owner, 'subcategorias-atributos': owner, 'produccion-recetas': owner, 'registro-sanitario': owner, 'numero-serie-producto': owner, 'tipos-movimiento-inventario': owner, 'conciliacion-bancaria': owner, 'historial-exportaciones': owner, 'catalogo-reportes': owner, 'importar-proveedores': owner, 'periodo-contable-percepcion': owner, 'desbloquear-usuario': owner, 'detraccion-retencion': owner, 'historial-precios-producto': owner, 'canales-venta': owner, 'estado-recepcion-compras': owner, 'adjuntos-proveedor': owner, 'dashboard-compras': owner, 'recargo-servicio': owner, 'producto-activo-venta': owner, 'precio-min-max': owner, 'cajas-multiples': owner, 'reporte-productos-vencer': owner, 'cierre-remoto-cajas': owner, 'dashboard-tesoreria': owner, 'producto-servicio': owner, 'catalogo-desde-pos': owner, 'etiquetas-precios': owner, 'productos-sin-movimiento': owner, 'sugerencia-compra': owner, 'ajustes-inventario': owner, 'edicion-masiva-precios': owner, 'precio-por-margen': owner };
  var FEATURE_LOCKS = {
    'venta-exitosa-comprobante': false,
    'credito-cuotas': false,
    'reparto-abono-multiples-deudas': false,
    'lotes-multiples-fefo': false,
    'stock-negativo-configurable': false,
    'app-pedidos-marca-propia': false,
    'cambiar-clave-usuarios': false,
    'conversion-masiva-documentos': false,
    'vendedor-en-venta': false,
    'comentarios-venta': false,
    'despacho-productos': false,
    'cliente-historial-compras': false,
    'vendedor-por-cliente': false,
    'consulta-dni-ruc': false,
    'edicion-masiva-productos': false,
    'marcas-productos': false,
    'subcategorias-atributos': false,
    'produccion-recetas': false,
    'registro-sanitario': false,
    'numero-serie-producto': false,
    'tipos-movimiento-inventario': false,
    'conciliacion-bancaria': false,
    'historial-exportaciones': false,
    'catalogo-reportes': false,
    'importar-proveedores': false,
    'periodo-contable-percepcion': false,
    'desbloquear-usuario': false,
    'detraccion-retencion': false,
    'historial-precios-producto': false,
    'canales-venta': false,
    'estado-recepcion-compras': false,
    'adjuntos-proveedor': false,
    'dashboard-compras': false,
    'recargo-servicio': false,
    'producto-activo-venta': false,
    'precio-min-max': false,
    'cajas-multiples': false,
    'reporte-productos-vencer': false,
    'cierre-remoto-cajas': false,
    'dashboard-tesoreria': false,
    'producto-servicio': false,
    'catalogo-desde-pos': false,

    'clonar-venta': false,
    'nota-credito-parcial-compras': false,
    'clientes-filtro-deuda': false,
    'clientes-deudores-caja': false,
    'clientes-dias-credito': false,
    'nota-credito-devolucion-parcial': false,
    'ordenes-compra': false,
    'sesion-unica-usuario': false,
    'firma-digital': false,
    'cierres-sucursal-moneda': false,
    'impresion-directa-xprinter': false,
    'clientes-direcciones-multiples': false,
    'clientes-descuento': false,
    'clientes-frecuencia': false,
    'listas-precios-asignacion-masiva': false,
    'historial-compras-producto': false,
    'inventario-padre-hijo': false,
    'inventario-ubicacion-responsables': false,
    'creditos-vencimiento': false,
    'gastos': false,
    'reportes': false,
    'cotizaciones': false,
    'cuentas-pagar': false,
    'compartir-pdf-whatsapp': false,
    'filtro-fechas-export': false,
    'pedidos-pos': false,
    'pedido-a-boleta': false,
    'venta-por-presentacion': true,
    'app-android-nativa': false,
    'valorizacion-inventario': false,
    'reporte-arqueo': false,
    'cpe-sin-internet': false,
    'venta-granel': false,
    'gaveta-dinero': false,
    'tipos-gasto': false,
    'gasto-con-foto': false,
    'gasto-a-cuenta': false,
    'comprobante-por-correo': false,
    'reporte-ventas-stock': false,
    'app-almaceneros': false,
    'equipos-pos': false,
    'asistente-virtual': false,
    'tipo-cierre': false,
    'shopify-woocommerce': false,
    'bandeja-multicanal': false,
    'plan-distribuidor': false,
    'clientes-puntos': false,
    'conteo-fisico': false,
    'sucursales': false,
    'recetas-psicotropicos': false,
    'sunat-comprobantes': false,
    'etiquetas-precios': false,
    'productos-sin-movimiento': false,
    'sugerencia-compra': false,
    'ajustes-inventario': false,
    'permisos-por-empleado': false,
    'promociones-combos': false,
    'delivery': false,
    'catalogo-en-linea': false,
    'recordatorios-recompra': false,
    'kardex': false,
    'metas-comisiones': false,
    'notificaciones-dueno': false,
    'offline-mejorado': false,
    'venta-voz': false,
    'cobro-qr-yape-plin': false,
    'cierre-billetes': false,
    'asistencia-empleados': false,
    'turnos-personal': false,
    'proveedores': false,
    'sustitutos-genericos': false,
    'interacciones-medicamentos': false,
    'historial-clinico': false,
    'encuestas': false,
    'apartados': false,
    'tarjetas-regalo': false,
    'auditoria-cambios': false,
    'panel-tv-pedidos': false,
    'multi-moneda': false,
    'balanza': false,
    'ventas-espera': false,
    'guias-remision': false,
    'sunat-resumen-anulaciones': false,
    'clientes-documentos-listas': false,
    'importar-clientes': false,
    'precio-por-margen': false,
    'edicion-masiva-precios': false,
    'transferencias-almacenes': false,
    'transferencias-cajas': false,
    'bancos-depositos': false,
    'punto-equilibrio': false,
    'tarjeta-recargo': false,
    'serie-por-cajero': false,
    'atajos-teclado': false,
    'servicios-recargas': false,
    'reporte-igv': false,
    'rotacion-abc': false,
    'calendario-gastos': false,
    'multi-ruc': false
  };
  function featureLocked(id) { return !Object.prototype.hasOwnProperty.call(FEATURE_LOCKS, id) || FEATURE_LOCKS[id] !== false; }
  function freeze(value) {
    Object.keys(value).forEach(function (key) { if (value[key] && typeof value[key] === 'object' && !Object.isFrozen(value[key])) freeze(value[key]); });
    return Object.freeze(value);
  }
  root.NA_PERMISSIONS = freeze({ SCREENS: SCREENS, ACTIONS: ACTIONS, SYNC_ENTITIES: SYNC_ENTITIES, API_ROUTES: API_ROUTES,
    ROLE_PATHS: ROLE_PATHS, PRODUCT_IMAGE_PATHS: PRODUCT_IMAGE_PATHS,
    PROXY_PREFIXES: ['/health', '/auth/*', '/read/*', '/features/*', '/commands/*', '/imports/*', '/sync/operations*', '/settings'],
    canAccessScreen: function (role, id) { return allowed(role, Object.prototype.hasOwnProperty.call(SCREENS, id) ? SCREENS[id] : owner); },
    canDo: function (role, action) { return allowed(role, Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : owner); },
    routeRoles: routeRoles, FEATURE_ROLES: FEATURE_ROLES, FEATURE_LOCKS: FEATURE_LOCKS, featureLocked: featureLocked
  });
})(globalThis);
