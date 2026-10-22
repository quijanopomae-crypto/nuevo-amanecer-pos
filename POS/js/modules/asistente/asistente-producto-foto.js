// «Foto de producto» (solo Admin, carga diferida). La foto de la etiqueta va a POST /auth/assistant/producto-foto;
// lo leído se muestra para revisar y editar, y «Abrir Nuevo producto» solo PRELLENA el formulario de siempre (abrirModalProd).
// Aquí no se guarda nada: el producto se crea cuando el Admin pulsa Guardar en ese formulario.
(function (root) {
  'use strict';
  var PATH = '/auth/assistant/producto-foto', TIMEOUT_MS = 75000;
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function codes(p) { var out = []; [p && p.barcode, p && p.codigo].forEach(function (c) { if (c) out.push(String(c).replace(/\s+/g, '')); });
    if (p && Array.isArray(p.codigos)) p.codigos.forEach(function (c) { if (c) out.push(String(c && c.codigo || c).replace(/\s+/g, '')); }); return out; }
  // ¿Ya existe en el catálogo de este aparato? Primero por código leído (exacto), luego por nombre igual. Solo aviso: no bloquea.
  function match(productos, prod) {
    var list = Array.isArray(productos) ? productos : [], code = prod && (prod.codigo_barras || prod.codigo_leido), name = norm(prod && (prod.nombre_sugerido || prod.nombre));
    if (code) for (var i = 0; i < list.length; i++) if (codes(list[i]).indexOf(code) >= 0) return { by: 'codigo', id: list[i].id, nombre: String(list[i].nombre || '') };
    if (name) for (var j = 0; j < list.length; j++) if (norm(list[j].nombre) === name) return { by: 'nombre', id: list[j].id, nombre: String(list[j].nombre || '') };
    return null;
  }
  function num(v) { var n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  // Lo que se manda a «Nuevo producto»: lo que el Admin dejó en la revisión. Sin código inválido. El precio de venta SOLO si el Admin
  // lo escribió: el de la etiqueta es una sugerencia que se muestra, no se copia.
  function prefill(prod, edits) {
    var e = edits || {}, code = String(e.codigo_barras != null ? e.codigo_barras : (prod.codigo_barras || '')).replace(/\s+/g, '');
    return { nombre: String(e.nombre != null ? e.nombre : (prod.nombre_sugerido || '')).trim().slice(0, 80) || null,
      codigo_barras: /^[0-9A-Za-z-]{4,32}$/.test(code) ? code : null,
      precio: num(e.precio), costo: num(e.costo), unidad: prod.unidad || null, categoria: prod.categoria || null };
  }
  function msgFor(d) {
    var e = d && d.error;
    return e === 'producto_foto_admin_only' ? 'La foto de producto es solo para el Admin.'
      : e === 'producto_foto_unreadable' ? 'No pude leer esa etiqueta. Tome la foto de frente, con buena luz y sin reflejos.'
      : e === 'producto_foto_timeout' || e === 'timeout' ? 'La lectura tardó demasiado. Pruebe con una foto más nítida o recortada.'
      : e === 'image_unsupported' ? 'Leer fotos no está disponible por ahora.'
      : e === 'payload_too_large' ? 'La foto es muy pesada. Pruebe con otra.' : 'No pude leer la foto. Inténtelo otra vez.';
  }
  function field(doc, label, val, attrs) {
    var w = doc.createElement('label'); w.className = 'na-asst-pf-row'; var s = doc.createElement('span'); s.textContent = label; w.appendChild(s);
    var i = doc.createElement('input'); i.className = 'fi'; i.value = val == null ? '' : String(val); Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
    w.appendChild(i); return { row: w, input: i };
  }
  function render(prod, checks, ctx) {
    var doc = ctx.doc, card = ctx.card('na-asst-pf'), h = doc.createElement('div'); h.textContent = 'Esto leí de la etiqueta. Revíselo antes de abrir «Nuevo producto»:'; card.appendChild(h);
    var info = [prod.marca && 'Marca: ' + prod.marca, prod.presentacion && 'Presentación: ' + prod.presentacion, prod.contenido && 'Contenido: ' + prod.contenido].filter(Boolean);
    if (info.length) { var p = doc.createElement('div'); p.className = 'na-asst-pf-info'; p.textContent = info.join(' · '); card.appendChild(p); }
    var fN = field(doc, 'Nombre', prod.nombre_sugerido, { maxlength: '80' }), fC = field(doc, 'Código de barras', prod.codigo_barras || '', { inputmode: 'numeric', maxlength: '32' }),
      fP = field(doc, 'Precio de venta S/', '', prod.precio_etiqueta != null ? { inputmode: 'decimal', placeholder: 'Sugerido: ' + prod.precio_etiqueta.toFixed(2) } : { inputmode: 'decimal' }), fK = field(doc, 'Costo S/ (opcional)', '', { inputmode: 'decimal' });
    [fN, fC, fP, fK].forEach(function (f) { card.appendChild(f.row); });
    var notes = [];
    if (checks && checks.barcode_invalid) notes.push('El código leído (' + prod.codigo_leido + ') no pasa la verificación; escríbalo o escanéelo en el formulario.');
    if (prod.precio_etiqueta != null) notes.push('Precio impreso en la etiqueta: S/ ' + prod.precio_etiqueta.toFixed(2) + '. Es solo una sugerencia: escriba su precio de venta.');
    if (prod.categoria) notes.push('Categoría sugerida: ' + prod.categoria + ' (se elige en el formulario si ya existe).');
    var dup = match(ctx.productos ? ctx.productos() : [], prod);
    if (dup) notes.push((dup.by === 'codigo' ? 'Ese código ya es de «' : 'Ya existe un producto llamado «') + dup.nombre + '». Revise antes de crear otro.');
    notes.forEach(function (t) { var n = doc.createElement('div'); n.className = 'na-asst-pf-note'; n.textContent = t; card.appendChild(n); });
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'na-asst-retry'; b.textContent = 'Abrir «Nuevo producto»';
    b.onclick = function () {
      var v = prefill(prod, { nombre: fN.input.value, codigo_barras: fC.input.value, precio: fP.input.value, costo: fK.input.value });
      var ok = ctx.openNewProduct ? ctx.openNewProduct(v) : false;
      ctx.say(ok ? 'Listo: dejé los datos en «Nuevo producto». Revise y pulse Guardar para crearlo.' : 'No pude abrir «Nuevo producto» aquí. Ábralo desde Inventario.');
    };
    card.appendChild(b); return card;
  }
  // Gira una foto (data URL) «deg» grados en el sentido del reloj. Sin canvas (pruebas) o si falla: null.
  function rotateImage(doc, src, deg) {
    return new Promise(function (ok) {
      var Img = root.Image; if (!Img || !doc || !doc.createElement) { ok(null); return; }
      var img = new Img(); img.onerror = function () { ok(null); };
      img.onload = function () { try {
        var cv = doc.createElement('canvas'), side = deg === 90 || deg === 270; cv.width = side ? img.height : img.width; cv.height = side ? img.width : img.height;
        var g = cv.getContext('2d'); g.translate(cv.width / 2, cv.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(img, -img.width / 2, -img.height / 2);
        ok(cv.toDataURL('image/jpeg', 0.85)); } catch (_) { ok(null); } };
      img.src = src;
    });
  }
  async function start(image, ctx) {
    ctx.busy(true); ctx.state('concentrado');
    try {
      var d = await ctx.post(PATH, { image: image }, null, TIMEOUT_MS);
      // Foto de lado o al revés: se gira UNA vez y se vuelve a leer (como en las boletas). Si la segunda lectura falla, queda la primera.
      var rot = d && d.ok && d.producto ? Number(d.producto.rotacion) || 0 : 0;
      if (rot) { var turned = await (ctx.rotate || function (s, g) { return rotateImage(ctx.doc, s, g); })(image, rot);
        if (turned) { var d2 = await ctx.post(PATH, { image: turned }, null, TIMEOUT_MS); if (d2 && d2.ok && d2.producto && !(d2.checks && d2.checks.mostly_null)) d = d2; } }
      if (!d || !d.ok || !d.producto) { ctx.say(msgFor(d)); ctx.state('error', 2600); return null; }
      if (d.checks && d.checks.mostly_null) { ctx.say('Casi no pude leer la etiqueta. Tome la foto de frente, con buena luz, solo del producto.'); ctx.state('error', 2600); return null; }
      var c = render(d.producto, d.checks, ctx); ctx.state('hablando', 2000); return c;
    } catch (_) { ctx.say(msgFor(null)); ctx.state('error', 2600); return null; }
    finally { ctx.busy(false); }
  }
  var api = { PATH: PATH, start: start, match: match, prefill: prefill, msgFor: msgFor, rotateImage: rotateImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NA_ASISTENTE_PRODUCTO_FOTO = api;
})(typeof window !== 'undefined' ? window : globalThis);
