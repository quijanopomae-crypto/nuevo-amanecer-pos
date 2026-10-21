/* Costo de compra en la ficha (Misión 2). Solo dueño confirmado (NA_ROLES.isOwner en try/catch).
 * Propone el costo de la ÚLTIMA compra (o el promedio ponderado si el dueño lo elige), llena pCosto y
 * recalcula el margen. No guarda nada: el dueño pulsa Guardar y la ficha sigue su camino normal
 * (CANON: product.update con cost_cents, ruta solo dueño; local: saveProd), que ya registra el cambio
 * en el historial de precios (origen «Ficha del producto»). No toca ventas, pagos ni stock. */
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
  async function summaryFor(id) {
    var h = hist(); if (!h || typeof h.buildHistory !== 'function') return null;
    var purchases = [];
    if (canon() && typeof h.readPurchases === 'function') {
      try { var r = await h.readPurchases(); purchases = (r && Array.isArray(r.purchases)) ? r.purchases : []; } catch (_) { purchases = []; }
    }
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
  root.NA_COSTO_COMPRA_FICHA = Object.freeze({ pick: pick, lastCosted: lastCosted, margin: margin, summaryFor: summaryFor, render: render, apply: apply, init: init });
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init(); }
})(globalThis);
