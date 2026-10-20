/* Historial de cambios de precio por producto.
   Clave propia: no altera productos, ventas ni tickets.
   El costo solo se entrega a quien puede ver costos de Compras. */
(function (root) {
  'use strict';
  var KEY = 'na_price_history_v1';
  var TYPES = { venta: 'Venta', mayorista: 'Mayorista', costo: 'Costo' };
  var ORIGINS = { ficha: 'Ficha del producto', importacion: 'Importación', compra: 'Compra' };
  var FIELDS = ['venta', 'mayorista', 'costo'];

  function read() {
    try {
      var raw = root.localStorage.getItem(KEY);
      var data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  }
  function write(data) {
    root.localStorage.setItem(KEY, JSON.stringify(data));
  }
  function cents(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }
  function soles(value) { return value == null ? null : value / 100; }
  function actor(explicit) {
    if (explicit) return String(explicit).slice(0, 80);
    try {
      var roles = root.NA_ROLES;
      if (roles && roles.label) return String(roles.label).slice(0, 80);
      if (root.cajEstado && root.cajEstado.cajero) return String(root.cajEstado.cajero).slice(0, 80);
      if (roles && roles.role === 'empleado') return 'Empleado';
      if (roles && roles.role === 'owner') return 'Dueño';
    } catch (_) {}
    return 'Usuario';
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
    if (!productId || !opts.before || !opts.after) return [];
    if (origin !== 'ficha' && origin !== 'importacion' && origin !== 'compra') return [];
    var data = read();
    var list = Array.isArray(data[productId]) ? data[productId].slice() : [];
    var added = [];
    var at = stamp(opts.at);
    var user = actor(opts.user);
    FIELDS.forEach(function (key) {
      if (opts.partial && !Object.prototype.hasOwnProperty.call(opts.after, key)) return;
      var before = cents(opts.before[key]);
      var after = cents(opts.after[key]);
      if (before === after) return;
      var entry = {
        id: productId + ':' + at + ':' + key + ':' + (opts.ref || 'change'),
        at: at,
        user: user,
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
      if (!best || String(row.at) > String(best.at)) best = row;
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
  function canSeeCost(role) {
    try {
      var who = role || (root.NA_ROLES && root.NA_ROLES.role);
      return !!root.NA_PERMISSIONS.canDo(who, 'purchases.costs.view');
    } catch (_) { return false; }
  }
  function list(productId, options) {
    var rows = read()[String(productId == null ? '' : productId)];
    if (!Array.isArray(rows)) return [];
    var seeCost = options && Object.prototype.hasOwnProperty.call(options, 'includeCost')
      ? !!options.includeCost
      : canSeeCost(options && options.role);
    return rows.filter(function (row) { return row && (seeCost || row.type !== 'costo'); }).map(function (row) {
      return { id: row.id, at: row.at, user: row.user, type: row.type, before: row.before, after: row.after, origin: row.origin };
    }).sort(function (a, b) {
      var delta = (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
      return delta || String(b.id).localeCompare(String(a.id));
    });
  }
  function money(value) {
    if (value == null || !Number.isFinite(Number(value))) return 'Sin precio';
    return 'S/ ' + Number(value).toFixed(2);
  }
  root.NA_PRICE_HISTORY = Object.freeze({
    KEY: KEY,
    recordDiff: recordDiff,
    recordCatalogDiff: recordCatalogDiff,
    recordPurchase: recordPurchase,
    list: list,
    canSeeCost: canSeeCost,
    money: money,
    labels: Object.freeze({ type: Object.freeze(TYPES), origin: Object.freeze(ORIGINS) })
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
