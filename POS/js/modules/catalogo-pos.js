/* Generar catálogo desde el POS (#172, id catalogo-desde-pos). Solo lectura:
 * lee el catálogo en memoria y arma una hoja A4 para imprimir o guardar como PDF.
 * Nunca muestra costos, márgenes ni valor de stock. DOM armado solo con textContent. */
(function (root) {
  'use strict';
  var doc = root.document;
  var ALL = 'todas';
  function text(v) { return v == null ? '' : String(v); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  // Reutiliza el formato de dinero del POS (_naPosDisplayMoney: toFixed(2) + coma de miles).
  function money(v) {
    try { if (typeof _naPosDisplayMoney === 'function') return _naPosDisplayMoney(v); } catch (_) {} // eslint-disable-line no-undef
    return 'S/ ' + num(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function catKey(p) { return text(p && p.cat).trim().toLowerCase() || 'sin categoría'; }
  function catLabel(key) {
    try { if (typeof _naCategoryLabel === 'function') { var l = _naCategoryLabel(key); if (l) return text(l); } } catch (_) {} // eslint-disable-line no-undef
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  function tracksStock(p) { return p && p.controlInventario !== false; }
  function hasStock(p) { return !tracksStock(p) || num(p.stock) > 0; }
  function isActive(p) { return !!p && p.activo !== false && !p.ventaLibre && text(p.name).trim() !== ''; }
  function safeImage(src) { var s = text(src); return /^(data:image\/|blob:|https?:\/\/|\.{0,2}\/|[\w-]+\/)/i.test(s) && !/^javascript:/i.test(s) ? s : ''; }
  // Solo campos públicos: nombre, categoría, precio, precio mayorista y foto. Nada de costo.
  function buildCatalog(products, opts) {
    var o = opts || {}, cat = o.cat || ALL, groups = {}, order = [];
    (Array.isArray(products) ? products : []).forEach(function (p) {
      if (!isActive(p)) return;
      if (o.soloStock && !hasStock(p)) return;
      var k = catKey(p); if (cat !== ALL && k !== cat) return;
      var item = { id: text(p.id), name: text(p.name).replace(/\s+/g, ' ').trim(), price: num(p.precio) > 0 ? money(p.precio) : 'Consultar', image: safeImage(p.imagen) };
      if (o.mayorista && num(p.precioCaja) > 0 && num(p.unidCaja) > 1) item.wholesale = 'Caja x' + num(p.unidCaja) + ' · ' + money(p.precioCaja);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(item);
    });
    order.sort(function (a, b) { return catLabel(a).localeCompare(catLabel(b), 'es'); });
    return order.map(function (k) {
      return { key: k, label: catLabel(k), items: groups[k].sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); }) };
    });
  }
  function categories(products) {
    var seen = {}, out = [];
    (Array.isArray(products) ? products : []).forEach(function (p) { if (!isActive(p)) return; var k = catKey(p); if (!seen[k]) { seen[k] = 1; out.push(k); } });
    return out.sort(function (a, b) { return catLabel(a).localeCompare(catLabel(b), 'es'); });
  }
  function isOwner() { try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; } }
  // Candado propio: si está cerrado, no existe o la consulta falla, no se muestra nada (falla cerrado).
  function unlocked() { try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked('catalogo-desde-pos') === false); } catch (_) { return false; } }
  function allowed() { return unlocked() && isOwner(); }
  function catalog() { try { return typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []; } catch (_) { return []; } } // eslint-disable-line no-undef
  function businessName() { try { return typeof _naGetBusiness === 'function' ? text((_naGetBusiness() || {}).nombre).trim() : ''; } catch (_) { return ''; } } // eslint-disable-line no-undef

  function el(tag, cls, txt) { var n = doc.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  var dlg = null, state = { cat: ALL, soloStock: false, mayorista: false };
  function renderSheet() {
    var sheet = dlg.querySelector('[data-cat-sheet]'); sheet.textContent = '';
    var groups = buildCatalog(catalog(), state), count = 0;
    var head = el('header', 'cat-sheet-head');
    head.appendChild(el('h2', null, businessName() || 'Catálogo de productos'));
    head.appendChild(el('p', null, 'Catálogo · ' + new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima' })));
    sheet.appendChild(head);
    groups.forEach(function (g) {
      var sec = el('section', 'cat-group'); sec.setAttribute('data-cat-group', g.key);
      sec.appendChild(el('h3', 'cat-group-title', g.label));
      var grid = el('div', 'cat-grid');
      g.items.forEach(function (it) {
        count++;
        var card = el('article', 'cat-card'); card.setAttribute('data-cat-item', it.id);
        var ph = el('div', 'cat-photo');
        if (it.image) { var img = doc.createElement('img'); img.src = it.image; img.alt = it.name; img.loading = 'eager'; ph.appendChild(img); } else ph.textContent = '📦';
        card.appendChild(ph);
        card.appendChild(el('div', 'cat-name', it.name));
        card.appendChild(el('div', 'cat-price', it.price));
        if (it.wholesale) card.appendChild(el('div', 'cat-wholesale', it.wholesale));
        grid.appendChild(card);
      });
      sec.appendChild(grid); sheet.appendChild(sec);
    });
    if (!count) sheet.appendChild(el('p', 'cat-empty', 'No hay productos para mostrar con estos filtros.'));
    dlg.querySelector('[data-cat-count]').textContent = count === 1 ? '1 producto' : count + ' productos';
    dlg.querySelector('[data-cat-print]').disabled = count === 0;
  }
  function build() {
    dlg = el('div', 'cat-overlay'); dlg.id = 'naCatalogoPos'; dlg.hidden = true;
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'naCatalogoTitle');
    var box = el('div', 'cat-box'), bar = el('div', 'cat-toolbar');
    var title = el('strong', 'cat-title', 'Generar catálogo'); title.id = 'naCatalogoTitle';
    var lc = el('label', 'cat-field', 'Categoría '), sel = doc.createElement('select'); sel.setAttribute('data-cat-filter', ''); lc.appendChild(sel);
    function check(attr, label) { var l = el('label', 'cat-check'), c = doc.createElement('input'); c.type = 'checkbox'; c.setAttribute(attr, ''); l.appendChild(c); l.appendChild(doc.createTextNode(' ' + label)); return l; }
    var count = el('span', 'cat-count'); count.setAttribute('data-cat-count', ''); count.setAttribute('aria-live', 'polite');
    var pr = el('button', 'cat-btn primary', 'Imprimir / PDF'); pr.type = 'button'; pr.setAttribute('data-cat-print', '');
    var cl = el('button', 'cat-btn', 'Cerrar'); cl.type = 'button'; cl.setAttribute('data-cat-close', '');
    bar.append(title, lc, check('data-cat-stock', 'Solo con stock'), check('data-cat-wholesale', 'Precio mayorista'), count, pr, cl);
    var sheet = el('div', 'cat-sheet'); sheet.setAttribute('data-cat-sheet', '');
    box.append(bar, sheet); dlg.appendChild(box); doc.body.appendChild(dlg);
    dlg.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-cat-filter]')) state.cat = t.value;
      if (t.matches('[data-cat-stock]')) state.soloStock = t.checked;
      if (t.matches('[data-cat-wholesale]')) state.mayorista = t.checked;
      renderSheet();
    });
    dlg.addEventListener('click', function (e) {
      if (e.target.closest('[data-cat-close]')) close();
      else if (e.target.closest('[data-cat-print]')) print();
    });
  }
  function open() {
    if (!allowed()) return;
    if (!dlg) build();
    var sel = dlg.querySelector('[data-cat-filter]'); sel.textContent = '';
    var all = el('option', null, 'Todas'); all.value = ALL; sel.appendChild(all);
    categories(catalog()).forEach(function (k) { var o = el('option', null, catLabel(k)); o.value = k; sel.appendChild(o); });
    if (!Array.prototype.some.call(sel.options, function (o) { return o.value === state.cat; })) state.cat = ALL;
    sel.value = state.cat;
    dlg.hidden = false; doc.body.classList.add('cat-open'); renderSheet();
    dlg.querySelector('[data-cat-close]').focus();
  }
  function close() { if (!dlg) return; endPrint(); dlg.hidden = true; doc.body.classList.remove('cat-open'); var b = doc.querySelector('#pageInventario .inv-secondary > summary') || doc.getElementById('invCatalogoBtn'); if (b) b.focus(); }
  function endPrint() { doc.body.classList.remove('cat-printing'); }
  function print() {
    doc.body.classList.add('cat-printing');
    root.addEventListener('afterprint', endPrint, { once: true });
    if (typeof root.print !== 'function') { endPrint(); return; }
    // Espera a que carguen las fotos (máximo 4 s) para que no salgan en blanco en el PDF.
    var btn = dlg && dlg.querySelector('[data-cat-print]'); if (btn) btn.disabled = true;
    var imgs = dlg ? Array.prototype.slice.call(dlg.querySelectorAll('[data-cat-sheet] img')) : [];
    var waits = imgs.filter(function (i) { return !i.complete; }).map(function (i) {
      return new Promise(function (res) { i.addEventListener('load', res, { once: true }); i.addEventListener('error', res, { once: true }); });
    });
    var timeout = new Promise(function (res) { root.setTimeout(res, 4000); });
    Promise.race([Promise.all(waits), timeout]).then(function () { if (btn) btn.disabled = false; root.print(); });
  }
  // Va en «Más opciones» de Inventario (igual que «Códigos duplicados»): no cambia el ancho de la cabecera.
  function mountButton() {
    var btn = doc.getElementById('invCatalogoBtn'); if (!allowed()) { if (btn) btn.remove(); return; }
    var host = doc.querySelector('#pageInventario .inv-secondary-menu') || doc.querySelector('#pageInventario .ocr-purchase-actions'); if (!host) return;
    if (!btn) { btn = el('button', 'top-btn-nuevo', 'Generar catálogo'); btn.id = 'invCatalogoBtn'; btn.type = 'button'; btn.title = 'Catálogo para imprimir o guardar como PDF'; btn.addEventListener('click', open); }
    if (btn.parentNode !== host) host.appendChild(btn);
  }
  function start() {
    mountButton();
    var p = doc.getElementById('pageInventario');
    if (p && root.MutationObserver) new root.MutationObserver(function () { if (p.classList.contains('active')) mountButton(); }).observe(p, { attributes: true, attributeFilter: ['class'] });
  }
  root.NA_CATALOGO_POS = { buildCatalog: buildCatalog, categories: categories, money: money, open: open, close: close };
  if (!doc) return;
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dlg && !dlg.hidden) { e.stopPropagation(); close(); } }, true);
  root.addEventListener('beforeprint', function () { if (!dlg || dlg.hidden) endPrint(); });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
