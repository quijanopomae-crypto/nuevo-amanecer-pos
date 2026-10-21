/* Etiquetas e impresión de precios (id etiquetas-precios). Solo lectura:
 * lee el catálogo cargado en memoria; no modifica productos, stock, ventas ni la nube.
 * Código de barras CODE128 (subconjunto B) propio, en SVG, sin librerías externas. */
(function (root) {
  'use strict';
  // Tabla de anchos CODE128 (barra/espacio alternados), valores 0..106. 106 = STOP.
  var PATTERNS = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
  var START_B = 104, STOP = 106;
  var FORMATS = {
    chica: { id: 'chica', label: 'Chica (38 × 25 mm)', width: 38, height: 25, sheet: false },
    mediana: { id: 'mediana', label: 'Mediana (50 × 30 mm)', width: 50, height: 30, sheet: false },
    a4: { id: 'a4', label: 'A4 · 24 por hoja (3 × 8)', width: 70, height: 37, sheet: true, perSheet: 24 }
  };
  var MAX_NAME = 32, MIN_QTY = 1, MAX_QTY = 100;

  function text(v) { return v == null ? '' : String(v); }
  function code128Values(data) {
    var s = text(data); if (!s) return null;
    var values = [START_B], sum = START_B;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i); if (c < 32 || c > 126) return null;
      var v = c - 32; values.push(v); sum += v * (i + 1);
    }
    values.push(sum % 103); values.push(STOP); return values;
  }
  function code128Pattern(data) {
    var values = code128Values(data); if (!values) return '';
    return values.map(function (v) { return PATTERNS[v]; }).join('');
  }
  function code128Svg(data, height) {
    var pattern = code128Pattern(data); if (!pattern) return '';
    var x = 10, h = height || 40, rects = '';
    for (var i = 0; i < pattern.length; i++) {
      var w = Number(pattern[i]);
      if (i % 2 === 0) rects += '<rect x="' + x + '" y="0" width="' + w + '" height="' + h + '"/>';
      x += w;
    }
    return '<svg class="etq-bars" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (x + 10) + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Código de barras ' + escapeHtml(data) + '">' + rects + '</svg>';
  }
  function escapeHtml(v) {
    return text(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatPrice(v) {
    var n = typeof v === 'number' ? v : Number(text(v).replace(',', '.'));
    if (!isFinite(n) || n < 0) n = 0;
    return 'S/ ' + (Math.round(n * 100) / 100).toFixed(2);
  }
  function truncateName(name, max) {
    var s = text(name).replace(/\s+/g, ' ').trim(), m = max || MAX_NAME;
    var chars = Array.from(s);
    return chars.length > m ? chars.slice(0, m - 1).join('').trimEnd() + '…' : s;
  }
  function clampQty(v) { var n = Math.floor(Number(v)); if (!isFinite(n)) n = MIN_QTY; return Math.min(MAX_QTY, Math.max(MIN_QTY, n)); }
  function productName(p) { return text(p && (p.name || p.nombre)) || 'Producto'; }
  function productCode(p) { return text(p && (p.barcode || p.codigo || p.sku)).trim(); }
  function productKey(p) { return text(p && p.id); }
  function formatDate(d) {
    var x = d instanceof Date ? d : new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(x.getDate()) + '/' + pad(x.getMonth() + 1) + '/' + x.getFullYear();
  }
  function labelHtml(product, date) {
    var code = productCode(product), svg = code ? code128Svg(code) : '';
    return '<div class="etq-label' + (svg ? '' : ' etq-no-bars') + '" data-etq-label>' +
      '<div class="etq-name">' + escapeHtml(truncateName(productName(product))) + '</div>' +
      '<div class="etq-price">' + escapeHtml(formatPrice(product && product.precio != null ? product.precio : product && product.price)) + '</div>' +
      svg +
      '<div class="etq-meta"><span class="etq-code">' + escapeHtml(code || 'Sin código') + '</span><span class="etq-date">' + escapeHtml(formatDate(date)) + '</span></div>' +
      '</div>';
  }
  function searchProducts(products, query) {
    var norm = function (v) { return text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); };
    var words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return (Array.isArray(products) ? products : []).filter(function (p) {
      if (!p || !productKey(p) || p.activo === false) return false;
      var hay = norm([productName(p), p.sku, p.barcode, p.codigo].join(' '));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  var api = { PATTERNS: PATTERNS, FORMATS: FORMATS, code128Values: code128Values, code128Pattern: code128Pattern, code128Svg: code128Svg, escapeHtml: escapeHtml, formatPrice: formatPrice, truncateName: truncateName, clampQty: clampQty, labelHtml: labelHtml, searchProducts: searchProducts, formatDate: formatDate };
  root.NA_ETIQUETAS_PRECIOS = api;

  var doc = root.document; if (!doc || !doc.getElementById) return;
  var selected = [], format = 'mediana', wired = false;
  function catalog() { try { return typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []; } catch (_) { return []; } } // eslint-disable-line no-undef
  function page() { return doc.getElementById('pageEtiquetasPrecios'); }
  function q(sel) { var p = page(); return p && p.querySelector(sel); }
  function renderMatches() {
    var box = q('[data-etq-matches]'), input = q('[data-etq-search]'); if (!box || !input) return;
    box.textContent = '';
    var found = searchProducts(catalog(), input.value);
    found.slice(0, 20).forEach(function (p) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'etq-match'; b.setAttribute('data-etq-add', productKey(p));
      b.textContent = productName(p) + (productCode(p) ? ' · ' + productCode(p) : '') + ' · ' + formatPrice(p.precio);
      box.appendChild(b);
    });
    if (input.value.trim() && !found.length) { var n = doc.createElement('p'); n.className = 'etq-note'; n.textContent = 'No se encontraron productos.'; box.appendChild(n); }
  }
  function renderSelected() {
    var list = q('[data-etq-selected]'); if (!list) return;
    list.textContent = '';
    selected.forEach(function (item) {
      var li = doc.createElement('li'); li.className = 'etq-item'; li.setAttribute('data-etq-item', productKey(item.product));
      var name = doc.createElement('span'); name.className = 'etq-item-name'; name.textContent = productName(item.product);
      var label = doc.createElement('label'); label.className = 'etq-qty'; label.textContent = 'Cantidad ';
      var qty = doc.createElement('input'); qty.type = 'number'; qty.min = String(MIN_QTY); qty.max = String(MAX_QTY); qty.value = String(item.qty); qty.setAttribute('data-etq-qty', productKey(item.product)); qty.setAttribute('aria-label', 'Cantidad de etiquetas de ' + productName(item.product));
      label.appendChild(qty);
      var rm = doc.createElement('button'); rm.type = 'button'; rm.className = 'etq-remove'; rm.textContent = 'Quitar'; rm.setAttribute('data-etq-remove', productKey(item.product));
      li.appendChild(name); li.appendChild(label); li.appendChild(rm); list.appendChild(li);
    });
    var empty = q('[data-etq-empty]'); if (empty) empty.hidden = selected.length > 0;
    renderPreview();
  }
  function renderPreview() {
    var sheet = q('[data-etq-sheet]'), count = q('[data-etq-count]'), print = q('[data-etq-print]'); if (!sheet) return;
    var now = new Date(), html = '', total = 0;
    selected.forEach(function (item) { for (var i = 0; i < item.qty; i++) { html += labelHtml(item.product, now); total++; } });
    sheet.className = 'etq-sheet etq-format-' + format;
    sheet.innerHTML = html;
    if (count) count.textContent = total === 1 ? '1 etiqueta' : total + ' etiquetas';
    if (print) print.disabled = total === 0;
  }
  function add(id) {
    if (selected.some(function (s) { return productKey(s.product) === id; })) return;
    var p = catalog().find(function (x) { return productKey(x) === id; }); if (!p) return;
    selected.push({ product: p, qty: 1 }); renderSelected();
  }
  function wire() {
    var p = page(); if (!p || wired) return; wired = true;
    var fmt = p.querySelector('[data-etq-format]');
    if (fmt) { fmt.value = format; fmt.addEventListener('change', function () { format = FORMATS[fmt.value] ? fmt.value : 'mediana'; renderPreview(); }); }
    p.addEventListener('input', function (e) {
      var t = e.target;
      if (t.matches('[data-etq-search]')) renderMatches();
      if (t.matches('[data-etq-qty]')) { var it = selected.find(function (s) { return productKey(s.product) === t.getAttribute('data-etq-qty'); }); if (it && t.value !== '') { it.qty = clampQty(t.value); renderPreview(); } }
    });
    p.addEventListener('change', function (e) { var t = e.target; if (t.matches('[data-etq-qty]')) { var it = selected.find(function (s) { return productKey(s.product) === t.getAttribute('data-etq-qty'); }); if (it) { it.qty = clampQty(t.value); t.value = String(it.qty); renderPreview(); } } });
    p.addEventListener('click', function (e) {
      var a = e.target.closest('[data-etq-add]'); if (a) { add(a.getAttribute('data-etq-add')); return; }
      var r = e.target.closest('[data-etq-remove]'); if (r) { selected = selected.filter(function (s) { return productKey(s.product) !== r.getAttribute('data-etq-remove'); }); renderSelected(); return; }
      if (e.target.closest('[data-etq-print]')) {
        doc.body.classList.add('etq-printing');
        var done = function () { doc.body.classList.remove('etq-printing'); root.removeEventListener('afterprint', done); };
        root.addEventListener('afterprint', done);
        if (typeof root.print === 'function') root.print();
      }
    });
    renderSelected();
  }
  function start() {
    var p = page(); if (!p) return; wire();
    if (root.MutationObserver) new root.MutationObserver(function () { if (p.classList.contains('active')) renderMatches(); }).observe(p, { attributes: true, attributeFilter: ['class'] });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
