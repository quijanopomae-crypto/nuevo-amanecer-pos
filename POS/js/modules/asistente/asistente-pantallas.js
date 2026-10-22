/* Asistente: «Revisión del POS», pantallas (nivel 3). SOLO en el aparato del Admin: lo carga asistente-loader.js (revInstall) en un
   momento libre, varios segundos después de abrir. Empleado o aparato sin rol: este archivo nunca se baja.
   Mira, sin cambiar nada del POS, tres cosas de la pantalla que está a la vista:
   - texto o menú cortado: un elemento que esconde parte de su contenido (scrollWidth > clientWidth con overflow hidden/clip) o que se sale
     del borde de la pantalla, y la página entera más ancha que la pantalla (se mueve de lado);
   - botón chico (solo en aparatos táctiles): un botón, enlace o control de menos de 40 x 40 px;
   - pantalla lenta: el cambio de pantalla tarda 1,5 s o más hasta el primer cuadro dibujado.
   Agrupa por tipo de aparato: celular / tableta / computadora (por el ancho), táctil o con mouse, vertical u horizontal y un nombre corto
   de sistema y navegador («Android», «Chrome»). Ningún identificador único del aparato.
   Privacidad: NUNCA lee el texto de la pantalla (ni innerText ni textContent ni value). Solo etiqueta HTML, id o una clase corta (los números
   se cambian por «#») y el nombre de la función del botón; más el id de la pantalla. Todo queda en el almacén de la revisión del cargador
   (localStorage na_asst_rev, máx. 60 hallazgos) y solo sale cuando el Admin pide «Revisión del punto de venta».
   Liviano: revisa en momentos libres (requestIdleCallback; si no existe, setTimeout), en tandas cortas, como máximo 300 elementos por
   pantalla, una vez por pantalla y tipo de aparato cada 10 minutos, después de cambiar de pantalla o de girar/cambiar el tamaño. Sin
   MutationObserver. Sin avisos, sin PIN y sin preguntas nuevas. */
(function (root) {
  'use strict';
  var MIN_TAP = 40, SLOW_MS = 1500, MAX_EL = 300, MAX_FIND = 15, RESCAN_MS = 600000, AFTER_MS = 800, POLL_MS = 4000, WAIT_MS = 10000, TOL = 2;
  var TAP_SEL = 'button,a[href],[onclick],[role="button"],[role="menuitem"],[role="tab"],input:not([type="hidden"]),select,textarea,summary';
  var CUT_SEL = TAP_SEL + ',label,th,h1,h2,h3,h4,.btn,.tab,.chip,.menu,.dropdown,nav,[role="menu"],[role="dialog"],.modal-content';

  // ---------- funciones puras (también se prueban en Node) ----------
  function deviceKey(o) { // { width, height, touch, ua, platform } -> "tel,tactil,vert,Android,Chrome"
    o = o || {}; var w = Number(o.width) || 0, h = Number(o.height) || 0, ua = String(o.ua || ''), touch = !!o.touch;
    var tipo = w < 600 ? 'tel' : w < 1024 ? 'tableta' : 'pc';
    var os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touch) ? 'iOS' : /CrOS/i.test(ua) ? 'ChromeOS'
      : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'otro';
    var nav = /SamsungBrowser/i.test(ua) ? 'Samsung' : /Edg(?:e|A|iOS)?\//i.test(ua) ? 'Edge' : /OPR\/|Opera/i.test(ua) ? 'Opera' : /Firefox|FxiOS/i.test(ua) ? 'Firefox'
      : /Chrome|CriOS|Chromium/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'otro';
    return [tipo, touch ? 'tactil' : 'raton', h >= w ? 'vert' : 'horiz', os, nav].join(',');
  }
  function shortName(v) { // id o clase -> solo letras/números/_/- (números -> #), máx. 20; si no sirve, ''.
    var s = String(v == null ? '' : v).replace(/\d+/g, '#').replace(/[^\w#-]/g, '');
    return /^[A-Za-z]/.test(s) ? s.slice(0, 20) : '';
  }
  function fnName(oc) { var m = oc && /^\s*([A-Za-z_]\w{0,19})\s*\(/.exec(String(oc)); return m ? m[1] : ''; } // máx. 20: los tramos de 24+ el redactor los tapa
  // Etiqueta del elemento SIN texto: «button#btnCobrar», «a.menu-item(goPage)». Recibe { tag, id, cls, onclick, role }.
  function elLabel(o) {
    o = o || {}; var tag = String(o.tag || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'elemento';
    var id = shortName(o.id), cls = '';
    if (!id) { var cl = String(o.cls || '').split(/\s+/); for (var i = 0; i < cl.length && !cls; i++) if (cl[i] && !/^(?:active|show|open|hidden|na-)/.test(cl[i])) cls = shortName(cl[i]); }
    var fn = fnName(o.onclick), role = !id && !cls && /^[a-z]{1,12}$/.test(String(o.role || '')) ? String(o.role) : '';
    return (tag + (id ? '#' + id : cls ? '.' + cls : role ? '[' + role + ']' : '') + (fn ? '(' + fn + ')' : '')).slice(0, 44);
  }
  // Botón chico: solo en táctil, visible (ancho y alto > 0) y con algún lado < 40 px. Devuelve el lado menor redondeado o 0.
  function smallTarget(rect, touch) {
    if (!touch || !rect) return 0; var w = Number(rect.width) || 0, h = Number(rect.height) || 0;
    if (w <= 0 || h <= 0) return 0; var m = Math.min(w, h); return w < MIN_TAP || h < MIN_TAP ? Math.max(1, Math.round(m)) : 0;
  }
  // Cortado: contenido escondido (overflow hidden/clip con más contenido que caja) o el elemento se sale del borde. Devuelve px o 0.
  function clipped(m, vw) {
    if (!m) return 0; var px = 0, ox = String(m.overflowX || ''), oy = String(m.overflowY || '');
    var hideX = /hidden|clip/.test(ox) || m.textOverflow === 'ellipsis', hideY = /hidden|clip/.test(oy);
    if (hideX && (m.scrollWidth || 0) > (m.clientWidth || 0) + TOL && (m.clientWidth || 0) > 0) px = Math.max(px, m.scrollWidth - m.clientWidth);
    if (hideY && (m.scrollHeight || 0) > (m.clientHeight || 0) + TOL && (m.clientHeight || 0) > 0) px = Math.max(px, m.scrollHeight - m.clientHeight);
    var r = m.rect; if (r && !m.inScroller && vw > 0 && (r.width || 0) > 0 && (r.height || 0) > 0) {
      if (r.right > vw + TOL) px = Math.max(px, r.right - vw); if (r.left < -TOL) px = Math.max(px, -r.left); }
    return Math.round(px);
  }
  function pageOverflow(scrollWidth, vw) { var d = (Number(scrollWidth) || 0) - (Number(vw) || 0); return vw > 0 && d > TOL ? Math.round(d) : 0; }
  function findingName(dev, screen, label) { return (String(dev) + '|' + (String(screen || 'otro').replace(/[^\w-]/g, '').slice(0, 23) || 'otro') + '|' + String(label || '')).slice(0, 80); }
  var pure = { deviceKey: deviceKey, elLabel: elLabel, smallTarget: smallTarget, clipped: clipped, pageOverflow: pageOverflow, findingName: findingName, shortName: shortName,
    MIN_TAP: MIN_TAP, SLOW_MS: SLOW_MS, MAX_EL: MAX_EL, MAX_FIND: MAX_FIND };
  if (typeof module === 'object' && module.exports) module.exports = pure;
  if (!root || !root.document || root.NA_ASISTENTE_PANTALLAS) return;

  // ---------- en el navegador ----------
  var d = root.document, last = {}, queued = false, scanning = false, curPage = null, nav0 = null, pollT = 0, sizeT = 0;
  function R() { return root.NA_ASISTENTE_REVISION; }
  function report(kind, name, v) { var r = R(); if (r && r.layout) try { r.layout(kind, name, v); } catch (_) {} }
  function isTouch() { try { if (root.matchMedia && root.matchMedia('(pointer: coarse)').matches) return true; } catch (_) {} var n = root.navigator || {}; return Number(n.maxTouchPoints) > 0; }
  function dev() { var n = root.navigator || {}; return deviceKey({ width: root.innerWidth, height: root.innerHeight, touch: isTouch(), ua: n.userAgent }); }
  function activePage() { var p = d.querySelector ? d.querySelector('.page.active') : null; return p || null; }
  function screenId() { var p = activePage(); return p && p.id ? String(p.id).replace(/[^\w-]/g, '').slice(0, 23) : 'otro'; }
  function mine(e) { return !!(e.closest && e.closest('[id^="naAsst"],[class*="na-asst"]')); }
  function idle(f, ms) { if (root.requestIdleCallback) root.requestIdleCallback(f, { timeout: ms || 3000 }); else setTimeout(function () { f({ timeRemaining: function () { return 8; }, didTimeout: true }); }, 200); }
  function inScroller(e) { // dentro de una fila que se desliza de lado (chips, tablas anchas): salirse del borde es normal
    for (var p = e.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) { var cs = root.getComputedStyle(p); if (/auto|scroll/.test(cs.overflowX)) return true; }
    return false;
  }
  function candidates() {
    var host = activePage(), list = [], seen = new Set(), push = function (e) { if (list.length < MAX_EL && !seen.has(e) && !mine(e)) { seen.add(e); list.push(e); } };
    var modals = d.querySelectorAll ? d.querySelectorAll('.modal.show,.modal.active,.modal[open],[role="dialog"]:not([hidden])') : [];
    [host].concat(Array.prototype.slice.call(modals)).forEach(function (h) { if (h && h.querySelectorAll) Array.prototype.forEach.call(h.querySelectorAll(CUT_SEL), push); });
    return list;
  }
  function scan() {
    queued = false; if (scanning || d.hidden) return;
    var dk = dev(), scr = screenId(), key = dk + '|' + scr, now = Date.now();
    if (last[key] && now - last[key] < RESCAN_MS) return; last[key] = now; scanning = true;
    var vw = root.innerWidth || 0, touch = dk.indexOf(',tactil,') > 0, found = 0, i = 0, els = candidates();
    var ov = pageOverflow(d.documentElement && d.documentElement.scrollWidth, vw);
    if (ov) { report('desborde', findingName(dk, scr, 'pagina'), ov); found++; }
    function step(dl) {
      var t0 = Date.now();
      while (i < els.length && found < MAX_FIND) {
        if (dl && dl.timeRemaining && dl.timeRemaining() < 2 && Date.now() - t0 > 1) break; if (Date.now() - t0 > 8) break;
        var e = els[i++], r = e.getBoundingClientRect ? e.getBoundingClientRect() : null; if (!r || !(r.width > 0 && r.height > 0)) continue;
        var lab = null, L = function () { return lab || (lab = elLabel({ tag: e.tagName, id: e.id, cls: e.className && e.className.baseVal != null ? e.className.baseVal : e.className, onclick: e.getAttribute && e.getAttribute('onclick'), role: e.getAttribute && e.getAttribute('role') })); };
        if (e.matches && e.matches(TAP_SEL)) { var s = smallTarget(r, touch); if (s) { report('boton_chico', findingName(dk, scr, L()), s); found++; } }
        var cs = root.getComputedStyle(e), out = r.right > vw + TOL || r.left < -TOL;
        var px = clipped({ overflowX: cs.overflowX, overflowY: cs.overflowY, textOverflow: cs.textOverflow, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth,
          scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, rect: r, inScroller: out ? inScroller(e) : false }, vw);
        if (px && found < MAX_FIND) { report('corte', findingName(dk, scr, L()), px); found++; }
      }
      if (i < els.length && found < MAX_FIND) idle(step); else scanning = false;
    }
    idle(step);
  }
  function later(ms) { if (queued) return; queued = true; setTimeout(function () { idle(scan); }, ms || AFTER_MS); }
  function paint2(f) { var raf = root.requestAnimationFrame || function (g) { return setTimeout(g, 16); }; raf(function () { raf(f); }); }
  var NAV_SEL = '[onclick*="goPage"],[onclick*="Page("],[data-page],nav a,nav button,[role="tab"]';
  function onClick(ev) { // ¿botón de cambiar de pantalla? se mide hasta el primer cuadro dibujado de la nueva
    var t = ev && ev.target, e = t && t.closest ? t.closest(NAV_SEL) : null; if (!e || mine(e) || nav0) return;
    var from = screenId(), t0 = Date.now(); nav0 = { from: from, t0: t0 };
    (function wait() { var now = Date.now(), to = screenId();
      if (to !== from) { var dk = dev(); paint2(function () { var ms = Date.now() - t0; nav0 = null; curPage = to; if (ms >= SLOW_MS) report('lenta', findingName(dk, to, 'pantalla'), ms); later(); }); return; }
      if (now - t0 > WAIT_MS) { nav0 = null; return; } setTimeout(wait, now - t0 < 300 ? 30 : 150); })();
  }
  function poll() { clearTimeout(pollT); pollT = setTimeout(poll, POLL_MS); if (d.hidden || nav0) return; var s = screenId(); if (s !== curPage) { curPage = s; later(); } }
  function resized() { clearTimeout(sizeT); sizeT = setTimeout(function () { later(200); }, 1000); }
  root.NA_ASISTENTE_PANTALLAS = { scanNow: function () { last = {}; scan(); }, pure: pure };
  d.addEventListener('click', onClick, { capture: true, passive: true });
  root.addEventListener('resize', resized, { passive: true }); root.addEventListener('orientationchange', resized, { passive: true });
  curPage = screenId(); later(1500); poll();
})(typeof window !== 'undefined' ? window : null);
