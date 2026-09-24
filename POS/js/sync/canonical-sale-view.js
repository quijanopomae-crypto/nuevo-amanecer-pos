(function (root) {
  'use strict';

  var VERSION = 1;
  var last = null;
  var wrapped = Object.create(null);

  function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function sameId(a, b) { return a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b); }
  function enabled(canonical) {
    return !!(canonical && typeof canonical.enabled === 'function' && canonical.enabled());
  }
  function validBase(base) {
    return !!(base && Array.isArray(base.products) && Array.isArray(base.customers) && Array.isArray(base.credits));
  }
  function projectionBase(snapshot) {
    return { products: snapshot.products, customers: snapshot.customers, credits: snapshot.credits, sales: Array.isArray(snapshot.sales) ? snapshot.sales : [] };
  }
  function clearPanel(id) {
    var panel = root.document && root.document.getElementById(id);
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
  }
  function text(parent, tag, value, className) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    parent.appendChild(node);
    return node;
  }
  function section(targetId, id, title) {
    clearPanel(id);
    var target = root.document && root.document.getElementById(targetId);
    if (!target) return null;
    var panel = root.document.createElement('section');
    panel.id = id;
    panel.setAttribute('aria-label', title);
    panel.className = 'na-canonical-pending';
    text(panel, 'h3', title);
    target.appendChild(panel);
    return panel;
  }
  function pendingSales(view) {
    var sales = (view.sales || []).filter(function (sale) { return sale && (sale.status === 'PENDING_SYNC' || sale.source === 'CANONICAL_OUTBOX'); });
    if (!sales.length) { clearPanel('naCanonicalPendingSales'); return; }
    var panel = section('ventasContent', 'naCanonicalPendingSales', 'Ventas pendientes');
    if (!panel) return;
    sales.forEach(function (sale) {
      var card = root.document.createElement('article');
      card.className = 'na-canonical-pending-item';
      text(card, 'strong', sale.sale_id || sale.id || '');
      text(card, 'span', 'S/ ' + (Number(sale.total_cents) / 100).toFixed(2));
      text(card, 'span', sale.payment_method || '');
      text(card, 'time', sale.created_at || '');
      text(card, 'p', 'Pendiente de sincronización');
      if (sale.conflict === true) text(card, 'p', 'Conflicto pendiente: ' + String(sale.reason || 'CONFLICT'), 'na-canonical-conflict');
      panel.appendChild(card);
    });
  }
  function pendingCredits(view) {
    var credits = (view.credits || []).filter(function (credit) { return credit && credit.source === 'CANONICAL_OUTBOX'; });
    if (!credits.length) { clearPanel('naCanonicalPendingCredits'); return; }
    var panel = section('cliList', 'naCanonicalPendingCredits', 'Créditos pendientes');
    if (!panel) return;
    credits.forEach(function (credit) {
      var card = root.document.createElement('article');
      card.className = 'na-canonical-pending-item';
      text(card, 'strong', credit.sale_id || '');
      text(card, 'span', credit.customer_id || '');
      text(card, 'span', 'S/ ' + (Number(credit.amount_cents) / 100).toFixed(2));
      text(card, 'time', credit.due || '');
      text(card, 'p', 'Crédito pendiente de sincronización');
      panel.appendChild(card);
    });
  }
  function afterRender(name) {
    if (typeof root[name] !== 'function' || wrapped[name] === root[name]) return;
    var original = root[name];
    var replacement = function () {
      var result = original.apply(this, arguments);
      if (last) name === 'ventasRender' ? pendingSales(last) : pendingCredits(last);
      return result;
    };
    wrapped[name] = replacement;
    root[name] = replacement;
  }
  function installRenderHooks() {
    afterRender('ventasRender');
    afterRender('cliRender');
  }
  function rebuild() {
    var canonical = root.NuevoAmanecerCanonical;
    if (!enabled(canonical)) {
      clearPanel('naCanonicalPendingSales'); clearPanel('naCanonicalPendingCredits');
      return null;
    }
    try {
      var outbox = root.NuevoAmanecerCanonicalSaleOutbox;
      var projector = root.NuevoAmanecerCanonicalSaleProjection;
      if (typeof canonical.snapshot !== 'function' || typeof canonical.legacySnapshot !== 'function' ||
          !outbox || typeof outbox.snapshot !== 'function' || !projector || typeof projector.project !== 'function') throw new Error('CANONICAL_VIEW_UNAVAILABLE');
      var base = canonical.snapshot();
      var legacy = canonical.legacySnapshot();
      if (!validBase(base) || !legacy || !Array.isArray(legacy.products)) throw new Error('CANONICAL_VIEW_BASE_INVALID');
      var projected = projector.project(projectionBase(base), outbox.snapshot());
      if (!projected || !Array.isArray(projected.products) || !Array.isArray(projected.sales) || !Array.isArray(projected.credits)) throw new Error('CANONICAL_VIEW_PROJECTION_INVALID');
      var visualProducts = copy(legacy.products);
      visualProducts.forEach(function (product) {
        if (!product) return;
        var id = product.product_id !== undefined ? product.product_id : product.id;
        var match = projected.products.find(function (candidate) {
          return candidate && (sameId(id, candidate.product_id) || sameId(id, candidate.id));
        });
        if (match && typeof match.projected_stock === 'number' && Number.isFinite(match.projected_stock)) {
          product._canonicalRemoteStock = product.stock;
          product.stock = match.projected_stock;
          product._canonicalPendingStock = true;
        }
      });
      last = copy(projected);
      root.productos = visualProducts;
      installRenderHooks();
      if (typeof root.posRender === 'function') root.posRender();
      if (typeof root.invRender === 'function') root.invRender();
      pendingSales(last);
      pendingCredits(last);
      return copy(last);
    } catch (error) {
      if (root.console && typeof root.console.error === 'function') root.console.error('[Vista de ventas canónicas]', error && error.code || 'CANONICAL_VIEW_REBUILD_FAILED');
      return null;
    }
  }
  function lastView() { return copy(last); }

  var api = Object.freeze({ VERSION: VERSION, rebuild: rebuild, lastView: lastView });
  root.NuevoAmanecerCanonicalSaleView = api;

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('na:canonical-sale-projection', rebuild);
    root.addEventListener('na:canonical-updated', rebuild);
    root.addEventListener('storage', function (event) {
      var outbox = root.NuevoAmanecerCanonicalSaleOutbox;
      if (outbox && event && event.key === outbox.KEY) rebuild();
    });
  }
  if (root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('DOMContentLoaded', function () {
      var canonical = root.NuevoAmanecerCanonical;
      if (!enabled(canonical) || typeof canonical.snapshot !== 'function') return;
      try { if (validBase(canonical.snapshot())) rebuild(); }
      catch (error) {
        if (root.console && typeof root.console.error === 'function') root.console.error('[Vista de ventas canónicas]', error && error.code || 'CANONICAL_VIEW_REBUILD_FAILED');
      }
    });
  }
})(globalThis);
