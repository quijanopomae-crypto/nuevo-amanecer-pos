/* Asistente (PROTOTIPO AISLADO): la mascota 2.5D v11 del dueño dentro del panel del asistente.
   - Solo dentro del panel (en el lugar de la cara de la cabecera, 46 px). El POS, la burbuja flotante y el diseño del celular no cambian.
   - Carga diferida: este archivo y la mascota (POS/assets/asistente/mascota-v11.html, el archivo del dueño tal cual, con su Three.js
     empaquetado adentro y sin pedidos a otros sitios) se piden SOLO al abrir el panel la primera vez y en un momento libre. Nada se baja
     al arrancar el POS. Con «Ahorro de datos» del navegador no se baja: queda la cara de siempre.
   - Va en un marco (iframe) del mismo sitio, quieto para el lector de pantalla y el teclado (aria-hidden, inert, tabindex -1, sin toques):
     el panel no cambia de tamaño y la cara de siempre queda debajo hasta que la mascota está lista (sin saltos). Si falla, queda la cara.
   - Reacciona con el asistente: «¡Listo!» → salto feliz, «Algo falló» → sorpresa, respuesta terminada → mueve la boca con el texto que se ve
     (ya filtrado por el servidor; la mascota no muestra ni guarda texto). Con «menos movimiento» del sistema no habla ni salta (la mascota
     también lo respeta por su cuenta). Panel cerrado o pestaña oculta: se detiene (batería).
   - La mascota se dibuja a 120 px (su tamaño de widget, 96 px + borde) y se achica con transform: así no hay que tocar su archivo. */
(function (root) {
  'use strict';
  var SRC = 'assets/asistente/mascota-v11.html';
  var BOX = 120, SIZE = 46, READY_MS = 8000, SPEAK_MAX = 240;
  function reduced(w) { try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }
  function saveData(w) { try { var c = w.navigator && w.navigator.connection; return !!(c && c.saveData); } catch (_) { return false; } }
  function idle(w, fn) { if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 1500 }); else w.setTimeout(fn, 200); }
  // host: el contenedor de la cara de la cabecera (.na-asst-char del panel). opts.quality: 'high' | 'low' | 'off' (de la UI).
  function create(host, opts) {
    opts = opts || {};
    var w = opts.win || root, doc = host && host.ownerDocument, frame = null, api = null, ready = false, gone = false, open = true, waitT = 0;
    var ctl = { ready: function () { return ready; }, frame: function () { return frame; } };
    function M() { if (!ready || gone || !frame) return null; try { return api || (api = frame.contentWindow && frame.contentWindow.NAMascota) || null; } catch (_) { return null; } }
    function fail() { gone = true; ready = false; api = null; if (frame && frame.parentNode) frame.parentNode.removeChild(frame); frame = null; if (host) host.classList.remove('na-asst-m11-on'); }
    function onReady() {
      var d; try { d = frame.contentDocument; } catch (_) { d = null; }
      if (!d || !d.body) { fail(); return; }
      // solo dentro del marco: sin el globo de texto del widget (el chat ya muestra el texto) ni su botón (no se toca ni se enfoca)
      var st = d.createElement('style'); st.textContent = '.na-bubble,.na-sr{display:none!important}#na-btn{pointer-events:none!important}'; d.head.appendChild(st);
      var b = d.getElementById('na-btn'); if (b) { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
      ready = true; host.classList.add('na-asst-m11-on');
      var m = M(); if (m) { if (open) m.show(); else m.hide(); }
    }
    function watch(t0) {
      if (gone || !frame) return;
      var ok = false; try { ok = !!(frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.dataset.naReady === '1' && frame.contentWindow.NAMascota); } catch (_) { ok = false; }
      if (ok) { onReady(); return; }
      if (Date.now() - t0 > READY_MS) { fail(); return; }
      waitT = w.setTimeout(function () { watch(t0); }, 120);
    }
    ctl.load = function () {
      if (frame || gone || !host || !doc) return false;
      if (saveData(w)) { gone = true; return false; }
      frame = doc.createElement('iframe');
      frame.className = 'na-asst-m11';
      frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('tabindex', '-1'); frame.setAttribute('inert', ''); frame.setAttribute('title', '');
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.width = String(BOX); frame.height = String(BOX);
      frame.src = SRC + '?widget=1' + (opts.quality === 'low' ? '&q=low' : '');
      frame.addEventListener('load', function () { watch(Date.now()); });
      frame.addEventListener('error', fail);
      host.appendChild(frame);
      return true;
    };
    // estado del asistente → gesto de la mascota (solo los que tienen sentido; el resto la deja tranquila)
    ctl.state = function (s) {
      var m = M(); if (!m) return;
      try { if (s === 'feliz') { if (!reduced(w)) m.react('venta'); } else if (s === 'error') { if (!reduced(w)) m.react('error'); } } catch (_) {}
    };
    // respuesta terminada: la boca se mueve con el texto que se ve (cortado a SPEAK_MAX). Con menos movimiento, nada.
    ctl.speak = function (t) {
      var m = M(); if (!m || reduced(w)) return;
      try { m.speak(String(t || '').slice(0, SPEAK_MAX)); m.show(); } catch (_) {}
    };
    ctl.visible = function (on) { open = !!on; var m = M(); if (!m) return; try { if (open) m.show(); else m.hide(); } catch (_) {} };
    ctl.destroy = function () { w.clearTimeout(waitT); fail(); };
    return ctl;
  }
  var mod = { create: create, SRC: SRC, BOX: BOX, SIZE: SIZE, SPEAK_MAX: SPEAK_MAX, idle: idle };
  root.NA_ASISTENTE_MASCOTA = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof window !== 'undefined' ? window : globalThis);
