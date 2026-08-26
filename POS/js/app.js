/*
 * app.js — bootstrap pasivo del POS (FASE 6; CONECTADO en FASE 7).
 *
 * Conexión (FASE 7, aplicada): al FINAL del <body>, DOS scripts classic SIN
 * defer, en este orden exacto:
 *     <script src="js/compat/legacy-globals.js"></script>
 *     <script src="js/app.js"></script>
 * (dos líneas reversibles; legacy-globals.js debe ir ANTES para registrar
 * _NA_LEGACY_GLOBALS antes de que app.js lo verifique).
 *
 * Este bootstrap es estrictamente PASIVO: solo registra el objeto de arranque
 * y, al dispararse DOMContentLoaded, verifica la presencia de glóbulos vía
 * _NA_LEGACY_GLOBALS.verify() (typeof-only). NO ejecuta negocio, NO toca
 * storage, NO toca V10, NO toca persistencia.
 *
 * Classic script (sin ES modules). Compatible con protocolo file:// (no usa
 * módulos ES, que fallan por origin "null" — observado en FASE 4).
 */
(function () {
  'use strict';

  var boot = {
    phase: 'f6',
    connected: (function () {
      try {
        return (typeof document !== 'undefined')
          && (typeof document.querySelector === 'function')
          && !!document.querySelector('script[src="js/app.js"]');
      } catch (e) {
        return false;
      }
    })(),
    fileProtocol: (location.protocol === 'file:'),
    started: false,
    lastVerify: null,
    verify: function () {
      var legacy = (typeof _NA_LEGACY_GLOBALS !== 'undefined') ? _NA_LEGACY_GLOBALS
        : ((typeof window !== 'undefined' && window._NA_LEGACY_GLOBALS) ? window._NA_LEGACY_GLOBALS : null);
      if (!legacy || typeof legacy.verify !== 'function') {
        return null;
      }
      var result = legacy.verify((typeof window !== 'undefined') ? window : this);
      boot.lastVerify = result;
      if (result && result.missing && result.missing.length) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('[NA-BOOT f6] Faltan glóbulos:', result.missing);
        }
      }
      return result;
    }
  };

  window._NA_BOOT = boot;

  document.addEventListener('DOMContentLoaded', function () {
    boot.started = true;
    boot.verify();
  });
})();
