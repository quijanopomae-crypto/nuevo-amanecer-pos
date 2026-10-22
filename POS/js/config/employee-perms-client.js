/* Permisos por empleado, lado del aparato (PR #924). Solo LEE lo que decide el servidor.
   NA_EMPLOYEE_PERMS.may(id) es true únicamente si:
     1) el rol confirmado es empleado,
     2) el id está en la lista cerrada NA_EMPLOYEE_TOGGLES,
     3) NA_PERMISSIONS.featureLocked(id) === false (el candado siempre gana), y
     4) el mapa que mandó el servidor tiene allow[id] === true (normalizado con la lista).
   Cualquier error, dato faltante o sin internet: false (cerrado). El mapa vive solo en memoria.
   La fuente del mapa es intercambiable (setSource). La de fábrica lee el campo opcional
   `employee_allow` de /auth/me; mientras el servidor no lo mande, todo queda cerrado como hoy.
   No toca ownerAllowed(), pos-permissions.js ni el Worker. */
(function (root) {
  'use strict';
  // Pantallas de la lista que el empleado puede abrir si su casilla está prendida.
  var SCREEN_FEATURE = Object.freeze({
    pageClienteHistorial: 'cliente-historial-compras',
    pageEtiquetasPrecios: 'etiquetas-precios',
    pageReporteProductosVencer: 'reporte-productos-vencer',
    pageProductosSinMovimiento: 'productos-sin-movimiento'
  });
  var allow = {};
  var generation = 0;

  function toggles() { var t = root.NA_EMPLOYEE_TOGGLES; return t && typeof t.has === 'function' && typeof t.normalize === 'function' ? t : null; }
  function isEmployee() {
    try { var r = root.NA_ROLES; return !!(r && r.role === 'empleado' && r.confirmed === true); } catch (_) { return false; }
  }
  function normalized(value) {
    try { var t = toggles(); if (!t) return {}; var out = t.normalize(value); return out && typeof out === 'object' ? out : {}; } catch (_) { return {}; }
  }
  // Fuente de fábrica: /auth/me manda `employee_allow` = { id: true } solo al empleado; se envuelve como { allow } para normalize.
  async function defaultSource() {
    var r = root.NA_ROLES;
    if (!r || typeof r.api !== 'function') return null;
    var me = await r.api('/auth/me');
    return me && me.pos_role === 'empleado' && me.employee_allow ? { allow: me.employee_allow } : null;
  }
  var source = defaultSource;

  function may(id) {
    try {
      if (typeof id !== 'string' || !isEmployee()) return false;
      var t = toggles(); if (!t || !t.has(id)) return false;
      var p = root.NA_PERMISSIONS;
      if (!p || typeof p.featureLocked !== 'function' || p.featureLocked(id) !== false) return false;
      return Object.prototype.hasOwnProperty.call(allow, id) && allow[id] === true;
    } catch (_) { return false; }
  }
  function mayScreen(pageId) {
    try { return Object.prototype.hasOwnProperty.call(SCREEN_FEATURE, pageId) && may(SCREEN_FEATURE[pageId]); } catch (_) { return false; }
  }
  function set(value) { allow = normalized(value); emit(); return Object.assign({}, allow); }
  function clear() { allow = {}; }
  function emit() { try { root.dispatchEvent(new CustomEvent('na:employee-perms')); } catch (_) {} }
  async function refresh() {
    var mine = ++generation;
    if (!isEmployee()) { clear(); return {}; }
    var value = null;
    try { value = typeof source === 'function' ? await source() : null; } catch (_) { value = null; }
    if (mine !== generation) return Object.assign({}, allow);
    return set(isEmployee() ? value : null);
  }
  function setSource(fn) { source = typeof fn === 'function' ? fn : function () { return null; }; clear(); }

  root.NA_EMPLOYEE_PERMS = Object.freeze({
    may: may, mayScreen: mayScreen, refresh: refresh, setSource: setSource, set: set, clear: clear,
    SCREEN_FEATURE: SCREEN_FEATURE, snapshot: function () { return Object.assign({}, allow); }
  });
  try { if (typeof root.addEventListener === 'function') root.addEventListener('na:role', function () { if (!isEmployee()) clear(); refresh(); }); } catch (_) {}
})(globalThis);
