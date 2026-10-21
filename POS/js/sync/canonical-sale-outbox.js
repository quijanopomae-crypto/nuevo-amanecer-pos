(function (root) {
  'use strict';

  var VERSION = 1;
  var KEY = 'na_canonical_sale_outbox_v1';
  // Two locks. LOCK serializes the drain/close/quarantine actions and may be
  // held across network calls. STORE_LOCK only wraps synchronous
  // read-modify-write of localStorage, so registering a new sale never waits
  // on (or fails because of) the network.
  var LOCK = 'na-canonical-sale-outbox';
  var STORE_LOCK = 'na-canonical-sale-outbox-store';
  var STORE_WAIT_MS = 20000;
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
    if (!data || data.version !== VERSION || !Array.isArray(data.intents) ||
        data.last_sale_number !== undefined && (!Number.isSafeInteger(data.last_sale_number) || data.last_sale_number < 0)) fail('OUTBOX_CORRUPT');
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
  // `work` must be synchronous: it never awaits, so the lock is held for
  // microseconds and never across the network. Never nest withStore.
  async function withStore(work) {
    var locks = root.navigator && root.navigator.locks;
    if (!locks || typeof locks.request !== 'function') fail('WEB_LOCKS_UNAVAILABLE');
    var controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
    var timer = controller && typeof root.setTimeout === 'function' ? root.setTimeout(function () { controller.abort(); }, STORE_WAIT_MS) : null;
    var options = { mode: 'exclusive' };
    if (controller) options.signal = controller.signal;
    try {
      return await locks.request(STORE_LOCK, options, function () { return work(); });
    } catch (error) {
      if (controller && controller.signal.aborted) fail('BUSY');
      throw error;
    } finally { if (timer !== null && typeof root.clearTimeout === 'function') root.clearTimeout(timer); }
  }
  // Only the cash-close barrier keeps STORE_LOCK across a network call, so no
  // new sale lands between "queue empty" and the close ACK. A sale registered
  // meanwhile waits (bounded by STORE_WAIT_MS) instead of failing BUSY.
  // While this tab is closing the till, a new sale fails fast with BUSY (cart
  // kept) instead of waiting and landing in a caja that is about to close.
  var closingTill = 0;
  async function holdStore(work) {
    var locks = root.navigator && root.navigator.locks;
    if (!locks || typeof locks.request !== 'function') fail('WEB_LOCKS_UNAVAILABLE');
    closingTill++;
    try { return await locks.request(STORE_LOCK, { mode: 'exclusive' }, function () { return work(); }); }
    finally { closingTill--; }
  }
  function snapshot() { var current = parseStored(); return clone(current); }
  // Sale quarantine: rejected or undeliverable sales leave the FIFO only after a
  // full durable copy is saved here. Entries are never deleted; they only
  // change status (QUARANTINED -> REQUEUED | CONFIRMED_REMOTE | ARCHIVED_NO_CHARGE).
  var QKEY = KEY + '_quarantine';
  var DETERMINISTIC = ['INVALID_CANONICAL_CUSTOMER', 'INVALID_CANONICAL_CREDIT', 'INVALID_CANONICAL_PRODUCT', 'INVALID_CANONICAL_ITEM',
    'INVALID_CANONICAL_GENERIC_LINE', 'INVALID_CANONICAL_TOTAL', 'UNSAFE_CANONICAL_TOTAL', 'INVALID_CANONICAL_PAYMENT', 'INVALID_CANONICAL_INTENT'];
  var CONFLICTS = ['operation_id_conflict', 'sale_id_conflict'];
  // A charged sale whose cash/payment really happened: never offered as
  // "annul as not registered" (the owner reconciles it from the review list).
  // T-47: venta capturada por OTRA sesión de este aparato (identity_changed) o guardada por una versión
  // anterior sin identidad cuando no se puede probar que la sesión es la misma (identity_unverified).
  // Nunca se envía con el token actual ni se borra: va a «Ventas en revisión» y solo el dueño la aprueba.
  var IDENTITY_REASONS = ['identity_changed', 'identity_unverified'];
  var NEVER_ANNUL = CONFLICTS.concat(['payment_reference_conflict', 'cash_session_closed', 'cash_session_required', 'promotion_changed'], IDENTITY_REASONS);
  // Rejections about THIS sale move it aside to the durable review list so the
  // rest of the queue keeps flowing. Any other definitive 400/404/409 of
  // sale.create also goes to review (never freeze the drain); system answers
  // (401, 403, stale_authority, canonical_not_active) keep the intent queued,
  // free the journal and wait for a new session/binding.
  var SALE_REJECTIONS = ['product_not_found', 'insufficient_stock', 'stale_stock', 'invalid_sale_request', 'customer_not_found',
    'sale_id_conflict', 'operation_id_conflict', 'canonical_sale_conflict', 'payment_reference_conflict',
    'cash_session_closed', 'cash_session_required', 'expired_lots_not_allowed', 'expired_lot_approval_required', 'credit_limit_exceeded'];
  var SYSTEM_ERRORS = ['unauthorized', 'session_revoked', 'read_only_session', 'stale_authority', 'canonical_not_active', 'HTTP_401', 'HTTP_403'];
  function systemRejection(record) {
    return !!record && !!record.last_error && (record.last_status === 401 || record.last_status === 403 || SYSTEM_ERRORS.indexOf(String(record.last_error)) !== -1);
  }
  function definitive(record) { return !!record && !!record.last_error && [400, 404, 409].indexOf(record.last_status) !== -1; }
  var REASON_TEXT = {
    expired_lots_confirmation_required: 'el servidor anterior rechazó una venta ya cobrada por vencimiento. Pulsa Reintentar para registrarla con auditoría, sin volver a cobrar',
    expired_lots_not_allowed: 'la venta usa lotes vencidos y «Permitir vender lotes vencidos» está apagado. El dueño debe activarlo en Configuración › Productos y stock y autorizar con su PIN',
    expired_lot_approval_required: 'la venta usa lotes vencidos sin autorización válida: necesita la aprobación del dueño o supervisor con su PIN',
    invalid_lot_state: 'los lotes y el stock de este producto necesitan revisión; no se aplicó la venta',
    cash_closed_before_sale: 'la caja ya estaba cerrada en el servidor cuando la venta iba a confirmarse',
    insufficient_stock: 'no había stock suficiente en CANON: el stock de este aparato estaba desactualizado (otro equipo o una salida usó esas unidades). Revisa el producto y pulsa Reintentar, o Anular si no se cobró',
    stale_stock: 'stock desactualizado: el stock cambió en otro equipo mientras se vendía. Pulsa Reintentar: usa el stock actual y nunca cobra dos veces',
    product_not_found: 'el producto no existe en CANON',
    customer_not_found: 'el cliente no existe en CANON',
    sale_id_conflict: 'otro equipo ya usó ese número de venta',
    operation_id_conflict: 'la operación choca con otra ya registrada',
    payment_reference_conflict: 'ese número de operación Yape/transferencia ya está en otra venta',
    cash_session_closed: 'la caja ya estaba cerrada',
    cash_session_required: 'no hay ninguna caja abierta en CANON',
    promotion_changed: 'CANON cambió de promoción mientras la venta esperaba',
    credit_limit_exceeded: 'supera la línea de crédito del cliente',
    canonical_sale_conflict: 'CANON no pudo registrarla',
    invalid_sale_request: 'los datos de la venta no son válidos',
    identity_changed: 'la registró otra sesión de este aparato con otro rol (dueño/empleado). No se envió con la sesión actual: el dueño debe revisarla y pulsar Reintentar para registrarla con esta sesión',
    identity_unverified: 'se guardó antes de esta actualización y no se puede saber qué sesión la registró. No se envió: el dueño debe revisarla y pulsar Reintentar'
  };
  // T-03: con qué chocó el operation_id, si el servidor lo dice (entry.ledger / entry.conflict).
  // Una sola tabla de libros: la del cliente CANON (canonical-client.js, ledgerText).
  function ledgerText(ledger) {
    try { var c = root.NuevoAmanecerCanonical; if (c && typeof c.ledgerText === 'function') return c.ledgerText(ledger); } catch (_) {}
    return 'otro registro (' + String(ledger) + ')';
  }
  function reasonText(reason, entry) {
    var text = REASON_TEXT[reason] || ('CANON la rechazó (' + String(reason) + ')');
    if (reason === 'operation_id_conflict' && entry && (entry.ledger || entry.conflict)) {
      var ledger = entry.ledger ? ledgerText(entry.ledger) : null;
      text += ledger ? ': choca con ' + ledger + ' ya registrado con el mismo identificador' : '';
      if (entry.conflict === 'cross_ledger' && !ledger) text += ': choca con otro tipo de registro';
    }
    return text;
  }
  function readQuarantine() {
    var raw;
    try { raw = root.localStorage.getItem(QKEY); } catch (_) { fail('QUARANTINE_STORAGE_READ_FAILED'); }
    if (raw === null) return { version: VERSION, entries: [] };
    var data;
    try { data = JSON.parse(raw); } catch (_) { fail('QUARANTINE_CORRUPT'); }
    if (!data || data.version !== VERSION || !Array.isArray(data.entries)) fail('QUARANTINE_CORRUPT');
    return data;
  }
  function writeQuarantine(data) {
    var serialized = JSON.stringify(data);
    try { root.localStorage.setItem(QKEY, serialized); } catch (_) { fail('QUARANTINE_STORAGE_WRITE_FAILED'); }
    if (root.localStorage.getItem(QKEY) !== serialized) fail('QUARANTINE_STORAGE_NOT_DURABLE');
  }
  function quarantineSnapshot() { return clone(readQuarantine()); }
  // Owner rule: any unresolved quarantined sale keeps the cash close blocked
  // until it is reconciled (confirmed on the server or annulled as unregistered).
  // It never blocks sales, payments or expenses.
  function cashOf(intent) { return Number(intent && intent.payment && intent.payment.cash_cents) || 0; }
  // Caja a la que pertenece una venta: su session_id o, si no lo lleva, la caja abierta cuando se hizo.
  function sessionOfIntent(intent) {
    var c = root.NuevoAmanecerCanonical, list = [];
    try { list = (c && typeof c.snapshot === 'function' && c.snapshot().cashSessions) || []; } catch (_) {}
    if (intent && intent.session_id) return list.find(function (x) { return x.session_id === intent.session_id; }) || null;
    var t = Date.parse(intent && intent.created_at || '') || 0;
    return list.find(function (x) { var o = Date.parse(x.opened_at || '') || 0, e = x.closed_at ? Date.parse(x.closed_at) : Infinity; return t >= o && t <= e; }) || null;
  }
  // Solo bloquean el cierre las ventas en revisión de la caja ABIERTA. Las de una caja anterior ya cerrada se
  // siguen mostrando en ámbar pero no impiden cerrar la caja nueva.
  function blockingQuarantine() {
    return readQuarantine().entries.filter(function (entry) {
      if (entry.status !== 'QUARANTINED') return false;
      var s = sessionOfIntent(entry.intent);
      return !s || s.status !== 'CLOSED';
    });
  }
  // Safe retry (same operation_id) only where the cause can clear by itself or
  // after a data fix; never for conflicts or malformed requests.
  // Explicit allowlist (fail-closed): causes that clear when the replica
  // catches up, stock arrives, or the missing customer/product is registered.
  var RETRYABLE = DETERMINISTIC.concat(['insufficient_stock', 'stale_stock', 'customer_not_found', 'product_not_found', 'sale_id_conflict',
    'cash_session_closed', 'cash_session_required', 'promotion_changed', 'credit_limit_exceeded']);
  RETRYABLE.push('expired_lots_confirmation_required', 'expired_lots_not_allowed', 'expired_lot_approval_required');
  RETRYABLE.push.apply(RETRYABLE, IDENTITY_REASONS);
  // Retrying these re-assigns the charged sale explicitly (owner action).
  var REBIND_ON_RETRY = ['cash_session_closed', 'cash_session_required'];
  function retryable(reason) { return RETRYABLE.indexOf(reason) !== -1; }
  // Annul only when the absence proof can see the sale: the quarantined
  // command must carry a journal bound to the promotion that is active now
  // (the replica only lists that promotion's sales). No journal: no annul.
  function boundPromotion(entry) { var j = entry && entry.journal; return j && ((j.binding && j.binding.promotion_id) || (j.payload && j.payload.promotion_id)) || null; }
  function annullable(entry, canonical) {
    if (!entry || NEVER_ANNUL.indexOf(entry.reason) !== -1) return false;
    var bound = boundPromotion(entry), snap = canonical && typeof canonical.snapshot === 'function' ? canonical.snapshot() || {} : {};
    return !!bound && bound === snap.promotion_id;
  }
  function quarantinedOperation(operationId) {
    return readQuarantine().entries.some(function (entry) { return entry.status === 'QUARANTINED' && entry.intent.operation_id === operationId; });
  }
  async function quarantineHead(canonical, head, reason, status) {
    var byIdentity = IDENTITY_REASONS.indexOf(reason) !== -1;
    var release = byIdentity ? canonical.releaseIdentityHeldSaleJournal : canonical.releaseRejectedSaleJournal;
    // Needs the client release; older runtimes keep the sale blocked in place.
    if (typeof release !== 'function') return false;
    var pending = canonical.pendingSnapshot();
    var own = pending && pending.payload && pending.payload.operation_id === head.operation_id ? pending : null;
    var heldStamp = stampOf(head.operation_id), heldBy = byIdentity ? currentIdentity(canonical) : null;
    await withStore(function () {
      var q = readQuarantine();
      if (!q.entries.some(function (entry) { return entry.intent.operation_id === head.operation_id && entry.status === 'QUARANTINED'; })) {
        q.entries = q.entries.filter(function (entry) { return !(entry.intent.operation_id === head.operation_id && entry.status === 'REQUEUED'); })
          .concat(q.entries.filter(function (entry) { return entry.intent.operation_id === head.operation_id && entry.status === 'REQUEUED'; })
            .map(function (entry) { entry.status = 'RETRY_REJECTED'; return entry; }));
        var item = { intent: clone(head), reason: String(reason), last_status: status || (own && own.last_status) || null, journal: own ? clone(own) : null,
          status: 'QUARANTINED', quarantined_at: new Date().toISOString() };
        if (heldStamp) item.identity = clone(heldStamp);
        if (byIdentity) item.held_by_identity = heldBy ? heldBy.key : null;
        var detail = own && own.last_conflict_detail;
        if (String(reason) === 'operation_id_conflict' && detail && typeof detail === 'object') {
          if (detail.conflict) item.conflict = String(detail.conflict);
          if (detail.ledger) item.ledger = String(detail.ledger);
        }
        q.entries.push(item);
        writeQuarantine(q);
      }
    });
    if (own) {
      var released = false;
      try { released = await release.call(canonical, head.operation_id); } catch (_) { released = false; }
      if (!released) return false;
    }
    await removeHead(head);
    clearHold(head.operation_id);
    notifyReview(head, reason, own && own.last_conflict_detail);
    if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('na:canonical-sale-projection'));
    return true;
  }
  function matching(value, intent) { return !!value && value.operation_id === intent.operation_id && value.sale_id === intent.sale_id; }
  function removeHead(expected) {
    return withStore(function () {
      var current = parseStored();
      if (!current.intents.length || current.intents[0].operation_id !== expected.operation_id) fail('OUTBOX_HEAD_CHANGED');
      var number = /^V-(\d+)$/.exec(expected.sale_id);
      if (number) current.last_sale_number = Math.max(current.last_sale_number || 0, Number(number[1]));
      current.intents.shift();
      write(current);
      dropStamp(expected.operation_id);
    });
  }
  function maxReservedNumber(current, canonical) {
    var confirmed = canonical && typeof canonical.snapshot === 'function' ? (canonical.snapshot() || {}).sales || [] : [];
    var receipt = canonical && typeof canonical.receiptSnapshot === 'function' ? canonical.receiptSnapshot() : null;
    var held = []; try { held = readQuarantine().entries.map(function (entry) { return entry.intent; }); } catch (_) {}
    return confirmed.concat(current.intents, held, receipt ? [receipt] : []).reduce(function (value, sale) {
      var number = /^V-(\d+)$/.exec(String(sale && (sale.sale_id || sale.id) || ''));
      return Math.max(value, number ? Number(number[1]) : 0);
    }, current.last_sale_number || 0);
  }
  // 409 sale_id_conflict proves nothing was committed for this operation_id:
  // keep the SAME operation_id and give the sale the next free number.
  async function renumberHead(canonical, head) {
    try { await canonical.refresh(); } catch (_) {}
    var updated = await withStore(function () {
      var current = parseStored();
      if (!current.intents.length || current.intents[0].operation_id !== head.operation_id) fail('OUTBOX_HEAD_CHANGED');
      var next = maxReservedNumber(current, canonical) + 1;
      if (!Number.isSafeInteger(next)) fail('SALE_NUMBER_UNSAFE');
      var input = clone(head); input.sale_id = 'V-' + String(next).padStart(3, '0');
      var intent = validateIntent(input);
      current.intents[0] = intent;
      current.last_sale_number = next;
      write(current);
      return intent;
    });
    var runtime = root.NuevoAmanecerCanonicalUIAdapter && root.NuevoAmanecerCanonicalUIAdapter.runtime;
    if (runtime && typeof runtime.notify === 'function') runtime.notify('La venta ' + head.sale_id + ' se registra como ' + updated.sale_id +
      ': otro equipo ya había usado ese número. Es la misma venta; no la cobres de nuevo.', 'info');
    return updated;
  }
  // System rejections (401/403/stale_authority/canonical_not_active) free the
  // journal but keep the intent queued. Remember the promotion it was bound to:
  // if CANON moved to another promotion, the owner decides from the review list.
  var HOLD_KEY = KEY + '_authority_hold';
  function readHolds() { try { var v = JSON.parse(root.localStorage.getItem(HOLD_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } }
  function writeHolds(v) { try { if (Object.keys(v).length) root.localStorage.setItem(HOLD_KEY, JSON.stringify(v)); else root.localStorage.removeItem(HOLD_KEY); } catch (_) {} }
  function clearHold(operationId) { var holds = readHolds(); if (holds[operationId]) { delete holds[operationId]; writeHolds(holds); } }
  // T-47: identidad (huella de la sesión; sesión/rol si estaban confirmados por /auth/me) con la que se guardó cada
  // venta. Clave aparte para no cambiar el formato de la cola; se escribe ANTES que la venta (una venta
  // sin identidad se trata como antigua, nunca como «de cualquiera»).
  var IDENTITY_KEY = KEY + '_identity';
  function readIdentities() { try { var v = JSON.parse(root.localStorage.getItem(IDENTITY_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (_) { return {}; } }
  function writeIdentities(v) { var raw = JSON.stringify(v); try { root.localStorage.setItem(IDENTITY_KEY, raw); } catch (_) { fail('OUTBOX_STORAGE_WRITE_FAILED'); } if (root.localStorage.getItem(IDENTITY_KEY) !== raw) fail('OUTBOX_STORAGE_READBACK_MISMATCH'); }
  function stampOf(operationId) { var v = readIdentities()[operationId]; return v && typeof v.key === 'string' && v.key ? v : null; }
  function stamp(operationId, who, extra) { var v = readIdentities(); v[operationId] = Object.assign({ key: who.key, user: who.user || null, principal: who.principal || null, role: who.role || null, at: new Date().toISOString() }, extra || {}); writeIdentities(v); }
  function dropStamp(operationId) { var v = readIdentities(); if (v[operationId]) { delete v[operationId]; try { root.localStorage.setItem(IDENTITY_KEY, JSON.stringify(v)); } catch (_) {} } }
  function upgradeAt(canonical) { try { return typeof canonical.identityUpgradeAt === 'function' ? canonical.identityUpgradeAt() : null; } catch (_) { return null; } }
  function currentIdentity(canonical) {
    if (!canonical || typeof canonical.sessionIdentity !== 'function') return null;
    try { return canonical.sessionIdentity(); } catch (_) { return null; }
  }
  // null = se puede enviar con la sesión actual; si no, el motivo para apartarla.
  function identityProblem(canonical, head) {
    var who = currentIdentity(canonical);
    // Cliente sin soporte de identidad o sin sesión guardada: no hay token con el que enviarla.
    if (!who) return null;
    var own = stampOf(head.operation_id), verdict;
    // Mismo aparato y mismo ROL (validado por /auth/me) => se envía sola con el token nuevo aunque la sesión
    // sea otra; cambio dueño <-> empleado => revisión del dueño.
    try { verdict = typeof canonical.identityCheck === 'function' ? canonical.identityCheck(own ? { key: own.key, user: own.user || null } : null, { command: 'sale.create' })
      : own && own.key === who.key ? 'same' : 'other'; } catch (_) { verdict = 'other'; }
    if (verdict === 'same') { if (!own) { try { stamp(head.operation_id, who, { legacy: true, adopted_at_upgrade: upgradeAt(canonical) }); } catch (_) {} } return null; }
    if (verdict === 'wait') return 'IDENTITY_UNCONFIRMED';
    if (!own && root.console) root.console.warn('[Venta CANON] venta antigua de otro rol: queda en revisión', head.sale_id);
    return own ? 'identity_changed' : 'identity_unverified';
  }
  // Mismo contenido comercial (no solo los mismos ids): sale_id, fecha, medio, total, pago, cliente,
  // caja e ítems. Sirve para comparar con el cuerpo del recibo local o con la venta de la réplica.
  function saleContent(x) {
    if (!x) return null;
    var p = x.payment || {};
    return JSON.stringify({ sale_id: x.sale_id || x.id || null, payment_method: x.payment_method || null, total_cents: x.total_cents,
      payment: [p.cash_cents || 0, p.digital_cents || 0, p.credit_cents || 0, p.digital_method || null, p.reference || ''],
      customer_id: x.customer_id == null ? null : String(x.customer_id), session_id: x.session_id == null ? null : String(x.session_id),
      items: (x.items || []).map(function (i) { return [String(i.product_id), Number(i.quantity), Number(i.unit_price_cents)]; }) });
  }
  function sameAsReceipt(canonical, head) {
    if (typeof canonical.receiptPayloadSnapshot !== 'function') return true; // cliente antiguo: solo ids
    var body = null; try { body = canonical.receiptPayloadSnapshot(); } catch (_) { body = null; }
    if (!body) return true;
    return saleContent(body) === saleContent(head) && body.created_at === head.created_at;
  }
  // Venta de la réplica que el servidor devuelve: solo se comparan los campos que trae.
  function sameRemote(sale, intent) {
    if ((sale.sale_id || sale.id) !== intent.sale_id) return false;
    return sameRemoteAmount(sale, intent);
  }
  // Solo importe y medio (el número puede haber cambiado por una renumeración de la misma venta).
  function sameRemoteAmount(sale, intent) {
    if (sale.total_cents !== undefined && sale.total_cents !== null && Number(sale.total_cents) !== Number(intent.total_cents)) return false;
    if (sale.payment_method && intent.payment_method && String(sale.payment_method) !== String(intent.payment_method)) return false;
    return true;
  }
  var sessionNoticeAt = 0;
  function notifySystemHold(reason, remaining) {
    var now = Date.now();
    if (now - sessionNoticeAt < 60000) return;
    sessionNoticeAt = now;
    var runtime = root.NuevoAmanecerCanonicalUIAdapter && root.NuevoAmanecerCanonicalUIAdapter.runtime;
    if (!runtime || typeof runtime.notify !== 'function') return;
    var auth = ['unauthorized', 'session_revoked', 'HTTP_401', 'HTTP_403', 'read_only_session'].indexOf(reason) !== -1;
    runtime.notify((auth ? 'Sesión vencida: vuelve a iniciar sesión. ' : 'CANON no acepta ventas en este momento (' + reason + '). ') +
      remaining + (remaining === 1 ? ' venta espera' : ' ventas esperan') + ' guardada' + (remaining === 1 ? '' : 's') + ' en este equipo; ' + (auth ? (remaining === 1 ? 'se enviará sola' : 'se enviarán solas') + ' al volver a entrar con el mismo rol (dueño o empleado).' : (remaining === 1 ? 'se enviará sola.' : 'se enviarán solas.')), 'error');
  }
  async function holdForSystem(canonical, head, pending) {
    var reason = String(pending.last_error);
    var holds = readHolds();
    var promotion = pending.binding && pending.binding.promotion_id || (pending.payload && pending.payload.promotion_id) || null;
    if (!holds[head.operation_id] && promotion) { holds[head.operation_id] = { promotion_id: promotion, reason: reason, at: new Date().toISOString() }; writeHolds(holds); }
    var released = false;
    if (typeof canonical.releaseRejectedSaleJournal === 'function') {
      try { released = await canonical.releaseRejectedSaleJournal(head.operation_id); } catch (_) { released = false; }
    }
    notifySystemHold(reason, parseStored().intents.length);
    return released;
  }
  // Another command (cash, payment, inventory...) occupies the single journal.
  // Lost ACK or 429/5xx: replay the SAME operation_id. Definitive 4xx: the
  // client archives it (no commit happened) so sales keep flowing.
  var expiredSession = null;
  function credentialKey() {
    try { var c = root.NuevoAmanecerCanonical, who = c && typeof c.sessionIdentity === 'function' ? c.sessionIdentity() : null; return who ? who.key : 'sin-sesion'; } catch (_) { return null; }
  }
  function sessionExpired() { return !!expiredSession && expiredSession === credentialKey(); }
  // Motivo legible de la espera por sesión: el error que quedó en el journal DESPUÉS del intento.
  function sessionReason(canonical, before) {
    var now = null; try { now = canonical.pendingSnapshot(); } catch (_) {}
    var code = (now && now.last_error) || (before && before.last_error) || 'unauthorized';
    return 'SESSION_' + String(code);
  }
  async function settleForeignPending(canonical, pending) {
    // A sale journal for another operation is never touched from here.
    if (!pending || pending.command === 'sale.create') return false;
    // Un cierre de caja sin confirmar NUNCA se reenvía solo: el cajero debe volver a confirmarlo en Caja.
    if (pending.command === 'cash.close') return false;
    // T-10: abono/gasto/caja con la sesión vencida: se conserva (nunca se archiva como rechazado), se
    // avisa una vez y no se reintenta en bucle; se reenvía igual cuando cambie la credencial guardada.
    if (pending.last_error && systemRejection(pending) && pending.auth_failed_identity !== undefined) {
      var auth = await replayAfterLogin(canonical, pending);
      return auth === 'replayed' || auth === 'moved' ? true : 'SESSION';
    }
    if (!pending.last_error || pending.last_status === 429 || pending.last_status >= 500) {
      try { await canonical.retryPending(); return true; } catch (_) {
        var after = canonical.pendingSnapshot();
        // El reintento recibió 401/403 de sesión en la verificación previa: avisar y esperar, sin bucle.
        if (after && after.last_error && systemRejection(after) && after.auth_failed_identity !== undefined) {
          notifySystemHold(String(after.last_error), (function () { try { return parseStored().intents.length; } catch (_) { return 0; } })());
          return 'SESSION';
        }
        // Apartado por identidad (otra sesión) o ya resuelto: el journal quedó libre.
        if (!after || !after.payload || !pending.payload || after.payload.operation_id !== pending.payload.operation_id) return true;
        return false;
      }
    }
    if (typeof canonical.releaseRejectedFinancial !== 'function') return false;
    try { return !!(await canonical.releaseRejectedFinancial(pending.payload && pending.payload.operation_id)); } catch (_) { return false; }
  }
  // 'replayed' = se reenvió el mismo registro; 'moved' = el journal ya no es ese registro (confirmado o
  // apartado por identidad); 'session' = sigue la misma credencial vencida: aviso y espera.
  async function replayAfterLogin(canonical, pending) {
    var who = currentIdentity(canonical), op = pending.payload && pending.payload.operation_id;
    if (!who || !pending.auth_failed_identity || who.key === pending.auth_failed_identity) {
      notifySystemHold(String(pending.last_error), (function () { try { return parseStored().intents.length; } catch (_) { return 0; } })());
      return 'session';
    }
    try { await canonical.retryPending(); return 'replayed'; }
    catch (_) {
      var after = canonical.pendingSnapshot();
      if (!after || !after.payload || after.payload.operation_id !== op) return 'moved';
      return 'session';
    }
  }
  function result(status, processed, remaining, reason, head) {
    var out = { status: status, processed: processed, remaining: remaining };
    if (reason) out.reason = reason;
    if (head) { out.sale_id = head.sale_id; out.operation_id = head.operation_id; }
    // Only sale-specific rejections are 'held for review'; system/session
    // reasons keep the sale in the queue and must not claim CANON rejected it.
    if (status === 'BLOCKED_PENDING_REJECTED' && head && (SALE_REJECTIONS.indexOf(reason) !== -1 || DETERMINISTIC.indexOf(reason) !== -1)) notifyReview(head, reason);
    return out;
  }
  // Tell the cashier once per operation_id (durable across reloads) that a
  // locally registered sale was rejected and is held for review. Never advise
  // charging again: the intent and its journal are preserved.
  var REVIEW_KEY = KEY + '_review_notified';
  function notifyReview(head, reason, detail) {
    var seen = [];
    try { seen = JSON.parse(root.localStorage.getItem(REVIEW_KEY) || '[]'); if (!Array.isArray(seen)) seen = []; } catch (_) { seen = []; }
    if (seen.indexOf(head.operation_id) !== -1) return;
    try { root.localStorage.setItem(REVIEW_KEY, JSON.stringify(seen.concat([head.operation_id]).slice(-200))); } catch (_) {}
    var runtime = root.NuevoAmanecerCanonicalUIAdapter && root.NuevoAmanecerCanonicalUIAdapter.runtime;
    if (runtime && typeof runtime.notify === 'function') runtime.notify('Venta ' + head.sale_id + ' en revisión: ' + reasonText(reason, detail) +
      '. No la cobres de nuevo y no entregues el crédito hasta resolverla en Caja › Ventas en revisión. Las demás ventas siguen funcionando.', 'error');
  }
  // Server-side proof only: the refreshed replica already holds this exact
  // operation_id + sale_id. Missing API or failed refresh = not proven.
  async function confirmedRemotely(canonical, head) {
    if (typeof canonical.snapshot !== 'function' || typeof canonical.discardRejectedSale !== 'function') return false;
    try { await canonical.refresh(); } catch (_) { return false; }
    if (typeof canonical.sourceState === 'function') {
      var state = canonical.sourceState();
      if (!state || state.validation !== 'current') return false;
    }
    var sales = (canonical.snapshot() || {}).sales || [];
    // Mismo operation_id y mismo contenido visible (número, total, medio): otro contenido con el mismo id es un conflicto, no una confirmación.
    return sales.some(function (sale) { return sale.operation_id === head.operation_id && sameRemote(sale, head); });
  }
  async function syncLocked() {
    var processed = 0, refreshedFor = {}, renumbered = {};
    while (true) {
      var current = parseStored();
      if (!current.intents.length) return result(processed ? 'DRAINED' : 'EMPTY', processed, 0);
      var head = current.intents[0];
      if (quarantinedOperation(head.operation_id)) {
        // Crash between the quarantine copy and the FIFO removal: finish it.
        var stillOwn = root.NuevoAmanecerCanonical && typeof root.NuevoAmanecerCanonical.pendingSnapshot === 'function' && root.NuevoAmanecerCanonical.pendingSnapshot();
        if (!stillOwn || !stillOwn.payload || stillOwn.payload.operation_id !== head.operation_id) { await removeHead(head); continue; }
      }
      if (current.intents.some(function (item, index) { return index > 0 && item.sale_id === head.sale_id; }))
        return result('BLOCKED_DUPLICATE_SALE_ID', processed, current.intents.length, 'DUPLICATE_SALE_ID');
      var canonical = root.NuevoAmanecerCanonical;
      if (!canonical || typeof canonical.receiptSnapshot !== 'function' || typeof canonical.pendingSnapshot !== 'function' || typeof canonical.refresh !== 'function' || typeof canonical.createSale !== 'function' || typeof canonical.retryPending !== 'function') fail('CANONICAL_API_UNAVAILABLE');
      var receipt = canonical.receiptSnapshot();
      if (matching(receipt, head)) {
        // T-03: mismo operation_id y número pero otro contenido: es un conflicto, nunca «ya confirmada».
        if (!sameAsReceipt(canonical, head)) {
          if (await quarantineHead(canonical, head, 'operation_id_conflict', 409)) continue;
          return result('BLOCKED_PENDING_REJECTED', processed, current.intents.length, 'operation_id_conflict', head);
        }
        await removeHead(head); clearHold(head.operation_id); processed += 1; continue;
      }
      // T-47: antes de tocar la red, la venta debe ser de la sesión actual.
      var identityReason = identityProblem(canonical, head);
      // Otra huella pero la sesión guardada aún no se puede comparar (sin /auth/me): esperar, sin enviar.
      if (identityReason === 'IDENTITY_UNCONFIRMED') return result('WAITING', processed, current.intents.length, 'SESSION_IDENTITY_UNCONFIRMED', head);
      if (identityReason) {
        if (await quarantineHead(canonical, head, identityReason, null)) continue;
        return result('WAITING', processed, parseStored().intents.length, 'IDENTITY_HELD', head);
      }
      var pending = canonical.pendingSnapshot();
      if (pending) {
        var payload = pending.payload;
        if (pending.command !== 'sale.create' || !payload || payload.operation_id !== head.operation_id || payload.sale_id !== head.sale_id) {
          // Never let a cash/payment/inventory command freeze the sales queue.
          var settled = await settleForeignPending(canonical, pending);
          if (settled === 'SESSION') return result('WAITING', processed, current.intents.length, sessionReason(canonical, pending));
          if (settled) continue;
          return result('BLOCKED_FOREIGN_PENDING', processed, current.intents.length, 'FOREIGN_PENDING');
        }
        if (pending.last_error && (pending.last_status === 429 || pending.last_status >= 500)) {
          // A 429/5xx is not evidence that the sale did not commit. The
          // previous acknowledgement may be lost: retry only the exact
          // durable operation_id and rely on the server idempotency contract.
          try { await canonical.retryPending(); }
          catch (error) {
            var afterTransient = canonical.pendingSnapshot();
            // The replay itself was answered with a definitive 4xx: handle it.
            if (afterTransient && afterTransient.last_error && afterTransient.last_status !== 429 && afterTransient.last_status < 500 &&
                afterTransient.payload && afterTransient.payload.operation_id === head.operation_id) continue;
            return result('WAITING', processed, current.intents.length,
              String(error && (error.code || error.message) || 'RETRY_FAILED'));
          }
          if (!matching(canonical.receiptSnapshot(), head))
            return result('WAITING', processed, current.intents.length, 'RECEIPT_NOT_CONFIRMED');
          await removeHead(head); clearHold(head.operation_id); processed += 1; continue;
        }
        if (pending.last_error && systemRejection(pending) && pending.auth_preflight) {
          // T-10: 401/403 de sesión en la verificación previa: el POST pudo haber salido antes (ACK
          // perdido), así que el journal NO se libera. Se avisa «Sesión vencida» y se reenvía el MISMO
          // registro una sola vez cuando haya otra credencial guardada.
          var auth = await replayAfterLogin(canonical, pending);
          if (auth === 'replayed') {
            if (matching(canonical.receiptSnapshot(), head)) { await removeHead(head); clearHold(head.operation_id); processed += 1; continue; }
            continue;
          }
          if (auth === 'moved') continue;
          return result('WAITING', processed, current.intents.length, sessionReason(canonical, pending), head);
        }
        if (pending.last_error && systemRejection(pending)) {
          // 401/403/stale_authority/canonical_not_active: a 4xx before commit.
          // Free the journal, keep the intent queued (same operation_id) and
          // wait for a new session/binding instead of jamming forever.
          var held = await holdForSystem(canonical, head, pending);
          return result('WAITING', processed, parseStored().intents.length, held ? sessionReason(canonical, pending) : String(pending.last_error), head);
        }
        if (pending.last_error) {
          // Safe sale rejects (409/400) prove no D1 commit.
          var rejectReason = String(pending.last_error);
          var recoverable = rejectReason === 'stale_stock' || rejectReason === 'stock_revision_conflict';
          if (rejectReason === 'sale_id_conflict' && (renumbered[head.operation_id] || 0) < 3 && typeof canonical.discardRejectedSale === 'function') {
            var freed = false;
            try { freed = await canonical.discardRejectedSale(); } catch (_) { freed = false; }
            if (freed) {
              renumbered[head.operation_id] = (renumbered[head.operation_id] || 0) + 1;
              try { await renumberHead(canonical, head); } catch (error) { return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'RENUMBER_FAILED'), head); }
              continue;
            }
          }
          if (!recoverable) {
            // Only a server-side record of this exact operation_id settles it
            // as done; otherwise it moves to the durable review list (which
            // keeps blocking cash close) and the rest of the queue continues.
            // T-03: un 409 operation_id_conflict nunca se da por confirmado: va a revisión como conflicto.
            if (rejectReason !== 'operation_id_conflict' && await confirmedRemotely(canonical, head)) {
              var cleared = false;
              try { cleared = await canonical.discardRejectedSale(); } catch (_) { cleared = false; }
              if (!cleared) return result('BLOCKED_PENDING_REJECTED', processed, current.intents.length, rejectReason, head);
              await removeHead(head); clearHold(head.operation_id); processed += 1; continue;
            }
            if ((SALE_REJECTIONS.indexOf(rejectReason) !== -1 || definitive(pending)) && await quarantineHead(canonical, head, rejectReason, pending.last_status)) continue;
            return result('BLOCKED_PENDING_REJECTED', processed, current.intents.length, rejectReason, head);
          }
          var discarded = false;
          if (typeof canonical.discardRejectedSale === 'function') {
            try { discarded = await canonical.discardRejectedSale(); } catch (_) { discarded = false; }
          }
          if (!discarded) return result('BLOCKED_PENDING_REJECTED', processed, current.intents.length, rejectReason, head);
          try {
            // One fresh read, then one retry with the new revision (same operation_id).
            await canonical.refresh();
            await canonical.createSale(head);
          } catch (error) {
            var afterRetry = canonical.pendingSnapshot();
            if (afterRetry && afterRetry.command === 'sale.create' && afterRetry.payload &&
                afterRetry.payload.operation_id === head.operation_id && afterRetry.payload.sale_id === head.sale_id && afterRetry.last_error) {
              if (afterRetry.last_status === 429 || afterRetry.last_status >= 500)
                return result('WAITING', processed, parseStored().intents.length, String(afterRetry.last_error), head);
              var again = String(afterRetry.last_error);
              // Second stock failure on a fresh read: the units are not there.
              // Move it to review and free the journal; never block other sales.
              if ((again === 'stale_stock' || again === 'stock_revision_conflict' || again === 'insufficient_stock') && definitive(afterRetry)) {
                if (await quarantineHead(canonical, head, again === 'stock_revision_conflict' ? 'stale_stock' : again, afterRetry.last_status)) continue;
                return result('BLOCKED_PENDING_REJECTED', processed, parseStored().intents.length, again, head);
              }
              // Anything else is handled by the generic branch on the next turn.
              continue;
            }
            return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'CREATE_UNACKNOWLEDGED'));
          }
          if (!matching(canonical.receiptSnapshot(), head)) return result('WAITING', processed, parseStored().intents.length, 'RECEIPT_NOT_CONFIRMED');
          await removeHead(head); clearHold(head.operation_id); processed += 1; continue;
        }
        // PENDING without error: lost ACK or timeout. Replay the same operation_id.
        try { await canonical.retryPending(); } catch (error) {
          var afterReplay = canonical.pendingSnapshot();
          if (afterReplay && afterReplay.last_error && afterReplay.payload && afterReplay.payload.operation_id === head.operation_id &&
              afterReplay.last_status !== 429 && afterReplay.last_status < 500) continue;
          return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'RETRY_FAILED'));
        }
        if (!matching(canonical.receiptSnapshot(), head)) return result('WAITING', processed, parseStored().intents.length, 'RECEIPT_NOT_CONFIRMED');
        await removeHead(head); clearHold(head.operation_id); processed += 1; continue;
      }
      var hold = readHolds()[head.operation_id];
      if (hold) {
        // Bound to a promotion that is no longer active: the owner decides.
        var snap = typeof canonical.snapshot === 'function' ? canonical.snapshot() || {} : {};
        var replicaNow = typeof canonical.sourceState === 'function' ? canonical.sourceState() : null;
        if (snap.promotion_id && hold.promotion_id && snap.promotion_id !== hold.promotion_id && replicaNow && replicaNow.validation === 'current') {
          if (await quarantineHead(canonical, head, 'promotion_changed', 409)) continue;
          return result('BLOCKED_PENDING_REJECTED', processed, current.intents.length, 'promotion_changed', head);
        }
      }
      try {
        // createSale() owns freshness. With a current replica it can go straight
        // to the guarded POST; if the replica is stale it refreshes itself.
        // Do not force a full multi-collection refresh in front of every sale.
        await canonical.createSale(head);
      } catch (error) {
        var afterFailure = canonical.pendingSnapshot();
        if (afterFailure && afterFailure.command === 'sale.create' && afterFailure.payload && afterFailure.payload.operation_id === head.operation_id && afterFailure.payload.sale_id === head.sale_id) {
          // Safe 409/400 rejects leave last_error; loop again so the branch
          // above handles it in this same pass instead of freezing.
          if (afterFailure.last_error) {
            // Do not immediately replay an uncertain 429/5xx inside the same
            // drain pass: let the bounded backoff schedule the next safe retry.
            if (afterFailure.last_status === 429 || afterFailure.last_status >= 500)
              return result('WAITING', processed, parseStored().intents.length, String(afterFailure.last_error));
            continue;
          }
          return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'CREATE_UNACKNOWLEDGED'));
        }
        if (afterFailure && (afterFailure.command !== 'sale.create' || !afterFailure.payload || afterFailure.payload.operation_id !== head.operation_id || afterFailure.payload.sale_id !== head.sale_id)) {
          var settledAfter = await settleForeignPending(canonical, afterFailure);
          if (settledAfter === 'SESSION') return result('WAITING', processed, parseStored().intents.length, sessionReason(canonical, afterFailure));
          if (settledAfter) continue;
          return result('BLOCKED_FOREIGN_PENDING', processed, parseStored().intents.length, 'FOREIGN_PENDING');
        }
        var failureCode = String(error && (error.code || error.message) || '');
        if (!afterFailure && /^CANONICAL_READ_40[13]$/.test(failureCode)) {
          notifySystemHold(failureCode === 'CANONICAL_READ_401' ? 'HTTP_401' : 'HTTP_403', parseStored().intents.length);
          return result('WAITING', processed, parseStored().intents.length, 'SESSION_' + failureCode, head);
        }
        if (!afterFailure && failureCode === 'CANONICAL_IDENTITY_UNCONFIRMED') return result('WAITING', processed, parseStored().intents.length, 'SESSION_IDENTITY_UNCONFIRMED', head);
        if (!afterFailure && DETERMINISTIC.indexOf(failureCode) !== -1 && typeof canonical.sourceState === 'function') {
          // The replica may simply be behind: refresh once and try again. Only a
          // second identical failure on a current replica moves it aside.
          if (!refreshedFor[head.operation_id]) {
            refreshedFor[head.operation_id] = true;
            try { await canonical.refresh(); } catch (_) { return result('WAITING', processed, parseStored().intents.length, failureCode, head); }
            continue;
          }
          var replica = canonical.sourceState();
          if (replica && replica.validation === 'current' && await quarantineHead(canonical, head, failureCode, null)) continue;
        }
        return result('WAITING', processed, parseStored().intents.length, String(error && (error.code || error.message) || 'CREATE_FAILED'));
      }
      if (!matching(canonical.receiptSnapshot(), head)) return result('WAITING', processed, parseStored().intents.length, 'RECEIPT_NOT_CONFIRMED');
      await removeHead(head); clearHold(head.operation_id); processed += 1;
    }
  }
  var syncing = null;
  var started = false;
  var retryTimer = null;
  var retryCount = 0;
  var resumeOutbox = null;
  var resuming = false;
  function scheduleResume() {
    if (!started || retryTimer !== null || root.navigator.onLine === false || typeof root.setTimeout !== 'function') return;
    // Do not abandon durable sales after three failures. Retry at a bounded
    // rate while the page is alive, without creating new operation IDs.
    var delay = Math.min(60000, 1000 * Math.pow(2, Math.min(retryCount, 6)));
    retryCount = Math.min(retryCount + 1, 7);
    retryTimer = root.setTimeout(function () { retryTimer = null; return resumeOutbox(); }, delay);
  }
  // P1-B / P1-4: the receipt is projected locally (stock, sale view), so the
  // full server reconciliation is deferred until the queue is idle. It never
  // runs ahead of (or delays) a queued POST, and it repeats if a sale was
  // confirmed while it was reading, so its replica is never older than a POST.
  var RECONCILE_DELAY_MS = 1500, reconcileTimer = null, reconciling = false, confirmedSince = 0;
  function scheduleReconcile() {
    if (reconcileTimer !== null || typeof root.setTimeout !== 'function') return;
    reconcileTimer = root.setTimeout(function () { reconcileTimer = null; reconcileWhenIdle(); }, RECONCILE_DELAY_MS);
  }
  async function reconcileWhenIdle() {
    var canonical = root.NuevoAmanecerCanonical;
    if (!canonical || typeof canonical.refresh !== 'function') return;
    var pending = 0;
    try { pending = snapshot().intents.length; } catch (_) { pending = 0; }
    // A queued sale reschedules this itself when its drain confirms something;
    // never poll while the queue is blocked.
    if (pending) return;
    if (reconciling || syncing) { scheduleReconcile(); return; }
    reconciling = true;
    var mark = confirmedSince;
    try { await canonical.refresh(); }
    catch (error) { if (root.console) root.console.warn('[Venta CANON] Confirmada; reconciliación pendiente', error.code || error.message); }
    finally { reconciling = false; }
    if (confirmedSince !== mark) scheduleReconcile();
  }
  async function sync() {
    if (syncing) return result('WAITING', 0, snapshot().intents.length, 'BUSY');
    syncing = (async function () {
      try {
        var outcome = await withLock(syncLocked);
        // Receipt is already durable and the confirmed intent has been removed.
        // Return the commercial path immediately; reconciliation starts now but
        // is never allowed to hold the sale UI after the durable receipt.
        if (outcome.processed > 0) { confirmedSince++; scheduleReconcile(); }
        if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('na:canonical-sale-projection'));
        // T-10: con la sesión vencida no se reintenta en bucle: se reanuda al cambiar la credencial
        // guardada, al confirmarse el rol, al volver la red o al volver a la app.
        var sessionWait = outcome.status === 'WAITING' && /^SESSION_/.test(String(outcome.reason || ''));
        // La franja dice «sesión vencida» (no «reintentando») mientras siga guardada la misma sesión.
        expiredSession = sessionWait && outcome.reason !== 'SESSION_IDENTITY_UNCONFIRMED' ? credentialKey() : null;
        if (!sessionWait && ((outcome.status === 'WAITING' && outcome.reason !== 'BUSY') || outcome.status === 'BLOCKED_FOREIGN_PENDING')) scheduleResume();
        else if (outcome.status === 'DRAINED' || outcome.status === 'EMPTY') retryCount = 0;
        return outcome;
      }
      catch (error) {
        if (error && error.code === 'BUSY') {
          scheduleResume();
          return result('WAITING', 0, snapshot().intents.length, 'BUSY');
        }
        throw error;
      }
    })();
    try { return await syncing; } finally { syncing = null; }
  }
  // `before` corre dentro del mismo candado, antes de enviar ventas: resuelve un cierre anterior pendiente
  // consultando al servidor. Si la caja YA está cerrada, las ventas de esa caja que siguen en la cola NO se
  // mueven a otra caja ni se borran: pasan a la lista de revisión y se devuelven con su monto.
  async function withCashCloseBarrier(close, before) {
    if (typeof close !== 'function') fail('INVALID_CASH_CLOSE_CALLBACK');
    return withLock(async function () {
      var pre = typeof before === 'function' ? await before() : null;
      if (pre && pre.closedSession) {
        var sid = pre.closedSession.session_id, canonical = root.NuevoAmanecerCanonical, leftOut = [];
        var closedAt = Date.parse(pre.closedSession.closed_at || '') || Date.now();
        // De esa caja: la venta lleva su session_id, o no lleva caja y se hizo antes del cierre real.
        var ofClosed = function (x) { return x && (x.session_id ? String(x.session_id) === String(sid) : (Date.parse(x.created_at || '') || 0) <= closedAt); };
        while (true) {
          var cur = parseStored().intents, head = cur[0];
          if (!head || !ofClosed(head)) break;
          leftOut.push({ sale_id: head.sale_id, total_cents: Number(head.total_cents || 0), operation_id: head.operation_id });
          if (!(await quarantineHead(canonical, head, 'cash_closed_before_sale', 409))) break;
        }
        parseStored().intents.forEach(function (x) {
          if (ofClosed(x) && !leftOut.some(function (l) { return l.operation_id === x.operation_id; }))
            leftOut.push({ sale_id: x.sale_id, total_cents: Number(x.total_cents || 0), operation_id: x.operation_id, queued: true });
        });
        return { status: 'CLOSED', session: pre.closedSession, left_out: leftOut, receipt: pre.receipt || null };
      }
      var outcome = await syncLocked();
      if (snapshot().intents.length) return holdStore(function () { return closeChecks(outcome, close); });
      var held = blockingQuarantine();
      if (held.length) {
        var canonical = root.NuevoAmanecerCanonical, confirmedIds = [];
        for (var i = 0; i < held.length; i++) {
          if (canonical && await confirmedRemotely(canonical, held[i].intent)) confirmedIds.push(held[i].intent.operation_id);
        }
        if (confirmedIds.length) await withStore(function () {
          var q = readQuarantine();
          q.entries.forEach(function (entry) {
            if (entry.status === 'QUARANTINED' && confirmedIds.indexOf(entry.intent.operation_id) !== -1) { entry.status = 'CONFIRMED_REMOTE'; entry.resolved_at = new Date().toISOString(); }
          });
          writeQuarantine(q);
        });
      }
      // enqueue writes under STORE_LOCK: keep it until the close ACK (or
      // uncertainty) so no durable sale is stranded in the gap.
      return holdStore(function () { return closeChecks(outcome, close); });
    });
  }
  function closeChecks(outcome, close) {
      var left = snapshot().intents;
      if (left.length) {
        var blocked = new Error('CASH_CLOSE_PENDING_SALES');
        blocked.code = 'CASH_CLOSE_PENDING_SALES';
        blocked.sale_id = outcome.sale_id || left[0].sale_id;
        blocked.operation_id = outcome.operation_id || left[0].operation_id;
        blocked.reason = outcome.reason || outcome.status;
        blocked.remaining = left.length;
        throw blocked;
      }
      var held = blockingQuarantine();
      if (held.length) {
        var review = new Error('CASH_CLOSE_QUARANTINED_SALES');
        review.code = 'CASH_CLOSE_QUARANTINED_SALES';
        review.sale_id = held[0].intent.sale_id;
        review.operation_id = held[0].intent.operation_id;
        review.reason = held[0].reason;
        review.remaining = held.length;
        review.cash_cents = held.reduce(function (sum, entry) { return sum + cashOf(entry.intent); }, 0);
        throw review;
      }
      return close(outcome.processed);
  }
  function openCashSession(canonical) {
    var snap = canonical && typeof canonical.snapshot === 'function' ? canonical.snapshot() || {} : {};
    var open = (snap.cashSessions || []).filter(function (item) { return item && item.status === 'OPEN' && item.session_id; });
    return open.length === 1 ? clone(open[0]) : null;
  }
  async function resolveQuarantined(operationId, action, meta) {
    return withLock(async function () {
      var q = readQuarantine();
      var entry = q.entries.find(function (item) { return item.status === 'QUARANTINED' && item.intent.operation_id === operationId; });
      if (!entry) fail('QUARANTINE_ENTRY_NOT_FOUND');
      var canonical = root.NuevoAmanecerCanonical;
      if (action === 'verify') {
        if (!canonical || typeof canonical.snapshot !== 'function') fail('CANONICAL_API_UNAVAILABLE');
        if (await confirmedRemotely(canonical, entry.intent)) {
          entry.status = 'CONFIRMED_REMOTE'; entry.resolved_at = new Date().toISOString(); writeQuarantine(q);
          return { status: 'CONFIRMED_REMOTE', sale_id: entry.intent.sale_id, operation_id: operationId };
        }
        var replica = typeof canonical.sourceState === 'function' ? canonical.sourceState() : null;
        if (!replica || replica.validation !== 'current') fail('QUARANTINE_REMOTE_NOT_VERIFIED');
        // Absence is proven by operation_id alone: a server row with the same
        // operation_id under another sale number is the same sale, never "absent".
        var twin = ((canonical.snapshot() || {}).sales || []).find(function (sale) { return sale.operation_id === operationId; });
        // T-03: con un conflicto de operation_id, el servidor tiene OTRO contenido con ese id: no se concilia sola.
        if (twin && entry.reason === 'operation_id_conflict' && !sameRemoteAmount(twin, entry.intent)) {
          entry.remote_conflict_at = new Date().toISOString(); entry.remote_sale_id = twin.sale_id || twin.id; writeQuarantine(q);
          return { status: 'CONFLICT', sale_id: entry.intent.sale_id, remote_sale_id: entry.remote_sale_id, operation_id: operationId };
        }
        if (twin) {
          entry.status = 'CONFIRMED_REMOTE'; entry.remote_sale_id = twin.sale_id || twin.id; entry.resolved_at = new Date().toISOString(); writeQuarantine(q);
          return { status: 'CONFIRMED_REMOTE', sale_id: entry.intent.sale_id, remote_sale_id: entry.remote_sale_id, operation_id: operationId };
        }
        entry.verified_absent_at = new Date().toISOString(); writeQuarantine(q);
        return { status: 'NOT_REGISTERED', sale_id: entry.intent.sale_id, operation_id: operationId };
      }
      if (action === 'retry') {
        if (!retryable(entry.reason)) fail('QUARANTINE_RETRY_NOT_SAFE');
        // Same operation_id: the Worker answers already_processed if it ever
        // committed, so a retry can never charge twice. For a till that was
        // closed, retrying is the owner's explicit choice to register the
        // charged sale in the till that is open now.
        var again = clone(entry.intent);
        if (REBIND_ON_RETRY.indexOf(entry.reason) !== -1) {
          // Etapa 1.3 (auditoría 2026-10-12): nunca re-asignar en silencio. El
          // dueño debe confirmar la caja destino exacta (la única OPEN en CANON)
          // y queda registrado de qué caja venía y a cuál entró.
          var target = openCashSession(canonical);
          if (!target) fail('QUARANTINE_REBIND_NO_OPEN_CASH');
          if (!meta || meta.targetSessionId !== target.session_id) fail('QUARANTINE_REBIND_NEEDS_CONFIRMATION');
          entry.rebound_from_session_id = entry.intent.session_id || null;
          entry.rebound_to_session_id = target.session_id;
          entry.rebound_by = meta.by != null ? String(meta.by) : null;
          again.session_id = target.session_id; again = validateIntent(again);
        }
        if (entry.reason === 'expired_lots_not_allowed' || entry.reason === 'expired_lot_approval_required') {
          // The server keeps requiring toggle + owner PIN for this operation_id.
          var approvalId = meta && meta.expiredLotApproval;
          if (typeof approvalId !== 'string' || !approvalId) fail('QUARANTINE_EXPIRED_NEEDS_PIN');
          again.items.forEach(function (line) { if (!line.generic_line) { line.allow_expired_lots = true; line.expired_lot_approval = approvalId; } });
          again = validateIntent(again);
        }
        if (entry.reason === 'promotion_changed') clearHold(operationId);
        var adopt = null;
        if (IDENTITY_REASONS.indexOf(entry.reason) !== -1) {
          // Solo el dueño: confirmado en esta sesión, o con su PIN (aprobación del servidor en meta.ownerApproval).
          var roles = root.NA_ROLES, owner = false;
          try { owner = !!(roles && roles.confirmed && typeof roles.isOwner === 'function' && roles.isOwner()); } catch (_) { owner = false; }
          if (!owner && !(meta && typeof meta.ownerApproval === 'string' && meta.ownerApproval)) fail('QUARANTINE_IDENTITY_NEEDS_OWNER');
          adopt = currentIdentity(canonical);
          if (!adopt) fail('SESSION_NOT_AVAILABLE');
          // La venta vuelve EXACTAMENTE igual (mismo operation_id, mismo contenido); solo cambia la sesión que la envía.
          again = clone(entry.intent);
          // Si ya tenía journal (pudo llegar al servidor), se reenvía ESE cuerpo exacto, no uno nuevo.
          if (entry.journal) {
            if (typeof canonical.adoptSaleJournal !== 'function') fail('CANONICAL_API_UNAVAILABLE');
            await canonical.adoptSaleJournal(entry.journal);
          }
          entry.approved_identity = adopt.key; entry.approved_from = entry.identity ? entry.identity.key : null;
          entry.approved_by = meta && meta.by != null ? String(meta.by) : (adopt.principal || null);
        }
        await withStore(function () {
          var current = parseStored();
          if (adopt) stamp(operationId, adopt, { approved_from: entry.approved_from, approved_at: new Date().toISOString() });
          else if (entry.identity && entry.identity.key) { var ids = readIdentities(); ids[operationId] = clone(entry.identity); writeIdentities(ids); }
          if (!current.intents.some(function (item) { return item.operation_id === operationId; })) { current.intents.push(again); write(current); }
          entry.status = 'REQUEUED'; entry.resolved_at = new Date().toISOString(); writeQuarantine(q);
        });
        return { status: 'REQUEUED', sale_id: entry.intent.sale_id, operation_id: operationId };
      }
      if (action === 'archive') {
        if (!canonical || typeof canonical.snapshot !== 'function') fail('CANONICAL_API_UNAVAILABLE');
        if (await confirmedRemotely(canonical, entry.intent)) {
          entry.status = 'CONFIRMED_REMOTE'; entry.resolved_at = new Date().toISOString(); writeQuarantine(q);
          return { status: 'CONFIRMED_REMOTE', sale_id: entry.intent.sale_id, operation_id: operationId };
        }
        if (CONFLICTS.indexOf(entry.reason) !== -1) fail('QUARANTINE_CONFLICT_NEEDS_SERVER_CHECK');
        if (NEVER_ANNUL.indexOf(entry.reason) !== -1) fail('QUARANTINE_CHARGED_SALE_NOT_ANNULLABLE');
        if (!entry.verified_absent_at) fail('QUARANTINE_VERIFY_FIRST');
        if (!annullable(entry, canonical)) fail('QUARANTINE_ANNUL_NEEDS_PROMOTION_PROOF');
        var state = typeof canonical.sourceState === 'function' ? canonical.sourceState() : null;
        if (!state || state.validation !== 'current') fail('QUARANTINE_REMOTE_NOT_VERIFIED');
        if (((canonical.snapshot() || {}).sales || []).some(function (sale) { return sale.operation_id === operationId; })) fail('QUARANTINE_OPERATION_EXISTS_ON_SERVER');
        entry.status = 'ARCHIVED_NO_CHARGE'; entry.resolved_at = new Date().toISOString(); entry.resolved_by = meta && meta.by != null ? String(meta.by) : null; writeQuarantine(q);
        return { status: 'ARCHIVED_NO_CHARGE', sale_id: entry.intent.sale_id, operation_id: operationId };
      }
      if (action === 'discard') {
        // SPEC-885 §6: una venta apartada por 409 operation_id_conflict (su id ya existe en OTRO registro del
        // servidor, p. ej. un gasto) nunca se aplicó en el servidor y Reintentar volvería a chocar. El dueño la
        // descarta: queda archivada (no se borra), sin efecto en caja ni stock, y la caja se puede cerrar.
        // Sin PIN nuevo: basta el dueño confirmado en esta sesión.
        if (entry.reason !== 'operation_id_conflict') fail('QUARANTINE_DISCARD_NOT_ALLOWED');
        var rolesD = root.NA_ROLES, ownerD = false;
        try { ownerD = !!(rolesD && rolesD.confirmed && typeof rolesD.isOwner === 'function' && rolesD.isOwner()); } catch (_) { ownerD = false; }
        if (!ownerD) fail('QUARANTINE_DISCARD_NEEDS_OWNER');
        if (!canonical || typeof canonical.snapshot !== 'function') fail('CANONICAL_API_UNAVAILABLE');
        var stateD = typeof canonical.sourceState === 'function' ? canonical.sourceState() : null;
        if (!stateD || stateD.validation !== 'current') fail('QUARANTINE_REMOTE_NOT_VERIFIED');
        // Si el servidor sí tiene ESTA venta (mismo contenido), se concilia en lugar de descartarse.
        if (await confirmedRemotely(canonical, entry.intent)) {
          entry.status = 'CONFIRMED_REMOTE'; entry.resolved_at = new Date().toISOString(); writeQuarantine(q);
          return { status: 'CONFIRMED_REMOTE', sale_id: entry.intent.sale_id, operation_id: operationId };
        }
        var twinD = ((canonical.snapshot() || {}).sales || []).find(function (sale) { return sale.operation_id === operationId; });
        if (twinD && sameRemoteAmount(twinD, entry.intent)) fail('QUARANTINE_OPERATION_EXISTS_ON_SERVER');
        await withStore(function () {
          var current = parseStored();
          if (current.intents.some(function (item) { return item.operation_id === operationId; })) {
            current.intents = current.intents.filter(function (item) { return item.operation_id !== operationId; }); write(current);
          }
        });
        entry.status = 'DISCARDED_CONFLICT'; entry.resolved_at = new Date().toISOString();
        entry.resolved_by = meta && meta.by != null ? String(meta.by) : null;
        if (twinD) entry.remote_sale_id = twinD.sale_id || twinD.id;
        writeQuarantine(q);
        return { status: 'DISCARDED_CONFLICT', sale_id: entry.intent.sale_id, operation_id: operationId };
      }
      fail('QUARANTINE_ACTION_INVALID');
    });
  }
  var lastServerRead = Date.now();
  function start() {
    if (started) return;
    started = true;
    async function resume() {
      if (resuming || syncing || root.navigator.onLine === false) return;
      var canonical = root.NuevoAmanecerCanonical;
      if (canonical && typeof canonical.enabled === 'function' && canonical.enabled()) {
        var state = typeof canonical.sourceState === 'function' ? canonical.sourceState() : null;
        if (!state || state.validation !== 'current') {
          if (state && ['stale','unavailable','offline'].includes(state.validation) && typeof canonical.refresh === 'function') {
            try { await canonical.refresh(); state = typeof canonical.sourceState === 'function' ? canonical.sourceState() : null; }
            catch (refreshError) {
              var code = String(refreshError && (refreshError.code || refreshError.message) || '');
              if (/^CANONICAL_READ_40[13]$/.test(code)) { var waiting = 0; try { waiting = snapshot().intents.length; } catch (_) {} if (waiting) notifySystemHold(code === 'CANONICAL_READ_401' ? 'HTTP_401' : 'HTTP_403', waiting); return; }
              scheduleResume(); return;
            }
          }
          if (!state || state.validation !== 'current') { scheduleResume(); return; }
        }
      }
      try { if (!snapshot().intents.length) return; } catch (_) { return; }
      resuming = true;
      try { await repairKnownTestPair(); return await sync(); }
      catch (error) {
        scheduleResume();
        if (root.console) root.console.error('[Venta CANON]', error.code || error.message);
      }
      finally { resuming = false; }
    }
    resumeOutbox = resume;
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('online', function () {
        retryCount = 0;
        var canonical = root.NuevoAmanecerCanonical;
        // Etapa 1.4: al reconectar se relee CANON siempre (también cajas), aunque
        // la réplica figure como vigente; na:canonical-updated reanuda la cola.
        if (canonical && typeof canonical.enabled === 'function' && canonical.enabled() && typeof canonical.refresh === 'function') {
          lastServerRead = Date.now();
          return canonical.refresh().then(function () { return resume(); }, function () { return resume(); });
        }
        return resume();
      });
      root.addEventListener('na:canonical-updated', resume);
      // Volver a entrar (otra pestaña guardó otra credencial) o rol confirmado por /auth/me: reanudar.
      root.addEventListener('storage', function (event) { if (event && (event.key === 'na_cloud_sync_credentials' || event.key === null)) { retryCount = 0; resume(); } });
      root.addEventListener('na:role', function () { resume(); });
    }
    if (root.document && typeof root.document.addEventListener === 'function') {
      root.document.addEventListener('visibilitychange', function () {
        if (root.document.hidden) return;
        // Volver a la app tras >60 s: releer CANON (cajas abiertas/cerradas en otro
        // equipo). Una lectura por minuto como máximo: cuida el plan gratuito.
        var canonical = root.NuevoAmanecerCanonical;
        if (Date.now() - lastServerRead > 60000 && root.navigator.onLine !== false && canonical && typeof canonical.enabled === 'function'
          && canonical.enabled() && typeof canonical.refresh === 'function' && !syncing) {
          lastServerRead = Date.now();
          return canonical.refresh().then(function () { return resume(); }, function () { return resume(); });
        }
        resume();
      });
    }
    return resume();
  }
  async function enqueue(input) {
    if (closingTill > 0) fail('BUSY');
    return withStore(function () {
      var intent = validateIntent(input), current = parseStored();
      if (current.intents.some(function (item) { return item.operation_id === intent.operation_id; })) fail('DUPLICATE_OPERATION_ID');
      // Recheck the reservation under the same cross-tab lock as durability.
      var canonical = root.NuevoAmanecerCanonical;
      var confirmed = canonical && typeof canonical.snapshot === 'function' ? canonical.snapshot().sales || [] : [];
      var receipt = canonical && typeof canonical.receiptSnapshot === 'function' ? canonical.receiptSnapshot() : null;
      var held = []; try { held = readQuarantine().entries.map(function (entry) { return entry.intent; }); } catch (_) {}
      var reserved = confirmed.concat(current.intents, held, receipt ? [receipt] : []);
      var match = /^V-(\d+)$/.exec(intent.sale_id);
      var max = reserved.reduce(function (value, sale) {
        var number = /^V-(\d+)$/.exec(String(sale.sale_id || sale.id || ''));
        return Math.max(value, number ? Number(number[1]) : 0);
      }, current.last_sale_number || 0);
      if (match) {
        var proposed = Number(match[1]);
        if (!Number.isSafeInteger(proposed) || !Number.isSafeInteger(max + 1)) fail('SALE_NUMBER_UNSAFE');
        var next = Math.max(proposed, max + 1);
        intent.sale_id = 'V-' + String(next).padStart(3, '0');
        // Retain the reservation even after the queue drains, a refresh fails,
        // or another financial command replaces the single receipt journal.
        current.last_sale_number = next;
      } else if (reserved.some(function (sale) { return (sale.sale_id || sale.id) === intent.sale_id; })) fail('DUPLICATE_SALE_ID');
      // T-47: la identidad se guarda primero; luego la venta.
      var who = currentIdentity(canonical);
      if (who) stamp(intent.operation_id, who);
      current.intents.push(intent);
      write(current);
      return clone(intent);
    });
  }
  function knownTestPair(current) {
    var pair = current.intents.filter(function (intent) { return intent.sale_id === 'V-001'; });
    return pair.length === 2 && pair.every(function (intent) { return intent.payment_method === 'efectivo'; }) &&
      pair.map(function (intent) { return intent.total_cents; }).sort(function (a, b) { return a - b; }).join(',') === '200,300'
      ? pair : null;
  }
  function archiveTests(current, intents, reason) {
    var key = KEY + '_rejected_tests';
    var archive = JSON.parse(root.localStorage.getItem(key) || '[]');
    if (!Array.isArray(archive)) fail('TEST_ARCHIVE_INVALID');
    intents.forEach(function (intent) {
      if (!archive.some(function (entry) { return entry.intent && entry.intent.operation_id === intent.operation_id; }))
        archive.push({ intent: clone(intent), reason: reason, rejected_at: new Date().toISOString() });
    });
    var raw = JSON.stringify(archive);
    root.localStorage.setItem(key, raw);
    if (root.localStorage.getItem(key) !== raw) fail('TEST_ARCHIVE_NOT_DURABLE');
    var selected = new Set(intents.map(function (intent) { return intent.operation_id; }));
    current = parseStored();
    current.last_sale_number = Math.max(current.last_sale_number || 0, 1);
    current.intents = current.intents.filter(function (intent) { return !selected.has(intent.operation_id); });
    write(current);
  }
  async function repairKnownTestPair() {
    if (!knownTestPair(parseStored())) return;
    return withLock(async function () {
      var canonical = root.NuevoAmanecerCanonical;
      if (!canonical || typeof canonical.sourceState !== 'function' || typeof canonical.refresh !== 'function') return;
      await canonical.refresh();
      var current = parseStored(), pair = knownTestPair(current);
      if (!pair || canonical.sourceState().validation !== 'current' || canonical.pendingSnapshot()) return;
      var base = canonical.snapshot(), receipt = canonical.receiptSnapshot();
      if (pair.some(function (intent) {
        return matching(receipt, intent) || (base.sales || []).some(function (sale) { return sale.operation_id === intent.operation_id; });
      })) return;
      // The owner identified exactly this duplicate test pair and authorized its
      // loss. Archive both only with current authenticated proof of no commit.
      await withStore(function () { archiveTests(current, pair, 'DUPLICATE_SALE_ID'); });
      var runtime = root.NuevoAmanecerCanonicalUIAdapter && root.NuevoAmanecerCanonicalUIAdapter.runtime;
      if (runtime) runtime.notify('Dos ventas de prueba inválidas se retiraron de las pendientes.', 'info');
    });
  }
  async function rejectInvalidTestIntent(operationId) {
    return withLock(async function () {
      var canonical = root.NuevoAmanecerCanonical;
      if (!canonical || typeof canonical.sourceState !== 'function' || typeof canonical.refresh !== 'function') fail('CANONICAL_API_UNAVAILABLE');
      await canonical.refresh();
      if (canonical.sourceState().validation !== 'current' || canonical.pendingSnapshot()) fail('TEST_INTENT_NOT_PROVEN_INVALID');
      var current = parseStored();
      var intent = current.intents.find(function (item) { return item.operation_id === operationId; });
      var base = canonical.snapshot();
      var receipt = canonical.receiptSnapshot();
      // Narrow owner-authorized test repair; never use the display conflict as
      // proof. Unknown ACK/journal, confirmed operations and other amounts fail.
      if (!intent || intent.sale_id !== 'V-001' || [200,300].indexOf(intent.total_cents) === -1 ||
          intent.payment_method !== 'efectivo' || matching(receipt, intent) ||
          (base.sales || []).some(function (sale) { return sale.operation_id === intent.operation_id; })) fail('TEST_INTENT_NOT_PROVEN_INVALID');
      var missing = intent.items.some(function (item) {
        return !item.generic_line && !base.products.some(function (product) { return product.product_id === item.product_id; });
      });
      var key = KEY + '_rejected_tests';
      var archive = JSON.parse(root.localStorage.getItem(key) || '[]');
      if (!Array.isArray(archive)) fail('TEST_ARCHIVE_INVALID');
      var duplicate = current.intents.some(function (item) { return item.operation_id !== intent.operation_id && item.sale_id === intent.sale_id; }) ||
        (base.sales || []).some(function (sale) { return sale.sale_id === intent.sale_id; }) ||
        archive.some(function (entry) { return entry.reason === 'DUPLICATE_SALE_ID' && entry.intent && entry.intent.sale_id === intent.sale_id && entry.intent.operation_id !== operationId; });
      if (!missing && !duplicate) fail('TEST_INTENT_NOT_PROVEN_INVALID');
      await withStore(function () { archiveTests(current, [intent], missing ? 'PRODUCT_NOT_FOUND' : 'DUPLICATE_SALE_ID'); });
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('na:canonical-sale-projection'));
      return { status: 'REJECTED_TEST_INTENT', operation_id: operationId };
    });
  }
  root.NuevoAmanecerCanonicalSaleOutbox = Object.freeze({ busy: function () { return !!syncing; }, sessionExpired: sessionExpired, VERSION: VERSION, KEY: KEY, enqueue: enqueue, snapshot: snapshot, sync: sync, withCashCloseBarrier: withCashCloseBarrier, quarantine: quarantineSnapshot, sessionOf: sessionOfIntent, blocking: function () { return clone(blockingQuarantine()); }, quarantineRetryable: retryable, quarantineDiscardable: function (entry) { return !!entry && entry.status === 'QUARANTINED' && entry.reason === 'operation_id_conflict'; }, quarantineAnnullable: function (entry) { return annullable(entry, root.NuevoAmanecerCanonical); }, resolveQuarantined: resolveQuarantined, start: start, rejectInvalidTestIntent: rejectInvalidTestIntent,
    reasonText: reasonText, identityHeld: function (reason) { return IDENTITY_REASONS.indexOf(reason) !== -1; }, quarantineRebindsOnRetry: function (reason) { return REBIND_ON_RETRY.indexOf(reason) !== -1; },
    rebindTarget: function () { return openCashSession(root.NuevoAmanecerCanonical); },
    // The drain resolves every sale.create rejection by itself (review list,
    // session hold or replay); capture never has to stop for it.
    autoResolves: function (record) { var c = root.NuevoAmanecerCanonical; return !!record && record.command === 'sale.create' && !!c && typeof c.releaseRejectedSaleJournal === 'function'; } });
})(globalThis);
