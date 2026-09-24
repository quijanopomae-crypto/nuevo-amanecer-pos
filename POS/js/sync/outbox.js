(function (root) {
  'use strict';

  var DEFAULT_ENDPOINT = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
  var CREDENTIALS_KEY = 'na_cloud_sync_credentials';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var STATUS = Object.freeze({ PENDING: 'PENDING', ACKED: 'ACKED', REJECTED: 'REJECTED', NEEDS_REVIEW: 'NEEDS_REVIEW' });
  var runtime = { endpoint: DEFAULT_ENDPOINT, token: '', syncing: false, timer: null, persist: null, retryAfter: 0 };
  var state = null;

  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    root.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
      var sorted = Object.create(null);
      Object.keys(value).sort().forEach(function (key) { sorted[key] = stableValue(value[key]); });
      return sorted;
    }
    return value;
  }

  function stableJson(value) { return JSON.stringify(stableValue(value)); }

  function sha256Fallback(text) {
    var bytes = new TextEncoder().encode(text), length = bytes.length, bitLength = length * 8;
    var paddedLength = Math.ceil((length + 9) / 64) * 64, data = new Uint8Array(paddedLength);
    data.set(bytes); data[length] = 128;
    var view = new DataView(data.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296));
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    var h = [1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
    var k = [1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];
    var w = new Uint32Array(64), right = function (value, bits) { return (value >>> bits) | (value << (32 - bits)); };
    for (var offset = 0; offset < paddedLength; offset += 64) {
      for (var i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
      for (var j = 16; j < 64; j++) { var s0=right(w[j-15],7)^right(w[j-15],18)^(w[j-15]>>>3),s1=right(w[j-2],17)^right(w[j-2],19)^(w[j-2]>>>10);w[j]=(w[j-16]+s0+w[j-7]+s1)>>>0; }
      var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
      for (var n = 0; n < 64; n++) { var sOne=right(e,6)^right(e,11)^right(e,25),choice=(e&f)^(~e&g),t1=(hh+sOne+choice+k[n]+w[n])>>>0,sZero=right(a,2)^right(a,13)^right(a,22),majority=(a&b)^(a&c)^(b&c),t2=(sZero+majority)>>>0;hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0; }
      h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+hh)>>>0;
    }
    return h.map(function (value) { return value.toString(16).padStart(8, '0'); }).join('');
  }

  async function sha256(text) {
    if (root.crypto && root.crypto.subtle) {
      var digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    }
    return sha256Fallback(text);
  }

  function snapshot() { return state ? clone(state) : null; }

  function sales(source) {
    return (source.data.ventas || []).slice().reverse().map(function (sale) {
      var value = sale;
      if ((sale.metodoPago || sale.metodo) === 'credito' && !sale.creditDue) {
        var credit = (source.data.creditos || []).find(function (item) { return String(item.ventaId) === String(sale.id); });
        if (credit) { value = clone(sale); value.creditDue = credit.vence; }
      }
      return { key: 'sale:' + String(sale.id) + ':' + String(sale.timestamp || ''), sale: value };
    });
  }

  function baseline(source) {
    var next = { version: 2, device_id: uuid(), initialized: true, captured: {}, outbox: [] };
    sales(source).forEach(function (entry) { next.captured[entry.key] = true; });
    return next;
  }

  function cents(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount)) throw new Error('INVALID_SALE_AMOUNT');
    return Math.round(amount * 100);
  }

  function saleCommand(sale, operationId, deviceId, source) {
    var movements = (source.data.inventoryMovements || []).filter(function (movement) {
      return movement.source === 'SALE' && String(movement.referenceId) === String(sale.id);
    }).slice();
    var command = {
      operation_id: operationId,
      device_id: deviceId,
      sale_id: String(sale.id),
      created_at: new Date(sale.timestamp).toISOString(),
      payment_method: String(sale.metodoPago || sale.metodo),
      total_cents: cents(sale.total),
      items: (sale.items || []).map(function (item) {
        var productId = String(item.productoId === undefined ? item.id : item.productoId);
        var quantity = Number(item.cantidad === undefined ? item.qty : item.cantidad);
        var unitPrice = cents(item.precioUnitario === undefined ? item.precio : item.precioUnitario);
        var lineTotal = cents(item.subtotal === undefined ? Number(item.precioUnitario === undefined ? item.precio : item.precioUnitario) * quantity : item.subtotal);
        var movementIndex = movements.findIndex(function (movement) { return String(movement.productId) === productId; });
        var inventoryQuantity = movementIndex < 0 ? 0 : -Number(movements.splice(movementIndex, 1)[0].delta);
        return {
          product_id: productId, quantity: quantity, unit_price_cents: unitPrice,
          line_total_cents: lineTotal, inventory_quantity: inventoryQuantity,
        };
      }),
    };
    if (command.payment_method === 'credito') {
      command.customer_id = String(sale.clienteId || '');
      command.credit_due = String(sale.creditDue || '');
    } else if (command.payment_method === 'mixto') {
      command.payment = {
        cash_cents: cents(sale.paymentBreakdown && sale.paymentBreakdown.efectivo),
        digital_cents: cents(sale.paymentBreakdown && sale.paymentBreakdown.digital),
        digital_method: String(sale.paymentBreakdown && sale.paymentBreakdown.digitalMethod),
        reference: String((sale.paymentBreakdown && sale.paymentBreakdown.reference) || ''),
      };
    } else if (['yape', 'plin', 'transferencia'].includes(command.payment_method)) {
      command.payment = { reference: String(sale.paymentRef || '') };
    }
    return command;
  }

  function initializeBaseline(source) { if (!state) state = baseline(source); }

  function sanitize(raw) {
    function require(condition) { if (!condition) throw new Error('INVALID_CLOUD_SYNC_STATE'); }
    require(raw && [1, 2].includes(raw.version) && raw.initialized === true && UUID.test(raw.device_id));
    require(raw.captured && typeof raw.captured === 'object' && !Array.isArray(raw.captured));
    require(Array.isArray(raw.outbox) && raw.outbox.length <= 300000);
    if (raw.version === 1) {
      require(Number.isSafeInteger(raw.next_device_sequence) && raw.next_device_sequence > 0);
      var legacyIds = new Set(), sequences = new Set();
      Object.keys(raw.captured).forEach(function (key) { require(/^(sales|sale_items|inventory_movements):/.test(key) && raw.captured[key] === true); });
      var legacyOperations = raw.outbox.map(function (op) {
        require(op && UUID.test(op.operation_id) && op.device_id === raw.device_id && !legacyIds.has(op.operation_id));
        require(Number.isSafeInteger(op.device_sequence) && op.device_sequence > 0 && op.device_sequence < raw.next_device_sequence && !sequences.has(op.device_sequence));
        legacyIds.add(op.operation_id); sequences.add(op.device_sequence);
        require(['sales', 'sale_items', 'inventory_movements'].includes(op.entity_type) && typeof op.entity_id === 'string' && op.entity_id.length > 0);
        require(typeof op.payload === 'string' && /^[0-9a-f]{64}$/.test(op.payload_hash));
        require(typeof op.created_at === 'string' && Number.isFinite(Date.parse(op.created_at)));
        require(['PENDING', 'SYNCED', 'FAILED'].includes(op.status) && Number.isSafeInteger(op.attempts) && op.attempts >= 0);
        require(op.last_error === null || (typeof op.last_error === 'string' && op.last_error.length <= 80));
        return { operation_id: op.operation_id, device_id: op.device_id, device_sequence: op.device_sequence,
          entity_type: op.entity_type, entity_id: op.entity_id, payload: op.payload, payload_hash: op.payload_hash,
          created_at: op.created_at, status: op.status, attempts: op.attempts, last_error: op.last_error };
      });
      return { version: 1, device_id: raw.device_id, next_device_sequence: raw.next_device_sequence,
        initialized: true, captured: clone(raw.captured), outbox: legacyOperations };
    }
    var captured = {};
    Object.keys(raw.captured).forEach(function (key) { require(/^sale:/.test(key) && raw.captured[key] === true); captured[key] = true; });
    var ids = new Set();
    var outbox = raw.outbox.map(function (op) {
      require(op && UUID.test(op.operation_id) && op.device_id === raw.device_id && !ids.has(op.operation_id)); ids.add(op.operation_id);
      require(op.command === 'sale.create' && typeof op.sale_id === 'string' && op.sale_id.length > 0 && op.sale_id.length <= 160);
      require(typeof op.payload === 'string' && /^[0-9a-f]{64}$/.test(op.payload_hash));
      require(typeof op.created_at === 'string' && Number.isFinite(Date.parse(op.created_at)));
      require(Object.values(STATUS).includes(op.status) && Number.isSafeInteger(op.attempts) && op.attempts >= 0);
      require(op.last_error === null || (typeof op.last_error === 'string' && op.last_error.length <= 80));
      return { operation_id: op.operation_id, device_id: op.device_id, command: op.command, sale_id: op.sale_id,
        payload: op.payload, payload_hash: op.payload_hash, created_at: op.created_at,
        status: op.status, attempts: op.attempts, last_error: op.last_error };
    });
    var result = { version: 2, device_id: raw.device_id, initialized: true, captured: captured, outbox: outbox };
    if (raw.legacy !== undefined) {
      require(raw.legacy && raw.legacy.version === 1 && raw.legacy.device_id === raw.device_id);
      result.legacy = sanitize(raw.legacy);
    }
    return result;
  }

  function valid(raw) {
    if (raw === undefined || raw === null) return true;
    try { sanitize(raw); return true; } catch (error) { return false; }
  }

  function restore(raw, source) {
    var restored = raw ? sanitize(raw) : null;
    if (restored && restored.version === 1) {
      // Preserve the legacy journal verbatim for review, never reinterpret it as an A3 sale.
      state = baseline(source); state.device_id = restored.device_id; state.legacy = restored;
    } else state = restored || baseline(source);
    runtime.retryAfter = 0;
  }

  // Preparation is detached: no operation becomes sendable until the full local sale commit is verified.
  async function prepare(source) {
    if (root.NuevoAmanecerCanonical && root.NuevoAmanecerCanonical.enabled()) throw new Error('CANONICAL_LEGACY_OUTBOX_BLOCKED');
    var next = state ? snapshot() : baseline(source);
    for (var entry of sales(source)) {
      if (next.captured[entry.key]) continue;
      var operationId = uuid(), command = saleCommand(entry.sale, operationId, next.device_id, source);
      var payload = stableJson(command);
      next.outbox.push({ operation_id: operationId, device_id: next.device_id, command: 'sale.create', sale_id: command.sale_id,
        payload: payload, payload_hash: await sha256(payload), created_at: new Date().toISOString(),
        status: STATUS.PENDING, attempts: 0, last_error: null });
      next.captured[entry.key] = true;
    }
    return sanitize(next);
  }

  function accept(next) { state = clone(next); }

  function configure(options) {
    var next = options || {};
    var endpoint = next.endpoint === undefined ? runtime.endpoint : String(next.endpoint).replace(/\/+$/, '');
    var url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_SYNC_ENDPOINT');
    var token = typeof next.token === 'string' ? next.token : runtime.token;
    if (/[\r\n]/.test(token)) throw new Error('INVALID_SYNC_TOKEN');
    runtime.endpoint = endpoint; runtime.token = token;
    if (typeof next.persist === 'function') runtime.persist = next.persist;
    var remembered = false;
    try {
      if (next.remember === true) {
        var serialized = JSON.stringify({ endpoint: endpoint, token: token });
        root.localStorage.setItem(CREDENTIALS_KEY, serialized);
        remembered = root.localStorage.getItem(CREDENTIALS_KEY) === serialized;
      } else if (next.remember === false) root.localStorage.removeItem(CREDENTIALS_KEY);
    } catch (error) {}
    scheduleSync();
    return { endpoint: endpoint, configured: !!token, remembered: remembered };
  }

  function start(persist) {
    runtime.persist = persist;
    try {
      var saved = JSON.parse(root.localStorage.getItem(CREDENTIALS_KEY) || 'null');
      if (saved && !runtime.token) configure({ endpoint: saved.endpoint, token: saved.token });
    } catch (error) {}
    scheduleSync();
  }

  function firstPending() { return state && state.outbox.find(function (op) { return op.status === STATUS.PENDING; }); }

  function scheduleSync() {
    if (root.NuevoAmanecerCanonical && root.NuevoAmanecerCanonical.enabled()) return;
    if (runtime.syncing || runtime.timer !== null || !runtime.token || !runtime.persist || !firstPending()) return;
    if (root.navigator && root.navigator.onLine === false) return;
    runtime.timer = root.setTimeout(function () { runtime.timer = null; syncPending().catch(function () {}); }, Math.max(0, runtime.retryAfter - Date.now()));
  }

  function updateState(raw, operation, patch) {
    var next = sanitize(raw);
    var item = next.outbox.find(function (row) { return row.operation_id === operation.operation_id; });
    if (!item || item.payload !== operation.payload || item.payload_hash !== operation.payload_hash || item.device_id !== operation.device_id || item.sale_id !== operation.sale_id || item.status !== operation.status || item.attempts !== operation.attempts) throw new Error('STALE_OUTBOX_OPERATION');
    item.status = patch.status; item.attempts = patch.attempts; item.last_error = patch.last_error;
    return sanitize(next);
  }

  async function update(operation, patch) {
    if (!runtime.persist) return false;
    try {
      var result = await runtime.persist(clone(operation), patch);
      return !!(result && result.durable && result.verified);
    } catch (error) { return false; }
  }

  async function retryRejected(operationId) {
    if (runtime.syncing) return false;
    var item = state && state.outbox.find(function (op) { return op.operation_id === operationId; });
    if (!item || item.status !== STATUS.REJECTED || !/^AUTH_(401|403)$/.test(item.last_error || '') || !runtime.token) return false;
    var ok = await update(item, { status: STATUS.PENDING, attempts: item.attempts, last_error: null });
    if (ok) scheduleSync();
    return ok;
  }

  async function syncPending(fetchImpl) {
    if (root.NuevoAmanecerCanonical && root.NuevoAmanecerCanonical.enabled()) return { ok: false, blocked: 'canonical_authority' };
    if (runtime.syncing) return { ok: false, blocked: 'busy' };
    if (!runtime.token) return { ok: false, blocked: 'missing_token' };
    if (!runtime.persist) return { ok: false, blocked: 'persistence_unavailable' };
    if (root.navigator && root.navigator.onLine === false) return { ok: false, blocked: 'offline' };
    if (Date.now() < runtime.retryAfter) return { ok: false, blocked: 'backoff' };
    if (runtime.timer !== null) { root.clearTimeout(runtime.timer); runtime.timer = null; }
    var send = fetchImpl || root.fetch;
    if (typeof send !== 'function') return { ok: false, blocked: 'fetch_unavailable' };
    runtime.syncing = true;
    var summary = { ok: true, synced: 0, blocked: null };
    try {
      var ids = state ? state.outbox.filter(function (op) { return op.status === STATUS.PENDING; }).map(function (op) { return op.operation_id; }) : [];
      for (var id of ids) {
        var operation = clone(state.outbox.find(function (op) { return op.operation_id === id; }) || null);
        if (!operation || operation.status !== STATUS.PENDING) continue;
        var command;
        try { command = JSON.parse(operation.payload); } catch (error) {}
        if (await sha256(operation.payload) !== operation.payload_hash || !command || command.operation_id !== operation.operation_id || command.device_id !== operation.device_id || command.sale_id !== operation.sale_id) {
          await update(operation, { status: STATUS.NEEDS_REVIEW, attempts: operation.attempts, last_error: 'PAYLOAD_HASH_MISMATCH' });
          summary.blocked = 'integrity'; break;
        }
        var attempts = operation.attempts + 1;
        if (!await update(operation, { status: STATUS.PENDING, attempts: attempts, last_error: null })) { summary.blocked = 'attempt_not_persisted'; break; }
        operation.attempts = attempts; operation.last_error = null;
        var controller = new root.AbortController(), timer = root.setTimeout(function () { controller.abort(); }, 15000);
        var status = STATUS.PENDING, lastError = null, block = null;
        try {
          var response = await send(runtime.endpoint + '/commands/sale.create', {
            method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
            headers: { 'content-type': 'application/json', 'x-sync-token': runtime.token, 'x-device-id': operation.device_id },
            body: operation.payload,
          });
          var body = null;
          try { body = await response.json(); } catch (error) {}
          if (body && body.operation_id === operation.operation_id && body.sale_id === operation.sale_id && ((response.status === 201 && body.status === 'created') || (response.status === 200 && body.status === 'already_processed'))) {
            status = STATUS.ACKED;
          } else if (response.status >= 500 || response.status === 429 || response.status === 408) {
            lastError = 'HTTP_' + response.status; block = 'server';
          } else if (response.status < 400) {
            status = STATUS.NEEDS_REVIEW; lastError = 'AMBIGUOUS_ACK'; block = 'needs_review';
          } else {
            status = response.status === 409 ? STATUS.NEEDS_REVIEW : STATUS.REJECTED;
            lastError = (response.status === 401 || response.status === 403) ? 'AUTH_' + response.status : response.status === 409 ? 'CONFLICT_409' : 'HTTP_' + response.status;
            block = (response.status === 401 || response.status === 403) ? 'authentication' : response.status === 409 ? 'needs_review' : 'rejected';
          }
        } catch (error) { lastError = controller.signal.aborted ? 'TIMEOUT' : 'NETWORK'; block = 'network'; }
        finally { root.clearTimeout(timer); }
        if (!await update(operation, { status: status, attempts: attempts, last_error: lastError })) { summary.blocked = 'result_not_persisted'; break; }
        if (block) {
          if (status === STATUS.PENDING) runtime.retryAfter = Date.now() + Math.min(300000, 1000 * Math.pow(2, Math.min(attempts, 8)));
          summary.blocked = block; break;
        }
        summary.synced += 1;
      }
      summary.ok = !summary.blocked;
      summary.pending = state ? state.outbox.filter(function (op) { return op.status === STATUS.PENDING; }).length : 0;
      return summary;
    } finally {
      runtime.syncing = false;
      if (!fetchImpl && (!summary.blocked || summary.blocked === 'network' || summary.blocked === 'server')) scheduleSync();
    }
  }

  if (typeof root.addEventListener === 'function') root.addEventListener('online', function () { runtime.retryAfter = 0; scheduleSync(); });

  root.NuevoAmanecerOutbox = {
    STATUS: STATUS, snapshot: snapshot, restore: restore, sanitize: sanitize, valid: valid,
    initializeBaseline: initializeBaseline, prepare: prepare, accept: accept, updateState: updateState,
    configure: configure, start: start, scheduleSync: scheduleSync, syncPending: syncPending,
    retryRejected: retryRejected, retryFailed: retryRejected, stableJson: stableJson, sha256: sha256,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
