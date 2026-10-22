/* Nuevo Amanecer — Movimientos de cuenta del cliente (solo lectura). Complementa el bloque «Estado de cuenta» del ticket (share-receipt.js), que solo resume la deuda.
 * Lista cronológica de cargos (créditos) y abonos de un cliente, con saldo acumulado.
 * Reutiliza los créditos ya cargados (sin anulados ni pagos revertidos). No muestra costos,
 * no escribe datos y no llama al Worker. Dueño y empleado, como la ficha del cliente. */
(function (root) {
  'use strict';
  var doc = root.document;
  var PANEL_ID = 'naEstadoCuenta', BUTTON_ID = 'naEstadoCuentaBtn';
  var open = false, selected = '', timer = null, initialized = false;

  function role() {
    try { var r = root.NA_ROLES; if (!r) return ''; if (r.isOwner() === true) return 'owner'; return r.role === 'empleado' ? 'empleado' : ''; }
    catch (_) { return ''; }
  }
  // Miles con coma y dos decimales, igual que #872.
  function money(v) { var n = Number(v) || 0; return (n < 0 ? '-' : '') + 'S/ ' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // Fecha en Lima (UTC-5 fijo). ISO con hora → se convierte; solo día → se usa tal cual.
  function limaMoment(value, fallbackDay) {
    var raw = String(value || '');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
      var ms = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : raw + 'Z').getTime();
      if (Number.isFinite(ms)) { var l = new Date(ms - 5 * 3600e3).toISOString(); return { key: l.slice(0, 16), day: l.slice(0, 10), time: l.slice(11, 16) }; }
    }
    var day = String(fallbackDay || raw).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? { key: day + 'T00:00', day: day, time: '' } : { key: '', day: '', time: '' };
  }
  function dayLabel(d) { return d ? d.split('-').reverse().join('/') : 'Sin fecha'; }
  function cents(v) { return Math.round((Number(v) || 0) * 100); }

  function buildStatement(client, api) {
    if (!client || !api || typeof api.summarizeClient !== 'function') throw new Error('Movimientos no disponibles');
    var credits = api.summarizeClient(client, true).all || [];
    var moves = [];
    credits.forEach(function (cr) {
      var at = limaMoment(cr.timestamp || cr.created_at, cr.fecha);
      moves.push({ type: 'cargo', key: at.key, day: at.day, time: at.time, detail: String(cr.desc || 'Venta a crédito'), cents: cents(cr.monto) });
      (Array.isArray(cr.pagos) ? cr.pagos : []).forEach(function (p) {
        if (!p || String(p.status || '').toUpperCase() === 'REVERTED' || p.reversalId) return;
        var pa = limaMoment(p.timestamp, p.fecha);
        moves.push({ type: 'abono', key: pa.key, day: pa.day, time: pa.time, detail: 'Abono' + (p.metodo ? ' · ' + p.metodo : ''), cents: cents(p.monto || p.montoPagado) });
      });
    });
    // Mismo instante: primero el cargo y luego su abono.
    moves.sort(function (a, b) { return a.key.localeCompare(b.key) || (a.type === b.type ? 0 : a.type === 'cargo' ? -1 : 1); });
    var bal = 0, charged = 0, paid = 0;
    moves.forEach(function (m) {
      if (m.type === 'cargo') { bal += m.cents; charged += m.cents; } else { bal -= m.cents; paid += m.cents; }
      m.balance = bal / 100; m.amount = m.cents / 100; delete m.cents;
    });
    return { rows: moves, charged: charged / 100, paid: paid / 100, balance: bal / 100 };
  }

  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; }
  function clientsWithCredit() {
    var list = typeof clientes !== 'undefined' && Array.isArray(clientes) ? clientes : [];
    var cr = typeof creditos !== 'undefined' && Array.isArray(creditos) ? creditos : [];
    var ids = new Set(cr.map(function (c) { return String(c && (c.cliId != null ? c.cliId : c.clienteId)); }));
    return list.filter(function (c) { return c && ids.has(String(c.id)); })
      .sort(function (a, b) { return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'); });
  }

  function render() {
    var panel = doc.getElementById(PANEL_ID);
    if (!panel) return false;
    var allowed = !!role();
    panel.hidden = !(allowed && open);
    var select = panel.querySelector('[data-ec-client]'), content = panel.querySelector('[data-ec-content]'), status = panel.querySelector('[data-ec-status]');
    content.replaceChildren();
    if (!allowed || !open) { status.textContent = ''; return false; }
    var list = clientsWithCredit();
    var first = el('option', '', 'Elige un cliente'); first.value = '';
    select.replaceChildren(first);
    list.forEach(function (c) { var o = el('option', '', c.nombre || 'Sin nombre'); o.value = String(c.id); select.appendChild(o); });
    if (!list.some(function (c) { return String(c.id) === selected; })) selected = '';
    select.value = selected;
    if (!selected) { status.textContent = list.length ? 'Elige un cliente para ver sus movimientos.' : 'No hay clientes con créditos.'; return true; }
    var data;
    try { data = buildStatement(list.find(function (c) { return String(c.id) === selected; }), root.NA_CLIENT_CREDIT_ACCOUNTS_V2); }
    catch (_) { status.textContent = 'No se pudo cargar los movimientos.'; return false; }
    status.textContent = data.rows.length ? 'Fechas en hora de Lima · solo lectura' : 'Este cliente no tiene movimientos.';
    var wrap = el('div', 'ec-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Movimientos del cliente');
    var table = el('table', 'ec-table'), head = el('thead'), tr = el('tr');
    ['Fecha', 'Detalle', 'Cargo', 'Abono', 'Saldo'].forEach(function (h) { var th = el('th', '', h); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    var body = el('tbody');
    data.rows.forEach(function (m) {
      var r = el('tr', 'ec-' + m.type);
      var f = el('th', '', dayLabel(m.day)); f.scope = 'row'; if (m.time) f.appendChild(el('small', '', m.time)); r.appendChild(f);
      r.appendChild(el('td', '', m.detail));
      r.appendChild(el('td', 'ec-num', m.type === 'cargo' ? money(m.amount) : '—'));
      r.appendChild(el('td', 'ec-num', m.type === 'abono' ? money(m.amount) : '—'));
      r.appendChild(el('td', 'ec-num', money(m.balance)));
      body.appendChild(r);
    });
    table.appendChild(body);
    var foot = el('p', 'ec-footer', 'Cargos ' + money(data.charged) + ' · Abonos ' + money(data.paid) + ' · Saldo ' + money(data.balance));
    foot.dataset.ecTotal = '';
    wrap.appendChild(table);
    content.append(wrap, foot);
    return true;
  }

  function ensureUi() {
    var bar = doc.querySelector('#pageClientes .filter-bar');
    if (!bar) return;
    var btn = doc.getElementById(BUTTON_ID);
    if (!btn) {
      btn = el('button', 'f-select ec-entry', 'Movimientos de cuenta');
      btn.id = BUTTON_ID; btn.type = 'button';
      btn.setAttribute('aria-controls', PANEL_ID); btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function () { open = !open; btn.setAttribute('aria-expanded', String(open)); render(); });
      var panel = el('section', 'ec-panel'); panel.id = PANEL_ID; panel.hidden = true; panel.setAttribute('aria-label', 'Movimientos de cuenta');
      var label = el('label', 'ec-label', 'Cliente');
      var select = el('select', 'ec-select'); select.dataset.ecClient = ''; select.setAttribute('aria-label', 'Cliente');
      select.addEventListener('change', function () { selected = select.value; render(); });
      label.appendChild(select);
      var status = el('p', 'ec-status'); status.dataset.ecStatus = ''; status.setAttribute('aria-live', 'polite');
      var content = el('div', 'ec-content'); content.dataset.ecContent = '';
      panel.append(label, status, content);
      bar.parentNode.insertBefore(panel, bar.nextSibling);
      bar.parentNode.insertBefore(btn, bar.nextSibling);
    }
    var allowed = !!role();
    btn.hidden = !allowed;
    if (!allowed) { open = false; btn.setAttribute('aria-expanded', 'false'); }
    render();
  }
  function schedule() { if (timer !== null) return; timer = root.setTimeout(function () { timer = null; ensureUi(); }, 0); }
  function init() {
    if (!doc || initialized || !doc.getElementById('pageClientes')) return;
    initialized = true;
    ['na:role', 'na:canonical-updated', 'na:canonical-payment-receipt', 'focus', 'pageshow', 'storage'].forEach(function (n) { root.addEventListener(n, schedule); });
    ensureUi();
  }
  root.NA_CLIENTE_ESTADO_CUENTA = Object.freeze({ buildStatement: buildStatement, money: money, render: ensureUi, init: init });
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true }); else init();
    root.addEventListener('load', init, { once: true });
  }
})(globalThis);
