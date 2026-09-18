// Gateway mínimo: POS OUTBOX -> Worker -> D1 sync_operations.
// Contrato: mismo operation_id + mismo payload_hash = already_processed (idempotente);
// mismo operation_id + payload_hash distinto = conflict (409), nunca se sobrescribe.

const TEXT_FIELDS = ['operation_id', 'device_id', 'entity_type', 'entity_id', 'payload', 'payload_hash', 'created_at'];
const SHA256_HEX = /^[0-9a-f]{64}$/;
const OPERATION_PATH = /^\/sync\/operations\/([^/]+)$/;
const SALE_ITEMS_PATH = /^\/read\/sales\/([^/]+)\/items$/;
const SALE_CREATE_PATH = '/commands/sale.create';
const READ_TYPES = new Set(['sales', 'sale_items', 'inventory_movements']);
const PAYMENT_METHODS = new Set(['efectivo', 'yape', 'plin', 'transferencia', 'credito', 'mixto']);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isRead = url.pathname.startsWith('/read/');
    try {
      if (request.method === 'OPTIONS' && (url.pathname === '/health' || url.pathname === SALE_CREATE_PATH || url.pathname.startsWith('/sync/operations') || url.pathname.startsWith('/read/'))) {
        return cors(new Response(null, { status: 204 }), isRead);
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        return await health(env);
      }
      if (isRead) {
        if (request.method !== 'GET') return cors(json({ error: 'method_not_allowed' }, 405, { allow: 'GET, OPTIONS' }), true);
        const denied = authorizeRead(request, env);
        if (denied) return cors(denied, true);
        return cors(await readRoute(url, env.nuevo_amanecer_lab), true);
      }
      if (url.pathname === SALE_CREATE_PATH) {
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST, OPTIONS' });
        return await createSale(request, env);
      }
      if (url.pathname.startsWith('/sync/operations')) {
        const provided = request.headers.get('x-sync-token') ?? '';
        if (!provided || (env.READ_TOKEN && constantTimeEqual(provided, env.READ_TOKEN))) {
          return json({ error: 'unauthorized' }, 401);
        }
        if (request.method === 'POST' && url.pathname === '/sync/operations') {
          return await insertOperation(request, env);
        }
        const match = url.pathname.match(OPERATION_PATH);
        if (request.method === 'GET' && match) {
          const denied = await authorizeDevice(request.headers.get('x-device-id'), request, env, false);
          if (denied instanceof Response) return denied;
          return await lookupOperation(decodeURIComponent(match[1]), env.nuevo_amanecer_lab);
        }
      }
      return json({ error: 'not_found' }, 404);
    } catch {
      return cors(json({ error: 'internal_error' }, 500), isRead);
    }
  },
};

async function health(env) {
  if (!env.nuevo_amanecer_lab) {
    return json({ ok: false, d1: 'binding_missing' }, 503);
  }
  const row = await env.nuevo_amanecer_lab.prepare('SELECT 1 AS one').first();
  return json({ ok: row?.one === 1, service: 'nuevo-amanecer-sync-lab', d1: row?.one === 1 ? 'ok' : 'error' });
}

// Device credentials are HMACed with a server-only pepper before D1 lookup.
async function authorizeDevice(deviceId, request, env, requireWriter) {
  if (!env.DEVICE_CREDENTIAL_PEPPER) return json({ error: 'device_auth_not_configured' }, 503);
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 160) return json({ error: 'unauthorized' }, 401);
  const provided = request.headers.get('x-sync-token') ?? '';
  if (!provided || provided.length > 1024) return json({ error: 'unauthorized' }, 401);
  if (env.READ_TOKEN && constantTimeEqual(provided, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
  const device = await env.nuevo_amanecer_lab
    .prepare('SELECT device_id, role, status, credential_hash FROM devices WHERE device_id = ?1')
    .bind(deviceId)
    .first();
  const providedHash = await credentialHash(provided, env.DEVICE_CREDENTIAL_PEPPER);
  if (!device || !constantTimeEqual(providedHash, device.credential_hash)) return json({ error: 'unauthorized' }, 401);
  if (device.status !== 'active') return json({ error: 'device_revoked' }, 403);
  if (requireWriter && device.role !== 'writer') return json({ error: 'read_only_device' }, 403);
  await env.nuevo_amanecer_lab
    .prepare("UPDATE devices SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE device_id = ?1")
    .bind(deviceId)
    .run();
  return { credentialHash: providedHash };
}

function authorizeRead(request, env) {
  if (!env.READ_TOKEN) return json({ error: 'read_gateway_not_configured' }, 503);
  const provided = request.headers.get('x-read-token') ?? '';
  if (!constantTimeEqual(provided, env.READ_TOKEN)) return json({ error: 'unauthorized' }, 401);
  return null;
}

async function readRoute(url, db) {
  if (url.pathname === '/read/status') return readStatus(db);
  if (url.pathname === '/read/sales') return readOperations(url, db, 'sales');
  if (url.pathname === '/read/inventory-movements') return readOperations(url, db, 'inventory_movements');
  const match = url.pathname.match(SALE_ITEMS_PATH);
  if (match) return readOperations(url, db, 'sale_items', decodeURIComponent(match[1]));
  return json({ error: 'not_found' }, 404);
}

async function readStatus(db) {
  const rows = await db
    .prepare(
      `SELECT entity_type, COUNT(*) AS count, MAX(received_at) AS last_received_at
       FROM sync_operations
       WHERE entity_type IN ('sales', 'sale_items', 'inventory_movements')
       GROUP BY entity_type`,
    )
    .all();
  const counts = { sales: 0, sale_items: 0, inventory_movements: 0 };
  let lastReceivedAt = null;
  for (const row of rows.results ?? []) {
    if (!READ_TYPES.has(row.entity_type)) continue;
    counts[row.entity_type] = Number(row.count) || 0;
    if (row.last_received_at && (!lastReceivedAt || row.last_received_at > lastReceivedAt)) lastReceivedAt = row.last_received_at;
  }
  return json({ status: 'ok', counts, last_received_at: lastReceivedAt });
}

async function readOperations(url, db, entityType, saleId = null) {
  const page = parsePage(url.searchParams);
  if (page.error) return json({ error: page.error }, 400);
  const where = ['entity_type = ?1'];
  const bindings = [entityType];
  if (saleId !== null) {
    if (!saleId || saleId.length > 160) return json({ error: 'invalid_sale_id' }, 400);
    where.push(`substr(entity_id, 1, length(?${bindings.length + 1}) + 1) = ?${bindings.length + 1} || ':'`);
    bindings.push(saleId);
  }
  if (page.cursor) {
    where.push(`(received_at < ?${bindings.length + 1} OR (received_at = ?${bindings.length + 1} AND operation_id < ?${bindings.length + 2}))`);
    bindings.push(page.cursor.received_at, page.cursor.operation_id);
  }
  bindings.push(page.limit + 1);
  const limitIndex = bindings.length;
  const rows = await db
    .prepare(
      `SELECT operation_id, device_id, device_sequence, entity_type, entity_id, payload, created_at, received_at
       FROM sync_operations
       WHERE ${where.join(' AND ')}
       ORDER BY received_at DESC, operation_id DESC
       LIMIT ?${limitIndex}`,
    )
    .bind(...bindings)
    .all();
  const source = rows.results ?? [];
  const hasMore = source.length > page.limit;
  const selected = source.slice(0, page.limit);
  const items = [];
  for (const row of selected) {
    let payload;
    try { payload = JSON.parse(row.payload); } catch { return json({ error: 'invalid_stored_payload' }, 500); }
    items.push({
      operation_id: row.operation_id,
      device_id: row.device_id,
      device_sequence: row.device_sequence,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      payload,
      created_at: row.created_at,
      received_at: row.received_at,
    });
  }
  const last = selected.at(-1);
  return json({ items, next_cursor: hasMore && last ? encodeCursor(last) : null, limit: page.limit });
}

function parsePage(searchParams) {
  const rawLimit = searchParams.get('limit');
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) return { error: 'invalid_limit' };
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) return { error: 'invalid_limit' };
  const rawCursor = searchParams.get('cursor');
  if (!rawCursor) return { limit, cursor: null };
  try {
    const cursor = JSON.parse(decodeBase64Url(rawCursor));
    if (!cursor || typeof cursor.received_at !== 'string' || !Number.isFinite(Date.parse(cursor.received_at)) ||
        typeof cursor.operation_id !== 'string' || !cursor.operation_id || cursor.operation_id.length > 160) {
      return { error: 'invalid_cursor' };
    }
    return { limit, cursor };
  } catch {
    return { error: 'invalid_cursor' };
  }
}

function encodeCursor(row) {
  return encodeBase64Url(JSON.stringify({ received_at: row.received_at, operation_id: row.operation_id }));
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid cursor');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function insertOperation(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const problem = validateOperation(body);
  if (problem) return json({ error: 'invalid_operation', message: problem }, 400);
  const headerDeviceId = request.headers.get('x-device-id');
  if (headerDeviceId && headerDeviceId !== body.device_id) return json({ error: 'device_id_mismatch' }, 403);
  const denied = await authorizeDevice(body.device_id, request, env, true);
  if (denied instanceof Response) return denied;
  const db = env.nuevo_amanecer_lab;

  const computedHash = await sha256Hex(body.payload);
  if (computedHash !== body.payload_hash) {
    return json({ error: 'payload_hash_mismatch', computed_payload_hash: computedHash }, 400);
  }

  const result = await db
    .prepare(
      `INSERT INTO sync_operations
         (operation_id, device_id, device_sequence, entity_type, entity_id, payload, payload_hash, created_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
        WHERE EXISTS (SELECT 1 FROM devices WHERE device_id = ?2
          AND role = 'writer' AND status = 'active' AND credential_hash = ?9)
        ON CONFLICT(operation_id) DO NOTHING`,
    )
    .bind(
      body.operation_id,
      body.device_id,
      body.device_sequence,
      body.entity_type,
      body.entity_id,
      body.payload,
      body.payload_hash,
      body.created_at,
      denied.credentialHash,
    )
    .run();

  if (result.meta.changes === 1) {
    return json({ status: 'inserted', operation_id: body.operation_id }, 201);
  }

  // A revocation/rotation may have won the race with the guarded INSERT.
  const recheck = await authorizeDevice(body.device_id, request, env, true);
  if (recheck instanceof Response) return recheck;

  const existing = await db
    .prepare('SELECT payload_hash, received_at FROM sync_operations WHERE operation_id = ?1')
    .bind(body.operation_id)
    .first();
  if (!existing) {
    return json({ error: 'internal_error', message: 'insert reported no change but row is missing' }, 500);
  }
  if (existing.payload_hash === body.payload_hash) {
    return json({ status: 'already_processed', operation_id: body.operation_id, received_at: existing.received_at }, 200);
  }
  return json(
    {
      status: 'conflict',
      error: 'operation_id_conflict',
      operation_id: body.operation_id,
      stored_payload_hash: existing.payload_hash,
      received_payload_hash: body.payload_hash,
    },
    409,
  );
}

async function lookupOperation(operationId, db) {
  const row = await db.prepare('SELECT * FROM sync_operations WHERE operation_id = ?1').bind(operationId).first();
  if (!row) return json({ error: 'not_found', operation_id: operationId }, 404);
  return json({ operation: row });
}

function validateOperation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  for (const field of TEXT_FIELDS) {
    if (typeof body[field] !== 'string' || body[field].length === 0) return `${field} must be a non-empty string`;
  }
  if (!Number.isInteger(body.device_sequence) || body.device_sequence < 0) return 'device_sequence must be a non-negative integer';
  if (!SHA256_HEX.test(body.payload_hash)) return 'payload_hash must be lowercase sha256 hex';
  return null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function createSale(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ status: 'error', error: 'invalid_json' }, 400);
  }
  const normalized = validateSale(body);
  if (normalized.error) return json({ status: 'error', error: 'invalid_sale', message: normalized.error }, 400);

  const deviceId = request.headers.get('x-device-id');
  if (body.device_id !== undefined && body.device_id !== deviceId) return json({ status: 'error', operation_id: body.operation_id, error: 'device_id_mismatch' }, 403);
  const denied = await authorizeDevice(deviceId, request, env, true);
  if (denied instanceof Response) return denied;

  const db = env.nuevo_amanecer_lab;
  const payload = stableStringify(body);
  const payloadHash = await sha256Hex(payload);
  const existing = await db
    .prepare('SELECT sale_id, payload_hash FROM sales WHERE operation_id = ?1')
    .bind(body.operation_id)
    .first();
  if (existing) return saleReplay(body.operation_id, payloadHash, existing);

  // Only this batch's winning INSERT may create children. Retries never repair or append effects.
  const commitToken = crypto.randomUUID();
  const statements = [
    db.prepare(
      `INSERT INTO sales (sale_id, operation_id, payload_hash, device_id, payment_method, total_cents, created_at,
                          commit_token, payment_reference)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?9, ?10
       WHERE EXISTS (SELECT 1 FROM devices WHERE device_id = ?4
         AND role = 'writer' AND status = 'active' AND credential_hash = ?8)
       ON CONFLICT DO NOTHING`,
    ).bind(
      normalized.sale.sale_id,
      body.operation_id,
      payloadHash,
      deviceId,
      normalized.sale.payment_method,
      normalized.sale.total_cents,
      normalized.sale.created_at,
      denied.credentialHash,
      commitToken,
      normalized.sale.payment.reference,
    ),
  ];

  for (const [index, item] of normalized.sale.items.entries()) {
    const lineNumber = index + 1;
    statements.push(
      db.prepare(
        `INSERT INTO sale_items
           (sale_id, line_number, operation_id, product_id, quantity, unit_price_cents, line_total_cents, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
         WHERE EXISTS (SELECT 1 FROM sales WHERE operation_id = ?3 AND commit_token = ?9)`,
      ).bind(
        normalized.sale.sale_id, lineNumber, body.operation_id, item.product_id, item.quantity,
        item.unit_price_cents, item.line_total_cents, normalized.sale.created_at, commitToken,
      ),
      db.prepare(
        `INSERT INTO inventory_movements
           (movement_id, operation_id, sale_id, line_number, product_id, quantity, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE EXISTS (SELECT 1 FROM sales WHERE operation_id = ?2 AND commit_token = ?8)`,
      ).bind(
        `${body.operation_id}:inventory:${lineNumber}`, body.operation_id, normalized.sale.sale_id,
        lineNumber, item.product_id, -item.quantity, normalized.sale.created_at, commitToken,
      ),
    );
  }
  statements.push(
    db.prepare(
      `INSERT INTO cash_movements
         (movement_id, operation_id, sale_id, payment_method, amount_cents, cash_cents,
          digital_cents, credit_cents, digital_method, reference, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
       WHERE EXISTS (SELECT 1 FROM sales WHERE operation_id = ?2 AND commit_token = ?12)`,
    ).bind(
      `${body.operation_id}:cash`, body.operation_id, normalized.sale.sale_id,
      normalized.sale.payment_method, normalized.sale.total_cents, normalized.sale.payment.cash_cents,
      normalized.sale.payment.digital_cents, normalized.sale.payment.credit_cents,
      normalized.sale.payment.digital_method, normalized.sale.payment.reference,
      normalized.sale.created_at, commitToken,
    ),
  );

  const results = await db.batch(statements);
  if (results[0]?.meta?.changes === 1) {
    return json({ status: 'created', operation_id: body.operation_id, sale_id: normalized.sale.sale_id, idempotent: false }, 201);
  }

  // Revocation, a concurrent retry, or a conflicting operation may have won after authorization.
  const recheck = await authorizeDevice(deviceId, request, env, true);
  if (recheck instanceof Response) return recheck;
  const raced = await db.prepare('SELECT sale_id, payload_hash FROM sales WHERE operation_id = ?1').bind(body.operation_id).first();
  if (raced) return saleReplay(body.operation_id, payloadHash, raced);
  return json({ status: 'conflict', operation_id: body.operation_id, error: 'sale_not_created' }, 409);
}

function saleReplay(operationId, payloadHash, existing) {
  if (constantTimeEqual(payloadHash, existing.payload_hash)) {
    return json({ status: 'already_processed', operation_id: operationId, sale_id: existing.sale_id, idempotent: true, already_processed: true });
  }
  return json({ status: 'conflict', error: 'operation_id_conflict', operation_id: operationId }, 409);
}

function validateSale(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be a JSON object' };
  if (!validId(body.operation_id)) return { error: 'operation_id must be a non-empty string of at most 160 characters' };
  if (!validId(body.sale_id)) return { error: 'sale_id must be a non-empty string of at most 160 characters' };
  if (typeof body.created_at !== 'string' || !Number.isFinite(Date.parse(body.created_at))) return { error: 'created_at must be a valid timestamp' };
  if (!PAYMENT_METHODS.has(body.payment_method)) return { error: 'payment_method is not supported' };
  if (body.payment_method === 'credito' && (!validId(body.customer_id) ||
      typeof body.credit_due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.credit_due) ||
      !Number.isFinite(Date.parse(body.credit_due)) || new Date(body.credit_due).toISOString().slice(0, 10) !== body.credit_due)) {
    return { error: 'credit requires customer_id and a valid credit_due date' };
  }
  if (!Number.isSafeInteger(body.total_cents) || body.total_cents <= 0) return { error: 'total_cents must be a positive integer' };
  const payment = validatePayment(body.payment_method, body.total_cents, body.payment);
  if (payment.error) return payment;
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 500) return { error: 'items must contain between 1 and 500 lines' };

  const items = [];
  let computedTotal = 0;
  for (const item of body.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !validId(item.product_id)) return { error: 'each product_id must be valid' };
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > Number.MAX_SAFE_INTEGER) return { error: 'each quantity must be greater than zero and within the safe range' };
    if (!Number.isSafeInteger(item.unit_price_cents) || item.unit_price_cents < 0) return { error: 'each unit_price_cents must be a non-negative integer' };
    const lineTotal = item.quantity * item.unit_price_cents;
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0) return { error: 'each line total must resolve to whole cents' };
    if (!Number.isSafeInteger(computedTotal + lineTotal)) return { error: 'sale total exceeds the supported range' };
    computedTotal += lineTotal;
    items.push({ product_id: item.product_id, quantity: item.quantity, unit_price_cents: item.unit_price_cents, line_total_cents: lineTotal });
  }
  if (computedTotal !== body.total_cents) return { error: 'total_cents does not match item totals' };
  return {
    sale: {
      sale_id: body.sale_id,
      created_at: new Date(body.created_at).toISOString(),
      payment_method: body.payment_method,
      total_cents: body.total_cents,
      payment: payment.value,
      items,
    },
  };
}

function validatePayment(method, totalCents, payment) {
  const empty = { cash_cents: 0, digital_cents: 0, credit_cents: 0, digital_method: null, reference: null };
  if (method === 'efectivo') return { value: { ...empty, cash_cents: totalCents } };
  if (method === 'credito') return { value: { ...empty, credit_cents: totalCents } };
  if (method !== 'mixto') {
    const reference = payment?.reference;
    if (reference !== undefined && (typeof reference !== 'string' || reference.length > 160 || /[\x00-\x1f\x7f]/.test(reference))) {
      return { error: 'payment reference must be a string of at most 160 characters' };
    }
    return { value: { ...empty, digital_cents: totalCents, digital_method: method, reference: reference || null } };
  }
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return { error: 'mixed payment details are required' };
  if (!Number.isSafeInteger(payment.cash_cents) || payment.cash_cents <= 0 ||
      !Number.isSafeInteger(payment.digital_cents) || payment.digital_cents <= 0 ||
      payment.cash_cents + payment.digital_cents !== totalCents ||
      !['yape', 'plin', 'transferencia'].includes(payment.digital_method)) {
    return { error: 'mixed payment amounts and digital_method must be valid' };
  }
  if (payment.reference !== undefined && (typeof payment.reference !== 'string' || payment.reference.length > 160 || /[\x00-\x1f\x7f]/.test(payment.reference))) {
    return { error: 'payment reference must be a string of at most 160 characters' };
  }
  return {
    value: {
      ...empty,
      cash_cents: payment.cash_cents,
      digital_cents: payment.digital_cents,
      digital_method: payment.digital_method,
      reference: payment.reference || null,
    },
  };
}

function validId(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function credentialHash(credential, pepper) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(credential));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a, b) {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  if (bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

function cors(response, isRead = false) {
  response.headers.set('access-control-allow-origin', '*');
  response.headers.set('access-control-allow-methods', isRead ? 'GET, OPTIONS' : 'GET, POST, OPTIONS');
  response.headers.set('access-control-allow-headers', isRead ? 'x-read-token' : 'content-type, x-sync-token, x-device-id');
  response.headers.set('access-control-max-age', '600');
  return response;
}

function json(data, status = 200, headers = {}) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  }));
}
