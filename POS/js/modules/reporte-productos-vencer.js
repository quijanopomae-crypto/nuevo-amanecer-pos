/* Productos por vencer: consulta de los lotes ya cargados, sin reconstruir ni escribir estado. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageReporteProductosVencer', FEATURE_ID = 'reporte-productos-vencer';
  var DAY_MS = 86400000;
  function text(value) { return String(value == null ? '' : value); }
  function horizonRange(days, now) {
    var core = root.NA_STOCK_LOTS;
    var count = [30, 60, 90].indexOf(Number(days)) >= 0 ? Number(days) : 30;
    // Una fecha de lote es un día calendario; un instante se convierte al día de Lima.
    var today = core.validDate(now) ? now : core.businessDate(now === undefined ? undefined :
      typeof now === 'number' || now instanceof Date ? new Date(now).toISOString() : now);
    return { days: count, today: today, through: new Date(Date.parse(today) + count * DAY_MS).toISOString().slice(0, 10) };
  }
  function buildReport(products, options) {
    options = options || {};
    var core = root.NA_STOCK_LOTS, range = horizonRange(options.days, options.now);
    var readable = (Array.isArray(products) ? products : []).filter(function (product) { return product && typeof product === 'object'; }).map(function (product) {
      var lots;
      try { lots = core.lots(product); } catch (_) { lots = []; }
      // No sustituir ni sanear el registro original: solo una proyección para la consulta.
      return Object.assign({}, product, { lots: lots.filter(function (lot) {
        return lot && typeof lot === 'object' && typeof lot.quantity === 'number' && Number.isFinite(lot.quantity);
      }) });
    });
    var rows = core.report(readable, 'expired', range.today).concat(core.report(readable, range.days, range.today));
    rows = rows.map(function (row) {
      return Object.assign({}, row, { name: text(row.name) || 'Producto sin nombre', lot_code: text(row.lot_code), expired: row.days < 0, bucket: bucketOf(row.days) });
    });
    var lot = normalizeLot(options.lot);
    if (lot) rows = rows.filter(function (row) { return normalizeLot(row.lot_code).indexOf(lot) >= 0; });
    return { range: range, rows: rows, lot: text(options.lot).trim(), expired: rows.filter(function (row) { return row.expired; }).length, counts: bucketCounts(rows) };
  }
  // Tramos: vencido, hasta 30, 31–60 y 61–90 días (día de Lima).
  function bucketOf(days) { return days < 0 ? 'vencido' : days <= 30 ? '30' : days <= 60 ? '60' : '90'; }
  function bucketCounts(rows) {
    var out = { vencido: 0, '30': 0, '60': 0, '90': 0 };
    rows.forEach(function (row) { out[row.bucket] = (out[row.bucket] || 0) + 1; });
    return out;
  }
  function normalizeLot(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function summaryLabel(counts) {
    return 'Vencidos: ' + counts.vencido + ' · Hasta 30 días: ' + counts['30'] + ' · 31 a 60 días: ' + counts['60'] + ' · 61 a 90 días: ' + counts['90'];
  }
  // Resumen para el aviso del dueño: vencidos y por vencer en 30 días.
  function alertSummary(products, now) {
    var report = buildReport(products, { days: 30, now: now });
    return { today: report.range.today, expired: report.counts.vencido, soon: report.counts['30'] };
  }
  // Alias de NA_ROLES.isOwner (fuente única del rol dueño). Falla cerrada si NA_ROLES falta o lanza error.
  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  // No es una regla de rol: confirma que la tabla de permisos cargó (falla cerrada sin ella).
  function policyReady() {
    try { var permissions = root.NA_PERMISSIONS; return !!(permissions && typeof permissions.canAccessScreen === 'function' && permissions.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  function ownerAllowed() { return isOwner() && policyReady(); }
  function unlocked() {
    try { var permissions = root.NA_PERMISSIONS; return !!(permissions && typeof permissions.featureLocked === 'function' && permissions.featureLocked(FEATURE_ID) === false); } catch (_) { return false; }
  }
  // Permisos por empleado (#924): el empleado entra solo si el servidor prendió su casilla (falla cerrada).
  function employeeMay() {
    try { var e = root.NA_EMPLOYEE_PERMS; return !!(e && typeof e.may === 'function' && e.may(FEATURE_ID) === true); } catch (_) { return false; }
  }
  // Dueño como hoy, o empleado con casilla; el candado manda en los dos casos.
  function available() {
    try { return unlocked() && (ownerAllowed() || (policyReady() && employeeMay())); } catch (_) { return false; }
  }
  function currentProducts() {
    var canonical = root.NuevoAmanecerCanonical, view = root.NuevoAmanecerCanonicalSaleView;
    if (canonical && typeof canonical.enabled === 'function' && canonical.enabled()) {
      // lastView() incluye lotes reservados y recibos ACK. rebuild()/currentProducts() cambian el runtime.
      var projected = view && typeof view.lastView === 'function' ? view.lastView() : null;
      if (projected && Array.isArray(projected.products)) return projected.products;
      var snapshot = typeof canonical.snapshot === 'function' ? canonical.snapshot() : null;
      return snapshot && Array.isArray(snapshot.products) ? snapshot.products : [];
    }
    return typeof productos !== 'undefined' ? productos : root.productos;
  }
  function currentReport(page) {
    var horizon = page.querySelector('[data-rpv-horizon]');
    var lot = page.querySelector('[data-rpv-lot]');
    return buildReport(currentProducts(), { days: horizon ? horizon.value : 30, lot: lot ? lot.value : '' });
  }
  function dateLabel(day) { return root.NA_STOCK_LOTS.displayDate(day); }
  function filterLabel(range, lot) {
    return 'Filtro: próximos ' + range.days + ' días (' + dateLabel(range.today) + ' al ' + dateLabel(range.through) + ') + vencidos · día de Lima' + (lot ? ' · lote contiene «' + lot + '»' : '');
  }
  function csvCell(value) {
    var raw = text(value);
    // Números negativos son cantidades, pero todo texto con estos prefijos se protege.
    if (typeof value === 'string' && /^[=+@\t\r\n-]/.test(raw.replace(/^ +/, ''))) raw = "'" + raw;
    return /[",\r\n]/.test(raw) ? '"' + raw.replace(/"/g, '""') + '"' : raw;
  }
  function toCsv(report) {
    var lines = [[filterLabel(report.range, report.lot)], ['Producto', 'Lote', 'Fecha vencimiento', 'Días restantes', 'Stock']];
    report.rows.forEach(function (row) { lines.push([row.name, row.lot_code, dateLabel(row.expiry_date), row.days, row.quantity]); });
    return '\uFEFF' + lines.map(function (line) { return line.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = text(value);
    return node;
  }
  function render() {
    var page = root.document && root.document.getElementById(PAGE_ID);
    if (!page) return false;
    var content = page.querySelector('[data-rpv-content]'), status = page.querySelector('[data-rpv-status]');
    if (!content || !status) return false;
    var controls = page.querySelector('[data-rpv-controls]'), authorized = available();
    if (controls) controls.hidden = !authorized;
    content.replaceChildren();
    var hideSummary = page.querySelector('[data-rpv-summary]'); if (hideSummary) { hideSummary.hidden = true; hideSummary.textContent = ''; }
    if (!authorized) { status.textContent = ownerAllowed() ? 'Función en preparación. Disponible cuando el dueño la habilite.' : 'Sin permiso. Pídele acceso al dueño.'; return false; }
    var report;
    try { report = currentReport(page); }
    catch (_) { status.textContent = 'No se pudo leer los lotes cargados. Actualiza el reporte.'; return false; }
    status.textContent = filterLabel(report.range, report.lot) + ' · ' + report.rows.length + ' lotes · ' + report.expired + ' vencidos';
    var summary = page.querySelector('[data-rpv-summary]');
    if (summary) { summary.hidden = false; summary.textContent = summaryLabel(report.counts); }
    if (!report.rows.length) { content.appendChild(element('p', 'rpv-empty', report.lot ? 'Ningún lote coincide con «' + report.lot + '» en este horizonte.' : 'No hay lotes con stock vencidos o por vencer en este horizonte.')); return true; }
    var section = element('section', 'rpv-results'), table = element('table', 'rpv-table');
    table.appendChild(element('caption', 'rpv-sr-only', 'Lotes vencidos primero, luego por fecha de vencimiento'));
    var head = element('thead'), headers = element('tr');
    ['Producto', 'Lote', 'Fecha vencimiento', 'Días restantes', 'Stock'].forEach(function (label, index) {
      var cell = element('th', index >= 3 ? 'rpv-num' : '', label); cell.scope = 'col'; headers.appendChild(cell);
    });
    head.appendChild(headers); table.appendChild(head);
    var body = element('tbody');
    report.rows.forEach(function (row) {
      var line = element('tr'); line.setAttribute('data-rpv-expired', String(row.expired));
      var name = element('th', 'rpv-product', row.name); name.scope = 'row'; line.appendChild(name);
      [['Lote', row.lot_code], ['Fecha vencimiento', dateLabel(row.expiry_date)],
        ['Días restantes', row.expired ? 'Vencido (' + row.days + ')' : row.days],
        ['Stock', row.quantity.toLocaleString('es-PE', { maximumFractionDigits: 9 })]].forEach(function (pair, index) {
        var cell = element('td', index >= 2 ? 'rpv-num' : '', pair[1]); cell.setAttribute('data-label', pair[0]); line.appendChild(cell);
      });
      body.appendChild(line);
    });
    table.appendChild(body); section.appendChild(table); content.appendChild(section); return true;
  }
  function exportCsv() {
    // Comprobar rol y bloqueo antes de leer lotes o crear el archivo.
    if (!available()) return false;
    var page = root.document && root.document.getElementById(PAGE_ID);
    if (!page) return false;
    var report = currentReport(page);
    var url = root.URL.createObjectURL(new root.Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' }));
    var link = element('a'); link.href = url;
    link.download = 'productos-por-vencer-' + report.range.today + '-' + report.range.days + '-dias' + (report.lot ? '-lote' : '') + '.csv';
    try { page.appendChild(link); link.click(); }
    finally { link.remove(); root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000); }
    return true;
  }
  // Aviso del dueño: tarjeta flotante propia (no cambia el diseño de Inicio). Solo se muestra con Inicio
  // (pageMenu) activo: nunca en Venta (botón de cobrar, barra inferior) ni sobre botones de otros módulos. Al cerrarla no vuelve en la sesión:
  // única escritura del módulo, una marca en sessionStorage (sin datos de productos ni lotes).
  var ALERT_ID = 'naRpvAlert', ALERT_SESSION_KEY = 'na_rpv_alert_closed_v1', VENTA_PAGE = 'pagePOS', dismissedMemory = false;
  function alertDismissed() {
    if (dismissedMemory) return true;
    try { return !!(root.sessionStorage && root.sessionStorage.getItem(ALERT_SESSION_KEY) === '1'); } catch (_) { return false; }
  }
  function rememberDismiss() {
    dismissedMemory = true;
    try { if (root.sessionStorage) root.sessionStorage.setItem(ALERT_SESSION_KEY, '1'); } catch (_) {}
  }
  var HOME_PAGE = 'pageMenu';
  function isActive(id) { var v = root.document && root.document.getElementById(id); return !!(v && v.classList && v.classList.contains('active')); }
  function inVenta() { return isActive(VENTA_PAGE) || !isActive(HOME_PAGE); }
  function removeAlert() { var old = root.document && root.document.getElementById(ALERT_ID); if (old) old.remove(); }
  function alertParts(info) {
    var parts = [];
    if (info.expired) parts.push(info.expired === 1 ? '1 lote vencido' : info.expired + ' lotes vencidos');
    if (info.soon) parts.push(info.soon === 1 ? '1 lote vence en 30 días' : info.soon + ' lotes vencen en 30 días');
    return parts;
  }
  function showAlert() {
    var doc = root.document; if (!doc || !doc.body) return false;
    // Solo el dueño (NA_ROLES.isOwner() en try/catch) y con la función habilitada; si algo falla, se oculta.
    if (!available() || alertDismissed() || inVenta()) { removeAlert(); return false; }
    var info;
    try { info = alertSummary(currentProducts()); } catch (_) { removeAlert(); return false; }
    if ((!info.expired && !info.soon) || alertDismissed() || inVenta()) { removeAlert(); return false; }
    var text = '⏳ ' + alertParts(info).join(' · ') + ' (' + dateLabel(info.today) + ', hora de Lima)';
    // Mismo aviso ya en pantalla: se deja tal cual. Rehacerlo en cada evento (na:canonical-updated, el temporizador de 1,5 s, cambios de
    // clase de Inicio) lo sacaba y volvía a poner en medio segundo: parpadeo, el lector de pantalla lo repetía y las pruebas e2e medían
    // el nodo ya quitado (fallas intermitentes de alertas-vencimiento.spec.ts a 740x360 / 844x390).
    var old = doc.getElementById(ALERT_ID), oldText = old && old.querySelector('.rpv-alert-text');
    if (old && old.parentNode === doc.body && oldText && oldText.textContent === text) return true;
    removeAlert();
    var box = element('div', 'rpv-alert'); box.id = ALERT_ID; box.setAttribute('role', 'status'); box.setAttribute('data-rpv-alert', '');
    box.appendChild(element('p', 'rpv-alert-text', text));
    var view = element('button', 'rpv-alert-view', 'Ver reporte'); view.type = 'button'; view.setAttribute('data-rpv-alert-view', '');
    var close = element('button', 'rpv-alert-close', 'Cerrar'); close.type = 'button'; close.setAttribute('data-rpv-alert-close', ''); close.setAttribute('aria-label', 'Cerrar aviso de vencimientos');
    function dismiss() { rememberDismiss(); removeAlert(); }
    view.addEventListener('click', function () { dismiss(); if (typeof root.goPage === 'function') root.goPage(PAGE_ID); });
    close.addEventListener('click', dismiss);
    box.appendChild(view); box.appendChild(close); doc.body.appendChild(box);
    return true;
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID);
    if (!page || page.__naReporteProductosVencerBound) return;
    page.__naReporteProductosVencerBound = true;
    function update() { if (page.classList.contains('active')) render(); }
    page.addEventListener('change', update);
    var refresh = page.querySelector('[data-rpv-refresh]'), exportButton = page.querySelector('[data-rpv-export]');
    if (refresh) refresh.addEventListener('click', update);
    if (exportButton) exportButton.addEventListener('click', exportCsv);
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { if (!available()) render(); else update(); showAlert(); });
    root.addEventListener('na:employee-perms', function () { if (!available()) render(); else update(); showAlert(); });
    root.addEventListener('na:canonical-updated', showAlert);
    page.addEventListener('input', function (e) { if (e.target && e.target.matches && e.target.matches('[data-rpv-lot]')) update(); });
    root.setTimeout(showAlert, 1500);
    [VENTA_PAGE, HOME_PAGE].forEach(function (id) {
      var el = root.document.getElementById(id);
      if (el && typeof root.MutationObserver === 'function') new root.MutationObserver(showAlert).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    ['na:canonical-updated', 'na:canonical-sale-projection', 'na:canonical-sale-receipt', 'focus'].forEach(function (event) { root.addEventListener(event, update); });
    update();
  }
  root.NA_REPORTE_PRODUCTOS_VENCER = Object.freeze({ buildReport: buildReport, horizonRange: horizonRange,
    toCsv: toCsv, csvCell: csvCell, bucketOf: bucketOf, bucketCounts: bucketCounts, summaryLabel: summaryLabel, alertSummary: alertSummary, showAlert: showAlert, ownerAllowed: ownerAllowed, render: render, exportCsv: exportCsv, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
