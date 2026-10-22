/* Permisos por empleado: lista CERRADA de funciones que el dueño puede abrir al empleado.
   Fuente única para la pantalla (Configuración › Usuarios y PIN) y para el Worker.
   Lo que muestra costos, márgenes, cierres, tesorería, ajustes, proveedores, aparatos o PIN
   NO está aquí y nunca se puede abrir. Sin la fila del servidor, todo queda como hoy (apagado). */
(function (root) {
  'use strict';
  var GROUPS = [
    { title: 'Ventas', items: [
      ['ventas-espera', 'Dejar ventas en espera'],
      ['clonar-venta', 'Clonar una venta'],
      ['atajos-teclado', 'Usar atajos de teclado'],
      ['cobro-qr-yape-plin', 'Mostrar el QR de Yape y Plin'],
      ['compartir-pdf-whatsapp', 'Enviar el PDF por WhatsApp']] },
    { title: 'Clientes', items: [
      ['cliente-historial-compras', 'Ver el historial de compras del cliente']] },
    { title: 'Productos', items: [
      ['etiquetas-precios', 'Imprimir etiquetas de precios'],
      ['catalogo-desde-pos', 'Imprimir el catálogo'],
      ['reporte-productos-vencer', 'Ver productos por vencer'],
      ['productos-sin-movimiento', 'Ver productos sin movimiento']] }
  ];
  var IDS = [];
  GROUPS.forEach(function (g) { g.items.forEach(function (it) { IDS.push(it[0]); Object.freeze(it); }); Object.freeze(g.items); Object.freeze(g); });
  var SET = {}; IDS.forEach(function (id) { SET[id] = true; });
  // Valor guardado -> { id: true } solo con ids de la lista y valor exactamente true. Cualquier otra cosa: {} (cerrado).
  function normalize(value) {
    var out = {};
    try {
      var allow = value && typeof value === 'object' && !Array.isArray(value) ? value.allow : null;
      if (!allow || typeof allow !== 'object' || Array.isArray(allow)) return out;
      IDS.forEach(function (id) { if (Object.prototype.hasOwnProperty.call(allow, id) && allow[id] === true) out[id] = true; });
    } catch (_) { return {}; }
    return out;
  }
  root.NA_EMPLOYEE_TOGGLES = Object.freeze({
    KEY: 'internal:emp:perm:v1', LOCK_ID: 'permisos-por-empleado', IDS: Object.freeze(IDS), GROUPS: Object.freeze(GROUPS),
    has: function (id) { return Object.prototype.hasOwnProperty.call(SET, id); }, normalize: normalize
  });
})(globalThis);
