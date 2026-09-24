(function (root) {
  'use strict';

  var VERSION = 1;
  var KEY = 'na_canonical_sale_outbox_v1';
  var LOCK = 'na-canonical-sale-outbox';
  var FORBIDDEN = new Set(['token', 'credential', 'device_credential', 'deviceCredential', 'readToken', 'promotion_id', 'authority_epoch', 'expected_control_revision', 'expected_stock_revision', 'device_id']);

  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function rejectForbidden(value, seen) {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) fail('INTENT_CIRCULAR');
    seen.add(value);
    Object.keys(value).forEach(function (key) { if (FORBIDDEN.has(key)) fail('INTENT_FORBIDDEN_KEY'); rejectForbidden(value[key], seen); });
    seen.delete(value);
  }
  function validateIntent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== VERSION) fail('INTENT_VERSION_INVALID');
    rejectForbidden(value, new Set());
    var builder = root.NuevoAmanecerCanonicalSaleIntent;
    if (!builder || builder.VERSION !== VERSION || typeof builder.build !== 'function') fail('SALE_INTENT_UNAVAILABLE');
    var intent = builder.build(value);
    if (intent.version !== VERSION || intent.operation_id !== value.operation_id || intent.sale_id !== value.sale_id || intent.created_at !== value.created_at) fail('INTENT_IDENTITY_CHANGED');
    return clone(intent);
  }
  function parseStored() {
    var raw;
    try { raw = root.localStorage.getItem(KEY); } catch (_) { fail('OUTBOX_STORAGE_READ_FAILED'); }
    if (raw === null) return { version: VERSION, intents: [] };
    var data;
    try { data = JSON.parse(raw); } catch (_) { fail('OUTBOX_CORRUPT'); }
    if (!data || data.version !== VERSION || !Array.isArray(data.intents)) fail('OUTBOX_CORRUPT');
    var seen = new Set();
    try {
      data.intents.forEach(function (item) {
        if (!item || typeof item !== 'object' || item.version !== VERSION) fail('OUTBOX_CORRUPT');
        rejectForbidden(item, new Set());
        var canonical = validateIntent(item);
        if (JSON.stringify(canonical) !== JSON.stringify(item) || seen.has(item.operation_id)) fail('OUTBOX_CORRUPT');
        seen.add(item.operation_id);
      });
    } catch (_) { fail('OUTBOX_CORRUPT'); }
    return data;
  }
  function write(data) {
    var serialized = JSON.stringify(data);
    try { root.localStorage.setItem(KEY, serialized); } catch (_) { fail('OUTBOX_STORAGE_WRITE_FAILED'); }
    var readback;
    try { readback = root.localStorage.getItem(KEY); } catch (_) { fail('OUTBOX_STORAGE_READBACK_FAILED'); }
    if (readback !== serialized) fail('OUTBOX_STORAGE_READBACK_MISMATCH');
    return data;
  }
  async function withLock(work) {
    var locks = root.navigator && root.navigator.locks;
    if (!locks || typeof locks.request !== 'function') fail('WEB_LOCKS_UNAVAILABLE');
    return locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, function (lock) {
      if (!lock) fail('BUSY');
      return work();
    });
  }
  function snapshot() { var current = parseStored(); return clone(current); }
  function matching(value, intent) { return !!value && value.operation_id === intent.operation_id && value.sale_id === intent.sale_id; }
  function removeHead(expected) {
    var current = parseStored();
    if (!current.intents.length || current.intents[0].operation_id !== expected.operation_id) fail('OUTBOX_HEAD_CHANGED');
    current.intents.shift();
    write(current);
  }
  function result(status, processed, remaining, reason) {
    var out = { status: status, processed: processed, remaining: remaining };
    if (reason) out.reason = reason;
    return out;
  }
  async function syncLocked() {
    var processed = 0;
    while (true) {
      var current = parseStored();
      if (!current.intents.length) return result(processed ? 'DRAINED' : 'EMPTY', processed, 0);
      var head = current.intents[0];
      var canonical = root.NuevoAmanecerCanonical;
      if (!canonical || typeof canonical.receiptSnapshot !== 'function' || typeof canonical.pendingSnapshot !== 'function' || typeof canonical.refresh !== 'function' || typeof canonical.createSale !== 'function' || typeof canonical.retryPending !== 'function') fail('CANONICAL_API_UNAVAILABLE');
      var receipt = canonical.receiptSnapshot();
      if (matching(receipt, head)) { removeHead(head); processed += 1; continue; }
      var pending = canonical.pendingSnapshot();
      if (pending) {
        var payload = pending.payload;
        if (pending.command !== 'sale.create' || !payload || payload.operation_id !== head.operation_id || payload.sale_id !== head.sale_id) return result('BLOCKED_FOREIGN_PENDING', processed, current.intents.length, 'FOREIGN_PENDING');
        if (pending.last_error) return result('BLOCKED_PENDING_REJECTED', processed, current.intents.length, String(pending.last_error));
        try { await canonical.retryPending(); } catch (error) { return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'RETRY_FAILED')); }
        if (!matching(canonical.receiptSnapshot(), head)) return result('WAITING', processed, parseStored().intents.length, 'RECEIPT_NOT_CONFIRMED');
        removeHead(head); processed += 1; continue;
      }
      try {
        await canonical.refresh();
      } catch (error) { return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'REFRESH_FAILED')); }
      try {
        await canonical.createSale(head);
      } catch (error) {
        var afterFailure = canonical.pendingSnapshot();
        if (afterFailure && afterFailure.command === 'sale.create' && afterFailure.payload && afterFailure.payload.operation_id === head.operation_id && afterFailure.payload.sale_id === head.sale_id) return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'CREATE_UNACKNOWLEDGED'));
        if (afterFailure && (afterFailure.command !== 'sale.create' || !afterFailure.payload || afterFailure.payload.operation_id !== head.operation_id || afterFailure.payload.sale_id !== head.sale_id)) return result('BLOCKED_FOREIGN_PENDING', processed, parseStored().intents.length, 'FOREIGN_PENDING');
        return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'CREATE_FAILED'));
      }
      if (!matching(canonical.receiptSnapshot(), head)) return result('WAITING', processed, parseStored().intents.length, 'RECEIPT_NOT_CONFIRMED');
      removeHead(head); processed += 1;
    }
  }
  async function sync() {
    try { return await withLock(syncLocked); }
    catch (error) { if (error && error.code === 'BUSY') return result('WAITING', 0, snapshot().intents.length, 'BUSY'); throw error; }
  }
  async function enqueue(input) {
    return withLock(function () {
      var intent = validateIntent(input), current = parseStored();
      if (current.intents.some(function (item) { return item.operation_id === intent.operation_id; })) fail('DUPLICATE_OPERATION_ID');
      current.intents.push(intent);
      write(current);
      return clone(intent);
    });
  }
  root.NuevoAmanecerCanonicalSaleOutbox = Object.freeze({ VERSION: VERSION, KEY: KEY, enqueue: enqueue, snapshot: snapshot, sync: sync });
})(globalThis);
