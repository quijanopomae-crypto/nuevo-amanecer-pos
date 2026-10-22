/* Catálogo de reportes (#106): una sola pantalla con los reportes que ya existen. Solo navega; no muestra montos ni datos. Solo dueño. */
(function (root) {
  'use strict';

  var PAGE_ID = 'pageCatalogoReportes', FEATURE_ID = 'catalogo-reportes';
  var CATEGORIES = ['Ventas', 'Caja', 'Inventario', 'Clientes'];
  // feature: candado propio del destino (null = la pantalla no tiene candado, solo su permiso de pantalla).
  // screen: permiso de pantalla que revisa el destino (por defecto, la página).
  var REPORTS = Object.freeze([
    { id: 'reportes-ventas', category: 'Ventas', name: 'Reportes de ventas', description: 'Ventas por día, productos más vendidos, utilidad, cajero y método de pago.', page: 'pageVentas', tab: 'reportes', feature: 'reportes', screen: 'ventas:reportes' },
    { id: 'ventas-stock', category: 'Ventas', name: 'Ventas con stock', description: 'Lo vendido de cada producto junto a su stock actual.', page: 'pageVentasStock', feature: 'reporte-ventas-stock' },
    { id: 'reporte-arqueo', category: 'Caja', name: 'Reporte de arqueo', description: 'Cierres de caja por fechas y por cajero, con diferencias.', page: 'pageReporteArqueo', feature: 'reporte-arqueo' },
    { id: 'gastos', category: 'Caja', name: 'Gastos', description: 'Gastos registrados por categoría y fecha.', page: 'pageGastos', feature: 'gastos' },
    { id: 'valorizacion', category: 'Inventario', name: 'Valorización de inventario', description: 'Cuánto vale tu stock a costo y a precio de venta.', page: 'pageValorizacion', feature: 'valorizacion-inventario' },
    { id: 'kardex', category: 'Inventario', name: 'Kardex por producto', description: 'Entradas, salidas y saldo de un producto en el tiempo.', page: 'pageKardex', feature: 'kardex' },
    { id: 'rotacion-abc', category: 'Inventario', name: 'Rotación ABC', description: 'Qué productos y categorías mueven más tu venta.', page: 'pageRotacionAbc', feature: 'rotacion-abc' },
    { id: 'productos-sin-movimiento', category: 'Inventario', name: 'Productos sin movimiento', description: 'Productos con stock que no se venden hace tiempo.', page: 'pageProductosSinMovimiento', feature: 'productos-sin-movimiento' },
    { id: 'sugerencia-compra', category: 'Inventario', name: 'Sugerencia de compra', description: 'Cuánto reponer según lo vendido en los últimos días.', page: 'pageSugerenciaCompra', feature: 'sugerencia-compra' },
    { id: 'productos-vencer', category: 'Inventario', name: 'Productos por vencer', description: 'Lotes que vencen pronto o ya vencieron.', page: 'pageReporteProductosVencer', feature: 'reporte-productos-vencer' },
    { id: 'historial-compras', category: 'Inventario', name: 'Historial de compras por producto', description: 'Compras de un producto: proveedor, cantidad y costo.', page: 'pageHistorialCompras', feature: 'historial-compras-producto' },
    { id: 'codigos-duplicados', category: 'Inventario', name: 'Códigos duplicados', description: 'Códigos de barra que pertenecen a más de un producto.', page: 'pageCodigosDuplicados', feature: null },
    { id: 'clientes-frecuencia', category: 'Clientes', name: 'Frecuencia de compra', description: 'Cada cuánto compra cada cliente y quién dejó de venir.', page: 'pageClientesFrecuencia', feature: 'clientes-frecuencia' },
    { id: 'cliente-historial', category: 'Clientes', name: 'Historial de compras por cliente', description: 'Todo lo que compró un cliente.', page: 'pageClienteHistorial', feature: 'cliente-historial-compras' },
    { id: 'reporte-deuda', category: 'Clientes', name: 'Reporte de deuda', description: 'Clientes con saldo pendiente y deuda vencida.', page: 'pageReporteDeuda', feature: null }
  ].map(Object.freeze));

  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  function permissions() {
    var p = root.NA_PERMISSIONS;
    return p && typeof p.canAccessScreen === 'function' && typeof p.featureLocked === 'function' ? p : null;
  }
  // Pantalla abierta: dueño, tabla de permisos cargada y candado 'catalogo-reportes' abierto. Falla cerrada.
  function screenAllowed() {
    try { var p = permissions(); return isOwner() && !!p && p.canAccessScreen('owner', PAGE_ID) === true && p.featureLocked(FEATURE_ID) === false; } catch (_) { return false; }
  }
  function screenLocked() {
    try { var p = permissions(); return !p || p.featureLocked(FEATURE_ID) !== false; } catch (_) { return true; }
  }
  // Mismo control que el destino: su permiso de pantalla y, si tiene, su propio candado.
  function canOpen(report) {
    try {
      var p = permissions();
      if (!report || !p || !screenAllowed()) return false;
      if (p.canAccessScreen('owner', report.screen || report.page) !== true) return false;
      if (report.feature && p.featureLocked(report.feature) !== false) return false;
      return !root.document || !!root.document.getElementById(report.page);
    } catch (_) { return false; }
  }
  function normalize(value) {
    return String(value == null ? '' : value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  function matches(report, query) {
    var q = normalize(query);
    if (!q) return true;
    var hay = normalize(report.name + ' ' + report.description + ' ' + report.category);
    return q.split(/\s+/).every(function (word) { return hay.indexOf(word) >= 0; });
  }
  function visible(query) { return REPORTS.filter(function (r) { return canOpen(r) && matches(r, query); }); }
  function open(id) {
    var report = REPORTS.filter(function (r) { return r.id === id; })[0];
    if (!canOpen(report) || typeof root.goPage !== 'function') return false;
    if (root.goPage(report.page) === false) return false;
    if (report.tab && typeof root.ventasSetTab === 'function' && root.document) {
      var btn = Array.prototype.filter.call(root.document.querySelectorAll('#' + report.page + ' .tab'), function (b) { return /Reportes/.test(b.textContent); })[0];
      if (btn) root.ventasSetTab(btn, report.tab);
    }
    return true;
  }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function render() {
    var page = root.document && root.document.getElementById(PAGE_ID);
    var host = page && page.querySelector('[data-cr-list]');
    var search = page && page.querySelector('[data-cr-search]');
    if (!host) return false;
    var allowed = screenAllowed();
    if (search) search.hidden = !allowed;
    if (!allowed) {
      host.replaceChildren(element('p', 'cr-notice', isOwner() && screenLocked() ? 'Esta función todavía no está disponible.' : 'Sin permiso. Pídele acceso al dueño.'));
      return false;
    }
    var items = visible(search && search.querySelector('input') ? search.querySelector('input').value : '');
    if (!items.length) { host.replaceChildren(element('p', 'cr-notice', 'No hay reportes que coincidan con la búsqueda.')); return true; }
    var groups = [];
    CATEGORIES.forEach(function (category) {
      var inCat = items.filter(function (r) { return r.category === category; });
      if (!inCat.length) return;
      var section = element('section', 'cr-group');
      section.setAttribute('data-cr-category', category);
      section.appendChild(element('h2', '', category));
      var list = element('ul', 'cr-items');
      inCat.forEach(function (r) {
        var li = element('li', 'cr-item');
        li.setAttribute('data-cr-report', r.id);
        var info = element('div', 'cr-info');
        info.appendChild(element('strong', '', r.name));
        info.appendChild(element('span', '', r.description));
        var btn = element('button', 'cr-open', 'Abrir');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Abrir ' + r.name);
        btn.addEventListener('click', function () { open(r.id); });
        li.appendChild(info); li.appendChild(btn);
        list.appendChild(li);
      });
      section.appendChild(list);
      groups.push(section);
    });
    host.replaceChildren.apply(host, groups);
    return true;
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID);
    if (!page) return;
    var input = page.querySelector('[data-cr-search] input');
    if (input) input.addEventListener('input', render);
    function update() { if (!screenAllowed() || page.classList.contains('active')) render(); }
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    if (typeof root.addEventListener === 'function') root.addEventListener('na:role', update);
    update();
  }
  root.NA_CATALOGO_REPORTES = Object.freeze({ REPORTS: REPORTS, CATEGORIES: CATEGORIES, canOpen: canOpen, screenAllowed: screenAllowed, matches: matches, visible: visible, open: open, render: render });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NA_CATALOGO_REPORTES;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(globalThis);
