(function (root) {
  'use strict';
  // Pure canonical projection. No storage, network, DOM or legacy window mirrors.
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function fail(code) { throw new Error(code); }
  function uint(n) { return Number.isSafeInteger(n) && n >= 0; }
  function safe(n) { if (!uint(n)) fail('UNSAFE_LOCAL_AMOUNT'); return n; }
  function id(n) { return typeof n === 'string' && n.length > 0 && n.length <= 160 && !/[\x00-\x1f\x7f]/.test(n); }
  function row(list, field, value) { var found = list.find(function (r) { return r[field] === value; }); if (!found) fail('LOCAL_ENTITY_NOT_FOUND_' + field); return found; }
  function revision(actual, expected) { if (!uint(actual) || actual !== expected) fail('LOCAL_RESOURCE_REVISION_CONFLICT'); }
  function resources(command, p, s) {
    var out = [];
    if (p.session_id) out.push('cash:' + p.session_id);
    if (command === 'cash.open') out.push('cash:opening');
    if (command === 'sale.create') {
      out.push('sale:' + p.sale_id);
      (p.items || []).forEach(function (i) { out.push('product:' + i.product_id); });
      if (p.payment && p.payment.cash_cents && !p.session_id) {
        var open = (s.cashSessions || []).find(function (r) { return r.status === 'OPEN'; });
        if (open) out.push('cash:' + open.session_id);
      }
    }
    if (p.product_id) out.push('product:' + p.product_id);
    if (p.customer_id) out.push('customer:' + p.customer_id);
    if (p.credit_id) out.push('credit:' + p.credit_id);
    if (p.account_id) out.push('account:' + p.customer_id + ':' + p.account_id);
    if (p.compensates_operation_id) {
      out.push('operation:' + p.compensates_operation_id);
      var target = (s.financialEvents || []).find(function (r) { return r.operation_id === p.compensates_operation_id; });
      if (target && target.credit_id) out.push('credit:' + target.credit_id);
    }
    if (command === 'payment.batch') (p.payments || []).forEach(function (child) { out.push.apply(out, resources('payment.create', child, s)); });
    var ref = p.reference || p.payment && p.payment.reference;
    if (ref) out.push('reference:' + String(ref).trim().toLowerCase());
    return Array.from(new Set(out));
  }
  function checkReference(s, ref) {
    if (!ref) return;
    if (!id(ref)) fail('INVALID_LOCAL_REFERENCE');
    var key = ref.trim().toLowerCase();
    var reversed = new Set(s.financialEvents.filter(function (e) { return e.compensates_operation_id; }).map(function (e) { return e.compensates_operation_id; }));
    var used = s.sales.concat(s.payments, s.cashMovements, s.financialEvents).some(function (r) {
      if (reversed.has(r.operation_id) || r.compensates_operation_id) return false;
      return [r.reference, r.payment_reference, r.source_operation_reference].some(function (v) { return typeof v === 'string' && v.trim().toLowerCase() === key; });
    });
    if (used) fail('DUPLICATE_LOCAL_REFERENCE');
  }
  function cash(s, sessionId) {
    var opened = s.cashSessions.filter(function (r) { return r.status === 'OPEN'; });
    var session = opened.find(function (r) { return sessionId ? r.session_id === sessionId : true; });
    if (!session || opened.length !== 1) fail('INVALID_LOCAL_CASH_SESSION');
    return session;
  }
  function changeCash(s, sessionId, delta, expectedRevision, bump) {
    var c = cash(s, sessionId);
    if (expectedRevision !== undefined) revision(c.revision, expectedRevision);
    c.expected_cents = safe(c.expected_cents + delta);
    if (bump !== false) c.revision = safe(c.revision + 1);
    return c;
  }
  function apply(input, event) {
    var s = copy(input), p = event && event.payload, command = event && event.command;
    if (!s || s.authority !== 'canonical' || !p || !id(p.operation_id) || p.promotion_id !== s.promotion_id || p.authority_epoch !== s.authority_epoch || p.expected_control_revision !== s.revision || p.client_contract !== 'a6-gate-c-v1') fail('INVALID_LOCAL_AUTHORITY');
    ['products','customers','credits','payments','creditAccounts','sales','saleItems','cashSessions','cashMovements','financialEvents','inventoryMovements','expenses'].forEach(function (name) { if (!Array.isArray(s[name])) fail('INVALID_LOCAL_PROJECTION'); });
    var touched = resources(command, p, s);
    var receipt = { status:'local_committed', local_committed:true, operation_id:p.operation_id, command:command, promotion_id:p.promotion_id, authority_epoch:p.authority_epoch, idempotent:false };
    var c, product, customer, credit, target;
    if (command === 'cash.open') {
      if (!id(p.session_id) || !uint(p.opening_cents) || s.cashSessions.some(function (r) { return r.status === 'OPEN' || r.session_id === p.session_id; })) fail('INVALID_LOCAL_CASH_SESSION');
      c = { session_id:p.session_id, promotion_id:p.promotion_id, open_operation_id:p.operation_id, opening_cents:p.opening_cents, expected_cents:p.opening_cents, status:'OPEN', revision:0, opened_at:p.created_at, cash_movement_watermark:s.cashMovements.length };
      s.cashSessions.push(c); Object.assign(receipt, { session_id:c.session_id, session_revision:0, expected_cents:c.expected_cents });
    } else if (command === 'cash.close') {
      c = cash(s, p.session_id); revision(c.revision, p.expected_session_revision); safe(p.counted_cents);
      c.status = 'CLOSED'; c.counted_cents = p.counted_cents; c.difference_cents = p.counted_cents - c.expected_cents;
      c.closed_at = p.created_at; c.close_operation_id = p.operation_id; c.closing_watermark = s.cashMovements.length; c.revision = safe(c.revision + 1);
      Object.assign(receipt, { session_id:c.session_id, session_revision:c.revision, expected_cents:c.expected_cents, counted_cents:c.counted_cents, difference_cents:c.difference_cents });
    } else if (command === 'sale.create') {
      if (!id(p.sale_id) || s.sales.some(function (r) { return r.sale_id === p.sale_id || r.operation_id === p.operation_id; }) || !uint(p.total_cents) || p.total_cents === 0 || !Array.isArray(p.items) || !p.items.length || !p.payment) fail('INVALID_LOCAL_SALE');
      var seen = new Set(), total = 0;
      p.items.forEach(function (item, index) {
        if (!id(item.product_id) || seen.has(item.product_id) || !Number.isFinite(item.quantity) || item.quantity <= 0 || !uint(item.unit_price_cents) || item.line_total_cents !== Math.round(item.quantity * item.unit_price_cents)) fail('INVALID_LOCAL_ITEM');
        seen.add(item.product_id); total = safe(total + item.line_total_cents);
        if (!item.generic_line) {
          product = row(s.products, 'product_id', item.product_id); revision(product.stock_revision, item.expected_stock_revision);
          if (Number(product.tracks_inventory) === 1) {
            var stock = product.current_stock_quantity - item.quantity;
            if (!Number.isFinite(stock) || stock < 0) fail('INSUFFICIENT_LOCAL_STOCK');
            product.current_stock_quantity = stock; product.stock_revision = safe(product.stock_revision + 1);
            s.inventoryMovements.push({ movement_id:p.operation_id+':inventory:'+(index+1), operation_id:p.operation_id, sale_id:p.sale_id, line_number:index+1, product_id:item.product_id, quantity:-item.quantity, created_at:p.created_at, stock_revision_before:item.expected_stock_revision, stock_revision_after:product.stock_revision });
          }
        } else if (item.product_id.slice(0,8) !== 'GENERIC:' || !item.generic_line.name || item.expected_stock_revision !== 0) fail('INVALID_LOCAL_GENERIC_LINE');
        s.saleItems.push(Object.assign({}, copy(item), { sale_id:p.sale_id, operation_id:p.operation_id, line_number:index+1, name:item.generic_line ? item.generic_line.name : product.name, created_at:p.created_at }));
      });
      if (total !== p.total_cents || !uint(p.payment.cash_cents) || !uint(p.payment.digital_cents) || !uint(p.payment.credit_cents) || safe(p.payment.cash_cents + p.payment.digital_cents + p.payment.credit_cents) !== total) fail('INVALID_LOCAL_SALE_TOTAL');
      checkReference(s, p.payment.reference);
      if (p.payment.cash_cents) { c = changeCash(s, p.session_id, p.payment.cash_cents); touched.push('cash:' + c.session_id); }
      if (p.customer_id) customer = row(s.customers, 'customer_id', p.customer_id);
      if (p.payment_method === 'credito') {
        if (!customer || !p.credit_due || p.payment.credit_cents !== total) fail('INVALID_LOCAL_CREDIT');
        var account = p.credit_account || { account_id:'small', name:'Créditos pequeños', mode:'accumulated' };
        if (account.account_id !== 'small' && !s.creditAccounts.some(function (r) { return r.customer_id === p.customer_id && r.account_id === account.account_id; })) s.creditAccounts.push(Object.assign(copy(account), { customer_id:p.customer_id, promotion_id:p.promotion_id, operation_id:p.operation_id }));
        var creditId = p.operation_id + ':credit';
        s.credits.push({ credit_id:creditId, customer_id:p.customer_id, sale_id:p.sale_id, operation_id:p.operation_id, promotion_id:p.promotion_id, provenance:'LIVE', original_amount_cents:total, opening_balance_cents:total, current_balance_cents:total, revision:0, due_date:p.credit_due, status:'LIVE', created_at:p.created_at, account_id:account.account_id, account_name:account.name, account_mode:account.mode, installments:copy(p.installments || []) });
        touched.push('credit:' + creditId);
      } else if (p.payment.credit_cents !== 0) fail('INVALID_LOCAL_PAYMENT');
      // Imported purchase basis stays immutable, matching canonical reads.
      // Current sales remain available separately for commercial summaries.
      s.sales.push({ sale_id:p.sale_id, operation_id:p.operation_id, promotion_id:p.promotion_id, authority_epoch:p.authority_epoch, customer_id:p.customer_id || null, payment_method:p.payment_method, total_cents:total, payment_reference:p.payment.reference || null, created_at:p.created_at, local_committed:true });
      s.cashMovements.push({ movement_id:p.operation_id+':cash', operation_id:p.operation_id, sale_id:p.sale_id, promotion_id:p.promotion_id, session_id:c ? c.session_id : null, payment_method:p.payment_method, amount_cents:total, cash_cents:p.payment.cash_cents, digital_cents:p.payment.digital_cents, credit_cents:p.payment.credit_cents, digital_method:p.payment.digital_method || null, reference:p.payment.reference || null, created_at:p.created_at });
      receipt.sale_id = p.sale_id;
    } else if (command === 'payment.batch') {
      if (!Array.isArray(p.payments) || p.payments.length < 1 || p.payments.length > 60) fail('INVALID_LOCAL_PAYMENT_BATCH');
      var credits = new Set(), first = p.payments[0], receipts = [];
      p.payments.forEach(function (child) {
        if (credits.has(child.credit_id) || child.payment_method !== first.payment_method || child.session_id !== first.session_id || child.reference !== first.reference) fail('INVALID_LOCAL_PAYMENT_BATCH');
        credits.add(child.credit_id);
        // One bank operation reference legitimately covers this whole atomic batch.
        var childState = copy(s);
        if (receipts.length) childState.financialEvents = childState.financialEvents.filter(function (r) { return !receipts.some(function (rr) { return rr.operation_id === r.operation_id; }); });
        if (receipts.length) childState.payments = childState.payments.filter(function (r) { return !receipts.some(function (rr) { return rr.operation_id === r.operation_id; }); });
        var applied = apply(childState, { command:'payment.create', payload:child });
        var newEvent = applied.projection.financialEvents[applied.projection.financialEvents.length-1];
        var newPayment = applied.projection.payments[applied.projection.payments.length-1];
        s.credits = applied.projection.credits; s.cashSessions = applied.projection.cashSessions;
        s.financialEvents.push(newEvent); s.payments.push(newPayment); receipts.push(applied.receipt);
      });
      receipt.receipts = receipts;
    } else if (command === 'payment.create' || command === 'adjustment.create' || command === 'compensation.create') {
      var cashDelta = 0, creditDelta = 0, method = p.payment_method || null;
      if (command === 'payment.create') {
        if (!uint(p.amount_cents) || p.amount_cents === 0 || !['efectivo','yape','plin','transferencia'].includes(p.payment_method)) fail('INVALID_LOCAL_PAYMENT');
        credit = row(s.credits, 'credit_id', p.credit_id); revision(credit.revision, p.expected_credit_revision);
        if (p.amount_cents > credit.current_balance_cents) fail('LOCAL_CREDIT_BALANCE_CONFLICT');
        checkReference(s, p.reference); creditDelta = -p.amount_cents; cashDelta = method === 'efectivo' ? p.amount_cents : 0;
        if (method === 'efectivo' ? !p.session_id : !!p.session_id) fail('INVALID_LOCAL_CASH_SESSION');
      } else if (command === 'adjustment.create') {
        if (!Number.isSafeInteger(p.amount_cents) || p.amount_cents === 0 || !p.reason) fail('INVALID_LOCAL_AMOUNT');
        cashDelta = p.amount_cents;
      } else {
        target = row(s.financialEvents, 'operation_id', p.compensates_operation_id);
        if (!['PAYMENT','ADJUSTMENT'].includes(target.event_type) || s.financialEvents.some(function (r) { return r.compensates_operation_id === p.compensates_operation_id; })) fail('ALREADY_LOCAL_COMPENSATED');
        creditDelta = -target.credit_delta_cents; cashDelta = -target.cash_delta_cents; method = target.payment_method;
        if (target.credit_id) { credit = row(s.credits, 'credit_id', target.credit_id); revision(credit.revision, p.expected_credit_revision); }
        receipt.compensates_operation_id = p.compensates_operation_id;
      }
      if (credit) {
        var balance = safe(credit.current_balance_cents + creditDelta);
        if (balance > credit.opening_balance_cents) fail('LOCAL_CREDIT_BALANCE_CONFLICT');
        credit.current_balance_cents = balance; credit.revision = safe(credit.revision+1);
        Object.assign(receipt, { credit_id:credit.credit_id, credit_provenance:credit.provenance, current_balance_cents:balance, credit_revision:credit.revision });
      }
      if (p.session_id) { c = changeCash(s, p.session_id, cashDelta, p.expected_session_revision); Object.assign(receipt, { session_id:c.session_id, session_revision:c.revision, expected_cents:c.expected_cents }); }
      var eventType = command === 'payment.create' ? 'PAYMENT' : command === 'adjustment.create' ? 'ADJUSTMENT' : 'COMPENSATION';
      var financial = { event_id:p.operation_id, operation_id:p.operation_id, promotion_id:p.promotion_id, event_type:eventType, credit_id:credit ? credit.credit_id : null, credit_provenance:credit ? credit.provenance : null, credit_delta_cents:creditDelta, cash_delta_cents:cashDelta, session_id:p.session_id || null, payment_method:method, reference:p.reference || null, reason:p.reason || null, compensates_operation_id:p.compensates_operation_id || null, created_at:p.created_at };
      s.financialEvents.push(financial);
      if (credit) s.payments.push(Object.assign(copy(financial), { payment_id:p.operation_id, amount_cents:Math.abs(creditDelta), payment_date:p.created_at.slice(0,10), payment_timestamp:p.created_at, payment_date_known:1, method:method, source_operation_reference:p.reference || null, provenance:'LIVE' }));
      Object.assign(receipt, { event_id:p.operation_id, cash_delta_cents:cashDelta, credit_delta_cents:creditDelta });
    } else if (command === 'expense.create') {
      if (!id(p.expense_id) || !uint(p.amount_cents) || !p.amount_cents || !p.concept || !p.category || !['efectivo','yape','plin','transferencia'].includes(p.payment_method) || s.expenses.some(function (r) { return r.expense_id === p.expense_id; })) fail('INVALID_LOCAL_EXPENSE');
      var delta = p.payment_method === 'efectivo' && p.session_id ? -p.amount_cents : 0;
      if (p.session_id) c = changeCash(s, p.session_id, delta, p.expected_session_revision);
      s.expenses.push(Object.assign(copy(p), { session_id:p.session_id || null, cash_delta_cents:delta }));
      Object.assign(receipt, { expense_id:p.expense_id, session_id:p.session_id || null, cash_delta_cents:delta });
    } else if (command === 'inventory.adjust') {
      product = row(s.products, 'product_id', p.product_id); revision(product.stock_revision, p.expected_stock_revision);
      if (Number(product.tracks_inventory) !== 1 || !Number.isFinite(p.quantity) || p.quantity <= 0 || !['ENTRADA','SALIDA'].includes(p.movement_type) || !p.reason) fail('INVALID_LOCAL_INVENTORY');
      var nextStock = product.current_stock_quantity + (p.movement_type === 'ENTRADA' ? p.quantity : -p.quantity);
      if (!Number.isFinite(nextStock) || nextStock < 0) fail('INSUFFICIENT_LOCAL_STOCK');
      product.current_stock_quantity = nextStock; product.stock_revision = safe(product.stock_revision+1);
      var movement = Object.assign(copy(p), { movement_id:p.operation_id+':inventory', stock_revision_before:p.expected_stock_revision, stock_revision_after:product.stock_revision });
      s.inventoryMovements.push(movement); Object.assign(receipt, movement);
    } else if (command === 'customer.create') {
      if (!id(p.customer_id) || !p.name || s.customers.some(function (r) { return r.customer_id === p.customer_id || p.document && r.document === p.document; })) fail('DUPLICATE_LOCAL_CUSTOMER');
      s.customers.push(Object.assign(copy(p), { total_purchases_cents:0, credit_policy_revision:0, provenance:'LIVE' })); receipt.customer_id = p.customer_id;
    } else if (command === 'product.create') {
      if (!id(p.product_id) || !p.name || !uint(p.price_cents) || !p.price_cents || !uint(p.cost_cents) || !Number.isFinite(p.initial_stock_quantity) || p.initial_stock_quantity < 0 || s.products.some(function (r) { return r.product_id === p.product_id; })) fail('INVALID_LOCAL_PRODUCT');
      var codes = [p.sku,p.barcode].concat(p.alternate_codes || []).filter(Boolean).map(function (v) { return String(v).toLowerCase(); });
      if (new Set(codes).size !== codes.length || s.products.some(function (r) { var alt = r.alternate_codes || []; if (!alt.length && r.alternate_codes_json) { try { alt = JSON.parse(r.alternate_codes_json); } catch (_) {} } return [r.sku,r.barcode].concat(alt).filter(Boolean).some(function (v) { return codes.includes(String(v).toLowerCase()); }); })) fail('DUPLICATE_LOCAL_PRODUCT_CODE');
      s.products.push(Object.assign(copy(p), { tracks_inventory:p.tracks_inventory ? 1 : 0, includes_igv:p.includes_igv ? 1 : 0, opening_stock_quantity:p.tracks_inventory ? p.initial_stock_quantity : 0, current_stock_quantity:p.tracks_inventory ? p.initial_stock_quantity : 0, stock_revision:0, alternate_codes_json:JSON.stringify(p.alternate_codes || []), provenance:'LIVE' })); receipt.product_id = p.product_id;
    } else if (command === 'credit-account.create') {
      row(s.customers, 'customer_id', p.customer_id);
      if (!id(p.account_id) || p.account_id === 'small' || !p.name || !['accumulated','separate'].includes(p.mode) || s.creditAccounts.some(function (r) { return r.customer_id === p.customer_id && r.account_id === p.account_id; })) fail('INVALID_LOCAL_CREDIT_ACCOUNT');
      s.creditAccounts.push(copy(p)); receipt.account_id = p.account_id;
    } else if (command === 'customer.credit-policy.set') {
      customer = row(s.customers, 'customer_id', p.customer_id); revision(Number(customer.credit_policy_revision) || 0, p.expected_policy_revision);
      if (!['MANUAL','AUTOMATIC'].includes(p.mode) || p.mode === 'MANUAL' && (!uint(p.manual_limit_cents) || p.manual_limit_cents > 100000000) || p.mode === 'AUTOMATIC' && p.manual_limit_cents !== null) fail('INVALID_LOCAL_CREDIT_POLICY');
      Object.assign(customer, { credit_policy_mode:p.mode, credit_policy_manual_limit_cents:p.manual_limit_cents, credit_policy_revision:p.expected_policy_revision+1, credit_policy_reason:p.reason, credit_policy_administrator_name:p.administrator_name, credit_policy_updated_at:p.created_at });
      Object.assign(receipt, { customer_id:p.customer_id, mode:p.mode, manual_limit_cents:p.manual_limit_cents, policy_revision:customer.credit_policy_revision });
    } else fail('UNSUPPORTED_LOCAL_COMMAND');
    s.financial_revision = safe((s.financial_revision || 0) + (command === 'payment.batch' ? p.payments.length : command === 'credit-account.create' ? 0 : 1));
    return { projection:s, receipt:receipt, resources:Array.from(new Set(touched)) };
  }
  root.NuevoAmanecerCanonicalLocalReducer = Object.freeze({ apply:apply, resources:resources });
})(globalThis);
