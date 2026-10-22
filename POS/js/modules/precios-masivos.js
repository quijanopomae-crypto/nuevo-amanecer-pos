/* Edición masiva de precios (id edicion-masiva-precios). SOLO DUEÑO.
 * Elige categoría y un cambio (% o monto fijo), revisa la vista previa y aplica.
 * - CANON activo: un product.update por producto (ruta solo dueño en el Worker, pide PIN al empleado;
 *   aquí además la pantalla es solo del dueño). Solo cambia price_cents; los demás campos se copian
 *   de la réplica (mismo payload que costo-compra-ficha.js) con concurrencia optimista.
 * - Modo local: productos[].precio + saveAllData, con reversión si no se guarda.
 * No muestra costos en esta versión. Solo textContent. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageEdicionPrecios';
  var MODES = { porcentaje: 'Subir o bajar %', monto: 'Sumar o restar S/' };
  var running = false;

  function isOwner() { try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; } }
  function policyReady() { try { var p = root.NA_PERMISSIONS; return !!(p && p.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; } }
  function allowed() { return isOwner() && policyReady(); }
  // Candado propio (#901). Falla cerrado: sin NA_PERMISSIONS, sin el id o con error, queda cerrado.
  var LOCK_ID = 'edicion-masiva-precios';
  function edicionPreciosUnlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(LOCK_ID) === false); }
    catch (_) { return false; }
  }
  // Miles con coma y dos decimales, igual que #872.
  function money(c) { var n = Number(c) / 100; return (n < 0 ? '-' : '') + 'S/ ' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function canon() { var c = root.NuevoAmanecerCanonical; try { return c && typeof c.enabled === 'function' && c.enabled() ? c : null; } catch (_) { return null; } }

  function catalog() {
    var c = canon();
    if (c && typeof c.snapshot === 'function') {
      var snap = c.snapshot() || {};
      return (Array.isArray(snap.products) ? snap.products : []).filter(function (p) { return p && p.price_cents != null; }).map(function (p) {
        return { id: String(p.product_id), name: String(p.name || p.product_id), category: String(p.category || 'Sin categoría'), priceCents: Math.round(Number(p.price_cents)) };
      });
    }
    var list; try { list = typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []; } catch (_) { list = []; } // eslint-disable-line no-undef
    return list.filter(function (p) { return p && p.id != null; }).map(function (p) {
      return { id: String(p.id), name: String(p.nombre || p.name || p.id), category: String(p.cat || p.category || 'Sin categoría'), priceCents: Math.round(Number(p.precio || 0) * 100) };
    });
  }
  // Nuevo precio en céntimos. Nunca negativo; 0 o sin cambio se omite en el plan.
  function newPrice(priceCents, mode, value) {
    var v = Number(value);
    if (!Number.isFinite(v)) return null;
    var out = mode === 'porcentaje' ? Math.round(priceCents * (1 + v / 100)) : mode === 'monto' ? priceCents + Math.round(v * 100) : null;
    return out == null ? null : Math.max(0, out);
  }
  function plan(items, opts) {
    opts = opts || {};
    if (!Object.prototype.hasOwnProperty.call(MODES, opts.mode)) throw new RangeError('Elige el tipo de cambio.');
    if (!Number.isFinite(Number(opts.value)) || String(opts.value).trim() === '' || Number(opts.value) === 0) throw new RangeError('Escribe un valor distinto de 0.');
    if (opts.mode === 'porcentaje' && (Number(opts.value) <= -100 || Number(opts.value) > 1000)) throw new RangeError('El porcentaje debe estar entre -99 y 1000.');
    return (Array.isArray(items) ? items : []).filter(function (p) { return !opts.category || p.category === opts.category; }).map(function (p) {
      var after = newPrice(p.priceCents, opts.mode, opts.value);
      return { id: p.id, name: p.name, category: p.category, before: p.priceCents, after: after };
    }).filter(function (r) { return r.after != null && r.after > 0 && r.after !== r.before; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
  }

  function keep(v) { return v === undefined ? null : v; }
  function alternates(raw) { var l = raw.alternate_codes_json; if (typeof l === 'string') { try { l = JSON.parse(l); } catch (_) { l = []; } } return Array.isArray(l) ? l.slice() : []; }
  function payload(raw, priceCents) {
    return { product_id: String(raw.product_id), expected_metadata_revision: Number(raw.metadata_revision) || 0, name: raw.name, sku: keep(raw.sku), barcode: keep(raw.barcode),
      alternate_codes: alternates(raw), category: keep(raw.category), brand: keep(raw.brand), description: keep(raw.description), icon: keep(raw.icon),
      cost_cents: keep(raw.cost_cents), price_cents: priceCents, box_price_cents: keep(raw.box_price_cents),
      units_per_box: keep(raw.units_per_box), stock_min_quantity: raw.stock_min_quantity == null ? 0 : raw.stock_min_quantity, expiry_date: keep(raw.expiry_date) };
  }
  async function applyCanon(client, rows, onStep) {
    var done = [], failed = [];
    for (var i = 0; i < rows.length; i++) {
      if (!allowed() || !edicionPreciosUnlocked()) { failed.push({ id: rows[i].id, error: 'not_owner' }); break; }
      try { if (typeof client.refresh === 'function') await client.refresh(); } catch (_) {}
      var snap = client.snapshot() || {}, id = rows[i].id;
      var raw = (snap.products || []).find(function (p) { return String(p.product_id) === id; });
      if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'metadata_revision')) { failed.push({ id: id, error: 'not_found' }); break; }
      if (Math.round(Number(raw.price_cents)) !== rows[i].before) { failed.push({ id: id, error: 'changed' }); break; }
      try { await client.updateProduct(payload(raw, rows[i].after)); done.push(rows[i]); }
      catch (e) { failed.push({ id: id, error: String(e && e.message || e) }); break; } // una pendiente bloquea las demás
      if (onStep) onStep(done.length, rows.length);
    }
    return { done: done, failed: failed };
  }
  async function applyLocal(rows) {
    if (!edicionPreciosUnlocked()) return { done: [], failed: rows.map(function (r) { return { id: r.id, error: 'locked' }; }) };
    var list; try { list = productos; } catch (_) { list = []; } // eslint-disable-line no-undef
    var changes = rows.map(function (r) { var p = list.find(function (x) { return String(x.id) === r.id; }); return p ? { p: p, before: p.precio, row: r } : null; }).filter(Boolean);
    changes.forEach(function (c) { c.p.precio = c.row.after / 100; });
    var ok = false;
    try { var saved = typeof saveAllData === 'function' ? await saveAllData() : null; ok = typeof _naWasPersisted === 'function' ? _naWasPersisted(saved) : !!saved; } catch (_) { ok = false; } // eslint-disable-line no-undef
    if (!ok) {
      changes.forEach(function (c) { c.p.precio = c.before; });
      try { if (typeof saveAllData === 'function') await saveAllData(); } catch (_) {} // eslint-disable-line no-undef
      return { done: [], failed: changes.map(function (c) { return { id: c.row.id, error: 'NO_PERSISTIDO' }; }) };
    }
    changes.forEach(function (c) {
      try { if (root.NA_PRICE_HISTORY) root.NA_PRICE_HISTORY.recordDiff({ productId: c.p.id, origin: 'masivo', partial: true, before: { precio: c.before }, after: { precio: c.p.precio } }); } catch (_) {}
    });
    try { if (typeof root.invRender === 'function') root.invRender(); } catch (_) {}
    return { done: changes.map(function (c) { return c.row; }), failed: [] };
  }

  function el(tag, cls, text) { var n = root.document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; }
  function q(page, sel) { return page.querySelector(sel); }
  function options(page) { return { category: q(page, '[data-pm-category]').value, mode: q(page, '[data-pm-mode]').value, value: q(page, '[data-pm-value]').value }; }

  var current = [];
  function render() {
    var page = root.document && root.document.getElementById(PAGE_ID);
    if (!page) return false;
    var main = q(page, '[data-pm-main]'), status = q(page, '[data-pm-status]'), content = q(page, '[data-pm-content]'), apply = q(page, '[data-pm-apply]');
    content.replaceChildren(); current = []; apply.disabled = true;
    if (!edicionPreciosUnlocked()) { main.hidden = true; status.textContent = 'Disponible pronto.'; return false; }
    if (!allowed()) { main.hidden = true; status.textContent = 'Sin permiso. Solo el dueño puede cambiar precios en bloque.'; return false; }
    main.hidden = false;
    var items = catalog(), cat = q(page, '[data-pm-category]'), keepCat = cat.value;
    var cats = Array.from(new Set(items.map(function (p) { return p.category; }))).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    var all = el('option', '', 'Todas las categorías'); all.value = ''; cat.replaceChildren(all);
    cats.forEach(function (c) { var o = el('option', '', c); o.value = c; cat.appendChild(o); });
    cat.value = cats.indexOf(keepCat) >= 0 ? keepCat : '';
    var rows;
    try { rows = plan(items, options(page)); } catch (e) { status.textContent = e instanceof RangeError ? e.message : 'No se pudo preparar la vista previa.'; return false; }
    current = rows;
    status.textContent = rows.length ? rows.length + (rows.length === 1 ? ' producto cambiará' : ' productos cambiarán') + ' de precio. Revisa y pulsa «Aplicar».' : 'Ningún producto cambia con estos datos.';
    if (!rows.length) return true;
    var wrap = el('div', 'pm-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Vista previa de precios');
    var t = el('table', 'pm-table'), h = el('thead'), tr = el('tr');
    ['Producto', 'Categoría', 'Precio actual', 'Precio nuevo'].forEach(function (x) { var th = el('th', '', x); th.scope = 'col'; tr.appendChild(th); });
    h.appendChild(tr); t.appendChild(h);
    var b = el('tbody');
    rows.forEach(function (r) {
      var line = el('tr'); var th = el('th', '', r.name); th.scope = 'row'; line.appendChild(th);
      line.append(el('td', '', r.category), el('td', 'pm-num', money(r.before)), el('td', 'pm-num pm-new', money(r.after)));
      b.appendChild(line);
    });
    t.appendChild(b); wrap.appendChild(t); content.appendChild(wrap);
    apply.disabled = false;
    apply.textContent = 'Aplicar a ' + rows.length + (rows.length === 1 ? ' producto' : ' productos');
    return true;
  }
  // PIN del dueño UNA vez por lote (mismo paso que #62): en la nube NA_ROLES.approve('product.update'),
  // en modo local el PIN maestro. Falla cerrado si no hay forma de comprobarlo.
  function cloudMode() { try { var c = root.NuevoAmanecerCanonical; return !!(c && typeof c.enabled === 'function' && c.enabled()); } catch (_) { return true; } }
  function notify(msg, type) { try { if (typeof root.toast === 'function') root.toast(msg, type || 'error'); } catch (_) {} }
  async function askOwnerPin(n) {
    var roles = root.NA_ROLES, detail = 'Se cambiará el precio de ' + n + ' producto(s). Escribe tu PIN una sola vez para todo el lote.';
    if (!roles || typeof roles.askPin !== 'function') return false;
    if (cloudMode()) {
      if (roles.role !== 'owner' || !roles.confirmed || typeof roles.approve !== 'function') { notify('Solo el aparato del dueño puede hacer esto.'); return false; }
      var opId = 'precios-masivos-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      return !!(await roles.approve('product.update', opId, 'Cambiar precios en lote', detail));
    }
    var hasPin = false; try { hasPin = !!(_naSecurity.pinEnabled && _naSecurity.pinHash); } catch (_) {} // eslint-disable-line no-undef
    if (!hasPin) { notify('Configura primero el PIN maestro para cambiar precios en lote.'); return false; }
    return !!(await roles.askPin('Cambiar precios en lote', detail, function (pin) {
      var valid = false; try { valid = !!_naPinValid(pin); } catch (_) {} // eslint-disable-line no-undef
      return valid ? { ok: true, value: true } : { msg: 'PIN incorrecto.' };
    }));
  }
  async function applyAll() {
    var page = root.document.getElementById(PAGE_ID);
    if (running || !edicionPreciosUnlocked() || !allowed() || !current.length) return null;
    var rows = current.slice(), status = q(page, '[data-pm-status]'), apply = q(page, '[data-pm-apply]');
    running = true; apply.disabled = true;
    try {
      if (!(await askOwnerPin(rows.length))) { status.textContent = 'No se cambió nada: falta el PIN del dueño.'; apply.disabled = false; return null; }
      if (!edicionPreciosUnlocked()) { status.textContent = 'No se cambió nada: la función aún no está disponible.'; return null; }
      var c = canon();
      status.textContent = 'Aplicando…';
      var out = c && typeof c.updateProduct === 'function'
        ? await applyCanon(c, rows, function (n, total) { status.textContent = 'Aplicando… ' + n + ' de ' + total; })
        : await applyLocal(rows);
      status.textContent = out.failed.length
        ? 'Se cambiaron ' + out.done.length + ' de ' + rows.length + '. Se detuvo en un producto que no se pudo actualizar; revisa y vuelve a intentar.'
        : 'Listo: se cambió el precio de ' + out.done.length + (out.done.length === 1 ? ' producto.' : ' productos.');
      q(page, '[data-pm-value]').value = '';
      var keepMsg = status.textContent; render(); status.textContent = keepMsg;
      return out;
    } finally { running = false; }
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID);
    if (!page || page.__naPmBound) return;
    page.__naPmBound = true;
    ['change', 'input'].forEach(function (ev) { page.addEventListener(ev, function (e) { if (e.target && e.target.matches('[data-pm-category],[data-pm-mode],[data-pm-value]')) render(); }); });
    q(page, '[data-pm-apply]').addEventListener('click', applyAll);
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(function () { if (page.classList.contains('active')) render(); }).observe(page, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', render);
    render();
  }
  root.NA_PRECIOS_MASIVOS = Object.freeze({ plan: plan, newPrice: newPrice, payload: payload, catalog: catalog, render: render, apply: applyAll, unlocked: edicionPreciosUnlocked, MODES: MODES });
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true }); else init(); }
})(globalThis);
