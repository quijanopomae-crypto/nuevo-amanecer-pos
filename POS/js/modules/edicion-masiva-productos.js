/* Edición masiva de productos (#62, id edicion-masiva-productos): categoría y estado ACTIVO/DESCONTINUADO.
 * Los precios en bloque son #61 (PR #901, precios-masivos.js); aquí no se tocan precios.
 * Solo el dueño. Cada producto se guarda por el MISMO camino que «Editar producto»:
 * editProd(id) → se cambian los campos del formulario → guardarProd() (local: saveAllData;
 * CANON: NuevoAmanecerCanonicalProductBridge → product.update). No hay escritura propia.
 * PIN: se pide UNA vez para el lote. En la nube se comprueba en el servidor con /auth/owner-approval
 * (acción product.update); en el aparato del dueño el Worker no pide aprobación por producto.
 * En modo local se comprueba con el PIN maestro. Nunca muestra costos. DOM solo con textContent.
 * CM-062: también marca y unidad de venta; excluir filas en la vista previa; id de operación idempotente
 * (reintento no repite los ya guardados); registro local (hora Lima) y «Deshacer último lote».
 * NO edita empaque ni factores (unidadCompra, factorCompra, unidCaja, precioCaja: CM-066), ni precio, costo o stock. */
(function (root) {
  'use strict';
  var doc = root.document;
  var ALL = 'todas';
  // Unidad de venta (mismas opciones que #pUnidad). Campos de empaque fuera de alcance (CM-066).
  var UNITS = ['unidad', 'paquete', 'caja', 'botella', 'lata', 'bolsa', 'kilogramo', 'gramo', 'litro', 'mililitro', 'docena', 'rollo', 'servicio', 'otro'];
  var FIELDS = ['cat', 'activo', 'marca', 'unidad'];
  // Mismas unidades decimales que CM-066 (_NA_DECIMAL_UNITS). Pasar a una unidad entera con stock decimal se bloquea.
  var DECIMAL_UNITS = ['kilogramo', 'kg', 'gramo', 'litro', 'mililitro'];
  function isDecimalUnit(u) { return DECIMAL_UNITS.indexOf(text(u).trim().toLowerCase()) >= 0; }
  // Regla única (cambio y deshacer): pasar a una unidad entera con stock actual no entero se bloquea,
  // sea cual sea la unidad actual (incluye UND antiguos con stock decimal). Nunca se redondea.
  function decimalBlock(p, newUnit) {
    if (!newUnit || isDecimalUnit(newUnit)) return null;
    var st = Number(p && p.stock); if (!Number.isFinite(st) || Number.isInteger(st)) return null;
    return 'Stock con decimales (' + text(p.stock) + '): no se puede pasar a ' + text(newUnit).toUpperCase() + '. Se omite.';
  }
  var LOG_KEY = 'na_edicion_masiva_productos_log_v1', LOG_MAX = 30;
  function readLog() { try { var l = JSON.parse(root.localStorage.getItem(LOG_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch (_) { return []; } }
  function writeLog(l) { try { root.localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(-LOG_MAX))); } catch (_) {} }
  function findOp(log, id) { for (var i = 0; i < log.length; i++) if (log[i] && log[i].opId === id) return log[i]; return null; }
  function pendingRows(rows, log, id) { var e = findOp(log || [], id), d = new Set(e ? e.done.map(String) : []); return (rows || []).filter(function (r) { return !d.has(String(r.id)); }); }
  function recordOp(id, kind, rows, undoOf) {
    var log = readLog(), e = findOp(log, id);
    if (!e) { e = { opId: id, at: new Date().toISOString(), kind: kind, done: [], rows: [] }; log.push(e); }
    rows.forEach(function (r) { if (e.done.indexOf(String(r.id)) < 0) { e.done.push(String(r.id)); e.rows.push({ id: String(r.id), name: r.name, changes: r.changes, prev: r.prev }); } });
    if (undoOf) { var o = findOp(log, undoOf); if (o) o.reverted = true; }
    writeLog(log); return e;
  }
  function limaTime(iso) { try { return new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); } catch (_) { return text(iso); } }
  function curVal(p, k) { return k === 'cat' ? catKey(p) : k === 'activo' ? (p.activo === false ? 'false' : 'true') : k === 'marca' ? text(p.marca || 'Sin marca') : text(p.unidad || 'unidad'); }
  // Deshacer: solo campos que siguen con el valor aplicado; los cambiados después se respetan.
  function undoPlan(log, products) {
    for (var i = (log || []).length - 1; i >= 0; i--) {
      var e = log[i]; if (!e || e.kind !== 'cambio' || e.reverted || !e.rows.length) continue;
      var rows = [], skipped = 0, blocked = [];
      e.rows.forEach(function (r) {
        var p = (products || []).find(function (x) { return String(x.id) === r.id; }); if (!p || !isEditable(p)) { skipped++; return; }
        var ch = {}; Object.keys(r.changes || {}).forEach(function (k) { var want = k === 'cat' ? text(r.changes[k]).toLowerCase() : text(r.changes[k]); if (FIELDS.indexOf(k) >= 0 && r.prev && curVal(p, k) === want) ch[k] = r.prev[k]; });
        var why = ch.unidad ? decimalBlock(p, ch.unidad) : null;
        if (why) { blocked.push({ id: r.id, name: r.name, reason: why }); return; }
        if (Object.keys(ch).length) rows.push({ id: r.id, name: r.name, changes: ch, prev: { cat: catKey(p), activo: curVal(p, 'activo'), marca: curVal(p, 'marca'), unidad: curVal(p, 'unidad') } }); else skipped++;
      });
      return { entry: e, rows: rows, skipped: skipped, blocked: blocked };
    }
    return null;
  }
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
      var marca = text(o.marca).trim().slice(0, 60);
      if (marca && text(p.marca || 'Sin marca') !== marca) row.changes.marca = marca;
      if (o.unidad && UNITS.indexOf(o.unidad) >= 0 && text(p.unidad || 'unidad') !== o.unidad) row.changes.unidad = o.unidad;
      var why = row.changes.unidad ? decimalBlock(p, row.changes.unidad) : null;
      if (why) row.blocked = why;
      row.prev = { cat: catKey(p), activo: p.activo === false ? 'false' : 'true', marca: text(p.marca || 'Sin marca'), unidad: text(p.unidad || 'unidad') };
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

  var dlg = null, selected = new Set(), preview = [], excluded = new Set(), opId = null, running = false;
  function chosen() { return preview.filter(function (r) { return !r.blocked && !excluded.has(String(r.id)); }); }
  function q(s) { return dlg.querySelector(s); }
  function options() {
    return { cat: q('[data-pl-newcat]').value, activo: cloud() ? '' : q('[data-pl-activo]').value, marca: q('[data-pl-marca]').value, unidad: q('[data-pl-unidad]').value };
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
  function clearPreview() { preview = []; excluded.clear(); opId = null; if (dlg) renderLog(); q('[data-pl-preview]').textContent = ''; q('[data-pl-confirm]').disabled = true; }
  function renderPreview() {
    var o = options(), box = q('[data-pl-preview]'); box.textContent = '';
    if (!selected.size) { box.appendChild(el('p', 'pl-msg', 'Selecciona al menos un producto.')); return; }
    preview = buildPreview(catalog(), Array.from(selected), o); excluded.clear();
    opId = 'edicion-masiva-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    if (!preview.length) { box.appendChild(el('p', 'pl-msg', 'Ningún producto cambia con estas opciones.')); q('[data-pl-confirm]').disabled = true; return; }
    var table = el('table', 'pl-table'), head = el('tr');
    ['Incluir', 'Producto', 'Precio de venta', 'Categoría actual', 'Categoría nueva', 'Estado nuevo', 'Marca nueva', 'Unidad nueva'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    var thead = el('thead'); thead.appendChild(head); table.appendChild(thead);
    var body = el('tbody');
    preview.forEach(function (r) {
      var tr = el('tr'); tr.setAttribute('data-pl-row', String(r.id));
      var inc = doc.createElement('input'); inc.type = 'checkbox'; inc.checked = !r.blocked; inc.disabled = !!r.blocked; inc.setAttribute('data-pl-include', String(r.id)); inc.setAttribute('aria-label', 'Incluir ' + r.name);
      var tdi = el('td', 'pl-inc'); tdi.appendChild(inc); tr.appendChild(tdi);
      var tdn = el('td', null, r.name); if (r.blocked) { tr.className = 'pl-blocked'; var why = el('span', 'pl-why', r.blocked); why.setAttribute('data-pl-blocked', ''); tdn.appendChild(why); } tr.appendChild(tdn); tr.appendChild(el('td', null, money(r.price)));
      tr.appendChild(el('td', null, r.cat ? catLabel(r.cat) : 'Sin categoría'));
      tr.appendChild(el('td', null, r.changes.cat ? catLabel(r.changes.cat) : 'Sin cambio'));
      tr.appendChild(el('td', null, r.changes.activo ? (r.changes.activo === 'true' ? 'ACTIVO' : 'DESCONTINUADO') : 'Sin cambio'));
      tr.appendChild(el('td', null, r.changes.marca ? r.changes.marca + ' (antes: ' + r.prev.marca + ')' : 'Sin cambio'));
      tr.appendChild(el('td', null, r.changes.unidad ? r.changes.unidad + ' (antes: ' + r.prev.unidad + ')' : 'Sin cambio'));
      body.appendChild(tr);
    });
    table.appendChild(body);
    var wrap = el('div', 'pl-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Vista previa de cambios'); wrap.appendChild(table); box.appendChild(wrap);
    var m = el('p', 'pl-msg'); m.setAttribute('data-pl-summary', ''); box.appendChild(m); summary();
    q('[data-pl-confirm]').disabled = false;
  }
  function summary() {
    var m = dlg.querySelector('[data-pl-summary]'), n = chosen().length, blk = preview.filter(function (r) { return r.blocked; }).length; if (!m) return;
    m.textContent = n + ' producto(s) se cambiarán' + (preview.length - n - blk ? ' (excluidos: ' + (preview.length - n - blk) + ')' : '') + (blk ? ' · omitidos por stock con decimales: ' + blk : '') + '. El precio, el costo, el stock y el empaque no se tocan.';
    q('[data-pl-confirm]').disabled = n === 0;
  }
  function renderLog() {
    var box = q('[data-pl-log]'), undo = q('[data-pl-undo]'); if (!box) return;
    var log = readLog(); box.textContent = '';
    if (log.length) {
      box.appendChild(el('h3', null, 'Últimos cambios en este aparato'));
      var ul = el('ul', 'pl-log');
      log.slice(-5).reverse().forEach(function (e) { ul.appendChild(el('li', null, limaTime(e.at) + ' · ' + (e.kind === 'deshacer' ? 'Deshacer lote' : 'Edición masiva') + ' · ' + e.done.length + ' producto(s)' + (e.reverted ? ' (deshecho)' : ''))); });
      box.appendChild(ul);
    }
    var u = undoPlan(log, catalog()); undo.hidden = !(u && u.rows.length);
    if (u && u.blocked.length) u.blocked.forEach(function (b) { var w = el('p', 'pl-msg pl-why', 'Deshacer omitirá ' + b.name + ': ' + b.reason); w.setAttribute('data-pl-undo-warn', b.id); box.appendChild(w); });
    undo.textContent = u && u.rows.length ? 'Deshacer último lote (' + u.rows.length + ')' : 'Deshacer último lote';
  }
  async function runRows(rows) {
    dlg.hidden = true;
    var done = [], failed = null;
    for (var i = 0; i < rows.length; i++) {
      if (!isOwner() || !unlocked() || !(await saveOne(rows[i]))) { failed = rows[i]; break; }
      done.push(rows[i]);
    }
    dlg.hidden = false;
    return { done: done, failed: failed };
  }
  async function undoLast() {
    if (running || !isOwner() || !unlocked()) return null;
    var u = undoPlan(readLog(), catalog()); if (!u || !u.rows.length) return null;
    if (prodOpen()) { notify('Cierra primero el formulario de producto abierto.', 'error'); return null; }
    var uid = 'deshacer-' + u.entry.opId, rows = pendingRows(u.rows, readLog(), uid);
    if (!rows.length) return null;
    running = true;
    try {
      if (!(await askOwnerPin(rows.length))) return null;
      var out = await runRows(rows);
      if (out.done.length) recordOp(uid, 'deshacer', out.done, out.failed ? null : u.entry.opId);
      selected.clear(); renderList();
      var box = q('[data-pl-preview]');
      box.appendChild(el('p', out.failed ? 'pl-msg pl-bad' : 'pl-msg pl-good', out.failed ? 'Se devolvieron ' + out.done.length + ' de ' + rows.length + '. Vuelve a intentarlo.' : 'Listo: se devolvieron ' + out.done.length + ' producto(s) a como estaban.' + (u.skipped ? ' ' + u.skipped + ' no se tocaron porque cambiaron después.' : '') + (u.blocked.length ? ' Omitidos por stock con decimales: ' + u.blocked.length + '.' : '')));
      u.blocked.forEach(function (b) { var w = el('p', 'pl-msg pl-why', b.name + ': ' + b.reason); w.setAttribute('data-pl-undo-blocked', b.id); box.appendChild(w); });
      return out;
    } finally { running = false; }
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
    if (row.changes.marca) ok = setField('pMarca', row.changes.marca) && ok;
    if (row.changes.unidad) ok = setField('pUnidad', row.changes.unidad) && ok;
    if (!ok) { try { cerrarModal('mProd'); } catch (_) {} return false; } // eslint-disable-line no-undef
    await root.guardarProd();
    if (prodOpen()) { try { cerrarModal('mProd'); } catch (_) {} return false; } // eslint-disable-line no-undef
    return true;
  }
  async function confirm() {
    if (running || !isOwner() || !unlocked()) return;
    var myOp = opId, rows = pendingRows(chosen(), readLog(), myOp);
    if (!rows.length) return null;
    if (prodOpen()) { notify('Cierra primero el formulario de producto abierto.', 'error'); return; }
    running = true; q('[data-pl-confirm]').disabled = true;
    try {
      if (!(await askOwnerPin(rows.length))) { q('[data-pl-confirm]').disabled = false; return; }
      var out = await runRows(rows), done = out.done.length, failed = out.failed;
      if (done) recordOp(myOp, 'cambio', out.done);
      if (!failed) { selected.clear(); renderList(); } else { preview = pendingRows(preview, readLog(), myOp); renderLog(); }
      var box = q('[data-pl-preview]');
      box.appendChild(el('p', failed ? 'pl-msg pl-bad' : 'pl-msg pl-good', failed
        ? 'Se guardaron ' + done + ' de ' + rows.length + '. Se detuvo en «' + failed.name + '»: revisa el aviso y vuelve a intentarlo con los que faltan.'
        : 'Listo: se guardaron ' + done + ' producto(s).'));
      notify(failed ? 'Edición masiva incompleta: ' + done + ' de ' + rows.length : 'Edición masiva: ' + done + ' producto(s) actualizados', failed ? 'error' : 'success');
      return out;
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
    var marca = doc.createElement('input'); marca.type = 'text'; marca.maxLength = 60; marca.placeholder = 'No cambiar la marca'; marca.setAttribute('data-pl-marca', '');
    var unidad = doc.createElement('select'); unidad.setAttribute('data-pl-unidad', ''); opt(unidad, '', 'No cambiar la unidad');
    UNITS.forEach(function (u) { opt(unidad, u, u.charAt(0).toUpperCase() + u.slice(1)); });
    row2.append(field('Categoría nueva', newcat), activoField, field('Marca nueva', marca), field('Unidad de venta nueva', unidad));
    var actions = el('div', 'pl-row');
    var pv = el('button', 'pl-btn', 'Ver vista previa'); pv.type = 'button'; pv.setAttribute('data-pl-preview-btn', '');
    var cf = el('button', 'pl-btn primary', 'Confirmar con PIN'); cf.type = 'button'; cf.disabled = true; cf.setAttribute('data-pl-confirm', '');
    actions.append(pv, cf);
    s2.append(row2, actions);
    var pr = el('section', 'pl-step'); pr.setAttribute('data-pl-preview', ''); pr.setAttribute('aria-live', 'polite');
    var s3 = el('section', 'pl-step');
    var ub = el('button', 'pl-btn', 'Deshacer último lote'); ub.type = 'button'; ub.hidden = true; ub.setAttribute('data-pl-undo', '');
    var lg = el('div', 'pl-logbox'); lg.setAttribute('data-pl-log', '');
    s3.append(ub, lg);
    box.append(bar, s1, s2, pr, s3); dlg.appendChild(box); doc.body.appendChild(dlg);
    dlg.addEventListener('input', function (e) { if (e.target.matches('[data-pl-search]')) renderList(); else if (!e.target.matches('[data-pl-pick],[data-pl-include]')) clearPreview(); });
    dlg.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-pl-include]')) { var iid = t.getAttribute('data-pl-include'); if (t.checked) excluded.delete(iid); else excluded.add(iid); summary(); }
      else if (t.matches('[data-pl-pick]')) { if (t.checked) selected.add(t.getAttribute('data-pl-pick')); else selected.delete(t.getAttribute('data-pl-pick')); q('[data-pl-count]').textContent = selected.size === 1 ? '1 seleccionado' : selected.size + ' seleccionados'; clearPreview(); }
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
      else if (t.closest('[data-pl-undo]')) undoLast();
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
    q('[data-pl-activo-field]').hidden = cloud(); q('[data-pl-activo]').value = ''; q('[data-pl-marca]').value = ''; q('[data-pl-unidad]').value = '';
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
  root.NA_EDICION_MASIVA_PRODUCTOS = { filterProducts: filterProducts, buildPreview: buildPreview, pendingRows: pendingRows, undoPlan: undoPlan, readLog: readLog, UNITS: UNITS, DECIMAL_UNITS: DECIMAL_UNITS, chosenOf: function (rows) { return (rows || []).filter(function (r) { return !r.blocked; }); }, undo: undoLast, confirm: function () { return confirm(); }, include: function (id, on) { if (on) excluded.delete(String(id)); else excluded.add(String(id)); if (dlg) summary(); }, money: money, open: open, close: close };
  if (!doc) return;
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg && !dlg.hidden && !doc.querySelector('.na-pin-overlay')) { e.stopPropagation(); close(); } }, true);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
