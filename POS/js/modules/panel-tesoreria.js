/* #164 Panel de tesorería (solo dueño, solo lectura).
   Turnos de caja abiertos: efectivo esperado en cada caja y lo cobrado por Yape, Plin y transferencia
   que todavía no se cerró (pendiente de acreditar). Sin tarjeta: hoy no existe como forma de pago.
   Fuente: réplica canónica local vía NuevoAmanecerCashHistory.summarize (no llama al Worker, no escribe). */
(function (root) {
  'use strict';

  var PAGE_ID = 'pageReporteArqueo'; // vive dentro del reporte de arqueo, sin pantalla nueva
  var FEATURE_ID = 'dashboard-tesoreria';
  var DIGITAL = [['yape', 'Yape'], ['plin', 'Plin'], ['transferencia', 'Transferencia']];
  function text(value) { return String(value == null ? '' : value); }
  function int(value) { var n = Number(value); return Number.isSafeInteger(n) ? n : 0; }
  function dateLabel(day) { return day ? day.split('-').reverse().join('/') : ''; }
  // S/ 1,234.50: toFixed(2) con separador de miles por coma.
  function money(cents) {
    var n = int(cents), parts = (Math.abs(n) / 100).toFixed(2).split('.');
    return (n < 0 ? '-' : '') + 'S/ ' + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
  }

  function buildPanel(snapshot, options) {
    options = options || {};
    var history = options.history || root.NuevoAmanecerCashHistory;
    if (!history || typeof history.summarize !== 'function') throw new Error('Historial de caja no disponible.');
    var cashiers = typeof history.cashierMap === 'function' ? history.cashierMap() : {};
    var rows = history.summarize(snapshot || {}, cashiers).filter(function (r) { return r && r.status === 'OPEN'; }).map(function (r) {
      var people = [r.cajero, r.openedByName].map(function (v) { return text(v).trim(); }).filter(Boolean);
      var digital = {};
      DIGITAL.forEach(function (m) { digital[m[0]] = int(r.metodos && r.metodos[m[0]]); });
      var pendiente = DIGITAL.reduce(function (sum, m) { return sum + digital[m[0]]; }, 0);
      var efectivo = int(r.esperado);
      return { sessionId: text(r.sessionId), fecha: text(r.fecha), fechaLabel: dateLabel(r.fecha), apertura: text(r.apertura),
        cajero: people[0] || 'No registrado', efectivo: efectivo, digital: digital, pendiente: pendiente, total: efectivo + pendiente };
    }).sort(function (a, b) { return (a.fecha + a.apertura).localeCompare(b.fecha + b.apertura) || a.sessionId.localeCompare(b.sessionId); });
    var totals = { count: rows.length, efectivo: 0, pendiente: 0, total: 0, digital: {} };
    DIGITAL.forEach(function (m) { totals.digital[m[0]] = 0; });
    rows.forEach(function (r) {
      totals.efectivo += r.efectivo; totals.pendiente += r.pendiente; totals.total += r.total;
      DIGITAL.forEach(function (m) { totals.digital[m[0]] += r.digital[m[0]]; });
    });
    return { rows: rows, totals: totals };
  }

  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  function policyReady() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  function ownerAllowed() { return isOwner() && policyReady(); }
  // Candado propio: falla cerrado si no hay permisos, si da error o si no es exactamente false.
  function featureUnlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(FEATURE_ID) === false); } catch (_) { return false; }
  }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function section(page) { return page && page.querySelector('[data-pt-section]'); }

  function render() {
    var page = root.document && root.document.getElementById(PAGE_ID), sec = section(page);
    if (!sec) return false;
    var content = sec.querySelector('[data-pt-content]'), status = sec.querySelector('[data-pt-status]');
    var authorized = ownerAllowed() && featureUnlocked();
    sec.hidden = !authorized;
    content.replaceChildren();
    status.textContent = '';
    if (!authorized) return false;
    var details = sec.querySelector('[data-pt-details]');
    if (details && !details.open) return false; // plegado: no calcula nada hasta abrirlo
    var panel, client = root.NuevoAmanecerCanonical;
    try { panel = buildPanel(client && typeof client.snapshot === 'function' ? client.snapshot() : {}); }
    catch (_) { status.textContent = 'No se pudo leer la caja de este dispositivo.'; return false; }
    status.textContent = 'Turnos abiertos cargados en este dispositivo · hora de Lima';
    var cards = element('div', 'pt-cards');
    [['Efectivo en cajas', panel.totals.efectivo], ['Pendiente de acreditar', panel.totals.pendiente], ['Total', panel.totals.total]].forEach(function (c) {
      var card = element('div', 'pt-card'); card.appendChild(element('span', '', c[0])); card.appendChild(element('strong', '', money(c[1]))); cards.appendChild(card);
    });
    content.appendChild(cards);
    if (!panel.rows.length) { content.appendChild(element('p', 'pt-empty', 'No hay turnos de caja abiertos.')); return true; }
    var wrap = element('div', 'pt-table-wrap'); wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Tesorería por caja abierta');
    var table = element('table', 'pt-table'), head = element('thead'), tr = element('tr');
    ['Caja abierta', 'Cajero', 'Efectivo'].concat(DIGITAL.map(function (m) { return m[1]; }), ['Por acreditar', 'Total']).forEach(function (label) {
      var th = element('th', '', label); th.scope = 'col'; tr.appendChild(th);
    });
    head.appendChild(tr); table.appendChild(head);
    function amountCells(line, src) {
      line.appendChild(element('td', 'pt-num', money(src.efectivo)));
      DIGITAL.forEach(function (m) { line.appendChild(element('td', 'pt-num', money(src.digital[m[0]]))); });
      line.appendChild(element('td', 'pt-num', money(src.pendiente)));
      line.appendChild(element('td', 'pt-num pt-total', money(src.total)));
    }
    var body = element('tbody');
    panel.rows.forEach(function (r) {
      var line = element('tr'); line.setAttribute('data-session-id', r.sessionId);
      var th = element('th', '', r.fechaLabel); th.scope = 'row'; th.appendChild(element('small', '', 'desde ' + (r.apertura || '—')));
      line.appendChild(th); line.appendChild(element('td', '', r.cajero)); amountCells(line, r); body.appendChild(line);
    });
    table.appendChild(body);
    var foot = element('tfoot'), total = element('tr');
    var label = element('th', '', 'Total · ' + panel.totals.count + (panel.totals.count === 1 ? ' caja' : ' cajas'));
    label.scope = 'row'; label.colSpan = 2; total.appendChild(label);
    amountCells(total, panel.totals); foot.appendChild(total); table.appendChild(foot);
    wrap.appendChild(table); content.appendChild(wrap);
    content.appendChild(element('p', 'pt-note', 'Efectivo = efectivo esperado en la caja según el sistema. Por acreditar = Yape, Plin y transferencias cobrados en turnos que siguen abiertos. Lo vendido al crédito no se cuenta.'));
    return true;
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID), sec = section(page);
    if (!sec || sec.__naPtBound) return;
    sec.__naPtBound = true;
    function update() { if (page.classList.contains('active')) render(); }
    var details = sec.querySelector('[data-pt-details]');
    if (details) details.addEventListener('toggle', update);
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { if (!ownerAllowed()) render(); else update(); });
    ['na:canonical-updated', 'focus'].forEach(function (event) { root.addEventListener(event, update); });
    update();
  }
  root.NA_PANEL_TESORERIA = Object.freeze({ buildPanel: buildPanel, money: money, render: render, featureUnlocked: featureUnlocked });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NA_PANEL_TESORERIA;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
