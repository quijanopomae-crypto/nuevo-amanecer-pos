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
  var INVALID_NOTICE = 'sin barras: código con caracteres no válidos';
  var MAX_NAME = 32, MIN_QTY = 1, MAX_QTY = 100;
  // Tope total de etiquetas en la vista previa (y en la impresión): 10 hojas A4.
  var MAX_TOTAL = 240;
  var NO_PRICE = 'Sin precio';
  var NO_PRICE_NOTICE = 'Producto sin precio: la etiqueta saldrá como «Sin precio», no como S/ 0.00. Corrige el precio en Productos antes de imprimir.';
  // Tamaño de página para imprimir: A4 sin margen (3 × 8) y rollo con una etiqueta por página.
  var PAGE_SIZES = { chica: '38mm 25mm', mediana: '50mm 30mm', a4: 'A4' };

  function text(v) { return v == null ? '' : String(v); }
  var START_C = 105, CODE_B = 100, CODE_C = 99;
  function digitRun(s, i) { var n = 0; while (i + n < s.length && s.charCodeAt(i + n) >= 48 && s.charCodeAt(i + n) <= 57) n++; return n; }
  // Juego B para texto y juego C (pares de dígitos) para tramos numéricos:
  // empieza en C si el código abre con 4+ dígitos (o es solo dígitos, largo par);
  // desde B cambia a C con 4+ dígitos al final o 6+ en medio, dejando un dígito impar en B.
  function code128Values(data) {
    var s = text(data); if (!s) return null;
    for (var k = 0; k < s.length; k++) { var cc = s.charCodeAt(k); if (cc < 32 || cc > 126) return null; }
    var values = [], i = 0, set;
    var lead = digitRun(s, 0);
    if (lead >= 4 || (lead === s.length && lead >= 2 && lead % 2 === 0)) { set = 'C'; values.push(START_C); } else { set = 'B'; values.push(START_B); }
    while (i < s.length) {
      if (set === 'C') {
        if (digitRun(s, i) >= 2) { values.push(Number(s.substr(i, 2))); i += 2; continue; }
        values.push(CODE_B); set = 'B'; continue;
      }
      var run = digitRun(s, i);
      if (run >= 4 && (i + run === s.length ? true : run >= 6)) {
        if (run % 2) { values.push(s.charCodeAt(i) - 32); i++; }
        values.push(CODE_C); set = 'C'; continue;
      }
      values.push(s.charCodeAt(i) - 32); i++;
    }
    var sum = values[0];
    for (var j = 1; j < values.length; j++) sum += values[j] * j;
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
  // Precio guardado como número (lo normal) o como texto: «4.50», «4,50», «S/ 4.50», «1,234.50», «1.234,50».
  // Con punto y coma, el último es el decimal. Una sola coma es decimal («3,456» = 3.456, como antes);
  // varias comas en grupos de 3 («1,234,567») o varios puntos («1.234.567») son miles.
  // Producto que se agregó y luego se borró del catálogo: no se imprime con el precio viejo (sale «Sin precio» con aviso).
  var MISSING_NOTICE = 'Producto ya no está en el catálogo', MISSING_FLAG = '__etqMissing';
  function missingProduct(p) { var c = {}; Object.keys(p || {}).forEach(function (k) { c[k] = p[k]; }); c.precio = null; c.price = null; c[MISSING_FLAG] = true; return c; }
  function parsePrice(v) {
    if (typeof v === 'number') return v;
    // «S/», «S/.» (forma peruana común) y un «+» inicial: «S/.4.50», «S/. 4.50», «+5».
    var s = text(v).replace(/^\s*S\/\.?\s*/i, '').replace(/\s+/g, '').replace(/^\+(?=[\d.,])/, '');
    if (!/^-?[\d.,]+$/.test(s)) return NaN;
    var dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
    if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (comma >= 0) s = s.split(',').length === 2 ? s.replace(',', '.') : (/^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : 'x');
    else if ((s.match(/\./g) || []).length > 1) s = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : 'x';
    return Number(s);
  }
  function formatPrice(v) {
    var n = parsePrice(v);
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
  function rawPrice(p) { return p && p.precio != null && p.precio !== '' ? p.precio : p && p.price; }
  function hasPrice(p) {
    var v = rawPrice(p); if (v == null || v === '') return false;
    var n = parsePrice(v);
    return isFinite(n) && Math.round(n * 100) > 0;
  }
  // Nunca devuelve «S/ 0.00» para un producto sin precio válido: devuelve «Sin precio».
  function productPrice(p) { return hasPrice(p) ? formatPrice(rawPrice(p)) : NO_PRICE; }
  function pageCss(fmt) { var size = PAGE_SIZES[fmt] || PAGE_SIZES.mediana; return '@page { size: ' + size + '; margin: 0; }'; }
  // Reparte las etiquetas respetando el tope total; devuelve las páginas A4 de 24 en 24.
  function labelPlan(items) {
    var list = [], requested = 0;
    (Array.isArray(items) ? items : []).forEach(function (it) {
      var q = clampQty(it && it.qty); requested += q;
      for (var i = 0; i < q && list.length < MAX_TOTAL; i++) list.push(it.product);
    });
    return { labels: list, total: list.length, requested: requested, truncated: requested > list.length };
  }
  function chunk(arr, size) { var out = []; for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
  function productKey(p) { return text(p && p.id); }
  // Fecha en hora de Lima (America/Lima, UTC−5 sin horario de verano), sin depender del aparato.
  function formatDate(d) {
    var x = Object.prototype.toString.call(d) === '[object Date]' && isFinite(d.getTime()) ? d : new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(x);
      var get = function (t) { var f = parts.find(function (p) { return p.type === t; }); return f ? f.value : ''; };
      if (get('day') && get('month') && get('year')) return get('day') + '/' + get('month') + '/' + get('year');
    } catch (_) {}
    var l = new Date(x.getTime() - 5 * 3600000);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return pad(l.getUTCDate()) + '/' + pad(l.getUTCMonth() + 1) + '/' + l.getUTCFullYear();
  }
  function labelHtml(product, date) {
    var code = productCode(product), svg = code ? code128Svg(code) : '';
    var priced = hasPrice(product), gone = !!(product && product[MISSING_FLAG]);
    return '<div class="etq-label' + (svg ? '' : ' etq-no-bars') + (priced ? '' : ' etq-no-price') + '" data-etq-label>' +
      '<div class="etq-name">' + escapeHtml(truncateName(productName(product))) + '</div>' +
      '<div class="etq-price"' + (priced ? '' : ' data-etq-noprice') + '>' + escapeHtml(productPrice(product)) + '</div>' +
      (gone ? '<div class="etq-warn" data-etq-missing title="' + escapeHtml(MISSING_NOTICE) + '">' + escapeHtml(MISSING_NOTICE) + '</div>' : '') +
      svg + (code && !svg ? '<div class="etq-warn" data-etq-warn>' + escapeHtml(INVALID_NOTICE) + '</div>' : '') +
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

  function sheetHtml(labels, fmt, date) {
    if (fmt === 'a4') return chunk(labels, FORMATS.a4.perSheet).map(function (group) {
      return '<div class="etq-a4-page" data-etq-a4-page>' + group.map(function (p) { return labelHtml(p, date); }).join('') + '</div>';
    }).join('');
    return labels.map(function (p) { return labelHtml(p, date); }).join('');
  }

  var api = { MISSING_NOTICE: MISSING_NOTICE, missingProduct: missingProduct, MAX_TOTAL: MAX_TOTAL, NO_PRICE: NO_PRICE, NO_PRICE_NOTICE: NO_PRICE_NOTICE, PAGE_SIZES: PAGE_SIZES, hasPrice: hasPrice, parsePrice: parsePrice, pageCss: pageCss, labelPlan: labelPlan, sheetHtml: sheetHtml, PATTERNS: PATTERNS, FORMATS: FORMATS, code128Values: code128Values, code128Pattern: code128Pattern, code128Svg: code128Svg, escapeHtml: escapeHtml, formatPrice: formatPrice, productPrice: productPrice, INVALID_NOTICE: INVALID_NOTICE, truncateName: truncateName, clampQty: clampQty, labelHtml: labelHtml, searchProducts: searchProducts, formatDate: formatDate };
  root.NA_ETIQUETAS_PRECIOS = api;

  var doc = root.document; if (!doc || !doc.getElementById) return;
  var selected = [], format = 'mediana', wired = false;
  function catalog() { try { return typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []; } catch (_) { return []; } } // eslint-disable-line no-undef
  function page() { return doc.getElementById('pageEtiquetasPrecios'); }
  // Producto actual del catálogo por id (precio/nombre al día); si ya no está, el que se eligió, sin precio y con aviso.
  // Catálogo vacío (recarga o sincronización en curso): no se marca nada como borrado, se usa lo que se eligió.
  function current(item) { var cat = catalog(), id = productKey(item.product), p = cat.find(function (x) { return productKey(x) === id; }); return p || (cat.length ? missingProduct(item.product) : item.product); }
  function currentSelection() { return selected.map(function (item) { return { product: current(item), qty: item.qty }; }); }
  function q(sel) { var p = page(); return p && p.querySelector(sel); }
  function renderMatches() {
    var box = q('[data-etq-matches]'), input = q('[data-etq-search]'); if (!box || !input) return;
    box.textContent = '';
    var found = searchProducts(catalog(), input.value);
    found.slice(0, 20).forEach(function (p) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'etq-match'; b.setAttribute('data-etq-add', productKey(p));
      b.textContent = productName(p) + (productCode(p) ? ' · ' + productCode(p) : '') + ' · ' + productPrice(p);
      box.appendChild(b);
    });
    if (input.value.trim() && !found.length) { var n = doc.createElement('p'); n.className = 'etq-note'; n.textContent = 'No se encontraron productos.'; box.appendChild(n); }
  }
  function renderSelected() {
    var list = q('[data-etq-selected]'); if (!list) return;
    list.textContent = '';
    currentSelection().forEach(function (item) {
      var li = doc.createElement('li'); li.className = 'etq-item'; li.setAttribute('data-etq-item', productKey(item.product));
      var name = doc.createElement('span'); name.className = 'etq-item-name'; name.textContent = productName(item.product);
      var label = doc.createElement('label'); label.className = 'etq-qty'; label.textContent = 'Cantidad ';
      var qty = doc.createElement('input'); qty.type = 'number'; qty.min = String(MIN_QTY); qty.max = String(MAX_QTY); qty.value = String(item.qty); qty.setAttribute('data-etq-qty', productKey(item.product)); qty.setAttribute('aria-label', 'Cantidad de etiquetas de ' + productName(item.product));
      label.appendChild(qty);
      var rm = doc.createElement('button'); rm.type = 'button'; rm.className = 'etq-remove'; rm.textContent = 'Quitar'; rm.setAttribute('data-etq-remove', productKey(item.product));
      li.appendChild(name); li.appendChild(label); li.appendChild(rm);
      var gone = !!item.product[MISSING_FLAG];
      if (gone || !hasPrice(item.product)) { var w = doc.createElement('p'); w.className = 'etq-item-warn'; w.setAttribute(gone ? 'data-etq-missing-warn' : 'data-etq-noprice-warn', productKey(item.product)); w.setAttribute('role', 'alert'); w.textContent = gone ? MISSING_NOTICE + '. Sus etiquetas saldrán como «Sin precio».' : NO_PRICE_NOTICE; li.appendChild(w); }
      list.appendChild(li);
    });
    var empty = q('[data-etq-empty]'); if (empty) empty.hidden = selected.length > 0;
    renderPreview();
  }
  function renderPreview() {
    var sheet = q('[data-etq-sheet]'), count = q('[data-etq-count]'), print = q('[data-etq-print]'); if (!sheet) return;
    var plan = labelPlan(currentSelection()), total = plan.total;
    sheet.className = 'etq-sheet etq-format-' + format;
    // HTML armado solo con escapeHtml (labelHtml); ningún dato entra sin escapar.
    sheet.innerHTML = sheetHtml(plan.labels, format, new Date());
    if (count) count.textContent = (total === 1 ? '1 etiqueta' : total + ' etiquetas') + (plan.truncated ? ' (máximo)' : '');
    var cap = q('[data-etq-cap]');
    if (cap) { cap.hidden = !plan.truncated; cap.textContent = plan.truncated ? 'Pediste ' + plan.requested + ' etiquetas; la vista previa y la impresión llegan como máximo a ' + MAX_TOTAL + '. Imprime en tandas.' : ''; }
    if (print) print.disabled = total === 0;
  }
  function add(id) {
    if (selected.some(function (s) { return productKey(s.product) === id; })) return;
    var p = catalog().find(function (x) { return productKey(x) === id; }); if (!p) return;
    selected.push({ product: p, qty: 1 });
    var input = q('[data-etq-search]'), box = q('[data-etq-matches]');
    if (input) input.value = '';
    if (box) box.textContent = '';
    renderSelected();
    if (input && typeof input.focus === 'function') input.focus();
  }
  // Impresión: fuera de la hoja nada ocupa lugar en el diseño. Con visibility:hidden el resto de la app seguía midiendo
  // (p. ej. 279 px) y Chromium encogía la etiqueta de rollo al ~66 %. Se marca cada hermano de la hoja y de sus
  // ancestros (display:none al imprimir) y los ancestros quedan sin relleno, borde ni ancho propio.
  var endPrint = null, ownPrint = false;
  function isolate(sheet) {
    var marked = [], node = sheet;
    while (node && node !== doc.body && node.parentElement) {
      var parent = node.parentElement;
      Array.prototype.forEach.call(parent.children, function (sib) {
        if (sib !== node && !sib.hasAttribute('data-etq-print-hide')) { sib.setAttribute('data-etq-print-hide', ''); marked.push(sib); }
      });
      if (parent !== doc.body) { parent.setAttribute('data-etq-print-path', ''); marked.push(parent); }
      node = parent;
    }
    return function () { marked.forEach(function (el) { el.removeAttribute('data-etq-print-hide'); el.removeAttribute('data-etq-print-path'); }); };
  }
  function printSheet() {
    if (endPrint) endPrint();
    var sheet = q('[data-etq-sheet]'); if (!sheet) return;
    var restore = isolate(sheet);
    doc.documentElement.classList.add('etq-printing-root');
    doc.body.classList.add('etq-printing');
    var style = doc.createElement('style'); style.setAttribute('data-etq-page-style', format); style.textContent = pageCss(format); doc.head.appendChild(style);
    var done = function () {
      if (endPrint !== done) return; endPrint = null; ownPrint = false;
      restore();
      doc.documentElement.classList.remove('etq-printing-root');
      doc.body.classList.remove('etq-printing');
      if (style.parentNode) style.parentNode.removeChild(style);
      root.removeEventListener('afterprint', done);
    };
    // Solo «afterprint» cierra la impresión. No se usa matchMedia('print'): su «change» puede llegar mientras Chromium
    // todavía arma las páginas y las dejaba en blanco. Si «afterprint» no llegara, la siguiente impresión limpia antes.
    endPrint = done;
    root.addEventListener('afterprint', done);
    // Marca que la impresión que viene es de Etiquetas: su «beforeprint» no debe limpiar la hoja.
    ownPrint = true;
    if (typeof root.print === 'function') root.print(); else done();
  }
  // Respaldo si «afterprint» nunca llega (algunos móviles): sin esto la clase y las marcas quedaban y un window.print()
  // posterior (ticket, reporte) salía en blanco. Solo al salir de Etiquetas o al volver a la pestaña, nunca con el
  // medio «print» activo (impresión en curso).
  function cleanStalePrint() {
    if (!endPrint) return;
    try { if (typeof root.matchMedia === 'function' && root.matchMedia('print').matches) return; } catch (_) {}
    endPrint();
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
        // Con los precios actuales del catálogo.
        renderSelected();
        var sel = currentSelection(), gone = sel.filter(function (s) { return s.product[MISSING_FLAG]; }).length;
        var missing = sel.filter(function (s) { return !s.product[MISSING_FLAG] && !hasPrice(s.product); }).length, msg = [];
        if (gone) msg.push(gone + (gone === 1 ? ' producto ya no está' : ' productos ya no están') + ' en el catálogo.');
        if (missing) msg.push(missing + (missing === 1 ? ' producto no tiene' : ' productos no tienen') + ' precio.');
        if (msg.length && typeof root.confirm === 'function' && !root.confirm(msg.join(' ') + ' Sus etiquetas saldrán como «Sin precio». ¿Imprimir igual?')) return;
        printSheet();
      }
    });
    renderSelected();
  }
  function start() {
    var p = page(); if (!p) return; wire();
    // Al salir de Etiquetas también se olvida «ownPrint»: si print() nunca disparó «beforeprint» (algunos móviles), quedaba
    // en true y el siguiente Ctrl+P de otra pantalla se tomaba como propio y no limpiaba.
    if (root.MutationObserver) new root.MutationObserver(function () { if (p.classList.contains('active')) { renderMatches(); renderSelected(); } else { ownPrint = false; cleanStalePrint(); } }).observe(p, { attributes: true, attributeFilter: ['class'] });
  }
  // Último respaldo: si quedaron marcas (sin «afterprint» y la limpieza cayó durante la impresión) y otra pantalla
  // imprime (Ctrl+P en Venta, ticket, reporte), se limpian antes de que el navegador arme las páginas.
  // Solo es propia si Etiquetas sigue a la vista: con otra pantalla activa, un «ownPrint» viejo no evita la limpieza.
  root.addEventListener('beforeprint', function () {
    var p = page(), mine = ownPrint && !!p && p.classList.contains('active');
    ownPrint = false;
    if (!mine && endPrint) endPrint();
  });
  doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'visible') cleanStalePrint(); });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
