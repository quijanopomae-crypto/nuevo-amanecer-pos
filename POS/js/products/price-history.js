/* Historial de cambios de precio por producto.
   Clave propia: no altera productos, ventas ni tickets.
   El costo solo lo ve el dueño confirmado (NA_ROLES.isOwner), igual que Compras. */
(function (root) {
  'use strict';
  var KEY = 'na_price_history_v1';
  var TYPES = { venta: 'Venta', mayorista: 'Mayorista', costo: 'Costo' };
  var ORIGINS = { ficha: 'Ficha del producto', importacion: 'Importación', compra: 'Compra', masivo: 'Edición masiva', deshacer: 'Deshacer masivo' };
  var LOCK_ID = 'historial-precios-producto';
  var FIELDS = ['venta', 'mayorista', 'costo'];
  var entrySeq = 0;
  // Candado: solo con featureLocked(LOCK_ID) === false. Si falta o falla, el historial queda cerrado.
  function enabled() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(LOCK_ID) === false); } catch (_) { return false; }
  }

  function read() {
    try {
      var raw = root.localStorage.getItem(KEY);
      var data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }
  function isQuota(err) {
    if (!err) return false;
    var name = String(err.name || '');
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014;
  }
  function oldestId(data) {
    var best = null, bestAt = null;
    Object.keys(data).forEach(function (id) {
      var list = data[id];
      if (!Array.isArray(list) || !list.length) return;
      var row = list[list.length - 1];
      var at = row && row.at ? String(row.at) : '';
      if (best == null || at < bestAt) { best = id; bestAt = at; }
    });
    return best;
  }
  function warnQuota() {
    try {
      if (typeof root.toast === 'function') root.toast('El historial de precios se recortó: el almacenamiento del aparato está lleno.', 'warning');
    } catch (_) {}
  }
  function write(data) {
    var warned = false;
    for (;;) {
      try {
        root.localStorage.setItem(KEY, JSON.stringify(data));
        return;
      } catch (err) {
        if (!isQuota(err)) return;
        if (!warned) { warned = true; warnQuota(); }
        var id = oldestId(data);
        if (!id) return;
        data[id].pop();
        if (!data[id].length) delete data[id];
      }
    }
  }
  function cents(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }
  function soles(value) { return value == null ? null : value / 100; }
  function text(value, max) {
    var out = String(value == null ? '' : value).trim();
    return out ? out.slice(0, max || 80) : '';
  }
  function cashierName() {
    try { if (typeof cajEstado !== 'undefined' && cajEstado && cajEstado.cajero) return text(cajEstado.cajero); } catch (_) {}
    return '';
  }
  function cashierId() {
    try { if (typeof appConfig !== 'undefined' && appConfig && appConfig.activeCashierId) return text(appConfig.activeCashierId); } catch (_) {}
    try { if (typeof cajEstado !== 'undefined' && cajEstado && cajEstado.cajeroId) return text(cajEstado.cajeroId); } catch (_) {}
    return '';
  }
  function actor(explicitName, explicitId) {
    var name = text(explicitName);
    var id = text(explicitId);
    try {
      var roles = root.NA_ROLES;
      if (!name) {
        if (roles && roles.label) name = text(roles.label);
        else name = cashierName();
        if (!name && roles && roles.role === 'empleado') name = 'Empleado';
        else if (!name && roles && roles.role === 'owner') name = 'Dueño';
      }
      if (!id) {
        if (roles && roles.deviceId) id = text(roles.deviceId);
        else id = cashierId();
      }
    } catch (_) {}
    return { name: name || 'Usuario', id: id || null };
  }
  function stamp(at) {
    var ms = at ? Date.parse(at) : Date.now();
    return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
  }
  function remember(list, entry) {
    for (var i = 0; i < list.length; i++) {
      if (entry.ref && list[i].ref === entry.ref) return false;
      if (list[i].id === entry.id) return false;
    }
    list.unshift(entry);
    if (list.length > 200) list.length = 200;
    return true;
  }
  function recordDiff(opts) {
    opts = opts || {};
    var productId = opts.productId == null ? '' : String(opts.productId);
    var origin = opts.origin;
    if (!enabled()) return [];
    if (!productId || !opts.before || !opts.after) return [];
    if (!Object.prototype.hasOwnProperty.call(ORIGINS, origin)) return [];
    var data = read();
    var list = Array.isArray(data[productId]) ? data[productId].slice() : [];
    var added = [];
    var at = stamp(opts.at);
    var who = actor(opts.user, opts.userId);
    FIELDS.forEach(function (key) {
      if (opts.partial && !Object.prototype.hasOwnProperty.call(opts.after, key)) return;
      var before = cents(opts.before[key]);
      var after = cents(opts.after[key]);
      if (before === after) return;
      // Mayorista: 0 y vacío son «sin precio»; pasar de S/ 0.00 a vacío (o al revés) no es un cambio.
      if (key === 'mayorista' && !before && !after) return;
      var seq = ++entrySeq;
      var entry = {
        id: productId + ':' + at + ':' + key + ':' + (opts.ref || 'change') + ':' + seq,
        seq: seq,
        at: at,
        user: who.name,
        userId: who.id,
        type: key,
        before: soles(before),
        after: soles(after),
        origin: origin
      };
      if (opts.ref) entry.ref = String(opts.ref) + ':' + key;
      if (remember(list, entry)) added.push(entry);
    });
    if (added.length) { data[productId] = list; write(data); }
    return added;
  }
  function prices(product) {
    if (!product) return { venta: null, mayorista: null, costo: null };
    return {
      venta: product.precio != null ? product.precio : product.price,
      mayorista: product.precioCaja != null ? product.precioCaja : null,
      costo: product.costo != null ? product.costo : (product.cost_cents != null ? product.cost_cents / 100 : null)
    };
  }
  function recordCatalogDiff(beforeList, afterList, origin, user) {
    var afterById = {};
    (afterList || []).forEach(function (product) {
      if (product && product.id != null) afterById[String(product.id)] = product;
    });
    var added = [];
    (beforeList || []).forEach(function (previous) {
      if (!previous || previous.id == null) return;
      var next = afterById[String(previous.id)];
      if (!next || next === previous) return;
      added = added.concat(recordDiff({
        productId: previous.id,
        origin: origin,
        user: user,
        before: prices(previous),
        after: prices(next)
      }));
    });
    return added;
  }
  function catalog() {
    try { return typeof productos !== 'undefined' && Array.isArray(productos) ? productos : []; }
    catch (_) { return []; }
  }
  function latest(productId, type) {
    var rows = read()[String(productId)];
    if (!Array.isArray(rows)) return undefined;
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || row.type !== type) continue;
      if (!best || String(row.at) > String(best.at) || (String(row.at) === String(best.at) && (Number(row.seq) || 0) > (Number(best.seq) || 0))) best = row;
    }
    return best ? best.after : undefined;
  }
  function recordPurchase(operationId, lines, result, products) {
    if (!operationId || !result || result.idempotent) return [];
    var applied = {};
    (result.applied || []).forEach(function (row) {
      var line = row && (row.line != null ? row.line : row.line_number);
      if (line != null) applied[String(line)] = true;
    });
    if (!Object.keys(applied).length) return [];
    var list = products || catalog();
    var added = [];
    (lines || []).forEach(function (line) {
      if (!line || !applied[String(line.line)] || line.unit_cost_cents == null) return;
      var product = list.find(function (item) {
        return item && (String(item.id) === String(line.product_id) || String(item.product_id) === String(line.product_id));
      });
      var catalogCost = product ? prices(product).costo : null;
      var known = latest(line.product_id, 'costo');
      var nextCost = Number(line.unit_cost_cents) / 100;
      // La compra no reescribe el producto: el costo vigente es el de la ficha
      // o, si ya hubo un cambio, el último costo registrado.
      if (cents(nextCost) === cents(catalogCost)) return;
      if (known !== undefined && cents(nextCost) === cents(known)) return;
      added = added.concat(recordDiff({
        productId: line.product_id,
        origin: 'compra',
        ref: String(operationId) + ':' + line.line,
        partial: true,
        before: { costo: known === undefined ? catalogCost : known },
        after: { costo: nextCost }
      }));
    });
    return added;
  }
  function canSeeCost() {
    try {
      var roles = root.NA_ROLES;
      return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true);
    } catch (_) { return false; }
  }
  function list(productId, options) {
    if (!enabled()) return [];
    var rows = read()[String(productId == null ? '' : productId)];
    if (!Array.isArray(rows)) return [];
    var seeCost = options && Object.prototype.hasOwnProperty.call(options, 'includeCost')
      ? !!options.includeCost
      : canSeeCost();
    var only = options && typeof options.type === 'string' && Object.prototype.hasOwnProperty.call(TYPES, options.type) ? options.type : '';
    return rows.filter(function (row) { return row && (seeCost || row.type !== 'costo') && (!only || row.type === only); }).sort(function (a, b) {
      var delta = (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
      if (delta) return delta;
      return (Number(b.seq) || 0) - (Number(a.seq) || 0);
    }).map(function (row) {
      return { id: row.id, at: row.at, user: row.user, userId: row.userId || null, type: row.type, before: row.before, after: row.after, origin: row.origin };
    });
  }
  function money(value) {
    if (value == null || !Number.isFinite(Number(value))) return 'Sin precio';
    return 'S/ ' + Number(value).toFixed(2);
  }
  root.NA_PRICE_HISTORY = Object.freeze({
    KEY: KEY,
    LOCK_ID: LOCK_ID,
    enabled: enabled,
    recordDiff: recordDiff,
    recordCatalogDiff: recordCatalogDiff,
    recordPurchase: recordPurchase,
    list: list,
    canSeeCost: canSeeCost,
    money: money,
    labels: Object.freeze({ type: Object.freeze(TYPES), origin: Object.freeze(ORIGINS) })
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
