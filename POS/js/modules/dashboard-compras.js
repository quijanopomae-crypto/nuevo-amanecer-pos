/* Dashboard de compras (#168): este mes contra el anterior, en hora de Lima. Solo dueño y solo lectura.
 * Fuente: GET /auth/purchases (la misma consulta de Historial de compras) en modo nube;
 * en modo local, los ingresos de compra del kardex de este dispositivo. Nunca escribe.
 */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageDashboardCompras';
  var READ_PATH = '/auth/purchases';
  function text(value) { return value == null ? '' : String(value).trim(); }
  function normalize(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function quantity(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || text(value) === '') return null;
    var n = Number(value); return Number.isFinite(n) && n > 0 ? n : null;
  }
  function cents(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || text(value) === '') return null;
    var n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }
  // Timestamps sin zona = hora de Lima (igual que Historial de compras). Devuelve 'YYYY-MM' en Lima.
  function limaMonth(value) {
    var ms;
    if (typeof value === 'number') ms = value;
    else {
      var raw = text(value).replace(' ', 'T');
      if (!raw) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00';
      if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += '-05:00';
      ms = Date.parse(raw);
    }
    if (!Number.isFinite(ms)) return '';
    return new Date(ms - 5 * 3600000).toISOString().slice(0, 7);
  }
  function previousMonth(month) {
    var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + String(m).padStart(2, '0');
  }
  function months(now) {
    var current = limaMonth(now === undefined ? Date.now() : now);
    if (!current) throw new RangeError('Fecha de referencia inválida');
    return { current: current, previous: previousMonth(current) };
  }
  function purchaseMovement(move) {
    if (!move || text(move.movement_type || move.type).toUpperCase() !== 'ENTRADA') return false;
    return move.source === 'OCR_PURCHASE' || /^compra(?:\s|$)/.test(normalize(move.reason));
  }
  function moveKey(m) { return text(m.operation_id || m.operationId || (m.source === 'OCR_PURCHASE' ? m.referenceId : '')); }
  function productIdOf(x) { return text(x && (x.product_id != null ? x.product_id : x.productId)); }

  // Convierte compras del servidor y/o movimientos locales en líneas { month, purchase, supplier, productId, totalCents|null }.
  // Compra no aplicada: solo cuentan las líneas que un movimiento confirma (misma regla que Historial de compras).
  function collectLines(purchases, movements) {
    var lines = [], registered = new Set(), applied = new Set(), excludedLines = 0;
    movements = Array.isArray(movements) ? movements : [];
    movements.forEach(function (m) { if (purchaseMovement(m) && moveKey(m)) applied.add(JSON.stringify([moveKey(m), productIdOf(m)])); });
    (Array.isArray(purchases) ? purchases : []).forEach(function (p) {
      if (!p || typeof p !== 'object' || !p.purchase_id) return;
      var month = limaMonth(p.created_at);
      (Array.isArray(p.lines) ? p.lines : []).forEach(function (line) {
        if (!line || cents(line.line_number) == null) return;
        var pid = productIdOf(line), key = JSON.stringify([text(p.purchase_id) + ':' + Number(line.line_number), pid]);
        registered.add(key);
        var qty = quantity(line.quantity); if (qty == null) return;
        if (p.status !== 'aplicada' && !applied.has(key)) { excludedLines++; return; }
        var unit = cents(line.unit_cost_cents), total = unit == null ? null : Math.round(qty * unit);
        lines.push({ month: month, purchase: text(p.purchase_id), supplier: text(p.supplier), productId: pid, totalCents: Number.isSafeInteger(total) ? total : null });
      });
    });
    var seen = new Set();
    movements.forEach(function (m) {
      if (!purchaseMovement(m)) return;
      var qty = quantity(m.quantity != null ? m.quantity : m.delta); if (qty == null) return;
      var op = moveKey(m), identity = op || text(m.movement_id || m.id), pid = productIdOf(m);
      if (!identity) return;
      var key = JSON.stringify([identity, pid]);
      if (registered.has(key) || seen.has(key)) return;
      seen.add(key);
      var unit = cents(m.unit_cost_cents), total = unit == null ? null : Math.round(qty * unit);
      var at = m.created_at || m.timestamp || (m.fecha ? m.fecha + 'T' + (m.hora24 || '00:00:00') : '');
      // Una compra = la parte antes de ':' del operation_id (compra:línea); sin él, cada movimiento.
      lines.push({ month: limaMonth(at), purchase: op ? op.split(':')[0] : identity, supplier: text(m.supplier), productId: pid, totalCents: Number.isSafeInteger(total) ? total : null });
    });
    return { lines: lines, excludedLines: excludedLines };
  }
  function change(current, previous) {
    if (!previous) return current ? null : 0; // null = sin base de comparación
    return (current - previous) / previous;
  }
  function group(lines, keyFn, labelFn) {
    var map = new Map();
    lines.forEach(function (l) {
      if (l.totalCents == null) return;
      var key = keyFn(l), row = map.get(key);
      if (!row) { row = { key: key, label: labelFn(l), current: 0, previous: 0 }; map.set(key, row); }
      row[l.isCurrent ? 'current' : 'previous'] += l.totalCents;
    });
    return Array.from(map.values()).map(function (r) { r.change = change(r.current, r.previous); return r; })
      .sort(function (a, b) { return b.current - a.current || b.previous - a.previous || a.label.localeCompare(b.label, 'es'); });
  }
  // Pura. Montos en céntimos.
  function calculate(purchases, movements, products, options) {
    options = options || {};
    var m = options.months || months(options.now);
    var byId = new Map();
    (Array.isArray(products) ? products : []).forEach(function (p) { if (p && p.id != null && !byId.has(text(p.id))) byId.set(text(p.id), p); });
    var collected = collectLines(purchases, movements);
    var lines = collected.lines.filter(function (l) { return l.month === m.current || l.month === m.previous; })
      .map(function (l) { return Object.assign({}, l, { isCurrent: l.month === m.current }); });
    function period(isCurrent) {
      var own = lines.filter(function (l) { return l.isCurrent === isCurrent; }), ids = new Set(), total = 0, missing = 0;
      own.forEach(function (l) { ids.add(l.purchase); if (l.totalCents == null) missing++; else total += l.totalCents; });
      return { totalCents: total, count: ids.size, linesWithoutCost: missing };
    }
    var cur = period(true), prev = period(false);
    function product(l) { return byId.get(l.productId); }
    return {
      months: m, current: cur, previous: prev,
      totalChange: change(cur.totalCents, prev.totalCents), countChange: change(cur.count, prev.count),
      products: group(lines, function (l) { return 'p:' + l.productId; }, function (l) { var p = product(l); return text(p && (p.name || p.nombre)) || l.productId || 'Producto sin nombre'; }),
      categories: group(lines, function (l) { var p = product(l); return 'c:' + normalize(p && (p.cat || p.categoria)); }, function (l) { var p = product(l); return text(p && (p.cat || p.categoria)) || 'Sin categoría'; }),
      suppliers: group(lines, function (l) { return 's:' + normalize(l.supplier); }, function (l) { return l.supplier || 'Sin proveedor registrado'; }),
      excludedLines: collected.excludedLines
    };
  }
  // Mismo formato que el comprobante (#872): S/ con dos decimales y comas de miles.
  function formatMoney(centsValue) {
    var n = (Number(centsValue) || 0) / 100, sign = n < 0 ? '-' : '';
    return sign + 'S/ ' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatChange(value) {
    if (value === null) return 'Nuevo';
    var pct = (value * 100).toFixed(1);
    if (pct === '0.0' || pct === '-0.0') return '0.0%';
    return (value > 0 ? '+' : '') + pct + '%';
  }
  var MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function monthLabel(month) { return MONTH_NAMES[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4); }

  // Falla cerrada: sin NA_ROLES, sin isOwner, con error o distinto de true, no es dueño.
  // NA_ROLES.isOwner() ya exige rol confirmado por el servidor en modo nube.
  function isOwner() {
    try {
      var roles = root.NA_ROLES;
      if (!roles || typeof roles.isOwner !== 'function') return false;
      return roles.isOwner() === true;
    } catch (_) { return false; }
  }
  function policyReady() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  function screenAllowed() { return isOwner() && policyReady(); }
  function cloudEnabled() {
    try { var api = root.NuevoAmanecerCanonical; return !!(api && typeof api.enabled === 'function' && api.enabled()); } catch (_) { return false; }
  }
  function localSources() {
    var api = root.NuevoAmanecerCanonical, snap = {};
    try { snap = (api && typeof api.snapshot === 'function' ? api.snapshot() : {}) || {}; } catch (_) { snap = {}; }
    /* global productos, inventoryMovements */
    var products = typeof productos !== 'undefined' && Array.isArray(productos) ? productos : (Array.isArray(snap.products) ? snap.products : []);
    var movements = cloudEnabled() ? (Array.isArray(snap.inventoryMovements) ? snap.inventoryMovements : [])
      : (typeof inventoryMovements !== 'undefined' && Array.isArray(inventoryMovements) ? inventoryMovements : []);
    return { products: products, movements: movements };
  }
  async function readPurchases() {
    if (!screenAllowed()) throw new Error('Sin permiso');
    if (!cloudEnabled()) return { purchases: [], ready: true, truncated: false, cloud: false };
    if (!root.NA_ROLES || typeof root.NA_ROLES.api !== 'function') throw new Error('Consulta no disponible');
    var result = await root.NA_ROLES.api(READ_PATH, undefined, 'GET');
    if (!screenAllowed()) throw new Error('Sin permiso');
    if (!result || !Array.isArray(result.purchases)) throw new Error('Respuesta de compras no válida');
    return { purchases: result.purchases, ready: result.ready !== false, truncated: result.truncated === true || result.purchases.length >= 300, cloud: true };
  }

  function el(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function changeNode(value) {
    var node = el('span', 'dc-change', formatChange(value));
    node.setAttribute('data-dc-trend', value === null ? 'nuevo' : value > 0 ? 'sube' : value < 0 ? 'baja' : 'igual');
    return node;
  }
  function table(title, rows, r, limit) {
    var section = el('section', 'dc-section');
    section.appendChild(el('h2', '', title));
    if (!rows.length) { section.appendChild(el('p', 'dc-empty', 'Sin compras con costo en estos dos meses.')); return section; }
    var t = el('table', 'dc-table'), head = el('thead'), hr = el('tr'), body = el('tbody');
    var labels = [title.split(' ')[0] === 'Proveedores' ? 'Proveedor' : title.indexOf('categor') >= 0 ? 'Categoría' : 'Producto', monthLabel(r.months.current), monthLabel(r.months.previous), 'Cambio'];
    labels.forEach(function (l) { var th = el('th', '', l); th.scope = 'col'; hr.appendChild(th); });
    head.appendChild(hr);
    rows.slice(0, limit || rows.length).forEach(function (row) {
      var tr = el('tr');
      [row.label, formatMoney(row.current), formatMoney(row.previous)].forEach(function (v, i) { var td = el('td', '', v); td.setAttribute('data-label', labels[i]); tr.appendChild(td); });
      var td = el('td'); td.setAttribute('data-label', 'Cambio'); td.appendChild(changeNode(row.change)); tr.appendChild(td);
      body.appendChild(tr);
    });
    t.appendChild(head); t.appendChild(body); section.appendChild(t);
    if (limit && rows.length > limit) section.appendChild(el('p', 'dc-note', 'Mostrando ' + limit + ' de ' + rows.length + '.'));
    return section;
  }
  var state = { loaded: false, response: null, pending: false, ticket: 0 };
  function nodes() {
    var page = root.document && root.document.getElementById(PAGE_ID);
    return page ? { page: page, host: page.querySelector('[data-dc-report]'), status: page.querySelector('[data-dc-status]'), controls: page.querySelector('[data-dc-controls]') } : null;
  }
  function denied(n) {
    state.ticket++; state.loaded = false; state.response = null; state.pending = false;
    if (n.controls) n.controls.hidden = true;
    n.status.textContent = '';
    n.host.replaceChildren(el('p', 'dc-notice', 'Sin permiso. Pídele acceso al dueño.'));
    return false;
  }
  function render() {
    var n = nodes(); if (!n || !n.host || !n.status) return false;
    if (!screenAllowed()) return denied(n);
    if (n.controls) n.controls.hidden = false;
    if (!state.loaded) { load(); return false; }
    var resp = state.response;
    if (!resp.ready) { n.status.textContent = 'El registro de compras todavía no está disponible. Vuelve a intentar más tarde.'; n.host.replaceChildren(); return false; }
    var local = localSources();
    var r = calculate(resp.purchases, local.movements, local.products, {});
    n.status.textContent = monthLabel(r.months.current) + ' contra ' + monthLabel(r.months.previous) + ' · hora de Lima · ' + (resp.cloud ? 'compras registradas en la nube e ingresos de compra del inventario' : 'ingresos de compra registrados en este dispositivo');
    var summary = el('div', 'dc-summary');
    [['Total comprado', formatMoney(r.current.totalCents), formatMoney(r.previous.totalCents), r.totalChange],
      ['Número de compras', String(r.current.count), String(r.previous.count), r.countChange]].forEach(function (c) {
      var card = el('div', 'dc-card');
      card.appendChild(el('span', '', c[0] + ' · ' + monthLabel(r.months.current)));
      card.appendChild(el('strong', '', c[1]));
      var foot = el('p', 'dc-prev', 'Mes anterior: ' + c[2] + ' · ');
      foot.appendChild(changeNode(c[3]));
      card.appendChild(foot);
      summary.appendChild(card);
    });
    var notices = el('div', 'dc-notices');
    function notice(v) { notices.appendChild(el('p', 'dc-notice', v)); }
    if (resp.truncated) notice('El servidor devolvió solo las 300 compras más recientes: el mes anterior puede estar incompleto.');
    var missing = r.current.linesWithoutCost + r.previous.linesWithoutCost;
    if (missing) notice(missing + ' línea(s) sin costo registrado: cuentan como compra, pero no suman al total.');
    if (r.excludedLines) notice(r.excludedLines + ' línea(s) de compras sin aplicar no se cuentan.');
    n.host.replaceChildren(summary, notices,
      table('Productos con más compra', r.products, r, 10),
      table('Compras por categoría', r.categories, r, 10),
      table('Proveedores', r.suppliers, r));
    return true;
  }
  async function load() {
    var n = nodes(); if (!n || state.pending || !screenAllowed()) return;
    var own = ++state.ticket; state.pending = true;
    n.status.textContent = 'Cargando compras…'; n.host.replaceChildren();
    try {
      var resp = await readPurchases();
      if (own !== state.ticket || !screenAllowed()) return;
      state.response = resp; state.loaded = true; state.pending = false;
      render();
    } catch (_) {
      if (own !== state.ticket) return;
      state.pending = false;
      if (!screenAllowed()) { denied(n); return; }
      n.status.textContent = 'No se pudieron cargar las compras. Revisa la conexión y vuelve a intentar.'; n.host.replaceChildren();
    } finally { if (own === state.ticket) state.pending = false; }
  }
  function refresh() { state.loaded = false; state.response = null; state.ticket++; state.pending = false; return render(); }
  function init() {
    var n = nodes(); if (!n) return;
    var btn = n.page.querySelector('[data-dc-refresh]');
    if (btn) btn.addEventListener('click', refresh);
    function update() {
      if (!screenAllowed()) { denied(n); return; }
      if (n.page.classList.contains('active')) render();
      else { state.ticket++; state.loaded = false; state.response = null; state.pending = false; n.host.replaceChildren(); n.status.textContent = ''; }
    }
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(n.page, { attributes: true, attributeFilter: ['class'] });
    if (typeof root.addEventListener === 'function') root.addEventListener('na:role', update);
    update();
  }
  root.NA_DASHBOARD_COMPRAS = Object.freeze({ calculate: calculate, collectLines: collectLines, months: months, limaMonth: limaMonth, formatMoney: formatMoney, formatChange: formatChange, isOwner: isOwner, render: render, refresh: refresh });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NA_DASHBOARD_COMPRAS;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(globalThis);
