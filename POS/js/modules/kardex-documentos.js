/* #85 Kardex · Documentos que movieron stock: una fila por documento (venta, compra, ajuste…).
 * Solo lectura y solo dueño. Usa el mismo historial que el Kardex por producto (réplica CANON en
 * la nube, inventoryMovements/ventas en modo local): no hace pedidos, no escribe ni guarda nada.
 * Bloqueada por el candado 'kardex-documentos' (id ausente = bloqueada). Sin costos ni montos. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageKardex', FEATURE_ID = 'kardex-documentos', DAY_MS = 86400000, MAX_ROWS = 500;
  var UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  var TYPE_FILTERS = { todos: null, venta: ['Venta', 'Anulación'], compra: ['Compra', 'Ingreso'], ajuste: ['Ajuste', 'Salida', 'Alta de producto'] };
  function text(value) { return String(value == null ? '' : value).trim(); }
  function numeric(value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || text(value) === '') return null;
    var n = Number(value); return Number.isFinite(n) ? n : null;
  }
  function round(value) { return Math.round(value * 1000000) / 1000000; }
  function normalized(value) { return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function validDay(value) {
    var raw = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    var date = new Date(raw + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : '';
  }
  // Igual que NA_KARDEX.timestamp: una fecha sin zona se interpreta en hora de Lima (UTC-5).
  function timestamp(value) {
    if (typeof value === 'number' || value instanceof Date) { var ms = new Date(value).getTime(); return Number.isFinite(ms) ? ms : null; }
    var raw = text(value).replace(' ', 'T');
    if (!validDay(raw.slice(0, 10))) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00';
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += '-05:00';
    var time = Date.parse(raw); return Number.isFinite(time) ? time : null;
  }
  function limaParts(ms) { var iso = new Date(ms - 5 * 3600000).toISOString(); return { day: iso.slice(0, 10), time: iso.slice(11, 16) }; }
  function limaDay(value) { var ms = timestamp(value); return ms == null ? '' : limaParts(ms).day; }
  function periodRange(now) {
    var to = limaDay(now === undefined ? Date.now() : now);
    if (!to) throw new RangeError('Fecha de referencia inválida');
    return { from: new Date(Date.parse(to + 'T00:00:00Z') - 29 * DAY_MS).toISOString().slice(0, 10), to: to };
  }
  function recordTime(record) {
    if (record.fecha && !validDay(record.fecha)) return null;
    var hasClock = !!(record.created_at || record.timestamp || record.hora24);
    var ms = timestamp(record.created_at || record.timestamp || (record.fecha ? record.fecha + 'T' + (record.hora24 || '00:00:00') : ''));
    if (ms == null) return null;
    return { timestamp: ms, day: record.fecha || limaParts(ms).day, time: hasClock ? limaParts(ms).time : '' };
  }
  function adjustmentInfo(move) {
    try { var api = root.NA_AJUSTES_INVENTARIO; return api && typeof api.parseReason === 'function' ? api.parseReason(move.reason) : null; } catch (_) { return null; }
  }
  // Mismas reglas que el Kardex por producto (kardex.js · movementKind / movementDelta).
  function movementKind(move) {
    if (typeof move.reason === 'string' && move.reason.indexOf('ajuste:v1:') === 0) return 'Ajuste';
    var kind = text(move.movement_type || move.type).toUpperCase();
    if (kind === 'SALE_REVERSAL' || kind === 'ANULACION' || /^anulacion de venta\s/.test(normalized(move.reason))) return 'Anulación';
    if (kind === 'SALE' || kind === 'VENTA') return 'Venta';
    if (kind === 'ENTRADA' || kind === 'INGRESO' || kind === 'COMPRA') {
      return move.source === 'OCR_PURCHASE' || /^compra(?:\s|$)/.test(normalized(move.reason)) || kind === 'COMPRA' ? 'Compra' : 'Ingreso';
    }
    if (kind === 'SALIDA') return 'Salida';
    if (kind === 'ALTA') return 'Alta de producto';
    // La réplica CANON de ventas no trae tipo: una fila con sale_id es venta.
    if (!kind && text(move.sale_id)) return 'Venta';
    return kind === 'AJUSTE' || !kind ? 'Ajuste' : text(move.movement_type || move.type);
  }
  function movementDelta(move) {
    if (move.delta != null) return numeric(move.delta);
    if (move.product_id != null || move.movement_source != null || move.canonical) return numeric(move.quantity);
    var before = numeric(move.before), after = numeric(move.after);
    if (before != null && after != null) return round(after - before);
    var qty = numeric(move.quantity), kind = movementKind(move);
    return qty == null ? null : (kind === 'Venta' || kind === 'Salida' ? -Math.abs(qty) : qty);
  }
  function readable(value) { var v = text(value); return v && !UUID_RE.test(v) ? v : ''; }
  function documentNumber(record) {
    if (!record) return '';
    var fields = ['purchase_number', 'purchaseNumber', 'numeroCompra', 'receipt_number', 'receiptNumber', 'ticket_number', 'ticketNumber',
      'numeroTicket', 'document_number', 'documentNumber', 'numeroComprobante', 'numero_comprobante'];
    for (var i = 0; i < fields.length; i++) { var v = record[fields[i]]; if ((typeof v === 'string' || typeof v === 'number') && readable(v)) return readable(v); }
    var series = readable(record.serie || record.series), sequence = readable(record.correlativo || record.numero);
    return series && sequence ? series + '-' + sequence : (readable(record.document || record.comprobante) || sequence);
  }
  function saleUser(sale) {
    return text(sale && (sale.cajeroNombre || (typeof sale.cajero === 'string' ? sale.cajero : sale.cajero && sale.cajero.nombre) || sale.vendedorNombre ||
      (typeof sale.vendedor === 'string' ? sale.vendedor : sale.vendedor && sale.vendedor.nombre) || sale.usuario || sale.user_name));
  }
  function saleId(sale) { return text(sale && (sale.id != null ? sale.id : sale.sale_id)); }
  function voided(sale) { return !!(sale.anulada || normalized(sale.estado || sale.status) === 'anulada' || normalized(sale.status) === 'annulled'); }
  // Clave del documento: la venta, la compra (operation sin «:línea») o el propio movimiento si es suelto.
  function documentKey(move, kind, index) {
    var sale = text(move.sale_id || move.saleId || ((kind === 'Venta' || kind === 'Anulación') ? move.referenceId : ''));
    if (sale) return (kind === 'Anulación' ? 'anulacion:' : 'venta:') + sale;
    var purchase = text(move.purchase_id || move.purchaseId);
    if (purchase) return 'compra:' + purchase;
    var op = text(move.operation_id || move.operationId);
    if (op) return 'op:' + op.replace(/:\d+$/, '');
    if (kind === 'Compra' && text(move.referenceId)) return 'compra:' + text(move.referenceId).replace(/:\d+$/, '');
    return 'mov:' + (text(move.movement_id || move.movementId || move.id) || index);
  }
  function referenceLabel(ref, kind) {
    var match = text(ref).match(UUID_RE);
    if (!match) return text(ref);
    return kind + ' sin número · #' + match[0].slice(0, 6).toLowerCase();
  }
  function matchesType(kind, filter) { var list = TYPE_FILTERS[filter]; return !list || list.indexOf(kind) >= 0; }
  // Una fila por documento dentro del rango [from, to] (días de Lima). Sin costos ni montos.
  function buildDocuments(movements, sales, options) {
    options = options || {};
    var defaults = periodRange(options.now), today = defaults.to;
    var from = options.from === undefined ? defaults.from : validDay(options.from);
    var to = options.to === undefined ? today : validDay(options.to);
    if (!from || !to || from > to || to > today) throw new RangeError('Elige un rango válido hasta hoy.');
    var filter = Object.prototype.hasOwnProperty.call(TYPE_FILTERS, options.type) ? options.type : 'todos';
    var salesById = new Map(), docs = new Map(), seen = new Set(), represented = new Set(), skipped = 0;
    (Array.isArray(sales) ? sales : []).forEach(function (sale) {
      if (!sale) return; ['id', 'sale_id', 'saleId'].forEach(function (f) { var id = text(sale[f]); if (id && !salesById.has(id)) salesById.set(id, sale); });
    });
    function add(key, base, productId, delta) {
      var doc = docs.get(key);
      if (!doc) { doc = Object.assign({ key: key, products: new Set(), incoming: 0, outgoing: 0 }, base); docs.set(key, doc); }
      if (base.timestamp < doc.timestamp) { doc.timestamp = base.timestamp; doc.day = base.day; doc.time = base.time; }
      if (!doc.user && base.user) doc.user = base.user;
      if (!doc.reference && base.reference) doc.reference = base.reference;
      if (productId) doc.products.add(productId);
      if (delta > 0) doc.incoming = round(doc.incoming + delta); else doc.outgoing = round(doc.outgoing - delta);
    }
    (Array.isArray(movements) ? movements : []).forEach(function (move, index) {
      if (!move) return;
      var id = text(move.movement_id || move.movementId || move.id);
      if (id && seen.has(id)) return;
      var at = recordTime(move), delta = movementDelta(move);
      if (!at || delta == null) { skipped++; return; }
      if (id) seen.add(id);
      if (!delta) return;
      var kind = movementKind(move), key = documentKey(move, kind, index);
      var sid = key.indexOf('venta:') === 0 ? key.slice(6) : key.indexOf('anulacion:') === 0 ? key.slice(10) : '';
      if (kind === 'Venta' && sid) represented.add(sid);
      if (at.day < from || at.day > to || !matchesType(kind, filter)) return;
      var sale = sid ? salesById.get(sid) : null, adj = adjustmentInfo(move);
      add(key, { type: adj ? 'Ajuste' : kind, day: at.day, time: at.time, timestamp: at.timestamp,
        reference: documentNumber(move) || (sale && documentNumber(sale)) || readable(sid) || (adj ? adj.label : '') || text(move.operation_id || move.operationId || move.referenceId || sid || id).replace(/:\d+$/, ''),
        user: (adj && adj.user && text(adj.user.nombre)) || saleUser(sale) || text(move.usuario || move.user_name) },
        text(move.product_id != null ? move.product_id : move.productId), delta);
    });
    // Ventas locales sin movimiento durable (mismo criterio que el Kardex por producto).
    (Array.isArray(sales) ? sales : []).forEach(function (sale, index) {
      if (!sale || voided(sale)) return;
      var id = saleId(sale); if (id && represented.has(id)) return;
      if (id) represented.add(id);
      var units = 0, products = new Set();
      (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
        if (!item || item.ventaLibre || item.controlInventario === false) return;
        var qty = numeric(item.qty != null ? item.qty : item.cantidad != null ? item.cantidad : item.quantity);
        var factor = item.unitsPerQty == null ? 1 : numeric(item.unitsPerQty);
        if (qty > 0 && factor >= 1 && Number.isFinite(qty * factor)) {
          units += qty * factor; products.add(text(item.product_id != null ? item.product_id : item.productoId != null ? item.productoId : item.id));
        }
      });
      if (!units) return;
      var at = recordTime(sale); if (!at) { skipped++; return; }
      if (at.day < from || at.day > to || !matchesType('Venta', filter)) return;
      var key = 'venta:' + (id || 'sin-id-' + index);
      products.forEach(function (p) { add(key, { type: 'Venta', day: at.day, time: at.time, timestamp: at.timestamp, reference: documentNumber(sale) || readable(id) || id, user: saleUser(sale) }, p, 0); });
      docs.get(key).outgoing = round(units);
    });
    var rows = Array.from(docs.values()).map(function (d) {
      return { key: d.key, type: d.type, day: d.day, time: d.time, timestamp: d.timestamp, reference: referenceLabel(d.reference || 'Sin referencia', d.type),
        productCount: d.products.size, incoming: d.incoming, outgoing: d.outgoing, user: d.user || '' };
    }).sort(function (a, b) { return b.timestamp - a.timestamp || a.key.localeCompare(b.key); });
    var total = rows.length;
    return { range: { from: from, to: to }, type: filter, rows: rows.slice(0, MAX_ROWS), total: total, truncated: total > MAX_ROWS, skipped: skipped };
  }
  // Alias de NA_ROLES.isOwner (fuente única del rol dueño). Falla cerrada si NA_ROLES falta, no es función, lanza o no da true.
  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  function policyReady() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  function featureUnlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(FEATURE_ID) === false); } catch (_) { return false; }
  }
  function canViewDocuments() { return isOwner() && policyReady(); }
  function sources() {
    var api = root.NuevoAmanecerCanonical, cloud = false, snap = {};
    try { cloud = !!(api && typeof api.enabled === 'function' && api.enabled()); snap = cloud && typeof api.snapshot === 'function' ? api.snapshot() : {}; } catch (_) { cloud = false; }
    return {
      sales: typeof ventas !== 'undefined' ? ventas : root.ventas,
      movements: cloud ? (snap && snap.inventoryMovements) : (typeof inventoryMovements !== 'undefined' ? inventoryMovements : root.inventoryMovements)
    };
  }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function quantity(value) { return value.toLocaleString('es-PE', { maximumFractionDigits: 6 }); }
  function unitsLabel(row) {
    var parts = [];
    if (row.incoming) parts.push('+' + quantity(row.incoming));
    if (row.outgoing) parts.push('−' + quantity(row.outgoing));
    return parts.join(' / ') || '0';
  }
  function dayLabel(day) { return day.split('-').reverse().join('/'); }
  function section() {
    var page = root.document && root.document.getElementById(PAGE_ID);
    return page ? page.querySelector('[data-kdoc]') : null;
  }
  function render() {
    var box = section(); if (!box) return false;
    var controls = box.querySelector('[data-kdoc-controls]'), status = box.querySelector('[data-kdoc-status]'), content = box.querySelector('[data-kdoc-content]');
    content.replaceChildren();
    // Falla cerrada: sin candado abierto o sin rol dueño, toda la sección queda oculta (sin aviso al empleado).
    if (!featureUnlocked() || !canViewDocuments()) { box.hidden = true; controls.hidden = true; status.textContent = ''; return false; }
    box.hidden = false; controls.hidden = false;
    var from = box.querySelector('[data-kdoc-from]'), to = box.querySelector('[data-kdoc-to]'), type = box.querySelector('[data-kdoc-type]');
    var defaults = periodRange();
    if (!from.value) from.value = defaults.from;
    if (!to.value) to.value = defaults.to;
    from.max = to.max = defaults.to;
    var data = sources(), report;
    try { report = buildDocuments(data.movements, data.sales, { from: from.value, to: to.value, type: type.value }); }
    catch (_) { status.textContent = 'Elige un rango válido: desde no puede superar hasta, ni hasta superar hoy.'; return false; }
    status.textContent = dayLabel(report.range.from) + ' al ' + dayLabel(report.range.to) + ' · hora de Lima · ' + report.total + ' documento(s) · historial cargado en este dispositivo';
    if (report.truncated) content.appendChild(element('p', 'kardex-note', 'Mostrando los ' + report.rows.length + ' documentos más recientes de ' + report.total + '. Acorta el rango de fechas.'));
    if (report.skipped) content.appendChild(element('p', 'kardex-note', report.skipped + ' registro(s) sin fecha o cantidad válida omitidos.'));
    if (!report.rows.length) { content.appendChild(element('p', 'kardex-note', 'Sin documentos que movieran stock en el período.')); return true; }
    var labels = ['Fecha y hora (Lima)', 'Tipo', 'Documento', 'Productos', 'Unidades', 'Usuario'];
    var table = element('table', 'kardex-table kdoc-table'), head = element('thead'), header = element('tr'), body = element('tbody');
    table.appendChild(element('caption', 'kardex-sr-only', 'Documentos que movieron stock · unidades físicas'));
    labels.forEach(function (label, i) { var th = element('th', i === 3 || i === 4 ? 'kardex-num' : '', label); th.scope = 'col'; header.appendChild(th); });
    head.appendChild(header);
    report.rows.forEach(function (r) {
      var line = element('tr'); line.setAttribute('data-kdoc-row', r.key);
      [dayLabel(r.day) + (r.time ? ' ' + r.time : ''), r.type, r.reference, quantity(r.productCount), unitsLabel(r), r.user || '—'].forEach(function (value, i) {
        var cell = element('td', i === 3 || i === 4 ? 'kardex-num' : '', value); cell.setAttribute('data-label', labels[i]); line.appendChild(cell);
      });
      body.appendChild(line);
    });
    table.appendChild(head); table.appendChild(body);
    var wrap = element('div', 'kardex-table-wrap'); wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Documentos que movieron stock');
    wrap.appendChild(table); content.appendChild(wrap);
    return true;
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID), box = section();
    if (!page || !box || box.__naKdocBound) return;
    box.__naKdocBound = true;
    box.addEventListener('input', function (e) { e.stopPropagation(); render(); });
    box.addEventListener('change', function (e) { e.stopPropagation(); render(); });
    box.querySelector('[data-kdoc-refresh]').addEventListener('click', function () { render(); });
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(function () { if (page.classList.contains('active')) render(); }).observe(page, { attributes: true, attributeFilter: ['class'] });
    ['na:role', 'na:canonical-updated', 'na:canonical-sale-projection', 'focus'].forEach(function (event) { root.addEventListener(event, function () { if (page.classList.contains('active') || !canViewDocuments()) render(); }); });
    render();
  }
  root.NA_KARDEX_DOCUMENTOS = Object.freeze({ FEATURE_ID: FEATURE_ID, buildDocuments: buildDocuments, periodRange: periodRange, limaDay: limaDay,
    movementKind: movementKind, canViewDocuments: canViewDocuments, featureUnlocked: featureUnlocked, render: render, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
  }
})(globalThis);
