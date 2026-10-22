/* #159 Movimientos por medio de pago por turno (solo dueño, solo lectura).
   Fuente: réplica canónica local vía NuevoAmanecerCashHistory.summarize (no llama al Worker, no escribe). */
(function (root) {
  'use strict';

  var PAGE_ID = 'pageReporteArqueo'; // vive dentro del reporte de arqueo, sin pantalla nueva
  var FEATURE_ID = 'reporte-medio-pago'; // candado propio; su línea en FEATURE_LOCKS se agrega en el desbloqueo final
  var DAY_MS = 86400000;
  var METHODS = [['efectivo', 'Efectivo'], ['yape', 'Yape'], ['plin', 'Plin'], ['transferencia', 'Transferencia'], ['credito', 'Al crédito']];
  var renderedReport = null;
  function text(value) { return String(value == null ? '' : value); }
  function int(value) { var n = Number(value); return Number.isSafeInteger(n) ? n : 0; }
  function validDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    var date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
  }
  function defaultRange() {
    var hasta = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
    var desde = new Date(Date.parse(hasta + 'T00:00:00Z') - 29 * DAY_MS).toISOString().slice(0, 10);
    return { desde: desde, hasta: hasta };
  }
  function dateLabel(day) { return day ? day.split('-').reverse().join('/') : ''; }
  // S/ 1,234.50: toFixed(2) con separador de miles por coma.
  function money(cents) {
    var n = int(cents), parts = (Math.abs(n) / 100).toFixed(2).split('.');
    return (n < 0 ? '-' : '') + 'S/ ' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
  }
  function emptyMethods() { var out = {}; METHODS.forEach(function (m) { out[m[0]] = 0; }); return out; }

  function buildReport(snapshot, options) {
    options = options || {};
    var defaults = defaultRange();
    var desde = options.desde === undefined || options.desde === '' ? defaults.desde : validDay(text(options.desde));
    var hasta = options.hasta === undefined || options.hasta === '' ? defaults.hasta : validDay(text(options.hasta));
    if (!desde || !hasta) throw new RangeError('Selecciona fechas válidas para el reporte.');
    if (desde > hasta) throw new RangeError('La fecha Desde no puede ser posterior a Hasta.');
    if ((Date.parse(hasta + 'T00:00:00Z') - Date.parse(desde + 'T00:00:00Z')) / DAY_MS + 1 > 366)
      throw new RangeError('Selecciona un rango de hasta 366 días.');
    var history = options.history || root.NuevoAmanecerCashHistory;
    if (!history || typeof history.summarize !== 'function') throw new Error('Historial de caja no disponible.');
    var cashiers = typeof history.cashierMap === 'function' ? history.cashierMap() : {};
    var cajero = text(options.cajero).trim();
    var all = history.summarize(snapshot || {}, cashiers).filter(function (r) { return r && r.status === 'CLOSED'; }).map(function (r) {
      var fecha = r.cierreFecha || r.fecha;
      var people = [r.cajero, r.openedByName, r.closedByName].map(function (v) { return text(v).trim(); }).filter(Boolean);
      var metodos = emptyMethods();
      METHODS.forEach(function (m) { metodos[m[0]] = int(r.metodos && r.metodos[m[0]]); });
      return { sessionId: text(r.sessionId), fecha: fecha, fechaLabel: dateLabel(fecha), apertura: text(r.apertura), cierre: text(r.cierre),
        cajero: people[0] || 'No registrado', people: people, metodos: metodos,
        ventas: int(r.ventas), cobros: int(r.cobros), gastos: int(r.gastos), ajustes: int(r.ajustes), anulaciones: int(r.anulaciones),
        total: METHODS.reduce(function (sum, m) { return sum + metodos[m[0]]; }, 0),
        cobrado: METHODS.reduce(function (sum, m) { return m[0] === 'credito' ? sum : sum + metodos[m[0]]; }, 0) };
    }).filter(function (r) { return r.fecha && r.fecha >= desde && r.fecha <= hasta; });
    var cajeros = [];
    all.forEach(function (r) { r.people.forEach(function (p) { if (cajeros.indexOf(p) < 0) cajeros.push(p); }); });
    cajeros.sort(function (a, b) { return a.localeCompare(b, 'es'); });
    var rows = all.filter(function (r) { return !cajero || r.people.indexOf(cajero) >= 0; })
      .sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || b.cierre.localeCompare(a.cierre) || a.sessionId.localeCompare(b.sessionId); });
    rows.forEach(function (r) { delete r.people; });
    var totals = { count: rows.length, metodos: emptyMethods(), total: 0, cobrado: 0, ventas: 0, cobros: 0, gastos: 0, ajustes: 0, anulaciones: 0 };
    rows.forEach(function (r) {
      METHODS.forEach(function (m) { totals.metodos[m[0]] += r.metodos[m[0]]; });
      ['total', 'cobrado', 'ventas', 'cobros', 'gastos', 'ajustes', 'anulaciones'].forEach(function (k) { totals[k] += r[k]; });
    });
    return { range: { desde: desde, hasta: hasta }, cajero: cajero, cajeros: cajeros, rows: rows, totals: totals };
  }

  function toCsv(report) {
    function cell(value) {
      var v = value == null ? '' : String(value);
      if (typeof value === 'string' && /^[=+@\t\r\n-]/.test(v.replace(/^ +/, ''))) v = "'" + v;
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    var head = ['Fecha cierre', 'Apertura', 'Cierre', 'Cajero'].concat(METHODS.map(function (m) { return m[1]; }), ['Total vendido', 'Cobrado', 'Gastos', 'Ajustes']);
    var lines = [head.map(cell).join(',')];
    function amounts(src) { return METHODS.map(function (m) { return (src.metodos[m[0]] / 100).toFixed(2); }).concat([(src.total / 100).toFixed(2), (src.cobrado / 100).toFixed(2), (src.gastos / 100).toFixed(2), (src.ajustes / 100).toFixed(2)]); }
    report.rows.forEach(function (r) { lines.push([r.fechaLabel, r.apertura, r.cierre, r.cajero].map(cell).concat(amounts(r)).join(',')); });
    lines.push(['Total', report.totals.count + (report.totals.count === 1 ? ' turno' : ' turnos'), '', ''].map(cell).concat(amounts(report.totals)).join(','));
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  function policyReady() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  // Candado propio: falla cerrado si no hay permisos, si da error o si no es exactamente false.
  function featureUnlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(FEATURE_ID) === false); } catch (_) { return false; }
  }
  function ownerAllowed() { return isOwner() && policyReady(); }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function section(page) { return page && page.querySelector('[data-rmp-section]'); }
  function selected(sec) {
    function val(sel) { var n = sec.querySelector(sel); return n ? n.value : undefined; }
    return { desde: val('[data-rmp-desde]'), hasta: val('[data-rmp-hasta]'), cajero: val('[data-rmp-cajero]') || '' };
  }
  function fillCashiers(select, list, current) {
    var keep = list.indexOf(current) >= 0 ? current : '';
    select.replaceChildren(element('option', '', 'Todos'));
    select.firstChild.value = '';
    list.forEach(function (name) { var o = element('option', '', name); o.value = name; select.appendChild(o); });
    select.value = keep;
  }
  function render() {
    renderedReport = null;
    var page = root.document && root.document.getElementById(PAGE_ID), sec = section(page);
    if (!sec) return false;
    var content = sec.querySelector('[data-rmp-content]'), status = sec.querySelector('[data-rmp-status]');
    var controls = sec.querySelector('[data-rmp-controls]'), exportButton = sec.querySelector('[data-rmp-export]');
    var authorized = ownerAllowed() && featureUnlocked();
    sec.hidden = !authorized;
    if (controls) controls.hidden = !authorized;
    if (exportButton) exportButton.disabled = true;
    content.replaceChildren();
    if (!authorized) { status.textContent = 'Sin permiso. Pídele acceso al dueño.'; return false; }
    var details = sec.querySelector('[data-rmp-details]');
    // Plegado por defecto: no calcula ni pinta nada hasta que el dueño lo abre.
    if (details && !details.open) { status.textContent = ''; return false; }
    var defaults = defaultRange();
    ['desde', 'hasta'].forEach(function (key) {
      var input = sec.querySelector('[data-rmp-' + key + ']');
      if (input && !input.__naRmpDefault) { if (!input.value) input.value = defaults[key]; input.__naRmpDefault = true; }
    });
    var options = selected(sec), report, client = root.NuevoAmanecerCanonical;
    try { report = buildReport(client && typeof client.snapshot === 'function' ? client.snapshot() : {}, options); }
    catch (error) { status.textContent = error instanceof RangeError ? error.message : 'No se pudo leer el reporte de este dispositivo.'; return false; }
    var select = sec.querySelector('[data-rmp-cajero]');
    if (select) fillCashiers(select, report.cajeros, report.cajero);
    renderedReport = report;
    if (exportButton) exportButton.disabled = false;
    status.textContent = dateLabel(report.range.desde) + ' al ' + dateLabel(report.range.hasta) + ' · hora de Lima · turnos cerrados cargados en este dispositivo';
    if (!report.rows.length) { content.appendChild(element('p', 'rmp-empty', 'No hay turnos cerrados para este filtro.')); return true; }
    var wrap = element('div', 'rmp-table-wrap'); wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Movimientos por medio de pago por turno');
    var table = element('table', 'rmp-table'), head = element('thead'), tr = element('tr');
    ['Turno', 'Cajero'].concat(METHODS.map(function (m) { return m[1]; }), ['Total vendido', 'Cobrado', 'Gastos']).forEach(function (label) {
      var th = element('th', '', label); th.scope = 'col'; tr.appendChild(th);
    });
    head.appendChild(tr); table.appendChild(head);
    var body = element('tbody');
    function amountCells(line, src) {
      METHODS.forEach(function (m) { line.appendChild(element('td', 'rmp-num', money(src.metodos[m[0]]))); });
      line.appendChild(element('td', 'rmp-num rmp-total', money(src.total)));
      line.appendChild(element('td', 'rmp-num', money(src.cobrado)));
      line.appendChild(element('td', 'rmp-num', money(src.gastos)));
    }
    report.rows.forEach(function (r) {
      var line = element('tr'); line.setAttribute('data-session-id', r.sessionId);
      var turno = element('th', '', r.fechaLabel); turno.scope = 'row';
      turno.appendChild(element('small', '', (r.apertura || '—') + ' → ' + (r.cierre || '—')));
      line.appendChild(turno); line.appendChild(element('td', '', r.cajero));
      amountCells(line, r); body.appendChild(line);
    });
    table.appendChild(body);
    var foot = element('tfoot'), total = element('tr');
    var label = element('th', '', 'Total · ' + report.totals.count + (report.totals.count === 1 ? ' turno' : ' turnos'));
    label.scope = 'row'; label.colSpan = 2; total.appendChild(label);
    amountCells(total, report.totals); foot.appendChild(total); table.appendChild(foot);
    wrap.appendChild(table); content.appendChild(wrap);
    content.appendChild(element('p', 'rmp-note', 'Total vendido = ventas y cobros del turno por medio de pago, incluido lo vendido al crédito. Cobrado = lo que entró sin el crédito. Los gastos se muestran aparte.'));
    return true;
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID), sec = section(page);
    if (!sec || sec.__naRmpBound) return;
    sec.__naRmpBound = true;
    function update() { if (page.classList.contains('active')) render(); }
    sec.addEventListener('change', function (event) { event.stopPropagation(); update(); });
    sec.addEventListener('input', function (event) { event.stopPropagation(); update(); });
    var details = sec.querySelector('[data-rmp-details]');
    if (details) details.addEventListener('toggle', update);
    var exportButton = sec.querySelector('[data-rmp-export]');
    if (exportButton) exportButton.addEventListener('click', function () {
      if (!ownerAllowed()) { render(); return; }
      if (!render() || !renderedReport) return;
      var report = renderedReport;
      var url = root.URL.createObjectURL(new root.Blob([toCsv(report)], { type: 'text/csv;charset=utf-8' }));
      var link = element('a'); link.href = url;
      link.download = 'medios-pago-turno-' + report.range.desde + '-a-' + report.range.hasta + '.csv';
      try { sec.appendChild(link); link.click(); }
      finally { link.remove(); root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000); }
    });
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { if (!ownerAllowed()) render(); else update(); });
    ['na:canonical-updated', 'focus'].forEach(function (event) { root.addEventListener(event, update); });
    update();
  }
  root.NA_REPORTE_MEDIO_PAGO = Object.freeze({ buildReport: buildReport, toCsv: toCsv, money: money, render: render, featureUnlocked: featureUnlocked });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NA_REPORTE_MEDIO_PAGO;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
