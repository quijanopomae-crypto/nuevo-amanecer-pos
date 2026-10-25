/* CM-013 / CM-066 — Presentaciones y factores de empaque (lógica pura).
   Reutiliza SOLO campos existentes: producto unidad/precio/unidadCompra/factorCompra/unidCaja/precioCaja/stock;
   línea de venta qty/ventaModo/unitsPerQty. No crea campos nuevos.
   No toca DOM, Venta, TOTAL, Pagar/Cobrar ni el Worker. Bloqueado por
   FEATURE_LOCKS['venta-por-presentacion'] (true = bloqueado) hasta que el dueño lo abra. */
(function (root) {
  'use strict';
  var LOCK_ID = 'venta-por-presentacion';
  // Misma lista que _NA_DECIMAL_UNITS en inline-02.js (parche cm066-redondeo-kg); una prueba verifica que coincidan.
  var DECIMAL_UNITS = ['kilogramo', 'kg', 'gramo', 'litro', 'mililitro'];
  var LABELS = { unidad: 'UND', caja: 'CAJA', paquete: 'PAQ', sixpack: 'SIXPACK', fardo: 'FARDO', docena: 'DOCENA', bolsa: 'BOLSA', kg: 'KG', otro: 'PRES' };

  function num(v, d) { var n = Number(v); return Number.isFinite(n) ? n : (d === undefined ? 0 : d); }
  function clean(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function allowsDecimals(product) { return DECIMAL_UNITS.indexOf(clean(product && product.unidad)) >= 0; }
  // Redondeo solo para quitar ruido binario (6 decimales); nunca a entero.
  function tidy(n) { return Math.round(n * 1e6) / 1e6; }

  function locked() {
    try {
    // El global real de la tabla única de permisos es NA_PERMISSIONS (antes buscaba otro nombre y siempre quedaba bloqueado).
    var p = root.NA_PERMISSIONS;
    if (p && typeof p.featureLocked === 'function') return p.featureLocked(LOCK_ID) !== false;
    } catch (_) { return true; }
    return true; // sin política cargada o con error: bloqueado
  }

  function presentations(product) {
    var base = clean(product && product.unidad) || 'unidad';
    var out = [{ id: base === 'unidad' ? 'unidad' : base, label: LABELS[base] || base.toUpperCase(), factor: 1, price: num(product && product.precio) }];
    var unit = clean(product && product.unidadCompra);
    var factor = num(product && product.factorCompra, 0);
    if (unit && unit !== 'unidad' && unit !== base && factor > 0) {
      out.push({ id: unit, label: LABELS[unit] || unit.toUpperCase(), factor: factor,
        price: unit === 'caja' && num(product.precioCaja) > 0 ? num(product.precioCaja) : null });
    }
    var uc = num(product && product.unidCaja, 0);
    if (uc > 0 && !out.some(function (p) { return p.id === 'caja'; })) {
      out.push({ id: 'caja', label: 'CAJA', factor: uc, price: num(product.precioCaja) > 0 ? num(product.precioCaja) : null });
    }
    return out;
  }

  function find(product, presentationId) {
    var id = clean(presentationId) || 'unidad';
    var list = presentations(product);
    return list.find(function (p) { return p.id === id; }) || (id === 'unidad' ? list[0] : null);
  }

  function baseUnits(product, qty, presentationId) {
    var p = find(product, presentationId);
    if (!p) throw new Error('PRESENTACION_INVALIDA');
    var q = num(qty, NaN);
    if (!Number.isFinite(q) || q <= 0) throw new Error('CANTIDAD_INVALIDA');
    if (!allowsDecimals(product) && p.factor === 1 && Math.floor(q) !== q) throw new Error('CANTIDAD_ENTERA_REQUERIDA');
    var units = tidy(q * p.factor);
    if (!allowsDecimals(product) && Math.floor(units) !== units) throw new Error('UNIDADES_FRACCIONARIAS');
    return units;
  }

  // Aplica un movimiento idempotente: el mismo opId nunca se aplica dos veces.
  function apply(product, op, applied) {
    var seen = applied || new Set();
    if (!op || !op.opId) throw new Error('OP_ID_REQUERIDO');
    if (seen.has(op.opId)) return { product: product, applied: false, delta: 0 };
    var units = baseUnits(product, op.qty, op.presentation);
    var delta = op.type === 'compra' ? units : op.type === 'venta' ? -units : NaN;
    if (!Number.isFinite(delta)) throw new Error('TIPO_INVALIDO');
    seen.add(op.opId);
    var next = Object.assign({}, product, { stock: tidy(num(product.stock) + delta) });
    return { product: next, applied: true, delta: delta };
  }

  function ticketLabel(item) {
    var qty = num(item && (item.qty != null ? item.qty : item.cantidad));
    var label = LABELS[clean(item && item.ventaModo)] || 'UND';
    var factor = num(item && item.unitsPerQty, 1);
    return qty + ' ' + label + (factor > 1 ? ' x' + factor : '');
  }

  var api = { LOCK_ID: LOCK_ID, DECIMAL_UNITS: DECIMAL_UNITS.slice(), locked: locked, presentations: presentations, find: find, baseUnits: baseUnits, apply: apply, ticketLabel: ticketLabel, allowsDecimals: allowsDecimals };
  root.NA_PRESENTACIONES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
