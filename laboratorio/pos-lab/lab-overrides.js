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

  console.info('[NA-LAB] Punto de extensión listo para funciones nuevas.');
})();
