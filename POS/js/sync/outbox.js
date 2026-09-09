(function (root) {
  'use strict';

  var DEFAULT_ENDPOINT = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
  var CREDENTIALS_KEY = 'na_cloud_sync_credentials';
  var TYPES = ['sales', 'sale_items', 'inventory_movements'];
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var STATUS = Object.freeze({ PENDING: 'PENDING', SYNCED: 'SYNCED', FAILED: 'FAILED' });
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
    var h = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
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

  function entities(snapshotValue) {
    var data = snapshotValue.data;
    var rows = [];
    (data.ventas || []).slice().reverse().forEach(function (sale) {
      var id = String(sale.id);
      var identity = id + ':' + (sale.timestamp || sale.fecha || '');
      rows.push({ type: 'sales', id: id, key: 'sales:' + identity, value: sale });
      (sale.items || []).forEach(function (item, index) {
        rows.push({ type: 'sale_items', id: id + ':' + index, key: 'sale_items:' + identity + ':' + index,
          value: { sale_id: id, line_index: index, item: item } });
      });
    });
    (data.inventoryMovements || []).forEach(function (movement) {
      rows.push({ type: 'inventory_movements', id: String(movement.id), key: 'inventory_movements:' + movement.id, value: movement });
    });
    return rows;
  }

  function baseline(source) {
    var next = { version: 1, device_id: uuid(), next_device_sequence: 1, initialized: true, captured: {}, outbox: [] };
    entities(source).forEach(function (entity) { next.captured[entity.key] = true; });
    return next;
  }

  function initializeBaseline(source) {
    if (!state) state = baseline(source);
  }

  function sanitize(raw) {
    function require(condition) { if (!condition) throw new Error('INVALID_CLOUD_SYNC_STATE'); }
    require(raw && raw.version === 1 && raw.initialized === true && UUID.test(raw.device_id));
    require(Number.isSafeInteger(raw.next_device_sequence) && raw.next_device_sequence > 0);
    require(raw.captured && typeof raw.captured === 'object' && !Array.isArray(raw.captured));
    require(Array.isArray(raw.outbox) && raw.outbox.length <= 300000);
    var captured = {};
    Object.keys(raw.captured).forEach(function (key) {
      require(/^(sales|sale_items|inventory_movements):/.test(key) && raw.captured[key] === true);
      captured[key] = true;
    });
    var ids = new Set(), sequences = new Set();
    var operations = raw.outbox.map(function (op) {
      require(op && UUID.test(op.operation_id) && op.device_id === raw.device_id);
      require(Number.isSafeInteger(op.device_sequence) && op.device_sequence > 0 && op.device_sequence < raw.next_device_sequence);
      require(!ids.has(op.operation_id) && !sequences.has(op.device_sequence));
      ids.add(op.operation_id); sequences.add(op.device_sequence);
      require(TYPES.includes(op.entity_type) && typeof op.entity_id === 'string' && op.entity_id.length > 0);
      require(typeof op.payload === 'string' && /^[0-9a-f]{64}$/.test(op.payload_hash));
      require(typeof op.created_at === 'string' && Number.isFinite(Date.parse(op.created_at)));
      require(Object.values(STATUS).includes(op.status) && Number.isSafeInteger(op.attempts) && op.attempts >= 0);
      require(op.last_error === null || (typeof op.last_error === 'string' && op.last_error.length <= 80));
      return { operation_id: op.operation_id, device_id: op.device_id, device_sequence: op.device_sequence,
        entity_type: op.entity_type, entity_id: op.entity_id, payload: op.payload, payload_hash: op.payload_hash,
        created_at: op.created_at, status: op.status, attempts: op.attempts, last_error: op.last_error };
    });
    return { version: 1, device_id: raw.device_id, next_device_sequence: raw.next_device_sequence,
      initialized: true, captured: captured, outbox: operations };
  }

  function valid(raw) {
    if (raw === undefined || raw === null) return true;
    try { sanitize(raw); return true; } catch (error) { return false; }
  }

  function restore(raw, source) {
    state = raw ? sanitize(raw) : baseline(source);
    runtime.retryAfter = 0;
  }

  // Preparation is detached: no operation becomes sendable until the V9 commit is verified.
  async function prepare(source) {
    var next = state ? snapshot() : baseline(source);
    for (var entity of entities(source)) {
      if (next.captured[entity.key]) continue;
      if (!Number.isSafeInteger(next.next_device_sequence + 1)) throw new Error('DEVICE_SEQUENCE_EXHAUSTED');
      var payload = stableJson(entity.value);
      next.outbox.push({ operation_id: uuid(), device_id: next.device_id, device_sequence: next.next_device_sequence++,
        entity_type: entity.type, entity_id: entity.id, payload: payload, payload_hash: await sha256(payload),
        created_at: new Date().toISOString(), status: STATUS.PENDING, attempts: 0, last_error: null });
      next.captured[entity.key] = true;
    }
    return next;
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

  function firstUnsent() { return state && state.outbox.find(function (op) { return op.status !== STATUS.SYNCED; }); }

  function blockedBy(operation) {
    if (!operation || operation.status !== STATUS.FAILED) return null;
    return operation.last_error === 'AUTH_401' ? 'authentication' : operation.last_error === 'CONFLICT_409' ? 'conflict' : 'failed';
  }

  function scheduleSync() {
    if (runtime.syncing || runtime.timer !== null || !runtime.token || !runtime.persist) return;
    if (root.navigator && root.navigator.onLine === false) return;
    var first = firstUnsent();
    if (!first || blockedBy(first)) return;
    runtime.timer = root.setTimeout(function () {
      runtime.timer = null;
      syncPending().catch(function () {});
    }, Math.max(0, runtime.retryAfter - Date.now()));
  }

  function updateState(raw, operation, patch) {
    var next = sanitize(raw);
    var item = next.outbox.find(function (row) { return row.operation_id === operation.operation_id; });
    if (!item || item.payload_hash !== operation.payload_hash || item.status !== operation.status || item.attempts !== operation.attempts) {
      throw new Error('STALE_OUTBOX_OPERATION');
    }
    item.status = patch.status;
    item.attempts = patch.attempts;
    item.last_error = patch.last_error;
    return sanitize(next);
  }

  async function update(operation, patch) {
    if (!runtime.persist) return false;
    try {
      var result = await runtime.persist(clone(operation), patch);
      return !!(result && result.durable && result.verified);
    } catch (error) { return false; }
  }

  async function retryFailed(operationId) {
    if (runtime.syncing) return false;
    var item = state && state.outbox.find(function (op) { return op.operation_id === operationId; });
    if (!item || item.status !== STATUS.FAILED || item.last_error !== 'AUTH_401' || !runtime.token) return false;
    var ok = await update(item, { status: STATUS.PENDING, attempts: item.attempts, last_error: null });
    if (ok) scheduleSync();
    return ok;
  }

  async function syncPending(fetchImpl) {
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
      // Bound each pass; later local commits are handled by the next trigger.
      var ids = state ? state.outbox.filter(function (op) { return op.status !== STATUS.SYNCED; }).map(function (op) { return op.operation_id; }) : [];
      for (var id of ids) {
        var operation = clone(state.outbox.find(function (op) { return op.operation_id === id; }) || null);
        if (!operation) { summary.blocked = 'state_changed'; break; }
        if (blockedBy(operation)) { summary.blocked = blockedBy(operation); break; }
        if (operation.status === STATUS.SYNCED) continue;
        if (await sha256(operation.payload) !== operation.payload_hash) {
          await update(operation, { status: STATUS.FAILED, attempts: operation.attempts, last_error: 'PAYLOAD_HASH_MISMATCH' });
          summary.blocked = 'integrity'; break;
        }
        var attempts = operation.attempts + 1;
        if (!await update(operation, { status: STATUS.PENDING, attempts: attempts, last_error: null })) {
          summary.blocked = 'attempt_not_persisted'; break;
        }
        operation.attempts = attempts; operation.last_error = null;
        var controller = new root.AbortController();
        var timer = root.setTimeout(function () { controller.abort(); }, 15000);
        var status = STATUS.PENDING, lastError = null, block = null;
        try {
          var response = await send(runtime.endpoint + '/sync/operations', {
            method: 'POST', credentials: 'omit', redirect: 'error', signal: controller.signal,
            headers: { 'content-type': 'application/json', 'x-sync-token': runtime.token },
            body: JSON.stringify({ operation_id: operation.operation_id, device_id: operation.device_id,
              device_sequence: operation.device_sequence, entity_type: operation.entity_type, entity_id: operation.entity_id,
              payload: operation.payload, payload_hash: operation.payload_hash, created_at: operation.created_at }),
          });
          var body = null;
          try { body = await response.json(); } catch (error) {}
          if (body && body.operation_id === operation.operation_id &&
              ((response.status === 201 && body.status === 'inserted') || (response.status === 200 && body.status === 'already_processed'))) {
            status = STATUS.SYNCED;
          } else if (response.status >= 500 || response.status === 429 || response.status === 408 || response.status < 400) {
            lastError = 'HTTP_' + response.status; block = 'server';
          } else {
            status = STATUS.FAILED;
            lastError = response.status === 401 ? 'AUTH_401' : response.status === 409 ? 'CONFLICT_409' : 'HTTP_' + response.status;
            block = response.status === 401 ? 'authentication' : response.status === 409 ? 'conflict' : 'client';
          }
        } catch (error) { lastError = controller.signal.aborted ? 'TIMEOUT' : 'NETWORK'; block = 'network'; }
        finally { root.clearTimeout(timer); }
        if (!await update(operation, { status: status, attempts: attempts, last_error: lastError })) {
          summary.blocked = 'result_not_persisted'; break;
        }
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
      if (summary.blocked === 'network' || summary.blocked === 'server') scheduleSync();
    }
  }

  if (typeof root.addEventListener === 'function') root.addEventListener('online', function () { runtime.retryAfter = 0; scheduleSync(); });

  root.NuevoAmanecerOutbox = {
    STATUS: STATUS, snapshot: snapshot, restore: restore, sanitize: sanitize, valid: valid,
    initializeBaseline: initializeBaseline, prepare: prepare, accept: accept, updateState: updateState,
    configure: configure, start: start, scheduleSync: scheduleSync, syncPending: syncPending,
    retryFailed: retryFailed, stableJson: stableJson, sha256: sha256,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
