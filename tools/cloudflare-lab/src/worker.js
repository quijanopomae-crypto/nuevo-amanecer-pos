// Gateway mínimo: POS OUTBOX -> Worker -> D1 sync_operations.
// Contrato: mismo operation_id + mismo payload_hash = already_processed (idempotente);
// mismo operation_id + payload_hash distinto = conflict (409), nunca se sobrescribe.

const TEXT_FIELDS = ['operation_id', 'device_id', 'entity_type', 'entity_id', 'payload', 'payload_hash', 'created_at'];
const SHA256_HEX = /^[0-9a-f]{64}$/;
const OPERATION_PATH = /^\/sync\/operations\/([^/]+)$/;
const SALE_ITEMS_PATH = /^\/read\/sales\/([^/]+)\/items$/;
const READ_TYPES = new Set(['sales', 'sale_items', 'inventory_movements']);
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isRead = url.pathname.startsWith('/read/');
    try {
      if (request.method === 'OPTIONS' && (url.pathname === '/health' || url.pathname.startsWith('/sync/operations') || url.pathname.startsWith('/read/'))) {
        return cors(new Response(null, { status: 204 }), isRead);
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        return health(env);
      }
      if (isRead) {
        if (request.method !== 'GET') return cors(json({ error: 'method_not_allowed' }, 405, { allow: 'GET, OPTIONS' }), true);
        const denied = authorizeRead(request, env);
        if (denied) return cors(denied, true);
        return cors(await readRoute(url, env.nuevo_amanecer_lab), true);
      }
      if (url.pathname.startsWith('/sync/operations')) {
        const denied = authorizeWrite(request, env);
        if (denied) return denied;
        if (request.method === 'POST' && url.pathname === '/sync/operations') {
          return insertOperation(request, env.nuevo_amanecer_lab);
        }
        const match = url.pathname.match(OPERATION_PATH);
        if (request.method === 'GET' && match) {
          return lookupOperation(decodeURIComponent(match[1]), env.nuevo_amanecer_lab);
        }
      }
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return cors(json({ error: 'internal_error', message: String(err?.message ?? err) }, 500), isRead);
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

// Fail-closed: escritura y lectura usan credenciales distintas y no intercambiables.
function authorizeWrite(request, env) {
  if (!env.SYNC_TOKEN) return json({ error: 'gateway_not_configured' }, 503);
  if (env.READ_TOKEN && constantTimeEqual(env.READ_TOKEN, env.SYNC_TOKEN)) return json({ error: 'gateway_credentials_not_separated' }, 503);
  const provided = request.headers.get('x-sync-token') ?? '';
  if (!constantTimeEqual(provided, env.SYNC_TOKEN)) return json({ error: 'unauthorized' }, 401);
  return null;
}

function authorizeRead(request, env) {
  if (!env.READ_TOKEN) return json({ error: 'read_gateway_not_configured' }, 503);
  if (env.SYNC_TOKEN && constantTimeEqual(env.READ_TOKEN, env.SYNC_TOKEN)) return json({ error: 'gateway_credentials_not_separated' }, 503);
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

async function insertOperation(request, db) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const problem = validateOperation(body);
  if (problem) return json({ error: 'invalid_operation', message: problem }, 400);

  const computedHash = await sha256Hex(body.payload);
  if (computedHash !== body.payload_hash) {
    return json({ error: 'payload_hash_mismatch', computed_payload_hash: computedHash }, 400);
  }

  const result = await db
    .prepare(
      `INSERT INTO sync_operations
         (operation_id, device_id, device_sequence, entity_type, entity_id, payload, payload_hash, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
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
    )
    .run();

  if (result.meta.changes === 1) {
    return json({ status: 'inserted', operation_id: body.operation_id }, 201);
  }

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
  response.headers.set('access-control-allow-headers', isRead ? 'x-read-token' : 'content-type, x-sync-token');
  response.headers.set('access-control-max-age', '600');
  return response;
}

function json(data, status = 200, headers = {}) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  }));
}
