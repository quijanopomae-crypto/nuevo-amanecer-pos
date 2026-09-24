(function (root) {
  'use strict';

  var CONTRACT = 'a6-gate-c-v1';
  var KEY = 'na_canonical_binding';
  var JOURNAL = 'na_canonical_sale_journal';
  var LOCK = 'na-canonical-financial-writer';
  var METHODS = ['efectivo', 'yape', 'plin', 'transferencia', 'credito', 'mixto'];
  var COMMANDS = ['sale.create', 'payment.create', 'cash.open', 'cash.close', 'adjustment.create', 'compensation.create'];
  var FINANCIAL_METHODS = ['efectivo', 'yape', 'plin', 'transferencia'];
  var binding = null, credentials = {}, data = null, ready = false, loading = null, changed = false, replicaState = { source: 'none', cache: null, validation: 'pending' };

  function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function fail(code) { throw new Error(code); }
  function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value); }
  function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
  function uint(value) { return Number.isSafeInteger(value) && value >= 0; }
  function validReason(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value); }
  function validBinding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !validId(value.deviceId) || !validId(value.promotion_id) ||
        !Number.isSafeInteger(value.authority_epoch) || value.authority_epoch < 0 || !Number.isSafeInteger(value.revision) || value.revision < 0) return false;
    try {
      var url = new URL(value.endpoint);
      return typeof value.endpoint === 'string' && value.endpoint === value.endpoint.replace(/\/+$/, '') &&
        (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || (root.location && url.origin === root.location.origin && url.protocol === 'https:')) &&
        ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch (_) { return false; }
  }
  function stored(name) {
    var raw = root.localStorage.getItem(name);
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch (_) { fail('INVALID_CANONICAL_STORAGE'); }
  }
  function durableJournal(value) {
    var raw = JSON.stringify(value);
    root.localStorage.setItem(JOURNAL, raw);
    if (root.localStorage.getItem(JOURNAL) !== raw) fail('CANONICAL_STORAGE_NOT_DURABLE');
  }
  function journal() {
    var value = stored(JOURNAL);
    if (value === null) return null;
    if (!value || typeof value !== 'object' || !['PENDING', 'CONFIRMED'].includes(value.state) || !validBinding(value.binding) ||
        !COMMANDS.includes(value.command) || value.route !== '/commands/' + value.command || !validPayload(value.command, value.payload) ||
        (value.state === 'CONFIRMED' && !validReceipt(value, value.receipt))) {
      fail('INVALID_CANONICAL_JOURNAL');
    }
    return value;
  }
  try {
    var loaded = stored(KEY);
    if (loaded !== null) {
      if (!validBinding(loaded)) fail('INVALID_AUTHORITY_BINDING');
      binding = loaded;
      var savedSession = JSON.parse(root.sessionStorage.getItem('na_canonical_session') || '{}');
      credentials = savedSession && typeof savedSession === 'object' && !Array.isArray(savedSession) &&
        JSON.stringify(savedSession.binding) === JSON.stringify(binding) && typeof savedSession.token === 'string'
        ? { binding: binding, token: savedSession.token } : {};
      if (savedSession && typeof savedSession === 'object' && !Array.isArray(savedSession) &&
          (Object.keys(savedSession).length !== Object.keys(credentials).length || JSON.stringify(savedSession) !== JSON.stringify(credentials))) {
        if (credentials.token) root.sessionStorage.setItem('na_canonical_session', JSON.stringify(credentials));
        else root.sessionStorage.removeItem('na_canonical_session');
      }
    }
  } catch (_) {
    binding = null;
    credentials = {};
    changed = true;
  }

  function enabled() {
    try { return !!binding || changed || root.localStorage.getItem(KEY) !== null || root.localStorage.getItem(JOURNAL) !== null ||
      (root.location && root.location.hostname === 'nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev'); }
    catch (_) { return true; }
  }
  async function configure(options) {
    return withWriterLock(function () {
    ready = false;
    var existing = journal();
    var candidate = {
      endpoint: String(options && options.endpoint || '').replace(/\/+$/, ''),
      deviceId: String(options && options.deviceId || ''),
      promotion_id: options && options.promotion_id,
      authority_epoch: options && options.authority_epoch,
      revision: options && options.revision
    };
    if (!validBinding(candidate)) fail('INVALID_AUTHORITY_BINDING');
    if (existing && existing.state === 'PENDING' && JSON.stringify(existing.binding) !== JSON.stringify(candidate)) fail('CANONICAL_FINANCIAL_PENDING');
    var raw = JSON.stringify(candidate);
    // Re-authentication of the same pending intent must not rewrite its binding.
    if (existing && existing.state === 'PENDING' && root.localStorage.getItem(KEY) !== raw) fail('STALE_AUTHORITY_BINDING');
    credentials = {};
    changed = true;
    root.localStorage.setItem(KEY, raw);
    if (root.localStorage.getItem(KEY) !== raw) fail('BINDING_NOT_DURABLE');
    var nextCredentials = { binding: candidate, token: String(options.token || '') };
    root.sessionStorage.setItem('na_canonical_session', JSON.stringify(nextCredentials));
    if (root.sessionStorage.getItem('na_canonical_session') !== JSON.stringify(nextCredentials)) fail('SESSION_NOT_AVAILABLE');
    binding = candidate;
    credentials = nextCredentials;
    changed = false;
    return copy(binding);
    });
  }
  function verify(meta, expected) {
    if (!meta || meta.authority !== 'canonical' || meta.promotion_id !== expected.promotion_id || meta.authority_epoch !== expected.authority_epoch || meta.revision !== expected.revision ||
        !['CANONICAL_READ_ONLY', 'ACTIVE'].includes(meta.mode) || !['a6-gate-p-v1', CONTRACT].includes(meta.minimum_client_contract) ||
        (meta.mode === 'ACTIVE' ? meta.read_only !== false || meta.minimum_client_contract !== CONTRACT : meta.read_only !== true)) fail('STALE_AUTHORITY_BINDING');
  }
  function assertBinding(expected) {
    if (!validBinding(expected) || changed || JSON.stringify(binding) !== JSON.stringify(expected) || root.localStorage.getItem(KEY) !== JSON.stringify(expected)) fail('STALE_AUTHORITY_BINDING');
  }
  function validReplica(replica) {
    function hasSecretKey(value) { if (!value || typeof value !== 'object') return false; return Object.keys(value).some(function (key) {
      return /(?:token|secret|password|api.?key|credential)/i.test(key) || hasSecretKey(value[key]); }); }
    function rowsValid(rows) { return Array.isArray(rows) && rows.every(function (row) { return !!row && typeof row === 'object' && !Array.isArray(row); }); }
    return !!(replica && replica.schema_version === 1 && typeof replica.promotion_id === 'string' && replica.promotion_id &&
      Number.isSafeInteger(replica.authority_epoch) && replica.authority_epoch >= 0 && Number.isSafeInteger(replica.revision) && replica.revision >= 0 &&
      typeof replica.cached_at === 'string' && Number.isFinite(Date.parse(replica.cached_at)) && ['CANONICAL_READ_ONLY','ACTIVE'].includes(replica.mode) && typeof replica.read_only === 'boolean' &&
      (replica.financial_revision == null || uint(replica.financial_revision)) && ['products','customers','credits','credit_payments'].every(function (key) { return Array.isArray(replica[key]); }) &&
      (replica.cash_sessions == null || Array.isArray(replica.cash_sessions)) && (replica.financial_events == null || Array.isArray(replica.financial_events)) &&
      (replica.digests == null || (replica.digests && typeof replica.digests === 'object' && !Array.isArray(replica.digests))) &&
      ['products','customers','credits','credit_payments'].every(function (key) { return rowsValid(replica[key]); }) && rowsValid(replica.cash_sessions || []) && rowsValid(replica.financial_events || []) &&
      !hasSecretKey(replica));
  }
  function replicaOf(value) { return { schema_version: 1, cached_at: new Date().toISOString(), promotion_id: value.promotion_id, authority_epoch: value.authority_epoch,
    revision: value.revision, financial_revision: value.financial_revision == null ? null : value.financial_revision,
    canonical_digest: value.canonical_digest || null,
    digests: copy(value.digests || {}),
    products: copy(value.products), customers: copy(value.customers), credits: copy(value.credits), credit_payments: copy(value.payments),
    cash_sessions: copy(value.cashSessions || []), financial_events: copy(value.financialEvents || []),
    mode: value.mode, read_only: value.read_only, minimum_client_contract: value.minimum_client_contract }; }
  function cacheIsNewer(cache, remote) {
    if (cache.authority_epoch !== remote.authority_epoch) return cache.authority_epoch > remote.authority_epoch;
    if (cache.promotion_id !== remote.promotion_id) return false;
    if (cache.revision !== remote.revision) return cache.revision > remote.revision;
    return (cache.financial_revision || 0) > (remote.financial_revision || 0);
  }
  async function localReplica() {
    if (typeof root._naReadCanonicalReplica !== 'function') return null;
    try { var value = await root._naReadCanonicalReplica(); return validReplica(value) ? value : null; } catch (_) { return null; }
  }
  function publishReplica(replica, source) {
    data = { authority: 'canonical', promotion_id: replica.promotion_id, authority_epoch: replica.authority_epoch, revision: replica.revision,
      financial_revision: replica.financial_revision, products: copy(replica.products), customers: copy(replica.customers), credits: copy(replica.credits),
      payments: copy(replica.credit_payments), cashSessions: copy(replica.cash_sessions || []), financialEvents: copy(replica.financial_events || []),
      mode: source === 'cache' ? 'CANONICAL_READ_ONLY' : (replica.mode || 'CANONICAL_READ_ONLY'),
      read_only: source === 'cache' || replica.read_only !== false, minimum_client_contract: source === 'cache' ? 'a6-gate-p-v1' : (replica.minimum_client_contract || 'a6-gate-p-v1') };
    ready = true; replicaState = { source: source, cache: { cached_at: replica.cached_at, promotion_id: replica.promotion_id, authority_epoch: replica.authority_epoch,
      revision: replica.revision, financial_revision: replica.financial_revision }, validation: source === 'cache' ? 'validating' : 'current' };
  }
  function notifyReplicaUpdate() { try { if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('na:canonical-updated', { detail: sourceState() })); } catch (_) {} }
  async function refresh() {
    if (loading) return loading;
    if (!data) ready = false;
    loading = (async function () {
      if (root.navigator.onLine === false) fail('AUTHORITY_UNAVAILABLE');
      var expected = binding && !changed ? copy(binding) : null, statusMeta = null;
      var endpoint = expected ? expected.endpoint : root.location.origin;
      if (!expected) {
        var status = await root.fetch(endpoint + '/read/canonical/status', { credentials: 'omit', redirect: 'error', cache: 'no-store' });
        if (!status.ok) fail('CANONICAL_READ_' + status.status);
        statusMeta = await status.json();
        verify(statusMeta, statusMeta);
        expected = { promotion_id: statusMeta.promotion_id, authority_epoch: statusMeta.authority_epoch, revision: statusMeta.revision };
      }
      var statusDigest = statusMeta && (statusMeta.canonical_digest || statusMeta.revision_digest || statusMeta.digest);
      if (statusMeta && statusMeta.mode === 'ACTIVE' && !uint(statusMeta.financial_revision)) fail('STALE_AUTHORITY_BINDING');
      var next = { authority: 'canonical', promotion_id: expected.promotion_id, authority_epoch: expected.authority_epoch, revision: expected.revision };
      if (binding && !changed) assertBinding(expected);
      var meta, firstMeta, entries = [['products', 'products'], ['customers', 'customers'], ['credits', 'credits'], ['credit-payments', 'payments']]; next.digests = {};
      for (var index = 0; index < entries.length; index++) {
        var entry = entries[index];
        var route = entry[0], name = entry[1], cursor = null, seen = new Set(); next[name] = [];
        do {
          if (binding && !changed) assertBinding(expected);
          var response = await root.fetch(endpoint + '/read/canonical/' + route + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), {
            credentials: 'omit', redirect: 'error', cache: 'no-store'
          });
          if (!response.ok) fail('CANONICAL_READ_' + response.status);
          meta = await response.json(); verify(meta, expected);
          if (meta.mode === 'ACTIVE' && !uint(meta.financial_revision)) fail('STALE_AUTHORITY_BINDING');
          if (statusMeta && meta.mode === 'ACTIVE' && meta.financial_revision !== statusMeta.financial_revision) fail('STALE_AUTHORITY_BINDING');
          var routeDigest = meta.canonical_digest || meta.revision_digest || meta.digest;
          if (statusDigest && routeDigest && routeDigest !== statusDigest) fail('STALE_AUTHORITY_BINDING');
          if (routeDigest) next.digests[route] = routeDigest;
          var pageMeta = JSON.stringify([meta.mode, meta.read_only, meta.minimum_client_contract, meta.mode === 'ACTIVE' ? meta.financial_revision : null]);
          if (firstMeta && firstMeta !== pageMeta) fail('STALE_AUTHORITY_BINDING');
          firstMeta = pageMeta;
          if (!Array.isArray(meta.items)) fail('INVALID_CANONICAL_PAGE');
          next[name].push.apply(next[name], meta.items); cursor = meta.next_cursor;
          if (cursor && seen.has(cursor)) fail('REPEATED_CANONICAL_CURSOR');
          seen.add(cursor);
        } while (cursor);
        if (index === 0 && meta.mode === 'ACTIVE') entries.push(['cash-sessions', 'cashSessions'], ['financial-events', 'financialEvents']);
      }
      if (binding && !changed) assertBinding(expected);
      next.read_only = meta.read_only; next.mode = meta.mode; next.minimum_client_contract = meta.minimum_client_contract;
      if (meta.mode === 'ACTIVE') next.financial_revision = meta.financial_revision;
      if (statusDigest) next.canonical_digest = statusDigest;
      var cache = await localReplica(), incoming = replicaOf(next);
      if (!validReplica(incoming)) fail('INVALID_CANONICAL_REPLICA');
      if (cache && cacheIsNewer(cache, incoming)) {
        publishReplica(cache, 'cache'); replicaState.validation = 'remote-older'; return snapshot();
      }
      var same = cache && cache.promotion_id === incoming.promotion_id && cache.authority_epoch === incoming.authority_epoch &&
        cache.revision === incoming.revision && (cache.financial_revision || 0) === (incoming.financial_revision || 0) && (cache.canonical_digest || null) === (incoming.canonical_digest || null) &&
        JSON.stringify([cache.products,cache.customers,cache.credits,cache.credit_payments,cache.cash_sessions||[],cache.financial_events||[],cache.digests||{}]) ===
        JSON.stringify([incoming.products,incoming.customers,incoming.credits,incoming.credit_payments,incoming.cash_sessions||[],incoming.financial_events||[],incoming.digests||{}]);
      publishReplica(incoming, 'remote');
      if (!same && typeof root._naWriteCanonicalReplica === 'function') await root._naWriteCanonicalReplica(incoming);
      replicaState.validation = 'current'; if (!same) notifyReplicaUpdate(); return snapshot();
    })();
    try { return await loading; } catch (error) { ready = false; if (data) { replicaState.validation = root.navigator.onLine === false ? 'offline' : 'stale'; notifyReplicaUpdate(); } throw error; } finally { loading = null; }
  }
  function snapshot() { return copy(data || { products: [], customers: [], credits: [], payments: [], cashSessions: [], financialEvents: [] }); }
  function sourceState() { return copy(replicaState); }
  function pendingSnapshot() {
    var value = journal();
    return value && value.state === 'PENDING' ? copy(value) : null;
  }
  function receiptSnapshot() {
    var value = journal();
    return value && value.state === 'CONFIRMED' ? copy(value.receipt) : null;
  }
  function assertAction(action) {
    if (!COMMANDS.includes(action)) fail('UNSUPPORTED_CANONICAL_ACTION');
    if (!ready || changed || !data || data.read_only !== false || data.mode !== 'ACTIVE' || data.minimum_client_contract !== CONTRACT || root.navigator.onLine === false) fail('CANONICAL_COMMERCE_CLOSED');
    assertBinding(binding);
    return true;
  }
  function commonPayload() {
    return { operation_id: root.crypto.randomUUID(), device_id: binding.deviceId, promotion_id: binding.promotion_id,
      client_contract: CONTRACT, authority_epoch: binding.authority_epoch, expected_control_revision: binding.revision, created_at: new Date().toISOString() };
  }
  function paymentFor(method, total, sale) {
    var payment = { cash_cents: 0, digital_cents: 0, credit_cents: 0 };
    if (method === 'efectivo') payment.cash_cents = total;
    else if (['yape', 'plin', 'transferencia'].includes(method)) payment.digital_cents = total;
    else if (method === 'credito') payment.credit_cents = total;
    else {
      if (!Number.isSafeInteger(sale.cash_cents) || sale.cash_cents <= 0 || sale.cash_cents >= total || !['yape', 'plin', 'transferencia'].includes(sale.digital_method)) fail('INVALID_CANONICAL_PAYMENT');
      payment.cash_cents = sale.cash_cents;
      payment.digital_cents = total - sale.cash_cents;
      payment.digital_method = sale.digital_method;
    }
    if (sale.reference != null && sale.reference !== '') {
      if (typeof sale.reference !== 'string' || sale.reference.length > 160 || /[\x00-\x1f\x7f]/.test(sale.reference)) fail('INVALID_CANONICAL_PAYMENT');
      payment.reference = sale.reference;
    }
    return payment;
  }
  function makePayload(sale) {
    if (!sale || typeof sale !== 'object' || !Array.isArray(sale.items) || !sale.items.length || sale.items.length > 500 || !METHODS.includes(sale.payment_method)) fail('INVALID_CANONICAL_SALE');
    var seen = new Set(), total = 0;
    var items = sale.items.map(function (requested) {
      if (!requested || !validId(requested.product_id) || seen.has(requested.product_id) || !Number.isFinite(requested.quantity) || requested.quantity <= 0 || requested.quantity > Number.MAX_SAFE_INTEGER) fail('INVALID_CANONICAL_ITEM');
      seen.add(requested.product_id);
      var product = data.products.find(function (item) { return item.product_id === requested.product_id; });
      if (!product || !Number.isSafeInteger(product.price_cents) || product.price_cents < 0 || !Number.isSafeInteger(product.stock_revision) || product.stock_revision < 0) fail('INVALID_CANONICAL_PRODUCT');
      var line = Math.round(requested.quantity * product.price_cents);
      if (!Number.isSafeInteger(line) || line < 0) fail('UNSAFE_CANONICAL_TOTAL');
      total += line; if (!Number.isSafeInteger(total)) fail('UNSAFE_CANONICAL_TOTAL');
      return { product_id: product.product_id, quantity: requested.quantity, unit_price_cents: product.price_cents, line_total_cents: line, expected_stock_revision: product.stock_revision };
    });
    if (total <= 0) fail('INVALID_CANONICAL_SALE');
    var payload = Object.assign(commonPayload(), {
      sale_id: root.crypto.randomUUID(), payment_method: sale.payment_method, total_cents: total,
      payment: paymentFor(sale.payment_method, total, sale), items: items
    });
    if (sale.customer_id != null && sale.customer_id !== '') {
      if (!validId(sale.customer_id) || !data.customers.some(function (item) { return item.customer_id === sale.customer_id; })) fail('INVALID_CANONICAL_CUSTOMER');
      payload.customer_id = sale.customer_id;
    }
    if (sale.payment_method === 'credito') {
      if (!payload.customer_id || !validDate(sale.credit_due)) fail('INVALID_CANONICAL_CREDIT');
      payload.credit_due = sale.credit_due;
    }
    return payload;
  }
  function makeIntentPayload(intent) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent) || !Array.isArray(intent.items) || !intent.items.length || intent.items.length > 500 ||
        !validId(intent.operation_id) || !validId(intent.sale_id) || typeof intent.created_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(intent.created_at) || !Number.isFinite(Date.parse(intent.created_at)) ||
        !METHODS.includes(intent.payment_method) || !uint(intent.total_cents) || intent.total_cents === 0) fail('INVALID_CANONICAL_INTENT');
    var seen = new Set(), total = 0;
    var items = intent.items.map(function (requested) {
      if (!requested || !validId(requested.product_id) || seen.has(requested.product_id) || !Number.isSafeInteger(requested.quantity) || requested.quantity <= 0 ||
          !uint(requested.unit_price_cents) || !uint(requested.line_total_cents)) fail('INVALID_CANONICAL_ITEM');
      seen.add(requested.product_id);
      var product = data.products.find(function (item) { return item.product_id === requested.product_id; });
      if (!product || !uint(product.stock_revision)) fail('INVALID_CANONICAL_PRODUCT');
      var line = requested.quantity * requested.unit_price_cents;
      if (!Number.isSafeInteger(line) || requested.line_total_cents !== line) fail('INVALID_CANONICAL_ITEM');
      total += line; if (!Number.isSafeInteger(total)) fail('UNSAFE_CANONICAL_TOTAL');
      return { product_id: requested.product_id, quantity: requested.quantity, unit_price_cents: requested.unit_price_cents,
        line_total_cents: requested.line_total_cents, expected_stock_revision: product.stock_revision };
    });
    if (total !== intent.total_cents) fail('INVALID_CANONICAL_TOTAL');
    var inputPayment = intent.payment;
    if (!inputPayment || typeof inputPayment !== 'object' || Array.isArray(inputPayment) ||
        !uint(inputPayment.cash_cents) || !uint(inputPayment.digital_cents) || !uint(inputPayment.credit_cents)) fail('INVALID_CANONICAL_PAYMENT');
    var paymentTotal = inputPayment.cash_cents + inputPayment.digital_cents + inputPayment.credit_cents;
    if (!Number.isSafeInteger(paymentTotal) || paymentTotal !== total) fail('INVALID_CANONICAL_PAYMENT');
    if (inputPayment.digital_method !== undefined && !['yape', 'plin', 'transferencia'].includes(inputPayment.digital_method)) fail('INVALID_CANONICAL_PAYMENT');
    if (inputPayment.reference !== undefined && (typeof inputPayment.reference !== 'string' || inputPayment.reference.length > 160 || /[\x00-\x1f\x7f]/.test(inputPayment.reference))) fail('INVALID_CANONICAL_PAYMENT');
    var payload = Object.assign(commonPayload(), { operation_id: intent.operation_id, sale_id: intent.sale_id, created_at: intent.created_at,
      payment_method: intent.payment_method, total_cents: intent.total_cents,
      payment: { cash_cents: inputPayment.cash_cents, digital_cents: inputPayment.digital_cents, credit_cents: inputPayment.credit_cents }, items: items });
    if (inputPayment.digital_method !== undefined) payload.payment.digital_method = inputPayment.digital_method;
    if (inputPayment.reference !== undefined) payload.payment.reference = inputPayment.reference;
    if (intent.customer_id !== undefined) {
      if (!validId(intent.customer_id) || !data.customers.some(function (item) { return item.customer_id === intent.customer_id; })) fail('INVALID_CANONICAL_CUSTOMER');
      payload.customer_id = intent.customer_id;
    }
    if (intent.payment_method === 'credito') {
      if (!payload.customer_id || !validDate(intent.credit_due)) fail('INVALID_CANONICAL_CREDIT');
      payload.credit_due = intent.credit_due;
    } else if (intent.credit_due !== undefined) fail('INVALID_CANONICAL_CREDIT');
    return payload;
  }
  function openSession(requestedId) {
    var sessions = (data && data.cashSessions || []).filter(function (item) { return item && item.status === 'OPEN'; });
    if (sessions.length !== 1 || !validId(sessions[0].session_id) || !uint(sessions[0].revision) || !uint(sessions[0].expected_cents) ||
        (requestedId !== undefined && requestedId !== sessions[0].session_id)) fail('INVALID_CANONICAL_CASH_SESSION');
    return sessions[0];
  }
  function makeFinancialPayload(command, input) {
    input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    var payload = commonPayload(), session, credit, event;
    if (command === 'payment.create') {
      if (!validId(input.credit_id) || !uint(input.amount_cents) || input.amount_cents === 0 || !FINANCIAL_METHODS.includes(input.payment_method)) fail('INVALID_CANONICAL_PAYMENT');
      credit = data.credits.find(function (item) { return item.credit_id === input.credit_id; });
      if (!credit || !uint(credit.current_balance_cents) || input.amount_cents > credit.current_balance_cents || !uint(credit.revision) || !['IMPORT', 'LIVE'].includes(credit.provenance)) fail('INVALID_CANONICAL_CREDIT');
      Object.assign(payload, { credit_id: credit.credit_id, expected_credit_revision: credit.revision, amount_cents: input.amount_cents, payment_method: input.payment_method });
      if (input.payment_method === 'efectivo') {
        session = openSession(input.session_id); if (!uint(session.expected_cents + input.amount_cents)) fail('UNSAFE_CANONICAL_TOTAL'); payload.session_id = session.session_id;
      } else if (input.session_id !== undefined) fail('INVALID_CANONICAL_PAYMENT');
      if (input.reference != null && input.reference !== '') { if (!validId(input.reference)) fail('INVALID_CANONICAL_PAYMENT'); payload.reference = input.reference; }
    } else if (command === 'cash.open') {
      if (!validId(input.session_id) || !uint(input.opening_cents)) fail('INVALID_CANONICAL_CASH_OPEN');
      if ((data.cashSessions || []).some(function (item) { return item.status === 'OPEN' || item.session_id === input.session_id; })) fail('INVALID_CANONICAL_CASH_SESSION');
      Object.assign(payload, { session_id: input.session_id, opening_cents: input.opening_cents });
    } else if (command === 'cash.close') {
      session = openSession(input.session_id); if (!uint(input.counted_cents)) fail('INVALID_CANONICAL_CASH_CLOSE');
      Object.assign(payload, { session_id: session.session_id, expected_session_revision: session.revision, counted_cents: input.counted_cents });
    } else if (command === 'adjustment.create') {
      session = openSession(input.session_id); if (!Number.isSafeInteger(input.amount_cents) || input.amount_cents === 0 || !uint(session.expected_cents + input.amount_cents) || !validReason(input.reason)) fail('INVALID_CANONICAL_ADJUSTMENT');
      Object.assign(payload, { session_id: session.session_id, expected_session_revision: session.revision, amount_cents: input.amount_cents, reason: input.reason });
    } else if (command === 'compensation.create') {
      if (!validId(input.compensates_operation_id) || !validReason(input.reason)) fail('INVALID_CANONICAL_COMPENSATION');
      event = data.financialEvents.find(function (item) { return item.operation_id === input.compensates_operation_id && ['PAYMENT', 'ADJUSTMENT'].includes(item.event_type); });
      if (!event || !Number.isSafeInteger(event.cash_delta_cents) || !Number.isSafeInteger(event.credit_delta_cents) || data.financialEvents.some(function (item) { return item.compensates_operation_id === event.operation_id; })) fail('INVALID_CANONICAL_COMPENSATION');
      Object.assign(payload, { compensates_operation_id: event.operation_id, reason: input.reason });
      if (event.cash_delta_cents !== 0) {
        session = openSession(input.session_id); if (!uint(session.expected_cents - event.cash_delta_cents)) fail('INVALID_CANONICAL_COMPENSATION');
        payload.session_id = session.session_id; payload.expected_session_revision = session.revision;
      } else if (input.session_id !== undefined) fail('INVALID_CANONICAL_COMPENSATION');
      if (event.credit_id != null) {
        credit = data.credits.find(function (item) { return item.credit_id === event.credit_id && item.provenance === event.credit_provenance; });
        if (!credit || !uint(credit.revision) || !uint(credit.current_balance_cents) || !uint(credit.current_balance_cents - event.credit_delta_cents) || !['IMPORT', 'LIVE'].includes(credit.provenance)) fail('INVALID_CANONICAL_CREDIT'); payload.expected_credit_revision = credit.revision;
      }
    } else fail('UNSUPPORTED_CANONICAL_ACTION');
    return payload;
  }
  function validCommon(payload) {
    return payload && typeof payload === 'object' && !Array.isArray(payload) && validId(payload.operation_id) && validId(payload.device_id) &&
      validId(payload.promotion_id) && payload.client_contract === CONTRACT && uint(payload.authority_epoch) && uint(payload.expected_control_revision) &&
      typeof payload.created_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.created_at) &&
      validDate(payload.created_at.slice(0, 10)) && Number.isFinite(Date.parse(payload.created_at));
  }
  function validPayload(command, payload) {
    if (!validCommon(payload)) return false;
    if (command === 'sale.create') {
      if (!validId(payload.sale_id) || !Array.isArray(payload.items) || !payload.items.length || payload.items.length > 500 || !METHODS.includes(payload.payment_method) || !uint(payload.total_cents) || payload.total_cents === 0 || !payload.payment) return false;
      var total = 0, seen = new Set();
      for (var item of payload.items) {
        if (!item || !validId(item.product_id) || seen.has(item.product_id) || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > Number.MAX_SAFE_INTEGER ||
            !uint(item.unit_price_cents) || !uint(item.expected_stock_revision) || !uint(item.line_total_cents) || item.line_total_cents !== Math.round(item.quantity * item.unit_price_cents)) return false;
        seen.add(item.product_id); total += item.line_total_cents; if (!uint(total)) return false;
      }
      if (total !== payload.total_cents || (payload.customer_id !== undefined && !validId(payload.customer_id)) || (payload.payment_method === 'credito' && (!validId(payload.customer_id) || !validDate(payload.credit_due)))) return false;
      try {
        var payment = paymentFor(payload.payment_method, total, { cash_cents: payload.payment.cash_cents, digital_method: payload.payment.digital_method, reference: payload.payment.reference });
        return ['cash_cents', 'digital_cents', 'credit_cents'].every(function (key) { return payment[key] === payload.payment[key]; });
      } catch (_) { return false; }
    }
    if (payload.session_id !== undefined && !validId(payload.session_id) || payload.expected_session_revision !== undefined && !uint(payload.expected_session_revision) ||
        payload.expected_credit_revision !== undefined && !uint(payload.expected_credit_revision) || payload.reference !== undefined && !validId(payload.reference)) return false;
    if (command === 'payment.create') return validId(payload.credit_id) && uint(payload.expected_credit_revision) && Number.isSafeInteger(payload.amount_cents) && payload.amount_cents > 0 && FINANCIAL_METHODS.includes(payload.payment_method) && (payload.payment_method === 'efectivo' ? validId(payload.session_id) : payload.session_id === undefined);
    if (command === 'cash.open') return validId(payload.session_id) && uint(payload.opening_cents);
    if (command === 'cash.close') return validId(payload.session_id) && uint(payload.expected_session_revision) && uint(payload.counted_cents);
    if (command === 'adjustment.create') return validId(payload.session_id) && uint(payload.expected_session_revision) && Number.isSafeInteger(payload.amount_cents) && payload.amount_cents !== 0 && validReason(payload.reason);
    return command === 'compensation.create' && validId(payload.compensates_operation_id) && validReason(payload.reason) &&
      (payload.session_id === undefined ? payload.expected_session_revision === undefined : uint(payload.expected_session_revision));
  }
  function validReceipt(record, result) {
    if (!result || result.operation_id !== record.payload.operation_id) return false;
    if (!(result.status === 'created' && result.idempotent === false || result.status === 'already_processed' && result.idempotent === true)) return false;
    // The shipped backend's sale receipt has no command, including on replay.
    if (record.command === 'sale.create') return result.sale_id === record.payload.sale_id && (result.command === undefined || result.command === record.command);
    if (result.command !== record.command) return false;
    if (result.promotion_id !== record.binding.promotion_id || result.authority_epoch !== record.binding.authority_epoch) return false;
    if (record.command === 'payment.create' && result.credit_id !== record.payload.credit_id) return false;
    if (record.payload.session_id !== undefined && result.session_id !== record.payload.session_id) return false;
    if (['payment.create', 'adjustment.create', 'compensation.create'].includes(record.command) && result.event_id !== record.payload.operation_id) return false;
    if (record.command === 'compensation.create' && result.compensates_operation_id !== record.payload.compensates_operation_id) return false;
    if (!record.receipt_ids || Object.keys(record.receipt_ids).some(function (key) { return result[key] !== record.receipt_ids[key]; })) return false;
    return true;
  }
  async function withWriterLock(work) {
    if (!root.navigator.locks || typeof root.navigator.locks.request !== 'function') fail('WEB_LOCKS_REQUIRED');
    return root.navigator.locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, function (lock) {
      if (!lock) fail('CANONICAL_WRITER_BUSY');
      return work();
    });
  }
  async function sendPending(record) {
    if (!binding || changed || !credentials.token || root.navigator.onLine === false) fail('CANONICAL_COMMERCE_CLOSED');
    var expected = record.binding;
    assertBinding(expected);
    if (record.payload.device_id !== expected.deviceId || record.payload.promotion_id !== expected.promotion_id || record.payload.authority_epoch !== expected.authority_epoch ||
        record.payload.expected_control_revision !== expected.revision || record.payload.client_contract !== CONTRACT) fail('STALE_AUTHORITY_BINDING');
    // Retry verifies only authority. Never rebuild the intent from newer financial data.
    var statusResponse = await root.fetch(expected.endpoint + '/read/canonical/status', {
      credentials: 'omit', redirect: 'error', cache: 'no-store'
    });
    if (!statusResponse.ok) fail('CANONICAL_READ_' + statusResponse.status);
    var meta = await statusResponse.json(); verify(meta, expected);
    if (meta.mode !== 'ACTIVE') fail('CANONICAL_COMMERCE_CLOSED');
    assertBinding(expected);
    var raw = JSON.stringify(record);
    function unchanged() { if (root.localStorage.getItem(JOURNAL) !== raw) fail('CANONICAL_PENDING_CHANGED'); }
    unchanged();
    // A retry must also fail before POST when storage has become unwritable.
    durableJournal(record);
    var response;
    try {
      response = await root.fetch(expected.endpoint + record.route, {
        method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-device-id': expected.deviceId, 'x-sync-token': credentials.token },
        body: JSON.stringify(record.payload)
      });
    } catch (_) { fail('CANONICAL_FINANCIAL_PENDING'); }
    var result;
    try { result = await response.json(); } catch (_) { fail('CANONICAL_FINANCIAL_PENDING'); }
    unchanged();
    if (!response.ok) {
      durableJournal(Object.assign({}, record, { last_error: validId(result && result.error) ? result.error : 'HTTP_' + response.status }));
      fail('CANONICAL_FINANCIAL_REJECTED_' + response.status);
    }
    if (!result || !(response.status === 201 && result.status === 'created' && result.idempotent === false || response.status === 200 && result.status === 'already_processed' && result.idempotent === true) ||
        !validReceipt(record, result) ||
        ((record.command !== 'sale.create' || result.status === 'created') && (result.promotion_id !== expected.promotion_id || result.authority_epoch !== expected.authority_epoch))) fail('CANONICAL_FINANCIAL_PENDING');
    // One atomic storage replacement both saves the receipt and clears PENDING.
    var confirmed = Object.assign({}, record, { state: 'CONFIRMED', receipt: copy(result) });
    durableJournal(confirmed);
    ready = false;
    return copy(confirmed.receipt);
  }
  async function createSale(sale) {
    if (sale && typeof sale === 'object' && sale.version === 1) await refresh();
    return createCommand('sale.create', sale);
  }
  async function createCommand(command, input) {
    return withWriterLock(async function () {
      var existing = journal();
      if (existing && existing.state === 'PENDING') fail('CANONICAL_FINANCIAL_PENDING');
      assertAction(command);
      if (!credentials.token) fail('CANONICAL_COMMERCE_CLOSED');
      var record = { state: 'PENDING', binding: copy(binding), command: command, route: '/commands/' + command,
        payload: command === 'sale.create' ? (input && input.version === 1 ? makeIntentPayload(input) : makePayload(input)) : makeFinancialPayload(command, input) };
      record.receipt_ids = {};
      if (command === 'payment.create') record.receipt_ids.credit_provenance = data.credits.find(function (item) { return item.credit_id === record.payload.credit_id; }).provenance;
      if (command === 'compensation.create') {
        var target = data.financialEvents.find(function (item) { return item.operation_id === record.payload.compensates_operation_id; });
        if (target.credit_id != null) record.receipt_ids = { credit_id: target.credit_id, credit_provenance: target.credit_provenance };
      }
      if (!validPayload(command, record.payload)) fail('INVALID_CANONICAL_PAYLOAD');
      durableJournal(record);
      return sendPending(record);
    });
  }
  function createPayment(input) { return createCommand('payment.create', input); }
  function openCash(input) { return createCommand('cash.open', input); }
  function closeCash(input) { return createCommand('cash.close', input); }
  function createAdjustment(input) { return createCommand('adjustment.create', input); }
  function createCompensation(input) { return createCommand('compensation.create', input); }
  async function retryPending() {
    return withWriterLock(async function () {
      var record = journal();
      if (!record || record.state !== 'PENDING') fail('NO_CANONICAL_FINANCIAL_PENDING');
      return sendPending(record);
    });
  }
  function renderCredits(container) {
    container.replaceChildren(); container.style.overflowWrap = 'anywhere';
    var current = snapshot();
    current.credits.forEach(function (credit) {
      var customer = current.customers.find(function (item) { return item.customer_id === credit.customer_id; });
      var article = document.createElement('article'), title = document.createElement('h3'), balance = document.createElement('p');
      title.textContent = (customer ? customer.name : credit.customer_id) + ' / ' + credit.credit_id + ' | ' + (credit.provenance === 'LIVE' ? 'LIVE' : 'IMPORT');
      balance.textContent = 'Saldo: S/ ' + (credit.current_balance_cents / 100).toFixed(2); article.append(title, balance);
      current.payments.filter(function (item) { return item.credit_id === credit.credit_id; }).forEach(function (payment) {
        var row = document.createElement('p');
        var date = payment.date_precision === 'UNKNOWN' ? 'fecha desconocida' : payment.date_precision === 'TIMESTAMP' ? payment.payment_date + ' / ' + payment.payment_timestamp : payment.payment_date;
        row.textContent = (payment.source_payment_id || payment.payment_id) + ' | S/ ' + (payment.amount_cents / 100).toFixed(2) + ' | ' + date + (payment.method ? ' | ' + payment.method : ''); article.append(row);
      });
      container.append(article);
    });
  }
  function renderSale(container, setStatus) {
    container.replaceChildren();
    var form = document.createElement('form'), product = document.createElement('select'), quantity = document.createElement('input');
    var method = document.createElement('select'), customer = document.createElement('select'), due = document.createElement('input');
    var cash = document.createElement('input'), digital = document.createElement('select'), reference = document.createElement('input');
    var submit = document.createElement('button'), retry = document.createElement('button'), reload = document.createElement('button'), result = document.createElement('p'), total = document.createElement('p');
    snapshot().products.forEach(function (item) { var option = document.createElement('option'); option.value = item.product_id; option.textContent = item.name + ' | S/ ' + (item.price_cents / 100).toFixed(2) + ' | stock ' + String(item.current_stock_quantity); product.append(option); });
    METHODS.forEach(function (value) { var option = document.createElement('option'); option.value = value; option.textContent = value; method.append(option); });
    var blank = document.createElement('option'); blank.value = ''; blank.textContent = 'Cliente'; customer.append(blank);
    snapshot().customers.forEach(function (item) { var option = document.createElement('option'); option.value = item.customer_id; option.textContent = item.name; customer.append(option); });
    ['yape', 'plin', 'transferencia'].forEach(function (value) { var option = document.createElement('option'); option.value = value; option.textContent = value; digital.append(option); });
    quantity.type = 'number'; quantity.min = '0.001'; quantity.step = 'any'; quantity.value = '1'; quantity.required = true;
    due.type = 'date'; cash.type = 'number'; cash.min = '1'; cash.step = '1'; cash.placeholder = 'Efectivo mixto (centimos)'; reference.placeholder = 'Referencia digital';
    submit.type = 'submit'; submit.textContent = 'Registrar venta'; retry.type = 'button'; retry.textContent = 'Reintentar operacion pendiente';
    reload.type = 'button'; reload.textContent = 'Actualizar datos canonicos';
    form.style.cssText = 'display:grid;gap:10px;max-width:560px;min-width:0';
    [['Producto', product], ['Cantidad', quantity], ['Metodo de pago', method], ['Cliente (obligatorio para credito)', customer], ['Vencimiento del credito', due],
      ['Efectivo mixto en centimos', cash], ['Metodo digital mixto', digital], ['Referencia', reference]].forEach(function (entry) {
      var label = document.createElement('label'); label.textContent = entry[0]; label.style.cssText = 'display:grid;gap:4px;min-width:0';
      entry[1].style.cssText = 'width:100%;min-width:0;max-width:100%;box-sizing:border-box'; label.append(entry[1]); form.append(label);
    });
    form.append(total, submit, retry, reload, result); container.append(form);
    function showTotal() {
      var picked = snapshot().products.find(function (item) { return item.product_id === product.value; });
      var cents = picked && Math.round(picked.price_cents * Number(quantity.value));
      total.textContent = Number.isSafeInteger(cents) && cents > 0 ? 'Total: S/ ' + (cents / 100).toFixed(2) : 'Total no valido';
    }
    product.addEventListener('change', showTotal); quantity.addEventListener('input', showTotal); showTotal();
    function showStored() {
      try {
        var record = journal(), pending = record && record.state === 'PENDING';
        retry.hidden = !pending; submit.disabled = !!pending || !ready || !data || data.mode !== 'ACTIVE';
        result.textContent = recordText(record);
      } catch (_) { submit.disabled = true; retry.disabled = true; result.textContent = 'Almacenamiento no verificable. Operaciones bloqueadas.'; }
    }
    form.addEventListener('submit', async function (event) {
      event.preventDefault(); submit.disabled = true;
      try {
        var receipt = await createSale({ items: [{ product_id: product.value, quantity: Number(quantity.value) }], payment_method: method.value,
          customer_id: customer.value, credit_due: due.value, cash_cents: Number(cash.value), digital_method: digital.value, reference: reference.value });
        setStatus('Venta confirmada: ' + receipt.sale_id); await refresh(); renderSale(container, setStatus);
      } catch (error) { setStatus(String(error.message || error)); }
      showStored();
    });
    retry.addEventListener('click', async function () {
      retry.disabled = true;
      try { var receipt = await retryPending(); setStatus('Operacion confirmada: ' + receipt.operation_id); await refresh(); renderSale(container, setStatus); }
      catch (error) { setStatus(String(error.message || error)); }
      retry.disabled = false; showStored();
    });
    reload.addEventListener('click', async function () {
      reload.disabled = true;
      try { await refresh(); setStatus(data.mode + ' | ' + CONTRACT); renderSale(container, setStatus); }
      catch (error) { setStatus(String(error.message || error)); }
      reload.disabled = false; showStored();
    });
    showStored();
  }
  function recordText(record) {
    if (!record) return '';
    return (record.state === 'PENDING' ? 'PENDING | ' : 'Confirmada | ') + record.command + ' | ' + record.payload.operation_id +
      (record.last_error ? ' | ' + record.last_error : '') + (record.state === 'PENDING' ? ' | Reintento manual; no crear otra operacion.' : ' | ' + record.receipt.status);
  }
  function renderFinancial(container, setStatus, tab) {
    container.replaceChildren();
    var current = snapshot(), forms = [], busy = false;
    var result = document.createElement('p'), retry = document.createElement('button'), reload = document.createElement('button');
    result.setAttribute('role', 'status'); retry.type = reload.type = 'button';
    retry.textContent = 'Reintentar operacion pendiente'; reload.textContent = 'Actualizar datos canonicos';
    function field(labelText, type, options) {
      var label = document.createElement('label'), input = document.createElement(options ? 'select' : 'input');
      label.textContent = labelText; label.style.cssText = 'display:grid;gap:4px;min-width:0';
      input.style.cssText = 'width:100%;min-width:0;max-width:100%;box-sizing:border-box';
      if (options) options.forEach(function (entry) { var option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; input.append(option); });
      else { input.type = type; if (type === 'number') { input.step = '1'; input.required = true; } }
      label.append(input); return { label: label, input: input };
    }
    function form(title, fields, action) {
      var node = document.createElement('form'), heading = document.createElement('h3'), submit = document.createElement('button');
      node.style.cssText = 'display:grid;gap:10px;max-width:560px;min-width:0'; heading.textContent = title;
      submit.type = 'submit'; submit.textContent = title; node.append(heading);
      fields.forEach(function (item) { node.append(item.label); }); node.append(submit); container.append(node); forms.push(submit);
      node.addEventListener('submit', async function (event) { event.preventDefault(); if (busy) return; await run(action); });
    }
    function update() {
      try {
        var record = journal(), pending = record && record.state === 'PENDING';
        result.textContent = recordText(record); retry.hidden = !pending; retry.disabled = busy;
        forms.forEach(function (button) { button.disabled = busy || !!pending || !ready || !data || data.mode !== 'ACTIVE'; });
      } catch (_) { forms.forEach(function (button) { button.disabled = true; }); retry.disabled = true; result.textContent = 'Almacenamiento no verificable. Operaciones bloqueadas.'; }
      reload.disabled = busy;
    }
    async function run(action) {
      busy = true; update();
      try { var receipt = await action(); setStatus('Operacion confirmada: ' + receipt.operation_id); await refresh(); renderFinancial(container, setStatus, tab); }
      catch (error) { setStatus(String(error.message || error)); }
      finally { busy = false; update(); }
    }
    if (tab === 'payment') {
      var credit = field('Credito / procedencia / saldo', null, current.credits.map(function (item) { return [item.credit_id, item.credit_id + ' | ' + item.provenance + ' | S/ ' + (item.current_balance_cents / 100).toFixed(2)]; }));
      var amount = field('Abono en centimos', 'number'), method = field('Metodo de abono', null, FINANCIAL_METHODS.map(function (item) { return [item, item]; })), reference = field('Referencia (opcional)', 'text');
      amount.input.min = '1';
      form('Registrar abono', [credit, amount, method, reference], function () { return createPayment({ credit_id: credit.input.value, amount_cents: Number(amount.input.value), payment_method: method.input.value, reference: reference.input.value }); });
    } else {
      (current.cashSessions || []).forEach(function (item) { var row = document.createElement('p'); row.textContent = item.session_id + ' | ' + item.status + ' | Esperado S/ ' + (item.expected_cents / 100).toFixed(2); container.append(row); });
      var opening = field('Apertura en centimos', 'number'); opening.input.min = '0';
      form('Abrir caja', [opening], function () { return openCash({ session_id: root.crypto.randomUUID(), opening_cents: Number(opening.input.value) }); });
      var counted = field('Contado en centimos', 'number'); counted.input.min = '0';
      form('Cerrar caja', [counted], function () { return closeCash({ counted_cents: Number(counted.input.value) }); });
      var adjustment = field('Ajuste en centimos (+ entrada / - salida)', 'number'), reason = field('Motivo del ajuste', 'text'); reason.input.required = true;
      form('Registrar ajuste', [adjustment, reason], function () { return createAdjustment({ amount_cents: Number(adjustment.input.value), reason: reason.input.value }); });
      var target = field('Operacion a compensar', null, (current.financialEvents || []).filter(function (item) {
        return ['PAYMENT', 'ADJUSTMENT'].includes(item.event_type) && !current.financialEvents.some(function (other) { return other.compensates_operation_id === item.operation_id; });
      }).map(function (item) { return [item.operation_id, item.event_type + ' | ' + item.operation_id + ' | Caja ' + item.cash_delta_cents + ' | Credito ' + item.credit_delta_cents + ' centimos']; }));
      var compensationReason = field('Motivo de la compensacion', 'text'); compensationReason.input.required = true;
      form('Registrar compensacion', [target, compensationReason], function () { return createCompensation({ compensates_operation_id: target.input.value, reason: compensationReason.input.value }); });
    }
    retry.addEventListener('click', function () { if (!busy) return run(retryPending); });
    reload.addEventListener('click', async function () {
      if (busy) return; busy = true; update();
      try { await refresh(); renderFinancial(container, setStatus, tab); setStatus(data.mode + ' | ' + CONTRACT); }
      catch (error) { setStatus(String(error.message || error)); }
      finally { busy = false; update(); }
    });
    container.append(result, retry, reload); update();
  }
  async function startPOS() {
    if (!enabled()) return null;
    var cached = await localReplica();
    if (cached) {
      publishReplica(cached, 'cache');
      refresh().catch(function () { replicaState.validation = 'offline'; notifyReplicaUpdate(); });
      return snapshot();
    }
    return refresh();
  }
  function legacySnapshot() {
    if (!data || data.authority !== 'canonical') fail('CANONICAL_SNAPSHOT_UNAVAILABLE');
    var customers = data.customers.map(function (c, i) { return { id: c.customer_id, nombre: c.name || 'Cliente', dni: c.document || '', tel: c.phone || '', dir: c.address || '', color: i % 8, totalCompras: Number(c.total_purchases_cents || 0) / 100 }; });
    var customerById = new Map(customers.map(function (c) { return [String(c.id), c]; }));
    var paymentsByCredit = new Map();
    data.payments.forEach(function (p) { var list = paymentsByCredit.get(String(p.credit_id)) || []; list.push(p); paymentsByCredit.set(String(p.credit_id), list); });
    var credits = data.credits.map(function (c) {
      var issued = typeof c.issued_value === 'string' ? c.issued_value : '', due = typeof c.due_value === 'string' ? c.due_value : '';
      var client = customerById.get(String(c.customer_id)), amount = Number(c.original_amount_cents) / 100, paid = (Number(c.original_amount_cents) - Number(c.current_balance_cents)) / 100;
      var payments = (paymentsByCredit.get(String(c.credit_id)) || []).map(function (p) { return { id: p.payment_id, pagoId: p.payment_id,
        creditoId: c.credit_id, clienteId: c.customer_id, monto: Number(p.amount_cents) / 100,
        fecha: p.payment_date_known ? p.payment_date : '', timestamp: p.payment_date_known ? p.payment_timestamp || p.payment_date : null,
        canonicalDateKnown: !!p.payment_date_known, datePrecision: p.date_precision, metodo: p.method || p.source_method || 'efectivo',
        operacion: p.source_operation_reference || '', referencia: p.source_operation_reference || '', cajero: p.seller || 'Hist?rico', cajeroNombre: p.seller || 'Hist?rico' }; });
      return { id: c.credit_id, cliId: c.customer_id, clienteId: c.customer_id, clienteNombre: client && client.nombre || c.customer_id,
        clienteDni: client && client.dni || '', desc: c.concept || c.document_number || c.reference || 'Cr?dito hist?rico',
        monto: amount, pagado: paid, vence: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '', canonicalDueKnown: /^\d{4}-\d{2}-\d{2}$/.test(due),
        fecha: /^\d{4}-\d{2}-\d{2}/.test(issued) ? issued.slice(0, 10) : '', timestamp: /^\d{4}-\d{2}-\d{2}T/.test(issued) ? issued : null,
        cajero: c.seller || 'Hist?rico', status: c.source_status || '', anulado: false, pagos: payments,
        items: [{ itemKey: 'canonical:' + c.credit_id, productoId: null, nombre: c.concept || c.document_number || 'Saldo hist?rico', cantidad: 1, precioUnitario: amount, subtotal: amount, modo: 'concepto' }] };
    });
    var products = data.products.map(function (p) { return { id: p.product_id, name: typeof p.name === 'string' && p.name.trim() ? p.name : 'PRODUCTO', nombre: p.name, sku: p.sku || '', codigo: p.barcode || '',
      codigosAlternativos: p.alternate_codes_json ? JSON.parse(p.alternate_codes_json) : [], categoria: p.category || '', marca: p.brand || '', descripcion: p.description || '',
      icono: p.icon || '', imagen: p.image || null, unidad: p.unit || 'unidad', costo: Number(p.cost_cents || 0) / 100, precio: Number(p.price_cents || 0) / 100,
      stock: Number(p.current_stock_quantity || 0), stockMin: Number(p.stock_min_quantity || 0), venc: p.expiry_date || '', incluyeIGV: p.includes_igv !== 0,
      controlaStock: p.tracks_inventory !== 0, canonical: true }; });
    return { products: products, customers: customers, credits: credits, payments: data.payments.slice(), mode: data.mode, promotion_id: data.promotion_id, read_only: data.read_only };
  }
  root.addEventListener('storage', function (event) { if (event.key === KEY || event.key === null) { changed = true; ready = false; } });
  root.addEventListener('offline', function () { ready = false; });
  root.NuevoAmanecerCanonical = Object.freeze({ CONTRACT: CONTRACT, enabled: enabled, configure: configure, refresh: refresh, snapshot: snapshot,
    pendingSnapshot: pendingSnapshot, receiptSnapshot: receiptSnapshot, assertAction: assertAction, createSale: createSale, retryPending: retryPending,
    createPayment: createPayment, openCash: openCash, closeCash: closeCash, createAdjustment: createAdjustment, createCompensation: createCompensation,
    renderCredits: renderCredits, startPOS: startPOS, legacySnapshot: legacySnapshot, sourceState: sourceState });
})(globalThis);
