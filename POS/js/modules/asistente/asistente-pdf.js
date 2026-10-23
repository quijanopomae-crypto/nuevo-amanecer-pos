/* Asistente (solo Admin): «Subir archivo» en PDF. Se carga SOLO cuando el Admin elige un PDF (carga diferida).
   - El PDF se abre EN EL APARATO con el pdf.js que ya trae el POS (js/ocr/vendor/pdfjs-6.4.299, el mismo del lector de facturas):
     sin scripts del PDF, sin XFA, sin eval. El PDF nunca sale del aparato: sale solo la imagen de sus páginas, igual que una foto.
   - Se dibujan las primeras 3 páginas (máx.), se recortan los márgenes en blanco y se apilan en UNA imagen, que sigue el camino de
     siempre (foto del chat o «Leer boleta con IA»: revisión primero, nada toca el stock hasta «Registrar compra»).
   - PDF con contraseña, dañado o de más de 15 MB: aviso claro, no se manda nada. */
(function (root) {
  'use strict';
  var MAX_PAGES = 3, PAGE_W = 1400, MAX_SCALE = 3, MAX_FILE_BYTES = 15 * 1024 * 1024, GAP = 24, INK = 240;
  var BASE = 'js/ocr/vendor/pdfjs-6.4.299/';
  // Qué es el archivo: 'image' | 'pdf' | 'doc' (Word, Excel y similares: aún no) | 'other'
  function kind(f) {
    var n = String(f && f.name || '').toLowerCase(), t = String(f && f.type || '').toLowerCase();
    if (t === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
    if (/^image\//.test(t) || /\.(?:jpe?g|png|webp|gif|bmp|heic|heif)$/.test(n)) return 'image';
    if (/\.(?:docx?|xlsx?|xlsm|csv|odt|ods|rtf|txt|pptx?)$/.test(n) || /msword|ms-excel|officedocument|opendocument|text\/(?:plain|csv)|rtf/.test(t)) return 'doc';
    return 'other';
  }
  function err(code) { var e = new Error(code); e.code = code; return e; }
  // Caja con tinta (no blanca) de una página dibujada: { x, y, w, h } o null si está en blanco. Se mira 1 de cada 2 píxeles.
  function inkBox(data, w, h) {
    var top = -1, bot = -1, left = w, right = -1;
    for (var y = 0; y < h; y += 2) { var row = y * w * 4, hit = false;
      for (var x = 0; x < w; x += 2) { var i = row + x * 4;
        if (data[i] < INK || data[i + 1] < INK || data[i + 2] < INK) { hit = true; if (x < left) left = x; if (x > right) right = x; } }
      if (hit) { if (top < 0) top = y; bot = y; } }
    if (top < 0) return null;
    var pad = 16, x0 = Math.max(0, left - pad), y0 = Math.max(0, top - pad);
    return { x: x0, y: y0, w: Math.min(w, right + 2 + pad) - x0, h: Math.min(h, bot + 2 + pad) - y0 };
  }
  // Dónde va cada página en la imagen final (ancho común = el mayor; separadas por GAP).
  function stack(boxes) {
    var w = 0, y = 0, at = [];
    boxes.forEach(function (b) { if (b.w > w) w = b.w; });
    boxes.forEach(function (b, i) { if (i) y += GAP; at.push({ x: Math.round((w - b.w) / 2), y: y }); y += b.h; });
    return { w: Math.max(1, w), h: Math.max(1, y), at: at };
  }
  var libP = null;
  function lib() {
    if (!libP) libP = import(new URL(BASE + 'pdf.min.mjs', root.document.baseURI).href).then(function (L) {
      L.GlobalWorkerOptions.workerSrc = new URL(BASE + 'pdf.worker.min.mjs', root.document.baseURI).href; return L;
    }, function (e) { libP = null; throw e; });
    return libP;
  }
  // PDF -> { blob (JPEG), pages (leídas), total (del PDF) }
  async function toImage(file, opts) {
    opts = opts || {}; var doc = opts.doc || root.document, max = opts.maxPages || MAX_PAGES;
    if (!file || kind(file) !== 'pdf') throw err('pdf_bad');
    if (file.size > MAX_FILE_BYTES) throw err('pdf_too_large');
    var bytes = new Uint8Array(await file.arrayBuffer());
    if (String.fromCharCode.apply(null, bytes.subarray(0, 5)) !== '%PDF-') throw err('pdf_bad');
    var L = opts.lib || await lib(), task = L.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useWasm: false, standardFontDataUrl: new URL(BASE + 'standard_fonts/', root.document.baseURI).href }), pdf = null;
    try {
      try { pdf = await task.promise; } catch (e) { throw err(e && e.name === 'PasswordException' ? 'pdf_password' : 'pdf_bad'); }
      var n = Math.min(pdf.numPages, max), parts = [];
      for (var p = 1; p <= n; p++) {
        var page = await pdf.getPage(p), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(MAX_SCALE, PAGE_W / base.width) });
        var cv = doc.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        var cx = cv.getContext('2d', { willReadFrequently: true }); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: cx, viewport: vp }).promise; page.cleanup();
        var box = inkBox(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if (box) parts.push({ cv: cv, box: box }); else cv.width = cv.height = 0;
      }
      if (!parts.length) throw err('pdf_blank');
      var s = stack(parts.map(function (x) { return x.box; })), out = doc.createElement('canvas'); out.width = s.w; out.height = s.h;
      var o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, s.w, s.h);
      parts.forEach(function (x, i) { var b = x.box; o.drawImage(x.cv, b.x, b.y, b.w, b.h, s.at[i].x, s.at[i].y, b.w, b.h); x.cv.width = x.cv.height = 0; });
      var blob = await new Promise(function (ok) { out.toBlob(ok, 'image/jpeg', 0.9); }); out.width = out.height = 0;
      if (!blob) throw err('pdf_bad');
      return { blob: blob, pages: n, total: pdf.numPages };
    } finally { try { if (pdf) pdf.destroy(); else task.destroy(); } catch (_) {} }
  }
  function message(code) {
    return code === 'pdf_password' ? 'El PDF tiene contraseña. Suba una copia sin contraseña.'
      : code === 'pdf_too_large' ? 'El PDF es muy grande (máx. 15 MB). Pruebe con uno más chico o con una foto.'
      : code === 'pdf_blank' ? 'Las páginas del PDF están en blanco.' : 'No pude abrir ese PDF.';
  }
  var api = { kind: kind, inkBox: inkBox, stack: stack, toImage: toImage, message: message, LIMITS: { MAX_PAGES: MAX_PAGES, PAGE_W: PAGE_W, MAX_FILE_BYTES: MAX_FILE_BYTES } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NA_ASISTENTE_PDF = api;
})(typeof window !== 'undefined' ? window : globalThis);
