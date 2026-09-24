/*
 * Extensiones exclusivas del POS-LAB.
 *
 * Agrega aquí funciones nuevas, eventos o prototipos mientras estén en prueba.
 * NO copies este archivo completo a POS/. Cuando una función sea aprobada,
 * promueve únicamente el cambio mínimo al módulo canónico correspondiente.
 */
(function () {
  'use strict';

  if (!window.__NA_LAB__) {
    throw new Error('LAB_OVERRIDES_OUTSIDE_LAB');
  }

  window._NA_LAB_EXTENSIONS = window._NA_LAB_EXTENSIONS || {
    version: 1,
    experiments: Object.create(null)
  };

  var labClientMotionTimer = 0;
  var labClientMotionReady = false;
  var originalCliRender = (typeof cliRender === 'function') ? cliRender : null;

  function labClientReducedMotion() {
    try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  }

  function labClientEnter(page) {
    if (!page || labClientReducedMotion()) return;
    page.classList.remove('lab-client-refresh-out');
    page.classList.add('lab-client-refresh-in');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        page.classList.remove('lab-client-refresh-in');
      });
    });
  }

  if (originalCliRender) {
    cliRender = function () {
      var context = this;
      var args = arguments;
      var page = document.getElementById('pageClientes');
      var active = !!(page && page.classList.contains('active'));

      if (!active || labClientReducedMotion()) {
        return originalCliRender.apply(context, args);
      }

      // Primera pintura: datos inmediatos, solo una entrada suave.
      if (!labClientMotionReady) {
        labClientMotionReady = true;
        var firstResult = originalCliRender.apply(context, args);
        labClientEnter(page);
        return firstResult;
      }

      // Refrescos siguientes: la vista se desplaza lentamente sin desaparecer.
      // El DOM se actualiza casi al final de la salida y luego vuelve desde la
      // misma posición; no existe salto instantáneo de -Y a +Y.
      clearTimeout(labClientMotionTimer);
      page.classList.remove('lab-client-refresh-in');
      page.classList.add('lab-client-refresh-out');

      labClientMotionTimer = setTimeout(function () {
        originalCliRender.apply(context, args);
        requestAnimationFrame(function () {
          page.classList.remove('lab-client-refresh-out');
        });
      }, 850);
    };
  }

  function clearRouteRestoreShield() {
    document.documentElement.classList.remove('lab-route-restoring');
    document.documentElement.removeAttribute('data-lab-restore-page');
  }

  var originalLoadAppState = (typeof loadAppState === 'function') ? loadAppState : null;
  if (originalLoadAppState) {
    loadAppState = function () {
      try {
        return originalLoadAppState.apply(this, arguments);
      } finally {
        clearRouteRestoreShield();
      }
    };
  } else {
    clearRouteRestoreShield();
  }

  console.info('[NA-LAB] Punto de extensión listo para funciones nuevas.');
})();
