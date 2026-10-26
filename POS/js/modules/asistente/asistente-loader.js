/* Asistente: cargador chico. Encendido por defecto; el servidor decide (ASSISTANT_ENABLED y el rol/nivel del aparato).
   Se apaga en ESTE aparato con el interruptor «Asistente en este aparato» de Configuración (solo Admin) o con ?asistente=0
   (queda guardado: localStorage na_asistente_off). ?asistente=1 lo vuelve a encender.
   Antes de bajar NADA del asistente pregunta al servidor si este aparato lo tiene (POST /auth/assistant/chat {ping:true}, ~100 bytes,
   sin modelo ni cupo). Solo si la respuesta es «sí» (dueño o empleado con nivel encendido) o «aparato sin rol» (para mostrar
   «Registrar este teléfono como dueño») carga asistente.css, asistente-core.js y asistente-ui.js.
   Empleado en Apagado (por defecto): 0 archivos del asistente; su POS arranca igual que hoy.
   Sin internet: se usa lo último que dijo el servidor (solo para que el dueño vea «Asistente no disponible sin internet»).
   Todo pasa DESPUÉS de que el POS abrió y el navegador está libre. */
(function (root) {
  'use strict';
  var OFF_KEY = 'na_asistente_off', disabled = false, lastState = null;
  try {
    var q = new URLSearchParams(root.location.search).get('asistente');
    if (q === '1') root.localStorage.removeItem(OFF_KEY);
    if (q === '0') { root.localStorage.setItem(OFF_KEY, '1'); root.localStorage.removeItem('na_asistente_acc'); }
    root.localStorage.removeItem('na_asistente_proto'); // marca vieja del prototipo: ya no hace falta
    disabled = root.localStorage.getItem(OFF_KEY) === '1';
  } catch (_) {}
  if (disabled) { try { root.document.documentElement.classList.remove('na-asst-owner', 'na-asst-pre'); } catch (_) {} }
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
  // Lentitud y cuelgues: llamadas a la API de más de 3 s (solo la ruta), tareas largas (PerformanceObserver longtask, si existe), carga
  // de pantallas de más de 1,5 s y un latido de 1 s que marca «cuelgue» cuando la pantalla visible se congela más de 5 s. Lectura de
  // boletas: duración, fallas y correcciones (sin la foto ni los datos).
  // Cliente: si el problema pasa justo después de tocar algo de un cliente (abono, crédito, editar cliente), se guarda SOLO el código
  // interno que ya tiene ese cliente en la lista del POS (su id) y la acción. Nunca nombre, DNI, teléfono, dirección ni montos.
  var REV_KEY = 'na_asst_rev', REV_MAX = 200, REV_USAGE_MAX = 300, REV_SLOW_MAX = 200, rev = null, revTimer = 0, revOn = false;
  var REV_SLOW_API_MS = 3000, REV_SCREEN_MS = 1500, REV_TASK_MS = 1000, REV_HANG_MS = 5000, REV_BEAT_MS = 1000, REV_CTX_MS = 15000;
  var revCtx = null, ltOn = false, ltUntil = 0, beatLast = 0, beatTimer = 0;
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
    if (!Array.isArray(rev.s)) rev.s = [];
    if (!rev.o || typeof rev.o !== 'object') rev.o = { reads: 0, fails: 0, timeouts: 0, ms_sum: 0, ms_max: 0, corrections: 0, confirmed: 0 };
    return rev;
  }
  function revFlush() { clearTimeout(revTimer); revTimer = 0; if (rev) ls(REV_KEY, JSON.stringify(rev)); }
  function revSave() { if (!revTimer) revTimer = setTimeout(revFlush, 3000); } // se escribe en tanda, nunca en cada evento
  // ---- cliente: solo el código interno que YA existe en la lista de clientes del POS ----
  function revClients() { try { return typeof clientes !== 'undefined' && Array.isArray(clientes) ? clientes : (Array.isArray(root.clientes) ? root.clientes : []); } catch (_) { return []; } }
  function revCredits() { try { return typeof creditos !== 'undefined' && Array.isArray(creditos) ? creditos : (Array.isArray(root.creditos) ? root.creditos : []); } catch (_) { return []; } }
  function revGlobal(n) { try { return n === 'cliCredId' ? (typeof cliCredId !== 'undefined' ? cliCredId : null) : n === 'pagoCredId' ? (typeof pagoCredId !== 'undefined' ? pagoCredId : null) : null; } catch (_) { return null; } }
  function revClientCode(id) { // id -> código del cliente existente (o null). Nunca devuelve otra cosa que el id ya guardado.
    if (id == null || id === '') return null; var c = revClients().find(function (x) { return x && String(x.id) === String(id); });
    if (!c) return null; var code = String(c.id);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(code) || code === String(c.dni || '') || code === String(c.telefono || c.tel || '')) return null;
    return code;
  }
  function revCreditClient(crId) { var cr = crId == null ? null : revCredits().find(function (x) { return x && String(x.id) === String(crId); }); return cr ? revClientCode(cr.cliId) : null; }
  function revAction(fn) {
    fn = String(fn || '');
    if (/pago|abon|cobr/i.test(fn)) return 'abono';
    if (/guardarCli|ModalCli|editar?Cli|editCli/i.test(fn)) return 'editar cliente';
    if (/cred|fiad|linea/i.test(fn)) return 'venta a crédito';
    if (/cli/i.test(fn)) return 'ver cliente';
    return null;
  }
  function revCustomerCtx(e, fn, arg) { // al tocar un botón: ¿es de un cliente? -> { cli, accion, t }
    var accion = revAction(fn); if (!accion) return null;
    var cli = null;
    if (accion === 'abono') cli = revCreditClient(arg) || revCreditClient(revGlobal('pagoCredId'));
    if (!cli) cli = revClientCode(arg) || revClientCode(revGlobal('cliCredId'));
    if (!cli && e && e.closest) { var h = e.closest('[data-cli-id],[data-client-id]'); if (h) cli = revClientCode(h.getAttribute('data-cli-id') || h.getAttribute('data-client-id')); }
    return cli ? { cli: cli, accion: accion, t: Date.now() } : null;
  }
  function revCtxNow() { return revCtx && Date.now() - revCtx.t <= REV_CTX_MS ? revCtx : null; }
  // Solo el TIPO del error («TypeError»), nunca su mensaje: puede traer el nombre o los datos de un cliente.
  function revErrType(msg, err) {
    var n = err && typeof err.name === 'string' ? err.name : '';
    if (/^[A-Za-z]{1,40}$/.test(n)) return n;
    var m = /^(?:Uncaught\s+)?(?:\(in promise\)\s*)?([A-Z][A-Za-z]{0,39}(?:Error|Exception))\b/.exec(String(msg == null ? '' : msg).trim());
    return m ? m[1] : (err == null || typeof err === 'object' || msg ? 'Error' : 'Rechazo');
  }
  function revError(kind, msg, src, status) {
    if (disabled) return;
    var r = revLoad(), m = revClean(msg, 160), s = revClean(src, 80), now = new Date().toISOString(), cx = revCtxNow(), cli = cx ? cx.cli : null, ac = cx ? cx.accion : null; status = status || 0;
    if (!m && !s) return;
    for (var i = r.e.length - 1; i >= 0; i--) { var x = r.e[i];
      if (x.kind === kind && x.msg === m && x.src === s && (x.status || 0) === status && (x.cli || null) === cli) { x.count++; x.last = now; r.e.splice(i, 1); r.e.push(x); revSave(); return; } }
    var it = { kind: kind, msg: m, src: s, status: status, count: 1, first: now, last: now }; if (cli) { it.cli = cli; it.accion = ac; }
    r.e.push(it);
    if (r.e.length > REV_MAX) r.e.splice(0, r.e.length - REV_MAX);
    revSave();
  }
  function revSlow(kind, name, ms) { // kind: api | tarea | pantalla | cuelgue
    if (disabled) return;
    var r = revLoad(), n = revClean(name, 80), now = new Date().toISOString(), cx = revCtxNow(), cli = cx ? cx.cli : null; ms = Math.max(0, Math.round(Number(ms) || 0));
    if (!n) return;
    for (var i = r.s.length - 1; i >= 0; i--) { var x = r.s[i];
      if (x.kind === kind && x.name === n && (x.cli || null) === cli) { x.count++; x.ms_sum += ms; if (ms > x.ms_max) x.ms_max = ms; x.last = now; r.s.splice(i, 1); r.s.push(x); revSave(); return; } }
    var it = { kind: kind, name: n, count: 1, ms_sum: ms, ms_max: ms, first: now, last: now }; if (cli) { it.cli = cli; it.accion = cx.accion; }
    r.s.push(it); if (r.s.length > REV_SLOW_MAX) r.s.splice(0, r.s.length - REV_SLOW_MAX);
    revSave();
  }
  function revScreen() { var p = root.document.querySelector ? root.document.querySelector('.page.active') : null; return p && p.id ? String(p.id).replace(/[^\w-]/g, '').slice(0, 30) : 'otro'; }
  function revFile(u) { var s = String(u || ''); try { var x = new URL(s, root.location.href); s = x.origin === root.location.origin ? x.pathname : x.host + x.pathname; } catch (_) {} return s.replace(/\d{3,}/g, '#'); }
  function revParse(e) { var oc = e.getAttribute('onclick'), m = oc && /^\s*([A-Za-z_][\w]{0,40})\s*\(\s*(?:'([\w-]{0,40})'|"([\w-]{0,40})"|([\w-]{1,40}))?/.exec(oc); return m ? { fn: m[1], arg: m[2] || m[3] || m[4] || '' } : null; }
  function revTarget(t) {
    var e = t && t.closest ? t.closest('button,a,[onclick],[data-action],[role="button"],input[type="button"],input[type="submit"]') : null;
    return !e || e.closest('[id^="naAsst"],[class*="na-asst"]') ? null : e; // el propio asistente no cuenta
  }
  function revUseKey(t) {
    var e = revTarget(t); if (!e) return null;
    var pg = e.closest('.page'), scr = pg && pg.id ? pg.id : (e.closest('.modal,[role="dialog"]') ? 'modal' : 'otro');
    var p = revParse(e), act = p ? p.fn : (e.getAttribute('data-action') || e.id || ''), arg = p && /^[A-Za-z]/.test(p.arg) ? p.arg : '';
    act = String(act).replace(/\d+/g, '#').replace(/[^\w#-]/g, '').slice(0, 40); arg = String(arg).replace(/\d+/g, '#').slice(0, 30);
    scr = String(scr).replace(/[^\w-]/g, '').slice(0, 30);
    return act && /^[A-Za-z]/.test(scr) ? scr + ':' + act + (arg ? ':' + arg : '') : null;
  }
  function revClick(ev) {
    if (disabled) return;
    var k = revUseKey(ev.target); if (!k) return; var r = revLoad();
    if (r.u[k] || Object.keys(r.u).length < REV_USAGE_MAX) { r.u[k] = (r.u[k] || 0) + 1; revSave(); }
    var e = revTarget(ev.target), p = e && revParse(e);
    revCtx = revCustomerCtx(e, p ? p.fn : (e.getAttribute('data-action') || e.id), p ? p.arg : '') || null;
    if (p && p.fn === 'goPage' && p.arg) { var t0 = Date.now(), pageId = p.arg; // carga de pantalla: hasta el primer cuadro libre después del clic
      setTimeout(function () { var raf = root.requestAnimationFrame || function (f) { setTimeout(f, 16); };
        raf(function () { var ms = Date.now() - t0; if (ms >= REV_SCREEN_MS) revSlow('pantalla', pageId, ms); }); }, 0); }
  }
  function revBeat() { // latido: si la pantalla VISIBLE no respondió en más de 5 s -> cuelgue (una tarea larga ya contada no se cuenta dos veces)
    var now = Date.now(), gap = now - beatLast; beatLast = now;
    if (root.document.hidden || gap < REV_HANG_MS) return gap;
    var scr = revScreen(), from = now - gap;
    // Con tareas largas observadas, se espera un poco: si el congelamiento ya vino como tarea larga, no se cuenta dos veces.
    if (!ltOn) revSlow('cuelgue', scr, gap - REV_BEAT_MS);
    else (root.setTimeout || setTimeout)(function () { if (ltUntil < from) revSlow('cuelgue', scr, gap - REV_BEAT_MS); }, REV_BEAT_MS * 2);
    return gap;
  }
  function revInstall() {
    if (revOn) return; revOn = true;
    root.addEventListener('error', function (e) { if (e && e.message) revError('error', revErrType(e.message, e.error), revFile(e.filename) + (e.lineno ? ':' + e.lineno : ''), 0); });
    root.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; revError('promesa', revErrType(r && typeof r === 'object' ? r.message : '', r && typeof r === 'object' ? r : null), '', 0); });
    root.document.addEventListener('click', revClick, { capture: true, passive: true });
    root.addEventListener('pagehide', revFlush);
    root.document.addEventListener('visibilitychange', function () { beatLast = Date.now(); if (root.document.hidden) revFlush(); });
    try {
      if (root.PerformanceObserver) new root.PerformanceObserver(function (l) { l.getEntries().forEach(function (x) {
        if (x.initiatorType !== 'fetch' && x.initiatorType !== 'xmlhttprequest') return;
        var st = Number(x.responseStatus) || 0; if (st >= 400) revError('api', revFile(x.name), '', st);
        if (Number(x.duration) > REV_SLOW_API_MS) revSlow('api', revFile(x.name), x.duration); }); })
        .observe({ type: 'resource', buffered: true });
    } catch (_) {}
    try {
      var P = root.PerformanceObserver, types = P && P.supportedEntryTypes;
      if (P && types && types.indexOf('longtask') >= 0) { ltOn = true; new P(function (l) { l.getEntries().forEach(function (x) {
        var d = Number(x.duration) || 0; if (d < REV_TASK_MS) return; ltUntil = Date.now(); revSlow(d >= REV_HANG_MS ? 'cuelgue' : 'tarea', revScreen(), d); }); })
        .observe({ type: 'longtask' }); }
    } catch (_) { ltOn = false; }
    beatLast = Date.now(); if (typeof root.setInterval === 'function') beatTimer = root.setInterval(revBeat, REV_BEAT_MS); // 1 latido por segundo: casi sin costo
  }
  function revOcr(x) { // lo llama asistente-boleta.js: { ok, ms, timeout, corrections, confirmed } (sin foto ni datos)
    var o = revLoad().o, ms = Math.max(0, Math.round(Number(x && x.ms) || 0));
    if (x && x.confirmed) { o.confirmed++; o.corrections += Math.max(0, Math.min(500, Math.floor(Number(x.corrections) || 0))); revSave(); return; }
    o.reads++; o.ms_sum += ms; if (ms > o.ms_max) o.ms_max = ms; if (!(x && x.ok)) o.fails++; if (x && x.timeout) o.timeouts++;
    if (ms > REV_SLOW_API_MS * 10) revSlow('api', 'leer boleta', ms);
    revSave();
  }
  root.NA_ASISTENTE_REVISION = {
    // Lo que se manda SOLO cuando el Admin pide la revisión (la UI lo pasa además por el redactor del asistente). De clientes: solo el código.
    data: function () { var r = revLoad(); return {
      errors: r.e.map(function (x) { var o = { kind: x.kind, msg: x.msg, src: x.src, status: x.status, count: x.count, first: x.first, last: x.last }; if (x.cli) { o.cli = x.cli; o.accion = x.accion; } return o; }),
      usage: JSON.parse(JSON.stringify(r.u)),
      slow: r.s.map(function (x) { var o = { kind: x.kind, name: x.name, count: x.count, ms_avg: Math.round(x.ms_sum / Math.max(1, x.count)), ms_max: x.ms_max, last: x.last }; if (x.cli) { o.cli = x.cli; o.accion = x.accion; } return o; }),
      ocr: JSON.parse(JSON.stringify(r.o)) }; },
    newErrors: function () { var r = revLoad(), n = 0; r.e.concat(r.s.filter(function (x) { return x.kind === 'cuelgue'; })).forEach(function (x) { if (!r.seen || x.last > r.seen) n++; }); return n; },
    markSeen: function () { var r = revLoad(); r.seen = new Date().toISOString(); revFlush(); },
    installed: function () { return revOn; },
    ocr: function (x) { if (revOn) revOcr(x); },
    // Nombre del cliente SOLO para mostrarlo en ESTE aparato (nunca se manda): busca en la lista de clientes que ya tiene el POS.
    customerName: function (code) { var c = revClientCode(code) && revClients().find(function (x) { return String(x.id) === String(code); }); return c ? String(c.nombre || c.name || '').slice(0, 80) : null; },
    openCustomer: function (code) {
      var c = revClientCode(code) && revClients().find(function (x) { return String(x.id) === String(code); }); if (!c) return false;
      try { if (typeof abrirCred === 'function') { abrirCred(c.id); return true; } } catch (_) {}
      try { if (typeof root.goPage === 'function') { root.goPage('pageClientes'); return true; } } catch (_) {}
      return false;
    },
    _test: { beat: revBeat, ctx: function () { return revCtxNow(); }, slow: revSlow }
  };
  slotCss();
  if (!disabled && ls('na_asistente_acc') === 'owner') { reserve(); revInstall(); }
  root.NA_ASISTENTE_SLOT = { reserve: reserve, unreserve: unreserve, release: release, NOTICE: NOTICE };
  function load() {
    if (loaded) return; loaded = true;
    var d = root.document, l = d.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/asistente.css'; d.head.appendChild(l);
    // core y ui se piden a la vez (antes: ui esperaba a que core terminara de bajar) y se ejecutan en este mismo orden (async=false).
    // Si core no bajara, ui no hace nada: empieza con «if (!C) return», igual que antes, cuando ui ni se pedía.
    var a = d.createElement('script'); a.async = false; a.src = 'js/modules/asistente/asistente-core.js';
    var b = d.createElement('script'); b.async = false; b.src = 'js/modules/asistente/asistente-ui.js';
    d.body.appendChild(a); d.body.appendChild(b);
  }
  // Mismo pedido que usa la UI: endpoint y Bearer de la sesión del POS, sin cookies. En el prototipo local, rol simulado.
  // Como máximo una pregunta cada 10 s (ASK_EVERY_MS). Sin internet no cuenta como pregunta, y si el pedido falla tampoco:
  // al reconectar se vuelve a preguntar enseguida (Bot 3: antes esperaba 30 s y al reconectar no pasaba nada).
  // Pedido corto (3 s, AbortController): con mala señal se corta y queda lo que había (nunca bloquea al POS). Corre en un momento libre
  // DESPUÉS de que el POS abrió (load + requestIdleCallback) y desde este cargador chico: el empleado en Apagado no baja nada más.
  var ASK_EVERY_MS = 10000, ASK_TIMEOUT_MS = 3000;
  function ask() {
    if (disabled || loaded || asking || Date.now() - lastAsk < ASK_EVERY_MS) return;
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
      if (disabled) return; // lo apagaron mientras se preguntaba
      if (x.st === 200 && x.d.ok) { lastState = x.d.role === 'owner' ? 'owner' : 'on'; ls('na_asistente_acc', lastState); if (x.d.role !== 'owner') unreserve(); else revInstall(); load(); cfgPaint(); return; }
      if (x.st === 403 && x.d.reason === 'sin_rol') { lastState = 'sin_rol'; ls('na_asistente_acc', null); unreserve(); load(); cfgPaint(); return; }
      if (x.st === 401 || x.st === 403 || x.st === 404) { lastState = 'off'; ls('na_asistente_acc', null); unreserve(); cfgPaint(); } // apagado: no se baja nada y el hueco (si lo había) se quita
    }, function () { clearTimeout(t); asking = false; lastAsk = 0; if (ls('na_asistente_acc') === 'owner') load(); });
  }
  // ---------- Configuración > Personal y seguridad > Aparatos conectados: «Asistente en este aparato» (solo Admin) ----------
  // Va junto al permiso del asistente para empleados (debajo de la lista de aparatos). Se guarda solo, en este aparato, sin PIN.
  // Apagar: fuera la burbuja, la tarjeta de Inicio y la revisión del POS en este aparato, y no se vuelven a bajar sus archivos.
  // Encender: se pregunta al servidor enseguida y, si corresponde, se carga sin recargar la página.
  function isAdminHere() { try { return !!(root.NA_ROLES && root.NA_ROLES.isOwner && root.NA_ROLES.isOwner()); } catch (_) { return false; } }
  function cfgText() {
    if (disabled) return 'Apagado: el asistente no aparece en este aparato.';
    if (lastState === 'owner') return 'Encendido: el asistente aparece en este aparato.';
    if (lastState === 'sin_rol') return 'Encendido, pero este aparato todavía no está habilitado como Admin del asistente.';
    if (lastState === 'off') return 'Encendido, pero el servidor no tiene el asistente activo para este aparato.';
    return 'Encendido.';
  }
  function cfgPaint() { var d = root.document; if (!d.querySelectorAll) return; d.querySelectorAll('.na-asst-sw').forEach(function (r) { var cb = r.querySelector('input'), t = r.querySelector('small'); if (cb) cb.checked = !disabled; if (t) t.textContent = cfgText(); }); }
  function cfgSwitch() {
    var d = root.document; if (!d.querySelectorAll || !isAdminHere()) return;
    d.querySelectorAll('#naDevList').forEach(function (list) {
      var host = list.parentElement; if (!host || host.querySelector('.na-asst-sw')) return;
      var row = d.createElement('div'); row.className = 'na9-row na9-row-sw na-asst-sw';
      var t = d.createElement('div'); t.className = 'na9-t'; t.appendChild(d.createTextNode('Asistente en este aparato '));
      var tag = d.createElement('em'); tag.className = 'na9-tag'; tag.textContent = 'este aparato'; t.appendChild(tag);
      var sm = d.createElement('small'); t.appendChild(sm);
      var lab = d.createElement('label'); lab.className = 'na9-sw'; var cb = d.createElement('input'); cb.type = 'checkbox'; cb.setAttribute('aria-label', 'Asistente en este aparato');
      lab.appendChild(cb); lab.appendChild(d.createElement('span'));
      cb.addEventListener('change', function () { setEnabled(cb.checked); });
      row.appendChild(t); row.appendChild(lab); host.insertBefore(row, list.nextSibling);
    });
    cfgPaint();
  }
  function setEnabled(v) {
    v = !!v;
    if (!v) {
      disabled = true; ls(OFF_KEY, '1'); ls('na_asistente_acc', null);
      var A = root.NA_ASISTENTE; if (A && A.suspend) try { A.suspend(); } catch (_) {}
      release();
    } else {
      disabled = false; ls(OFF_KEY, null); lastAsk = 0;
      var B = root.NA_ASISTENTE; if (loaded && B && B.resume) try { B.resume(); } catch (_) {} else ask();
    }
    cfgPaint();
    return !disabled;
  }
  function watchConfig() {
    var cfg = root.document.getElementById && root.document.getElementById('pageConfig'); if (!cfg || !root.MutationObserver) { cfgSwitch(); return; }
    var tm = 0; new root.MutationObserver(function () { if (tm) return; tm = setTimeout(function () { tm = 0; cfgSwitch(); }, 120); }).observe(cfg, { childList: true, subtree: true }); // solo Configuración
    cfgSwitch();
  }
  root.NA_ASISTENTE_LOADER = { ask: ask, loaded: function () { return loaded; }, setEnabled: setEnabled, enabled: function () { return !disabled; }, state: function () { return lastState; }, cfgSwitch: cfgSwitch };
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
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', watchConfig, { once: true }); else watchConfig();
})(window);
