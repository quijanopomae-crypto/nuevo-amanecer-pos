/* Punto de equilibrio: proyección de solo lectura de ventas, costos y gastos en memoria. Solo dueño. */
(function (root) {
  'use strict';

  var PAGE_ID = 'pagePuntoEquilibrio';
  // «Pago a proveedor» es compra de mercadería: ya se cuenta en el costo de lo vendido.
  var EXCLUDED_EXPENSE_CATS = ['proveedor'];
  function text(value) { return String(value == null ? '' : value).trim(); }
  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    var raw = text(value).replace(/\s/g, '');
    if (!/[0-9]/.test(raw)) return NaN;
    if (raw.indexOf(',') >= 0 && raw.indexOf('.') >= 0) raw = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    else if (raw.indexOf(',') >= 0) raw = raw.replace(',', '.');
    var result = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(result) ? result : NaN;
  }
  function positive(value) { var n = number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
  function round2(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
  function validDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    var date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
  }
  // Misma semántica fecha || timestamp y -05:00 sin zona que Rotación ABC / reportes de ventas.
  function limaDay(value) {
    var raw = text(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return validDay(raw);
    if (!raw) return '';
    if (typeof value === 'number' || value instanceof Date) raw = value;
    else {
      if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || !validDay(raw.slice(0, 10))) return '';
      if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += '-05:00';
    }
    if (root.NALimaTime && typeof root.NALimaTime.parts === 'function') {
      var parts = root.NALimaTime.parts(raw);
      return parts ? parts.date : '';
    }
    var date = new Date(raw);
    return Number.isFinite(date.getTime()) ? new Date(date.getTime() - 5 * 3600000).toISOString().slice(0, 10) : '';
  }
  // month: 'YYYY-MM'. Sin mes válido: el mes actual en hora de Lima.
  function monthRange(month, now) {
    var value = /^\d{4}-(0[1-9]|1[0-2])$/.test(text(month)) ? text(month) : limaDay(now === undefined ? Date.now() : now).slice(0, 7);
    if (!value) throw new RangeError('Fecha de referencia inválida');
    var y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7));
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { month: value, from: value + '-01', to: value + '-' + String(last).padStart(2, '0') };
  }
  function unitsSold(item) {
    var qty = positive(item.qty != null ? item.qty : item.cantidad);
    var per = Math.max(1, Math.floor(positive(item.unitsPerQty)) || 1);
    return qty * per;
  }
  function voided(record) {
    var state = text(record.estado || record.status).toLowerCase();
    return !!(record.anulada || record.voided || record.anulado || state === 'anulada' || state === 'anulado' || state === 'voided');
  }

  // Pura. Ventas y costo igual que calcularGanancias (inline-02): importe = precio × qty de cada línea;
  // costo = costo guardado en la línea (> 0) o, si falta, el costo actual del producto, × unidades vendidas.
  function calculate(sales, expenses, products, options) {
    options = options || {};
    var range = options.range || monthRange(options.month, options.now);
    var byId = new Map(), byName = new Map();
    (Array.isArray(products) ? products : []).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      if (p.id != null && !byId.has(text(p.id))) byId.set(text(p.id), p);
      if (text(p.name) && !byName.has(text(p.name))) byName.set(text(p.name), p);
    });
    function inRange(day) { return !!day && day >= range.from && day <= range.to; }
    var salesTotal = 0, cost = 0, saleCount = 0, linesWithoutCost = 0;
    (Array.isArray(sales) ? sales : []).forEach(function (sale) {
      if (!sale || typeof sale !== 'object' || voided(sale)) return;
      if (!inRange(limaDay(sale.fecha || sale.timestamp))) return;
      var items = Array.isArray(sale.items) ? sale.items : [];
      saleCount++;
      var saleAmount = 0;
      items.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var qty = positive(item.qty != null ? item.qty : item.cantidad);
        var price = positive(item.precio != null ? item.precio : item.precioUnitario);
        if (!qty) return;
        saleAmount += price * qty;
        var unitCost = positive(item.costo);
        if (!unitCost) {
          var product = (item.id != null && byId.get(text(item.id))) || byName.get(text(item.name));
          unitCost = product ? positive(product.costo) : 0;
        }
        if (!unitCost) linesWithoutCost++;
        else cost += unitCost * unitsSold(item);
      });
      salesTotal += round2(saleAmount);
    });
    var expensesTotal = 0, expenseCount = 0, excludedExpenses = 0;
    (Array.isArray(expenses) ? expenses : []).forEach(function (g) {
      if (!g || typeof g !== 'object' || voided(g)) return;
      if (!inRange(limaDay(g.fecha || g.timestamp))) return;
      var amount = positive(g.monto);
      if (!amount) return;
      if (EXCLUDED_EXPENSE_CATS.indexOf(text(g.cat || g.categoria).toLowerCase()) >= 0) { excludedExpenses = round2(excludedExpenses + amount); return; }
      expensesTotal += amount; expenseCount++;
    });
    salesTotal = round2(salesTotal); cost = round2(cost); expensesTotal = round2(expensesTotal);
    var margin = salesTotal > 0 ? (salesTotal - cost) / salesTotal : null;
    var status = !salesTotal ? 'sin-ventas' : margin <= 0 ? 'margen-negativo' : 'ok';
    var breakEven = status === 'ok' ? round2(expensesTotal / margin) : null;
    return {
      range: range, sales: salesTotal, cost: cost, expenses: expensesTotal, margin: margin,
      breakEven: breakEven, difference: breakEven === null ? null : round2(salesTotal - breakEven),
      status: status, saleCount: saleCount, expenseCount: expenseCount,
      linesWithoutCost: linesWithoutCost, excludedExpenses: excludedExpenses
    };
  }
  // Mismo formato que el comprobante (#872): S/ con dos decimales y comas de miles.
  function formatMoney(value) {
    var n = Number(value) || 0, sign = n < 0 ? '-' : '';
    return sign + 'S/ ' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function formatPercent(value) { return (value * 100).toFixed(1) + '%'; }

  // Alias de NA_ROLES.isOwner (fuente única del rol dueño). Falla cerrada si NA_ROLES falta o lanza error.
  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  // No es una regla de rol: confirma que la tabla de permisos cargó (falla cerrada sin ella).
  function policyReady() {
    try { var permissions = root.NA_PERMISSIONS; return !!(permissions && typeof permissions.canAccessScreen === 'function' && permissions.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  function ownerAllowed() { return isOwner() && policyReady(); }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function dateLabel(day) { return day.slice(8, 10) + '/' + day.slice(5, 7) + '/' + day.slice(0, 4); }
  function render() {
    var page = root.document && root.document.getElementById(PAGE_ID);
    var host = page && page.querySelector('[data-pe-report]');
    var status = page && page.querySelector('[data-pe-status]');
    if (!host || !status) return false;
    var controls = page.querySelector('[data-pe-controls]');
    var authorized = ownerAllowed();
    if (controls) controls.hidden = !authorized;
    if (!authorized) { status.textContent = ''; host.replaceChildren(element('p', 'pe-notice', 'Sin permiso. Pídele acceso al dueño.')); return false; }
    var input = page.querySelector('[data-pe-month]');
    var range = monthRange(input ? input.value : '');
    if (input && input.value !== range.month) input.value = range.month;
    // ventas, gastos y productos son let globales del POS, no necesariamente propiedades de window.
    var sales = typeof ventas !== 'undefined' ? ventas : root.ventas;
    var expenses = typeof gastos !== 'undefined' ? gastos : root.gastos;
    var products = typeof productos !== 'undefined' ? productos : root.productos;
    var r = calculate(sales, expenses, products, { range: range });
    status.textContent = dateLabel(range.from) + ' al ' + dateLabel(range.to) + ' · hora de Lima · datos cargados en este dispositivo';
    var summary = element('div', 'pe-summary');
    [['Ventas del período', formatMoney(r.sales)],
      ['Costo de lo vendido' + (r.linesWithoutCost ? ' (incompleto)' : ''), formatMoney(r.cost)],
      ['Gastos fijos', formatMoney(r.expenses)],
      ['Margen de contribución', r.margin === null ? '—' : formatPercent(r.margin)],
      ['Venta mínima de equilibrio', r.breakEven === null ? '—' : formatMoney(r.breakEven)]].forEach(function (item) {
      var card = element('div', 'pe-card');
      card.appendChild(element('span', '', item[0])); card.appendChild(element('strong', '', item[1]));
      summary.appendChild(card);
    });
    var result = element('p', 'pe-result');
    result.setAttribute('data-pe-result', r.status);
    if (r.status === 'sin-ventas') result.textContent = 'Sin ventas en el período. No se puede calcular el punto de equilibrio.';
    else if (r.status === 'margen-negativo') result.textContent = 'El margen es 0% o negativo: con estos precios y costos ninguna venta cubre los gastos. Revisa tus costos y precios.';
    else if (r.difference >= 0) { result.textContent = 'Vas ' + formatMoney(r.difference) + ' por encima del punto de equilibrio.'; result.setAttribute('data-pe-direction', 'arriba'); }
    else { result.textContent = 'Te faltan ' + formatMoney(-r.difference) + ' en ventas para llegar al punto de equilibrio.'; result.setAttribute('data-pe-direction', 'abajo'); }
    var notices = element('div', 'pe-notices');
    function notice(value) { notices.appendChild(element('p', 'pe-notice', value)); }
    if (!r.expenseCount) notice('No hay gastos registrados en el período. Registra tus gastos fijos (alquiler, luz, sueldos) en Gastos.');
    if (r.linesWithoutCost) notice(r.linesWithoutCost + ' línea(s) vendida(s) sin costo. El costo está incompleto y el margen puede salir más alto de lo real.');
    if (r.excludedExpenses) notice('No se cuentan ' + formatMoney(r.excludedExpenses) + ' de «Pago a proveedor»: esas compras ya están en el costo de lo vendido.');
    host.replaceChildren(summary, result, notices);
    return true;
  }
  function init() {
    var page = root.document.getElementById(PAGE_ID);
    if (!page) return;
    var refresh = page.querySelector('[data-pe-refresh]');
    if (refresh) refresh.addEventListener('click', render);
    var input = page.querySelector('[data-pe-month]');
    if (input) input.addEventListener('change', render);
    function update() { if (!ownerAllowed() || page.classList.contains('active')) render(); }
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    if (typeof root.addEventListener === 'function') root.addEventListener('na:role', update);
    update();
  }
  root.NA_PUNTO_EQUILIBRIO = Object.freeze({ calculate: calculate, monthRange: monthRange, formatMoney: formatMoney, formatPercent: formatPercent, render: render });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NA_PUNTO_EQUILIBRIO;
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(globalThis);
