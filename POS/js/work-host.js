/* WORK host — isolated frame, same-origin only. The canonical POS remains authoritative. */
(function (root) {
  'use strict';
  if (!root.document || root.NA_WORK_HOST) return;
  var doc = root.document, overlay = null, frame = null, launcher = null;
  var allowedPages = Object.freeze({
    'pageMenu':true,'pagePOS':true,'pageVentas':true,'pageInventario':true,
    'pageClientes':true,'pageCaja':true,'pageGastos':true,
    'pageProximamente':true,'pageConfig':true
  });
  function isHome() { var p=doc.getElementById('pageMenu'); return !!(p && p.classList.contains('active')); }
  // WORK is the default Inicio experience; ?work=0 is a reversible legacy fallback.
  // The fallback does not affect sales, cash, local outbox or canonical storage.
  // Only the authenticated hosted CANON opens WORK by default.
  // Local tests retain the current screens; ?work=1 exercises the new interface.
  var featureEnabled = !!(root.NA_HOSTED_CONFIG &&
    root.NA_HOSTED_CONFIG.environment === 'production'), temporarilyLegacy = false;
  try {
    var mode = new URLSearchParams(root.location.search).get('work');
    if (mode === '1') featureEnabled = true;
    if (mode === '0') featureEnabled = false;
  } catch (_) {}
  function sessionReady() {
    return !(root.NA_HOSTED_CONFIG && root.NA_HOSTED_CONFIG.environment === 'production') ||
      !!(root.NA_ROLES && root.NA_ROLES.confirmed === true);
  }
  function ownerDataAllowed() {
    try { return sessionReady() && !!(root.NA_ROLES && root.NA_ROLES.isOwner() === true); } catch (_) { return false; }
  }
  var parked = false; // WORK oculto (no cerrado): conserva la conversación y las tarjetas mientras se ve la ficha del POS
  function syncButton() { if (launcher) launcher.hidden = !isHome() || (!!overlay && !parked) || !featureEnabled || !temporarilyLegacy; }
  var identity = null;
  function syncView() {
    var roles = root.NA_ROLES;
    var nextIdentity = sessionReady() && roles ? String(roles.role || 'unknown') + ':' + String(roles.deviceId || '') : null;
    if (identity !== nextIdentity) { identity = nextIdentity; close(); }

    if (!isHome() || temporarilyLegacy || !featureEnabled || doc.getElementById('naRevoked')) releasePre();
    if (!sessionReady() || !isHome()) {
      temporarilyLegacy = false;
      if (overlay) close();
    } else if (featureEnabled && !temporarilyLegacy && !overlay) {
      open();
    }
    syncButton();
  }
  function realMetrics() {
    if (!ownerDataAllowed()) return [];
    var items = Array.from(doc.querySelectorAll('#pageMenu .quick-stats .qs-card'));
    return items.map(function (card) {
      var label = card.querySelector('.qs-label'), value = card.querySelector('.qs-val'), detail = card.querySelector('.qs-sub');
      return {label:label ? label.textContent.trim() : '',value:value ? value.textContent.trim() : '',detail:detail ? detail.textContent.trim() : ''};
    }).filter(function (x) {return x.label && x.value;});
  }
  function realActivity() {
    if (!ownerDataAllowed()) return [];
    var list = doc.getElementById('naMobileActivityList');
    if (!list) return [];
    return Array.from(list.querySelectorAll('.na-mobile-activity-row')).slice(0,6).map(function (el) {
      function val(selector) { var n=el.querySelector(selector); return n ? String(n.textContent||'').trim().slice(0,150) : ''; }
      return {title:val('.na-mobile-activity-copy strong'),client:val('.na-mobile-activity-copy small:not(.na-mobile-activity-time)'),
        date:val('.na-mobile-activity-time'),amount:val('.na-mobile-activity-value')};
    }).filter(function (x) {return x.title && x.title !== 'Sin movimientos recientes';});
  }
  function initPayload() {
    var roles=root.NA_ROLES, owner=false;
    try { owner=!!(roles && typeof roles.isOwner==='function' && roles.isOwner()===true); } catch (_) {}
    return {action:'init',metrics:realMetrics(),activity:realActivity(),role:owner?'Dueño':'Empleado'};
  }
  // Marca de <html> que pone index.html en <head> para que no se vea el Inicio viejo antes de WORK (ver «na-work-pre»). Se quita en cuanto
  // WORK cubre la pantalla, o en cuanto ya no va a abrirse (otra pantalla, ?work=0, sesión sin confirmar al tope de 3,5 s; si este archivo no carga, la libera index.html).
  function releasePre() { try { doc.documentElement.classList.remove('na-work-pre', 'na-work-pre-dk'); } catch (_) {} }
  // Solo se reenvían a WORK las cifras cuando cambiaron (antes: cada 10 s y dos veces al abrir, y WORK repintaba todo cada vez).
  var lastInit = '', refreshTimer = 0;
  function pushInit(force) {
    if (!overlay || !frame || !isHome() || (doc.hidden && !force)) return;
    var payload = initPayload(), sig = JSON.stringify(payload);
    if (!force && sig === lastInit) return;
    lastInit = sig;
    respond(frame.contentWindow, payload);
  }
  // Las cifras se leen del Inicio del POS, que se pinta cuando CANON termina de sincronizar: se empujan a WORK al instante (con una pausa corta
  // para agrupar cambios) en vez de esperar al reloj de 10 s.
  function scheduleInit() {
    if (!overlay || refreshTimer) return;
    refreshTimer = root.setTimeout(function () { refreshTimer = 0; pushInit(false); }, 250);
  }
  function respond(target, data) {
    if (target && frame && target === frame.contentWindow) {
      target.postMessage(Object.assign({type:'na-work:response'},data),root.location.origin);
    }
  }
  var history = [], generation = 0, busy = false, cards = Object.create(null), cardSeq = 0;
  var MAX_TEXT = 1500, MAX_CARDS = 30;
  function engine() { var a = root.NA_ASISTENTE; return a && a.engine ? a.engine : null; }
  function core() { return root.NA_ASISTENTE_CORE || null; }
  // Las tarjetas de confirmación viven en el motor del asistente original (puerta con token firmado de un solo uso).
  // Al cerrar o reiniciar WORK se cancelan las que sigan pendientes (no quedan tarjetas huérfanas con datos).
  function dropCards() {
    var e = engine();
    Object.keys(cards).forEach(function (k) {
      var rec = cards[k];
      if (rec && rec.gated && e) { try { e.cancel(k, 'cancelada'); } catch (_) {} try { e.forget(k); } catch (_) {} }
    });
    cards = Object.create(null);
  }
  function resetConversation() { dropCards(); history = []; generation++; busy = false; }
  function close() {
    resetConversation(); parked = false;
    if (overlay) { overlay.remove(); overlay=null; frame=null; doc.body.classList.remove('na-work-open'); }
    syncButton();
  }
  // Oculta WORK sin destruirlo (la ficha del POS queda a la vista y el chat sigue ahí al volver con «✦ WORK»).
  // Salir de Inicio, cambiar de rol o «Volver al POS» sí lo cierra del todo (close()).
  function park() {
    if (!overlay) return;
    temporarilyLegacy = true; parked = true; overlay.hidden = true; doc.body.classList.remove('na-work-open'); syncButton();
  }
  function unpark() {
    if (!overlay || !parked) return false;
    parked = false; overlay.hidden = false; doc.body.classList.add('na-work-open'); syncButton();
    if (frame) respond(frame.contentWindow, initPayload());
    return true;
  }
  function open() {
    if (unpark()) return;
    if (overlay || !doc.body || !sessionReady()) return;
    overlay=doc.createElement('section');
    overlay.id='naWorkOverlay';
    overlay.setAttribute('aria-label','WORK — Nuevo Amanecer');
    frame=doc.createElement('iframe');
    frame.src='work/index.html';
    frame.title='WORK — Nuevo Amanecer';
    frame.setAttribute('allow','microphone');
    overlay.appendChild(frame);
    doc.body.appendChild(overlay);
    doc.body.classList.add('na-work-open');
    lastInit = '';
    releasePre(); // WORK ya cubre la pantalla: el Inicio viejo no llega a verse
    frame.addEventListener('load',function () {
      pushInit(false);
    });
    // El chat necesita el motor del asistente: se pregunta al servidor ahora (misma consulta de siempre, máx. una cada 10 s) en vez de esperar
    // al momento libre posterior a la carga (hasta 2,5 s).
    try { var L = root.NA_ASISTENTE_LOADER; if (L && typeof L.ask === 'function' && typeof L.loaded === 'function' && !L.loaded()) L.ask(); } catch (_) {}
    syncButton();
  }
  // ---- Mensajes amables (nunca códigos crudos como rate_limited) ----
  var GENERIC_ERROR = 'No se pudo completar. No se hizo ningún cambio. Intenta de nuevo en un momento.';
  function friendly(code, retryAfter) {
    var C = core(), c = String(code == null ? '' : code), msg = GENERIC_ERROR;
    if (C && typeof C.friendlyError === 'function') {
      try { msg = C.friendlyError(c, null).msg || GENERIC_ERROR; } catch (_) { msg = GENERIC_ERROR; }
    } else if (/rate_limited|429/.test(c)) msg = 'Espera un momento e intenta de nuevo.';
    else if (/SIN_SESION|unauthorized|401/.test(c)) msg = 'Este aparato no tiene sesión. Entra de nuevo al sistema.';
    if (/rate_limited|HTTP_429/.test(c) && Number(retryAfter) > 0 && Number(retryAfter) <= 300) msg = 'Espera ' + Math.ceil(Number(retryAfter)) + ' segundos e intenta de nuevo.';
    return msg;
  }
  // Textos heredados del motor que hablan de «usted» o de «la compra»: aquí se dicen en «tú» y según el tipo de tarjeta.
  function tu(text, type) {
    return String(text == null ? '' : text).replace(/Vuelva a entrar/g, 'Vuelve a entrar').replace(/Ábrala/g, 'Ábrela')
      .replace(/pida la compra de nuevo/g, type === 'compra' ? 'pide la compra de nuevo' : 'pide el cambio de nuevo')
      .replace(/Toque Reintentar/g, 'Toca Reintentar').replace(/Toque «Pedir de nuevo»/g, 'Pídela otra vez')
      .replace(/Complete los datos marcados y vuelva a confirmar/g, 'Completa los datos marcados y vuelve a confirmar')
      .replace(/Corrija los datos en Nueva compra/g, 'Corrige los datos en Nueva compra')
      .replace(/Escriba los 11 dígitos del RUC y vuelva a confirmar/g, 'Escribe los 11 dígitos del RUC y vuelve a confirmar')
      .replace(/Hágalo desde su pantalla/g, 'Hazlo desde tu pantalla');
  }
  function plain(text, type) {
    var C = core(), t = String(text == null ? '' : text);
    return tu(C && typeof C.looksTechnical === 'function' && C.looksTechnical(t) ? GENERIC_ERROR : t, type);
  }
  var ACCESS_CODES = {assistant_off:1,forbidden_role:1,admin_only:1};
  function waitEngine(ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var e = engine();
        if (e && typeof e.ready === 'function' && e.ready()) { resolve(e); return; }
        if (e && typeof e.accessState === 'function' && e.accessState() === 'denied') { resolve(null); return; }
        if (Date.now() - t0 >= ms) { resolve(null); return; }
        root.setTimeout(poll, 250);
      })();
    });
  }
  function str(v, n) { return String(v == null ? '' : v).slice(0, n || 160); }
  function money(v) {
    var C = core(), n = Number(v);
    if (v == null || !isFinite(n)) return '-';
    return C && typeof C.soles === 'function' ? C.soles(n) : 'S/ ' + n.toFixed(2);
  }
  // Tarjeta tipada para el iframe: solo datos planos (el iframe los pinta con textContent). Nada de HTML ni del token.
  var CONFIRMABLE = {precio:1,costo:1,ajuste:1,producto:1,compra:1,configuracion:1};
  function needsReview(p) {
    var C = core();
    if (Array.isArray(p.completar) || Array.isArray(p.needFields)) return true;
    if (p.type === 'configuracion' && C && typeof C.isRucCard === 'function' && C.isRucCard(p)) return true;
    if (p.type === 'compra') {
      var lines = Array.isArray(p.lineas) ? p.lineas : [];
      if (!lines.length) return true;
      return lines.some(function (l) { return !l || (l.revisar && l.revisar.length) || (l.limite && l.limite.length) || l.cantidad == null || l.cantidad === ''; });
    }
    return false;
  }
  // Un toque (sin segundo «Guardar») solo para precio y ajuste de stock del Admin, y solo si la tarjeta no trae avisos de riesgo:
  // con aviso (precio ~100 veces mayor, cambio >50%, bajo costo, stock negativo, cantidad enorme) se conserva el segundo paso a propósito.
  // Los avisos los calcula el servidor con el contexto que mandó este aparato; por eso aquí se VUELVEN a calcular con lo que el POS tiene ahora
  // y, si no se puede comprobar (producto ausente, precio/stock distinto al de la propuesta, aviso que no vino), se trata como riesgo: se abre la ficha.
  function near(a, b, tol) { return isFinite(a) && isFinite(b) && Math.abs(a - b) <= (tol || 0.005); }
  function localProduct(p) {
    var e = engine();
    try { return e && typeof e.product === 'function' && p && p.product_id != null ? e.product(p.product_id) : null; } catch (_) { return null; }
  }
  function oneTap(p) {
    if (!ownerDataAllowed()) return false;
    var loc = localProduct(p);
    if (!loc) return false;
    if (p.type === 'precio') {
      if (typeof p.cambioGrande !== 'boolean' || typeof p.bajoCosto !== 'boolean' || p.quisoDecir != null || p.cambioGrande || p.bajoCosto) return false;
      var cur = Number(loc.precio), nuevo = Number(p.precio_nuevo), costo = Number(loc.costo);
      if (!(cur > 0) || !(nuevo > 0) || !near(cur, Number(p.precio_actual))) return false;
      if (Math.abs(nuevo - cur) / cur > 0.5) return false;
      if (costo > 0 && nuevo < costo) return false;
      return true;
    }
    if (p.type === 'ajuste') {
      if (typeof p.quedaNegativo !== 'boolean' || typeof p.grande !== 'boolean' || p.quedaNegativo || p.grande) return false;
      var stock = Number(loc.stock), q = Number(p.cantidad), after = stock + (p.tipo === 'entrada' ? q : -q);
      if (loc.controla === false || loc.stock == null || !(q > 0) || q > 1000 || !near(stock, Number(p.stock_actual), 0.001)) return false;
      return after >= 0 && near(after, Number(p.stock_despues), 0.001);
    }
    return false;
  }
  function cardRows(p) {
    var rows = [], warn = [], i;
    if (p.type === 'precio') {
      rows.push([str(p.nombre, 80), money(p.precio_actual) + ' → ' + money(p.precio_nuevo)]);
      if (p.quisoDecir != null) warn.push('¿Quisiste decir ' + money(p.quisoDecir) + '? Si es así, no confirmes y escribe el precio con punto.');
      else if (p.cambioGrande) warn.push('Cambio grande (más de 50%). Revisa bien.');
      if (p.bajoCosto) warn.push('El precio queda por debajo del costo.');
    } else if (p.type === 'costo') {
      rows.push([str(p.nombre, 80) + ' · costo', (p.costo_actual != null ? money(p.costo_actual) : 'sin costo') + ' → ' + money(p.costo_nuevo)]);
    } else if (p.type === 'ajuste') {
      rows.push([str(p.nombre, 80) + (p.motivo ? ' · ' + str(p.motivo, 60) : ''), (p.tipo === 'entrada' ? '+' : '−') + str(p.cantidad, 20)]);
      if (p.stock_actual != null) rows.push(['Stock', str(p.stock_actual, 20) + ' → ' + str(p.stock_despues, 20)]);
      if (p.quedaNegativo) warn.push('El stock quedaría negativo. Revisa la cantidad.');
      if (p.grande) warn.push('Cantidad muy grande. Revisa bien.');
    } else if (p.type === 'producto') {
      rows.push(['Nombre', str(p.nombre, 80)], ['Precio', money(p.precio)], ['Costo', p.costo != null ? money(p.costo) : '-'],
        ['Stock inicial', p.stock_inicial != null ? str(p.stock_inicial, 20) : '-'], ['Categoría', str(p.categoria || '-', 60)]);
      if (Array.isArray(p.parecidos) && p.parecidos.length) warn.push('Ya hay productos parecidos: ' + p.parecidos.slice(0, 5).map(function (x) { return str(x, 60); }).join(', ') + '.');
      if (p.bajoCosto) warn.push('El precio queda por debajo del costo.');
      if (p.revisar) warn.push('Precio o costo fuera de lo normal. Revisa bien.');
    } else if (p.type === 'compra') {
      var lines = Array.isArray(p.lineas) ? p.lineas.slice(0, 30) : [];
      for (i = 0; i < lines.length; i++) rows.push([str(lines[i].cantidad, 12) + ' × ' + str(lines[i].nombre, 80) + (lines[i].product_id ? '' : ' (no registrado)'), lines[i].costo_unitario != null ? money(lines[i].costo_unitario) : '-']);
      var C = core(); if (C && typeof C.purchaseTotals === 'function') { var t = C.purchaseTotals(p); if (t && t.filas && t.filas.length !== t.sinCosto) rows.push(['Total de la compra', money(t.total)]); }
      if (p.sinProducto) warn.push(p.sinProducto === 1 ? '1 línea no tiene producto registrado: revísala.' : p.sinProducto + ' líneas no tienen producto registrado: revísalas.');
    } else if (p.type === 'configuracion') {
      rows.push([str(p.nombre, 80), str(p.antes, 60) + ' → ' + str(p.valor, 60)]);
    }
    return {rows: rows, warnings: warn};
  }
  function readOnlyView(p) {
    var r = p.result || {};
    if (p.type === 'consulta') {
      var filas = Array.isArray(r.filas) ? r.filas.slice(0, 30).map(function (f) { return (Array.isArray(f) ? f : []).slice(0, 8).map(function (c) { return typeof c === 'number' && !Number.isInteger(c) ? c.toFixed(2) : str(c, 120); }); }) : [];
      return {kind: 'table', title: str(r.titulo || 'Consulta', 100), columns: Array.isArray(r.columnas) ? r.columnas.slice(0, 8).map(function (c) { return str(c, 40); }) : [],
        rows: filas, text: r.error ? str(r.texto, 300) : '', warnings: r.truncado ? ['Ojo: solo se leyó una parte de los datos. Las cantidades pueden quedar cortas.'] : [],
        note: 'Datos leídos del servidor. No cambia nada.'};
    }
    if (p.type === 'pasos') return {kind: 'steps', title: str(p.title || 'Cómo hacerlo', 100), steps: (Array.isArray(p.pasos) ? p.pasos : []).slice(0, 8).map(function (x) { return str(x, 200); }), go: !!p.pantalla};
    if (p.type === 'documento') return {kind: 'doc', title: str(p.title || 'Documento', 100), note: 'Documento interno. NO es comprobante SUNAT.'};
    return null;
  }
  function buildCards(proposals) {
    var e = engine(), views = [];
    (Array.isArray(proposals) ? proposals : []).slice(0, MAX_CARDS).forEach(function (p) {
      if (!p || typeof p !== 'object' || typeof p.type !== 'string') return;
      var view = null, key;
      if (p.needsConfirm !== true && (p.type === 'consulta' || p.type === 'pasos' || p.type === 'documento')) {
        view = readOnlyView(p); if (!view) return;
        key = 'ro-' + (++cardSeq); cards[key] = {p: p, gated: false, kind: view.kind};
        view.key = key; views.push(view); return;
      }
      if (!CONFIRMABLE[p.type] || p.needsConfirm !== true || !p.id || !p.confirm_token || !e) return;
      var perm = e.canExecute(p), body = cardRows(p);
      view = {type: p.type, title: str(p.title || 'Propuesta', 100), rows: body.rows, warnings: body.warnings};
      if (!perm || !perm.ok) { view.kind = 'denied'; view.rows = []; view.warnings = []; view.note = plain(perm && perm.msg, p.type); view.key = 'dn-' + (++cardSeq); views.push(view); return; }
      key = e.add(p);
      if (!key) return;
      if (needsReview(p)) {
        view.kind = 'review'; view.note = 'Esta tarjeta necesita que revises datos. Ábrela en el asistente del POS.';
        cards[key] = {p: p, gated: true, kind: 'review'};
      } else {
        var tap = oneTap(p);
        view.kind = 'confirm'; view.oneTap = tap;
        view.expiresAt = Number(e.expiry(p)) || 0;
        view.note = tap ? 'Al confirmar se guarda al instante. Se usa una sola vez.'
          : (p.type === 'configuracion' ? 'Al confirmar se aplica este ajuste. Se usa una sola vez.' : 'Al confirmar se abre la pantalla del POS con los datos llenos. Revísala y guarda ahí.');
        cards[key] = {p: p, gated: true, kind: 'confirm', busy: false};
      }
      view.key = key; views.push(view);
    });
    return views;
  }
  function cardState(key, extra) {
    if (frame) respond(frame.contentWindow, Object.assign({action: 'card', key: key}, extra));
  }
  function closeToPos() { temporarilyLegacy = true; close(); }
  // Guarda el formulario EXISTENTE del POS que el motor acaba de abrir y llenar (mismo camino que el botón «Guardar»; el Admin no tiene PIN aquí).
  // Devuelve 'saved' (el formulario cerró), 'open' (terminó pero el formulario sigue abierto: validación o aviso; se muestra para revisar),
  // 'pending' (el guardado sigue en curso: NO se cierra WORK ni se repite) o 'none' (no había formulario abierto).
  async function saveOpenForm(type) {
    var fn = type === 'precio' ? root.guardarProd : root.guardarMovInv, modal = doc.getElementById(type === 'precio' ? 'mProd' : 'mMovInv');
    if (typeof fn !== 'function' || !modal || !modal.classList || !modal.classList.contains('open')) return 'none';
    var settled = false, run;
    try { run = Promise.resolve(fn()).then(function () { settled = true; }, function () { settled = true; }); } catch (_) { settled = true; run = Promise.resolve(); }
    function wait(ms) { return Promise.race([run, new Promise(function (r) { root.setTimeout(r, ms); })]); }
    await wait(8000);
    if (!settled) await wait(22000);
    if (!settled) return 'pending';
    return modal.classList.contains('open') ? 'open' : 'saved';
  }
  // Relee lo que el POS tiene ahora (hasta ~5 s) y compara con lo pedido: «Listo» solo si de verdad coincide.
  async function verifySaved(p) {
    var i, loc;
    for (i = 0; i < 10; i++) {
      loc = localProduct(p);
      if (loc) {
        if (p.type === 'precio' && near(Number(loc.precio), Number(p.precio_nuevo))) return true;
        if (p.type === 'ajuste' && near(Number(loc.stock), Number(p.stock_despues), 0.001)) return true;
      }
      await new Promise(function (r) { root.setTimeout(r, 500); });
    }
    return false;
  }
  async function confirmOnce(key) {
    var rec = cards[key], e = engine(), myGeneration = generation;
    if (!rec || !rec.gated || rec.kind !== 'confirm' || rec.busy || rec.done || !e) return;
    if (!ownerDataAllowed() && rec.p.type !== 'configuracion') { cardState(key, {state: 'failed', msg: 'Esta sesión ya no es de Admin. Vuelve a entrar como Admin y pide el cambio de nuevo.'}); return; }
    rec.busy = true;
    var tapNow = oneTap(rec.p); // se decide ANTES de gastar el token, con los datos de ahora
    cardState(key, {state: 'working', msg: 'Guardando…'});
    var r;
    try { r = await e.execute(key, {}); } catch (err) { r = {ok: false, code: err && err.message, msg: GENERIC_ERROR}; }
    rec.busy = false;
    if (myGeneration !== generation || !sessionReady()) return;
    r = r || {ok: false};
    var p = rec.p;
    if (r.ok) {
      rec.done = true; // desde aquí cualquier «Confirmar» tardío se ignora sin consultar la puerta
      if (tapNow) {
        var res = await saveOpenForm(p.type);
        if (myGeneration !== generation) return;
        if (res === 'saved') {
          if (await verifySaved(p)) { if (myGeneration === generation) cardState(key, {state: 'done', msg: 'Listo. Se guardó al instante.'}); return; }
          if (myGeneration === generation) cardState(key, {state: 'failed', msg: 'No pude comprobar que el cambio quedó guardado. Revisa «' + str(p.nombre, 60) + '» en Inventario antes de repetirlo.'});
          return;
        }
        if (res === 'pending') { cardState(key, {state: 'working', msg: 'Guardando… revisa en un momento «' + str(p.nombre, 60) + '» en Inventario. No lo repitas.'}); return; }
        if (res === 'none') {
          // El token ya se gastó pero no había formulario abierto que guardar: no es un éxito. Se dice claro y WORK no se cierra.
          cardState(key, {state: 'failed', msg: 'No se pudo abrir ni comprobar el cambio de «' + str(p.nombre, 60) + '». No lo repitas todavía: revisa en Inventario si quedó y, si no, pídelo otra vez.'});
          return;
        }
        cardState(key, {state: 'done', msg: 'Abrí la pantalla con el cambio listo. Revisa y pulsa Guardar.'});
        root.setTimeout(function () { if (myGeneration === generation) park(); }, 900);
        return;
      }
      cardState(key, {state: 'done', msg: plain(r.msg, p.type) || 'Listo.'});
      if (p.type !== 'configuracion') root.setTimeout(function () { if (myGeneration === generation) park(); }, 900);
      return;
    }
    var code = r.code || 'error';
    if (ACCESS_CODES[code]) {
      try { var a = root.NA_ASISTENTE; if (a && typeof a.refreshAccess === 'function') a.refreshAccess(); } catch (_) {}
      cardState(key, {state: 'failed', msg: plain(r.msg, p.type) || friendly(code)}); return;
    }
    if (code === 'confirm_expired' || code === 'HTTP_410') { cardState(key, {state: 'expired', msg: 'Esta propuesta venció. Pídela otra vez.'}); return; }
    var C = core(), view = C && typeof C.confirmFailureView === 'function' ? C.confirmFailureView(r, {type: p.type}) : null;
    var msg = plain((view && view.msg) || r.msg, p.type) || friendly(code, r.retry_after_s);
    if (Number(r.retry_after_s) > 0 && /rate_limited|HTTP_429/.test(code)) msg = friendly(code, r.retry_after_s);
    var Cr = core();
    if (Cr && typeof Cr.isRateLimitResult === 'function' ? Cr.isRateLimitResult(r) : /rate_limited|HTTP_429/.test(code)) return {wait: Cr && typeof Cr.retryWaitSeconds === 'function' ? Cr.retryWaitSeconds(r, Date.now()) : 20}; // el servidor NO gastó la tarjeta: se reintenta solo
    var kind = view ? view.kind : 'other';
    if (kind === 'blocked' || kind === 'review' || kind === 'fields' || kind === 'limit') {
      cardState(key, {state: 'blocked', msg: msg.replace(/\s*Hazlo desde tu pantalla\.?/, '') + ' Ábrela en el asistente del POS.'}); return;
    }
    if (rec.p && e.state(key) === 'denied') { cardState(key, {state: 'failed', msg: msg}); return; }
    cardState(key, {state: 'retry', msg: msg});
  }
  // ---- 429 (tope de confirmaciones por minuto del servidor): se reintenta SOLO, con cuenta regresiva en esa tarjeta ----
  // El Worker responde 429 ANTES de gastar el token, así que repetir con el mismo token es seguro (nunca se reintenta ante otro error).
  // OJO: el tope (5 por minuto) está FIJO en el servidor (ASSISTANT_CONFIRMS_PER_MINUTE) y este paquete no lo adivina ni lo cambia: solo reacciona al 429
  // con su retry_after_s. Si el dueño sube el tope en el Worker, aquí no hay que cambiar nada (no se espera de más: no hay espera antes del 429).
  function sleep(ms) { return new Promise(function (r) { root.setTimeout(r, ms); }); }
  // La firma dura 5 minutos: si venció (o está por vencer), no se espera ni se reintenta con ella; se pide regenerar solo esa tarjeta.
  function tokenExpired(rec) {
    var e = engine(), x = 0;
    try { x = e && typeof e.expiry === 'function' ? Number(e.expiry(rec.p)) || 0 : 0; } catch (_) { x = 0; }
    return x > 0 && Date.now() >= x - 2000;
  }
  // «Espera N segundos…» solo en la tarjeta que espera. true = terminó; false = WORK se cerró, cambió de sesión, el dueño canceló o la firma venció.
  async function countdown(key, secs, gen) {
    var C = core(), rec = cards[key];
    for (var n = Math.max(1, Math.ceil(secs)); n > 0; n--) {
      if (gen !== generation || !sessionReady() || !rec || rec.cancelled) return false;
      if (tokenExpired(rec)) return false;
      cardState(key, {state: 'waiting', msg: C && typeof C.waitText === 'function' ? C.waitText(n) : 'Espera ' + n + ' segundos…'});
      await sleep(1000);
    }
    return gen === generation && sessionReady() && !rec.cancelled && !tokenExpired(rec);
  }
  async function confirmCard(key) {
    var rec = cards[key], myGen = generation;
    if (!rec || !rec.gated || rec.kind !== 'confirm' || rec.busy || rec.done || rec.waiting) return;
    rec.waiting = true;
    function stopped() { // por qué se cortó la espera: se dice claro, sin gastar nada
      if (myGen !== generation || rec.cancelled) return true;
      if (tokenExpired(rec)) { cardState(key, {state: 'expired', msg: 'Esta propuesta venció (la firma dura 5 minutos). Pídela otra vez.'}); return true; }
      return false;
    }
    try {
      for (var attempt = 0; attempt < 4; attempt++) {
        if (tokenExpired(rec)) { stopped(); return; }
        var out = await confirmOnce(key);
        if (!out || !out.wait) return;
        if (!(await countdown(key, out.wait, myGen))) { stopped(); return; }
      }
      if (myGen === generation) cardState(key, {state: 'retry', msg: 'Sigue el límite de confirmaciones por minuto. Toca Reintentar en un momento: no se hizo ningún cambio.'});
    } finally { rec.waiting = false; }
  }
  function cancelCard(key, why) {
    var rec = cards[key], e = engine();
    if (!rec || !rec.gated || rec.busy || !e) return;
    rec.cancelled = true; // si estaba esperando por un 429, la cuenta regresiva se corta y no se reintenta
    try { e.cancel(key, why === 'vencida' ? 'vencida' : 'cancelada'); } catch (_) {}
    cardState(key, {state: why === 'vencida' ? 'expired' : 'cancelled', msg: why === 'vencida' ? 'Esta propuesta venció. Pídela otra vez.' : 'Cancelado. No se hizo nada.'});
  }
  async function readOnlyAction(key) {
    var rec = cards[key], e = engine();
    if (!rec || rec.gated || !e) return;
    var r;
    try { r = rec.kind === 'doc' ? await e.openDocument(rec.p) : e.go(rec.p); } catch (_) { r = {ok: false, msg: GENERIC_ERROR}; }
    if (!r || !r.ok) { cardState(key, {state: 'failed', msg: plain(r && r.msg) || GENERIC_ERROR}); return; }
    closeToPos();
  }
  async function ask(target,id,message) {
    if (busy) { respond(target,{action:'chat',id:id,ok:false,text:'Espera a que termine la consulta actual.'}); return; }
    var requestGeneration = generation;
    if (String(message || '').length > MAX_TEXT) {
      respond(target,{action:'chat',id:id,ok:true,text:'Tu mensaje tiene ' + String(message).length + ' letras y el máximo es ' + MAX_TEXT + '. No lo envié. Divídelo en partes más cortas.'});
      return;
    }
    busy = true;
    try {
      if (!sessionReady() || !root.NA_ROLES || typeof root.NA_ROLES.api!=='function') throw Error('Asistente no disponible en esta sesión');
      // Mismo motor del asistente original: nombres de clientes tapados, contexto real de productos (costos solo del Admin) y estado de tarjetas.
      var e = await waitEngine(6000);
      if (requestGeneration !== generation || !sessionReady()) return;
      // Pedido ambiguo («súbele un poco a las galletas»): una sola pregunta corta con opciones tocables, sin gastar una consulta al servidor.
      var Cc = core();
      if (e && Cc && typeof Cc.clarifyAmbiguous === 'function' && typeof e.catalog === 'function' && ownerDataAllowed()) {
        var clar = null;
        try { clar = Cc.clarifyAmbiguous(String(message || ''), e.catalog()); } catch (_) { clar = null; }
        if (clar) {
          respond(target,{action:'chat',id:id,ok:true,text:clar.question,cards:[{kind:'clarify',key:'cl-' + (++cardSeq),title:'¿Cuánto y cuáles?',
            options:clar.options.map(function (o) { return {label:str(o.label,40),text:str(o.text,1200),fill:str(o.fill,200)}; })}]});
          return;
        }
      }
      var prepared = e ? e.prepare(String(message || '')) : null;
      if (!prepared) {
        var eng = engine(), st = eng && typeof eng.accessState === 'function' ? eng.accessState() : 'pending';
        throw Error(st === 'denied'
          ? 'Este aparato no tiene permiso para usar el asistente (solo el Admin lo usa). No se envió nada. El resto del sistema funciona igual.'
          : 'El asistente no pudo conectarse todavía (revisa tu internet). No se envió nada. Intenta de nuevo en unos segundos o usa el asistente del POS.');
      }
      var finalText = String(prepared.text || '');
      if (finalText.length > MAX_TEXT) {
        respond(target,{action:'chat',id:id,ok:true,text:'Al tapar nombres y datos privados tu mensaje quedó de ' + finalText.length + ' letras y el máximo es ' + MAX_TEXT + '. No lo envié. Acórtalo e intenta de nuevo.'});
        return;
      }
      // Progreso mientras el servidor piensa (10 a 25 s): «Pensando…», «Sigo pensando…».
      var t0 = Date.now(), lastProg = '', prog = root.setInterval(function () {
        var Cp = core(), tx = Cp && typeof Cp.thinkingText === 'function' ? Cp.thinkingText((Date.now() - t0) / 1000) : '';
        if (tx && tx !== lastProg) { lastProg = tx; if (requestGeneration === generation) respond(target,{action:'progress',id:id,text:tx}); }
      }, 1000);
      var answer;
      try { answer=await root.NA_ROLES.api('/auth/assistant/chat',{text:finalText,history:history.slice(),context:prepared.context,cards:prepared.cards}); }
      finally { if (typeof root.clearInterval === 'function') root.clearInterval(prog); }
      if (requestGeneration !== generation || !sessionReady()) return;
      var out=answer && typeof answer==='object' ? answer : {};
      if (out.error) { var codeErr = new Error(String(out.error).slice(0,80)); codeErr.data = out; throw codeErr; }
      var text=out.texto || out.text || out.reply || out.respuesta || out.answer || out.message || '';
      if (typeof text!=='string') text='';
      if (!text && out.final) text=typeof out.final==='string'?out.final:out.final.text || out.final.respuesta || '';
      var views = buildCards(out.proposals);
      var Cn = core(); if (Cn && typeof Cn.unifyActionWords === 'function') text = Cn.unifyActionWords(text);
      var hidden = (Array.isArray(out.proposals) ? out.proposals : []).filter(function (p) { return p && p.needsConfirm === true; }).length;
      if (!text && !views.length) text='El servidor respondió sin texto visible. La operación no se considera completada.';
      // Si hay cambios propuestos que no se pudieron mostrar como tarjeta, se dice claro (nunca en consultas de solo lectura).
      if (hidden > views.filter(function (v) { return v.kind === 'confirm' || v.kind === 'review' || v.kind === 'denied'; }).length) text += (text ? '\n\n' : '') + 'Hay un cambio propuesto que no pude mostrar aquí. No se hizo nada. Pídelo desde el asistente del POS.';
      // Preserve server signatures unchanged; no synthetic assistant turns enter authenticated memory.
      if (Array.isArray(out.turns) && out.turns.length === 2 && out.turns.every(function(t){return t && ['user','assistant'].indexOf(t.role)>=0 && typeof t.content==='string' && t.content.length<=12000 && typeof t.sig==='string';})) {
        history = history.concat(out.turns).slice(-24);
        while (history.length && JSON.stringify(history).length > 60000) history.splice(0,2);
      }
      respond(target,{action:'chat',id:id,ok:true,text:String(text).slice(0,12000),cards:views});
    } catch (err) {
      if (requestGeneration !== generation || !sessionReady()) return;
      var raw = err && err.message ? String(err.message) : '';
      var shown = /^(El asistente|Asistente no|Este aparato)/.test(raw) ? raw.slice(0,200) : friendly(raw, err && err.data && err.data.retry_after_s);
      if (ACCESS_CODES[raw]) { try { var a2 = root.NA_ASISTENTE; if (a2 && typeof a2.refreshAccess === 'function') a2.refreshAccess(); } catch (_) {} }
      respond(target,{action:'chat',id:id,ok:false,text:shown});
    } finally { if (requestGeneration === generation) busy = false; }
  }
  root.addEventListener('message',function (event) {
    if (event.origin!==root.location.origin || !frame || event.source!==frame.contentWindow) return;
    var data=event.data;
    if (!data || typeof data!=='object' || typeof data.type!=='string' || !data.type.startsWith('na-work:')) return;
    if (data.type==='na-work:reset') {resetConversation();return;}
    if (data.type==='na-work:close') {temporarilyLegacy = true;close();return;}
    if (data.type==='na-work:metrics') {var first=initPayload();lastInit=JSON.stringify(first);respond(event.source,first);return;}
    if (data.type==='na-work:navigate') {
      var id=String(data.page||'');
      if (!allowedPages[id] || typeof root.goPage!=='function') return;
      if (id === 'pageMenu') { if (!isHome()) root.goPage(id); return; }
      // The canonical navigation still checks the session/role before entering a page.
      var changed = root.goPage(id);
      if (changed !== false && !isHome()) close();
      return;
    }
    if (/^na-work:card-/.test(data.type) && typeof data.key==='string' && cards[data.key]) {
      if (data.type==='na-work:card-confirm') confirmCard(data.key);
      else if (data.type==='na-work:card-cancel') cancelCard(data.key,data.why);
      else if (data.type==='na-work:card-open') readOnlyAction(data.key);
      else if (data.type==='na-work:card-assistant') { closeToPos(); try { var a3=root.NA_ASISTENTE; if (a3 && typeof a3.open==='function') a3.open(); } catch (_) {} }
      return;
    }
    if (data.type==='na-work:chat' && typeof data.id==='string' && typeof data.text==='string' && data.text.trim().length>0) {
      ask(event.source,data.id,data.text.trim());
    }
  });
  function mount() {
    if (!doc.body || launcher) return;
    var style=doc.createElement('style');
    style.textContent='#naWorkLauncher{position:fixed;right:17px;bottom:18px;z-index:27;border:0;border-radius:22px;background:linear-gradient(120deg,#073958,#0a90ae);color:white;font:750 14px/1 system-ui;padding:14px 18px;box-shadow:0 8px 24px #06345155;min-height:46px}#naWorkLauncher[hidden]{display:none!important}#naWorkOverlay{position:fixed;inset:0;z-index:10050;background:#f7fbff}#naWorkOverlay[hidden]{display:none!important}#naWorkOverlay iframe{display:block;width:100%;height:100%;border:0;background:#f7fbff}body.na-work-open{overflow:hidden}';
    doc.head.appendChild(style);
    launcher=doc.createElement('button');
    launcher.id='naWorkLauncher';launcher.type='button';launcher.textContent='✦ WORK';
    launcher.setAttribute('aria-label','Abrir WORK');
    launcher.addEventListener('click',open);
    doc.body.appendChild(launcher);
    var home=doc.getElementById('pageMenu');
    if (home && root.MutationObserver) new root.MutationObserver(syncView).observe(home,{attributes:true,attributeFilter:['class']});
    root.addEventListener('pageshow', syncView);
    root.addEventListener('na:role', syncView);
    // Sin sesión confirmada WORK no se abre: tope para que el Inicio de siempre no quede oculto (index.html lo oculta mientras WORK abre).
    if (!featureEnabled) releasePre(); else root.setTimeout(function () { if (!overlay) releasePre(); }, 3500);
    syncView();
    // Refresh read-only figures from the POS DOM; does not query the backend or change data.
    root.addEventListener('na:canonical-updated', scheduleInit);
    root.addEventListener('na:canonical-sale-projection', scheduleInit);
    var stats = home && typeof home.querySelector === 'function' ? home.querySelector('.quick-stats') : null;
    if (stats && root.MutationObserver) new root.MutationObserver(scheduleInit).observe(stats,{subtree:true,childList:true,characterData:true});
    root.setInterval(function(){pushInit(false);},10000);
    if (typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', scheduleInit);
  }
  root.NA_WORK_HOST={open:open,close:close};
  if (doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})(window);
