/* Etiquetas de vendedor/cajero: sufijo solo cuando dos personas distintas tienen el mismo nombre.
   - Identidad = id del usuario (cajeroId, opened_by_user_id…); sin id, el nombre normalizado.
   - «Mismo nombre» = igual sin distinguir mayúsculas ni espacios extra (como el alta de cajeros y el historial del cliente).
   - Choque solo con dos o más ids distintos; sin id + un único id con ese nombre = la misma persona (#815).
   - Sufijo « · ID»: ids cortos tal cual (CAJ-002, igual que «Nombre · CAJ-002» de los selectores y del historial);
     ids largos (UUID, aparato): el prefijo más corto (mín. 4) que no se repite dentro del grupo. Sin id: « (sin id)» (#815).
   - Nombre único: se muestra igual que antes. Se calcula al mostrar; no se guarda nada ni cambian los datos. */
(function (root) {
  'use strict';

  var SHORT_MAX = 10, SHORT_MIN = 4;
  function clean(value) { return String(value == null ? '' : value).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function nameOf(value) { return value && typeof value === 'object' ? clean(value.nombre || value.name || '') : clean(value); }
  function nameKey(name) { return nameOf(name).toLocaleLowerCase('es'); }
  // Identidad estable para agrupar: por id; sin id, por nombre normalizado (ventas antiguas solo con nombre).
  function sellerKey(id, name) {
    var i = clean(id); if (i) return 'id:' + i;
    var n = nameKey(name); return n ? 'name:' + n : '';
  }
  function compact(id) {
    var tail = id.slice(id.lastIndexOf(':') + 1).replace(/[^A-Za-z0-9]/g, '');
    return (tail || id.replace(/[^A-Za-z0-9]/g, '') || id).toLowerCase();
  }
  // Forma corta de cada id de un grupo. Determinista: no depende del orden.
  function shortForms(ids) {
    var out = {}, longIds = ids.filter(function (id) { return id.length > SHORT_MAX; });
    ids.forEach(function (id) { if (id.length <= SHORT_MAX) out[id] = id; });
    var taken = ids.filter(function (id) { return id.length <= SHORT_MAX; }).map(function (id) { return id.toLowerCase(); });
    longIds.forEach(function (id) {
      var full = compact(id), others = longIds.filter(function (o) { return o !== id; }).map(compact);
      for (var n = Math.min(SHORT_MIN, full.length); n <= full.length; n++) {
        var mine = full.slice(0, n);
        if (taken.indexOf(mine) < 0 && others.every(function (o) { return o.slice(0, n) !== mine; })) { out[id] = mine; return; }
      }
      out[id] = id;
    });
    return out;
  }

  // entries: [{ id, name }] (o { id, nombre }). Devuelve un etiquetador puro.
  function create(entries) {
    var groups = new Map();
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var n = nameKey(entry.name != null ? entry.name : entry.nombre);
      if (!n) return;
      if (!groups.has(n)) groups.set(n, new Set());
      groups.get(n).add(clean(entry.id));
    });
    var suffixes = new Map();
    groups.forEach(function (identities, n) {
      // Choque = dos o más ids distintos con el nombre. Una venta antigua solo con nombre junto a UN único id
      // es la misma persona (regla de #815): no se agrega sufijo.
      var ids = Array.from(identities).filter(Boolean).sort();
      if (ids.length < 2) return;
      var shorts = shortForms(ids), map = new Map();
      ids.forEach(function (id) { map.set(id, ' · ' + shorts[id]); });
      map.set('', ' (sin id)');
      suffixes.set(n, map);
    });
    function suffix(id, name) {
      var map = suffixes.get(nameKey(name)), i = clean(id);
      if (!map) return '';
      if (map.has(i)) return map.get(i);
      // Id que no estaba en el universo: igual se distingue, con la misma regla.
      return ' · ' + (i.length <= SHORT_MAX ? i : compact(i).slice(0, SHORT_MIN));
    }
    function collides(name) { return suffixes.has(nameKey(name)); }
    function label(id, name, fallback) {
      var n = nameOf(name);
      if (!n) return fallback == null ? '' : String(fallback);
      return n + suffix(id, n);
    }
    return Object.freeze({ label: label, suffix: suffix, collides: collides, key: sellerKey });
  }

  /* ---- Universos de la app (solo lectura) ---- */
  function list(value) { return Array.isArray(value) ? value : []; }
  /* global appConfig, ventas, cashClosures, cajEstado */
  function appState() {
    return {
      config: typeof appConfig !== 'undefined' ? appConfig : root.appConfig,
      sales: typeof ventas !== 'undefined' ? ventas : root.ventas,
      closes: typeof cashClosures !== 'undefined' ? cashClosures : root.cashClosures,
      state: typeof cajEstado !== 'undefined' ? cajEstado : root.cajEstado
    };
  }
  var memo = null;
  function forget() { memo = null; }
  // Cajeros locales: registro de cajeros + ventas + cierres + caja abierta + quién abrió cada turno CANON.
  function cashiers() {
    var s = appState(), registry = list(s.config && s.config.cashiers), sales = list(s.sales), closes = list(s.closes);
    var sig = registry.length + '|' + sales.length + '|' + closes.length + '|' + (s.state ? clean(s.state.cajeroId) + clean(s.state.cajeroNombre || s.state.cajero) : '');
    // Memo de una tarea: una lista que pinta cientos de filas arma el índice una sola vez.
    if (memo && memo.sig === sig && memo.sales === s.sales && memo.registry === (s.config && s.config.cashiers)) return memo.labeler;
    var out = [];
    registry.forEach(function (c) { if (c) out.push({ id: c.id, name: c.nombre || c.name }); });
    sales.forEach(function (v) { if (v) out.push({ id: v.cajeroId, name: v.cajeroNombre || v.cajero }); });
    closes.forEach(function (c) { if (c) out.push({ id: c.cajeroId, name: c.cajeroNombre || c.cajero }); });
    if (s.state) out.push({ id: s.state.cajeroId, name: s.state.cajeroNombre || s.state.cajero });
    try {
      var history = root.NuevoAmanecerCashHistory, map = history && typeof history.cashierMap === 'function' ? history.cashierMap() : null;
      Object.keys(map || {}).forEach(function (k) { var c = map[k]; if (c) out.push({ id: c.id, name: c.nombre }); });
    } catch (_) {}
    var labeler = create(out);
    memo = { sig: sig, sales: s.sales, registry: s.config && s.config.cashiers, labeler: labeler };
    if (typeof root.setTimeout === 'function') root.setTimeout(forget, 0);
    return labeler;
  }
  function cashierLabel(id, name, fallback) { return cashiers().label(id, name, fallback); }
  // Comprobante: sufijo solo si se conoce el id del cajero (sin id no se agrega «(sin id)» al ticket).
  function cashierIdSuffix(id, name) { return clean(id) && nameOf(name) ? cashiers().suffix(id, name) : ''; }
  function snapshotSessions() {
    try { var client = root.NuevoAmanecerCanonical, snap = client && typeof client.snapshot === 'function' ? client.snapshot() : null; return list(snap && snap.cashSessions); } catch (_) { return []; }
  }
  // Usuarios de la nube que abren/cierran caja: opened_by_user_id / closed_by_user_id de la réplica.
  function sessionUsers(extra) {
    var out = [];
    snapshotSessions().concat(list(extra)).forEach(function (s) {
      if (!s) return;
      out.push({ id: s.opened_by_user_id, name: s.opened_by_name });
      out.push({ id: s.closed_by_user_id, name: s.closed_by_name });
    });
    return create(out);
  }
  // Ids por session_id desde la réplica local (la respuesta del arqueo del servidor solo trae nombres).
  function sessionUserIds() {
    var out = {};
    snapshotSessions().forEach(function (s) { if (s && s.session_id) out[String(s.session_id)] = { opened: clean(s.opened_by_user_id), closed: clean(s.closed_by_user_id) }; });
    return out;
  }

  var api = Object.freeze({ create: create, key: sellerKey, nameKey: nameKey, cashiers: cashiers, cashierLabel: cashierLabel, cashierIdSuffix: cashierIdSuffix, sessionUsers: sessionUsers, sessionUserIds: sessionUserIds, forget: forget });
  root.NA_SELLER_LABELS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
