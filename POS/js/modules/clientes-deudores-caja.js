/* Nuevo Amanecer — «Clientes que deben» para el cajero (rol empleado).
 * Solo lectura y solo en el navegador: reutiliza los saldos de V2 (mismo cálculo
 * que el Reporte de deuda del dueño) y los vencimientos de cada crédito. No muestra
 * costos, no escribe datos y no cambia permisos ni rutas del Worker.
 * El dueño sigue usando su «Reporte de deuda»; este botón no se le muestra. */
(function (root) {
  'use strict';

  var doc = root.document;
  var PANEL_ID = 'naDeudoresCaja';
  var BUTTON_ID = 'naDeudoresCajaBtn';
  var SOON_DAYS = 7;
  var FILTERS = [
    ['todos', 'Todos'], ['vencidas', 'Vencidas'], ['por-vencer', 'Vencen en 7 días'], ['al-dia', 'Al día']
  ];
  var filter = 'todos';
  var open = false;
  var timer = null;
  var initialized = false;

  function isCashier() {
    try { return !!(root.NA_ROLES && root.NA_ROLES.role === 'empleado' && root.NA_ROLES.isOwner() !== true); }
    catch (_) { return false; }
  }

  // Miles con coma y dos decimales, igual que #872.
  function money(value) {
    return 'S/ ' + Number(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // Hoy en Lima (UTC-5 fijo, sin horario de verano), independiente del aparato.
  function limaToday(nowMs) {
    return new Date((typeof nowMs === 'number' ? nowMs : Date.now()) - 5 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function addDays(day, n) {
    var d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
  }
  function validDay(value) {
    var day = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
    var p = new Date(day + 'T12:00:00Z');
    return Number.isFinite(p.getTime()) && p.toISOString().slice(0, 10) === day ? day : '';
  }
  function dateLabel(day) { return day ? day.split('-').reverse().join('/') : 'Sin vencimiento'; }
  function outstanding(c) { return Math.max(0, Number(((Number(c.monto) || 0) - (Number(c.pagado) || 0)).toFixed(2))); }

  function statusOf(row, today) {
    if (row.overdueDebt > 0 || (row.nextDue && row.nextDue < today)) return 'vencidas';
    if (row.nextDue && row.nextDue <= addDays(today, SOON_DAYS)) return 'por-vencer';
    return 'al-dia';
  }
  var STATUS_LABEL = { 'vencidas':'Vencida', 'por-vencer':'Vence pronto', 'al-dia':'Al día' };

  // Filas: cliente, saldo, deuda vencida, próximo vencimiento y estado. Nada de costos.
  function buildList(clients, api, pending, nowMs) {
    var report = root.NA_CLIENTES_REPORTE_DEUDA;
    if (!report || typeof report.buildReport !== 'function') throw new Error('Resumen no disponible');
    var base = report.buildReport(clients, api, pending, 'vencida');
    var byId = {};
    (Array.isArray(clients) ? clients : []).forEach(function (c) { if (c) byId[String(c.id)] = c; });
    var today = limaToday(nowMs);
    var rows = base.rows.map(function (r) {
      var summary = api.summarizeClient(byId[String(r.clientId)], true);
      var next = '';
      (Array.isArray(summary && summary.active) ? summary.active : []).forEach(function (c) {
        if (!c || outstanding(c) <= 0.001) return;
        var due = validDay(c.vence);
        if (due && (!next || due < next)) next = due;
      });
      var row = { clientId:r.clientId, name:r.name, balance:r.balance, overdueDebt:r.overdueDebt, nextDue:next };
      row.status = statusOf(row, today);
      return row;
    });
    return { rows:rows, today:today };
  }

  function applyFilter(rows, mode) {
    return mode === 'todos' ? rows.slice() : rows.filter(function (r) { return r.status === mode; });
  }

  function el(tag, className, text) {
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = String(text);
    return n;
  }
  function cell(row, label, value, cls) {
    var c = el('span', 'dc-cell' + (cls ? ' ' + cls : ''));
    c.append(el('span', 'dc-label', label), el('strong', 'dc-value', value));
    row.append(c);
  }

  function pending() {
    var c = root.NuevoAmanecerCanonical;
    return c && typeof c.pendingSnapshot === 'function' ? c.pendingSnapshot() : null;
  }

  function render() {
    var panel = doc.getElementById(PANEL_ID);
    if (!panel) return false;
    var allowed = isCashier();
    panel.hidden = !(allowed && open);
    var content = panel.querySelector('[data-dc-content]');
    var status = panel.querySelector('[data-dc-status]');
    content.replaceChildren();
    if (!allowed || !open) { status.textContent = ''; return false; }
    var data;
    try {
      data = buildList(typeof clientes !== 'undefined' ? clientes : [], root.NA_CLIENT_CREDIT_ACCOUNTS_V2, pending());
    } catch (_) {
      status.textContent = 'No se pudo cargar la lista. Cierra y vuelve a abrirla para reintentar.';
      return false;
    }
    panel.querySelectorAll('[data-dc-filter]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.dcFilter === filter ? 'true' : 'false');
    });
    var rows = applyFilter(data.rows, filter);
    status.textContent = rows.length ? '' : 'No hay clientes en este filtro.';
    var list = el('ul', 'dc-list');
    list.setAttribute('aria-label', 'Clientes que deben');
    rows.forEach(function (r) {
      var li = el('li', 'dc-item');
      var b = el('button', 'dc-row dc-' + r.status);
      b.type = 'button';
      b.dataset.clientId = String(r.clientId);
      b.setAttribute('aria-label', 'Abrir ficha de ' + r.name + ', saldo ' + money(r.balance) +
        ', vencido ' + money(r.overdueDebt) + ', próximo vencimiento ' + dateLabel(r.nextDue) + ', ' + STATUS_LABEL[r.status]);
      cell(b, 'Cliente', r.name, 'dc-client');
      cell(b, 'Saldo', money(r.balance), 'dc-balance');
      cell(b, 'Vencido', money(r.overdueDebt), r.overdueDebt > 0 ? 'dc-overdue' : '');
      cell(b, 'Próximo vencimiento', dateLabel(r.nextDue));
      cell(b, 'Estado', STATUS_LABEL[r.status], 'dc-status');
      b.addEventListener('click', function () {
        if (typeof root.naCanonOpenClientAccount === 'function') root.naCanonOpenClientAccount(r.clientId);
      });
      li.append(b);
      list.append(li);
    });
    var cents = rows.reduce(function (s, r) { return s + Math.round(r.balance * 100); }, 0);
    var foot = el('p', 'dc-footer');
    foot.dataset.dcTotal = '';
    foot.textContent = rows.length + (rows.length === 1 ? ' cliente' : ' clientes') + ' · Total ' + money(cents / 100) +
      ' · Fechas en hora de Lima, hoy ' + dateLabel(data.today);
    content.append(list, foot);
    return true;
  }

  function ensureUi() {
    var page = doc.getElementById('pageClientes');
    var bar = doc.querySelector('#pageClientes .filter-bar');
    if (!page || !bar) return;
    var btn = doc.getElementById(BUTTON_ID);
    if (!btn) {
      btn = el('button', 'f-select dc-entry', 'Clientes que deben');
      btn.id = BUTTON_ID;
      btn.type = 'button';
      btn.setAttribute('aria-controls', PANEL_ID);
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () { open = !open; btn.setAttribute('aria-expanded', String(open)); render(); });
      var panel = el('section', 'dc-panel');
      panel.id = PANEL_ID;
      panel.hidden = true;
      panel.setAttribute('aria-label', 'Clientes que deben');
      var group = el('div', 'dc-filters');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Filtrar por vencimiento');
      FILTERS.forEach(function (f) {
        var fb = el('button', 'dc-filter', f[1]);
        fb.type = 'button';
        fb.dataset.dcFilter = f[0];
        fb.setAttribute('aria-pressed', f[0] === filter ? 'true' : 'false');
        fb.addEventListener('click', function () { filter = f[0]; render(); });
        group.append(fb);
      });
      var status = el('p', 'dc-status-msg');
      status.dataset.dcStatus = '';
      status.setAttribute('aria-live', 'polite');
      var content = el('div', 'dc-content');
      content.dataset.dcContent = '';
      panel.append(group, status, content);
      bar.parentNode.insertBefore(panel, bar.nextSibling);
      bar.parentNode.insertBefore(btn, bar.nextSibling);
    }
    var allowed = isCashier();
    btn.hidden = !allowed;
    if (!allowed) { open = false; btn.setAttribute('aria-expanded', 'false'); }
    render();
  }

  function schedule() {
    if (timer !== null) return;
    timer = root.setTimeout(function () { timer = null; ensureUi(); }, 0);
  }

  function init() {
    if (!doc || initialized || !doc.getElementById('pageClientes')) return;
    initialized = true;
    ['na:role', 'na:canonical-updated', 'na:canonical-payment-receipt', 'online', 'offline', 'focus', 'pageshow', 'storage']
      .forEach(function (n) { root.addEventListener(n, schedule); });
    ensureUi();
  }

  root.NA_CLIENTES_DEUDORES_CAJA = Object.freeze({ buildList:buildList, applyFilter:applyFilter, money:money,
    limaToday:limaToday, render:ensureUi, init:init });
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once:true });
    else init();
    root.addEventListener('load', init, { once:true });
  }
})(globalThis);
