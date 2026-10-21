/* Sugerencia de compra (id sugerencia-compra): qué pedir, agrupado por proveedor, según el stock mínimo
 * y las ventas de los últimos 30 días (día de Lima). Reutiliza NA_ROTACION_ABC (días de Lima y período)
 * y NA_HISTORIAL_COMPRAS (último proveedor desde los movimientos de compra cargados).
 * Solo dueño (NA_ROLES.isOwner() en try/catch). Editable antes de exportar o imprimir; no escribe
 * productos, stock, compras, almacenamiento ni red. Fórmula: sugerido = ⌈mínimo + vendido 30 días − stock⌉.
 * Las cantidades editadas en «A pedir» se guardan solo en memoria (por producto, durante la sesión) y se
 * reaplican en cada recálculo, al volver a la pantalla o al cambiar de rol; «Usar sugeridos» las descarta. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageSugerenciaCompra', FEATURE_ID = 'sugerencia-compra', DAYS = 30, MAX_QTY = 100000;
  var NO_SUPPLIER = 'Sin proveedor registrado';
  function text(v) { return String(v == null ? '' : v).trim(); }
  function num(v) { var n = typeof v === 'number' ? v : Number(text(v).replace(',', '.')); return Number.isFinite(n) ? n : null; }
  // En las ventas del POS, item.id y item.productoId son el id del PRODUCTO (la línea se distingue por
  // ventaModo, no por id). Se prefiere productoId por claridad.
  function key(item) {
    var id = item.productoId != null && text(item.productoId) ? item.productoId : item.id;
    if (id != null && text(id)) return 'id:' + text(id);
    return text(item.sku) ? 'sku:' + text(item.sku) : '';
  }
  function soldUnits(sales, range) {
    var out = new Map(), limaDay = root.NA_ROTACION_ABC.limaDay;
    (Array.isArray(sales) ? sales : []).forEach(function (sale) {
      if (!sale || sale.anulada) return;
      var day = limaDay(sale.fecha || sale.timestamp);
      if (!day || day < range.from || day > range.to) return;
      (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var k = key(item), q = num(item.qty != null ? item.qty : item.cantidad);
        if (!k || q === null || q <= 0) return;
        // Venta por caja: qty son cajas y unitsPerQty el factor (unidCaja), igual que _naUnitsSold del POS.
        var factor = Math.floor(num(item.unitsPerQty) || 1); if (factor < 1) factor = 1;
        q = q * factor;
        out.set(k, (out.get(k) || 0) + q);
      });
    });
    return out;
  }
  function supplierOf(product, movements) {
    var own = text(product.proveedor || product.supplier);
    if (own) return own;
    try {
      var hist = root.NA_HISTORIAL_COMPRAS;
      if (hist && typeof hist.buildHistory === 'function') {
        var last = hist.buildHistory([], movements, text(product.id)).summary.lastPurchase;
        if (last && last.supplier) return last.supplier;
      }
    } catch (_) {}
    return NO_SUPPLIER;
  }
  function suggest(stockMin, sold, stock) { return Math.max(0, Math.ceil(stockMin + sold - Math.max(0, stock))); }
  // Cantidad editada por el dueño para la clave del producto (Map u objeto); null si no la editó.
  function editedQty(edits, k) {
    if (!edits || typeof edits !== 'object') return null;
    var v = typeof edits.get === 'function' ? (edits.has(k) ? edits.get(k) : undefined) : (Object.prototype.hasOwnProperty.call(edits, k) ? edits[k] : undefined);
    return v === undefined || v === null || v === '' ? null : clampQty(v);
  }
  function buildSuggestion(sales, products, options) {
    options = options || {};
    var range = root.NA_ROTACION_ABC.periodRange(DAYS, options.now);
    var sold = soldUnits(sales, range), groups = new Map();
    (Array.isArray(products) ? products : []).forEach(function (p) {
      if (!p || typeof p !== 'object' || p.activo === false || p.controlInventario === false) return;
      var k = key(p); if (!k) return;
      var stock = num(p.stock) || 0, min = Math.max(0, num(p.stockMin) || 0), s = sold.get(k) || 0;
      var qty = suggest(min, s, stock);
      if (!qty) return;
      var edited = editedQty(options.edits, k);
      var supplier = supplierOf(p, options.movements), cost = num(p.costo);
      if (!groups.has(supplier)) groups.set(supplier, []);
      groups.get(supplier).push({ key: k, name: text(p.name || p.nombre) || 'Producto sin nombre', code: text(p.sku || p.barcode || p.codigo),
        stock: stock, stockMin: min, sold30: s, suggested: qty, qty: edited === null ? qty : edited, cost: cost !== null && cost > 0 ? cost : null });
    });
    var list = Array.from(groups.keys()).sort(function (a, b) { return (a === NO_SUPPLIER) - (b === NO_SUPPLIER) || a.localeCompare(b, 'es'); }).map(function (supplier) {
      return { supplier: supplier, rows: groups.get(supplier).sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); }) };
    });
    return { range: range, groups: list };
  }
  function clampQty(v) { var n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(0, n)) : 0; }
  function lineCost(r) { return r.cost === null ? null : Math.round(r.qty * r.cost * 100) / 100; }
  function totals(groups) {
    var t = { lines: 0, units: 0, cost: 0, noCost: 0 };
    groups.forEach(function (g) { g.rows.forEach(function (r) { if (!r.qty) return; t.lines++; t.units += r.qty; var c = lineCost(r); if (c === null) t.noCost++; else t.cost += c; }); });
    t.cost = Math.round(t.cost * 100) / 100; return t;
  }
  function dateLabel(day) { return day.split('-').reverse().join('/'); }
  function filterLabel(range) { return 'Ventas del ' + dateLabel(range.from) + ' al ' + dateLabel(range.to) + ' (30 días) · hora de Lima'; }
  function csvCell(value) {
    var raw = String(value == null ? '' : value);
    if (typeof value === 'string' && /^[=+@\t\r\n-]/.test(raw.replace(/^ +/, ''))) raw = "'" + raw;
    return /[",\r\n]/.test(raw) ? '"' + raw.replace(/"/g, '""') + '"' : raw;
  }
  // Solo exporta las líneas con cantidad mayor a cero (lo editado por el dueño).
  function toCsv(plan) {
    var lines = [[filterLabel(plan.range)], ['Proveedor', 'Producto', 'Código', 'Stock', 'Stock mínimo', 'Vendido 30 días', 'Sugerido', 'Cantidad a pedir', 'Costo unitario', 'Costo estimado']];
    plan.groups.forEach(function (g) { g.rows.forEach(function (r) {
      if (!r.qty) return;
      var c = lineCost(r);
      lines.push([g.supplier, r.name, r.code, r.stock, r.stockMin, r.sold30, r.suggested, r.qty, r.cost === null ? 'Sin costo' : r.cost.toFixed(2), c === null ? 'Sin costo' : c.toFixed(2)]);
    }); });
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
  function money(v) { return 'S/ ' + v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function units(v) { return v.toLocaleString('es-PE', { maximumFractionDigits: 3 }); }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  var plan = null;
  // Cantidades editadas en «A pedir», por clave de producto (id:…/sku:…). Solo en memoria, durante la sesión.
  var edits = new Map();
  function setEdited(r) { edits.set(r.key, r.qty); }
  function hasEdits() { return !!plan && plan.groups.some(function (g) { return g.rows.some(function (r) { return edits.has(r.key); }); }); }
  function resetQuantities() {
    edits.clear();
    if (plan) plan.groups.forEach(function (g) { g.rows.forEach(function (r) { r.qty = r.suggested; }); });
    return render(false);
  }
  function currentSales() { return typeof ventas !== 'undefined' ? ventas : root.ventas; } // eslint-disable-line no-undef
  function currentProducts() { return typeof productos !== 'undefined' ? productos : root.productos; } // eslint-disable-line no-undef
  function currentMovements() { try { return typeof inventoryMovements !== 'undefined' ? inventoryMovements : root.inventoryMovements; } catch (_) { return []; } } // eslint-disable-line no-undef
  function page() { return root.document && root.document.getElementById(PAGE_ID); }
  function clear(p, message) {
    plan = null;
    var content = p.querySelector('[data-sc-content]'), status = p.querySelector('[data-sc-status]'), controls = p.querySelector('[data-sc-controls]');
    if (controls) controls.hidden = true;
    if (content) content.replaceChildren();
    if (status) status.textContent = message;
    return false;
  }
  function renderTotals(p) {
    var box = p.querySelector('[data-sc-totals]'); if (!box || !plan) return;
    var t = totals(plan.groups);
    box.textContent = t.lines + (t.lines === 1 ? ' producto' : ' productos') + ' · ' + units(t.units) + ' unidades · costo estimado ' + money(t.cost) + (t.noCost ? ' (' + t.noCost + ' sin costo)' : '');
    plan.groups.forEach(function (g, gi) {
      var sub = p.querySelector('[data-sc-subtotal="' + gi + '"]'); if (!sub) return;
      var st = totals([g]); sub.textContent = st.lines + (st.lines === 1 ? ' producto · ' : ' productos · ') + money(st.cost);
    });
    var exp = p.querySelector('[data-sc-export]'), pr = p.querySelector('[data-sc-print]');
    if (exp) exp.disabled = !t.lines; if (pr) pr.disabled = !t.lines;
    var rs = p.querySelector('[data-sc-reset]'); if (rs) rs.disabled = !hasEdits();
  }
  function render(rebuild) {
    var p = page(); if (!p) return false;
    var content = p.querySelector('[data-sc-content]'), status = p.querySelector('[data-sc-status]'), controls = p.querySelector('[data-sc-controls]');
    if (!content || !status) return false;
    if (!available()) return clear(p, 'Sin permiso. Pídele acceso al dueño.');
    try { if (rebuild || !plan) plan = buildSuggestion(currentSales(), currentProducts(), { movements: currentMovements(), edits: edits }); }
    catch (_) { return clear(p, 'No se pudo calcular la sugerencia. Actualiza.'); }
    if (controls) controls.hidden = false;
    content.replaceChildren();
    status.textContent = filterLabel(plan.range) + ' · sugerido = mínimo + vendido − stock';
    var tot = element('p', 'sc-totals'); tot.setAttribute('data-sc-totals', ''); tot.setAttribute('role', 'status'); content.appendChild(tot);
    if (!plan.groups.length) { content.appendChild(element('p', 'sc-empty', 'No hay productos por pedir: todos superan su mínimo más lo vendido en 30 días.')); renderTotals(p); return true; }
    plan.groups.forEach(function (g, gi) {
      var section = element('section', 'sc-group'); section.setAttribute('data-sc-group', g.supplier);
      var h = element('h2', '', g.supplier); section.appendChild(h);
      var sub = element('p', 'sc-subtotal'); sub.setAttribute('data-sc-subtotal', String(gi)); section.appendChild(sub);
      var table = element('table', 'sc-table'), head = element('thead'), tr = element('tr');
      ['Producto', 'Stock', 'Mínimo', 'Vendido 30 d', 'Sugerido', 'A pedir', ''].forEach(function (l, i) { var th = element('th', i >= 1 && i <= 5 ? 'sc-num' : '', l); th.scope = 'col'; tr.appendChild(th); });
      head.appendChild(tr); table.appendChild(head);
      var body = element('tbody');
      g.rows.forEach(function (r, ri) {
        var line = element('tr'); line.setAttribute('data-sc-row', r.key);
        var name = element('th', 'sc-product', r.name); name.scope = 'row'; if (r.code) name.appendChild(element('small', '', r.code)); line.appendChild(name);
        [['Stock', units(r.stock)], ['Mínimo', units(r.stockMin)], ['Vendido 30 d', units(r.sold30)], ['Sugerido', units(r.suggested)]].forEach(function (c) {
          var td = element('td', 'sc-num', c[1]); td.setAttribute('data-label', c[0]); line.appendChild(td);
        });
        var qtd = element('td', 'sc-num'); qtd.setAttribute('data-label', 'A pedir');
        var input = element('input', 'sc-qty'); input.type = 'number'; input.min = '0'; input.max = String(MAX_QTY); input.step = '1'; input.value = String(r.qty);
        input.setAttribute('data-sc-qty', gi + ':' + ri); input.setAttribute('aria-label', 'Cantidad a pedir de ' + r.name);
        qtd.appendChild(input); line.appendChild(qtd);
        var rtd = element('td', 'sc-actions'); var rm = element('button', 'sc-remove', 'Quitar'); rm.type = 'button'; rm.setAttribute('data-sc-remove', gi + ':' + ri); rtd.appendChild(rm); line.appendChild(rtd);
        if (!r.qty) line.setAttribute('data-sc-zero', '');
        body.appendChild(line);
      });
      table.appendChild(body); section.appendChild(table); content.appendChild(section);
    });
    renderTotals(p);
    return true;
  }
  function rowAt(ref) { var parts = text(ref).split(':'), g = plan && plan.groups[Number(parts[0])]; return g ? g.rows[Number(parts[1])] : null; }
  function exportCsv() {
    if (!available() || !plan) return false;
    var url = root.URL.createObjectURL(new root.Blob([toCsv(plan)], { type: 'text/csv;charset=utf-8' }));
    var p = page(), link = element('a'); link.href = url; link.download = 'sugerencia-compra-' + plan.range.to + '.csv';
    try { p.appendChild(link); link.click(); } finally { link.remove(); root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000); }
    return true;
  }
  function printPlan() {
    if (!available() || !plan) return false;
    var body = root.document.body; body.classList.add('sc-printing');
    var done = function () { body.classList.remove('sc-printing'); root.removeEventListener('afterprint', done); };
    root.addEventListener('afterprint', done);
    if (typeof root.print === 'function') root.print();
    return true;
  }
  function init() {
    var p = page(); if (!p || p.__naScBound) return; p.__naScBound = true;
    function update() { if (p.classList.contains('active')) render(true); }
    p.addEventListener('input', function (e) {
      var t = e.target; if (!t.matches || !t.matches('[data-sc-qty]')) return;
      var r = rowAt(t.getAttribute('data-sc-qty')); if (!r || t.value === '') return;
      r.qty = clampQty(t.value); setEdited(r); var tr = t.closest('tr'); if (tr) tr.toggleAttribute('data-sc-zero', !r.qty); renderTotals(p);
    });
    p.addEventListener('change', function (e) {
      var t = e.target; if (!t.matches || !t.matches('[data-sc-qty]')) return;
      var r = rowAt(t.getAttribute('data-sc-qty')); if (!r) return;
      r.qty = clampQty(t.value); setEdited(r); t.value = String(r.qty); var tr = t.closest('tr'); if (tr) tr.toggleAttribute('data-sc-zero', !r.qty); renderTotals(p);
    });
    p.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-sc-remove]');
      if (rm) { var r = rowAt(rm.getAttribute('data-sc-remove')); if (r) { r.qty = 0; setEdited(r); var tr = rm.closest('tr'); var inp = tr && tr.querySelector('[data-sc-qty]'); if (inp) inp.value = '0'; if (tr) tr.setAttribute('data-sc-zero', ''); renderTotals(p); } return; }
      if (e.target.closest('[data-sc-recalc]')) { render(true); return; }
      if (e.target.closest('[data-sc-reset]')) { resetQuantities(); return; }
      if (e.target.closest('[data-sc-export]')) { exportCsv(); return; }
      if (e.target.closest('[data-sc-print]')) printPlan();
    });
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(p, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { if (!available()) render(false); else update(); });
    update();
  }
  root.NA_SUGERENCIA_COMPRA = Object.freeze({ buildSuggestion: buildSuggestion, suggest: suggest, totals: totals, toCsv: toCsv, csvCell: csvCell, clampQty: clampQty, available: available, render: render, resetQuantities: resetQuantities, exportCsv: exportCsv, printPlan: printPlan, init: init, NO_SUPPLIER: NO_SUPPLIER });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
