/* Recalcular stock (solo dueño): compara el stock actual con el que resulta del historial de movimientos.
 * SOLO LECTURA: no escribe stock ni registra ajustes. Un ajuste por inventory.adjust también es un movimiento, así que
 * no puede cuadrar stock e historial a la vez; la corrección queda pendiente de decisión del dueño/PROGRAMADOR. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageAjustesInventario';
  function text(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { if (v == null || v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : null; }
  function round(v) { return Math.round(v * 1000) / 1000; }
  function pid(p) { return text(p && (p.id != null ? p.id : p.product_id)); }
  function aj() { return root.NA_AJUSTES_INVENTARIO; }
  function kx() { return root.NA_KARDEX; }
  function allowed() { try { var a = aj(); return !!(a && typeof a.available === 'function' && a.available()); } catch (_) { return false; } }
  function canon() { var c = root.NuevoAmanecerCanonical; try { return c && typeof c.enabled === 'function' && c.enabled() ? c : null; } catch (_) { return null; } }
  function data() {
    var c = canon(), snap = null; try { snap = c && c.snapshot(); } catch (_) {}
    /* eslint-disable no-undef */
    var products = c && snap && Array.isArray(snap.products) && snap.products.length ? snap.products : (typeof productos !== 'undefined' ? productos : root.productos);
    return { products: products || [], sales: (typeof ventas !== 'undefined' ? ventas : root.ventas) || [],
      movements: (c ? (snap && snap.inventoryMovements) : (typeof inventoryMovements !== 'undefined' ? inventoryMovements : root.inventoryMovements)) || [] };
    /* eslint-enable no-undef */
  }
  // Recalcula un producto. Usa el Kardex (misma deduplicación de ventas y movimientos) sobre todo el historial.
  // Solo hay un saldo de partida confiable si el primer movimiento es el «Alta de producto» (los productos nuevos nacen en 0).
  function recompute(product, movements, sales, now) {
    var k = kx(); if (!k || typeof k.buildLedger !== 'function') return null;
    var stock = num(product && (product.stock != null ? product.stock : product.current_stock_quantity));
    var report;
    try { report = k.buildLedger(product, movements, sales, { from: '2000-01-01', now: now }); } catch (_) { return null; }
    var rows = report.rows.filter(function (r) { return r.id !== 'opening'; });
    var base = { id: pid(product), name: report.product.name, code: report.product.code, stock: stock, moves: rows.length, skipped: report.skipped };
    if (stock == null) return Object.assign(base, { status: 'sin-stock', expected: null, diff: null });
    if (!rows.length) return Object.assign(base, { status: stock === 0 ? 'ok' : 'sin-historial', expected: stock === 0 ? 0 : null, diff: stock === 0 ? 0 : null });
    if (rows[0].type !== 'Alta de producto' || report.skipped) return Object.assign(base, { status: 'sin-alta', expected: null, diff: null });
    var expected = round(rows.reduce(function (s, r) { return s + r.delta; }, 0));
    var diff = round(stock - expected);
    return Object.assign(base, { status: diff === 0 ? 'ok' : 'diferencia', expected: expected, diff: diff });
  }
  function analyze(products, movements, sales, now) {
    return (Array.isArray(products) ? products : []).filter(function (p) { return p && p.activo !== false && p.controlInventario !== false; })
      .map(function (p) { return recompute(p, movements, sales, now); }).filter(Boolean)
      .sort(function (a, b) { return (b.status === 'diferencia') - (a.status === 'diferencia') || Math.abs(b.diff || 0) - Math.abs(a.diff || 0) || a.name.localeCompare(b.name, 'es'); });
  }
  var LABELS = { ok: 'Coincide', diferencia: 'Diferencia', 'sin-alta': 'Historial incompleto', 'sin-historial': 'Sin movimientos', 'sin-stock': 'Sin stock registrado' };
  function fmt(v) { return v == null ? '—' : Number(v).toLocaleString('es-PE', { maximumFractionDigits: 3 }); }
  function signed(v) { return v == null ? '—' : (v > 0 ? '+' : '') + fmt(v); }
  function el(tag, cls, value) { var n = root.document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = String(value); return n; }
  function section() { var p = root.document && root.document.getElementById(PAGE_ID); return p && p.querySelector('[data-rs-section]'); }
  function render() {
    var box = section(); if (!box) return false;
    var body = box.querySelector('[data-rs-body]'), status = box.querySelector('[data-rs-status]');
    if (!allowed()) { box.hidden = true; if (body) body.replaceChildren(); return false; }
    box.hidden = false;
    var d = data(), rows = analyze(d.products, d.movements, d.sales);
    if (status) status.textContent = 'Solo vista previa: no cambia stock, ventas ni pagos.' + (canon() ? ' Usa los movimientos cargados de la nube.' : '') +
      ' Los productos creados antes de empezar a registrar movimientos saldrán como «Historial incompleto»: es normal.';
    body.replaceChildren();
    var diffs = rows.filter(function (r) { return r.status === 'diferencia'; }).length, unknown = rows.filter(function (r) { return r.status === 'sin-alta' || r.status === 'sin-historial'; }).length;
    var sum = el('p', 'rs-summary', diffs + ' con diferencia · ' + unknown + ' sin historial completo · ' + rows.length + ' revisados'); sum.setAttribute('data-rs-summary', ''); body.appendChild(sum);
    if (!rows.length) { body.appendChild(el('p', 'aj-empty', 'No hay productos con control de inventario.')); return true; }
    var wrap = el('div', 'rs-wrap'); wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Diferencias de stock');
    var table = el('table', 'aj-table rs-table'), head = el('thead'), tr = el('tr');
    ['Producto', 'Stock actual', 'Stock según movimientos', 'Diferencia', 'Estado'].forEach(function (l, i) { var th = el('th', i >= 1 && i <= 3 ? 'aj-num' : '', l); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var line = el('tr'); line.setAttribute('data-rs-row', r.id); line.setAttribute('data-rs-status', r.status);
      [['Producto', r.name + (r.code ? ' · ' + r.code : ''), 'aj-product'], ['Stock actual', fmt(r.stock), 'aj-num'], ['Stock según movimientos', fmt(r.expected), 'aj-num'],
        ['Diferencia', signed(r.diff), 'aj-num'], ['Estado', LABELS[r.status] || r.status, '']].forEach(function (c) { var td = el('td', c[2], c[1]); td.setAttribute('data-label', c[0]); line.appendChild(td); });
      tb.appendChild(line);
    });
    table.appendChild(tb); wrap.appendChild(table); body.appendChild(wrap);
    return true;
  }
  function init() {
    var box = section(); if (!box || box.__naRsBound) return; box.__naRsBound = true;
    box.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-rs-refresh]')) render(); });
    var page = root.document.getElementById(PAGE_ID);
    function update() { if (page.classList.contains('active')) render(); else if (!allowed()) render(); }
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    ['na:role', 'na:canonical-updated'].forEach(function (ev) { root.addEventListener(ev, update); });
    update();
  }
  root.NA_RECALCULAR_STOCK = Object.freeze({ recompute: recompute, analyze: analyze, render: render, init: init });
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true }); else init(); }
})(globalThis);
