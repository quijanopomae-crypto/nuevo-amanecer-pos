/* Nuevo Amanecer — «Clonar venta» (#160).
 * Desde el detalle de una venta en Ventas, prepara un carrito NUEVO en el Punto de
 * Venta con los mismos productos y cantidades. Usa solo posAdd (la misma función del
 * botón de cada producto), así que rigen los precios actuales del catálogo y los
 * controles de stock de siempre. No crea ninguna venta, no abre ni confirma el cobro
 * y no cambia el cálculo del TOTAL. El cliente de la venta original se propone en el
 * cobro, y el cajero puede cambiarlo. Las ventas anuladas no se pueden clonar. */
(function (root) {
  'use strict';

  var doc = root.document;
  var FEATURE = 'clonar-venta';
  var BTN_CLASS = 'na-clonar-venta-btn';
  var MAX_QTY = 9999;
  var pendingClientId = null;

  // Los globales del POS (let ventas, cart, productos…) se leen por su nombre.
  /* global ventas, cart, productos, posAdd, posUpdateCart, goPage, toast */
  var GLOBALS = {
    ventas: function () { return typeof ventas !== 'undefined' ? ventas : root.ventas; },
    cart: function () { return typeof cart !== 'undefined' ? cart : root.cart; },
    productos: function () { return typeof productos !== 'undefined' ? productos : root.productos; },
    posAdd: function () { return typeof posAdd !== 'undefined' ? posAdd : root.posAdd; },
    posUpdateCart: function () { return typeof posUpdateCart !== 'undefined' ? posUpdateCart : root.posUpdateCart; },
    goPage: function () { return typeof goPage !== 'undefined' ? goPage : root.goPage; },
    toast: function () { return typeof toast !== 'undefined' ? toast : root.toast; }
  };
  function g(name) { try { return GLOBALS[name](); } catch (_) { return undefined; } }

  function locked() {
    // Falla cerrado: si aún no cargan los permisos, se trata como bloqueado.
    try { var p = root.NA_PERMISSIONS; if (!p || typeof p.featureLocked !== 'function') return true; return p.featureLocked(FEATURE) !== false; }
    catch (_) { return true; }
  }

  function isAnnulled(sale) {
    if (!sale) return false;
    var st = String(sale.estado || sale.status || '').toLowerCase();
    return sale.anulada === true || sale.anulado === true || st === 'anulada' || st === 'anulado';
  }

  // Plan puro (se prueba sin navegador): qué líneas se agregan y cuáles no.
  function buildPlan(sale, products) {
    var plan = { lines: [], skipped: [], clientId: null, annulled: isAnnulled(sale) };
    if (!sale || plan.annulled) return plan;
    var byId = {};
    (Array.isArray(products) ? products : []).forEach(function (p) { if (p && p.id != null) byId[String(p.id)] = p; });
    var merged = {};
    (Array.isArray(sale.items) ? sale.items : []).forEach(function (item) {
      if (!item) return;
      var name = String(item.name || 'Producto');
      if (item.ventaLibre || item.tipoLinea === 'venta_libre') { plan.skipped.push({ name: name, reason: 'venta libre' }); return; }
      var product = item.id != null ? byId[String(item.id)] : null;
      if (!product) { plan.skipped.push({ name: name, reason: 'ya no está en el catálogo' }); return; }
      if (product.activo === false || product.activoVenta === false) { plan.skipped.push({ name: name, reason: 'no está activo para la venta' }); return; }
      var qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty <= 0) return;
      if (Math.floor(qty) !== qty) { plan.skipped.push({ name: name, reason: 'cantidad con decimales, agrégalo a mano' }); return; }
      var key = String(product.id);
      if (!merged[key]) { merged[key] = { productId: product.id, name: String(product.name || name), qty: 0 }; plan.lines.push(merged[key]); }
      merged[key].qty = Math.min(MAX_QTY, merged[key].qty + qty);
    });
    var cid = sale.clienteId != null ? sale.clienteId : sale.cliId;
    plan.clientId = cid != null && cid !== '' ? String(cid) : null;
    return plan;
  }

  function notify(msg, type) {
    var t = g('toast');
    if (typeof t === 'function') t(msg, type || 'success');
  }

  function findSale(id) {
    var list = g('ventas');
    return (Array.isArray(list) ? list : []).find(function (v) { return v && String(v.id) === String(id); }) || null;
  }

  function clone(saleId) {
    if (locked()) { notify('Clonar venta no está disponible', 'error'); return { ok: false, reason: 'locked' }; }
    var sale = findSale(saleId);
    if (!sale) { notify('No se encontró la venta', 'error'); return { ok: false, reason: 'not_found' }; }
    if (isAnnulled(sale)) { notify('No se puede clonar una venta anulada', 'error'); return { ok: false, reason: 'annulled' }; }
    var posAdd = g('posAdd'), cart = g('cart');
    if (typeof posAdd !== 'function' || !Array.isArray(cart)) { notify('El Punto de Venta no está listo', 'error'); return { ok: false, reason: 'pos' }; }
    var plan = buildPlan(sale, g('productos'));
    if (!plan.lines.length) { notify('Esta venta no tiene productos del catálogo para clonar', 'error'); return { ok: false, reason: 'empty', plan: plan }; }
    if (cart.length && !root.confirm('El carrito actual tiene productos. Se vaciará para preparar la venta clonada. ¿Continuar?')) {
      return { ok: false, reason: 'cancelled' };
    }
    cart.splice(0, cart.length);
    var short = [];
    plan.lines.forEach(function (line) {
      var added = 0;
      for (var i = 0; i < line.qty; i++) { if (posAdd(line.productId) === false) break; added++; }
      if (added < line.qty) short.push({ name: line.name, added: added, wanted: line.qty });
    });
    var update = g('posUpdateCart');
    if (typeof update === 'function') update();
    pendingClientId = plan.clientId;
    var goPage = g('goPage');
    if (typeof goPage === 'function') goPage('pagePOS');
    var notes = [];
    if (short.length) notes.push('stock insuficiente: ' + short.map(function (s) { return s.name + ' (' + s.added + ' de ' + s.wanted + ')'; }).join(', '));
    if (plan.skipped.length) notes.push('no se copió: ' + plan.skipped.map(function (s) { return s.name + ' (' + s.reason + ')'; }).join(', '));
    notify('Venta ' + String(sale.id) + ' clonada en el carrito. Revisa y cobra cuando quieras' + (notes.length ? '. Ojo, ' + notes.join('; ') : ''), notes.length ? 'error' : 'success');
    return { ok: true, plan: plan, short: short };
  }

  // Al abrir el cobro, propone el cliente de la venta original si sigue existiendo.
  function applyPendingClient() {
    if (!pendingClientId) return;
    var select = doc.getElementById('mVentaCliente');
    var id = pendingClientId;
    pendingClientId = null;
    if (!select || select.value) return;
    var has = Array.prototype.some.call(select.options || [], function (o) { return o.value === id; });
    if (!has) return;
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function watchCobro() {
    var modal = doc.getElementById('mCobro');
    if (!modal || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () {
      if (modal.classList.contains('open')) root.setTimeout(applyPendingClient, 0);
    }).observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function decorate() {
    var content = doc.getElementById('ventasContent');
    if (!content) return;
    var details = content.querySelectorAll('.v-detalle');
    var hide = locked();
    Array.prototype.forEach.call(details, function (box) {
      var existing = box.querySelector('.' + BTN_CLASS);
      if (hide) { if (existing) existing.remove(); return; }
      if (existing) return;
      // La lista segura (inline-10) usa ids «vd-sec-N»: el id de la venta va en el botón Ticket.
      var ref = box.querySelector('[data-na-sale-action="ticket"][data-sale-id]');
      var id = ref ? ref.dataset.saleId : (/^vd-(?!sec-\d+$)/.test(box.id) ? box.id.slice(3) : null);
      if (id == null) return;
      var sale = findSale(id);
      if (!sale) return;
      var wrap = doc.createElement('div');
      wrap.className = 'na-clonar-venta-wrap';
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = BTN_CLASS;
      btn.dataset.saleId = String(sale.id);
      btn.textContent = '📑 Clonar venta';
      if (isAnnulled(sale)) {
        btn.disabled = true;
        btn.title = 'Las ventas anuladas no se pueden clonar';
        btn.setAttribute('aria-label', 'Clonar venta (no disponible: venta anulada)');
      } else {
        btn.title = 'Prepara un carrito nuevo con estos productos. No cobra ni crea la venta.';
      }
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); clone(sale.id); });
      var acts = box.querySelector('.det-acts');
      if (acts) { acts.appendChild(btn); return; }
      wrap.appendChild(btn);
      box.appendChild(wrap);
    });
  }

  function init() {
    var content = doc.getElementById('ventasContent');
    if (content && typeof MutationObserver === 'function') {
      new MutationObserver(function () { decorate(); }).observe(content, { childList: true, subtree: true });
    }
    watchCobro();
    decorate();
    root.addEventListener('na:role', decorate);
    root.addEventListener('na:sales-rendered', decorate);
  }

  root.NA_CLONAR_VENTA = { buildPlan: buildPlan, isAnnulled: isAnnulled, clone: clone, decorate: decorate, _pendingClient: function () { return pendingClientId; } };
  if (!doc) return;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
