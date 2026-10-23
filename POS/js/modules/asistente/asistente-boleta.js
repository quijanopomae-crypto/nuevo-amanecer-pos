/* Asistente (PROTOTIPO AISLADO): «Leer boleta con IA», solo Admin. Se carga SOLO cuando el Admin la pide (carga diferida).
   - La foto se endereza (EXIF) y se achica EN EL APARATO (lado máx. 2000 px, máx. 4 MB) y va a POST /auth/assistant/boleta.
   - El modelo devuelve JSON y la «rotacion» que ve; si viene girada o sin nada legible, se gira aquí y se reintenta UNA vez sola.
   - Pantalla de REVISIÓN: todo editable, lo ilegible (null) resaltado, aviso si la suma de importes no da el total, aviso de foto
     borrosa o girada, botones para girar (90° izq./der., 180°) y volver a leer. NADA se guarda ni toca el stock: «Confirmar» solo
     PRELLENA la «Nueva compra» de siempre (el Admin pulsa «Registrar compra» ahí). Boleta ya confirmada en este aparato: pide
     «Sí, es otra compra» (igual que la protección de facturas repetidas del OCR).
   - Aprender de correcciones (NO es entrenar al modelo): lo que el Admin corrige (código, descripción, unidad) se guarda en ESTE
     aparato (localStorage na_asst_bol_learn, máx. 300) y se aplica solo en la próxima lectura (marcado «corregido por historial");
     las 20 más usadas van como pistas en el pedido. Se pueden ver y borrar. Sin datos de clientes.
   Solo createElement/textContent (nada de innerHTML con datos leídos). */
(function (root) {
  'use strict';
  var IMG_MAX_SIDE = 2000, IMG_MAX_BYTES = 4 * 1024 * 1024, CLIENT_TIMEOUT_MS = 95000, PROGRESS_MS = 90000;
  var LEARN_KEY = 'na_asst_bol_learn', LEARN_MAX = 300, HINTS_MAX = 20, SEEN_KEY = 'na_asst_boletas', SEEN_MAX = 200;
  var FIELDS = ['cant', 'um', 'cod', 'descripcion', 'precio_unit', 'importe'], LEARN_FIELDS = ['cod', 'descripcion', 'um'];
  var LABEL = { cant: 'Cant.', um: 'U.M.', cod: 'Código', descripcion: 'Descripción', precio_unit: 'P. unit.', importe: 'Importe' };

  // ---------- puras (probadas) ----------
  function parseAmount(v) {
    if (v == null || v === '') return null; if (typeof v === 'number') return isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
    var s = String(v).replace(/S\/\.?|PEN|soles?/gi, '').replace(/\s/g, ''); if (!/\d/.test(s)) return null;
    if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
    var n = Number(s); return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }
  function checks(b) {
    var cells = 3, nulls = [b.numero, b.fecha, b.total].filter(function (x) { return x == null || x === ''; }).length, sum = 0, any = false;
    (b.items || []).forEach(function (it) { FIELDS.forEach(function (f) { cells++; if (it[f] == null || it[f] === '') nulls++; }); var im = parseAmount(it.importe); if (im != null) { sum += im; any = true; } });
    sum = Math.round(sum * 100) / 100; var total = parseAmount(b.total);
    var mismatch = total != null && any ? Math.abs(sum - total) > Math.max(0.05, total * 0.005) : false, ratio = cells ? nulls / cells : 1;
    return { sum: sum, total: total, total_mismatch: mismatch, nulls: nulls, null_ratio: Math.round(ratio * 100) / 100, mostly_null: !(b.items || []).length || ratio >= 0.5, rotated: !!b.rotacion };
  }
  // Celdas con algo leído (cabecera + filas). 0 = la lectura no trae nada legible.
  function legibleCells(b) {
    var n = 0; if (!b) return 0; [b.numero, b.fecha, b.total].forEach(function (x) { if (x != null && x !== '') n++; });
    (b.items || []).forEach(function (it) { FIELDS.forEach(function (f) { if (it && it[f] != null && it[f] !== '') n++; }); }); return n;
  }
  // Orientación EXIF (1..8) de un JPEG (ArrayBuffer). 1 si no hay o no se entiende.
  function exifOrientation(buf) {
    try {
      var v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return 1; var off = 2, len = v.byteLength;
      while (off + 4 <= len) {
        var mk = v.getUint16(off); if ((mk & 0xFF00) !== 0xFF00) return 1; var sz = v.getUint16(off + 2);
        if (mk === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
          var t = off + 10, le = v.getUint16(t) === 0x4949, ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
          for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; if (v.getUint16(e, le) === 0x0112) { var o = v.getUint16(e + 8, le); return o >= 1 && o <= 8 ? o : 1; } }
          return 1;
        }
        if (mk === 0xFFDA) return 1; off += 2 + sz;
      }
    } catch (_) {}
    return 1;
  }
  function norm(deg) { deg = Math.round(Number(deg) / 90) * 90 % 360; return deg < 0 ? deg + 360 : deg; }
  // Girar w×h «deg» grados en el sentido del reloj: tamaño final y matriz para el canvas (a,b,c,d,e,f).
  function rotateSpec(deg, w, h) {
    deg = norm(deg);
    if (deg === 90) return { deg: 90, w: h, h: w, m: [0, 1, -1, 0, h, 0] };
    if (deg === 180) return { deg: 180, w: w, h: h, m: [-1, 0, 0, -1, w, h] };
    if (deg === 270) return { deg: 270, w: h, h: w, m: [0, -1, 1, 0, 0, w] };
    return { deg: 0, w: w, h: h, m: [1, 0, 0, 1, 0, 0] };
  }
  // EXIF que el navegador NO aplicó: matriz para dejar derecho un w×h guardado.
  function orientSpec(o, w, h) {
    switch (o) {
      case 2: return { w: w, h: h, m: [-1, 0, 0, 1, w, 0] };
      case 3: return { w: w, h: h, m: [-1, 0, 0, -1, w, h] };
      case 4: return { w: w, h: h, m: [1, 0, 0, -1, 0, h] };
      case 5: return { w: h, h: w, m: [0, 1, 1, 0, 0, 0] };
      case 6: return { w: h, h: w, m: [0, 1, -1, 0, h, 0] };
      case 7: return { w: h, h: w, m: [0, -1, -1, 0, h, w] };
      case 8: return { w: h, h: w, m: [0, -1, 1, 0, 0, w] };
      default: return { w: w, h: h, m: [1, 0, 0, 1, 0, 0] };
    }
  }
  function mul(a, b) { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; }
  // EXIF + giro pedido, en UNA matriz (primero EXIF, después el giro). -> { w, h, m } del dibujo final (sin escala).
  function compose(exif, deg, w, h) { var o = orientSpec(exif, w, h), r = rotateSpec(deg, o.w, o.h); return { w: r.w, h: r.h, m: mul(r.m, o.m), deg: r.deg }; }
  function fitScale(w, h, max) { return Math.min(1, (max || IMG_MAX_SIDE) / Math.max(1, w, h)); }
  function dataUrlBytes(u) { var s = String(u || ''), i = s.indexOf(','); if (i < 0) return 0; var b = s.length - i - 1; return Math.floor(b * 3 / 4) - (/==$/.test(s) ? 2 : /=$/.test(s) ? 1 : 0); }
  function seenKey(b) { var n = String(b && b.numero || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), t = parseAmount(b && b.total); return n && t != null ? n + '|' + t.toFixed(2) : null; }
  function low(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  // ---------- aprender de correcciones (en este aparato; no es entrenar al modelo) ----------
  function ls(k, v) { try { var s = root.localStorage; if (v === undefined) return s.getItem(k); if (v === null) s.removeItem(k); else s.setItem(k, v); } catch (_) { return null; } }
  function learnRead() { try { var o = JSON.parse(ls(LEARN_KEY) || 'null'); return o && o.v === 1 && Array.isArray(o.list) ? o.list : []; } catch (_) { return []; } }
  function learnWrite(list) { ls(LEARN_KEY, JSON.stringify({ v: 1, list: list.slice(-LEARN_MAX) })); }
  // Sin DNI/teléfonos/correos: además del filtro corto, el MISMO redactor del asistente (auditoría 2026-10-22); si tapa algo, no se aprende.
  var SAFE = function (s) { s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!s || /\d{8,}|@|\d(?:[ .-]?\d){7,}|\(\s*at\s*\)|\barroba\b/i.test(s)) return '';
    var C = root.NA_ASISTENTE_CORE; return C && C.redactText && C.redactText(s) !== s ? '' : s; };
  // Pares (leído -> corregido) de los campos que se aprenden. item._orig = lo que leyó el modelo (antes del historial).
  function correctionsOf(items) {
    var out = [];
    (items || []).forEach(function (it) { var o = it && it._orig; if (!o) return;
      LEARN_FIELDS.forEach(function (f) { var de = SAFE(o[f]), a = SAFE(it[f]); if (de && a && low(de) !== low(a)) out.push({ campo: f, de: de, a: a }); }); });
    return out;
  }
  function countEdits(items) { var n = 0; (items || []).forEach(function (it) { var o = it && it._orig || {}; FIELDS.forEach(function (f) { if (String(o[f] == null ? '' : o[f]) !== String(it[f] == null ? '' : it[f])) n++; }); }); return n; }
  function learnAdd(pairs, now) {
    if (!pairs || !pairs.length) return learnRead().length; var list = learnRead(), t = now || Date.now();
    pairs.forEach(function (p) { var i = list.findIndex(function (x) { return x.campo === p.campo && low(x.de) === low(p.de); });
      if (i >= 0) { var x = list.splice(i, 1)[0]; x.a = p.a; x.n = (x.n || 1) + 1; x.t = t; list.push(x); } else list.push({ campo: p.campo, de: p.de, a: p.a, n: 1, t: t }); });
    if (list.length > LEARN_MAX) list.splice(0, list.length - LEARN_MAX);
    learnWrite(list); return list.length;
  }
  // Coincidencia EXACTA (sin tildes ni mayúsculas) -> se cambia y se marca «corregido por historial». Devuelve cuántos cambió.
  function learnApply(b) {
    var list = learnRead(), n = 0; if (!list.length) return 0;
    (b.items || []).forEach(function (it) { LEARN_FIELDS.forEach(function (f) { if (it[f] == null) return;
      var m = list.filter(function (x) { return x.campo === f && low(x.de) === low(it[f]); }).pop();
      if (m && it[f] !== m.a) { it[f] = m.a; it._applied = it._applied || {}; it._applied[f] = true; n++; } }); });
    return n;
  }
  function learnHints() { return learnRead().slice().sort(function (a, b) { return (b.n || 1) - (a.n || 1) || (b.t || 0) - (a.t || 0); }) // las guardadas antes de esta regla también pasan por SAFE al enviarse
    .map(function (x) { return { campo: x.campo, de: SAFE(x.de), a: SAFE(x.a) }; }).filter(function (x) { return x.de && x.a; }).slice(0, HINTS_MAX); }
  function learnClear() { ls(LEARN_KEY, null); }
  function showLearned(ctx) {
    var list = learnRead(), m = ctx.card('na-asst-bol-learned'), d = ctx.doc;
    var h = d.createElement('p'); h.textContent = list.length ? 'Correcciones guardadas en este aparato (' + list.length + '). Se usan en la próxima lectura de boletas; esto es aprender de sus correcciones, no entrenar al modelo.' : 'Todavía no hay correcciones guardadas. Cuando corrija una boleta antes de confirmar, lo corregido se guarda aquí (solo en este aparato).';
    m.appendChild(h);
    if (list.length) { var ul = d.createElement('ul'); list.slice().reverse().slice(0, 50).forEach(function (x) { var li = d.createElement('li'); li.textContent = LABEL[x.campo] + ': «' + x.de + '» → «' + x.a + '»' + (x.n > 1 ? ' (' + x.n + ' veces)' : ''); ul.appendChild(li); }); m.appendChild(ul);
      var b = d.createElement('button'); b.type = 'button'; b.className = 'na-asst-retry'; b.textContent = 'Borrar correcciones';
      b.onclick = function () { learnClear(); b.disabled = true; h.textContent = 'Correcciones borradas. Las próximas boletas se leen sin historial.'; if (ul.parentNode) ul.parentNode.removeChild(ul); }; m.appendChild(b); }
    return m;
  }

  // ---------- foto ----------
  function readBuf(file) { return file.arrayBuffer ? file.arrayBuffer() : new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = ko; r.readAsArrayBuffer(file); }); }
  function autoOriented() { try { return !!(root.CSS && root.CSS.supports && root.CSS.supports('image-orientation', 'from-image')); } catch (_) { return false; } }
  function decode(file) { // -> { src, w, h, exif }: w×h de lo que se dibuja; exif = giro/espejo que falta aplicar a mano
    return readBuf(file).then(function (buf) {
      var o = exifOrientation(buf);
      if (typeof root.createImageBitmap === 'function') {
        return root.createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bm) { return { src: bm, w: bm.width, h: bm.height, exif: 1 }; }, function () { return viaImg(file, o); });
      }
      return viaImg(file, o);
    });
  }
  function viaImg(file, o) {
    return new Promise(function (ok, ko) { var url = URL.createObjectURL(file), img = new root.Image(), auto = autoOriented();
      img.onload = function () { URL.revokeObjectURL(url); ok({ src: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, exif: auto ? 1 : o }); }; // w×h de la imagen tal como está guardada; orientSpec la gira
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('bad_image')); }; img.src = url; });
  }
  function render(dec, deg, doc, side) {
    side = side || IMG_MAX_SIDE;
    var c = compose(dec.exif, deg, dec.w, dec.h), s = fitScale(c.w, c.h, side), cv = doc.createElement('canvas');
    cv.width = Math.max(1, Math.round(c.w * s)); cv.height = Math.max(1, Math.round(c.h * s));
    var x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
    x.setTransform(c.m[0] * s, c.m[1] * s, c.m[2] * s, c.m[3] * s, c.m[4] * s, c.m[5] * s); x.drawImage(dec.src, 0, 0, dec.w, dec.h);
    var q = 0.85, out = cv.toDataURL('image/jpeg', q);
    while (dataUrlBytes(out) > IMG_MAX_BYTES && q > 0.4) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
    if (dataUrlBytes(out) <= IMG_MAX_BYTES) return out;
    return side > 800 ? render(dec, deg, doc, Math.round(side * 0.7)) : null; // muy pesada: más chica (máx. 4 MB)
  }

  // ---------- flujo en el panel ----------
  function rev() { return root.NA_ASISTENTE_REVISION; }
  function ocrStat(x) { var R = rev(); if (R && R.ocr) R.ocr(x); }
  function prep(raw) { // copia normalizada + lo leído (para medir y aprender)
    var b = { numero: raw.numero == null ? null : String(raw.numero), fecha: raw.fecha || null, total: parseAmount(raw.total), rotacion: norm(raw.rotacion || 0), items: [] };
    (raw.items || []).forEach(function (it) { var x = {}; FIELDS.forEach(function (f) { x[f] = it[f] == null ? null : it[f]; }); x._orig = JSON.parse(JSON.stringify(x)); b.items.push(x); });
    b.applied = learnApply(b); return b;
  }
  async function readOnce(ctx, img, signal) {
    var t0 = Date.now(), d;
    try { d = await ctx.post('/auth/assistant/boleta', { image: img, hints: learnHints() }, null, CLIENT_TIMEOUT_MS, signal); }
    catch (e) { d = { error: 'network' }; }
    var ms = Date.now() - t0, to = d && (d.error === 'boleta_timeout' || d.error === 'timeout' || d.status === 504);
    ocrStat({ ok: !!(d && d.ok), ms: ms, timeout: !!to });
    return d || { error: 'network' };
  }
  function progress(ctx, text) {
    var d = ctx.doc, m = ctx.card('na-asst-bol-wait'), p = d.createElement('p'), bar = d.createElement('div'), fill = d.createElement('div'), t0 = Date.now();
    p.textContent = text; bar.className = 'na-asst-bol-bar'; fill.className = 'na-asst-bol-fill'; bar.appendChild(fill); m.appendChild(p); m.appendChild(bar);
    bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
    var tick = setInterval(function () { var s = Math.round((Date.now() - t0) / 1000), pc = Math.min(95, Math.round((Date.now() - t0) / PROGRESS_MS * 100));
      fill.style.width = pc + '%'; bar.setAttribute('aria-valuenow', String(pc)); p.textContent = text + ' (' + s + ' s; puede tardar hasta 90 s)'; }, 1000);
    return { set: function (t) { text = t; p.textContent = t; }, done: function () { clearInterval(tick); if (m.parentNode) m.parentNode.removeChild(m); } };
  }
  function fail(ctx, d) {
    var e = d && d.error, msg = e === 'boleta_timeout' || e === 'timeout' ? 'La lectura tardó más de 90 s. Pruebe con una foto más nítida o recortada.'
      : e === 'boleta_unreadable' ? 'No pude leer esa boleta. Tome la foto de frente, con buena luz y sin mover.'
      : e === 'boleta_admin_only' ? 'Leer boletas con IA es solo para el Admin.' : e === 'image_unsupported' ? 'Leer fotos no está disponible por ahora.'
      : e === 'payload_too_large' ? 'La foto es muy grande. Pruebe con otra.' : 'No pude leer la boleta en este momento. Inténtelo otra vez.';
    ctx.say(msg); ctx.state('error', 2600);
  }
  async function start(file, ctx) {
    var dec; try { dec = await decode(file); } catch (_) { ctx.say('No pude abrir esa foto.'); ctx.state('error', 2000); return; }
    return readAt(dec, 0, ctx, true);
  }
  async function readAt(dec, deg, ctx, auto) {
    var img = render(dec, deg, ctx.doc); if (!img) { ctx.say('La foto es muy grande. Pruebe con otra.'); return; }
    ctx.busy(true); ctx.state('pensando'); var pr = progress(ctx, 'Leyendo la boleta');
    try {
      var d = await readOnce(ctx, img);
      if (d && d.ok && auto) { // auto-girar: el modelo dice que está girada, o no se leyó NADA -> se gira y se lee UNA vez más
        // (auditoría OCR-021) «casi todo null» con algo legible y sin giro detectado (p. ej. una lista de precios derecha) NO se relee:
        // la relectura girada inventaba lo ilegible. Se queda la 1.ª lectura con sus null en amarillo y el aviso para completarlos.
        var r = norm(d.boleta && d.boleta.rotacion || 0);
        if (r || !legibleCells(d.boleta)) { var deg2 = norm(deg + (r || 90)); pr.set('La foto parece girada: la enderezo y la leo otra vez');
          var img2 = render(dec, deg2, ctx.doc), d2 = img2 ? await readOnce(ctx, img2) : null;
          if (d2 && d2.ok && checks(d2.boleta).nulls <= checks(d.boleta).nulls) { d = d2; img = img2; deg = deg2; } }
      } else if (d && !d.ok && auto && d.error === 'boleta_unreadable') {
        var deg3 = norm(deg + 90); pr.set('No se leía: la giro y la leo otra vez'); var img3 = render(dec, deg3, ctx.doc), d3 = img3 ? await readOnce(ctx, img3) : null;
        if (d3 && d3.ok) { d = d3; img = img3; deg = deg3; }
      }
      pr.done();
      if (!d || !d.ok) return fail(ctx, d);
      review(ctx, prep(d.boleta), img, dec, deg); ctx.state('hablando', 1500);
    } finally { pr.done(); ctx.busy(false); }
  }
  function input(doc, v, cls, numeric) { var i = doc.createElement('input'); i.type = 'text'; if (numeric) i.inputMode = 'decimal'; i.value = v == null ? '' : String(v); i.className = cls || ''; if (v == null || v === '') i.classList.add('na-asst-bol-null'); return i; }
  function review(ctx, b, img, dec, deg) {
    var d = ctx.doc, m = ctx.card('na-asst-bol'), warn = d.createElement('div'); warn.className = 'na-asst-bol-warn';
    var pic = d.createElement('img'); pic.src = img; pic.alt = 'Boleta enderezada'; pic.className = 'na-asst-bol-img'; m.appendChild(pic);
    var rot = d.createElement('div'); rot.className = 'na-asst-bol-rot';
    [['⟲ 90°', -90, 'Girar 90° a la izquierda y volver a leer'], ['⟳ 90°', 90, 'Girar 90° a la derecha y volver a leer'], ['180°', 180, 'Girar 180° y volver a leer']].forEach(function (x) {
      var bt = d.createElement('button'); bt.type = 'button'; bt.textContent = x[0]; bt.setAttribute('aria-label', x[2]); bt.onclick = function () { if (m.parentNode) m.parentNode.removeChild(m); readAt(dec, norm(deg + x[1]), ctx, false); }; rot.appendChild(bt); });
    m.appendChild(rot);
    var head = d.createElement('div'); head.className = 'na-asst-bol-head';
    var fNum = input(d, b.numero, 'na-asst-ltr'), fFec = input(d, b.fecha), fTot = input(d, b.total, '', true);
    [['N.º boleta', fNum], ['Fecha', fFec], ['Total S/', fTot]].forEach(function (x) { var l = d.createElement('label'); l.textContent = x[0]; l.appendChild(x[1]); head.appendChild(l); });
    m.appendChild(head);
    var list = d.createElement('div'); list.className = 'na-asst-bol-items';
    b.items.forEach(function (it, i) { var row = d.createElement('div'); row.className = 'na-asst-bol-row';
      FIELDS.forEach(function (f) { var num = f === 'cant' || f === 'precio_unit' || f === 'importe', inp = input(d, it[f], 'na-asst-bol-' + f, num), l = d.createElement('label');
        l.textContent = LABEL[f]; inp.setAttribute('aria-label', LABEL[f] + ' línea ' + (i + 1));
        if (it._applied && it._applied[f]) { inp.classList.add('na-asst-bol-learned'); inp.title = 'corregido por historial'; var tag = d.createElement('small'); tag.textContent = 'corregido por historial'; l.appendChild(tag); }
        inp.addEventListener('input', function () { it[f] = num ? (inp.value.trim() === '' ? null : inp.value.trim()) : (inp.value.trim() || null); inp.classList.toggle('na-asst-bol-null', !inp.value.trim()); upd(); });
        l.appendChild(inp); row.appendChild(l); });
      list.appendChild(row); });
    m.appendChild(list); m.insertBefore(warn, head);
    function upd() {
      b.numero = fNum.value.trim() || null; b.fecha = fFec.value.trim() || null; b.total = parseAmount(fTot.value);
      [fNum, fFec, fTot].forEach(function (x) { x.classList.toggle('na-asst-bol-null', !x.value.trim()); });
      var c = checks(b), w = [];
      if (c.total_mismatch) w.push('La suma de importes (S/ ' + c.sum.toFixed(2) + ') no coincide con el total (S/ ' + c.total.toFixed(2) + '). Revise las líneas.');
      if (c.mostly_null) w.push('Casi nada se pudo leer: la foto puede estar borrosa o girada. Use los botones para girarla o tome otra foto.');
      else if (c.nulls) w.push(c.nulls === 1 ? '1 dato no se leyó (en amarillo): complételo.' : c.nulls + ' datos no se leyeron (en amarillo): complételos.');
      if (b.applied) w.push(b.applied === 1 ? '1 dato se corrigió por historial (sus correcciones anteriores).' : b.applied + ' datos se corrigieron por historial (sus correcciones anteriores).');
      warn.textContent = ''; w.forEach(function (t) { var p = d.createElement('p'); p.textContent = t; warn.appendChild(p); });
      warn.hidden = !w.length; return c;
    }
    [fNum, fFec, fTot].forEach(function (x) { x.addEventListener('input', upd); }); upd();
    var note = d.createElement('p'); note.className = 'na-asst-note'; note.textContent = 'Nada se guarda todavía. «Confirmar» abre «Nueva compra» llena; el stock sube solo cuando pulse «Registrar compra».'; m.appendChild(note);
    var act = d.createElement('div'); act.className = 'na-asst-bol-actions';
    var ok = d.createElement('button'); ok.type = 'button'; ok.className = 'na-asst-ok'; ok.textContent = 'Confirmar y abrir Nueva compra';
    var no = d.createElement('button'); no.type = 'button'; no.className = 'na-asst-retry'; no.textContent = 'Descartar';
    var dup = false;
    no.onclick = function () { if (m.parentNode) m.parentNode.removeChild(m); ctx.say('Boleta descartada. No se guardó nada.'); };
    ok.onclick = function () {
      upd(); var key = seenKey(b), seen = readSeen();
      if (key && seen[key] && !dup) { dup = true; ok.textContent = 'Sí, es otra compra'; ok.classList.add('na-asst-bol-dup'); warn.hidden = false;
        var p = d.createElement('p'); p.textContent = 'Esta boleta ya se confirmó en este aparato el ' + String(seen[key]).slice(0, 10) + '. Si es otra compra, pulse «Sí, es otra compra».'; warn.appendChild(p); return; }
      var r = confirmBoleta(ctx, b); if (!r.ok) { ctx.say(r.msg); return; }
      if (key) markSeen(key); ok.disabled = no.disabled = true; ctx.say(r.msg);
    };
    act.appendChild(ok); act.appendChild(no); m.appendChild(act);
    return m;
  }
  function matchProduct(it, productos) {
    var cod = low(it.cod), ds = low(it.descripcion), list = productos || [];
    if (cod) { var a = list.find(function (p) { return (p.sku && low(p.sku) === cod) || (p.barcode && low(p.barcode) === cod); }); if (a) return a; }
    if (ds) { var b2 = list.filter(function (p) { return low(p.name || p.nombre) === ds; }); if (b2.length === 1) return b2[0]; }
    return null;
  }
  function confirmBoleta(ctx, b) {
    var lines = b.items.filter(function (it) { return it.descripcion || it.cod; }).map(function (it) {
      var prod = matchProduct(it, ctx.productos()), qty = parseAmount(it.cant), pu = parseAmount(it.precio_unit), im = parseAmount(it.importe);
      if (pu == null && im != null && qty) pu = Math.round(im / qty * 100) / 100;
      return { product_id: prod ? prod.id : null, nombre: prod ? (prod.name || prod.nombre) : String(it.descripcion || it.cod || ''), cantidad: qty || 1, costo_unitario: pu };
    });
    if (!lines.length) return { ok: false, msg: 'No hay líneas para la compra. Complete al menos una descripción.' };
    var pairs = correctionsOf(b.items); learnAdd(pairs); ocrStat({ confirmed: true, corrections: countEdits(b.items) });
    var w = ctx.openPurchase(); if (!w) return { ok: false, msg: 'No se pudo abrir «Nueva compra».' };
    ctx.fillPurchase(w, { type: 'compra', proveedor: '', documento: b.numero || '', lineas: lines });
    return { ok: true, msg: 'Abrí «Nueva compra» con ' + (lines.length === 1 ? '1 línea' : lines.length + ' líneas') + '. Revise y pulse «Registrar compra».' + (pairs.length ? ' Guardé ' + pairs.length + (pairs.length === 1 ? ' corrección' : ' correcciones') + ' para la próxima lectura.' : '') };
  }
  function readSeen() { try { var o = JSON.parse(ls(SEEN_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; } }
  function markSeen(k) { var o = readSeen(); o[k] = new Date().toISOString(); var ks = Object.keys(o); if (ks.length > SEEN_MAX) ks.sort(function (a, b) { return String(o[a]).localeCompare(String(o[b])); }).slice(0, ks.length - SEEN_MAX).forEach(function (x) { delete o[x]; }); ls(SEEN_KEY, JSON.stringify(o)); }

  var api = { start: start, showLearned: showLearned, correctionsOf: correctionsOf, countEdits: countEdits, learnAdd: learnAdd, learnApply: learnApply, learnHints: learnHints, learnRead: learnRead, learnClear: learnClear,
    parseAmount: parseAmount, checks: checks, legibleCells: legibleCells, exifOrientation: exifOrientation, rotateSpec: rotateSpec, orientSpec: orientSpec, compose: compose, fitScale: fitScale,
    dataUrlBytes: dataUrlBytes, seenKey: seenKey, matchProduct: matchProduct, prep: prep, review: review, confirmBoleta: confirmBoleta, readAt: readAt,
    LIMITS: { IMG_MAX_SIDE: IMG_MAX_SIDE, IMG_MAX_BYTES: IMG_MAX_BYTES, CLIENT_TIMEOUT_MS: CLIENT_TIMEOUT_MS, LEARN_MAX: LEARN_MAX, HINTS_MAX: HINTS_MAX } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NA_ASISTENTE_BOLETA = api;
})(typeof window !== 'undefined' ? window : globalThis);
