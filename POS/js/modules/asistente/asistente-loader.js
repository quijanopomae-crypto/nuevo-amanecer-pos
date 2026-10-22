/* Asistente (PROTOTIPO AISLADO): cargador apagado por defecto.
   Solo se activa con ?asistente=1 (queda guardado en este aparato) y se apaga con ?asistente=0.
   Antes de bajar NADA del asistente pregunta al servidor si este aparato lo tiene (POST /auth/assistant/chat {ping:true}, ~100 bytes,
   sin modelo ni cupo). Solo si la respuesta es «sí» (dueño o empleado con nivel encendido) o «aparato sin rol» (para mostrar
   «Registrar este teléfono como dueño») carga asistente.css, asistente-core.js y asistente-ui.js.
   Empleado en Apagado (por defecto): 0 archivos del asistente; su POS arranca igual que hoy.
   Sin internet: se usa lo último que dijo el servidor (solo para que el dueño vea «Asistente no disponible sin internet»).
   Todo pasa DESPUÉS de que el POS abrió y el navegador está libre. */
(function (root) {
  'use strict';
  var on = false;
  try {
    var q = new URLSearchParams(root.location.search).get('asistente');
    if (q === '1') root.localStorage.setItem('na_asistente_proto', '1');
    if (q === '0') { root.localStorage.removeItem('na_asistente_proto'); root.localStorage.removeItem('na_asistente_acc'); }
    on = root.localStorage.getItem('na_asistente_proto') === '1';
  } catch (_) {}
  if (!on) { try { root.document.documentElement.classList.remove('na-asst-owner', 'na-asst-pre'); } catch (_) {} return; }
  var loaded = false, asking = false, lastAsk = 0;
  function ls(k, v) { try { if (v === undefined) return root.localStorage.getItem(k); if (v === null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } catch (_) {} return null; }
  // Tarjeta de Inicio del dueño ARRIBA (debajo del saludo, antes de los totales) con alto FIJO: el hueco se reserva en cuanto corre
  // este archivo SOLO si el último ping dijo «dueño». Empleado o sin dato: no se reserva nada. Las alturas viven aquí y en el margen de
  // <head> (index.html): 321 (<380) / 272 (380-699, valor de Bot 4) / 364 (tableta) / 280 (PC) = alto REAL de la tarjeta (asistente.css fija las líneas por tramo).
  var SLOT_CSS = '#naAsstHero{box-sizing:border-box;flex:none;height:272px;margin:4px 0 16px;border-radius:22px;overflow:hidden;contain:strict}' +
    '#naAsstHero:empty{background:rgba(34,197,94,.07);border:1px solid rgba(21,128,61,.18)}' +
    '@media (min-width:380px) and (max-width:699px){#naAsstHero{height:272px}}@media (min-width:700px){#naAsstHero{height:364px;margin:4px 0 18px}}@media (min-width:1100px){#naAsstHero{height:280px}}' +
    // La tarjeta va en lugar de «Hola, ¿qué quieres hacer hoy?» del celular (como en las maquetas v2); el resto de Inicio no cambia.
    'html.na-asst-owner #naMobileWelcome{display:none!important}' +
    '#naAsstHero.na-asst-gone{display:flex;align-items:center;justify-content:center;padding:16px;background:#f1f5f9;border:1px solid #e2e8f0;color:#334155;font-size:15px;text-align:center}' +
    'body.dark #naAsstHero.na-asst-gone{background:#0f172a;border-color:#334155;color:#cbd5e1}';
  function slotCss() { var d = root.document; if (d.getElementById('naAsstSlotCss')) return; var st = d.createElement('style'); st.id = 'naAsstSlotCss'; st.textContent = SLOT_CSS; d.head.appendChild(st); }
  function reserve() {
    var d = root.document, m = d.getElementById('pageMenu'), host = m && m.querySelector('.main-scroll'); if (!host || d.getElementById('naAsstHero')) return;
    var at = host.querySelector(':scope > .quick-stats'), slot = d.createElement('section'); slot.id = 'naAsstHero'; slot.className = 'na-asst-hero'; slot.setAttribute('aria-label', 'Asistente');
    host.insertBefore(slot, at || host.firstChild); d.documentElement.classList.add('na-asst-owner'); d.documentElement.classList.remove('na-asst-pre'); // el hueco real reemplaza al margen reservado en <head>
    if (root.performance && root.performance.mark) root.performance.mark('na-asst-slot');
  }
  // Ya no es dueño: NADA de la tarjeta queda en el DOM (contenido, atajos, datos) en ese mismo instante. Para no mover la pantalla,
  // el hueco se queda con su alto y un aviso neutro, sin datos del dueño ni botones o enlaces. Se libera al salir de Inicio
  // (o en el próximo arranque, que ya no reserva nada porque el rol guardado se borró).
  var NOTICE = 'El asistente no está disponible en este aparato.';
  function release() { var e = root.document.getElementById('naAsstHero'); if (e) e.remove(); root.document.documentElement.classList.remove('na-asst-owner', 'na-asst-pre'); }
  function unreserve() {
    var d = root.document, e = d.getElementById('naAsstHero'), m = d.getElementById('pageMenu');
    var onInicio = !!(e && m && m.classList && m.classList.contains('active'));
    if (!e || !onInicio) { release(); return; }
    while (e.firstChild) e.removeChild(e.firstChild); // fuera todo: contenido, atajos y escuchas que colgaban de ellos
    var keep = { id: 1 }; Array.prototype.slice.call(e.attributes || []).forEach(function (a) { if (!keep[a.name]) e.removeAttribute(a.name); });
    e.className = 'na-asst-gone'; e.setAttribute('role', 'status');
    var p = d.createElement('p'); p.textContent = NOTICE; e.appendChild(p);
    d.documentElement.classList.remove('na-asst-pre');
    if (e._naGone) return; e._naGone = true;
    var mo = root.MutationObserver ? new root.MutationObserver(function () { if (!m.classList.contains('active')) { mo.disconnect(); release(); } }) : null;
    if (mo) mo.observe(m, { attributes: true, attributeFilter: ['class'] }); else release();
  }
  // ---------- «Revisión del punto de venta» (solo en el aparato del Admin) ----------
  // Escuchas PASIVAS (no cambian nada del POS, no envuelven fetch): error y unhandledrejection de la ventana, y respuestas 4xx/5xx de la
  // API vistas con PerformanceObserver (solo ruta y código, nunca el cuerpo). Más contadores de uso por pantalla/acción (clics en
  // botones: pantalla + nombre de la función del botón o su id; nunca el texto del botón ni lo escrito). Todo queda en ESTE aparato
  // (localStorage na_asst_rev, últimos 200 errores agrupados, 300 contadores), limpio y cortado; solo sale cuando el Admin pide la
  // revisión al asistente (asistente-ui.js -> /auth/assistant/review). Aparato de empleado o sin rol: no se instala nada.
  var REV_KEY = 'na_asst_rev', REV_MAX = 200, REV_USAGE_MAX = 300, rev = null, revTimer = 0, revOn = false;
  function revClean(v, n) {
    var s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 600)
      .replace(/(https?:\/\/[^\s?#]*)[?#]\S*/gi, '$1').replace(/\b(?:bearer|basic)\s+\S+/gi, '[clave]')
      .replace(/\b(?:token|clave|password|contraseña|pin|secret|api[_-]?key|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '[clave]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]').replace(/(?:S\/\.?|US\$|PEN|\$)\s?-?\d[\d.,]*/gi, '[monto]')
      .replace(/\b\d+[.,]\d{1,2}\b/g, '[monto]').replace(/[A-Za-z0-9_+\/=-]{24,}/g, '[clave]').replace(/\d{6,}/g, '[num]').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
  }
  function revLoad() {
    if (rev) return rev; try { rev = JSON.parse(ls(REV_KEY) || 'null'); } catch (_) { rev = null; }
    if (!rev || rev.v !== 1 || !Array.isArray(rev.e) || !rev.u || typeof rev.u !== 'object') rev = { v: 1, e: [], u: {}, seen: null };
    return rev;
  }
  function revFlush() { clearTimeout(revTimer); revTimer = 0; if (rev) ls(REV_KEY, JSON.stringify(rev)); }
  function revSave() { if (!revTimer) revTimer = setTimeout(revFlush, 3000); } // se escribe en tanda, nunca en cada evento
  function revError(kind, msg, src, status) {
    var r = revLoad(), m = revClean(msg, 160), s = revClean(src, 80), now = new Date().toISOString(); status = status || 0;
    if (!m && !s) return;
    for (var i = r.e.length - 1; i >= 0; i--) { var x = r.e[i];
      if (x.kind === kind && x.msg === m && x.src === s && (x.status || 0) === status) { x.count++; x.last = now; r.e.splice(i, 1); r.e.push(x); revSave(); return; } }
    r.e.push({ kind: kind, msg: m, src: s, status: status, count: 1, first: now, last: now });
    if (r.e.length > REV_MAX) r.e.splice(0, r.e.length - REV_MAX);
    revSave();
  }
  function revFile(u) { var s = String(u || ''); try { var x = new URL(s, root.location.href); s = x.origin === root.location.origin ? x.pathname : x.host + x.pathname; } catch (_) {} return s.replace(/\d{3,}/g, '#'); }
  function revUseKey(t) {
    var e = t && t.closest ? t.closest('button,a,[onclick],[data-action],[role="button"],input[type="button"],input[type="submit"]') : null;
    if (!e || e.closest('[id^="naAsst"],[class*="na-asst"]')) return null; // el propio asistente no cuenta
    var pg = e.closest('.page'), scr = pg && pg.id ? pg.id : (e.closest('.modal,[role="dialog"]') ? 'modal' : 'otro');
    var oc = e.getAttribute('onclick'), m = oc && /^\s*([A-Za-z_][\w]{0,40})\s*\(\s*(?:'([A-Za-z][\w-]{0,30})'|"([A-Za-z][\w-]{0,30})")?/.exec(oc);
    var act = m ? m[1] : (e.getAttribute('data-action') || e.id || ''), arg = m ? (m[2] || m[3] || '') : '';
    act = String(act).replace(/\d+/g, '#').replace(/[^\w#-]/g, '').slice(0, 40); arg = String(arg).replace(/\d+/g, '#').slice(0, 30);
    scr = String(scr).replace(/[^\w-]/g, '').slice(0, 30);
    return act && /^[A-Za-z]/.test(scr) ? scr + ':' + act + (arg ? ':' + arg : '') : null;
  }
  function revInstall() {
    if (revOn) return; revOn = true;
    root.addEventListener('error', function (e) { if (e && e.message) revError('error', e.message, revFile(e.filename) + (e.lineno ? ':' + e.lineno : ''), 0); });
    root.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; revError('promesa', r && r.message ? (r.name ? r.name + ': ' : '') + r.message : String(r), '', 0); });
    root.document.addEventListener('click', function (e) { var k = revUseKey(e.target); if (!k) return; var r = revLoad();
      if (r.u[k] || Object.keys(r.u).length < REV_USAGE_MAX) { r.u[k] = (r.u[k] || 0) + 1; revSave(); } }, { capture: true, passive: true });
    root.addEventListener('pagehide', revFlush);
    root.document.addEventListener('visibilitychange', function () { if (root.document.hidden) revFlush(); });
    try {
      if (root.PerformanceObserver) new root.PerformanceObserver(function (l) { l.getEntries().forEach(function (x) {
        var st = Number(x.responseStatus) || 0; if (st >= 400 && (x.initiatorType === 'fetch' || x.initiatorType === 'xmlhttprequest')) revError('api', revFile(x.name), '', st); }); })
        .observe({ type: 'resource', buffered: true });
    } catch (_) {}
  }
  root.NA_ASISTENTE_REVISION = {
    // Lo que se manda SOLO cuando el Admin pide la revisión (la UI lo pasa además por el redactor del asistente).
    data: function () { var r = revLoad(); return { errors: r.e.map(function (x) { return { kind: x.kind, msg: x.msg, src: x.src, status: x.status, count: x.count, first: x.first, last: x.last }; }), usage: JSON.parse(JSON.stringify(r.u)) }; },
    newErrors: function () { var r = revLoad(), n = 0; r.e.forEach(function (x) { if (!r.seen || x.last > r.seen) n++; }); return n; },
    markSeen: function () { var r = revLoad(); r.seen = new Date().toISOString(); revFlush(); },
    installed: function () { return revOn; }
  };
  slotCss();
  if (ls('na_asistente_acc') === 'owner') { reserve(); revInstall(); }
  root.NA_ASISTENTE_SLOT = { reserve: reserve, unreserve: unreserve, release: release, NOTICE: NOTICE };
  function load() {
    if (loaded) return; loaded = true;
    var d = root.document, l = d.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/asistente.css'; d.head.appendChild(l);
    var a = d.createElement('script'); a.src = 'js/modules/asistente/asistente-core.js';
    a.onload = function () { var b = d.createElement('script'); b.src = 'js/modules/asistente/asistente-ui.js'; d.body.appendChild(b); };
    d.body.appendChild(a);
  }
  // Mismo pedido que usa la UI: endpoint y Bearer de la sesión del POS, sin cookies. En el prototipo local, rol simulado.
  // Como máximo una pregunta cada 10 s (ASK_EVERY_MS). Sin internet no cuenta como pregunta, y si el pedido falla tampoco:
  // al reconectar se vuelve a preguntar enseguida (Bot 3: antes esperaba 30 s y al reconectar no pasaba nada).
  // Pedido corto (3 s, AbortController): con mala señal se corta y queda lo que había (nunca bloquea al POS). Corre en un momento libre
  // DESPUÉS de que el POS abrió (load + requestIdleCallback) y desde este cargador chico: el empleado en Apagado no baja nada más.
  var ASK_EVERY_MS = 10000, ASK_TIMEOUT_MS = 3000;
  function ask() {
    if (loaded || asking || Date.now() - lastAsk < ASK_EVERY_MS) return;
    if (root.navigator && root.navigator.onLine === false) { if (ls('na_asistente_acc') === 'owner') load(); return; }
    asking = true; lastAsk = Date.now();
    var url = '/auth/assistant/chat', h = { 'content-type': 'application/json' }, init = { method: 'POST', cache: 'no-store', body: '{"ping":true}' };
    var c = null; try { c = JSON.parse(ls('na_cloud_sync_credentials') || 'null'); } catch (_) {}
    if (c && c.endpoint && c.token) { url = String(c.endpoint).replace(/\/+$/, '') + url; h.authorization = 'Bearer ' + c.token; init.credentials = 'omit'; init.redirect = 'error'; }
    else { var pr = ls('na_asistente_proto_role'), pl = ls('na_asistente_proto_level'); if (pr === 'empleado' || pr === 'sinrol') h['x-proto-role'] = pr; if (pl) h['x-proto-level'] = pl; }
    init.headers = h;
    var ctl = root.AbortController ? new root.AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, ASK_TIMEOUT_MS) : 0; if (ctl) init.signal = ctl.signal;
    root.fetch(url, init).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { st: r.status, d: d || {} }; }); }).then(function (x) {
      clearTimeout(t); asking = false;
      if (x.st === 200 && x.d.ok) { ls('na_asistente_acc', x.d.role === 'owner' ? 'owner' : 'on'); if (x.d.role !== 'owner') unreserve(); else revInstall(); load(); return; }
      if (x.st === 403 && x.d.reason === 'sin_rol') { ls('na_asistente_acc', null); unreserve(); load(); return; }
      if (x.st === 401 || x.st === 403 || x.st === 404) { ls('na_asistente_acc', null); unreserve(); } // apagado: no se baja nada y el hueco (si lo había) se quita
    }, function () { clearTimeout(t); asking = false; lastAsk = 0; if (ls('na_asistente_acc') === 'owner') load(); });
  }
  root.NA_ASISTENTE_LOADER = { ask: ask, loaded: function () { return loaded; } };
  function idle() { if (root.requestIdleCallback) root.requestIdleCallback(ask, { timeout: 2500 }); else setTimeout(ask, 800); }
  if (root.document.readyState === 'complete') idle(); else root.addEventListener('load', idle, { once: true });
  // Si el dueño lo enciende con la app abierta: se vuelve a preguntar al volver a la app, al reconectar y al ENTRAR A INICIO
  // (máx. una vez cada 10 s). Mientras el servidor no diga «sí», el empleado en Apagado sigue sin bajar nada del asistente.
  root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden) ask(); });
  root.addEventListener('online', ask);
  root.addEventListener('offline', function () { lastAsk = 0; }); // se cortó: al volver se pregunta enseguida (el dueño pudo cambiarlo)
  function watchInicio() {
    var m = root.document.getElementById('pageMenu'); if (!m || !root.MutationObserver) return;
    var was = m.classList.contains('active');
    var mo = new root.MutationObserver(function () { var now = m.classList.contains('active'); if (now && !was) { if (loaded) mo.disconnect(); else ask(); } was = now; });
    mo.observe(m, { attributes: true, attributeFilter: ['class'] });
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', watchInicio, { once: true }); else watchInicio();
})(window);
