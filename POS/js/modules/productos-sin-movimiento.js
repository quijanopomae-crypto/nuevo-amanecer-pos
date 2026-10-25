/* Productos sin movimiento (id productos-sin-movimiento): productos activos sin ventas en los últimos
 * 30, 60 o 90 días (día de Lima), con stock actual. Reutiliza NA_ROTACION_ABC (mismo cruce de ventas,
 * anuladas excluidas, identidad por id/SKU). Solo lectura: no escribe estado, almacenamiento ni red.
 * El valor de inventario (stock × costo) es solo del dueño: NA_ROLES.isOwner() en try/catch.
 * Stock inmovilizado: por defecto solo productos con stock > 0; «Incluir sin stock» muestra también stock ≤ 0. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageProductosSinMovimiento', FEATURE_ID = 'productos-sin-movimiento';
  function text(value) { return String(value == null ? '' : value).trim(); }
  function num(value) { var n = typeof value === 'number' ? value : Number(text(value).replace(',', '.')); return Number.isFinite(n) ? n : null; }
  // Costo conocido (#892): número finito ≥ 0 o texto con dígitos. Ausente (undefined/null/'') = null; un 0 real es 0.
  function knownCost(v) { if (typeof v !== 'number' && (typeof v !== 'string' || !/[0-9]/.test(v))) return null; var n = num(v); return n !== null && n >= 0 ? n : null; }
  function identityKey(item) {
    var id = item.id != null ? item.id : item.productoId;
    if (id != null && text(id)) return 'id:' + text(id);
    if (text(item.sku)) return 'sku:' + text(item.sku);
    var name = text(item.name != null ? item.name : item.nombre);
    return name ? 'name:' + name : '';
  }
  function abc() { return root.NA_ROTACION_ABC; }
  // Última venta (día de Lima) de cada producto en todo el historial cargado.
  function lastSales(sales) {
    var out = new Map(), limaDay = abc().limaDay;
    (Array.isArray(sales) ? sales : []).forEach(function (sale) {
      if (!sale || sale.anulada) return;
      var day = limaDay(sale.fecha || sale.timestamp); if (!day) return;
      (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var key = identityKey(item); if (!key) return;
        if (!out.has(key) || out.get(key) < day) out.set(key, day);
      });
    });
    return out;
  }
  function buildReport(sales, products, options) {
    options = options || {};
    var withValue = options.withValue === true, includeNoStock = options.includeNoStock === true;
    var base = abc().buildReport(sales, products, { days: options.days, now: options.now });
    var noSales = new Set();
    base.groups.forEach(function (group) { group.rows.forEach(function (row) { if (row.noSales) noSales.add(row.key); }); });
    var last = lastSales(sales), rows = [], seen = new Set();
    (Array.isArray(products) ? products : []).forEach(function (p) {
      if (!p || typeof p !== 'object' || p.activo === false) return;
      var key = identityKey(p); if (!key || seen.has(key) || !noSales.has(key)) return;
      seen.add(key);
      var stock = num(p.stock);
      if (!includeNoStock && !(stock > 0)) return; // sin stock (0, negativo o vacío) no es stock inmovilizado
      var row = {
        key: key, name: text(p.name != null ? p.name : p.nombre) || 'Producto sin nombre',
        code: text(p.sku || p.barcode || p.codigo), stock: stock === null ? 0 : stock, lastSale: last.get(key) || ''
      };
      if (withValue) {
        row.cost = knownCost(p.costo);
        row.value = row.cost === null ? null : Math.round(Math.max(0, row.stock) * row.cost * 100) / 100;
      }
      rows.push(row);
    });
    rows.sort(function (a, b) { return b.stock - a.stock || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    var report = { range: base.range, rows: rows, units: rows.reduce(function (s, r) { return s + Math.max(0, r.stock); }, 0), withValue: withValue };
    if (withValue) {
      report.value = Math.round(rows.reduce(function (s, r) { return s + (r.value || 0); }, 0) * 100) / 100;
      report.noCost = rows.filter(function (r) { return r.value === null; }).length;
    }
    return report;
  }
  // Alias de NA_ROLES.isOwner (fuente única del rol dueño). Falla cerrada si NA_ROLES falta o lanza error.
  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  function policyReady() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  function unlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(FEATURE_ID) === false); } catch (_) { return false; }
  }
  // Permisos por empleado (#924): el empleado entra solo si el servidor prendió su casilla (falla cerrada).
  function employeeMay() {
    try { var e = root.NA_EMPLOYEE_PERMS; return !!(e && typeof e.may === 'function' && e.may(FEATURE_ID) === true); } catch (_) { return false; }
  }
  // Dueño como hoy, o empleado con casilla. El valor de inventario (withValue) sigue siendo solo isOwner().
  function available() {
    try { return policyReady() && unlocked() && (isOwner() || employeeMay()); } catch (_) { return false; }
  }
  function dateLabel(day) { return day ? day.split('-').reverse().join('/') : 'Nunca (en este dispositivo)'; }
  function money(v) { return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function units(v) { return v.toLocaleString('es-PE', { maximumFractionDigits: 3 }); }
  function filterLabel(range) { return 'Sin ventas del ' + dateLabel(range.from) + ' al ' + dateLabel(range.to) + ' (' + range.days + ' días) · hora de Lima'; }
  function csvCell(value) {
    var raw = String(value == null ? '' : value);
    if (typeof value === 'string' && /^[=+@\t\r\n-]/.test(raw.replace(/^ +/, ''))) raw = "'" + raw;
    return /[",\r\n]/.test(raw) ? '"' + raw.replace(/"/g, '""') + '"' : raw;
  }
  function toCsv(report) {
    var head = ['Producto', 'Código', 'Stock actual', 'Última venta'];
    if (report.withValue) head.push('Costo unitario', 'Valor inventario');
    var lines = [[filterLabel(report.range)], head];
    report.rows.forEach(function (r) {
      var line = [r.name, r.code, r.stock, r.lastSale ? dateLabel(r.lastSale) : 'Nunca'];
      if (report.withValue) line.push(r.cost === null ? 'Sin costo' : r.cost.toFixed(2), r.value === null ? 'Sin costo' : r.value.toFixed(2));
      lines.push(line);
    });
    return '\uFEFF' + lines.map(function (l) { return l.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function currentSales() { return typeof ventas !== 'undefined' ? ventas : root.ventas; } // eslint-disable-line no-undef
  function currentProducts() { return typeof productos !== 'undefined' ? productos : root.productos; } // eslint-disable-line no-undef
  function currentReport(page) {
    var period = page.querySelector('[data-psm-period]'), noStock = page.querySelector('[data-psm-no-stock]');
    // El valor solo se calcula si el dueño está confirmado en este momento.
    return buildReport(currentSales(), currentProducts(), { days: period ? period.value : 30, withValue: isOwner(), includeNoStock: !!(noStock && noStock.checked) });
  }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function render() {
    var page = root.document && root.document.getElementById(PAGE_ID); if (!page) return false;
    var content = page.querySelector('[data-psm-content]'), status = page.querySelector('[data-psm-status]'), controls = page.querySelector('[data-psm-controls]');
    if (!content || !status) return false;
    var ok = available();
    if (controls) controls.hidden = !ok;
    content.replaceChildren();
    if (!ok) { status.textContent = 'Sin permiso. Pídele acceso al dueño.'; return false; }
    var report;
    try { report = currentReport(page); } catch (_) { status.textContent = 'No se pudo leer las ventas cargadas. Actualiza el reporte.'; return false; }
    status.textContent = filterLabel(report.range) + ' · ventas cargadas en este dispositivo';
    var summary = element('div', 'psm-summary');
    var cards = [['Productos sin ventas', report.rows.length], ['Unidades en stock', units(report.units)]];
    if (report.withValue) cards.push(['Valor de inventario (costo)', money(report.value)]);
    cards.forEach(function (pair) { var c = element('div', 'psm-card'); c.appendChild(element('span', '', pair[0])); var v = element('strong', '', pair[1]); if (pair[0].indexOf('Valor') === 0) v.setAttribute('data-psm-total-value', ''); c.appendChild(v); summary.appendChild(c); });
    content.appendChild(summary);
    if (report.withValue && report.noCost) content.appendChild(element('p', 'psm-note', report.noCost + (report.noCost === 1 ? ' producto sin costo no suma' : ' productos sin costo no suman') + ' al valor.'));
    if (!report.rows.length) { content.appendChild(element('p', 'psm-empty', 'Todos los productos activos tuvieron ventas en este período.')); return true; }
    var table = element('table', 'psm-table');
    table.appendChild(element('caption', 'psm-sr-only', 'Productos sin ventas, mayor stock primero'));
    var head = element('thead'), tr = element('tr');
    var labels = ['Producto', 'Stock actual', 'Última venta'].concat(report.withValue ? ['Valor inventario'] : []);
    labels.forEach(function (label, i) { var th = element('th', i === 1 || i === 3 ? 'psm-num' : '', label); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    var body = element('tbody');
    report.rows.forEach(function (r) {
      var line = element('tr'); line.setAttribute('data-psm-row', r.key);
      var name = element('th', 'psm-product', r.name); name.scope = 'row'; if (r.code) name.appendChild(element('small', '', r.code)); line.appendChild(name);
      var cells = [['Stock actual', units(r.stock), 'psm-num'], ['Última venta', dateLabel(r.lastSale), '']];
      if (report.withValue) cells.push(['Valor inventario', r.value === null ? 'Sin costo' : money(r.value), 'psm-num psm-value']);
      cells.forEach(function (c) { var td = element('td', c[2], c[1]); td.setAttribute('data-label', c[0]); line.appendChild(td); });
      body.appendChild(line);
    });
    table.appendChild(body); content.appendChild(table);
    return true;
  }
  function exportCsv() {
    if (!available()) return false;
    var page = root.document && root.document.getElementById(PAGE_ID); if (!page) return false;
    var report = currentReport(page);
    var url = root.URL.createObjectURL(new root.Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' }));
    var link = element('a'); link.href = url;
    link.download = 'productos-sin-movimiento-' + report.range.to + '-' + report.range.days + '-dias.csv';
    try { page.appendChild(link); link.click(); } finally { link.remove(); root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000); }
    return true;
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID);
    if (!page || page.__naPsmBound) return; page.__naPsmBound = true;
    function update() { if (page.classList.contains('active')) render(); }
    page.addEventListener('change', update);
    var refresh = page.querySelector('[data-psm-refresh]'), exp = page.querySelector('[data-psm-export]');
    if (refresh) refresh.addEventListener('click', update);
    if (exp) exp.addEventListener('click', exportCsv);
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { if (!available()) render(); else update(); });
    root.addEventListener('na:employee-perms', function () { if (!available()) render(); else update(); });
    ['na:canonical-updated', 'na:canonical-sale-projection', 'focus'].forEach(function (ev) { root.addEventListener(ev, update); });
    update();
  }
  root.NA_PRODUCTOS_SIN_MOVIMIENTO = Object.freeze({ buildReport: buildReport, toCsv: toCsv, csvCell: csvCell, available: available, render: render, exportCsv: exportCsv, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
