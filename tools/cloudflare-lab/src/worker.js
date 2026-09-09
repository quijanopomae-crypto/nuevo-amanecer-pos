// Gateway mínimo: POS OUTBOX -> Worker -> D1 sync_operations.
// Contrato: mismo operation_id + mismo payload_hash = already_processed (idempotente);
// mismo operation_id + payload_hash distinto = conflict (409), nunca se sobrescribe.

const TEXT_FIELDS = ['operation_id', 'device_id', 'entity_type', 'entity_id', 'payload', 'payload_hash', 'created_at'];
const SHA256_HEX = /^[0-9a-f]{64}$/;
const OPERATION_PATH = /^\/sync\/operations\/([^/]+)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS' && (url.pathname === '/health' || url.pathname.startsWith('/sync/operations'))) {
        return cors(new Response(null, { status: 204 }));
      }
      if (request.method === 'GET' && url.pathname === '/health') {
        return health(env);
      }
      if (url.pathname.startsWith('/sync/operations')) {
        const denied = authorize(request, env);
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
      return json({ error: 'internal_error', message: String(err?.message ?? err) }, 500);
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

// Fail-closed: sin SYNC_TOKEN configurado el gateway no acepta ni lee operaciones.
function authorize(request, env) {
  if (!env.SYNC_TOKEN) return json({ error: 'gateway_not_configured' }, 503);
  const provided = request.headers.get('x-sync-token') ?? '';
  if (!constantTimeEqual(provided, env.SYNC_TOKEN)) return json({ error: 'unauthorized' }, 401);
  return null;
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

function cors(response) {
  response.headers.set('access-control-allow-origin', '*');
  response.headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.headers.set('access-control-allow-headers', 'content-type, x-sync-token');
  response.headers.set('access-control-max-age', '600');
  return response;
}

function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  }));
}
