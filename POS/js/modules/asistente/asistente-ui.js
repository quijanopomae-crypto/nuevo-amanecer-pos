/* Asistente del POS (PROTOTIPO AISLADO, modo admin): burbuja animada + panel de chat + tarjeta en Inicio.
   - Dueño: siempre. Aparato de empleado: solo si el dueño le dio un nivel («Solo consultas» o «Consultas y documentos»).
     Quién puede lo dice el SERVIDOR (ping a /auth/assistant/chat); aquí no se guarda el permiso en ninguna caché.
   - Solo en pantallas de gestión (nunca en Venta ni en Caja: no tapa Cobrar).
   - No vende ni llena el carrito.
   - Nunca ejecuta nada sin «Confirmar» de la sesión DUEÑO (el servidor la verifica; un toque, sin PIN, sin repetir con doble toque); la ejecución pasa por NA_ASISTENTE_CORE.createGate y abre
     pantallas EXISTENTES del POS: Nueva compra, Registrar movimiento, ficha del producto, Nuevo producto.
   - Consultas: números leídos por el Worker (solo lectura). Documentos: internos, armados en el aparato, NO SUNAT.
   - Sin internet: «Asistente no disponible sin internet» (los documentos locales igual se pueden abrir). */
(function (root) {
  'use strict';
  var doc = root.document, C = root.NA_ASISTENTE_CORE;
  if (!doc || !C || root.NA_ASISTENTE) return;
  var cutNote = null; // nota de corte de la última respuesta (Bot 4: «Ver nuevo ↓» nunca la tapa)
  var lastCut = null; // burbuja de la última respuesta CORTADA por el servidor (final.cut === true): su cabecera pintada sirve a la continuación
  var configurationTurn = false;
  var history = [], invoiceMemory = null, state = 'listo', quality = 'high', lowBattery = false, slowFrames = false, stateTimer = null, busy = false;
  // Memoria de la charla (#946): hasta memoria.max_bytes del servidor; lo viejo se resume (resumen_sugerido -> «resumen»). Solo en memoria,
  // nunca en el almacenamiento del aparato; se borra con «Nueva conversación». queued: lo escrito mientras se respondía (sale al terminar).
  var mem = C.memNew ? C.memNew() : null, queued = null, queuedNote = null, shownSigs = {}, turnNo = 0; configurationTurn = false;
  var mascot = null, mascotAsked = false; // mascota v11 del dueño (asistente-mascota.js): solo dentro del panel, se pide al abrirlo la primera vez
  var clockOffset = 0;
  var IDLE_MS = 9000, HOLD_MS = 700, holding = false, holdTimer = null, idleTimer = null, sleeping = false, offscreen = false, heroOff = true, heroIO = null, heroDeferred = false, adminOff = false, bubbleIO = null, wired = false;
  // Pantallas de gestión donde vive la burbuja. Nunca Venta (pagePOS) ni Caja (pageCaja).
  var ADMIN_PAGES = ['pageMenu', 'pageInventario', 'pageVentas', 'pageClientes', 'pageGastos', 'pageConfig', 'pageHistorialCompras', 'pageValorizacion', 'pageReporteDeuda', 'pageKardex', 'pageVentasStock', 'pageRotacionAbc', 'pageReporteArqueo', 'pageCodigosDuplicados'];
  // access: lo último que dijo el servidor ({ role: 'owner' | 'empleado', level }). null = todavía no se sabe.
  var access = null;
  function isAdmin() { return !adminOff && !!access && (access.role === 'owner' || access.level === 'consultas' || access.level === 'consultas_documentos'); }
  function isOwnerAccess() { return isAdmin() && access.role === 'owner'; }
  // «Ventas bajo costo»: Admin o nivel 3 con «costos y cambios» (roles.cambios del ping), lo mismo que permite el Worker (seesOwnerData).
  function canBelowCost() { return isOwnerAccess() || (isAdmin() && access.role === 'empleado' && access.level === 'consultas_documentos' && access.cambios === true); }
  // Foto: solo dueño y solo si el proveedor en uso lee fotos (ping vision:false = sin botón ni chip; Bot 4).
  function canPhoto() { return isOwnerAccess() && !(access && access.vision === false); }
  function pageId() { var a = doc.querySelector('.page.active'); return a ? a.id : null; }
  function allowedHere() { return isAdmin() && ADMIN_PAGES.indexOf(pageId()) >= 0; }

  // ---------- Personaje ----------
  function bits() { var a = ''; for (var i = 0; i < 16; i++) { for (var k = 0; k < 18; k++) a += Math.random() > .5 ? '1' : '0'; a += '<br>'; } return a; }
  var charSeq = 0; // ids de SVG únicos por personaje (hay hasta 3 a la vez: burbuja, cabecera del panel, tarjeta de Inicio)
  function charHtml() {
    var u = 'naA' + (++charSeq);
    var orbit = '', conf = '', colors = ['#22c55e', '#facc15', '#38bdf8', '#f472b6', '#a3e635'];
    for (var i = 0; i < 12; i++) orbit += '<i style="transform:translate(-50%,-50%) rotate(' + (i * 30) + 'deg) translateY(calc(var(--asst-size) * -.62)) rotate(-' + (i * 30) + 'deg)">' + (i % 3 ? (i % 2) : '01') + '</i>';
    for (var j = 0; j < 10; j++) { var a = j / 10 * Math.PI * 2; conf += '<b style="--dx:' + Math.round(Math.cos(a) * 46) + 'px;--dy:' + Math.round(Math.sin(a) * 46 - 18) + 'px;background:' + colors[j % 5] + '"></b>'; }
    return '<div class="na-asst-char" data-state="listo" data-q="high"><div class="na-asst-shadow"></div><div class="na-asst-hop"><div class="na-asst-squash">' +
      '<div class="na-asst-orbit" aria-hidden="true">' + orbit + '</div>' +
      '<div class="na-asst-sphere"><div class="na-asst-bits" aria-hidden="true"><div>' + bits() + bits() + '</div></div>' +
      '<svg class="na-asst-face" viewBox="0 0 100 100" aria-hidden="true"><defs>' +
      '<radialGradient id="' + u + 'Iris" cx="40%" cy="35%"><stop offset="0" stop-color="#bbf7d0"/><stop offset=".45" stop-color="#22c55e"/><stop offset="1" stop-color="#14532d"/></radialGradient>' +
      '<radialGradient id="' + u + 'IrisB" cx="40%" cy="35%"><stop offset="0" stop-color="#bfdbfe"/><stop offset=".5" stop-color="#2563eb"/><stop offset="1" stop-color="#1e3a8a"/></radialGradient>' +
      '<clipPath id="' + u + 'EyeL"><ellipse cx="33" cy="45" rx="13.5" ry="15.5"/></clipPath><clipPath id="' + u + 'EyeR"><ellipse cx="67" cy="45" rx="13.5" ry="15.5"/></clipPath></defs>' +
      '<ellipse cx="22" cy="63" rx="6" ry="3.2" fill="#bbf7d0" opacity=".45"/><ellipse cx="78" cy="63" rx="6" ry="3.2" fill="#bbf7d0" opacity=".45"/>' +
      eye('L', 33, u) + eye('R', 67, u) +
      '<path class="brow" d="M21 27 L42 32 M58 32 L79 27" stroke="#052e16" stroke-width="3" stroke-linecap="round"/>' +
      '<path class="m m-smile" d="M43 66 Q50 72 57 66" fill="none" stroke="#052e16" stroke-width="2.6" stroke-linecap="round"/>' +
      '<g class="m m-open"><path d="M40 64 Q50 82 60 64 Z" fill="#7f1d1d" stroke="#052e16" stroke-width="1.5"/><ellipse cx="50" cy="73" rx="5.5" ry="3.2" fill="#fb7185"/></g>' +
      '<ellipse class="m m-talk" cx="50" cy="69" rx="6" ry="5" fill="#7f1d1d" stroke="#052e16" stroke-width="1.5"/>' +
      '<path class="m m-worry" d="M42 72 Q50 65 58 72" fill="none" stroke="#052e16" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle class="m m-o" cx="53" cy="69" r="3.2" fill="none" stroke="#052e16" stroke-width="2.2"/></svg>' +
      '<div class="na-asst-tint"></div><div class="na-asst-gloss"></div><div class="na-asst-gloss2"></div><div class="na-asst-rim"></div></div></div></div>' +
      '<div class="na-asst-dots" aria-hidden="true"><i></i><i></i><i></i></div><div class="na-asst-confetti">' + conf + '</div><div class="na-asst-badge" aria-hidden="true"></div></div>';
  }
  function eye(s, cx, u) {
    return '<g clip-path="url(#' + u + 'Eye' + s + ')"><ellipse cx="' + cx + '" cy="45" rx="13.5" ry="15.5" fill="#f8fafc"/>' +
      '<g class="pupils"><circle cx="' + cx + '" cy="47" r="9.5" fill="url(#' + u + 'Iris)"/><g class="iris-think"><circle cx="' + cx + '" cy="47" r="9.5" fill="url(#' + u + 'IrisB)"/>' +
      '<text x="' + cx + '" y="50.5" font-size="8.5" font-family="monospace" font-weight="700" text-anchor="middle" fill="#dbeafe">01</text></g>' +
      '<circle cx="' + cx + '" cy="47" r="4.2" fill="#052e16"/><circle cx="' + (cx - 3.4) + '" cy="42.6" r="2.8" fill="#fff"/><circle cx="' + (cx + 3) + '" cy="51" r="1.2" fill="#fff" opacity=".8"/></g>' +
      '<rect class="lid" x="' + (cx - 15) + '" y="29" width="30" height="33" fill="#1fb456"/></g>';
  }

  // ---------- Estados y calidad ----------
  var LABELS = { listo: '', concentrado: 'Concentrado…', pensando: 'Pensando…', hablando: 'Hablando', feliz: '¡Listo!', error: 'Algo falló', offline: 'Sin internet' };
  function chars() { return doc.querySelectorAll('.na-asst-char'); }
  function setState(s, ms) {
    state = s; clearTimeout(stateTimer);
    chars().forEach(function (c) { c.dataset.state = s; var b = c.querySelector('.na-asst-badge'); if (b) b.textContent = s === 'error' ? '!' : s === 'feliz' ? '✓' : ''; });
    if (rootEl) { rootEl.dataset.state = s; tagEl.textContent = LABELS[s] || ''; }
    if (mascot) mascot.state(s);
    if (ms) stateTimer = setTimeout(function () { setState(root.navigator.onLine === false ? 'offline' : 'listo'); }, ms);
    wake();
  }
  // Batería: tras ~20 s quieta en Listo (panel cerrado) las animaciones infinitas se pausan. Tocar o cambiar de estado las reanuda.
  // Al desplazar la pantalla o escribir, las animaciones se detienen y vuelven tras un momento quieto (menos trabajo mientras la persona usa el POS).
  function hold() { if (!holding) { holding = true; applyPause(); } clearTimeout(holdTimer); holdTimer = setTimeout(function () { holding = false; applyPause(); }, HOLD_MS); }
  // Despertar gana sobre la pausa por escribir (llegó la respuesta: la cara que se ve se anima).
  function wake() { sleeping = false; if (holding) { holding = false; clearTimeout(holdTimer); } clearTimeout(idleTimer); idleTimer = setTimeout(function () { if (state === 'listo' && (!panelEl || panelEl.hidden)) { sleeping = true; applyPause(); } }, IDLE_MS); applyPause(); }
  // La tarjeta de Inicio tiene su propio observador de visibilidad (no usa el de la burbuja, que en Inicio está oculta).
  function watchHero() {
    if (!heroEl || heroEl._naIO) return; heroEl._naIO = true;
    try { if (heroIO) heroIO.disconnect(); heroIO = new IntersectionObserver(function (es) { heroOff = !es[es.length - 1].isIntersecting; applyPause(); }); heroIO.observe(heroEl); }
    catch (_) { heroOff = false; }
  }
  function computeQuality() {
    try { if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off'; } catch (_) {}
    var n = root.navigator || {}, weak = (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 2);
    return (weak || lowBattery || slowFrames) ? 'low' : 'high';
  }
  function applyQuality() { quality = computeQuality(); chars().forEach(function (c) { c.dataset.q = quality; }); if (rootEl) rootEl.dataset.q = quality; }
  // Mide el tiempo de cuadro unos 1.5 s; si el aparato no llega a ~45 fps baja la calidad.
  function measureFrames() {
    if (!root.requestAnimationFrame || doc.hidden) return;
    var t = [], last = 0;
    function f(ts) { if (last) t.push(ts - last); last = ts; if (t.length < 90) root.requestAnimationFrame(f); else {
      t.sort(function (a, b) { return a - b; }); var med = t[45], jank = t.filter(function (x) { return x > 34; }).length;
      var was = slowFrames; slowFrames = med > 22 || jank > 9; if (was !== slowFrames) applyQuality(); } }
    root.requestAnimationFrame(f);
  }
  function watchBattery() {
    try { if (!root.navigator.getBattery) return; root.navigator.getBattery().then(function (b) {
      function u() { lowBattery = !b.charging && b.level <= 0.2; applyQuality(); }
      b.addEventListener('levelchange', u); b.addEventListener('chargingchange', u); u(); }).catch(function () {});
    } catch (_) {}
  }
  // Pausa: pestaña oculta o una ventana del POS abierta (cobro, compra, ficha): nunca compite con Cobrar.
  // Solo cuenta una ventana que SE VE: una .modal-overlay que quedó con «open» pero oculta (display:none) no esconde la burbuja (Inventario).
  function shownNode(n) { if (!n || n.hidden || (n.style && n.style.display === 'none')) return false; try { var cs = root.getComputedStyle ? root.getComputedStyle(n) : null; if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false; } catch (_) {} return true; }
  function busyPos() { var l = doc.querySelectorAll ? doc.querySelectorAll('.modal-overlay.open, #naPurchaseDialog, .na-pin-overlay') : []; for (var i = 0; i < l.length; i++) if (shownNode(l[i])) return true; return false; }
  // Con una ventana del POS abierta (cobro, ficha, compra) la burbuja se oculta: nunca tapa sus botones.
  function applyPause() {
    var busyNow = busyPos() && panelEl && panelEl.hidden, rest = holding || (sleeping && state === 'listo');
    // Cada cara descansa según SU propia visibilidad (Bot 4): la burbuja con su IntersectionObserver, la tarjeta de Inicio con el suyo
    // y la cara del panel abierto solo por pestaña oculta o reposo. Así wake() siempre despierta la cara que se ve.
    var p = doc.hidden || busyNow || offscreen || rest ? '1' : '0';
    var hp = doc.hidden || heroOff || rest || busyNow ? '1' : '0';
    var pp = doc.hidden || !panelEl || panelEl.hidden || rest ? '1' : '0';
    chars().forEach(function (c) { var v = panelEl && panelEl.contains(c) ? pp : heroEl && heroEl.contains(c) ? hp : p; if (c.dataset.paused !== v) c.dataset.paused = v; });
    if (heroEl && heroEl.dataset.paused !== hp) heroEl.dataset.paused = hp;
    if (rootEl && rootEl.dataset.paused !== p) rootEl.dataset.paused = p;
    if (rootEl) rootEl.style.visibility = busyNow ? 'hidden' : '';
    if (rootEl) { var show = allowedHere(); rootEl.style.display = show ? '' : 'none'; // botón flotante también en Inicio e Inventario (la tarjeta de Inicio sigue)
      // Al entrar a Venta o Caja (o si deja de ser dueño) el panel se cierra: nunca queda sobre Cobrar.
      if (!show && panelEl && !panelEl.hidden && (!isAdmin() || pageId() === 'pagePOS' || pageId() === 'pageCaja')) { panelEl.hidden = true; rootEl.hidden = false; } }
  }

  // ---------- Posición: nunca tapar Cobrar ni el carrito ----------
  function visible(el) { if (!el) return null; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? r : null; }
  // Espacio abajo en TODA página donde se ve la burbuja: la última fila o la última opción siempre se pueden subir hasta 12 px POR ENCIMA
  // de la burbuja. Se MIDE (no se adivina): con el contenedor que de verdad desplaza esa fila (el documento en el celular, .main-scroll en
  // tableta/PC, una lista interna si desplaza) se calcula dónde quedaría la fila con todo desplazado abajo, y solo si la burbuja la taparía
  // se agrega lo que falta de relleno inferior a ese contenedor. Si no la tapa, no se toca nada (ni un píxel: CLS igual a la base).
  // En tableta/PC (>= 700 px) nunca se rellena #pageMenu: es una columna de alto fijo y su relleno movería el menú lateral (Bot 4).
  // Hasta que el servidor dijo quién es este aparato (access) no se rellena nada. Al salir de la página se devuelve el valor original.
  var padded = [], GAP = 12, LAST_N = 40;
  var TAPPABLE = 'button, a[href], input:not([type=hidden]), select, textarea, [onclick], [role="button"], [tabindex]:not([tabindex="-1"])';
  function unpad(e) { var o = e.dataset.naAsstPb || ''; e.style.removeProperty('padding-bottom'); if (o) e.style.paddingBottom = o; delete e.dataset.naAsstPb; }
  function scrollable(e) { var cs = getComputedStyle(e); return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1; }
  function pinned(n, pg) { for (; n && n !== doc.body; n = n.parentElement) { var ps = getComputedStyle(n).position; if (ps === 'fixed' || ps === 'sticky') return true; if (n === pg) break; } return false; }
  // Última opción tocable de la página (por borde de abajo). Solo las últimas LAST_N en orden del documento: barato aunque Inventario tenga cientos.
  // Solo cuenta lo que está en la MISMA franja horizontal que la burbuja (en PC el menú lateral o la columna izquierda nunca quedan debajo).
  function lastTappable(pg, br) {
    var all = pg.querySelectorAll(TAPPABLE), best = null, x0 = br.left - 8, x1 = br.right + 8;
    for (var i = all.length - 1, k = 0; i >= 0 && k < LAST_N; i--) { var n = all[i]; if (rootEl.contains(n)) continue;
      var r = n.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) continue; k++;
      if (r.right < x0 || r.left > x1) continue;
      if (best && r.bottom <= best.r.bottom) continue;
      if (getComputedStyle(n).visibility === 'hidden' || pinned(n, pg)) continue;
      best = { el: n, r: r }; }
    return best;
  }
  // Última celda visible de las tablas (td/th) en la franja de la burbuja (Bot 4 sobre 78dbc841): en Valorización la fila TOTAL o en
  // Ventas/stock la última «—» no son tocables pero se tienen que poder leer. Barato: solo las 2 últimas filas visibles de cada tabla (tfoot o tbody),
  // de las últimas LAST_N tablas visibles; nunca recorre todas las celdas de Inventario.
  function lastCell(pg, br) {
    var tables = pg.querySelectorAll('table'), best = null, x0 = br.left - 8, x1 = br.right + 8;
    for (var i = tables.length - 1, k = 0; i >= 0 && k < LAST_N; i--) { var t = tables[i]; if (rootEl.contains(t)) continue;
      var tr0 = t.getBoundingClientRect(); if (!(tr0.width > 0 && tr0.height > 0)) continue; k++;
      if (tr0.right < x0 || tr0.left > x1) continue;
      var rows = t.rows; if (!rows || !rows.length) continue;
      for (var j = rows.length - 1, seen = 0; j >= 0 && seen < 2; j--) { var row = rows[j], rr = row.getBoundingClientRect(); if (!(rr.width > 0 && rr.height > 0)) continue; seen++;
        for (var c = 0; c < row.cells.length; c++) { var cell = row.cells[c], r = cell.getBoundingClientRect();
          if (!(r.width > 0 && r.height > 0) || r.right < x0 || r.left > x1) continue;
          if (best && r.bottom <= best.r.bottom) continue;
          if (getComputedStyle(cell).visibility === 'hidden' || pinned(cell, pg)) continue;
          best = { el: cell, r: r }; } }
    }
    return best;
  }
  // Último párrafo con texto (Bot 4: la nota de Reporte de deuda, el aviso «sin movimientos» de Kardex) en la franja de la burbuja.
  // Barato: solo los últimos LAST_N párrafos de la página.
  function lastNote(pg, br) {
    var ps = pg.querySelectorAll('p'), best = null, x0 = br.left - 8, x1 = br.right + 8;
    for (var i = ps.length - 1, k = 0; i >= 0 && k < LAST_N; i--) { var n = ps[i]; if (rootEl.contains(n)) continue; k++;
      if (!n.textContent || !n.textContent.trim()) continue;
      var r = n.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0) || r.right < x0 || r.left > x1) continue;
      if (best && r.bottom <= best.r.bottom) continue;
      if (getComputedStyle(n).visibility === 'hidden' || pinned(n, pg)) continue;
      best = { el: n, r: r }; }
    return best;
  }
  // Lo más bajo entre la última opción tocable, la última celda de tabla y el último párrafo con texto.
  function lowest(a, b) { return !a ? b : !b ? a : (b.r.bottom > a.r.bottom ? b : a); }
  function lastRow(pg, br) { return lowest(lowest(lastTappable(pg, br), lastCell(pg, br)), lastNote(pg, br)); }
  // Contenedor que desplaza a `n`: el primer padre con scroll dentro de la página (incluida la página), o el documento.
  function scrollerOf(n, pg) { for (var e = n.parentElement; e && e !== doc.body && e !== doc.documentElement; e = e.parentElement) { if (scrollable(e)) return e; if (e === pg) break; } return null; }
  function padTo(e, px) { var cur = parseFloat(getComputedStyle(e).paddingBottom) || 0; if (px <= cur + 0.5) return;
    if (e.dataset.naAsstPb == null) { e.dataset.naAsstPb = e.style.paddingBottom || ''; padded.push(e); }
    e.style.setProperty('padding-bottom', Math.ceil(px) + 'px', 'important'); } // el POS fija el suyo con !important
  // Cuánto taparía la burbuja a la última opción con todo desplazado abajo (0 = no la tapa). La cuenta vive en C.padOverlap (probada).
  // Clientes/Inventario/Ventas en el celular: al desplazar, el POS achica la cabecera (NA_MOTION.scroll, --na-scroll-collapse-y); si lo
  // que sobra para desplazar es menor, la página «rebota» arriba y la última fila queda quieta debajo de la burbuja (Bot 4: fila hasta
  // y=732, burbuja desde y=694). Solo se LEE NA_MOTION.scroll.inspect; no se toca su código.
  function overlapAtEnd(last, sc, limit) {
    var vh = root.innerHeight;
    if (sc) { var er = sc.getBoundingClientRect(); return C.padOverlap({ rowBottom: last.r.bottom, limit: limit, sc: { visBottom: Math.min(er.bottom, vh), rest: sc.scrollHeight - sc.clientHeight - sc.scrollTop } }); }
    var se = doc.scrollingElement || doc.documentElement, col = 0;
    try { var m = root.NA_MOTION && root.NA_MOTION.scroll && root.NA_MOTION.scroll.inspect(pgId()); if (m && m.active) col = (Number(m.totalHeight) || 0) - (Number(m.collapseOffset) || 0); } catch (_) {}
    return C.padOverlap({ rowBottom: last.r.bottom, limit: limit, vh: vh, sy: root.scrollY || se.scrollTop || 0, sh: se.scrollHeight, collapse: col });
  }
  function pgId() { var a = doc.querySelector('.page.active'); return a ? a.id : ''; }
  function padPage(bottom) {
    var pg = doc.querySelector('.page.active'), shown = !!access && rootEl && rootEl.style.display !== 'none' && !rootEl.hidden && bottom > 0;
    padded = padded.filter(function (e) { if (!shown || !pg || !pg.contains(e) && e !== pg || !e.isConnected) { unpad(e); return false; } return true; });
    if (!pg || !shown) return;
    var bEl = rootEl.querySelector('.na-asst-bubble'), br = bEl ? visible(bEl) : null; if (!br) return;
    var last = lastRow(pg, br); if (!last) return;
    var limit = br.top - GAP, sc = scrollerOf(last.el, pg), over = overlapAtEnd(last, sc, limit);
    if (over <= 0) return;
    // A quién se le agrega: al contenedor que desplaza; si desplaza el documento, a la página (salvo #pageMenu en tableta/PC).
    var target = sc || pg;
    if (target === pg && pg.id === 'pageMenu' && root.innerWidth >= 700) { var ms = pg.querySelector('.main-scroll'); if (!ms || !scrollable(ms) || !ms.contains(last.el)) return; target = ms; }
    // +8 px de colchón: en el celular la barra de arriba se esconde al desplazar y el final cambia unos píxeles.
    padTo(target, (parseFloat(getComputedStyle(target).paddingBottom) || 0) + over + 8);
  }
  function place() {
    if (!rootEl) return;
    var vw = root.innerWidth, vh = root.innerHeight, right = 14, bottom = 16;
    var pos = doc.getElementById('pagePOS'), posActive = pos && pos.classList.contains('active');
    if (posActive) {
      var foot = visible(doc.querySelector('#pagePOS .cart-footer')), drawer = visible(doc.getElementById('cartDrawer'));
      if (drawer && drawer.left > vw * 0.45 && drawer.width < vw * 0.9) right = Math.round(vw - drawer.left + 16); // carrito acoplado (PC/tablet)
      else if (foot && foot.top < vh) bottom = Math.round(vh - foot.top + 12); // teléfono: encima de Total/Cobrar
    }
    rootEl.style.setProperty('--asst-right', right + 'px'); rootEl.style.setProperty('--asst-bottom', bottom + 'px');
    padPage(posActive ? 0 : bottom);
    if (panelEl) panelEl.style.setProperty('--asst-panel-right', (right > 14 ? right : 16) + 'px');
  }

  // ---------- Red ----------
  function creds() { try { var c = JSON.parse(root.localStorage.getItem('na_cloud_sync_credentials') || 'null'); return c && c.endpoint && c.token ? c : null; } catch (_) { return null; } }
  function protoRole() { try { var r = root.localStorage.getItem('na_asistente_proto_role'); return r === 'empleado' || r === 'sinrol' ? r : null; } catch (_) { return null; } }
  function protoLevel() { try { return root.localStorage.getItem('na_asistente_proto_level') || ''; } catch (_) { return ''; } }
  // Para la puerta de ejecución: rol y nivel según el SERVIDOR (último ping), no el rol guardado del POS.
  function roles() {
    if (!access) return { role: 'unknown' };
    // cambios: nivel 3 con «costos y cambios» según el ping del servidor (solo para tarjetas de Configuración con destino servidor)
    return { role: access.role, level: access.level, cambios: access.cambios === true, isOwner: function () { return access.role === 'owner'; } };
  }
  // Mismo pedido que NA_ROLES.api (endpoint, Bearer, sin cookies) pero con límite de tiempo propio del asistente.
  // Un timeout lanza un error (timeout=true); un error HTTP vuelve como { error, status }.
  function reqInit(path, body, headers) {
    var c = creds(), url = path, h = Object.assign({ 'content-type': 'application/json' }, headers || {});
    var init = { method: 'POST', cache: 'no-store', body: JSON.stringify(body) };
    if (c) { url = c.endpoint.replace(/\/+$/, '') + path; h.authorization = 'Bearer ' + c.token; init.credentials = 'omit'; init.redirect = 'error'; }
    else if (protoRole()) { h['x-proto-role'] = protoRole(); if (protoLevel()) h['x-proto-level'] = protoLevel(); }
    init.headers = h; // sin cabeceras nuevas: la respuesta en partes se pide con stream:true en el cuerpo (CORS del Worker sin cambios)
    return { url: url, init: init };
  }
  async function post(path, body, headers, ms) {
    var q = reqInit(path, body, headers), url = q.url, init = q.init;
    var r = await C.request(root.fetch.bind(root), url, init, ms || C.TIMEOUTS.chat);
    var d = r.data || {}; if (!r.ok) { d.error = d.error || 'HTTP_' + r.status; d.status = r.status; }
    if (r.bodyError) { try { Object.defineProperty(d, 'bodyError', { value: true, enumerable: false, configurable: true }); } catch (_) {} }
    return d;
  }
  // Confirmación: el MISMO token se reenvía si se corta la señal (mismo operation_id).
  // (Bots 3/4/5 sobre d72b7601) el cuerpo se arma UNA vez y se reenvía IDÉNTICO: en el reintento automático (opts.onRetry: «Reconectando…») y
  // en «Reintentar» (opts.body: el cuerpo guardado por la puerta). Lo escrito NO se vuelve a leer de los campos (quedan bloqueados).
  async function confirmRemote(p, review, opts) {
    var body = opts && opts.body;
    if (!body) { var clean = JSON.parse(JSON.stringify(p)); delete clean.confirm_token; body = { token: p.confirm_token, proposal: clean }; if (review) body.review = review;
      // (Bots 2/5 sobre 84a49517) lo escrito a mano en «Complete este dato» va en «manual», aparte de la propuesta firmada; el servidor lo exige
      var manual = C.fillValues ? C.fillValues(p) : null; if (manual) body.manual = manual; }
    var lastErr;
    // Cada intento se corta a los ~12 s; 2 intentos y después «Sin conexión. Toque Reintentar» (mismo cuerpo, token y operation_id).
    for (var i = 0; i < (C.CONFIRM_ATTEMPTS || 2); i++) {
      try { if (i > 0 && opts && typeof opts.onRetry === 'function') { try { opts.onRetry(); } catch (_) {} }
        var d = await post('/auth/assistant/confirm', body, null, C.TIMEOUTS.confirm);
        // (Bot 3 sobre f773911f) 200 con el cuerpo cortado o roto = corte de red: «Reconectando…» y UN reintento con el MISMO cuerpo (mismo token,
        // propuesta y manual; el servidor contesta 200 replay:true y no guarda nada otra vez). Un 409/403 del reintento se muestra tal cual.
        if (d.bodyError && d.status == null) { var be = new Error('network'); be.bodyError = true; throw be; }
        var out = d.ok ? d : { ok: false, error: d.error, status: d.status, rows: d.rows, fields: Array.isArray(d.fields) ? d.fields : null, retry_after_s: d.retry_after_s, message: typeof d.message === 'string' ? d.message.slice(0, 400) : null,
          confirmed: d.confirmed === true, operation_id: d.operation_id, type: d.type, proposal: d.error === 'already_confirmed_same_session' && d.proposal && typeof d.proposal === 'object' ? d.proposal : undefined };
        try { Object.defineProperty(out, 'sentBody', { value: body, enumerable: false, configurable: true }); } catch (_) {}
        return out; }
      catch (e) { lastErr = e; if (i === 0) await new Promise(function (r) { setTimeout(r, 600); }); }
    }
    var err = lastErr || new Error('network'); try { err.sentBody = body; } catch (_) {} throw err;
  }

  // ---------- Funciones existentes del POS ----------
  // Cálculos EXISTENTES del POS que usan sus pantallas de reportes (el asistente no hace cuentas propias de dinero).
  function reportApi() {
    var V = root.NA_VALORIZACION, D = root.NA_CLIENTES_REPORTE_DEUDA, A = root.NA_REPORTE_ARQUEO, CC = root.NA_CLIENT_CREDIT_ACCOUNTS_V2, canon = root.NuevoAmanecerCanonical;
    var pending = function () { return canon && typeof canon.pendingSnapshot === 'function' ? canon.pendingSnapshot() : null; };
    var catKey = g('_naCategoryKey');
    return {
      valorizacion: V && V.calculate ? function (p) { return V.calculate(p, typeof catKey === 'function' ? { categoryKey: catKey } : {}); } : null,
      totalV: g('totalV'),
      deudaReport: D && D.buildReport && CC ? function () { return D.buildReport(g('clientes') || [], CC, pending(), 'saldo'); } : null,
      summarizeClient: CC && CC.summarizeClient, effectiveBalance: CC && CC.debtFilter && CC.debtFilter.effectiveBalance, pending: pending,
      outstanding: (function (f) { return typeof f === 'function' ? function (c) { return Math.max(0, Number(f(c)) || 0); } : null; })(g('_naCreditOutstanding')),
      // Mismo origen que «Reporte de arqueo»: servidor (/auth/cash-closes) y, si no hay, la copia local de CANON.
      cashCloses: A && A.buildReport ? async function (desde, hasta) {
        var opts = {}; if (desde) opts.desde = desde; if (hasta) opts.hasta = hasta;
        var range = A.buildReport([], opts).range;
        try { if (root.navigator.onLine !== false && root.NA_ROLES && typeof root.NA_ROLES.api === 'function') {
          var r = await root.NA_ROLES.api('/auth/cash-closes?desde=' + encodeURIComponent(range.desde) + '&hasta=' + encodeURIComponent(range.hasta));
          if (r && Array.isArray(r.cash_closes) && r.ready !== false) return { report: A.buildReport(r.cash_closes, range), fromServer: true }; } } catch (_) {}
        return { report: A.buildReport(canon && typeof canon.snapshot === 'function' ? canon.snapshot() : {}, range), fromServer: false };
      } : null
    };
  }
  function mark(i) { i.style.outline = '3px solid #16a34a'; try { i.focus({ preventScroll: true }); } catch (_) {} }
  function g(name) { try { return (0, eval)('typeof ' + name + '!=="undefined"?' + name + ':undefined'); } catch (_) { return undefined; } }
  // (Bot 4 sobre 3ee80c18) valores de documento/RUC: dir="ltr" + unicode-bidi:isolate (clase na-asst-ltr y el estilo en línea, porque «Nueva compra»
  // es del POS y no lleva la hoja del asistente garantizada). «U+202E 1234-100F» ya llega normalizado («1234-100F»); esto cubre lo que trae la propuesta.
  function ltrIsolate(n) { if (!n || !n.setAttribute) return n; n.setAttribute('dir', 'ltr'); if (n.classList) n.classList.add('na-asst-ltr'); else n.className = (n.className ? n.className + ' ' : '') + 'na-asst-ltr';
    if (n.style) { n.style.unicodeBidi = 'isolate'; n.style.direction = 'ltr'; } return n; }
  async function configurationApi() {
    if(!isOwnerAccess()) return null;
    try { if(!root.NA_CONFIG_V9&&root.NA_CONFIG_V9_BOOT) await root.NA_CONFIG_V9_BOOT.load(); } catch (_) { return null; }
    return isOwnerAccess()?root.NA_CONFIG_V9:null;
  }
  var deps = {
    // (#967 teléfono) destino servidor: el confirm ya guardó; se vuelven a leer pos.business, pos.ticket y pos.flags con el lector EXISTENTE
    // de Configuración (config-g.js pullSettings: GET /settings y aplica con los mismos setters), sin recargar la página
    reloadSettings: function () { var G = root.NA_CONFIG_G; return G && typeof G.pullSettings === 'function' ? G.pullSettings() : null; },
    applyConfiguration: async function(p) { var api=await configurationApi(); return api&&api.assistantApply?api.assistantApply(p):{ok:false,msg:'No se pudo cargar Configuración.'}; },
    roles: roles, confirm: confirmRemote, online: function () { return root.navigator.onLine !== false; },
    productos: function () { return g('productos') || []; },
    clientes: function () { var c = g('clientes'); return Array.isArray(c) ? c : []; },
    // proveedores que el aparato conoce (campo proveedor de los productos y movimientos de compra): no se tapan como clientes
    proveedores: function () { var out = {}, put = function (v) { v = typeof v === 'string' ? v.trim() : ''; if (v && v.length <= 120 && v !== 'Sin proveedor registrado') out[v] = 1; };
      var ps = g('productos'), ms = g('inventoryMovements'); if (!Array.isArray(ms)) ms = root.inventoryMovements;
      (Array.isArray(ps) ? ps : []).slice(0, 5000).forEach(function (x) { if (x) { put(x.proveedor); put(x.supplier); } });
      (Array.isArray(ms) ? ms : []).slice(-5000).forEach(function (x) { if (x) { put(x.supplier); put(x.proveedor); } });
      return Object.keys(out).slice(0, 2000); },
    refreshProducts: async function () {
      var client = root.NuevoAmanecerCanonical;
      if (!client || typeof client.refresh !== 'function') throw new Error('catalog_unavailable');
      var pending = typeof client.pendingSnapshot === 'function' ? client.pendingSnapshot() : null;
      if (pending && pending.command === 'product.create') throw new Error('product_pending');
      await client.refresh();
    },
    navigate: function (id) { try { root.NA_MENU_NAVIGATION.navigate(id); } catch (_) { try { root.goPage(id); } catch (__) {} } },
    openPurchase: function () { if (!root.NA_PURCHASES) return null; root.NA_PURCHASES.open(); return doc.getElementById('naPurchaseDialog'); },
    fillPurchase: function (w, p) {
      w.dataset.naAsst = '1'; // prellenada desde una tarjeta del asistente (ver roleLost: se vacía y se cierra si el rol cambia antes de guardar)
      var s = w.querySelector('#naPurSupplier'), d = w.querySelector('#naPurDoc');
      // nunca una máscara: lo escrito a mano en la tarjeta o el valor exacto del servidor (Bot 2 sobre 6280deae)
      var pv = C.purchaseValue(p, 'proveedor'), dv = C.purchaseValue(p, 'documento'); if (s && pv) s.value = pv; if (d && dv) d.value = dv;
      // (Bot 4 sobre 3ee80c18) documento y proveedor (lleva el RUC) aislados de izquierda a derecha: un control de dirección no da vuelta la serie
      [s, d].forEach(function (n) { if (!n) return; n.setAttribute('dir', 'ltr'); n.className = (n.className ? n.className + ' ' : '') + 'na-asst-ltr'; if (n.style) { n.style.unicodeBidi = 'isolate'; n.style.direction = 'ltr'; } });
      var add = w.querySelector('.na-pur-add');
      p.lineas.forEach(function (l, i) {
        if (i > 0 && add) add.click();
        var row = w.querySelectorAll('.na-pur-line')[i]; if (!row) return;
        var prod = l.product_id && deps.productos().find(function (x) { return String(x.id) === String(l.product_id); });
        // (Bot 5 sobre d72b7601) sin el producto en el catálogo local, el nombre de la propuesta puede venir tapado: nunca se escribe una
        // máscara; el campo queda vacío y marcado para completar
        var pin = row.querySelector('.na-pur-prod'), nm = prod ? (prod.nombre || prod.name) : (l.nombre && !C.maskLeft(l.nombre) ? l.nombre : '');
        pin.value = nm;
        if (!prod && !nm) { pin.placeholder = 'Complete el producto'; pin.setAttribute('aria-invalid', 'true'); pin.dataset.naNeed = '1'; }
        row.querySelector('.na-pur-qty').value = l.cantidad;
        if (l.costo_unitario != null) row.querySelector('.na-pur-cost').value = l.costo_unitario;
        if (!prod) { row.querySelector('.na-pur-prod').style.outline = '3px solid #f59e0b'; purchaseProductButton(w, row); }
      });
      w.dispatchEvent(new Event('input', { bubbles: true }));
    },
    // Ficha EXISTENTE del producto (editProd) con el campo prellenado. Guarda la persona con «Guardar» (product.update con PIN).
    openProductEditor: function (id, v) {
      var f = g('editProd'); if (typeof f !== 'function') return;
      f(id); var i = doc.getElementById(v.costo != null ? 'pCosto' : 'pPrecio'); if (!i) return;
      i.value = Number(v.costo != null ? v.costo : v.precio).toFixed(2); i.dispatchEvent(new Event('input', { bubbles: true })); mark(i);
    },
    // Ventana EXISTENTE «Registrar movimiento» (abrirMovInv). Guarda la persona (inventory.adjust con PIN).
    // Antes de confirmar: ¿el POS puede abrir «Registrar movimiento» aquí? Devuelve el motivo o null.
    stockMoveReady: function () {
      if (typeof g('abrirMovInv') !== 'function') return 'Este aparato no tiene la pantalla «Registrar movimiento». Ábrela desde Inventario.';
      if (!doc.getElementById('mMovInv')) return 'La ventana «Registrar movimiento» no está cargada. Recarga la página e inténtalo otra vez.';
      return null;
    },
    openStockMove: function (id, tipo, cantidad, motivo) {
      var f = g('abrirMovInv'); if (typeof f !== 'function') return 'Este aparato no tiene la pantalla «Registrar movimiento». Ábrela desde Inventario.';
      f(id, tipo); var m = doc.getElementById('mMovInv'); if (!m) return 'La ventana «Registrar movimiento» no está cargada. Recarga la página e inténtalo otra vez.';
      var b = m.querySelector('.mov-type-btn[data-type="' + tipo + '"]'), st = g('setMovType'); if (b && typeof st === 'function') st(b, tipo);
      var q = doc.getElementById('mMovCant'); if (q) { q.value = cantidad; q.dispatchEvent(new Event('input', { bubbles: true })); mark(q); }
      var r = doc.getElementById('mMovMotivo'); if (r && motivo) { Array.prototype.forEach.call(r.options, function (o) { if (o.text === motivo || o.value === motivo) r.value = o.value; }); mark(r); }
      return m.classList.contains('open') ? true : 'El POS no abrió «Registrar movimiento» (puede que el producto no controle inventario). Revisa la ficha del producto.';
    },
    // Formulario EXISTENTE «Nuevo producto» (abrirModalProd). Guarda la persona (product.create).
    openNewProduct: function (p) {
      var f = g('abrirModalProd'); if (typeof f !== 'function') return false;
      f(); var m = doc.getElementById('mProd'); if (!m) return false;
      function set(id, v) { var i = doc.getElementById(id); if (!i || v == null || v === '') return; if (i.tagName === 'SELECT' && !Array.prototype.some.call(i.options, function (o) { return o.value === String(v); })) return; i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); mark(i); }
      set('pNombre', p.nombre); set('pPrecio', p.precio != null ? Number(p.precio).toFixed(2) : null); set('pCosto', p.costo != null ? Number(p.costo).toFixed(2) : null);
      set('pStock', p.stock_inicial); set('pStockMin', p.stock_minimo); set('pBarcode', p.codigo_barras); set('pCat', p.categoria); set('pUnidad', p.unidad);
      return m.classList.contains('open');
    },
    // Datos que el POS ya tiene en este aparato (para documentos locales, solo lectura).
    data: function () { return { productos: g('productos') || [], ventas: g('ventas') || [], clientes: g('clientes') || [], api: reportApi() }; },
    showDocument: function (html) {
      var o = doc.createElement('div'); o.className = 'na-asst-doc'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true');
      o.innerHTML = '<div><iframe title="Vista previa del documento"></iframe><div class="acts"><button type="button" class="na-asst-no">Cerrar</button><button type="button" class="na-asst-ok">Imprimir / Guardar PDF</button></div></div>';
      o.querySelector('iframe').srcdoc = html; doc.body.appendChild(o);
      o.querySelector('.na-asst-no').onclick = function () { o.remove(); };
      o.querySelector('.na-asst-ok').onclick = function () { try { o.querySelector('iframe').contentWindow.print(); } catch (_) {} };
    },
    businessName: function () { return C.businessName ? C.businessName(g('appConfig')) : 'Nuevo Amanecer'; } // nombre del negocio de Configuración
  };
  // Conserva el borrador de compra mientras se guarda la ficha normal del producto.
  // No llama comandos ni suma stock: Nuevo producto y Registrar compra mantienen sus permisos.
  function purchaseProductButton(w, row) {
    var box = el('div', 'na-asst-purchase-product'), button = el('button', 'na-asst-ok'), note = el('small', 'na-asst-note');
    box.style.gridColumn = '1 / -1'; button.type = 'button'; button.textContent = 'Crear o vincular producto';
    note.textContent = 'Busca uno existente o crea su ficha. El stock se sumará al registrar la compra.';
    box.appendChild(button); box.appendChild(note); row.appendChild(box);
    button.addEventListener('click', async function () {
      if (!isOwnerAccess()) { note.textContent = 'Vuelve a entrar como Admin.'; return; }
      button.disabled = true;
      try { await deps.refreshProducts(); }
      catch (_) { button.disabled = false; note.textContent = 'No pude verificar el catálogo o hay un producto pendiente. No repitas el guardado; revisa Inventario y vuelve a intentar.'; return; }
      button.disabled = false;
      if (!isOwnerAccess() || !w.parentNode) return;
      var pin = row.querySelector('.na-pur-prod'), cost = row.querySelector('.na-pur-cost').value;
      var draft = C.purchaseProductDraft({ nombre: pin.value, costo_unitario: cost === '' ? null : Number(cost) }, deps.productos());
      if (!draft || draft.ambiguous) { note.textContent = 'Revisa el nombre y selecciona la presentación correcta en el catálogo.'; return; }
      if (draft.product_id) { pin.value = draft.nombre; pin.style.outline = ''; note.textContent = 'Producto existente vinculado. Revisa cantidad y costo.'; w.dispatchEvent(new Event('input', { bubbles: true })); return; }
      var display = w.style.display; w.style.display = 'none';
      if (!deps.openNewProduct(draft)) { w.style.display = display; note.textContent = 'No se pudo abrir Nuevo producto. Revisa el catálogo.'; return; }
      var modal = doc.getElementById('mProd');
      note.textContent = 'Completa el precio de venta y guarda la ficha con stock inicial cero.';
      var observer = new root.MutationObserver(async function () {
        if (modal.classList.contains('open')) return;
        observer.disconnect();
        if (!w.parentNode || !isOwnerAccess()) return;
        w.style.display = display; button.disabled = true;
        try { await deps.refreshProducts(); }
        catch (_) { note.textContent = 'No pude comprobar el producto guardado. No lo crees otra vez; revisa Inventario y vuelve a intentar.'; button.disabled = false; return; }
        button.disabled = false;
        if (!isOwnerAccess() || !w.parentNode) return;
        var name = doc.getElementById('pNombre'), linked = C.purchaseProductDraft({ nombre: name ? name.value : draft.nombre }, deps.productos());
        if (linked && linked.product_id) { pin.value = linked.nombre; pin.style.outline = ''; note.textContent = 'Producto vinculado. Revisa la compra antes de registrarla.'; }
        else note.textContent = 'No se encontró una ficha guardada para vincular. Revisa el catálogo y los datos antes de continuar.';
        w.dispatchEvent(new Event('input', { bubbles: true }));
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
  }

  var gate = C.createGate(deps);

  // ---------- Panel ----------
  var rootEl, tagEl, panelEl, msgsEl, inputEl, sendBtn, photoBtn, fileEl, offEl, newBtn, liveEl;
  function el(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function scrollEnd() { msgsEl.scrollTop = msgsEl.scrollHeight; if (newBtn) newBtn.hidden = true; }
  // Respuesta en partes (Bot 4): solo se baja sola si la persona ya estaba abajo; si subió a leer, queda donde está y sale «Ver nuevo».
  function atBottom() { return !msgsEl || msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight <= 24; }
  // ¿la nota de corte está a la vista en la lista? Entonces «Ver nuevo ↓» (sticky abajo) no se muestra: la taparía.
  function noteSeen() { if (!cutNote || !msgsEl || !cutNote.isConnected) return false; var r = cutNote.getBoundingClientRect(), m = msgsEl.getBoundingClientRect(); return r.bottom > m.top && r.top < m.bottom; }
  // (Bot 4 sobre f773911f, 412×760) tarjeta que se está confirmando: su estado («Guardando…», «Reconectando…», «Sin conexión…») se trae a la
  // vista dentro de la lista (solo se mueve la lista del asistente, nunca la página) y «Ver nuevo ↓» no sale mientras esa tarjeta se ve (la taparía).
  var liveCard = null;
  function inView(n) { if (!n || !msgsEl || !n.isConnected) return false; var r = n.getBoundingClientRect(), m = msgsEl.getBoundingClientRect(); return r.bottom > m.top && r.top < m.bottom; }
  function revealCard(c, nodes) {
    if (!msgsEl || !c || !c.isConnected) return; liveCard = c; if (newBtn) newBtn.hidden = true;
    var m = msgsEl.getBoundingClientRect(), top = Infinity, bot = -Infinity;
    (nodes || [c]).forEach(function (n) { if (!n || !n.isConnected || n.hidden) return; var r = n.getBoundingClientRect(); if (r.top < top) top = r.top; if (r.bottom > bot) bot = r.bottom; });
    if (bot === -Infinity) return;
    if (bot > m.bottom - 8) msgsEl.scrollTop += Math.min(bot - m.bottom + 8, Math.max(0, top - m.top - 8)); // abajo: sube lo justo, sin esconder el arriba de lo que se muestra
    else if (top < m.top + 8) msgsEl.scrollTop -= m.top + 8 - top;
  }
  function showNew() { if (!newBtn || !msgsEl || noteSeen() || (liveCard && inView(liveCard))) return; msgsEl.appendChild(newBtn); newBtn.hidden = false; } // siempre al final de la lista (sticky abajo)
  function follow(stick) { if (stick) scrollEnd(); else showNew(); }
  // Lector de pantalla: la respuesta se anuncia UNA vez, completa, al final (la lista de mensajes no es aria-live: no lee trozo por trozo).
  // liveT: el aviso pendiente (30 ms); «Nueva conversación» lo cancela y vacía la región (está recortada, no display:none: sigue en innerText).
  var liveT = 0;
  function announce(t) { if (!liveEl) return; clearTimeout(liveT); liveEl.textContent = ''; var v = String(t || ''); liveT = setTimeout(function () { liveT = 0; if (liveEl) liveEl.textContent = v; }, 30); }
  function unannounce() { clearTimeout(liveT); liveT = 0; if (liveEl) liveEl.textContent = ''; }
  function addMsg(kind, text, img) { var m = el('div', 'na-asst-msg ' + kind); if (kind === 'a') paintReply(m, text); else m.textContent = text; if (img) { var i = el('img'); i.src = img; i.alt = 'Foto enviada'; m.appendChild(i); } msgsEl.appendChild(m); scrollEnd(); return m; }
  // Respuesta del asistente: tablas «| … |» con «|---|» como tabla (a 480 px o menos, una ficha por fila). Solo createElement/textContent.
  function paintReply(m, t, opts) { m.textContent = ''; if (m.classList) m.classList.remove('na-asst-wide'); var r = C.createReplyRenderer(doc, function (n) { if (n.className === 'na-asst-tbl') m.classList.add('na-asst-wide'); m.appendChild(n); }, opts); r.push(String(t == null ? '' : t)); r.finish(); m._md = r; }
  // Aviso de corte (Bots 4/5): SOLO si el servidor lo marcó (final.cut === true). El aviso es la última línea que puso el servidor; el resto se
  // pinta igual que siempre. Nunca se busca el texto del aviso: un «aviso» escrito por el modelo, sin la marca, sale como texto normal.
  function paintCut(m, t, opts) { t = String(t == null ? '' : t); var k = t.lastIndexOf('\n'); paintReply(m, k < 0 ? '' : t.slice(0, k).replace(/\n+$/, ''), opts);
    var n = el('p', 'na-asst-note'); n.textContent = k < 0 ? t : t.slice(k + 1); m.appendChild(n); cutNote = n; }
  function soles(n) { return C.soles(n); }
  // Nombre del cliente en la tarjeta: solo en documentos de UN cliente (estado de cuenta), con su etiqueta. En la lista de precios, nunca.
  var CUSTOMER_DOCS = ['estado_cuenta'];
  // (auditoría de privacidad 2026-10-22) la tarjeta trae solo el código (cliente_id); el nombre se busca en la lista de ESTE aparato.
  function cliLabel(code) { var c = null; try { c = deps.clientes().find(function (x) { return String(x.id) === String(code); }); } catch (_) { c = null; }
    var n = c && String(c.nombre || c.name || '').trim(); return n ? n.slice(0, 80) : 'cliente #' + code; }
  // (Bot 2 sobre d72b7601, INFO) en la tarjeta, una línea con product_id del catálogo local muestra el nombre del catálogo, no el de la propuesta
  // (que puede venir tapado: «Leche DNI ****5678»); sin el producto en el catálogo, el de la propuesta tal cual.
  function lineName(l) { var prod = null; try { prod = l && l.product_id && deps.productos().find(function (x) { return String(x.id) === String(l.product_id); }); } catch (_) { prod = null; }
    var n = prod && (prod.nombre || prod.name); return n ? n : (l ? l.nombre : ''); }
  // cuántas filas hay en total: en deudas es «clientes» y en ventas no hay cuenta («total» es plata: antes salía «Mostrando 10 de 22057.72»)
  // Solo donde «total» ES una cuenta de filas (bajo stock, sin costo); en caja, compras o ventas es plata (salía «Mostrando 1 de 20»).
  function qCount(r) { var n = r.tipo === 'deudas_clientes' ? r.clientes : r.tipo === 'bajo_stock' || r.tipo === 'sin_costo' || r.tipo === 'creditos_atrasados' ? r.total : null; return typeof n === 'number' && Number.isInteger(n) ? n : null; }
  // (fix/asist-compras-borrador) fila final con el total de la compra; si alguna fila no trae costo, se avisa cuántas.
  function totalRow(t) {
    if (!t || t.filas.length === t.sinCosto) return '';
    return '<tr class="tot"><td><b>Total de la compra</b>' + (t.sinCosto ? '<div class="note" data-sincosto>' + (t.sinCosto === 1 ? '1 fila sin costo' : t.sinCosto + ' filas sin costo') + '</div>' : '') +
      '</td><td></td><td class="r"><b data-total>' + soles(t.total) + '</b></td></tr>';
  }
  // (fix/asist-fila-mixta-tarjeta) fila sin cantidad (mixta «2 cajas y 3 sueltos»: «Falta cuántas trae la caja»): no hay «×» que mostrar
  // ni se puede aceptar tal cual (Nueva compra y POST /auth/purchases la rechazan: invalid_line); solo se quita.
  function noQty(l) { return !!l && (l.cantidad == null || l.cantidad === ''); }
  // Su aviso (el mismo en la tarjeta y en el 422 de markRows): lo que dice «revisar» (p. ej. «Falta cuántas trae la caja») y qué hacer.
  function noQtyNotice(l) { var why = l.revisar && l.revisar.length ? l.revisar.map(function (k) { return REVIEW_TEXT[k] || k; }).join(', ') : 'Falta la cantidad';
    return 'Revisa este dato: ' + why + '. Quita la fila y regístrala en «Nueva compra» con la cantidad.'; }
  function cardHtml(p) {
    var E = C.esc, rows = '';
    if (p.type === 'pasos') return '<h4>' + E(p.title) + '</h4><ol>' + p.pasos.map(function (s) { return '<li>' + E(s) + '</li>'; }).join('') + '</ol>' +
      (p.pantalla ? '<div class="acts"><button type="button" class="na-asst-ok" data-go>Llévame ahí</button></div>' : '');
    if (p.type === 'consulta') {
      var r = p.result || {};
      return '<h4>' + E(r.titulo || 'Consulta') + '<span class="pill ro">Solo lectura</span></h4>' + (r.error ? '<div class="warn">' + E(r.texto) + '</div>' :
        !(r.filas && r.filas.length) ? '<div class="note na-asst-empty">Sin datos.</div>' : // tabla vacía: sin cabecera suelta
        '<table class="q">' + (r.columnas && r.columnas.length ? '<tr>' + r.columnas.map(function (c, i) { return '<th' + (i ? ' class="r"' : '') + '>' + E(c) + '</th>'; }).join('') + '</tr>' : '') +
        (r.filas || []).map(function (f) { return '<tr>' + f.map(function (c, i) { return '<td' + (i ? ' class="r"' : '') + '>' + E(typeof c === 'number' && !Number.isInteger(c) ? c.toFixed(2) : c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>' +
        (r.truncado ? '<div class="warn">Ojo: solo se leyó una parte de los datos. Las cantidades pueden quedar cortas.</div>' : '') +
        (qCount(r) != null && r.filas && r.filas.length < qCount(r) ? '<div class="note">Mostrando ' + r.filas.length + ' de ' + E(qCount(r)) + '.</div>' : '')) +
        '<div class="note">Datos leídos del servidor. No cambia nada.</div>';
    }
    if (p.type === 'documento') return '<h4>' + E(p.title) + '<span class="pill ro">Solo lectura</span></h4>' +
      '<div class="note">' + E([p.desde, p.hasta && p.hasta !== p.desde ? p.hasta : null].filter(Boolean).join(' a ') + (p.cliente_id && CUSTOMER_DOCS.indexOf(p.tipo) >= 0 ? ' · Cliente: ' + cliLabel(p.cliente_id) : '')) + '</div>' +
      '<div class="warn doc">Documento interno. NO es comprobante SUNAT.</div>' +
      '<div class="res" aria-live="polite"></div><div class="acts"><button type="button" class="na-asst-ok" data-open>Abrir documento</button></div>';
    var tot = p.type === 'compra' ? C.purchaseTotals(p) : null;
    if (p.type === 'compra') rows = '<tr><th>Producto</th><th class="r">Costo actual</th><th class="r">Factura</th></tr>' + p.lineas.map(function (l, i) {
      var flag = l.revisar && l.revisar.length;
      var why = flag ? l.revisar.map(function (k) { return REVIEW_TEXT[k] || k; }).join(', ') : '';
      var diff = l.costo_actual != null && l.costo_unitario != null && Math.abs(l.costo_unitario - l.costo_actual) > Math.max(0.01, l.costo_actual * 0.01);
      return '<tr' + (flag ? ' class="flag" data-row="' + i + '"' : '') + '><td>' + (noQty(l) ? '<b class="nr">Falta la cantidad</b> · ' : E(l.cantidad) + ' × ') + E(lineName(l)) + (l.product_id ? '' : ' <b class="nr">(no registrado)</b>') +
        (l.limite && l.limite.length ? '<div class="flag-t">Fuera del límite: ' + E(why) + '. Corrige la factura o quita la fila.</div><div class="flag-a"><button type="button" data-drop="' + i + '">Quitar fila</button></div>'
          : flag ? '<div class="flag-t">' + E(noQty(l) ? noQtyNotice(l) : 'Revisa este dato: ' + why) + '</div><div class="flag-a">' + (noQty(l) ? '' : '<button type="button" data-accept="' + i + '">Está bien</button>') + '<button type="button" data-drop="' + i + '">Quitar fila</button></div>' : '') +
        '</td><td class="r">' + (l.costo_actual != null ? soles(l.costo_actual) : '-') + '</td><td class="r' + (diff ? ' chg' : '') + '">' + (l.costo_unitario != null ? soles(l.costo_unitario) : '-') +
        (tot.filas[i] != null ? '<div class="lt" data-lt="' + i + '">Total ' + soles(tot.filas[i]) + '</div>' : '') + '</td></tr>'; }).join('') + totalRow(tot);
    // RUC tapado: sin valor en la tarjeta; se escribe en el campo de abajo (needFields)
    var cfgVal = function (v) { return typeof v==='boolean'?(v?'Activado':'Desactivado'):v; }, rucNeed = C.isRucCard && C.isRucCard(p) && C.fillValues && (Array.isArray(p.completar) || Array.isArray(p.needFields));
    if (p.type === 'configuracion') rows = '<tr><td>'+E(p.nombre)+'<div class="note">'+E(p.alcance)+'</div></td><td>'+E(cfgVal(p.antes))+' → <b>'+(rucNeed?'Escríbalo abajo':E(cfgVal(p.valor)))+'</b></td></tr>';
    if (p.type === 'precio') rows = '<tr><td>' + E(p.nombre) + '</td><td class="r">' + soles(p.precio_actual) + ' → <b>' + soles(p.precio_nuevo) + '</b></td></tr>';
    if (p.type === 'costo') rows = '<tr><td>' + E(p.nombre) + '<div class="note">Costo</div></td><td class="r">' + (p.costo_actual != null ? soles(p.costo_actual) : 'sin costo') + ' → <b>' + soles(p.costo_nuevo) + '</b></td></tr>';
    if (p.type === 'ajuste') rows = '<tr><td>' + E(p.nombre) + '<div class="note">' + E(p.motivo) + '</div></td><td class="r">' + (p.tipo === 'entrada' ? '+' : '−') + E(p.cantidad) + '</td></tr>' +
      (p.stock_actual != null ? '<tr><td>Stock</td><td class="r">' + E(p.stock_actual) + ' → <b>' + E(p.stock_despues) + '</b></td></tr>' : '');
    if (p.type === 'producto') rows = [['Nombre', E(p.nombre)], ['Precio', soles(p.precio)], ['Costo', p.costo != null ? soles(p.costo) : '-'], ['Stock inicial', p.stock_inicial != null ? E(p.stock_inicial) : '-'],
      ['Stock mínimo', p.stock_minimo != null ? E(p.stock_minimo) : '-'], ['Categoría', E(p.categoria || '-')], ['Código', E(p.codigo_barras || '-')]].map(function (r) { return '<tr><td>' + r[0] + '</td><td class="r">' + r[1] + '</td></tr>'; }).join('');
    var warn = '';
    if (p.type === 'compra' && p.fueraDeLimite) warn += '<div class="warn">' + (p.fueraDeLimite === 1 ? '1 fila pasa el límite: corrígela en la factura o quítala.' : p.fueraDeLimite + ' filas pasan el límite: corrígelas en la factura o quítalas.') + '</div>';
    if (p.type === 'compra' && p.omitidas && p.omitidas.length) warn += '<div class="warn">No se incluyó porque no lleva control de stock: ' + p.omitidas.map(function (o) { return E(o.nombre); }).join(', ') + '.</div>';
    if (p.type === 'compra' && p.sinProducto) warn += '<div class="warn">' + (p.sinProducto === 1 ? '1 línea no tiene producto registrado: revísala.' : p.sinProducto + ' líneas no tienen producto registrado: revísalas.') + '</div>';
    if (p.type === 'precio' && p.quisoDecir != null) warn += '<div class="warn">¿Quiso decir ' + soles(p.quisoDecir) + '? Si es así, no confirmes y escribe el precio con punto.</div>';
    else if (p.type === 'precio' && p.cambioGrande) warn += '<div class="warn">Cambio grande (más de 50%). Revisa bien.</div>';
    if ((p.type === 'precio' || p.type === 'producto') && p.bajoCosto) warn += '<div class="warn">El precio queda por debajo del costo.</div>';
    if (p.type === 'ajuste' && p.quedaNegativo) warn += '<div class="warn">El stock quedaría negativo. Revisa la cantidad.</div>';
    if (p.type === 'ajuste' && p.grande) warn += '<div class="warn">Cantidad muy grande. Revisa bien.</div>';
    if (p.type === 'producto' && p.parecidos && p.parecidos.length) warn += '<div class="warn">Ya hay productos parecidos: ' + E(p.parecidos.join(', ')) + '.</div>';
    if (p.type === 'producto' && p.revisar) warn += '<div class="warn">Precio o costo fuera de lo normal. Revisa bien.</div>';
    var note = { compra: 'Al confirmar, se abre «Nueva compra» llena. El stock sube solo cuando pulses «Registrar compra». Al registrar la compra, el costo de cada producto se actualiza con el de la compra.',
      configuracion: p.destino==='servidor'?'Al confirmar se guarda en el servidor. Afecta a toda la tienda.':'Al confirmar se aplica este ajuste. '+(p.alcance==='todos los aparatos'?'Afecta a toda la tienda.':'Solo cambia este aparato.'),
      precio: 'Al confirmar, se abre la ficha del producto con el precio nuevo. Se aplica cuando pulses Guardar.', costo: 'Al confirmar, se abre la ficha del producto con el costo ' + (p.deChat ? 'nuevo' : 'de la factura') + '. Se aplica cuando pulses Guardar.' + (p.origen ? ' (' + p.origen + ')' : ''),
      ajuste: 'Al confirmar, se abre «Registrar movimiento» lleno. El stock cambia solo cuando pulses Guardar.', producto: 'Al confirmar, se abre «Nuevo producto» lleno. Se crea solo cuando pulses Guardar.' }[p.type];
    // (Bot 2 sobre 58200f60) proveedor · documento · fecha: se llena en addCard con textContent, la serie en su span que no se parte
    var head = p.type === 'compra' && (p.proveedor || p.documento) ? '<div class="note" data-docnote></div>' : '';
    return '<h4>' + E(p.title) + (C.isServerConfig && C.isServerConfig(p) ? '<span class="pill">Toda la tienda</span>' : '<span class="pill">Solo Admin</span>') + '</h4>' + head + '<table>' + rows + '</table>' + warn + '<div class="note">' + E(note) + '</div>' +
      '<div class="meta"><span>Vence en <b data-left>5:00</b></span><span>Se usa una sola vez</span></div>' +
      '<div class="res" aria-live="polite"></div>' +
      '<div class="acts"><button type="button" class="na-asst-ok" data-ok>Confirmar</button><button type="button" class="na-asst-no" data-no>Cancelar</button>' +
      '<button type="button" class="na-asst-again" data-again hidden>Pedir de nuevo</button></div>';
  }
  var APPROVAL = { precio: 'product.update', costo: 'product.update', compra: 'inventory.adjust', ajuste: 'inventory.adjust', producto: 'product.create' };
  var REVIEW_TEXT = { cantidad: 'cantidad fuera de lo normal', costo: 'costo por unidad fuera de lo normal', total: 'total de la fila muy alto', costo_raro: 'costo muy distinto al de tu inventario' };
  function tokenData(p) { try { var b = String(p.confirm_token || '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(b)) || {}; } catch (_) { return {}; } }
  function tokenExp(p) { return tokenData(p).exp || 0; }
  function tokenOp(p) { var op = tokenData(p).op; return typeof op === 'string' ? op : null; }
  function addDenied(d) { var c = el('div', 'na-asst-card denied'); c.innerHTML = '<h4>No permitido</h4><div>' + C.esc(C.looksTechnical(d.message) ? C.friendlyError('forbidden_role').msg : d.message) + '</div><div class="note">El asistente no puede hacerlo por ti. Pídeselo al Admin.</div>'; msgsEl.appendChild(c); scrollEnd(); }
  // Firma de una tarjeta de solo lectura (consulta, pasos, documento): la MISMA tabla de una respuesta anterior no se repite debajo de esta.
  function cardSig(p) { if (!p || p.confirm_token || (p.type !== 'consulta' && p.type !== 'pasos' && p.type !== 'documento')) return null;
    try { return p.type + ':' + JSON.stringify(p.type === 'consulta' ? [p.result && p.result.tipo, p.result && p.result.titulo, p.result && p.result.columnas, p.result && p.result.filas, p.result && p.result.texto] : p.type === 'pasos' ? [p.title, p.pasos] : [p.tipo, p.title, p.desde, p.hasta, p.cliente_id]); } catch (_) { return null; } }
  var cardAnchor = null;
  function addCard(p, prompt, after) {
    after = after || cardAnchor;
    var sig = cardSig(p); if (sig && shownSigs[sig] != null && shownSigs[sig] !== turnNo) return null; // ya está más arriba, igual
    var key = gate.add(p); if (!key) return null;
    if (msgsEl.querySelectorAll) { var dup = [].slice.call(msgsEl.querySelectorAll('.na-asst-card')).some(function (x) { return x._naKey === key; }); if (dup) return null; } // la misma propuesta: una sola tarjeta
    if (sig) shownSigs[sig] = turnNo;
    var c = el('div', 'na-asst-card', cardHtml(p)); c.dataset.type = p.type; c.dataset.st = 'pending'; c._naKey = key;
    // la tarjeta va con SU respuesta (debajo de la burbuja de este turno), nunca al final de una respuesta posterior
    if (after && after.parentNode === msgsEl && after.nextSibling) msgsEl.insertBefore(c, after.nextSibling); else msgsEl.appendChild(c);
    if (cardAnchor) cardAnchor = c;
    // tabla de consulta: el servidor manda «cliente #código»; al ADMIN se le muestra el nombre de la lista de ESTE aparato (decisión del Admin
    // 22-10), al empleado solo el código. El nombre nunca va al modelo.
    var qt = p.type === 'consulta' && C.customerCodesIn && isOwnerAccess() ? c.querySelector('table.q') : null; if (qt) linkCustomers(qt, C.customerCodesIn(qt.textContent, deps.clientes()));
    // (Bot 4 sobre 3ee80c18) cada valor en su span; proveedor (RUC) y documento aislados de izquierda a derecha
    var dn = c.querySelector('[data-docnote]'); if (dn) [[p.proveedor, true], [p.documento, true], [p.fecha, false]].filter(function (x) { return x[0]; }).forEach(function (x, i) {
      if (i) dn.appendChild(doc.createTextNode(' · ')); var sp = doc.createElement('span'); if (x[1]) ltrIsolate(sp); C.appendCoded(doc, sp, String(x[0])); dn.appendChild(sp); });
    var res = c.querySelector('.res');
    var go = c.querySelector('[data-go]'); if (go) go.onclick = function () { gate.execute(key, { confirmed: true }).then(function () { closePanel(); }); };
    // Documento local (solo lectura): se puede abrir varias veces, sin servidor ni PIN.
    var op = c.querySelector('[data-open]'); if (op) op.onclick = function () { var perm = C.canExecute(roles(), p); if (!perm.ok) { c.querySelector('.res').textContent = perm.msg; return; } op.disabled = true; Promise.resolve(C.EXECUTORS.documento(p, deps)).then(function (r) { c.querySelector('.res').textContent = r.msg; }, function () { c.querySelector('.res').textContent = 'No se pudo armar el documento.'; }).then(function () { op.disabled = false; }); };
    var no = c.querySelector('[data-no]'); if (no) no.onclick = function () { gate.cancel(key, 'cancelada'); c.dataset.st = 'cancelled'; res.textContent = 'Cancelado. No se hizo nada.'; };
    var ok = c.querySelector('[data-ok]'), left = c.querySelector('[data-left]');
    var exp = tokenExp(p), timer = null;
    // Filas «Revisa este dato»: Confirmar queda apagado hasta aceptar o quitar cada una (el servidor exige lo mismo).
    var decided = {};
    // fila quitada: el total de la compra deja de contarla
    function syncTotal() { if (p.type !== 'compra') return; var b = c.querySelector('[data-total]'); if (!b) return;
      var t = C.purchaseTotals({ lineas: p.lineas.filter(function (_, i) { return decided[i] !== 'drop'; }) }); b.textContent = soles(t.total);
      var n = c.querySelector('[data-sincosto]'); if (n) n.textContent = t.sinCosto ? (t.sinCosto === 1 ? '1 fila sin costo' : t.sinCosto + ' filas sin costo') : ''; }
    function pendingRows() { return Array.prototype.filter.call(c.querySelectorAll('tr.flag'), function (tr) { return !decided[tr.dataset.row]; }).length; }
    function review() { if (p.type !== 'compra') return null; var a = [], d = []; Object.keys(decided).forEach(function (k) { (decided[k] === 'drop' ? d : a).push(Number(k)); }); return { op: tokenOp(p), accept: a, drop: d }; }
    // (Bot 2 sobre 6280deae) campos vacíos de la tarjeta de compra: Confirmar apagado hasta llenarlos
    var need = C.needFields(doc, p, function () { syncOk(); }); c._naNeed = need; c._naP = p; // roleLost vacía TODAS las tarjetas
    if (need) { Object.defineProperty(p, '_manual', { value: need.state, enumerable: false, configurable: true }); var tb = c.querySelector('table'); c.insertBefore(need.el, tb || c.firstChild); }
    if (need && need.inputs) need.inputs.forEach(function (i) { ltrIsolate(i); }); // (Bot 4 sobre 3ee80c18) lo escrito en documento/proveedor, de izquierda a derecha
    function lockFields(on) { if (need && need.inputs) need.inputs.forEach(function (i) { i.disabled = !!on; i.readOnly = !!on; }); Array.prototype.forEach.call(c.querySelectorAll('tr.flag button'), function (b) { b.disabled = !!on; }); c.dataset.locked = on ? '1' : ''; }
    function syncOk() { if (!ok || c.dataset.st !== 'pending' || c.dataset.locked === '1') return; var n = pendingRows(), miss = need ? need.missing() : 0; ok.disabled = n > 0 || miss > 0;
      ok.textContent = miss > 0 ? 'Complete ' + miss + (miss === 1 ? ' dato' : ' datos') : n > 0 ? 'Revisa ' + n + (n === 1 ? ' fila' : ' filas') : (c.dataset.btn || 'Confirmar'); }
    var again = c.querySelector('[data-again]');
    // 422: el servidor dice qué filas faltan revisar; se marcan en rojo «Revisa este dato» (aunque el celular no las hubiera marcado).
    function markRows(idx, limit) {
      var trs = c.querySelectorAll('table tr');
      idx.forEach(function (i) {
        var tr = c.querySelector('tr[data-row="' + i + '"]') || trs[i + 1]; if (!tr) return;
        tr.classList.add('flag'); tr.dataset.row = String(i); tr.removeAttribute('data-decision'); delete decided[i];
        var td = tr.querySelector('td'); if (!td) return;
        var t = tr.querySelector('.flag-t'); if (!t) { t = el('div', 'flag-t'); td.appendChild(t); }
        var line = p.lineas && p.lineas[i], missing = noQty(line); // fila sin cantidad: conserva su propio aviso, no el «Revisa este dato» genérico
        t.textContent = limit ? 'Fuera del límite: quita la fila o corrige la factura' : missing ? noQtyNotice(line) : 'Revisa este dato';
        var a = tr.querySelector('.flag-a'); if (!a) { a = el('div', 'flag-a'); td.appendChild(a); }
        a.innerHTML = (limit || missing ? '' : '<button type="button" data-accept="' + i + '">Está bien</button>') + '<button type="button" data-drop="' + i + '">Quitar fila</button>';
      });
    }
    // «Pedir de nuevo»: deja esta tarjeta y pide una NUEVA (token y operation_id nuevos).
    if (again) again.onclick = function () {
      if (!prompt) { res.textContent = 'Escribe otra vez lo que necesitas.'; return; }
      gate.cancel(key); c.dataset.st = 'cancelled';
      [ok, no, again].forEach(function (b) { if (b) b.disabled = true; }); if (ok) ok.textContent = 'Reemplazada';
      res.textContent = 'Pidiendo una tarjeta nueva…'; send(prompt);
    };
    c.addEventListener('click', function (e) {
      var b = e.target.closest('[data-accept],[data-drop]'); if (!b || c.dataset.st !== 'pending') return;
      var i = b.getAttribute('data-accept') != null ? b.getAttribute('data-accept') : b.getAttribute('data-drop'), tr = c.querySelector('tr[data-row="' + i + '"]');
      decided[i] = b.hasAttribute('data-drop') ? 'drop' : 'accept';
      if (tr) { tr.dataset.decision = decided[i]; var t = tr.querySelector('.flag-t'); if (t) t.textContent = decided[i] === 'drop' ? 'Fila quitada: no se agregará.' : 'Revisado: lo aceptaste.'; }
      syncTotal(); syncOk();
    });
    // Vencida (por la hora o porque el servidor dijo 410): Confirmar queda a la vista pero apagado, «Venció», y se ofrece «Pedir de nuevo».
    function expire() {
      c.dataset.st = 'expired'; if (timer) clearInterval(timer); if (left) left.textContent = '0:00';
      res.textContent = 'Esta propuesta venció. Pídela otra vez.';
      if (ok) { ok.textContent = 'Venció'; ok.disabled = true; } if (no) no.disabled = true;
      if (again) { again.hidden = false; again.disabled = false; }
    }
    function tick() {
      if (!left) return; var ms = exp - (Date.now() + clockOffset); if (!exp) { left.textContent = '-'; return; }
      if (ms <= 0 && ok && ok.textContent === 'Guardando…') { left.textContent = '0:00'; return; } // en curso: el servidor decide (ya usada = mismo id)
      if (ms <= 0) { clearInterval(timer); if (c.dataset.st === 'pending') { gate.cancel(key, 'vencida'); expire(); if (again) { again.hidden = false; again.disabled = false; } } left.textContent = '0:00'; return; }
      var sec = Math.ceil(ms / 1000); left.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }
    syncOk();
    if (need && need.first) { try { need.first.focus({ preventScroll: false }); } catch (_) {} }
    if (left && p.needsConfirm) { tick(); timer = setInterval(function () { if (c.dataset.st !== 'pending') { clearInterval(timer); return; } tick(); }, 1000); }
    if (ok) ok.onclick = async function () {
      if (c.dataset.st !== 'pending') return;
      if (need && need.recheck && need.recheck()) { syncOk(); return; } // (Bot 5 sobre 39ccd25c) un campo cambiado sin evento: se limpia a la vista y no se manda
      ok.disabled = true; no.disabled = true; ok.textContent = gate.locked && gate.locked(key) ? C.RECONNECT_MSG : 'Guardando…'; setState('concentrado'); revealCard(c, [res, ok]);
      lockFields(true); // (Bots 3/4/5 sobre d72b7601) nada se edita mientras se confirma ni después de un corte
      if (again) again.disabled = true;
      // Antes de confirmar: si el POS no puede abrir la pantalla, se dice el motivo real y no se gasta la tarjeta.
      var pre = C.precheck ? C.precheck(p, deps) : null;
      if (pre) { lockFields(!!(gate.locked && gate.locked(key))); res.textContent = pre; no.disabled = false; ok.disabled = false; ok.textContent = c.dataset.btn || 'Confirmar'; if (again) { again.hidden = false; again.disabled = false; } c.dataset.fail = 'precheck'; syncOk(); setState('error', 2000); return; }
      // Sin PIN: un toque. El botón queda apagado al instante (un doble toque no dispara otro), la puerta reusa el pedido en curso y el
      // servidor marca la tarjeta usada una sola vez (el segundo envío recibe already_confirmed con el mismo operation_id).
      gate.execute(key, { confirmed: true, review: review(), onRetry: function () { if (!c.isConnected) return; ok.textContent = C.RECONNECT_MSG; res.textContent = C.RECONNECT_MSG; revealCard(c, [res, ok]); } }).then(function (r) {
        if (r && r.code === 'forbidden_role') { roleLost(c, key, p, need); return; } // (Bots 4/5 sobre 58200f60) ver roleLost
        if (r && ACCESS_LOST[r.code]) { accessLost(r.code); return; } // 403 de permiso al confirmar: igual que en el chat
        if (!c.isConnected) return;
        wake();
        res.textContent = r.msg; c.dataset.st = gate.state(key) || 'pending'; revealCard(c, [res, ok]);
        // sin respuesta: campos y cuerpo quedan como se mandaron; solo «Reintentar» (mismo cuerpo). Con 200 o un 4xx real se puede editar.
        if (r.locked) { lockFields(true); c.dataset.fail = 'network'; c.dataset.btn = 'Reintentar'; ok.disabled = false; no.disabled = false; ok.textContent = 'Reintentar'; if (again) { again.hidden = true; } setState('error', 2600); return; }
        lockFields(false);
        if (r.code === 'already_confirmed_same_session' && r.ok) posNotice(r.msg);
        if (r.code === 'confirm_expired') { expire(); setState('error', 2600); return; }
        if (c.dataset.st !== 'pending') ok.textContent = { done: 'Hecho', denied: 'No disponible', cancelled: 'Cancelada', expired: 'Venció' }[c.dataset.st] || 'Confirmar';
        if (r.ok) { if (again) again.hidden = true; setState('feliz', 2600); setTimeout(closePanel, 1400); return; }
        setState('error', 2600);
        var f = C.confirmFailureView(r, { editable: need ? need.names : [], type: p.type }) || { kind: 'other', rows: [], button: 'Confirmar', again: true };
        c.dataset.fail = f.kind;
        // (Bot 4 sobre 58200f60) nada que arreglar en la tarjeta: aviso claro y solo «Cancelar» (ningún botón que no lleve a ningún lado)
        if (f.kind === 'blocked') { res.textContent = f.msg; if (ok) { ok.hidden = true; ok.disabled = true; } if (again) again.hidden = true; no.hidden = false; no.disabled = false; no.textContent = 'Cancelar'; return; }
        if (f.kind === 'review' || f.kind === 'limit') markRows(f.rows, f.kind === 'limit');
        if (f.kind === 'fields' && p.type === 'configuracion') { if (need) need.flag(f.fields, f.msg); res.textContent = f.msg; } // RUC: el aviso del servidor junto al campo y en la tarjeta
        else if (f.kind === 'fields') { var rest = need ? need.flag(f.fields) : f.fields; res.textContent = rest.length || !need ? f.msg : 'Complete los datos marcados y vuelva a confirmar.'; }
        if (again) { again.hidden = !f.again; again.disabled = false; }
        if (c.dataset.st === 'pending') { c.dataset.btn = f.button; ok.disabled = false; no.disabled = false; ok.textContent = f.button; syncOk(); }
      });
    };
    // La vista la acomoda send() (no se salta lo que la persona está leyendo).
    return c;
  }
  // ---------- Permiso quitado o cambiado con la app abierta ----------
  // 403 assistant_off / forbidden_role / admin_only en chat o confirm: se cierra el panel y se QUITAN la burbuja, el panel y la tarjeta
  // de Inicio en ese momento (no solo se ocultan). Se borra el rol guardado en el teléfono (un recargo no reserva hueco).
  // assistant_off: aviso corto y neutro con el aviso del POS (window.toast sin tipo: sin color de error ni emoji).
  // forbidden_role / admin_only: el rol cambió; un ping pregunta el nuevo y, si todavía tiene asistente, se arma de nuevo con su nivel.
  var ACCESS_LOST = { assistant_off: 1, forbidden_role: 1, admin_only: 1 }, OFF_NOTICE = 'El asistente fue desactivado por el Admin';
  function posNotice(msg) { try { if (typeof root.toast === 'function') root.toast(msg); } catch (_) {} }
  function dropUi() {
    padded.forEach(unpad); padded = [];
    var dv = doc.querySelector('.na-asst-doc'); if (dv) dv.remove();
    if (bubbleIO) { try { bubbleIO.disconnect(); } catch (_) {} bubbleIO = null; }
    if (mascot) { mascot.destroy(); mascot = null; } mascotAsked = false;
    if (panelEl) panelEl.remove(); if (rootEl) rootEl.remove();
    rootEl = panelEl = msgsEl = inputEl = sendBtn = photoBtn = fileEl = offEl = tagEl = newBtn = liveEl = null;
    history.length = 0; invoiceMemory = null; lastCut = null; cutNote = null; shownFor = null; busy = false; offscreen = false;
    mem = C.memNew ? C.memNew() : null; queued = null; queuedNote = null; shownSigs = {}; turnNo = 0; configurationTurn = false;
  }
  // (Bots 4/5 sobre 58200f60) 403 forbidden_role al CONFIRMAR una tarjeta: manda el rol del servidor; aquí no se mira el rol guardado en el
  // aparato ni se reintenta nada. La tarjeta sale de la pantalla, y la propuesta y lo escrito a mano salen de la memoria (la puerta ya la
  // olvidó; aquí se vacían los campos y la referencia de la tarjeta). Queda solo el aviso con «Cerrar». Solo createElement/textContent.
  // (Bot 5 sobre d72b7601) y no solo esa tarjeta: TODAS las propuestas salen de la puerta (gate.forgetAll), TODAS las .na-asst-card salen
  // de la pantalla y de la memoria (campos escritos, _manual, referencias), y si «Nueva compra» está abierta prellenada desde una tarjeta
  // (sin guardar: al guardar el POS la cierra), se vacían sus campos y se cierra con su propio «Cancelar» (sin tocar el núcleo de compras).
  // Luego refreshAccess pregunta el rol al servidor. Nada de esto se guarda en localStorage/sessionStorage/IndexedDB.
  function wipeCard(card) {
    if (!card) return;
    var nd = card._naNeed, pp = card._naP;
    if (nd && nd.state) Object.keys(nd.state).forEach(function (k) { delete nd.state[k]; });
    if (nd && nd.inputs) nd.inputs.forEach(function (i) { i.value = ''; });
    if (card.querySelectorAll) Array.prototype.forEach.call(card.querySelectorAll('input, textarea'), function (i) { i.value = ''; });
    if (pp) C.wipeManual(pp);
    card._naKey = null; card._naNeed = null; card._naP = null; if (card.remove) card.remove();
  }
  function closeAssistantPurchase() {
    var w = doc.getElementById('naPurchaseDialog'); if (!w || !w.dataset || w.dataset.naAsst !== '1') return false;
    Array.prototype.forEach.call(w.querySelectorAll('input, textarea'), function (i) { i.value = ''; });
    try { w.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    var cancel = w.querySelector('.na-pur-cancel'); if (cancel) cancel.click(); // el «Cancelar» del POS (closeW)
    if (w.isConnected) w.remove(); // igual que tocar fuera de la ventana (overlay del POS)
    return true;
  }
  function roleLost(c, key, p, need) {
    var lostMsg = p && p.type === 'configuracion' && C.CONFIG_LOST_MSG ? C.CONFIG_LOST_MSG : C.ROLE_LOST_MSG; // Configuración: aviso propio
    try { gate.forget(key); } catch (_) {}
    try { if (gate.forgetAll) gate.forgetAll(); } catch (_) {}
    if (c) { if (!c._naNeed) c._naNeed = need; if (!c._naP) c._naP = p; }
    wipeCard(c); C.wipeManual(p);
    Array.prototype.forEach.call(doc.querySelectorAll('.na-asst-card'), wipeCard);
    closeAssistantPurchase();
    var m = el('div', 'na-asst-msg sys na-asst-rolelost'), t = el('div'); t.textContent = C.ROLE_LOST_MSG; if (lostMsg !== C.ROLE_LOST_MSG) t.textContent = lostMsg; m.appendChild(t);
    var b = el('button', 'na-asst-retry'); b.type = 'button'; b.textContent = 'Cerrar'; b.onclick = function () { m.remove(); closePanel(); }; m.appendChild(b);
    if (msgsEl) { msgsEl.appendChild(m); scrollEnd(); } announce(lostMsg);
    // el servidor dice el rol nuevo; si al cambiar de rol se rearma el panel (sin la charla), el aviso queda en el aviso del POS
    lastPing = 0; Promise.resolve(refreshAccess()).then(function () { if (!m.isConnected && !doc.querySelector('.na-asst-rolelost')) posNotice(lostMsg); }, function () {});
  }
  function accessLost(code) {
    access = null; adminOff = true; noRole = false;
    try { root.localStorage.removeItem('na_asistente_acc'); } catch (_) {}
    dropUi(); renderHero(); // sin permiso: la tarjeta de Inicio sale (o queda el aviso neutro del hueco hasta salir de Inicio)
    if (code === 'assistant_off') posNotice(OFF_NOTICE);
    else { adminOff = false; lastPing = 0; refreshAccess(); }
  }
  // 403 forbidden_document (el dueño bajó «Consultas y documentos» a «Solo consultas»): el panel queda abierto, pero salen las
  // tarjetas de documento que estaban en él (y su vista previa), y el nivel guardado pasa a «consultas» (atajos y saludo nuevos).
  function levelLowered() {
    if (access && access.role !== 'owner' && access.level === 'consultas_documentos') access.level = 'consultas';
    var dv = doc.querySelector('.na-asst-doc'); if (dv) dv.remove();
    if (msgsEl) Array.prototype.forEach.call(msgsEl.querySelectorAll('.na-asst-card[data-type="documento"]'), function (c) { if (c._naKey) { try { gate.cancel(c._naKey); } catch (_) {} } c.remove(); });
    syncPanelForAccess(); renderHero();
    lastPing = 0; refreshAccess(); // el servidor confirma el nivel nuevo
  }
  // Errores: siempre en palabras simples (C.friendlyError), nunca un código. Si se puede reintentar, va un botón «Reintentar»
  // que manda OTRA VEZ lo mismo; nunca queda «Pensando» para siempre (el pedido se corta a los C.TIMEOUTS.chat ms).
  function errMsg(code, serverMsg, retryArgs) {
    var f = C.friendlyError(code, serverMsg), m = addMsg('a', f.msg); announce(f.msg);
    if (f.retry && retryArgs) {
      var b = el('button', 'na-asst-retry'); b.type = 'button'; b.textContent = 'Reintentar';
      b.onclick = function () { if (busy) return; b.disabled = true; m.remove(); var u = m.previousElementSibling; if (retryArgs[2] !== false && u && u.classList.contains('na-asst-msg') && u.classList.contains('u')) u.remove(); send(retryArgs[0], retryArgs[1]); };
      m.appendChild(b);
    }
    return m;
  }
  // Corte a mitad de la respuesta: el texto recibido queda, marcado «Respuesta incompleta», con «Reintentar» (nunca automático).
  // Reintentar quita ESA respuesta y su pregunta y las manda de nuevo: no queda texto repetido ni perdido.
  function incomplete(m, t, img) {
    var lab = el('div', 'na-asst-incomplete'); lab.textContent = 'Respuesta incompleta';
    var b = el('button', 'na-asst-retry'); b.type = 'button'; b.textContent = 'Reintentar';
    b.onclick = function () { if (busy) return; b.disabled = true; var u = m.previousElementSibling; m.remove(); if (u && u.classList.contains('na-asst-msg') && u.classList.contains('u')) u.remove(); send(t, img); };
    var stick = atBottom(), said = m._md ? (C.stripDisplay ? C.stripDisplay(m._md.raw()) : m._md.raw()) : m.textContent; m.removeAttribute('aria-busy'); m.appendChild(lab); m.appendChild(b); follow(stick); announce(said + ' (Respuesta incompleta)'); return m;
  }
  // ¿El navegador puede leer la respuesta en partes? Si no, el chat de siempre (una sola respuesta JSON).
  function canStream() { return typeof root.ReadableStream === 'function' && typeof root.TextDecoder === 'function' && typeof root.AbortController === 'function' && root.NA_ASISTENTE_NO_STREAM !== true; }
  // ---------- «Revisión del punto de venta» (solo Admin) ----------
  // Lo pide el Admin (chip o texto) o se ofrece al abrir el panel si hay errores NUEVOS guardados en este aparato (aviso con botón; el
  // informe nunca se pide solo). Se manda el resumen LOCAL (asistente-loader.js) pasado por el redactor del asistente; el servidor lo
  // vuelve a limpiar, arma el informe y no guarda nada. Empleado: nunca se manda (y el servidor responde 403 review_admin_only).
  var REVIEW_RE = /revisi[oó]n del (?:punto de venta|pos)\b|\brevis(?:a|e|ar)\s+(?:el\s+)?(?:punto de venta|pos)\b|\berrores del (?:punto de venta|pos)\b|\b(?:hazme|h[aá]game|haz|dame|d[eé]me|arma|genera|quiero|ver)\s+(?:el|un|mi)\s+informe\b|\binforme del (?:punto de venta|pos)\b/i;
  // Preguntas naturales del Admin sobre lo que vio el monitor («qué errores encontraste», «hubo fallas», «se colgó», «cómo está el sistema»,
  // «reporte»). Se comparan sin tildes, sin signos y en minúsculas, y aceptan errores de tipeo comunes («q erores», «fayas»). No toma
  // preguntas de negocio: «cuánto vendí hoy», «stock de arroz», «reporte de ventas», «cómo está la caja», «productos de lenta rotación».
  var REVIEW_ASK_RE = /\b(?:que|q|ke|cuales?|cuantos?|algun[oa]?s?|hay|hubo|habia|ha habido|existen?|tienes?|tiene|tenemos|tuvo|tuvimos|ves|viste|veo|encontr\w*|detect\w*|registr\w*|revis\w*|muestr\w*|mostr\w*|dime|decime|digame|dame|deme|listame|lista|ultimos?|nuevos?|reportame|informame)\s+(?:\S+\s+){0,2}?(?:e+r+o+r+(?:e*s)?|errors?|fa(?:ll|y)(?:a|o)s?|bugs?)\b|^\s*(?:los\s+|las\s+)?(?:e+r+o+r+(?:e*s)?|fa(?:ll|y)(?:a|o)s|bugs?)(?:\s+(?:de|del|en el|en la)\s+(?:hoy|ayer|la semana|semana|pos|punto de venta|sistema|app|aplicacion|programa))?\s*$|\b(?:e+r+o+r+(?:e*s)?|fa(?:ll|y)(?:a|o)s|bugs?)\s+(?:encontrad\w*|detectad\w*|registrad\w*|hay|hubo)\b|\b(?:que|q|ke|algo)\s+(?:fallo|se rompio|(?:anda|esta|salio|funciona)\s+mal)\b|\bfallo\s+algo\b|\bque\s+(?:encontraste|detectaste|notaste|registraste)\b|\bque\s+(?:encontro|detecto|vio|dice)\s+(?:el\s+)?monitor\b|\b(?:algo|esta|estuvo|va|iba|anda|andaba|se pone|se puso|funciona|muy|tan|demasiado)\s+lent[oa]s?\b|\blentitud\b|\bse\s+(?:colg|congel|trab|tild)\w*|\b(?:colgad|congelad|trabad)[oa]s?\b|\bse\s+cuelga\b|\bcomo\s+(?:esta|anda|va|sigue|marcha)\s+(?:el\s+|la\s+|mi\s+|nuestro\s+|nuestra\s+)?(?:pos|punto de venta|sistema|app|aplicacion|programa)\b|\b(?:pos|punto de venta|sistema|app|aplicacion|programa)\s+(?:esta|anda|va|funciona)\s+bien\b|\b(?:revis|chequ|verific|analiz|diagnostic|monitore|vigil)\w*\s+(?:todo\s+)?(?:el\s+|la\s+|mi\s+)?(?:pos|punto de venta|sistema|app|aplicacion|programa)\b|\b(?:informe|reporte|resumen)\s+(?:de|del|sobre)\s+(?:los\s+|las\s+)?(?:e+r+o+r+(?:e*s)?|fa(?:ll|y)(?:a|o)s|bugs?|lentitud|rendimiento|monitoreo|monitor|salud|estado|pos|punto de venta|sistema|app|aplicacion)\b|^\s*(?:el\s+|un\s+|mi\s+|tu\s+)?(?:informe|reporte)\s*$|\b(?:hazme|hagame|haz|dame|deme|arma|genera|quiero|ver|mandame|enviame|muestrame|pasame)\s+(?:el|un|mi|ese|tu)\s+reporte\b(?!\s+de\s+(?:ventas?|compras?|caja|stock|inventario|productos?|clientes?|ganancias?|gastos?|deudas?|creditos?))/;
  function reviewNorm(t) { var s = String(t || '').toLowerCase(); if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); return s.replace(/[^a-z0-9#]+/g, ' ').trim(); }
  // Errores en DATOS del negocio («¿algún error en los precios?», «errores en el stock», «falla en la caja», «error en la venta del cliente»)
  // son preguntas de datos: van al chat. «Errores del POS / del sistema / de la app» siguen abriendo la revisión.
  var REVIEW_BIZ_RE = /\b(?:e+r+o+r+(?:e*s)?|errors?|fa(?:ll|y)(?:a|o)s?|bugs?|mal|problemas?)\s+(?:\S+\s+){0,2}?(?:en|de|con|del|sobre|para)\s+(?:(?:los|las|el|la|mis|mi|un|una|unos|unas|este|esta|estos|estas|esos|esas)\s+)?(?:precios?|stock|inventarios?|ventas?|compras?|caja|creditos?|abonos?|boletas?|facturas?|productos?|clientes?|cuentas?|deudas?|montos?|gastos?|cobros?|pagos?|vueltos?|tickets?|recibos?|totales?|cuadres?|cierres?|kardex|lotes?|proveedor(?:es)?|pedidos?)\b/;
  function isReview(t) { if (REVIEW_RE.test(t)) return true; var n = reviewNorm(t); return !REVIEW_BIZ_RE.test(n) && REVIEW_ASK_RE.test(n); }
  // Cliente: SOLO su código interno (el id que ya tiene en la lista de clientes del POS) y la acción. Nunca nombre, DNI ni montos.
  var CLI_RE = /^[A-Za-z0-9_-]{1,40}$/;
  function cliPart(x) { return x && x.cli != null && CLI_RE.test(String(x.cli)) ? { cli: String(x.cli), accion: String(x.accion || 'cliente').slice(0, 30) } : {}; }
  // Datos viejos guardados antes de este cambio: de un error de pantalla solo sale el TIPO, nunca el mensaje.
  function errType(v) { var t = String(v == null ? '' : v).trim(); if (/^[A-Za-z]{1,40}$/.test(t)) return t; var m = /^(?:Uncaught\s+)?(?:\(in promise\)\s*)?([A-Z][A-Za-z]{0,39}(?:Error|Exception))\b/.exec(t); return m ? m[1] : 'Error'; }
  function reviewData() {
    var R = root.NA_ASISTENTE_REVISION, raw = R && R.data ? R.data() : { errors: [], usage: {} };
    return { errors: (raw.errors || []).slice(-200).map(function (x) { return Object.assign({ kind: x.kind, msg: x.kind === 'api' ? C.redactText(String(x.msg || '')).slice(0, 160) : errType(x.msg), src: C.redactText(String(x.src || '')).slice(0, 80), status: x.status || 0, count: x.count || 1, first: x.first || null, last: x.last || null }, cliPart(x)); }),
      usage: raw.usage || {},
      slow: (raw.slow || []).slice(-200).map(function (x) { return Object.assign({ kind: x.kind, name: C.redactText(String(x.name || '')).slice(0, 80), count: x.count || 1, ms_avg: x.ms_avg || 0, ms_max: x.ms_max || 0, last: x.last || null }, cliPart(x)); }),
      ocr: raw.ocr ? { reads: raw.ocr.reads || 0, fails: raw.ocr.fails || 0, timeouts: raw.ocr.timeouts || 0, ms_sum: raw.ocr.ms_sum || 0, ms_max: raw.ocr.ms_max || 0, confirmed: raw.ocr.confirmed || 0, corrections: raw.ocr.corrections || 0 } : null };
  }
  // «cliente #código» del informe -> enlace que muestra el nombre buscado EN ESTE APARATO y abre al cliente. El nombre nunca sale del aparato.
  function linkCustomers(node, codes) {
    var R = root.NA_ASISTENTE_REVISION; if (!node || !codes || !codes.length) return 0;
    var nameOf = R && R.customerName ? R.customerName : function (code) { var c = deps.clientes().find(function (x) { return String(x.id) === String(code); }); return c ? String(c.nombre || c.name || '').slice(0, 80) : null; };
    var ok = {}; codes.forEach(function (c) { if (CLI_RE.test(String(c))) ok[String(c)] = 1; });
    var re = /cliente #([A-Za-z0-9_-]{1,40})/g, n = 0, walk = [], tw = doc.createTreeWalker ? doc.createTreeWalker(node, 4) : null;
    if (tw) { while (tw.nextNode()) walk.push(tw.currentNode); } else (function rec(x) { (x.childNodes || []).forEach(function (c) { if (c.nodeType === 3) walk.push(c); else rec(c); }); })(node);
    walk.forEach(function (t) { var v = t.nodeValue || '', last = 0, m, frag = null; re.lastIndex = 0;
      while ((m = re.exec(v))) { if (!ok[m[1]]) continue; frag = frag || doc.createDocumentFragment();
        if (m.index > last) frag.appendChild(doc.createTextNode(v.slice(last, m.index)));
        var code = m[1], name = nameOf(code), a = el('button', 'na-asst-cli'); a.type = 'button'; a.dataset.cli = code;
        a.textContent = 'cliente #' + code + (name ? ' (' + name + ')' : ''); a.title = name ? 'Abrir a ' + name : 'Abrir cliente';
        a.onclick = function (e) { e.preventDefault(); if (!R || !R.openCustomer || !R.openCustomer(this.dataset.cli)) addMsg('a', 'No encontré ese cliente en este aparato.'); };
        frag.appendChild(a); last = m.index + m[0].length; n++; }
      if (frag) { if (last < v.length) frag.appendChild(doc.createTextNode(v.slice(last))); t.parentNode.replaceChild(frag, t); } });
    return n;
  }
  // ---------- «Ventas bajo costo» (solo Admin) ----------
  // Solo lectura: el servidor compara lo cobrado con el costo actual y arma el informe. Aquí solo se muestra (texto, sin tablas HTML).
  // (auditoría 500, P-051/P-052) «vendiendo a perdida», «vendo algo a pérdida»: verbo de venta y hasta 3 palabras antes de «a pérdida»
  // (una baja como «pasa 3 leches vencidas a pérdida» NO abre el informe). Mismo patrón que el Worker (BELOW_COST_ASK_RE).
  var BELOW_RE = /\bbajo(?:\s+el)?\s+costo\b|\b(?:por\s+)?debajo\s+del\s+costo\b|\bmenos\s+(?:de\s+lo\s+que|del?)\s+(?:me\s+)?cost(?:o|[oó]|aron?)\b|\bvend[ií](?:do|mos)?\s+(?:a\s+)?p[eé]rdida\b|\bvend(?:o|es?|en|emos|[ií]|i[oó]|imos|ieron|iendo|ido|er|[ií]a[ns]?|[ií]amos)(?![a-záéíóúñ])(?:\s+[^\s.,;:!?¿¡]+){0,3}?\s+a\s+p[eé]rdidas?\b|\bp[eé]rdidas?\s+(?:en|por)\s+(?:las\s+)?ventas\b|\b(?:est[oó]y|estamos)\s+p[eé]rd[ií][eé]ndo\b|\bp[eé]rd[ií][eé]ndo\s+(?:la\s+)?(?:plata|dinero)\b|\bp[ií][eé]rd[oó]\s+(?:la\s+)?(?:plata|dinero)\b/i;
  function belowRows(m, d) {
    var list = el('div', 'na-asst-below');
    (d.ventas || []).slice(0, 50).forEach(function (g) { if (!g) return; var r = el('div', 'na-asst-below-row');
      r.textContent = String(g.nombre || '') + ': ' + g.unidades + ' unid., cobrado desde S/ ' + Number(g.precio_min || 0).toFixed(2) + ' con costo S/ ' + Number(g.costo || 0).toFixed(2) + ', pérdida S/ ' + Number(g.perdida || 0).toFixed(2);
      list.appendChild(r); });
    (d.catalogo || []).slice(0, 50).forEach(function (c) { if (!c) return; var r = el('div', 'na-asst-below-row');
      r.textContent = 'Precio actual: ' + String(c.nombre || '') + ' a S/ ' + Number(c.precio || 0).toFixed(2) + ' con costo S/ ' + Number(c.costo || 0).toFixed(2);
      list.appendChild(r); });
    if (list.childNodes.length) m.appendChild(list);
  }
  // Período que pidió el Admin; las fechas las calcula el servidor con la hora de Lima. Sin período: los últimos 30 días.
  function belowPeriod(text) {
    var t = String(text || '').toLowerCase(), m = t.match(/[uú]ltimos?\s+(\d{1,2})\s+d[ií]as/);
    if (m) return { dias: Number(m[1]) };
    if (/\bhoy\b/.test(t)) return { periodo: 'hoy' };
    if (/\bayer\b/.test(t)) return { periodo: 'ayer' };
    if (/(esta|la)\s+semana/.test(t)) return { periodo: 'semana' };
    if (/mes\s+(pasado|anterior)/.test(t)) return { periodo: 'mes_pasado' };
    if (/(este|del|el)\s+mes\b/.test(t)) return { periodo: 'mes' };
    return {};
  }
  async function belowCost(text) {
    var chips = panelEl.querySelector('.na-asst-chips'); if (chips) chips.hidden = true;
    addMsg('u', text); inputEl.value = ''; busy = true; sendBtn.disabled = true; photoBtn.disabled = true; setState('pensando');
    var thinking = addMsg('a', 'Revisando ventas y costos'); thinking.classList.add('na-asst-thinking');
    var mine = panelEl;
    try {
      var d = await post('/auth/assistant/below-cost', belowPeriod(text), null, C.TIMEOUTS.chat); if (panelEl !== mine) return; thinking.remove();
      if (!d.ok) { errMsg(d.error, null, [text, null]); setState('error', 2600); return; }
      var b = addMsg('a', String(d.report || '')); b.classList.add('na-asst-review'); belowRows(b, d);
      var shown = C.stripDisplay ? C.stripDisplay(String(d.report || '')) : String(d.report || ''); announce(shown); if (mascot) mascot.speak(shown);
      setState('hablando', 2500);
    } catch (e) { if (!panelEl) return; thinking.remove(); errMsg(root.navigator.onLine === false ? 'offline' : 'network', null, [text, null]); setState('error', 2600); }
    finally { busy = false; if (sendBtn) sendBtn.disabled = root.navigator.onLine === false; if (photoBtn) photoBtn.disabled = root.navigator.onLine === false; drainQueue(); }
  }
  // ---------- «Leer boleta con IA» (solo Admin, carga diferida de asistente-boleta.js) ----------
  var BOLETA_RE = /\b(?:lee|leer|l[eé]ame|escanea|escanear)\s+(?:una\s+|la\s+|esta\s+)?boleta\b|\bboleta con ia\b/i;
  var LEARNED_RE = /\bcorrecciones(?:\s+(?:guardadas|aprendidas|de (?:las )?boletas))?\b|\b(?:borrar|ver)\s+(?:lo\s+)?aprendido\b/i;
  var boletaP = null, fileMode = '';
  function loadBoleta() {
    if (root.NA_ASISTENTE_BOLETA) return Promise.resolve(root.NA_ASISTENTE_BOLETA);
    if (boletaP) return boletaP;
    boletaP = new Promise(function (ok, ko) { var sc = doc.createElement('script'); sc.src = 'js/modules/asistente/asistente-boleta.js';
      sc.onload = function () { root.NA_ASISTENTE_BOLETA ? ok(root.NA_ASISTENTE_BOLETA) : ko(new Error('boleta')); }; sc.onerror = function () { boletaP = null; ko(new Error('boleta')); }; doc.body.appendChild(sc); });
    return boletaP;
  }
  function boletaHost() {
    return { doc: doc, post: post, productos: deps.productos, openPurchase: deps.openPurchase, fillPurchase: deps.fillPurchase,
      card: function (cls) { var m = el('div', 'na-asst-msg a ' + cls); msgsEl.appendChild(m); scrollEnd(); return m; },
      say: function (t) { addMsg('a', t); }, state: setState,
      busy: function (on) { busy = !!on; if (sendBtn) sendBtn.disabled = on || root.navigator.onLine === false; if (photoBtn) photoBtn.disabled = on || root.navigator.onLine === false; } };
  }
  // ---------- «Subir archivo»: PDF -> imagen en el aparato (carga diferida de asistente-pdf.js; usa el pdf.js que ya trae el POS) ----------
  function fileKind(f) {
    var n = String(f && f.name || '').toLowerCase(), t = String(f && f.type || '').toLowerCase();
    if (t === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
    if (/^image\//.test(t) || /\.(?:jpe?g|png|webp|gif|bmp|heic|heif)$/.test(n)) return 'image';
    if (/\.(?:docx?|xlsx?|xlsm|csv|odt|ods|rtf|txt|pptx?)$/.test(n) || /msword|ms-excel|officedocument|opendocument|text\/(?:plain|csv)|rtf/.test(t)) return 'doc';
    return 'other';
  }
  var pdfP = null;
  function loadPdf() {
    if (root.NA_ASISTENTE_PDF) return Promise.resolve(root.NA_ASISTENTE_PDF);
    if (pdfP) return pdfP;
    pdfP = new Promise(function (ok, ko) { var sc = doc.createElement('script'); sc.src = 'js/modules/asistente/asistente-pdf.js';
      sc.onload = function () { root.NA_ASISTENTE_PDF ? ok(root.NA_ASISTENTE_PDF) : ko(new Error('pdf')); }; sc.onerror = function () { pdfP = null; ko(new Error('pdf')); }; doc.body.appendChild(sc); });
    return pdfP;
  }
  // -> Promise<{ blob, pages, total }>; si falla, ya avisó en el chat y rechaza.
  function pdfImage(f) {
    var wait = addMsg('a', 'Abriendo el PDF'); wait.classList.add('na-asst-thinking'); setState('concentrado');
    return loadPdf().then(function (P) { return P.toImage(f, { doc: doc }).then(function (r) {
      wait.remove(); if (r.total > r.pages) addMsg('a', 'El PDF tiene ' + r.total + ' páginas: leo solo las primeras ' + r.pages + '.'); return r;
    }, function (e) { throw P.message(e && e.code); }); }).catch(function (m) {
      wait.remove(); addMsg('a', typeof m === 'string' ? m : 'No pude abrir ese PDF.'); setState('error', 2000); throw m; });
  }
  // ---------- «Foto de producto» (solo Admin, carga diferida de asistente-producto-foto.js): solo PRELLENA «Nuevo producto» ----------
  var PRODFOTO_RE = /\bfoto\s+(?:de(?:l)?\s+)?(?:la\s+)?(?:producto|etiqueta)\b|\b(?:lee|leer|l[eé]ame)\s+(?:la\s+|esta\s+)?etiqueta\b/i;
  var prodFotoP = null;
  function loadProdFoto() {
    if (root.NA_ASISTENTE_PRODUCTO_FOTO) return Promise.resolve(root.NA_ASISTENTE_PRODUCTO_FOTO);
    if (prodFotoP) return prodFotoP;
    prodFotoP = new Promise(function (ok, ko) { var sc = doc.createElement('script'); sc.src = 'js/modules/asistente/asistente-producto-foto.js';
      sc.onload = function () { root.NA_ASISTENTE_PRODUCTO_FOTO ? ok(root.NA_ASISTENTE_PRODUCTO_FOTO) : ko(new Error('producto-foto')); }; sc.onerror = function () { prodFotoP = null; ko(new Error('producto-foto')); }; doc.body.appendChild(sc); });
    return prodFotoP;
  }
  function prodFotoPick() { if (!isOwnerAccess() || !canPhoto()) { errMsg('producto_foto_admin_only'); return; } fileMode = 'producto'; fileEl.click(); }
  function prodFotoStart(f) { var chips = panelEl.querySelector('.na-asst-chips'); if (chips) chips.hidden = true;
    compress(f).then(function (img) { addMsg('u', 'Foto de producto', img); return loadProdFoto().then(function (P) { var h = boletaHost(); h.openNewProduct = deps.openNewProduct; return P.start(img, h); }); })
      .catch(function () { addMsg('a', 'No pude abrir esa foto.'); setState('error', 2000); }); }
  function boletaPick() { if (!isOwnerAccess() || !canPhoto()) { errMsg('boleta_admin_only'); return; } fileMode = 'boleta'; fileEl.click(); }
  function boletaStart(f) { var chips = panelEl.querySelector('.na-asst-chips'); if (chips) chips.hidden = true; addMsg('u', 'Leer boleta con IA');
    loadBoleta().then(function (B) { return B.start(f, boletaHost()); }).catch(function () { addMsg('a', 'No pude abrir el lector de boletas. Inténtelo otra vez.'); setState('error', 2000); }); }
  function learnedShow(text) { addMsg('u', text); inputEl.value = ''; loadBoleta().then(function (B) { B.showLearned(boletaHost()); }).catch(function () { addMsg('a', 'No pude abrir las correcciones guardadas.'); }); }
  async function review(text) {
    var chips = panelEl.querySelector('.na-asst-chips'); if (chips) chips.hidden = true;
    var nt = panelEl.querySelector('.na-asst-revnote'); if (nt) nt.remove();
    addMsg('u', text); inputEl.value = ''; busy = true; sendBtn.disabled = true; photoBtn.disabled = true; setState('pensando');
    var thinking = addMsg('a', 'Revisando el punto de venta'); thinking.classList.add('na-asst-thinking');
    var mine = panelEl;
    try {
      var d = await post('/auth/assistant/review', C.compactReview ? C.compactReview(reviewData()) : reviewData(), null, C.TIMEOUTS.chat); // bajo el tope del servidor (96 KB)
      if (panelEl !== mine) return; thinking.remove();
      if (!d.ok) { errMsg(d.error, null, [text, null]); setState('error', 2600); return; }
      var b = addMsg('a', String(d.report || '')); b.classList.add('na-asst-review'); linkCustomers(b, Array.isArray(d.customers) ? d.customers : []);
      var shown = C.stripDisplay ? C.stripDisplay(String(d.report || '')) : String(d.report || ''); announce(shown); if (mascot) mascot.speak(shown);
      var R = root.NA_ASISTENTE_REVISION; if (R && R.markSeen) R.markSeen();
      setState('hablando', 2500);
    } catch (e) { if (!panelEl) return; thinking.remove(); errMsg(root.navigator.onLine === false ? 'offline' : 'network', null, [text, null]); setState('error', 2600); }
    finally { busy = false; if (sendBtn) sendBtn.disabled = root.navigator.onLine === false; if (photoBtn) photoBtn.disabled = root.navigator.onLine === false; drainQueue(); }
  }
  function reviewNotice() {
    var R = root.NA_ASISTENTE_REVISION, n = isOwnerAccess() && R && R.newErrors ? R.newErrors() : 0;
    if (!n || panelEl.querySelector('.na-asst-revnote')) return;
    var m = el('div', 'na-asst-msg a na-asst-revnote'); m.textContent = n === 1 ? 'Hay 1 error nuevo en el punto de venta.' : 'Hay ' + n + ' errores nuevos en el punto de venta.';
    var b = el('button', 'na-asst-retry'); b.type = 'button'; b.textContent = 'Ver revisión'; b.onclick = function () { if (!busy) send('Revisión del punto de venta'); };
    m.appendChild(b); msgsEl.appendChild(m);
  }
  // «Nueva conversación»: se olvida la charla (historial, resumen, factura en memoria) y la pantalla del chat vuelve a empezar.
  function newChat() {
    if (busy || !msgsEl) return;
    history.length = 0; invoiceMemory = null; lastCut = null; cutNote = null; liveCard = null; queued = null; queuedNote = null; shownSigs = {}; turnNo = 0; configurationTurn = false;
    mem = C.memNew ? C.memNew() : null;
    try { gate.forgetAll && gate.forgetAll(); } catch (_) {}
    [].slice.call(msgsEl.children).forEach(function (n) { if (n !== newBtn) n.remove(); }); if (newBtn) newBtn.hidden = true;
    unannounce(); // (auditoría 500, CANON INV-008/009) la respuesta anterior tampoco queda en el texto oculto del lector
    var chips = panelEl.querySelector('.na-asst-chips'); if (chips) chips.hidden = false;
    var m = el('div', 'na-asst-mode'); m.textContent = 'Conversación nueva.'; msgsEl.appendChild(m);
    if (inputEl) try { inputEl.focus(); } catch (_) {}
  }
  // Enter mientras responde: el mensaje queda en fila (uno solo; si escribe más, se juntan) y sale apenas termine la respuesta.
  function queueMsg(text) {
    text = String(text || '').trim(); if (!text || !msgsEl) return;
    queued = queued ? (queued + '\n' + text).slice(0, 500) : text; inputEl.value = '';
    if (!queuedNote || !queuedNote.parentNode) { queuedNote = el('div', 'na-asst-mode na-asst-queued'); msgsEl.appendChild(queuedNote); }
    queuedNote.textContent = 'Te respondo esto apenas termine.'; scrollEnd();
  }
  function drainQueue() { if (!queued || busy || !panelEl) return; var t = queued; queued = null; if (queuedNote) { queuedNote.remove(); queuedNote = null; } setTimeout(function () { if (!busy && panelEl) send(t); else if (panelEl) queueMsg(t); }, 0); }
  // Solo «sigue / continúa / más…» usa la cabecera de la tabla cortada anterior; otra pregunta empieza limpia (sin arrastrar la anterior).
  var CONT_RE = /^\s*(?:y\s+)?(?:sigue|siga|seguí|segui|continúa|continua|continúe|continue|contin[uú]a\s+por\s+favor|más|mas|el\s+resto|lo\s+que\s+falta|los\s+dem[aá]s|dale)(?:[\s,.!¡?¿]|$)/i;
  async function send(text, image) {
    if (busy) { if (!image) queueMsg(text); return; }
    text = String(text || '').trim(); if (!text && !image) return;
    if (!image && isOwnerAccess() && BOLETA_RE.test(text)) { inputEl.value = ''; return boletaPick(); }
    if (!image && isOwnerAccess() && PRODFOTO_RE.test(text)) { inputEl.value = ''; return prodFotoPick(); }
    if (!image && isOwnerAccess() && LEARNED_RE.test(text) && !isReview(text)) return learnedShow(text);
    if (!image && canBelowCost() && BELOW_RE.test(text)) { if (root.navigator.onLine === false) { offline(true); errMsg('offline', null, [text, null, false]); setState('offline'); return; } return belowCost(text); }
    if (!image && isOwnerAccess() && isReview(text)) { if (root.navigator.onLine === false) { offline(true); errMsg('offline', null, [text, null, false]); setState('offline'); return; } return review(text); }
    if (root.navigator.onLine === false) { offline(true); errMsg('offline', null, [text, image, false]); setState('offline'); return; }
    // Bot 3: foto de un empleado = se avisa al instante, SIN subirla (el servidor igual la corta con 403 image_owner_only).
    if (image && access && access.role !== 'owner') { addMsg('u', text || 'Foto'); errMsg('image_owner_only'); setState('error', 2600); return; }
    // Bot 3: el modelo en uso no lee fotos (lo dice el ping): se avisa al instante, SIN subirla (el servidor igual responde 422 sin leerla).
    if (image && access && access.vision === false) { addMsg('u', text || 'Foto'); errMsg('image_unsupported'); setState('error', 2600); return; }
    var chips = panelEl.querySelector('.na-asst-chips'); if (chips) chips.hidden = true; // menos desplazamiento tras el primer mensaje
    liveCard = null; addMsg('u', text || 'Foto', image); inputEl.value = ''; busy = true; sendBtn.disabled = true; photoBtn.disabled = true; setState(image ? 'concentrado' : 'pensando');
    var thinking = addMsg('a', image ? 'Concentrado, leyendo la foto' : 'Pensando'); thinking.classList.add('na-asst-thinking');
    var dots = el('span', 'na-asst-dots'); dots.setAttribute('aria-hidden', 'true'); dots.innerHTML = '<i></i><i></i><i></i>'; thinking.appendChild(dots);
    var screen = (doc.querySelector('.page.active') || {}).id || null;
    // (auditoría de privacidad 2026-10-22) nombres y direcciones de clientes conocidos -> «cliente #código» / «[dirección oculta]» ANTES
    // de salir del aparato; el historial guarda lo mismo (los turnos firmados son este texto). El nombre se vuelve a poner solo al pintar.
    turnNo++;
    // memoria (#946): ventana hasta memoria.max_bytes; lo que no entra va resumido en «resumen» (el del servidor, firmado para el empleado)
    var role = isOwnerAccess() ? 'owner' : 'employee', mreq = null;
    var masked = C.maskCustomers ? C.maskCustomers(text, deps.clientes(), deps.productos(), deps.proveedores ? deps.proveedores() : []) : { text: text };
    var body = { text: C.redactText(masked.text), history: history.slice(-8), context: C.buildContext(deps.productos(), roles().role, screen, text) };
    configurationTurn = C.configurationIntent(text, configurationTurn);
    if (isOwnerAccess() && configurationTurn) {
      var configPanel=panelEl, configApi=root.NA_CONFIG_V9;
      if(!configApi) configApi=await configurationApi();
      if(panelEl!==configPanel) return;
      if(isOwnerAccess()&&configApi&&configApi.assistantSnapshot) body.context.settings=configApi.assistantSnapshot();
    }
    if (gate.summary) body.cards = gate.summary(); // (fix/asist-compras-borrador) estado real de las tarjetas: una cancelada no vuelve como pendiente
    if (mem && C.memRequest) { mreq = C.memRequest(history, mem, { role: role, now: Date.now() + clockOffset, bodyBase: body }); body.history = mreq.history; if (mreq.resumen) body.resumen = mreq.resumen; }
    if (image) { body.image = image; invoiceMemory = null; }
    else if (isOwnerAccess() && invoiceMemory) body.invoice_memory = invoiceMemory;
    var bubble = null, painter = null, streaming = canStream();
    // cabecera para filas sueltas de la continuación: solo de lo YA pintado (texto filtrado) en la burbuja anterior cortada
    var prevLabels = !image && CONT_RE.test(text) && lastCut && lastCut._md && lastCut._md.labels ? lastCut._md.labels() : null, mdOpts = prevLabels ? { labels: prevLabels } : null; lastCut = null; cutNote = null;
    if (streaming) body.stream = true;
    // La burbuja de «Pensando» se vuelve la respuesta EN EL MISMO LUGAR en cuanto llega el primer texto; la mascota pasa a «hablando».
    // Bot 4: los puntitos siguen al final mientras la respuesta llega (aria-busy); se quitan al terminar (doneBubble).
    function ensureBubble() { if (!bubble) { bubble = thinking; thinking._md = null; thinking.classList.remove('na-asst-thinking', 'na-asst-searching'); thinking.textContent = ''; thinking.appendChild(dots); bubble.setAttribute('aria-busy', 'true'); setState('hablando'); } if (bubble._hold && bubble._hold.parentNode) bubble._hold.parentNode.removeChild(bubble._hold); return bubble; }
    function writeText(t) { var b = ensureBubble(); if (!b._md) b._md = C.createReplyRenderer(doc, function (n) { if (n.className === 'na-asst-tbl') b.classList.add('na-asst-wide'); b.insertBefore(n, dots.parentNode === b ? dots : null); }, mdOpts); b._md.push(t); } // fila por fila, sin releer
    function doneBubble() { if (bubble && dots.parentNode === bubble) bubble.removeChild(dots); if (bubble) bubble.removeAttribute('aria-busy'); } // (Bot 4) con aria-busy se va la línea de los puntos: misma altura (CSS)
    // reset del servidor: lo pintado se borra y la burbuja vuelve a «Pensando» con puntitos (nunca una burbuja vacía)
    function backToThinking() { painter.reset(); if (!bubble) return; bubble._md = null; bubble.removeAttribute('aria-busy'); bubble.textContent = 'Pensando'; bubble.appendChild(dots); bubble.classList.add('na-asst-thinking'); bubble = null; setState('pensando'); }
    // Aviso del servidor mientras busca datos (antes de cualquier texto): «Buscando en su inventario…» en la misma burbuja.
    // #962: mientras el servidor retiene texto (tras una palabra delicada) manda status {s:'pensando'} aunque ya haya texto pintado: «Pensando…»
    // debajo de lo pintado (antes de los puntitos), uno solo; lo quita el siguiente texto (ensureBubble), el final o un reset.
    function searching() { if (bubble || panelEl !== mine || !thinking.firstChild || thinking.firstChild.nodeType !== 3) { var ev = arguments[0]; if (bubble && panelEl === mine && ev && ev.s === 'pensando') { if (!bubble._hold || bubble._hold.parentNode !== bubble) { bubble._hold = doc.createElement('div'); bubble._hold.className = 'na-asst-hold'; bubble._hold.textContent = 'Pensando…'; } bubble.insertBefore(bubble._hold, dots.parentNode === bubble ? dots : null); } return; } thinking.firstChild.data = 'Buscando en su inventario'; thinking.classList.add('na-asst-searching'); }
    try {
      var mine = panelEl, d;
      if (streaming) {
        var q = reqInit('/auth/assistant/chat' + (image ? '?image=1' : ''), body); // ?image=1: el servidor decide sin leer la foto
        painter = C.createTextPainter(function (t) { if (panelEl !== mine) return; var stick = atBottom(); writeText(t); follow(stick); wake(); });
        var st = await C.streamChat(root.fetch.bind(root), q.url, q.init, { onText: function (t) { painter.push(t); }, onReset: backToThinking,
          onStatus: searching });
        if (panelEl !== mine) return; // la UI se quitó mientras tanto
        if (st.kind === 'json') { d = st.data || {}; if (!st.ok) { d.error = d.error || 'HTTP_' + st.status; d.status = st.status; } }
        else {
          painter.finish(); // lo que quedaba en la tanda se pinta: nada se pierde
          if (bubble && bubble._md) bubble._md.finish(); // la última línea (cabecera o fila sin salto) también
          doneBubble(); if (bubble && bubble._hold && bubble._hold.parentNode) bubble._hold.parentNode.removeChild(bubble._hold); // #962: sin «Pensando…» al final
          if (st.final) d = st.final;
          else if (st.text && bubble && (!st.error || /^upstream_/.test(String(st.error.error || '')))) { incomplete(bubble, text, image); setState('error', 2600); return; }
          else if (st.error) d = { ok: false, error: st.error.error || 'upstream_error', status: st.error.status };
          else { if (bubble) bubble.remove(); else thinking.remove(); errMsg(root.navigator.onLine === false ? 'offline' : st.timeout ? 'timeout' : 'network', null, [text, image]); setState('error', 2600); return; }
        }
      } else { d = await post('/auth/assistant/chat' + (image ? '?image=1' : ''), body, null, C.TIMEOUTS.chat); if (panelEl !== mine) return; }
      if (!d.ok && bubble) { bubble.remove(); bubble = null; }
      if (!bubble) thinking.remove(); wake(); // llegó respuesta: si estaba en pausa, despierta
      if (typeof d.server_now === 'number') clockOffset = d.server_now - Date.now(); // la cuenta regresiva usa la hora del servidor
      // 403 de permiso (Bots 3, 4 y 5): fuera panel, burbuja y tarjeta EN ESE MOMENTO; nada queda para seguir escribiendo.
      if (!d.ok && ACCESS_LOST[d.error]) { accessLost(d.error); return; }
      if (!d.ok && d.error === 'forbidden_document') { levelLowered(); errMsg('forbidden_document'); setState('error', 2600); return; }
      if (!d.ok) { errMsg(d.error, null, [text, image]); setState('error', 2600); return; }
      if (isOwnerAccess() && typeof d.invoice_memory === 'string') invoiceMemory = d.invoice_memory;
      else if (d.invoice_memory === null || !isOwnerAccess()) invoiceMemory = null;
      // Turnos firmados por el servidor (texto exacto + firma). Sin firma, el servidor los descarta en un aparato de empleado.
      if (Array.isArray(d.turns) && d.turns.length === 2) history.push({ role: 'user', content: d.turns[0].content, sig: d.turns[0].sig, n: d.turns[0].n, iat: d.turns[0].iat }, { role: 'assistant', content: d.turns[1].content, sig: d.turns[1].sig, n: d.turns[1].n, iat: d.turns[1].iat, cut: d.turns[1].cut === true });
      else history.push({ role: 'user', content: body.text || 'Foto' }, { role: 'assistant', content: d.reply });
      var memNote = null;
      if (mem && C.memStore) { C.memStore(history, role, typeof d.nota === 'string' ? d.nota : null); var ma = C.memAfter(history, mem, d, mreq); memNote = ma && ma.notice; }
      // El texto definitivo del servidor reemplaza al que se fue pintando (puede cambiar si una tarjeta se quitó). Tarjetas: SOLO de final.
      // Si es el mismo texto no se toca (nada se mueve). Las tarjetas van DEBAJO del texto terminado: lo ya leído no se desplaza;
      // si la persona estaba abajo se baja, pero nunca más allá del inicio de la respuesta (si la tarjeta no entra, sale «Ver nuevo»).
      var stick = atBottom();
      if (d.cut === true) { if (bubble) bubble.removeAttribute('aria-busy'); else bubble = addMsg('a', ''); paintCut(bubble, d.reply, mdOpts); lastCut = bubble; }
      else if (bubble) { bubble.removeAttribute('aria-busy'); if ((bubble._md ? bubble._md.raw() : bubble.textContent).trim() !== d.reply) paintReply(bubble, d.reply, mdOpts); } else { bubble = addMsg('a', ''); paintReply(bubble, d.reply, mdOpts); }
      if (C.customerCodesIn && isOwnerAccess()) linkCustomers(bubble, C.customerCodesIn(d.reply, deps.clientes())); // «cliente #código» -> nombre de ESTE aparato (solo Admin)
      { var shown = C.stripDisplay ? C.stripDisplay(d.reply) : d.reply; announce(shown); if (mascot) mascot.speak(shown); } // (Bots 4/5 sobre f773911f) lo que se lee y lo que «dice» la mascota = lo que se ve
      if (d.mode === 'mock') { var m = el('div', 'na-asst-mode'); m.textContent = 'Modo demostración'; msgsEl.appendChild(m); }
      if (memNote) { var mn = el('div', 'na-asst-mode na-asst-memnote'); mn.textContent = memNote; msgsEl.insertBefore(mn, bubble.nextSibling); }
      (d.denied || []).forEach(addDenied);
      if (d.proposals && d.proposals.some(function (x) { return x.type === 'consulta'; }) && d.reply) { /* el texto ya resume los números */ }
      cardAnchor = bubble; // tarjetas de ESTA respuesta, debajo de ella (addCard corre el ancla)
      (d.proposals || []).forEach(function (x) { addCard(x, text); });
      cardAnchor = null;
      if (stick) { var top = bubble.getBoundingClientRect().top - msgsEl.getBoundingClientRect().top + msgsEl.scrollTop - 12, end = msgsEl.scrollHeight - msgsEl.clientHeight;
        msgsEl.scrollTop = Math.max(0, Math.min(end, top)); if (end > top + 1) showNew(); else if (newBtn) newBtn.hidden = true; } else if (d.proposals && d.proposals.length) showNew();
      setState('hablando', Math.min(4000, 900 + d.reply.length * 25));
    } catch (e) { if (!panelEl) return; if (painter) painter.reset(); if (bubble) bubble.remove(); thinking.remove(); errMsg(root.navigator.onLine === false ? 'offline' : e && e.timeout ? 'timeout' : 'network', null, [text, image]); setState('error', 2600); }
    finally { busy = false; if (sendBtn) sendBtn.disabled = root.navigator.onLine === false; if (photoBtn) photoBtn.disabled = root.navigator.onLine === false; drainQueue(); }
  }
  // Comprime en el aparato: lado mayor 1600 px, JPEG, baja calidad hasta quedar < 1.4 MB.
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1600, s = Math.min(1, max / Math.max(img.width, img.height)), cv = doc.createElement('canvas');
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        var q = 0.72, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 1400000 && q > 0.35) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad_image')); };
      img.src = url;
    });
  }
  function offline(on) { if (!panelEl || !offEl) return; offEl.hidden = !on; sendBtn.disabled = on || busy; photoBtn.disabled = on || busy; if (on) setState('offline'); else if (state === 'offline') setState('listo'); }
  // Mascota v11 (ver asistente-mascota.js): al abrir el panel la primera vez, en un momento libre, se baja el módulo chico y él pide la
  // mascota en un marco del mismo sitio. El arranque del POS no baja nada de esto. Si algo falla queda la cara de siempre.
  function mascotOn() {
    if (mascot) { mascot.visible(true); return; }
    if (mascotAsked || !panelEl) return; mascotAsked = true;
    function go() { var M = root.NA_ASISTENTE_MASCOTA, host = panelEl && panelEl.querySelector('.na-asst-head .na-asst-char'); if (!M || !host || mascot) return;
      mascot = M.create(host, { quality: quality }); M.idle(root, function () { if (mascot && panelEl) mascot.load(); }); }
    if (root.NA_ASISTENTE_MASCOTA) { go(); return; }
    var sc = doc.createElement('script'); sc.src = 'js/modules/asistente/asistente-mascota.js'; sc.async = true; sc.onload = go; sc.onerror = function () {}; doc.body.appendChild(sc);
  }
  function openPanel() {
    panelEl.hidden = false; rootEl.hidden = true; place(); applyPause(); mascotOn();
    if (!msgsEl.children.length) addMsg('a', isOwnerAccess() ? '¡Hola! Soy Burbuja, tu ayudante de gestión. Te digo qué falta reponer y cómo van las ventas, preparo compras y ajustes de stock, cambios de precio y costo, productos nuevos y documentos. Nada se guarda sin que pulses Confirmar.'
      : '¡Hola! Soy Burbuja. Te digo el stock y qué falta reponer' + (access && access.level === 'consultas_documentos' ? ', y armo la lista de precios o de pedido' : '') + '. Los cambios (precios, stock, compras) los hace el Admin desde su teléfono.');
    reviewNotice();
    var off = root.navigator.onLine === false; offline(off); if (off) setState('offline'); else setState('feliz', 1300); measureFrames();
    setTimeout(function () { try { inputEl.focus({ preventScroll: true }); } catch (_) {} }, 50);
  }
  function closePanel() { panelEl.hidden = true; rootEl.hidden = false; place(); applyPause(); if (mascot) mascot.visible(false); }

  function chipsHtml() {
    if (isOwnerAccess()) return '<button type="button" data-q="¿Qué me falta reponer?">¿Qué falta reponer?</button><button type="button" data-q="¿Cuánto vendimos hoy?">Ventas de hoy</button><button type="button" data-q="Dame las sugerencias de compra">Sugerencias de compra</button>' + (canPhoto() ? '<button type="button" data-photo>Leer factura (foto)</button>' : '') + (canPhoto() ? '<button type="button" data-boleta>Leer boleta con IA</button>' : '') + (canPhoto() ? '<button type="button" data-prodfoto>Foto de producto</button>' : '') + '<button type="button" data-q="Ventas bajo costo">Ventas bajo costo</button><button type="button" data-q="Arma el documento de inventario valorizado">Inventario valorizado</button><button type="button" data-q="Revisión del punto de venta">Revisión del POS</button>';
    return '<button type="button" data-q="¿Qué me falta reponer?">¿Qué falta reponer?</button><button type="button" data-q="¿Cuánto stock hay de paracetamol?">Stock de un producto</button>' +
      (access && access.level === 'consultas_documentos' ? '<button type="button" data-q="Arma la lista de precios">Lista de precios</button><button type="button" data-q="Arma la lista de pedido para el proveedor">Lista de pedido</button>' : '');
  }

  // ---------- Permiso: lo decide el servidor ----------
  // Ping sin costo (no llama a DeepSeek ni gasta cupo). Se repite al volver internet, al volver a la app y al ENTRAR A INICIO (Bot 3),
  // como máximo una vez cada 10 s (PING_EVERY_MS); tras un 403 de permiso o sin respuesta del servidor se puede repetir enseguida.
  // Así un empleado al que le dan permiso lo ve sin recargar, y uno al que se lo quitan (aunque no toque nada) lo pierde.
  var pinging = null, lastPing = 0, PING_EVERY_MS = 10000, PING_TIMEOUT_MS = 3000;
  // Los re-chequeos (Inicio, reconectar, volver a la app) corren en un momento libre del navegador: nunca antes que el POS.
  function idleRefresh() { (root.requestIdleCallback || function (f) { return setTimeout(f, 200); })(function () { refreshAccess({ throttle: true }); }, { timeout: 2000 }); }
  // Interruptor «Asistente en este aparato» (Configuración, solo Admin; lo maneja el cargador): apagado = nada del asistente aquí.
  function offHere() { try { return root.localStorage.getItem('na_asistente_off') === '1'; } catch (_) { return false; } }
  function suspend() {
    dropUi();
    var S = root.NA_ASISTENTE_SLOT; if (heroEl || doc.getElementById('naAsstHero')) { if (S && S.release) S.release(); else { var h = doc.getElementById('naAsstHero'); if (h) h.remove(); } } heroEl = null;
    doc.querySelectorAll('.na-asst-acc, .na-asst-prov, .na-asst-own, .na-asst-reg').forEach(function (n) { n.remove(); });
  }
  function resume() { lastPing = 0; return refreshAccess(); }
  function refreshAccess(opts) {
    if (offHere()) { suspend(); return Promise.resolve(null); }
    if (pinging) return pinging;
    if (root.navigator.onLine === false) { renderHero(); return Promise.resolve(access); }
    if (opts && opts.throttle && Date.now() - lastPing < PING_EVERY_MS) return Promise.resolve(access);
    lastPing = Date.now();
    var hadUi = !!rootEl, offNow = false;
    // Corto (3 s) y sin bloquear nada: con mala señal se corta (timeout del pedido) y queda lo que ya había.
    var prevRole = access ? access.role : null;
    pinging = post('/auth/assistant/chat', { ping: true }, null, PING_TIMEOUT_MS).then(function (d) {
      if (d && d.ok) { access = { role: d.role === 'owner' ? 'owner' : 'empleado', level: d.level, vision: d.vision !== false }; access.cambios = d.role !== 'owner' && d.cambios === true; adminOff = false; }
      else if (d && (d.status === 403 || d.status === 401 || d.status === 404)) { access = null; offNow = d.error === 'assistant_off' && d.reason !== 'sin_rol'; }
      else lastPing = 0; // sin respuesta clara: se puede volver a preguntar al reconectar
      noRole = !!(d && d.reason === 'sin_rol'); if (d && 'owner_bootstrap' in d) bootstrapOn = !!d.owner_bootstrap; // solo viene en el 403 sin_rol
      try { if (d && d.ok) root.localStorage.setItem('na_asistente_acc', d.role === 'owner' ? 'owner' : 'on'); else if (d && (d.status === 403 || d.status === 401 || d.status === 404)) root.localStorage.removeItem('na_asistente_acc'); } catch (_) {}
      return access;
    }, function () { lastPing = 0; return access; }).then(function (a) {
      pinging = null;
      // Cambió el rol (dueño -> empleado o al revés) o se cerró la sesión: fuera la charla anterior (historial y mensajes en pantalla).
      // La charla vive solo en memoria (no hay copia en localStorage/sessionStorage); se arma de nuevo vacía.
      if (prevRole && (!access || access.role !== prevRole) && (rootEl || panelEl || history.length)) dropUi();
      if (isAdmin()) { if (!doc.querySelector('.na-asst-root')) mount(); else syncPanelForAccess(); }
      else if (rootEl || panelEl) { dropUi(); if (hadUi && offNow) posNotice(OFF_NOTICE); } // ya no tiene asistente: fuera la UI (no solo oculta)
      renderHero(); if (rootEl) applyPause(); decorateConfig(); decorateRegister();
      return a;
    });
    return pinging;
  }
  // Si el nivel cambió con la app abierta: saludo y chips nuevos.
  var shownFor = null;
  function syncPanelForAccess() {
    var key = access ? access.role + ':' + access.level + ':' + (access.vision === false ? 'nv' : 'v') : '';
    if (!panelEl || shownFor === key) return; shownFor = key;
    // Al empleado no se le muestran opciones de dueño: sin botón de foto (leer factura es del dueño).
    if (photoBtn) photoBtn.hidden = !canPhoto(); // y sin lectura de fotos (vision:false), tampoco al dueño; el aviso de send() queda de respaldo
    var ch = panelEl.querySelector('.na-asst-chips'); if (ch) ch.innerHTML = chipsHtml();
    var sm = panelEl.querySelector('.na-asst-head-t small'); if (sm) sm.textContent = isOwnerAccess() ? 'Gestión · Admin · prueba aislada' : 'Consultas · empleado · prueba aislada';
  }

  // ---------- Tarjeta en Inicio ----------
  // Solo se dibuja cuando el SERVIDOR confirmó el permiso. A un empleado sin permiso no se le dibuja nada (ni espacio).
  // Va al FINAL de Inicio: no empuja ni mueve lo que ya está. Sin internet: «Asistente no disponible sin internet»
  // solo si este aparato ya fue confirmado como dueño o el rol guardado del POS es dueño; el resto de Inicio sigue igual.
  var heroEl = null, noRole = false, bootstrapOn = false;
  // Último rol que confirmó el servidor (lo guarda el cargador): solo 'owner' muestra la tarjeta sin internet.
  function cachedOwner() { try { return root.localStorage.getItem('na_asistente_acc') === 'owner'; } catch (_) { return false; } }
  function renderHero() {
    var menu = doc.getElementById('pageMenu'); if (!menu || offHere()) return;
    var off = root.navigator.onLine === false;
    // Solo el dueño tiene tarjeta en Inicio (la tarjeta reemplaza a la burbuja). El empleado con nivel encendido ve solo la burbuja con sus atajos.
    var mode = isOwnerAccess() ? (off ? 'offline' : 'owner') : (off && cachedOwner() && !adminOff ? 'offline' : null);
    if (!heroEl) heroEl = doc.getElementById('naAsstHero'); // hueco que reservó el cargador (último ping: dueño)
    if (mode && heroEl && heroEl.classList.contains('na-asst-gone')) { var Sr = root.NA_ASISTENTE_SLOT; if (Sr && Sr.release) Sr.release(); else heroEl.remove(); heroEl = null; }
    if (!mode) {
      // Ya no es dueño: el cargador vacía la tarjeta EN EL ACTO (contenido y atajos fuera del DOM) y deja un aviso neutro del mismo alto hasta salir de Inicio.
      var Sx = root.NA_ASISTENTE_SLOT;
      if (heroEl || doc.getElementById('naAsstHero')) { if (Sx && Sx.unreserve) Sx.unreserve(); else { var hx = heroEl || doc.getElementById('naAsstHero'); if (hx) hx.remove(); doc.documentElement.classList.remove('na-asst-owner'); } }
      heroEl = null; return;
    }
    if (!heroEl) { // sin hueco reservado (primera vez de este dueño en este aparato)
      // Inicio a la vista: meter la tarjeta arriba empujaría todo (CLS 0,14-0,22). Se espera: mientras tanto se ve la burbuja, y la
      // tarjeta entra al salir de Inicio (sin nada visible que mover) o en el próximo arranque (el <head> ya reserva su alto).
      if (menu.classList.contains('active') && menu.offsetParent !== null) { heroDeferred = true; return; }
      heroDeferred = false;
      var S = root.NA_ASISTENTE_SLOT; if (S) S.reserve(); heroEl = doc.getElementById('naAsstHero');
      if (!heroEl) { heroEl = el('section', 'na-asst-hero'); heroEl.id = 'naAsstHero'; heroEl.setAttribute('aria-label', 'Asistente'); var host = menu.querySelector('.main-scroll') || menu; host.insertBefore(heroEl, host.querySelector(':scope > .quick-stats') || host.firstChild); } }
    watchHero();
    if (heroEl.dataset.mode === mode && heroEl.dataset.lvl === String(access && access.level)) return;
    heroEl.dataset.mode = mode; heroEl.dataset.lvl = String(access && access.level);
    // Estilo de las maquetas v2 de Bot 4: píldora, título, subtítulo, la MISMA burbuja CSS (con brillo y órbita), campo con onda de voz y 3 chips.
    // En Inicio esta tarjeta reemplaza a la burbuja flotante (nunca salen las dos). Solo transform/opacity; se pausa con la burbuja.
    var SPARK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 0l1.8 6.2L16 8l-6.2 1.8L8 16l-1.8-6.2L0 8l6.2-1.8z"/></svg>';
    var WAVE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M3 12h1M7 9v6M11 6v12M15 9v6M19 11v2"/></svg>';
    var SEND = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>';
    var DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M7 3h7l4 4v14H7zM10 12h5M10 16h5"/></svg>';
    var BOX = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"/></svg>';
    var emp = mode === 'emp', docs = emp && access.level === 'consultas_documentos';
    // 4.º dato: texto corto para el celular de menos de 700 px (también 360, Bot 4 sobre 25ffde10), donde los 3 atajos van en UNA fila sin cortarse (alto fijo de 272 px).
    var chips = mode === 'owner' ? [['Qué me falta reponer', '¿Qué me falta reponer?', null, 'Por reponer'], ['Leer factura', null, 'photo', 'Factura'], ['Inventario valorizado', 'Imprime el inventario valorizado', null, 'Inventario']].filter(function (c) { return c[2] !== 'photo' || canPhoto(); })
      : docs ? [['Qué falta reponer', '¿Qué falta reponer?'], ['Lista de precios', 'Imprime la lista de precios'], ['Lista de pedido', 'Arma la lista de pedido para el proveedor']]
      : [['Qué falta reponer', '¿Qué falta reponer?'], ['Cómo se hace algo', '¿Cómo registro una compra?']];
    var vis = emp ? '' : '<div class="na-asst-hero-v" aria-hidden="true"><span class="h-glow"></span><span class="h-ring back"></span><span class="h-bb">' + charHtml() + '</span><span class="h-ring front"></span>' +
      '<span class="h-card c1">' + BOX + '</span><span class="h-card c2">' + DOC + '</span></div>';
    var txt = '<div class="na-asst-hero-t"><span class="h-pill">' + SPARK + (emp ? 'Asistente' : 'Asistente inteligente') + '</span><h2>' + (emp ? 'Asistente' : 'Asistente Nuevo Amanecer') + '</h2><p>' +
      (emp ? (docs ? 'Puedo ayudarte con stock, precios de venta y listas para imprimir.' : 'Puedo ayudarte con stock y precios de venta.') : 'Puedo ayudarte con stock, compras, precios y documentos.') + '</p></div>';
    if (mode === 'offline') heroEl.innerHTML = txt + vis + '<p class="h-off" role="status">Asistente no disponible sin internet. El resto de Inicio funciona normal.</p>';
    else heroEl.innerHTML = txt + vis + '<form class="h-in" autocomplete="off"><span class="h-wave">' + WAVE + '</span><input type="text" enterkeyhint="send" maxlength="500" aria-label="Pregúntale al asistente" placeholder="¿Qué deseas hacer hoy?"><button type="submit" class="h-send" aria-label="Enviar">' + SEND + '</button></form>' +
      '<div class="h-chips">' + chips.map(function (c) { return '<button type="button" class="h-chip"' + (c[3] ? ' aria-label="' + C.esc(c[0]) + '"' : '') + (c[1] ? ' data-hero-q="' + C.esc(c[1]) + '"' : '') + (c[2] ? ' data-hero-photo="1"' : '') + '>' +
        (c[3] ? '<span class="hl">' + C.esc(c[0]) + '</span><span class="hs" aria-hidden="true">' + C.esc(c[3]) + '</span>' : C.esc(c[0])) + '</button>'; }).join('') + '</div>';
    heroEl.classList.toggle('emp', emp); heroEl.classList.toggle('off', mode === 'offline');
    if (!emp) { var ch = heroEl.querySelector('.na-asst-char'); if (ch) { ch.dataset.state = state; ch.dataset.paused = rootEl ? rootEl.dataset.paused || '0' : '0'; } }
    var form = heroEl.querySelector('.h-in');
    if (form) form.onsubmit = function (e) { e.preventDefault(); var inp = form.querySelector('input'), q = inp.value.trim(); if (!q || !isAdmin() || !panelEl) return; inp.value = ''; openPanel(); send(q); };
    heroEl.onclick = function (e) { var b = e.target.closest('.h-chip'); if (!b || !isAdmin() || !panelEl) return; openPanel(); if (b.dataset.heroQ) send(b.dataset.heroQ); else if (b.dataset.heroPhoto && fileEl) fileEl.click(); };
  }

  // ---------- Configuración > Aparatos: nivel del asistente por aparato de empleado ----------
  // Se agrega DEBAJO de la lista de aparatos que ya existe (no se toca config-g.js). Guarda solo (sin botón Guardar),
  // pidiendo el PIN del dueño en la ventana de PIN del POS. El servidor exige aparato dueño + PIN y lo anota si hay bitácora.
  var LEVELS = [['off', 'Apagado'], ['consultas', 'Solo consultas'], ['consultas_documentos', 'Consultas y documentos']];
  function decorateConfig() {
    if (offHere() || !isOwnerAccess() || root.navigator.onLine === false) return;
    // Puede haber dos pantallas de Configuración (v9 y la anterior): se decora cada lista visible una sola vez.
    doc.querySelectorAll('#naDevList').forEach(function (list) { var host = list.parentElement; if (host && !host.querySelector('.na-asst-acc')) decorateOne(host); });
  }
  function decorateOne(host) {
    var box = el('div', 'na-asst-acc'); box.innerHTML = '<h4>Asistente en aparatos de empleado</h4><p class="na-asst-acc-n">Apagado por defecto. Al cambiar se pide tu PIN y se guarda solo. Cualquier cambio de stock, precio o compra que proponga el asistente igual necesita tu PIN.</p><div class="na-asst-acc-l">Cargando…</div>';
    host.appendChild(box);
    decorateOwners(host, box);
    get(ACCESS_PATH).then(function (d) { paintAccess(box, d); }, function () { box.querySelector('.na-asst-acc-l').textContent = 'No se pudo cargar. Revisa internet.'; });
    decorateProvider(host);
  }
  var ACCESS_PATH = '/auth/assistant/employee-access';

  // ---------- Configuración > Asistente: proveedor de IA (solo dueño) ----------
  // Lista del servidor con «Conectado» / «Falta clave» (nunca se ve una clave ni una URL). «Probar» hace una llamada chica.
  // Cambiar: «Usar» -> tarjeta Confirmar (sin PIN). El servidor exige sesión dueño en el aparato dueño; un empleado recibe 403 y no ve el bloque.
  var PROVIDER_PATH = '/auth/assistant/provider';
  function decorateProvider(host) {
    var box = el('div', 'na-asst-prov'); box.hidden = true;
    box.innerHTML = '<h4>Asistente: proveedor de IA</h4><p class="na-asst-acc-n">Las claves se ponen en el servidor, nunca aquí. Solo se puede elegir un proveedor que ya tenga clave.</p><p class="na-asst-prov-cur" role="status"></p><div class="na-asst-prov-l" role="list"></div>';
    host.appendChild(box);
    var list = box.querySelector('.na-asst-prov-l'), data = null;
    function find(id) { for (var i = 0; data && i < data.providers.length; i++) if (data.providers[i].id === id) return data.providers[i]; return null; }
    function paint(d) {
      if (!d || !d.providers) { box.hidden = true; return; } // 403 o 404: sin bloque
      data = d; box.hidden = false;
      // «En uso» desde el inicio (Bot 4): lo que el servidor ya resolvió (elección del dueño o la del servidor). Sin proveedor listo, se dice.
      var curEl = box.querySelector('.na-asst-prov-cur'), anyOk = d.providers.some(function (p) { return p.connected; });
      if (curEl) curEl.textContent = d.current ? 'En uso: ' + (d.current.label || d.current.provider) + (d.current.model ? ' · ' + d.current.model : '') + (d.current.source === 'env' ? ' (del servidor)' : '')
        : anyOk ? 'En uso: ninguno todavía. Se elige con «Usar» en un proveedor conectado.' : 'En uso: ninguno. Falta poner una clave en el servidor.';
      list.innerHTML = d.providers.map(function (p) {
        var models = p.models || [], cur = p.current && d.current ? d.current.model : null;
        return '<div class="na-asst-prov-r" role="listitem" data-prov="' + C.esc(p.id) + '"><div><strong>' + C.esc(p.label) + (p.current ? ' <em>En uso</em>' : '') + '</strong>' +
          '<small class="' + (p.connected ? 'ok' : 'off') + '">' + C.esc(p.status) + (cur ? ' · ' + C.esc(cur) : '') + '</small><small class="st" role="status"></small></div>' +
          (p.connected ? '<div class="na-asst-prov-a">' + (models.length > 1 ? '<select aria-label="Modelo de ' + C.esc(p.label) + '">' + models.map(function (m) { return '<option' + (m === cur ? ' selected' : '') + '>' + C.esc(m) + '</option>'; }).join('') + '</select>' : '') +
            '<button type="button" class="na-asst-prov-t" data-act="test">Probar</button>' + (p.current && models.length < 2 ? '' : '<button type="button" class="na-asst-ok" data-act="use">Usar</button>') + '</div>' : '') + '</div>';
      }).join('');
    }
    function confirmCard(row, p, model, op) {
      var old = box.querySelector('.na-asst-prov-c'); if (old) old.remove();
      var c = el('div', 'na-asst-prov-c'); c.setAttribute('role', 'group'); c.setAttribute('aria-label', 'Confirmar cambio de proveedor');
      c.innerHTML = '<p>¿Usar <strong>' + C.esc(p.label) + '</strong>' + (model ? ' (' + C.esc(model) + ')' : '') + ' en el asistente? Aplica desde la próxima pregunta, en todos los aparatos.</p>' +
        '<button type="button" class="na-asst-ok" data-act="confirm" data-op="' + C.esc(op) + '">Confirmar</button><button type="button" class="na-asst-no" data-act="cancel">Cancelar</button>';
      row.appendChild(c); c.querySelector('[data-act=confirm]').focus();
    }
    box.onclick = function (e) {
      var b = e.target.closest('button'); if (!b || !isOwnerAccess()) return; // solo en modo Admin con acceso de dueño
      var row = b.closest('[data-prov]'), p = row && find(row.dataset.prov); if (!p) return;
      var st = row.querySelector('.st'), sel = row.querySelector('select'), model = sel ? sel.value : null, act = b.dataset.act;
      if (act === 'test') {
        b.disabled = true; st.textContent = 'Probando…';
        post(PROVIDER_PATH + '/test', { provider: p.id, model: model }, null, 15000).then(function (r) { st.textContent = r && r.message ? r.message : r && r.error === 'rate_limited' ? 'Espera un minuto y prueba otra vez.' : 'No se pudo probar.'; },
          function () { st.textContent = 'No se pudo probar. Revisa internet.'; }).then(function () { b.disabled = false; });
      } else if (act === 'use') {
        // El servidor arma la tarjeta: operation_id de un solo uso que vence en 5 minutos.
        b.disabled = true; st.textContent = '';
        post(PROVIDER_PATH + '/select', { provider: p.id, model: model }, null, 15000).then(function (r) {
          b.disabled = false; if (r && r.ok && r.operation_id) confirmCard(row, p, r.model || model, r.operation_id);
          else st.textContent = r && r.error === 'provider_not_ready' ? 'Falta la clave en el servidor.' : 'No se pudo preparar el cambio.';
        }, function () { b.disabled = false; st.textContent = 'No se pudo preparar el cambio. Revisa internet.'; });
      }
      else if (act === 'cancel') { var c = row.querySelector('.na-asst-prov-c'); if (c) c.remove(); }
      else if (act === 'confirm') {
        b.disabled = true;
        post(PROVIDER_PATH + '/select', { operation_id: b.dataset.op, confirm: true }, null, 15000).then(function (r) {
          if (r && r.ok) { paint(r); var s2 = list.querySelector('[data-prov="' + p.id + '"] .st'); if (s2) s2.textContent = 'Listo. El asistente usa ' + p.label + '.'; return; }
          var c = row.querySelector('.na-asst-prov-c'); if (c) c.remove();
          st.textContent = r && r.error === 'provider_not_ready' ? 'Falta la clave en el servidor.' : r && r.error === 'confirm_expired' ? 'La tarjeta venció. Toca «Usar» otra vez.' : r && r.error === 'already_confirmed' ? 'Ese cambio ya se hizo.' : 'No se pudo cambiar.';
        }, function () { st.textContent = 'No se pudo cambiar. Revisa internet.'; b.disabled = false; });
      }
    };
    get(PROVIDER_PATH).then(paint, function () { box.hidden = true; });
  }

  // ---------- Aparatos de dueño y «Pendiente de aprobar» (maquetas v2). Solo si el servidor tiene ASSISTANT_OWNER_BOOTSTRAP=1;
  // si la ruta responde 404 no se muestra nada. Aprobar, rechazar y quitar piden PIN -> aprobación estricta 'assistant.owner_device'.
  var OWNER_DEV_PATH = '/auth/assistant/owner-device';
  function newOp(prefix) { return prefix + '-' + (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); }
  function pinMsg(e) { e = String(e || ''); return /locked/.test(e) ? 'Demasiados intentos. Espera 15 min.' : /pin/.test(e) ? 'PIN incorrecto.' : ''; }
  // Pide el PIN (ventana de PIN del POS; en el prototipo local, prompt), saca una aprobación de UN uso para esta operación y llama run(op, approvalId).
  function withApproval(title, action, run) {
    var save = async function (pin) {
      var op = newOp('ODV'), apr = await post('/auth/owner-approval', { pin: pin, action: action, operation_id: op }, null, 15000);
      if (!apr || !apr.approval_id) { var ea = String(apr && apr.error || ''); return { msg: pinMsg(ea) || 'No se pudo verificar el PIN.', stop: !/pin_invalid/.test(ea) }; }
      var r = await run(op, apr.approval_id); return r && r.ok ? { ok: true } : { msg: (r && r.msg) || 'No se pudo guardar.', stop: true };
    };
    var R = root.NA_ROLES;
    if (R && typeof R.askPin === 'function' && creds()) return R.askPin(title, 'Escribe tu PIN de Admin.', save);
    var pin = root.prompt ? root.prompt(title + ': PIN del Admin') : ''; if (!pin) return Promise.resolve(false);
    return save(pin).then(function (r) { return r.ok ? true : (r.msg || false); });
  }
  var PHONE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var TABLET_SVG = '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  function devIcon(label) { return /tablet|caja|pc|laptop/i.test(label || '') ? TABLET_SVG : PHONE_SVG; }
  function decorateOwners(host, before) {
    var box = el('div', 'na-asst-own'); box.hidden = true; host.insertBefore(box, before);
    var paint = function () {
      get(OWNER_DEV_PATH).then(function (d) {
        if (!d || !d.owners) { box.hidden = true; return; }
        box.hidden = false;
        var own = d.owners.map(function (o) {
          return '<div class="na-asst-own-r" data-dev="' + C.esc(o.device_id) + '"><span class="ic" aria-hidden="true">' + devIcon(o.label) + '</span><div><strong>' + C.esc(o.label || 'Aparato de Admin') +
            (o.this_device ? ' <em>Este teléfono</em>' : '') + '</strong><small class="st" role="status">' + (o.last_seen_at ? 'Último uso: ' + C.esc(String(o.last_seen_at).slice(0, 16).replace('T', ' ')) : '') + '</small></div>' +
            (d.owners.length <= 1 ? '<button type="button" class="na-asst-quitar" data-quitar="1" disabled aria-disabled="true" title="Es el único aparato Admin">Quitar</button></div>' +
              '<p class="na-asst-own-only">Es el único aparato Admin. Registra otro antes de quitarlo.</p>'
              : '<button type="button" class="na-asst-quitar" data-quitar="1">Quitar</button></div>'); }).join('');
        var pend = (d.pending || []).map(function (p) {
          return '<div class="na-asst-own-r pend" data-dev="' + C.esc(p.device_id) + '"><span class="ic" aria-hidden="true">' + PHONE_SVG + '</span><div><strong>' + C.esc(p.label || 'Teléfono nuevo') + '</strong><small class="st" role="status">Pidió ser Admin: ' + C.esc(String(p.requested_at || '').slice(0, 16).replace('T', ' ')) + '</small></div></div>' +
            '<div class="na-asst-own-a" data-dev="' + C.esc(p.device_id) + '"><button type="button" class="na-asst-ok" data-decision="approve">Aprobar</button><button type="button" class="na-asst-no" data-decision="reject">Rechazar</button></div>'; }).join('');
        box.innerHTML = '<h4>Aparatos de Admin (' + d.owners.length + ')</h4>' + own +
          '<p class="na-asst-own-w">Un teléfono nuevo de Admin se aprueba solo desde un teléfono de Admin que ya esté en esta lista.</p>' +
          (pend ? '<h4>Pendiente de aprobar (' + d.pending.length + ')</h4>' + pend : '');
      }, function () { box.hidden = true; });
    };
    box.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var row = b.closest('[data-dev]'), dev = row && row.dataset.dev; if (!dev) return;
      var stEl = (b.closest('.na-asst-own-a') ? b.closest('.na-asst-own-a').previousElementSibling : row).querySelector('.st');
      if (b.dataset.quitar) {
        // Aviso antes de quitar cualquier aparato dueño. El servidor nunca deja quitar el último (409 last_owner).
        var only = box.querySelectorAll('[data-quitar]').length <= 1;
        if (only) { stEl.textContent = 'Es el único aparato Admin. Registra otro antes de quitarlo.'; return; }
        if (root.confirm && !root.confirm('¿Quitar este aparato como Admin? Deja de ver el asistente de gestión y de aprobar cambios. Puedes volver a registrarlo después.')) return;
        withApproval('Quitar aparato de Admin', 'assistant.owner_device', async function (op, apr) {
          var r = await post(OWNER_DEV_PATH + '/revoke', { device_id: dev, operation_id: op }, { 'x-owner-approval': apr }, 15000);
          if (r && r.ok) { paint(); return { ok: true }; }
          return { msg: r && (r.code === 'last_owner' || r.error === 'last_owner') ? 'Es el único aparato Admin. Registra otro antes de quitarlo.' : 'No se pudo quitar.' };
        }).then(function (ok) { if (ok !== true) stEl.textContent = typeof ok === 'string' ? ok : 'Sin cambios.'; });
        return;
      }
      var dec = b.dataset.decision; if (!dec) return;
      withApproval(dec === 'approve' ? 'Aprobar teléfono de Admin' : 'Rechazar teléfono', 'assistant.owner_device', async function (op, apr) {
        var r = await post(OWNER_DEV_PATH + '/approve', { device_id: dev, operation_id: op, decision: dec }, { 'x-owner-approval': apr }, 15000);
        if (r && r.ok) { paint(); return { ok: true }; } return { msg: 'No se pudo guardar.' };
      }).then(function (ok) { if (ok !== true) stEl.textContent = typeof ok === 'string' ? ok : 'Sin cambios.'; });
    };
    paint();
  }

  // ---------- «Registrar este teléfono como dueño»: solo en un aparato SIN rol (el POS lo trata como dueño pero el asistente no),
  // nunca automático: botón + PIN. Si ya hay dueño queda «esperando aprobación». El servidor decide todo (bandera, 0 dueños, límite de PIN).
  function decorateRegister() {
    if (offHere() || isOwnerAccess() || root.navigator.onLine === false) return;
    // Teléfono de empleado (con el asistente encendido; uno en Apagado no baja este código): aviso fijo, sin botón ni PIN.
    if (access && access.role === 'empleado') {
      doc.querySelectorAll('#naDevList').forEach(function (list) {
        var host = list.parentElement; if (!host || host.querySelector('.na-asst-reg')) return;
        var box = el('div', 'na-asst-reg'); box.dataset.state = 'emp';
        box.innerHTML = '<h4>Este teléfono</h4><p class="st" role="status">Este teléfono ya es de empleado y no puede pasar a Admin así.</p><p>Si de verdad debe ser del Admin, el Admin lo cambia desde su teléfono en Usuarios y Aparatos.</p>';
        host.insertBefore(box, host.firstChild);
      });
      return;
    }
    if (!noRole || !bootstrapOn) return;
    doc.querySelectorAll('#naDevList').forEach(function (list) {
      var host = list.parentElement; if (!host || host.querySelector('.na-asst-reg')) return;
      var box = el('div', 'na-asst-reg');
      box.innerHTML = '<h4>Registrar este teléfono como Admin</h4><p>Hazlo solo en el teléfono del Admin. Escribe tu PIN de Admin. El PIN no se guarda en el teléfono.</p>' +
        '<label>Escribe tu PIN de Admin<input type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label><p class="st" role="status"></p>' +
        '<button type="button" class="na-asst-ok">Registrar este teléfono como Admin</button>' +
        '<p class="na-asst-own-w">Si ya hay un teléfono de Admin, este quedará esperando hasta que lo apruebes desde ese teléfono.</p>';
      host.insertBefore(box, host.firstChild);
      var inp = box.querySelector('input'), btn = box.querySelector('button'), st = box.querySelector('.st');
      btn.onclick = async function () {
        var pin = inp.value.trim(); inp.value = ''; if (!pin) { st.textContent = 'Escribe tu PIN de Admin.'; return; }
        btn.disabled = true; var r = await post(OWNER_DEV_PATH + '/register', { pin: pin }, null, 15000);
        if (r && r.ok) { st.textContent = 'Listo: este teléfono es de Admin.'; box.dataset.state = 'ok'; refreshAccess(); return; }
        if (r && r.pending) { st.textContent = 'Esperando aprobación desde el teléfono del Admin.'; box.dataset.state = 'pend'; return; }
        var e = String(r && r.error || '');
        if (/locked|too_many/.test(e) || (r && r.locked_until)) { st.textContent = 'Demasiados intentos. Espera 15 min.'; inp.disabled = true; inp.placeholder = 'Bloqueado'; box.dataset.state = 'lock'; return; }
        if (/employee/.test(e)) { st.textContent = 'Este teléfono ya es de empleado y no puede pasar a Admin así.'; box.dataset.state = 'emp'; return; }
        btn.disabled = false; st.textContent = /pin/.test(e) ? 'PIN incorrecto.' + (r.attempts_left != null ? (Number(r.attempts_left) === 1 ? ' Te queda 1 intento.' : ' Te quedan ' + r.attempts_left + ' intentos.') : '') : r && r.error === 'not_found' ? 'Esta opción todavía no está activa en el servidor.' : 'No se pudo registrar.';
      };
    });
  }

  function paintAccess(box, d) {
    var l = box.querySelector('.na-asst-acc-l');
    if (!d || !d.devices) { l.textContent = (d && d.error === 'admin_only') ? 'Solo el aparato del Admin puede cambiar esto.' : 'No se pudo cargar.'; return; }
    if (!d.devices.length) { l.textContent = 'No hay aparatos de empleado vinculados.'; return; }
    l.innerHTML = d.devices.map(function (x, i) {
      return '<div class="na-asst-acc-r" data-dev="' + C.esc(x.device_id) + '" data-cur="' + C.esc(x.level) + '"><div><strong>' + C.esc(x.label || 'Aparato de empleado') + '</strong><small class="st" role="status"></small></div>' +
        '<div class="na-asst-seg" role="radiogroup" aria-label="Asistente en ' + C.esc(x.label || 'aparato') + '">' + LEVELS.map(function (L) {
          return '<label><input type="radio" name="naAsstLvl' + i + '" value="' + L[0] + '"' + (L[0] === x.level ? ' checked' : '') + '><span>' + L[1] + '</span></label>'; }).join('') + '</div></div>';
    }).join('');
    l.onchange = function (e) {
      var inp = e.target; if (!inp || inp.type !== 'radio') return;
      var row = inp.closest('.na-asst-acc-r'), st = row.querySelector('.st'), prev = row.dataset.cur, lvl = inp.value;
      function revert(msg) { var r = row.querySelector('input[value="' + prev + '"]'); if (r) r.checked = true; st.textContent = msg || ''; }
      var R = root.NA_ROLES;
      // PIN del dueño -> aprobación 'assistant.employee_access' ligada a ESTE cambio (operation_id) -> el servidor la gasta una vez.
      var save = async function (pin) {
        var op = 'ACC-' + (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        var apr = await post('/auth/owner-approval', { pin: pin, action: 'assistant.employee_access', operation_id: op }, null, 15000);
        if (!apr || !apr.approval_id) { var ea = String(apr && apr.error || ''); return { msg: /locked/.test(ea) ? 'Demasiados intentos. Espera unos minutos.' : /pin/.test(ea) ? 'PIN incorrecto.' : 'No se pudo verificar el PIN.', stop: !/pin_invalid/.test(ea) }; }
        var res = await post(ACCESS_PATH, { device_id: row.dataset.dev, level: lvl, operation_id: op }, { 'x-owner-approval': apr.approval_id }, 15000);
        if (res && res.ok) { row.dataset.cur = lvl; st.textContent = 'Guardado' + (res.logged ? '' : ' (sin bitácora en este servidor)'); return { ok: true }; }
        var e2 = String(res && res.error || '');
        return { msg: /locked/.test(e2) ? 'Demasiados intentos. Espera unos minutos.' : /pin/.test(e2) ? 'PIN incorrecto.' : 'No se pudo guardar.', stop: !/pin_invalid/.test(e2) };
      };
      if (R && typeof R.askPin === 'function' && creds()) {
        R.askPin('Asistente: ' + LEVELS.filter(function (L) { return L[0] === lvl; })[0][1], 'Escribe tu PIN de Admin.', save).then(function (ok) { if (!ok) revert('Sin cambios.'); });
      } else {
        // Prototipo local sin sesión: PIN en una ventana simple del navegador.
        var pin = root.prompt ? root.prompt('PIN del Admin para cambiar el asistente') : '';
        if (!pin) { revert('Sin cambios.'); return; }
        save(pin).then(function (r) { if (!r.ok) revert(r.msg); });
      }
    };
  }
  async function get(path) {
    var c = creds(), url = path, h = {};
    if (c) { url = c.endpoint.replace(/\/+$/, '') + path; h.authorization = 'Bearer ' + c.token; }
    else if (protoRole()) h['x-proto-role'] = protoRole();
    var r = await C.request(root.fetch.bind(root), url, c ? { method: 'GET', headers: h, cache: 'no-store', credentials: 'omit', redirect: 'error' } : { method: 'GET', headers: h, cache: 'no-store' }, 10000);
    var d = r.data || {}; if (!r.ok) d.error = d.error || 'HTTP_' + r.status; return d;
  }

  function mount() {
    if (offHere()) return;
    if (doc.querySelector('.na-asst-root')) return; // se construye una sola vez
    // Sin permiso del servidor no se arma nada (ni burbuja ni panel).
    if (!isAdmin()) return;
    rootEl = el('div', 'na-asst-root'); rootEl.dataset.state = 'listo';
    rootEl.innerHTML = '<span class="na-asst-tag" aria-hidden="true"></span><button type="button" class="na-asst-bubble" aria-label="Abrir asistente Burbuja">' + charHtml() + '</button>';
    tagEl = rootEl.querySelector('.na-asst-tag');
    panelEl = el('section', 'na-asst-panel'); panelEl.hidden = true; panelEl.setAttribute('role', 'dialog'); panelEl.setAttribute('aria-label', 'Asistente Burbuja');
    panelEl.innerHTML = '<div class="na-asst-head">' + charHtml() + '<div class="na-asst-head-t"><b>Burbuja</b><small>' + (isOwnerAccess() ? 'Gestión · Admin · prueba aislada' : 'Consultas · empleado · prueba aislada') + '</small></div><button type="button" class="na-asst-reset" title="Empezar de cero">Nueva conversación</button><button type="button" class="na-asst-x" aria-label="Cerrar asistente">✕</button></div>' +
      '<div class="na-asst-offline" hidden>Asistente no disponible sin internet</div><div class="na-asst-msgs"></div><div class="na-asst-live" aria-live="polite" aria-atomic="true"></div>' +
      '<div class="na-asst-chips">' + chipsHtml() + '</div>' +
      '<div class="na-asst-input"><button type="button" class="na-asst-photo" aria-label="Enviar foto o PDF" title="Tomar foto o subir foto/PDF"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg></button><input type="file" accept="image/*,application/pdf,.pdf" hidden>' +
      '<textarea rows="1" placeholder="Escribe aquí…" aria-label="Mensaje para el asistente"></textarea><button type="button" class="na-asst-send" aria-label="Enviar">➤</button></div>';
    doc.body.appendChild(rootEl); doc.body.appendChild(panelEl);
    msgsEl = panelEl.querySelector('.na-asst-msgs'); liveEl = panelEl.querySelector('.na-asst-live');
    // solo para lector de pantalla, también si la hoja del asistente llega vieja o tarde (si no, la respuesta salía DOS veces, debajo)
    if (liveEl && liveEl.style) liveEl.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    newBtn = el('button', 'na-asst-new'); newBtn.type = 'button'; newBtn.textContent = 'Ver nuevo ↓'; newBtn.hidden = true; newBtn.onclick = scrollEnd; msgsEl.appendChild(newBtn);
    msgsEl.addEventListener('scroll', function () { if (!newBtn.hidden && (atBottom() || noteSeen())) newBtn.hidden = true; }, { passive: true });
    inputEl = panelEl.querySelector('textarea'); sendBtn = panelEl.querySelector('.na-asst-send');
    photoBtn = panelEl.querySelector('.na-asst-photo'); fileEl = panelEl.querySelector('input[type=file]'); offEl = panelEl.querySelector('.na-asst-offline');
    rootEl.querySelector('.na-asst-bubble').onclick = openPanel;
    panelEl.querySelector('.na-asst-x').onclick = closePanel;
    panelEl.querySelector('.na-asst-reset').onclick = newChat;
    sendBtn.onclick = function () { send(inputEl.value); };
    inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inputEl.value); } });
    photoBtn.onclick = function () { fileMode = ''; fileEl.click(); };
    // Sin «capture»: el teléfono ofrece cámara, galería o archivos. Fotos y PDF (el PDF se pasa a imagen EN EL APARATO); Word/Excel: aún no.
    fileEl.onchange = function () { var f = fileEl.files && fileEl.files[0], mode = fileMode; fileMode = ''; fileEl.value = ''; if (!f) return;
      var k = fileKind(f);
      if (k === 'doc') { addMsg('a', 'Por ahora leo fotos y PDF. Si es Word o Excel, guárdelo como PDF o tómele una foto y súbalo.'); return; }
      if (k === 'other') { addMsg('a', 'Ese archivo no lo puedo leer. Suba una foto o un PDF.'); return; }
      if (k === 'pdf' && !isOwnerAccess()) { errMsg('image_owner_only'); return; }
      var got = k === 'pdf' ? pdfImage(f) : Promise.resolve({ blob: f });
      if (mode === 'boleta') { if (isOwnerAccess()) got.then(function (r) { boletaStart(r.blob); }, function () {}); return; }
      if (mode === 'producto') { if (isOwnerAccess()) got.then(function (r) { prodFotoStart(r.blob); }, function () {}); return; }
      got.then(function (r) { return compress(r.blob).then(function (img) { send(inputEl.value || 'Lee esta factura de compra', img); }, function () { addMsg('a', k === 'pdf' ? 'No pude abrir ese PDF.' : 'No pude abrir esa foto.'); setState('error', 2000); }); }, function () {}); };
    panelEl.querySelector('.na-asst-chips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; if (b.hasAttribute('data-photo')) { fileMode = ''; fileEl.click(); } else if (b.hasAttribute('data-boleta')) boletaPick(); else if (b.hasAttribute('data-prodfoto')) prodFotoPick(); else send(b.dataset.q); });
    shownFor = access ? access.role + ':' + access.level + ':' + (access.vision === false ? 'nv' : 'v') : '';
    if (photoBtn) photoBtn.hidden = !canPhoto(); // empleado o proveedor sin fotos: sin botón
    rootEl.addEventListener('pointerdown', wake, { passive: true }); panelEl.addEventListener('pointerdown', wake, { passive: true });
    try { bubbleIO = new IntersectionObserver(function (es) { offscreen = !es[0].isIntersecting; applyPause(); }); bubbleIO.observe(rootEl.querySelector('.na-asst-bubble')); } catch (_) {}
    applyQuality(); place(); applyPause(); setState(root.navigator.onLine === false ? 'offline' : 'listo');
    // Escuchas de la ventana: UNA sola vez (si el dueño quita y vuelve a dar el permiso, la burbuja se arma de nuevo sin duplicarlas).
    if (wired) return; wired = true;
    root.addEventListener('online', function () { offline(false); });
    root.addEventListener('offline', function () { offline(true); });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) applyPause(); else wake(); });
    root.addEventListener('scroll', function (e) { var t = e && e.target; if (t && t.nodeType === 1 && panelEl && panelEl.contains(t)) return; hold(); }, { passive: true, capture: true }); // el autodesplazamiento del chat no pausa la cara del panel
    doc.addEventListener('input', function (e) { if (e.target && e.target.closest && e.target.closest('.na-asst-panel, .na-asst-hero')) hold(); }, true);
    root.addEventListener('resize', place);
    setInterval(function () { if (doc.hidden || sleeping) return; place(); applyPause(); }, 1000); // quieta: el MutationObserver y los toques recolocan
    // Recolocar enseguida al cambiar de pantalla o abrir/cerrar ventanas (sin esperar el segundo).
    var raf = 0; function soon() { if (raf) return; raf = root.requestAnimationFrame(function () { raf = 0; place(); applyPause(); }); }
    try { var mo = new MutationObserver(soon); doc.querySelectorAll('.page, .modal-overlay, #cartDrawer').forEach(function (n) { mo.observe(n, { attributes: true, attributeFilter: ['class'] }); });
      new MutationObserver(soon).observe(doc.body, { childList: true }); } catch (_) {}
    doc.addEventListener('click', soon, true);
    watchBattery(); setTimeout(measureFrames, 1500);
  }

  // Arranque: después de que el POS terminó de cargar (load + momento libre), primero se pregunta al servidor.
  function boot() {
    refreshAccess();
    root.addEventListener('online', idleRefresh);
    root.addEventListener('offline', function () { lastPing = 0; renderHero(); }); // al reconectar se pregunta enseguida
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) idleRefresh(); });
    var tick = 0; function check() { if (tick) return; tick = setTimeout(function () { tick = 0; if (!doc.hidden) { renderHero(); decorateConfig(); decorateRegister(); } }, 250); }
    try { new MutationObserver(check).observe(doc.body, { childList: true, subtree: true }); } catch (_) {}
    var menu = doc.getElementById('pageMenu');
    try { if (menu) new MutationObserver(function () { if (menu.classList.contains('active')) idleRefresh(); else if (heroDeferred) renderHero(); }).observe(menu, { attributes: true, attributeFilter: ['class'] }); } catch (_) {}
  }
  root.NA_ASISTENTE = { suspend: suspend, resume: resume, open: function () { if (panelEl) openPanel(); }, close: function () { if (panelEl) closePanel(); }, setState: setState, send: send, _gate: gate, _deps: deps, get quality() { return quality; }, place: place, refreshAccess: refreshAccess, get access() { return access; } };
  function later() { (root.requestIdleCallback || function (f) { setTimeout(f, 300); })(boot, { timeout: 2500 }); }
  if (doc.readyState === 'complete') later(); else root.addEventListener('load', later);
})(window);
