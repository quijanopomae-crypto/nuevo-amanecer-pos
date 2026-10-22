/* Edición masiva de productos (#62, id edicion-masiva-productos): categoría y estado ACTIVO/DESCONTINUADO.
 * Los precios en bloque son #61 (PR #901, precios-masivos.js); aquí no se tocan precios.
 * Solo el dueño. Cada producto se guarda por el MISMO camino que «Editar producto»:
 * editProd(id) → se cambian los campos del formulario → guardarProd() (local: saveAllData;
 * CANON: NuevoAmanecerCanonicalProductBridge → product.update). No hay escritura propia.
 * PIN: se pide UNA vez para el lote. En la nube se comprueba en el servidor con /auth/owner-approval
 * (acción product.update); en el aparato del dueño el Worker no pide aprobación por producto.
 * En modo local se comprueba con el PIN maestro. Nunca muestra costos. DOM solo con textContent. */
(function (root) {
  'use strict';
  var doc = root.document;
  var ALL = 'todas';
  function text(v) { return v == null ? '' : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
  function money(v) {
    try { if (typeof _naPosDisplayMoney === 'function') return _naPosDisplayMoney(v); } catch (_) {} // eslint-disable-line no-undef
    return 'S/ ' + (Number(v) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function catKey(p) { return text(p && p.cat).trim().toLowerCase(); }
  function isEditable(p) { return !!p && p.id != null && !p.ventaLibre && !p.eliminado && !p.deleted && !p.deleted_at && text(p.name).trim() !== ''; }

  function filterProducts(products, f) {
    var o = f || {}, q = text(o.q).trim().toLowerCase(), cat = o.cat || ALL;
    return (Array.isArray(products) ? products : []).filter(function (p) {
      if (!isEditable(p)) return false;
      if (cat !== ALL && catKey(p) !== cat) return false;
      if (!q) return true;
      return [p.name, p.sku, p.barcode].some(function (s) { return text(s).toLowerCase().indexOf(q) >= 0; });
    });
  }
  // Filas de la vista previa: solo productos que cambian. Sin costo.
  function buildPreview(products, ids, opts) {
    var o = opts || {}, set = new Set((ids || []).map(String)), rows = [];
    (Array.isArray(products) ? products : []).forEach(function (p) {
      if (!isEditable(p) || !set.has(String(p.id))) return;
      var row = { id: p.id, name: text(p.name).trim(), price: num(p.precio), cat: catKey(p), activo: p.activo !== false, changes: {} };
      if (o.cat && catKey(p) !== text(o.cat).toLowerCase()) row.changes.cat = o.cat;
      if (o.activo === 'true' && p.activo === false) row.changes.activo = 'true';
      if (o.activo === 'false' && p.activo !== false) row.changes.activo = 'false';
      if (Object.keys(row.changes).length) rows.push(row);
    });
    return rows;
  }

  function cloud() { try { return !!(root.NuevoAmanecerCanonical && root.NuevoAmanecerCanonical.enabled()); } catch (_) { return false; } }
  // Candado 'edicion-masiva-productos': visible solo si los permisos cargaron y el candado está abierto (falla cerrado).
  function unlocked() { try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked('edicion-masiva-productos') === false); } catch (_) { return false; } }
  function isOwner() { try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; } }
  function catalog() { try { return typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []; } catch (_) { return []; } } // eslint-disable-line no-undef
  function categories() {
    try { if (typeof _naAllCategories === 'function') return _naAllCategories().map(function (c) { return { value: text(c.value), label: text(c.label) }; }); } catch (_) {} // eslint-disable-line no-undef
    var seen = {}; catalog().forEach(function (p) { var k = catKey(p); if (k) seen[k] = 1; });
    return Object.keys(seen).sort().map(function (k) { return { value: k, label: k }; });
  }
  function catLabel(v) { var c = categories().find(function (x) { return x.value === v; }); return c ? c.label : v; }
  function el(tag, cls, txt) { var n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function opt(sel, value, label) { var o = el('option', null, label); o.value = value; sel.appendChild(o); return o; }
  function notify(msg, kind) { try { if (typeof toast === 'function') toast(msg, kind); } catch (_) {} } // eslint-disable-line no-undef

  var dlg = null, selected = new Set(), preview = [], running = false;
  function q(s) { return dlg.querySelector(s); }
  function options() {
    return { cat: q('[data-pl-newcat]').value, activo: cloud() ? '' : q('[data-pl-activo]').value };
  }
  function renderList() {
    var list = q('[data-pl-list]'); list.textContent = '';
    var items = filterProducts(catalog(), { q: q('[data-pl-search]').value, cat: q('[data-pl-cat]').value });
    items.forEach(function (p) {
      var l = el('label', 'pl-item'), c = doc.createElement('input'); c.type = 'checkbox'; c.setAttribute('data-pl-pick', String(p.id));
      c.checked = selected.has(String(p.id));
      l.appendChild(c);
      l.appendChild(el('span', 'pl-name', text(p.name).trim() + (p.activo === false ? ' (descontinuado)' : '')));
      l.appendChild(el('span', 'pl-price', money(p.precio)));
      list.appendChild(l);
    });
    if (!items.length) list.appendChild(el('p', 'pl-empty', 'No hay productos con este filtro.'));
    q('[data-pl-count]').textContent = selected.size === 1 ? '1 seleccionado' : selected.size + ' seleccionados';
    clearPreview();
  }
  function clearPreview() { preview = []; q('[data-pl-preview]').textContent = ''; q('[data-pl-confirm]').disabled = true; }
  function renderPreview() {
    var o = options(), box = q('[data-pl-preview]'); box.textContent = '';
    if (!selected.size) { box.appendChild(el('p', 'pl-msg', 'Selecciona al menos un producto.')); return; }
    preview = buildPreview(catalog(), Array.from(selected), o);
    if (!preview.length) { box.appendChild(el('p', 'pl-msg', 'Ningún producto cambia con estas opciones.')); q('[data-pl-confirm]').disabled = true; return; }
    var table = el('table', 'pl-table'), head = el('tr');
    ['Producto', 'Precio de venta', 'Categoría actual', 'Categoría nueva', 'Estado nuevo'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    var thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
    var body = el('tbody');
    preview.forEach(function (r) {
      var tr = el('tr'); tr.setAttribute('data-pl-row', String(r.id));
      tr.appendChild(el('td', null, r.name)); tr.appendChild(el('td', null, money(r.price)));
      tr.appendChild(el('td', null, r.cat ? catLabel(r.cat) : 'Sin categoría'));
      tr.appendChild(el('td', null, r.changes.cat ? catLabel(r.changes.cat) : 'Sin cambio'));
      tr.appendChild(el('td', null, r.changes.activo ? (r.changes.activo === 'true' ? 'ACTIVO' : 'DESCONTINUADO') : 'Sin cambio'));
      body.appendChild(tr);
    });
    table.appendChild(body); box.appendChild(table);
    box.appendChild(el('p', 'pl-msg', preview.length + ' producto(s) se cambiarán. El precio, el costo y el stock no se tocan.'));
    q('[data-pl-confirm]').disabled = false;
  }
  async function askOwnerPin(n) {
    var roles = root.NA_ROLES, detail = 'Se cambiarán ' + n + ' producto(s). Escribe tu PIN una sola vez para todo el lote.';
    if (!roles || typeof roles.askPin !== 'function') return false;
    if (cloud()) {
      if (roles.role !== 'owner' || !roles.confirmed) { notify('Solo el aparato del dueño puede hacer esto.', 'error'); return false; }
      var opId = 'edicion-masiva-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      return !!(await roles.approve('product.update', opId, 'Edición masiva de productos', detail));
    }
    var hasPin = false; try { hasPin = !!(_naSecurity.pinEnabled && _naSecurity.pinHash); } catch (_) {} // eslint-disable-line no-undef
    if (!hasPin) { notify('Configura primero el PIN maestro para usar la edición masiva.', 'error'); return false; }
    return !!(await roles.askPin('Edición masiva de productos', detail, function (pin) {
      var valid = false; try { valid = !!_naPinValid(pin); } catch (_) {} // eslint-disable-line no-undef
      return valid ? { ok: true, value: true } : { msg: 'PIN incorrecto.' };
    }));
  }
  function setField(id, value) { var f = doc.getElementById(id); if (!f) return false; f.value = value; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); return f.value === String(value); }
  function prodOpen() { var m = doc.getElementById('mProd'); return !!(m && m.classList.contains('open')); }
  // Guarda un producto por el camino de «Editar producto». true si el formulario se cerró (guardado).
  async function saveOne(row) {
    if (typeof root.editProd !== 'function' || typeof root.guardarProd !== 'function') return false;
    var p = catalog().find(function (x) { return String(x.id) === String(row.id); });
    if (!p) return false;
    root.editProd(p.id);
    if (!prodOpen()) return false;
    var ok = true;
    if (row.changes.cat) ok = setField('pCat', row.changes.cat) && ok;
    if (row.changes.activo) ok = setField('pActivo', row.changes.activo) && ok;
    if (!ok) { try { cerrarModal('mProd'); } catch (_) {} return false; } // eslint-disable-line no-undef
    await root.guardarProd();
    if (prodOpen()) { try { cerrarModal('mProd'); } catch (_) {} return false; } // eslint-disable-line no-undef
    return true;
  }
  async function confirm() {
    if (running || !isOwner() || !unlocked()) return;
    var rows = preview.slice();
    if (!rows.length) return;
    if (prodOpen()) { notify('Cierra primero el formulario de producto abierto.', 'error'); return; }
    running = true; q('[data-pl-confirm]').disabled = true;
    try {
      if (!(await askOwnerPin(rows.length))) { q('[data-pl-confirm]').disabled = false; return; }
      dlg.hidden = true;
      var done = 0, failed = null;
      for (var i = 0; i < rows.length; i++) {
        if (!(await saveOne(rows[i]))) { failed = rows[i]; break; }
        done++;
      }
      dlg.hidden = false;
      selected.clear(); renderList();
      var box = q('[data-pl-preview]');
      box.appendChild(el('p', failed ? 'pl-msg pl-bad' : 'pl-msg pl-good', failed
        ? 'Se guardaron ' + done + ' de ' + rows.length + '. Se detuvo en «' + failed.name + '»: revisa el aviso y vuelve a intentarlo con los que faltan.'
        : 'Listo: se guardaron ' + done + ' producto(s).'));
      notify(failed ? 'Edición masiva incompleta: ' + done + ' de ' + rows.length : 'Edición masiva: ' + done + ' producto(s) actualizados', failed ? 'error' : 'success');
    } finally { running = false; }
  }
  function build() {
    dlg = el('div', 'pl-overlay'); dlg.id = 'naEdicionMasiva'; dlg.hidden = true;
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'naEdicionMasivaTitle');
    var box = el('div', 'pl-box'), bar = el('div', 'pl-toolbar');
    var title = el('strong', 'pl-title', 'Edición masiva de productos'); title.id = 'naEdicionMasivaTitle';
    var cl = el('button', 'pl-btn', 'Cerrar'); cl.type = 'button'; cl.setAttribute('data-pl-close', '');
    bar.append(title, cl);
    function field(label, node) { var l = el('label', 'pl-field', label + ' '); l.appendChild(node); return l; }
    var s1 = el('section', 'pl-step'); s1.appendChild(el('h3', null, '1. Elige los productos'));
    var filters = el('div', 'pl-row');
    var search = doc.createElement('input'); search.type = 'search'; search.placeholder = 'Buscar por nombre o código'; search.setAttribute('data-pl-search', '');
    var cat = doc.createElement('select'); cat.setAttribute('data-pl-cat', '');
    var all = el('button', 'pl-btn', 'Marcar los visibles'); all.type = 'button'; all.setAttribute('data-pl-all', '');
    var none = el('button', 'pl-btn', 'Quitar todos'); none.type = 'button'; none.setAttribute('data-pl-none', '');
    var count = el('span', 'pl-count'); count.setAttribute('data-pl-count', ''); count.setAttribute('aria-live', 'polite');
    filters.append(field('Buscar', search), field('Categoría', cat), all, none, count);
    var list = el('div', 'pl-list'); list.setAttribute('data-pl-list', '');
    s1.append(filters, list);
    var s2 = el('section', 'pl-step'); s2.appendChild(el('h3', null, '2. Qué cambiar'));
    var row2 = el('div', 'pl-row');
    var newcat = doc.createElement('select'); newcat.setAttribute('data-pl-newcat', '');
    var activo = doc.createElement('select'); activo.setAttribute('data-pl-activo', '');
    [['', 'No cambiar el estado'], ['true', 'ACTIVO'], ['false', 'DESCONTINUADO']].forEach(function (x) { opt(activo, x[0], x[1]); });
    var activoField = field('Estado', activo); activoField.setAttribute('data-pl-activo-field', '');
    row2.append(field('Categoría nueva', newcat), activoField);
    var actions = el('div', 'pl-row');
    var pv = el('button', 'pl-btn', 'Ver vista previa'); pv.type = 'button'; pv.setAttribute('data-pl-preview-btn', '');
    var cf = el('button', 'pl-btn primary', 'Confirmar con PIN'); cf.type = 'button'; cf.disabled = true; cf.setAttribute('data-pl-confirm', '');
    actions.append(pv, cf);
    s2.append(row2, actions);
    var pr = el('section', 'pl-step'); pr.setAttribute('data-pl-preview', ''); pr.setAttribute('aria-live', 'polite');
    box.append(bar, s1, s2, pr); dlg.appendChild(box); doc.body.appendChild(dlg);
    dlg.addEventListener('input', function (e) { if (e.target.matches('[data-pl-search]')) renderList(); else if (!e.target.matches('[data-pl-pick]')) clearPreview(); });
    dlg.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-pl-pick]')) { if (t.checked) selected.add(t.getAttribute('data-pl-pick')); else selected.delete(t.getAttribute('data-pl-pick')); q('[data-pl-count]').textContent = selected.size === 1 ? '1 seleccionado' : selected.size + ' seleccionados'; clearPreview(); }
      else if (t.matches('[data-pl-cat]')) renderList();
      else clearPreview();
    });
    dlg.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-pl-close]')) close();
      else if (t.closest('[data-pl-all]')) { dlg.querySelectorAll('[data-pl-pick]').forEach(function (c) { selected.add(c.getAttribute('data-pl-pick')); }); renderList(); }
      else if (t.closest('[data-pl-none]')) { selected.clear(); renderList(); }
      else if (t.closest('[data-pl-preview-btn]')) renderPreview();
      else if (t.closest('[data-pl-confirm]')) confirm();
    });
  }
  function open() {
    if (!isOwner() || !unlocked()) return false;
    if (!dlg) build();
    var cats = categories(), cat = q('[data-pl-cat]'), newcat = q('[data-pl-newcat]'), prev = cat.value || ALL;
    cat.textContent = ''; opt(cat, ALL, 'Todas');
    newcat.textContent = ''; opt(newcat, '', 'No cambiar la categoría');
    cats.forEach(function (c) { opt(cat, c.value, c.label); opt(newcat, c.value, c.label); });
    cat.value = Array.prototype.some.call(cat.options, function (o) { return o.value === prev; }) ? prev : ALL;
    // product.update en CANON no lleva «activo»: el estado solo se cambia en modo local.
    q('[data-pl-activo-field]').hidden = cloud(); q('[data-pl-activo]').value = '';
    dlg.hidden = false; doc.body.classList.add('pl-open'); renderList();
    q('[data-pl-search]').focus();
    return true;
  }
  function close() {
    if (!dlg || running) return;
    dlg.hidden = true; doc.body.classList.remove('pl-open');
    var b = doc.querySelector('#pageInventario .inv-secondary > summary'); if (b) b.focus();
  }
  function mountButton() {
    var host = doc.querySelector('#pageInventario .inv-secondary-menu'); if (!host) return;
    var btn = doc.getElementById('invEdicionMasivaBtn');
    if (!isOwner() || !unlocked()) { if (btn) btn.remove(); if (dlg && !dlg.hidden) close(); return; }
    if (!btn) { btn = el('button', 'top-btn-nuevo', 'Edición masiva de productos'); btn.id = 'invEdicionMasivaBtn'; btn.type = 'button'; btn.title = 'Cambiar la categoría o el estado de varios productos'; btn.addEventListener('click', open); }
    if (btn.parentNode !== host) host.appendChild(btn);
  }
  function start() {
    mountButton();
    var p = doc.getElementById('pageInventario');
    if (p && root.MutationObserver) new root.MutationObserver(function () { if (p.classList.contains('active')) mountButton(); }).observe(p, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', mountButton);
  }
  root.NA_EDICION_MASIVA_PRODUCTOS = { filterProducts: filterProducts, buildPreview: buildPreview, money: money, open: open, close: close };
  if (!doc) return;
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg && !dlg.hidden && !doc.querySelector('.na-pin-overlay')) { e.stopPropagation(); close(); } }, true);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
