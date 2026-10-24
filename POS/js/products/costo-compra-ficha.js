/* Costo de compra en la ficha (Misión 2). Solo dueño confirmado (NA_ROLES.isOwner en try/catch).
 * Dos partes:
 * 1) En la ficha: el recuadro propone el costo de la ÚLTIMA compra (o el promedio ponderado), llena pCosto
 *    y recalcula el margen. Esta parte no guarda: el dueño pulsa Guardar y la ficha sigue su camino normal
 *    (CANON: product.update con cost_cents; local: saveProd), que lo anota como «Ficha del producto».
 * 2) Al REGISTRAR una compra (afterCanonPurchase / afterLocalPurchase) SÍ guarda automáticamente el nuevo
 *    costo del producto: en CANON con product.update (ruta solo dueño) y en modo local en productos[].costo
 *    con saveAllData, anotado como «Compra». Las líneas sin costo, con costo 0 (regalo) o no finito se omiten.
 * No toca ventas, pagos ni stock. */
(function (root) {
  'use strict';
  var BOX_ID = 'naCostoCompraFicha';
  var ticket = 0;
  function doc() { return root.document; }
  function isOwner() { try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; } }
  function hist() { return root.NA_HISTORIAL_COMPRAS; }
  function canon() { try { var c = root.NuevoAmanecerCanonical; return c && typeof c.enabled === 'function' && c.enabled() ? c : null; } catch (_) { return null; } }
  function localMoves() { try { return typeof inventoryMovements !== 'undefined' && Array.isArray(inventoryMovements) ? inventoryMovements : []; } catch (_) { return []; } } // eslint-disable-line no-undef
  function canonMoves() { var c = canon(); try { var s = c && c.snapshot(); return s && Array.isArray(s.inventoryMovements) ? s.inventoryMovements : []; } catch (_) { return []; } }
  function editingId() { try { return typeof invEditId !== 'undefined' && invEditId != null ? String(invEditId) : ''; } catch (_) { return ''; } } // eslint-disable-line no-undef
  function round2(cents) { return Math.round(cents) / 100; }
  // Elige el costo: 'ultima' (por defecto) o 'promedio'. Devuelve soles con 2 decimales o null.
  function pick(summary, mode) {
    if (!summary) return null;
    if (mode === 'promedio') return summary.weightedUnitCostCents == null ? null : round2(summary.weightedUnitCostCents);
    var last = summary.lastPurchase;
    return last && last.unitCostCents != null ? round2(last.unitCostCents) : null;
  }
  // Última compra CON costo (la más reciente con fecha que tenga costo).
  function lastCosted(rows) {
    var list = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && r.unitCostCents != null && r.timestamp != null; });
    list.sort(function (a, b) { return b.timestamp - a.timestamp; });
    return list[0] || null;
  }
  function margin(cost, price) {
    cost = Number(cost); price = Number(price);
    if (!(cost > 0) || !(price > 0)) return null;
    return Math.round(((price - cost) / cost) * 1000) / 10;
  }
  // extra: compra recién confirmada; se agrega si la consulta al servidor aún no la trae (o falló).
  async function summaryFor(id, extra) {
    var h = hist(); if (!h || typeof h.buildHistory !== 'function') return null;
    var purchases = [];
    if (canon() && typeof h.readPurchases === 'function') {
      try { var r = await h.readPurchases(); purchases = (r && Array.isArray(r.purchases)) ? r.purchases : []; } catch (_) { purchases = []; }
    }
    // El Worker guarda la compra con purchase_id = operation_id (pos-purchases.js); también se compara operation_id por si acaso.
    if (extra && extra.purchase_id && !purchases.some(function (p) { return p && (String(p.purchase_id) === String(extra.purchase_id) || String(p.operation_id) === String(extra.purchase_id)); })) purchases = purchases.concat([extra]);
    var built = h.buildHistory(purchases, canonMoves().concat(localMoves()), id);
    var s = built.summary || {};
    return { lastPurchase: lastCosted(built.rows), weightedUnitCostCents: s.weightedUnitCostCents == null ? null : s.weightedUnitCostCents };
  }
  function el(tag, cls, txt) { var n = doc().createElement(tag); if (cls) n.className = cls; if (txt !== undefined) n.textContent = String(txt); return n; }
  function money(cents) { return cents == null ? 'Sin costo registrado' : 'S/ ' + (cents / 100).toFixed(2); }
  function limaLabel(ms) { var h = hist(); try { return h && h.limaLabel ? h.limaLabel(ms) : ''; } catch (_) { return ''; } }
  function removeBox() { var b = doc().getElementById(BOX_ID); if (b) b.remove(); }
  function apply(mode, summary) {
    if (!isOwner()) { removeBox(); return false; }
    var value = pick(summary, mode), input = doc().getElementById('pCosto');
    if (value == null || !input) return false;
    input.value = value.toFixed(2);
    try { if (typeof calcMargen === 'function') calcMargen(); } catch (_) {} // eslint-disable-line no-undef
    var msg = doc().querySelector('#' + BOX_ID + ' [data-ccf-msg]');
    if (msg) msg.textContent = 'Costo propuesto: S/ ' + value.toFixed(2) + (mode === 'promedio' ? ' (promedio)' : ' (última compra)') + '. Pulsa Guardar para aplicarlo; quedará en el historial de precios.';
    return true;
  }
  async function render() {
    var own = ++ticket;
    removeBox();
    var id = editingId(), input = doc().getElementById('pCosto');
    if (!id || !input || !isOwner()) return false;
    var summary = await summaryFor(id);
    if (own !== ticket || !isOwner() || editingId() !== id) return false;
    var grid = input.closest('.prod-unified-grid2') || input.parentElement;
    var box = el('div', 'ccf-box'); box.id = BOX_ID;
    var last = summary && summary.lastPurchase;
    box.appendChild(el('p', 'ccf-line', last ? 'Última compra: ' + money(last.unitCostCents) + ' · ' + limaLabel(last.timestamp) : 'Sin compras con costo para este producto.'));
    box.appendChild(el('p', 'ccf-line', 'Promedio ponderado: ' + money(summary ? summary.weightedUnitCostCents : null)));
    var actions = el('div', 'ccf-actions');
    var b1 = el('button', 'ccf-btn', 'Usar costo de última compra'); b1.type = 'button'; b1.setAttribute('data-ccf', 'ultima'); b1.disabled = pick(summary, 'ultima') == null;
    var b2 = el('button', 'ccf-btn ccf-btn-alt', 'Usar promedio'); b2.type = 'button'; b2.setAttribute('data-ccf', 'promedio'); b2.disabled = pick(summary, 'promedio') == null;
    actions.appendChild(b1); actions.appendChild(b2); box.appendChild(actions);
    var pref = el('label', 'ccf-pref'), chk = el('input'); chk.type = 'checkbox'; chk.setAttribute('data-ccf-mode', ''); chk.checked = costMode() === 'promedio';
    chk.addEventListener('change', function () { setCostMode(chk.checked ? 'promedio' : 'ultima'); });
    pref.appendChild(chk); pref.appendChild(doc().createTextNode(' Al registrar compras, usar el promedio ponderado (si no, la última compra)')); box.appendChild(pref);
    var msg = el('p', 'ccf-msg'); msg.setAttribute('data-ccf-msg', ''); msg.setAttribute('role', 'status'); box.appendChild(msg);
    box.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-ccf]'); if (b) apply(b.getAttribute('data-ccf'), summary); });
    grid.insertAdjacentElement('afterend', box);
    return true;
  }
  function init() {
    var modal = doc() && doc().getElementById('mProd'); if (!modal || !root.MutationObserver) return;
    var open = false;
    new root.MutationObserver(function () {
      var now = modal.classList.contains('open');
      if (now && !open) render(); else if (!now) { ticket++; removeBox(); }
      open = now;
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { if (!isOwner()) removeBox(); else if (modal.classList.contains('open')) render(); });
  }
  // ---- Actualización automática al REGISTRAR una compra (solo dueño) ----
  // Preferencia del dueño: 'ultima' (por defecto) o 'promedio'.
  var MODE_KEY = 'na_costo_compra_modo_v1';
  function costMode() { try { return root.localStorage && root.localStorage.getItem(MODE_KEY) === 'promedio' ? 'promedio' : 'ultima'; } catch (_) { return 'ultima'; } }
  function setCostMode(mode) { if (!isOwner()) return false; try { root.localStorage.setItem(MODE_KEY, mode === 'promedio' ? 'promedio' : 'ultima'); return true; } catch (_) { return false; } }
  // Último costo por producto dentro de la compra (si un producto viene en varias líneas, gana la última).
  function lineCosts(lines, appliedLines) {
    var out = new Map();
    (Array.isArray(lines) ? lines : []).forEach(function (l) {
      // Un regalo (costo 0), un costo negativo o no finito nunca reemplaza el costo del producto.
      if (!l || l.unit_cost_cents == null || l.unit_cost_cents === '') return;
      var c = Number(l.unit_cost_cents);
      if (!Number.isFinite(c) || !(Math.round(c) > 0)) return;
      if (appliedLines && !appliedLines[String(l.line)]) return;
      out.set(String(l.product_id), Math.round(c));
    });
    return out;
  }
  async function targetCents(id, lastCents, extra) {
    if (costMode() !== 'promedio') return lastCents;
    try { var s = await summaryFor(id, extra); return s && s.weightedUnitCostCents != null ? Math.round(s.weightedUnitCostCents) : lastCents; } catch (_) { return lastCents; }
  }
  // Exactamente la lista guardada: product.update escribe una revisión completa de estos campos.
  function alternates(raw) {
    var list = raw.alternate_codes_json;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch (_) { list = []; } }
    return Array.isArray(list) ? list.slice() : [];
  }
  // El Worker (normalizeUpdate) recibe y reescribe estos 14 campos; imagen, unidad, impuestos, stock y
  // control de inventario no viajan y no cambian. Todo se copia tal cual de la réplica salvo cost_cents.
  function keep(v) { return v === undefined ? null : v; }
  function updatePayload(raw, costCents) {
    return { product_id: String(raw.product_id), expected_metadata_revision: Number(raw.metadata_revision) || 0, name: raw.name, sku: keep(raw.sku), barcode: keep(raw.barcode),
      alternate_codes: alternates(raw), category: keep(raw.category), brand: keep(raw.brand), description: keep(raw.description), icon: keep(raw.icon),
      cost_cents: costCents, price_cents: raw.price_cents, box_price_cents: keep(raw.box_price_cents),
      units_per_box: keep(raw.units_per_box), stock_min_quantity: raw.stock_min_quantity == null ? 0 : raw.stock_min_quantity, expiry_date: keep(raw.expiry_date) };
  }
  function notify(msg, kind) { try { if (typeof root.toast === 'function') root.toast(msg, kind || 'info'); } catch (_) {} }
  function productRaw(client, id) {
    var snap = client.snapshot();
    return (snap && Array.isArray(snap.products) ? snap.products : []).find(function (p) { return String(p.product_id) === id; }) || null;
  }
  // Concurrencia optimista: el Worker rechaza con 409 stale_product si expected_metadata_revision no es la
  // del servidor (a6-products.js). Se refresca la réplica justo antes de armar el payload; si otro aparato
  // cambió el producto entre medio, se descarta el rechazo, se refresca y se reintenta UNA vez con sus datos.
  async function updateOne(client, id, last, current) {
    for (var attempt = 0; attempt < 2; attempt++) {
      try { if (typeof client.refresh === 'function') await client.refresh(); } catch (_) {}
      var raw = productRaw(client, id);
      if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'metadata_revision')) return { status: 'skipped' };
      var cents = await targetCents(id, last, current);
      if (!Number.isFinite(cents) || !(cents > 0) || Number(raw.cost_cents) === cents) return { status: 'skipped' };
      try {
        await client.updateProduct(updatePayload(raw, cents));
        try { if (typeof client.refresh === 'function') await client.refresh(); } catch (_) {}
        return { status: 'updated', row: { product_id: id, before_cents: raw.cost_cents == null ? null : Number(raw.cost_cents), after_cents: cents } };
      } catch (e) {
        var pending = null; try { pending = typeof client.pendingSnapshot === 'function' ? client.pendingSnapshot() : null; } catch (_) {}
        var stale = String(e && e.message || '').indexOf('stale_product') >= 0 || !!(pending && pending.command === 'product.update' && pending.last_error === 'stale_product');
        var dropped = false;
        // Solo se descarta el rechazo de ESTE producto; uno de otro producto queda para que el dueño lo resuelva.
        var mine = !!(pending && pending.payload && String(pending.payload.product_id) === id);
        if (pending && pending.command === 'product.update' && pending.last_error && mine) { try { dropped = typeof client.discardRejectedProduct === 'function' && await client.discardRejectedProduct(); } catch (_) {} }
        if (stale && attempt === 0 && (dropped || !pending)) continue;
        return { status: 'failed', error: stale ? 'stale_product' : String(e && e.message || e) };
      }
    }
    return { status: 'failed', error: 'stale_product' };
  }
  // CANON: tras la compra confirmada por /auth/purchases, el dueño actualiza el costo con product.update
  // (ruta solo dueño en el Worker). El historial ya lo registró recordPurchase (origen «Compra»).
  async function afterCanonPurchase(operationId, lines, result) {
    var report = { updated: [], skipped: [], failed: [] };
    if (!isOwner()) { report.skipped.push('not_owner'); return report; }
    if (!result || result.idempotent) { report.skipped.push('replay'); return report; }
    var applied = {};
    (result.applied || []).forEach(function (r) { var n = r && (r.line != null ? r.line : r.line_number); if (n != null) applied[String(n)] = true; });
    var client = canon();
    if (!client || typeof client.updateProduct !== 'function' || typeof client.snapshot !== 'function') { report.skipped.push('canon_unavailable'); return report; }
    var costs = lineCosts(lines, applied);
    // La compra recién confirmada, en el formato de /auth/purchases, para que el promedio la incluya.
    var current = { purchase_id: String(operationId), status: 'aplicada', created_at: new Date().toISOString(),
      lines: (Array.isArray(lines) ? lines : []).filter(function (l) { return l && applied[String(l.line)]; }).map(function (l) { return { line_number: Number(l.line), product_id: String(l.product_id), quantity: Number(l.quantity), unit_cost_cents: l.unit_cost_cents == null ? null : Number(l.unit_cost_cents) }; }) };
    for (var [id, last] of costs) {
      if (!isOwner()) { report.skipped.push('not_owner'); break; }
      var outcome = await updateOne(client, id, last, current);
      if (outcome.status === 'updated') report.updated.push(outcome.row);
      else if (outcome.status === 'skipped') report.skipped.push(id);
      else { report.failed.push({ product_id: id, error: outcome.error }); break; } // una pendiente bloquea las demás: parar
    }
    if (report.failed.length) notify('Compra registrada, pero no se actualizó el costo de ' + report.failed.length + ' producto(s). Revísalo en la ficha.', 'warning');
    return report;
  }
  // Modo local: tras la compra persistida, el dueño actualiza product.costo, guarda y lo anota en el historial.
  async function afterLocalPurchase(operationId, result) {
    var report = { updated: [], skipped: [], failed: [] };
    if (!isOwner()) { report.skipped.push('not_owner'); return report; }
    if (!result || !result.ok || !Array.isArray(result.applied) || !result.applied.length) { report.skipped.push('nothing'); return report; }
    var list; try { list = typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []; } catch (_) { list = []; } // eslint-disable-line no-undef
    var lines = result.applied.map(function (a) { return { line: a.sourceIndex, product_id: a.productId, unit_cost_cents: a.unitCost == null || a.unitCost === '' ? null : Math.round(Number(a.unitCost) * 100) }; });
    var changes = [];
    for (var [id, last] of lineCosts(lines)) {
      var p = list.find(function (x) { return x && String(x.id) === id; }); if (!p) continue;
      var cents = await targetCents(id, last), before = p.costo;
      if (!Number.isFinite(cents) || !(cents > 0)) { report.skipped.push(id); continue; }
      if (Math.round(Number(before) * 100) === cents) { report.skipped.push(id); continue; }
      changes.push({ p: p, before: before, after: cents / 100, line: lines.filter(function (l) { return String(l.product_id) === id; }).pop().line });
    }
    if (!changes.length) return report;
    changes.forEach(function (c) { c.p.costo = c.after; });
    var ok = false;
    try { var saved = typeof saveAllData === 'function' ? await saveAllData() : null; ok = typeof _naWasPersisted === 'function' ? _naWasPersisted(saved) : !!saved; } catch (_) { ok = false; } // eslint-disable-line no-undef
    if (!ok) {
      changes.forEach(function (c) { c.p.costo = c.before; });
      try { if (typeof saveAllData === 'function') await saveAllData(); } catch (_) {} // eslint-disable-line no-undef
      changes.forEach(function (c) { report.failed.push({ product_id: String(c.p.id), error: 'NO_PERSISTIDO' }); });
      notify('Compra aplicada, pero no se pudo guardar el nuevo costo. Revísalo en la ficha.', 'warning');
      return report;
    }
    changes.forEach(function (c) {
      try { if (root.NA_PRICE_HISTORY) root.NA_PRICE_HISTORY.recordDiff({ productId: c.p.id, origin: 'compra', ref: String(operationId) + ':' + c.line, partial: true, before: { costo: c.before }, after: { costo: c.after } }); } catch (_) {}
      report.updated.push({ product_id: String(c.p.id), before: c.before, after: c.after });
    });
    try { if (typeof root.invRender === 'function') root.invRender(); } catch (_) {}
    return report;
  }
  root.NA_COSTO_COMPRA_FICHA = Object.freeze({ pick: pick, lastCosted: lastCosted, margin: margin, summaryFor: summaryFor, render: render, apply: apply, init: init,
    costMode: costMode, setCostMode: setCostMode, lineCosts: lineCosts, updatePayload: updatePayload, afterCanonPurchase: afterCanonPurchase, afterLocalPurchase: afterLocalPurchase, MODE_KEY: MODE_KEY });
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init(); }
})(globalThis);
