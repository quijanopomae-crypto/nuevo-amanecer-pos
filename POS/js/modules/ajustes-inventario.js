/* Ajustes de inventario con motivo (id ajustes-inventario). Registra mermas, roturas, vencidos y
 * correcciones con tipo, usuario (Nombre · ID), fecha (Lima) y nota. NO escribe stock directamente:
 * - CANON activo: NuevoAmanecerCanonical.adjustInventory con movement_type ENTRADA/SALIDA (el Worker
 *   ya los acepta; sin cambios de servidor).
 * - Modo local: applyInventoryMovement (punto central del ledger) + saveAllData, con reversión.
 * El motivo viaja codificado: 'ajuste:v1:' + JSON {t, u:{n,i}, n}. Compras, ventas y movimientos
 * normales nunca empiezan con ese prefijo. No toca ventas ni pagos. Reporte solo para el dueño. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageAjustesInventario', FEATURE_ID = 'ajustes-inventario';
  var PREFIX = 'ajuste:v1:', MAX_REASON = 500;
  var TYPES = { merma: 'Merma', rotura: 'Rotura', vencido: 'Vencido', correccion: 'Corrección' };
  function text(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }
  // Motivo estructurado; recorta la nota para no pasar de 500 caracteres (límite del Worker).
  function encodeReason(type, user, note) {
    if (!TYPES[type]) throw new Error('TIPO_INVALIDO');
    var u = { n: text(user && user.nombre).slice(0, 100) || 'Sin nombre', i: text(user && user.id).slice(0, 60) };
    var n = text(note).slice(0, 400), out;
    for (;;) {
      out = PREFIX + JSON.stringify({ t: type, u: u, n: n });
      if (out.length <= MAX_REASON || !n) return out.slice(0, MAX_REASON);
      n = n.slice(0, Math.max(0, n.length - (out.length - MAX_REASON) - 1));
    }
  }
  function parseReason(reason) {
    if (typeof reason !== 'string' || reason.indexOf(PREFIX) !== 0) return null;
    try {
      var o = JSON.parse(reason.slice(PREFIX.length));
      if (!o || typeof o !== 'object' || !TYPES[o.t] || !o.u || typeof o.u !== 'object') return null;
      return { type: o.t, label: TYPES[o.t], user: { nombre: String(o.u.n || ''), id: String(o.u.i || '') }, note: typeof o.n === 'string' ? o.n : '' };
    } catch (_) { return null; }
  }
  function isAdjustment(move) { return !!(move && parseReason(move.reason)); }
  // Merma, rotura y vencido restan; la corrección puede sumar o restar.
  function plan(type, quantity, direction) {
    var q = Number(quantity);
    if (!TYPES[type] || !Number.isFinite(q) || q <= 0) return null;
    var up = type === 'correccion' && direction === 'sumar';
    return { movement_type: up ? 'ENTRADA' : 'SALIDA', delta: up ? q : -q, quantity: q };
  }
  function limaDay(ts) {
    var t = Date.parse(ts); if (!Number.isFinite(t)) return '';
    return new Date(t - 5 * 3600000).toISOString().slice(0, 10);
  }
  function limaLabel(ts) {
    var t = Date.parse(ts); if (!Number.isFinite(t)) return '';
    var d = new Date(t - 5 * 3600000).toISOString();
    return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) + ' ' + d.slice(11, 16);
  }
  // Une movimientos locales y de CANON; solo los que llevan el prefijo de ajuste.
  function collect(localMoves, canonicalMoves, products) {
    var names = new Map();
    (Array.isArray(products) ? products : []).forEach(function (p) { if (p) names.set(String(p.id != null ? p.id : p.product_id), String(p.name || p.nombre || '')); });
    var rows = [], seen = new Set();
    function push(move, canonical) {
      var info = parseReason(move && move.reason); if (!info) return;
      var id = String(move.operation_id || move.movement_id || move.id || '');
      if (id && seen.has(id)) return; if (id) seen.add(id);
      var pid = String(move.product_id != null ? move.product_id : move.productId);
      // CANON exporta quantity con signo; si llega positiva en una SALIDA, se resta.
      var q = Number(move.quantity), delta = move.delta != null ? Number(move.delta) : canonical ? (String(move.movement_type).toUpperCase() === 'SALIDA' && q > 0 ? -q : q) : NaN;
      var ts = move.created_at || move.timestamp || '';
      rows.push({ id: id, productId: pid, product: names.get(pid) || 'Producto ' + pid, type: info.type, label: info.label, user: info.user, note: info.note,
        delta: Number.isFinite(delta) ? delta : 0, timestamp: ts, day: limaDay(ts) });
    }
    (Array.isArray(canonicalMoves) ? canonicalMoves : []).forEach(function (m) { push(m, true); });
    (Array.isArray(localMoves) ? localMoves : []).forEach(function (m) { push(m, false); });
    rows.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)) || a.id.localeCompare(b.id); });
    return rows;
  }
  function summary(rows) {
    var out = { merma: 0, rotura: 0, vencido: 0, correccion: 0 };
    rows.forEach(function (r) { out[r.type] += r.delta; });
    return out;
  }
  function csvCell(value) {
    var raw = String(value == null ? '' : value);
    if (typeof value === 'string' && /^[=+@\t\r\n-]/.test(raw.replace(/^ +/, ''))) raw = "'" + raw;
    return /[",\r\n]/.test(raw) ? '"' + raw.replace(/"/g, '""') + '"' : raw;
  }
  function toCsv(rows) {
    var lines = [['Fecha (Lima)', 'Producto', 'Tipo', 'Cantidad', 'Usuario', 'Nota']];
    rows.forEach(function (r) { lines.push([limaLabel(r.timestamp), r.product, r.label, r.delta, r.user.nombre + (r.user.id ? ' · ' + r.user.id : ''), r.note]); });
    return '\uFEFF' + lines.map(function (l) { return l.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  function available() {
    try {
      var p = root.NA_PERMISSIONS;
      return isOwner() && !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID) && typeof p.featureLocked === 'function' && !p.featureLocked(FEATURE_ID));
    } catch (_) { return false; }
  }
  // ---- Datos del POS ----
  function canon() { var c = root.NuevoAmanecerCanonical; try { return c && typeof c.enabled === 'function' && c.enabled() ? c : null; } catch (_) { return null; } }
  function products() {
    var c = canon();
    if (c) { try { var s = c.snapshot(); if (s && Array.isArray(s.products)) return s.products; } catch (_) {} }
    return typeof productos !== 'undefined' ? productos : root.productos || []; // eslint-disable-line no-undef
  }
  function localMoves() { try { return typeof inventoryMovements !== 'undefined' ? inventoryMovements : root.inventoryMovements; } catch (_) { return []; } } // eslint-disable-line no-undef
  function canonicalMoves() { var c = canon(); try { var s = c && c.snapshot(); return s && Array.isArray(s.inventoryMovements) ? s.inventoryMovements : []; } catch (_) { return []; } }
  function currentUser() {
    try { var a = typeof _naGetActiveCashier === 'function' ? _naGetActiveCashier() : null; if (a && (a.nombre || a.id)) return { nombre: a.nombre, id: a.id }; } catch (_) {} // eslint-disable-line no-undef
    return { nombre: 'Dueño', id: '' };
  }
  function productId(p) { return String(p.id != null ? p.id : p.product_id); }
  function productName(p) { return String(p.name || p.nombre || 'Producto'); }
  async function register(input) {
    if (!available()) return { ok: false, message: 'Sin permiso.' };
    var step = plan(input.type, input.quantity, input.direction);
    if (!step) return { ok: false, message: 'Revisa el tipo y la cantidad.' };
    var product = products().find(function (p) { return p && productId(p) === String(input.productId); });
    if (!product) return { ok: false, message: 'Producto no encontrado.' };
    var reason = encodeReason(input.type, currentUser(), input.note);
    var c = canon();
    if (c) {
      if (typeof c.adjustInventory !== 'function') return { ok: false, message: 'CANON no disponible para ajustes.' };
      try { await c.adjustInventory({ product_id: productId(product), movement_type: step.movement_type, quantity: step.quantity, reason: reason }); }
      catch (e) { return { ok: false, message: 'CANON no registró el ajuste (' + text(e && e.message) + ').' }; }
      try { if (typeof c.refresh === 'function') await c.refresh(); } catch (_) {}
      return { ok: true, canonical: true };
    }
    if (typeof applyInventoryMovement !== 'function') return { ok: false, message: 'Inventario no disponible.' }; // eslint-disable-line no-undef
    var before = product.stock;
    var outcome = applyInventoryMovement({ productId: product.id, type: step.movement_type, delta: step.delta, reason: reason, source: 'ADJUSTMENT', referenceId: String(product.id) }); // eslint-disable-line no-undef
    if (!outcome || !outcome.ok) return { ok: false, message: (outcome && outcome.message) || 'Ajuste bloqueado.' };
    try {
      var saved = typeof saveAllData === 'function' ? await saveAllData() : null; // eslint-disable-line no-undef
      if (typeof _naWasPersisted === 'function' && !_naWasPersisted(saved)) throw new Error('NO_PERSISTIDO'); // eslint-disable-line no-undef
    } catch (_) {
      var m = localMoves(), own = outcome.movement;
      if (Array.isArray(m) && own) { // quita solo nuestro movimiento (por identidad o id), nunca recorta la lista
        var at = m.indexOf(own); if (at < 0 && own.id != null) at = m.findIndex(function (x) { return x && x.id === own.id; });
        if (at >= 0) m.splice(at, 1);
      }
      product.stock = before;
      try { if (typeof saveAllData === 'function') await saveAllData(); } catch (_) {} // eslint-disable-line no-undef
      return { ok: false, message: 'No se guardó el ajuste; el stock fue restaurado.' };
    }
    return { ok: true, movement: outcome.movement };
  }
  // ---- Interfaz ----
  function element(tag, className, value) { var n = root.document.createElement(tag); if (className) n.className = className; if (value !== undefined) n.textContent = String(value); return n; }
  function page() { return root.document && root.document.getElementById(PAGE_ID); }
  function units(v) { return (v > 0 ? '+' : '') + v.toLocaleString('es-PE', { maximumFractionDigits: 3 }); }
  function renderProducts(p) {
    var sel = p.querySelector('[data-aj-product]'), q = p.querySelector('[data-aj-search]'); if (!sel) return;
    var term = text(q && q.value).toLowerCase(), current = sel.value;
    sel.replaceChildren();
    var first = element('option', '', 'Elige un producto'); first.value = ''; sel.appendChild(first);
    products().filter(function (x) { return x && x.activo !== false && x.controlInventario !== false && (!term || (productName(x) + ' ' + (x.sku || '') + ' ' + (x.barcode || '')).toLowerCase().indexOf(term) >= 0); })
      .slice(0, 200).forEach(function (x) { var o = element('option', '', productName(x) + ' · stock ' + (x.stock != null ? x.stock : '—')); o.value = productId(x); sel.appendChild(o); });
    sel.value = current;
  }
  function renderReport(p) {
    var box = p.querySelector('[data-aj-report]'); if (!box) return;
    box.replaceChildren();
    var rows = collect(localMoves(), canonicalMoves(), products());
    var s = summary(rows), cards = element('div', 'aj-summary');
    Object.keys(TYPES).forEach(function (k) { var c = element('div', 'aj-card'); c.appendChild(element('span', '', TYPES[k])); var v = element('strong', '', units(s[k])); v.setAttribute('data-aj-sum', k); c.appendChild(v); cards.appendChild(c); });
    box.appendChild(cards);
    if (!rows.length) { box.appendChild(element('p', 'aj-empty', 'Aún no hay ajustes registrados.')); return; }
    var table = element('table', 'aj-table'), head = element('thead'), tr = element('tr');
    ['Fecha (Lima)', 'Producto', 'Tipo', 'Cantidad', 'Usuario', 'Nota'].forEach(function (l, i) { var th = element('th', i === 3 ? 'aj-num' : '', l); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    var body = element('tbody');
    rows.forEach(function (r) {
      var line = element('tr'); line.setAttribute('data-aj-row', r.type);
      [['Fecha (Lima)', limaLabel(r.timestamp), ''], ['Producto', r.product, 'aj-product'], ['Tipo', r.label, ''], ['Cantidad', units(r.delta), 'aj-num'],
        ['Usuario', r.user.nombre + (r.user.id ? ' · ' + r.user.id : ''), ''], ['Nota', r.note || '—', 'aj-note']].forEach(function (c) {
        var td = element('td', c[2], c[1]); td.setAttribute('data-label', c[0]); line.appendChild(td);
      });
      body.appendChild(line);
    });
    table.appendChild(body); box.appendChild(table);
  }
  function render() {
    var p = page(); if (!p) return false;
    var status = p.querySelector('[data-aj-status]'), main = p.querySelector('[data-aj-main]');
    if (!available()) {
      if (main) main.hidden = true;
      var rep = p.querySelector('[data-aj-report]'); if (rep) rep.replaceChildren();
      if (status) status.textContent = 'Sin permiso. Pídele acceso al dueño.';
      return false;
    }
    if (main) main.hidden = false;
    if (status) status.textContent = (canon() ? 'Se registra en CANON' : 'Se registra en este dispositivo') + ' · fechas en hora de Lima · no cambia ventas ni pagos';
    renderProducts(p); renderReport(p); syncDirection(p);
    return true;
  }
  function syncDirection(p) { var t = p.querySelector('[data-aj-type]'), d = p.querySelector('[data-aj-direction-wrap]'); if (t && d) d.hidden = t.value !== 'correccion'; }
  function exportCsv() {
    if (!available()) return false;
    var p = page(), url = root.URL.createObjectURL(new root.Blob([toCsv(collect(localMoves(), canonicalMoves(), products()))], { type: 'text/csv;charset=utf-8' }));
    var link = element('a'); link.href = url; link.download = 'ajustes-inventario-' + limaDay(new Date().toISOString()) + '.csv';
    try { p.appendChild(link); link.click(); } finally { link.remove(); root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000); }
    return true;
  }
  var busy = false;
  async function submit(p) {
    if (busy) return; busy = true;
    var msg = p.querySelector('[data-aj-message]'), btn = p.querySelector('[data-aj-submit]');
    if (btn) btn.disabled = true;
    try {
      var dir = p.querySelector('[data-aj-direction]');
      var res = await register({ productId: p.querySelector('[data-aj-product]').value, type: p.querySelector('[data-aj-type]').value,
        quantity: Number(String(p.querySelector('[data-aj-qty]').value).replace(',', '.')), direction: dir ? dir.value : 'restar', note: p.querySelector('[data-aj-note]').value });
      if (msg) { msg.textContent = res.ok ? 'Ajuste registrado.' : res.message; msg.setAttribute('data-aj-ok', String(!!res.ok)); }
      if (res.ok) { p.querySelector('[data-aj-qty]').value = ''; p.querySelector('[data-aj-note]').value = ''; ['invRender', 'posRender', 'updateDashboard'].forEach(function (n) { try { if (typeof root[n] === 'function') root[n](); } catch (_) {} }); render(); }
    } finally { busy = false; if (btn) btn.disabled = false; }
  }
  function init() {
    var p = page(); if (!p || p.__naAjBound) return; p.__naAjBound = true;
    function update() { if (p.classList.contains('active')) render(); }
    p.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('[data-aj-search]')) renderProducts(p); });
    p.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('[data-aj-type]')) syncDirection(p); });
    p.addEventListener('submit', function (e) { e.preventDefault(); submit(p); });
    p.addEventListener('click', function (e) { if (e.target.closest('[data-aj-export]')) exportCsv(); });
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(p, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { render(); });
    root.addEventListener('na:canonical-updated', update);
    update();
  }
  root.NA_AJUSTES_INVENTARIO = Object.freeze({ PREFIX: PREFIX, TYPES: TYPES, encodeReason: encodeReason, parseReason: parseReason, isAdjustment: isAdjustment, plan: plan, collect: collect, summary: summary, toCsv: toCsv, limaLabel: limaLabel, available: available, register: register, render: render, exportCsv: exportCsv, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
