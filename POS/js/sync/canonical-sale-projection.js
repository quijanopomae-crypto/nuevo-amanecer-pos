(function (root) {
  'use strict';

  var VERSION = 1;
  var PAYMENT_METHODS = ['efectivo', 'yape', 'plin', 'transferencia', 'credito', 'mixto'];

  function fail(code) {
    var error = new Error(code);
    error.code = code;
    throw error;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function sameId(left, right) {
    return left !== undefined && left !== null && right !== undefined && right !== null && String(left) === String(right);
  }

  function project(base, outboxSnapshot) {
    if (!isRecord(base) || !Array.isArray(base.products) || !Array.isArray(base.customers) ||
        !Array.isArray(base.credits) || !Array.isArray(base.sales)) fail('BASE_INVALID');
    if (!isRecord(outboxSnapshot) || outboxSnapshot.version !== VERSION || !Array.isArray(outboxSnapshot.intents)) fail('OUTBOX_SNAPSHOT_INVALID');

    var result = {
      products: clone(base.products),
      customers: clone(base.customers),
      credits: clone(base.credits),
      sales: clone(base.sales)
    };

    outboxSnapshot.intents.forEach(function (intent) {
      if (!isRecord(intent) || intent.version !== VERSION || !Array.isArray(intent.items) ||
          intent.items.length === 0 || typeof intent.sale_id !== 'string' ||
          !intent.sale_id || typeof intent.operation_id !== 'string' || !intent.operation_id ||
          typeof intent.created_at !== 'string' || !intent.created_at ||
          PAYMENT_METHODS.indexOf(intent.payment_method) === -1 ||
          !Number.isSafeInteger(intent.total_cents) || intent.total_cents < 0 || !isRecord(intent.payment)) fail('OUTBOX_SNAPSHOT_INVALID');

      var sale = {
        id: intent.sale_id,
        operation_id: intent.operation_id,
        created_at: intent.created_at,
        payment_method: intent.payment_method,
        total_cents: intent.total_cents,
        payment: clone(intent.payment),
        status: 'PENDING_SYNC',
        source: 'CANONICAL_OUTBOX',
        items: clone(intent.items),
        conflict: false
      };
      if (intent.customer_id !== undefined) sale.customer_id = intent.customer_id;
      if (intent.credit_due !== undefined) sale.credit_due = intent.credit_due;

      intent.items.forEach(function (item) {
        if (!isRecord(item) || item.product_id === undefined || typeof item.quantity !== 'number' ||
            !Number.isFinite(item.quantity) || item.quantity <= 0 ||
            !Number.isSafeInteger(item.unit_price_cents) || item.unit_price_cents < 0 ||
            !Number.isSafeInteger(item.line_total_cents) || item.line_total_cents < 0) fail('OUTBOX_SNAPSHOT_INVALID');
        var product = result.products.find(function (candidate) { return isRecord(candidate) && sameId(candidate.id, item.product_id); });
        if (!product) {
          if (!sale.conflict) { sale.conflict = true; sale.reason = 'PRODUCT_NOT_FOUND'; }
          return;
        }
        var current = product.projected_stock !== undefined ? product.projected_stock : product.stock;
        if (typeof current !== 'number' || !Number.isFinite(current)) current = 0;
        var next = current - item.quantity;
        if (!Number.isFinite(next)) fail('PROJECTED_STOCK_INVALID');
        product.projected_stock = current;
        if (next < 0) {
          if (!sale.conflict) { sale.conflict = true; sale.reason = 'INSUFFICIENT_PROJECTED_STOCK'; }
          return;
        }
        product.projected_stock = next;
      });

      if (intent.payment_method === 'credito') {
        var customerExists = result.customers.some(function (customer) {
          return isRecord(customer) && sameId(customer.id, intent.customer_id);
        });
        if (!customerExists) {
          if (!sale.conflict) { sale.conflict = true; sale.reason = 'CUSTOMER_NOT_FOUND'; }
        } else {
          result.credits.push({
            id: 'pending:' + intent.sale_id,
            sale_id: intent.sale_id,
            customer_id: intent.customer_id,
            amount_cents: intent.total_cents,
            balance_cents: intent.total_cents,
            due: intent.credit_due,
            status: 'PENDING_SYNC',
            source: 'CANONICAL_OUTBOX'
          });
        }
      }

      result.sales.push(sale);
    });

    return result;
  }

  root.NuevoAmanecerCanonicalSaleProjection = Object.freeze({ VERSION: VERSION, project: project });
})(globalThis);
