import { writeFileSync } from 'node:fs';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';
const PROD_WORKER = process.env.PROD_WORKER_URL || 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
const ACTIVATION_SECRET = process.env.POS_ACTIVATION_SECRET || '';
const RUN_ID = process.env.GITHUB_RUN_ID || 'manual';
const CONTRACT = 'a6-gate-c-v1';
const MAX_CANARY_CENTS = 10000;

function requireEnv() {
  if (!/^[a-f0-9]{32}$/.test(ACCOUNT)) throw new Error('invalid CLOUDFLARE_ACCOUNT_ID');
  if (!TOKEN) throw new Error('missing CLOUDFLARE_API_TOKEN');
  if (!ACTIVATION_SECRET) throw new Error('missing POS_ACTIVATION_SECRET');
}

async function cf(path, options = {}) {
  requireEnv();
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + path, {
    ...options,
    headers: {
      authorization: 'Bearer ' + TOKEN,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const parsed = await response.json().catch(() => null);
  if (!response.ok || parsed?.success !== true) {
    const detail = parsed?.errors?.map(x => x?.message).filter(Boolean).join('; ') || 'unknown';
    throw new Error('Cloudflare API failed ' + response.status + ': ' + detail);
  }
  return parsed.result;
}

async function query(label, sql, params = undefined) {
  const result = await cf('/d1/database/' + PROD_DB + '/query', {
    method: 'POST',
    body: JSON.stringify(params ? { sql, params } : { sql }),
  });
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || first.success === false) throw new Error(label + ' returned failure');
  return Array.isArray(first.results) ? first.results : [];
}

async function controlState() {
  const control = (await query('canonical control',
    "SELECT mode,active_promotion_id,revision,authority_epoch,minimum_client_contract,first_live_operation_id FROM canonical_control WHERE id=1"))[0];
  if (!control) throw new Error('canonical_control missing');
  return {
    ...control,
    revision: Number(control.revision),
    authority_epoch: Number(control.authority_epoch),
  };
}

async function trafficState() {
  const row = (await query('traffic',
    "SELECT (SELECT COUNT(*) FROM sales) sales," +
    "(SELECT COUNT(*) FROM sale_items) sale_items," +
    "(SELECT COUNT(*) FROM cash_movements) cash_movements," +
    "(SELECT COUNT(*) FROM inventory_movements) inventory_movements," +
    "(SELECT COUNT(*) FROM sync_operations) sync_operations," +
    "(SELECT COUNT(*) FROM canonical_financial_operations) financial_operations," +
    "(SELECT COUNT(*) FROM auth_sessions WHERE status='active') active_sessions"))[0];
  return Object.fromEntries(Object.entries(row || {}).map(([k,v]) => [k, Number(v)]));
}

function assertAuthority(control) {
  if (control.mode !== 'ACTIVE') throw new Error('production authority is not ACTIVE');
  if (!control.active_promotion_id) throw new Error('missing active promotion');
  if (control.minimum_client_contract !== CONTRACT) throw new Error('unexpected client contract');
  if (!Number.isSafeInteger(control.revision) || !Number.isSafeInteger(control.authority_epoch)) {
    throw new Error('invalid authority revision');
  }
}

async function activate() {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const response = await fetch(PROD_WORKER + '/auth/activate', {
      method: 'POST',
      headers: { 'x-activation-secret': ACTIVATION_SECRET },
    });
    const body = await response.json().catch(() => null);
    if (response.ok && typeof body?.session_token === 'string' && body.session_token) return body.session_token;
    const code = typeof body?.error === 'string' ? body.error : 'invalid_response';
    if (response.status === 503 && code === 'activation_not_configured' && attempt < 12) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    throw new Error('activation failed: status=' + response.status + ' error=' + code);
  }
  throw new Error('activation propagation timeout');
}

async function sessionIdentity(token) {
  const response = await fetch(PROD_WORKER + '/auth/session', {
    headers: { authorization: 'Bearer ' + token },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.session_id !== 'string' || !body.session_id) {
    throw new Error('session identity probe failed');
  }
  return body.session_id;
}

async function workerAuthority(token) {
  const response = await fetch(PROD_WORKER + '/read/canonical/status', {
    headers: { authorization: 'Bearer ' + token },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.authority !== 'canonical' || body?.mode !== 'ACTIVE') {
    throw new Error('worker canonical authority probe failed');
  }
  return body;
}

async function findSafeCandidate(promotionId) {
  const rows = await query('safe canary product',
    "SELECT product_id,price_cents,stock_revision,current_stock_quantity,tracks_inventory " +
    "FROM products WHERE promotion_id=?1 AND tracks_inventory=0 AND price_cents>0 AND price_cents<=?2 " +
    "ORDER BY price_cents ASC, product_id ASC LIMIT 1",
    [promotionId, MAX_CANARY_CENTS]);
  return rows[0] || null;
}

async function revokeSession(sessionId) {
  if (!sessionId) return;
  await query('revoke auth session', "UPDATE auth_sessions SET status='revoked' WHERE session_id=?1", [sessionId]);
  await query('revoke session principal', "UPDATE devices SET status='revoked' WHERE device_id=?1", ['session:' + sessionId]);
}

async function verifySale(operationId, expectedProduct = null) {
  const control = await controlState();
  assertAuthority(control);
  if (control.first_live_operation_id !== operationId) throw new Error('first live marker mismatch');

  const sale = (await query('sale verification',
    "SELECT sale_id,operation_id,payment_method,total_cents,payment_reference,device_id FROM sales WHERE operation_id=?1",
    [operationId]))[0];
  if (!sale) throw new Error('sale missing after first-live write');

  const context = (await query('sale context verification',
    "SELECT promotion_id,authority_epoch,control_revision,client_contract FROM canonical_sale_context WHERE operation_id=?1",
    [operationId]))[0];
  if (!context || context.promotion_id !== control.active_promotion_id ||
      Number(context.authority_epoch) !== control.authority_epoch ||
      Number(context.control_revision) !== control.revision ||
      context.client_contract !== CONTRACT) throw new Error('sale context mismatch');

  const items = await query('sale items verification',
    "SELECT product_id,quantity,unit_price_cents,line_total_cents FROM sale_items WHERE operation_id=?1 ORDER BY line_number",
    [operationId]);
  if (items.length < 1) throw new Error('sale items missing');

  const cash = await query('cash movement verification',
    "SELECT payment_method,amount_cents,cash_cents,digital_cents,credit_cents,reference FROM cash_movements WHERE operation_id=?1",
    [operationId]);
  if (cash.length !== 1) throw new Error('cash movement mismatch');

  const inventory = await query('inventory movement verification',
    "SELECT COUNT(*) n FROM inventory_movements WHERE operation_id=?1", [operationId]);
  const guard = await query('write guard cleanup',
    "SELECT COUNT(*) n FROM canonical_write_guards WHERE operation_id=?1", [operationId]);
  if (Number(guard[0]?.n || 0) !== 0) throw new Error('canonical write guard leaked');

  if (expectedProduct) {
    if (items.length !== 1 || items[0].product_id !== expectedProduct.product_id ||
        Number(items[0].quantity) !== 1 ||
        Number(items[0].unit_price_cents) !== Number(expectedProduct.price_cents) ||
        Number(items[0].line_total_cents) !== Number(expectedProduct.price_cents)) {
      throw new Error('technical canary item mismatch');
    }
    if (sale.payment_method !== 'transferencia' ||
        Number(sale.total_cents) !== Number(expectedProduct.price_cents) ||
        !String(sale.payment_reference || '').startsWith('V13-TECH-CANARY-')) {
      throw new Error('technical canary sale mismatch');
    }
    if (Number(inventory[0]?.n || 0) !== 0) throw new Error('technical canary changed inventory');
    const productAfter = (await query('product unchanged verification',
      "SELECT price_cents,stock_revision,current_stock_quantity,tracks_inventory FROM products WHERE promotion_id=?1 AND product_id=?2",
      [control.active_promotion_id, expectedProduct.product_id]))[0];
    if (!productAfter || Number(productAfter.tracks_inventory) !== 0 ||
        Number(productAfter.price_cents) !== Number(expectedProduct.price_cents) ||
        Number(productAfter.stock_revision) !== Number(expectedProduct.stock_revision) ||
        productAfter.current_stock_quantity !== expectedProduct.current_stock_quantity) {
      throw new Error('non-inventory product changed during canary');
    }
  }

  return {
    control,
    sale,
    items,
    cash: cash[0],
    inventory_movements: Number(inventory[0]?.n || 0),
  };
}

function writeManifest(state, mode) {
  const manifest = {
    format: 'nuevo-amanecer-v1.3-first-live-validation-v1',
    status: 'V1_3_PRODUCTION_PASS',
    validation_mode: mode,
    database_id: PROD_DB,
    operation_id: state.sale.operation_id,
    sale_id: state.sale.sale_id,
    total_cents: Number(state.sale.total_cents),
    payment_method: state.sale.payment_method,
    first_live_operation_id: state.control.first_live_operation_id,
    promotion_id: state.control.active_promotion_id,
    authority_epoch: state.control.authority_epoch,
    revision: state.control.revision,
    item_count: state.items.length,
    inventory_movements: state.inventory_movements,
    github_run_id: RUN_ID,
  };
  writeFileSync('/tmp/v1.3-first-live-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ state: 'V1_3_PRODUCTION_PASS', ...manifest }));
}

async function validateExistingFirstSale(control) {
  const operationId = control.first_live_operation_id;
  const state = await verifySale(operationId);
  await query('revoke stale active sessions after existing first sale',
    "UPDATE auth_sessions SET status='revoked' WHERE status='active'");
  await query('revoke stale active session principals',
    "UPDATE devices SET status='revoked' WHERE device_id LIKE 'session:%' AND status='active'");
  writeManifest(state, 'existing-real-first-sale');
}

async function createTechnicalFirstSale(control) {
  const before = await trafficState();
  for (const key of ['sales','sale_items','cash_movements','inventory_movements','sync_operations','financial_operations','active_sessions']) {
    if (before[key] !== 0) throw new Error('unexpected pre-first-sale traffic: ' + key + '=' + before[key]);
  }

  const candidate = await findSafeCandidate(control.active_promotion_id);
  if (!candidate) {
    throw new Error('no_safe_non_inventory_candidate: requires an existing tracks_inventory=0 product priced between 1 and ' + MAX_CANARY_CENTS + ' cents');
  }

  const token = await activate();
  let sessionId = null;
  let saleCreated = false;
  try {
    sessionId = await sessionIdentity(token);
    const authority = await workerAuthority(token);
    if (authority.promotion_id !== control.active_promotion_id ||
        Number(authority.authority_epoch) !== control.authority_epoch ||
        Number(authority.revision) !== control.revision) throw new Error('worker authority changed before sale');

    const operationId = 'v13-first-live-' + RUN_ID;
    const saleId = 'v13-first-live-sale-' + RUN_ID;
    const reference = 'V13-TECH-CANARY-' + RUN_ID + '-NO-FUNDS';
    const createdAt = new Date().toISOString();
    const total = Number(candidate.price_cents);
    const payload = {
      operation_id: operationId,
      sale_id: saleId,
      promotion_id: control.active_promotion_id,
      client_contract: CONTRACT,
      authority_epoch: control.authority_epoch,
      expected_control_revision: control.revision,
      payment_method: 'transferencia',
      total_cents: total,
      created_at: createdAt,
      items: [{
        product_id: candidate.product_id,
        quantity: 1,
        unit_price_cents: total,
        line_total_cents: total,
        expected_stock_revision: Number(candidate.stock_revision),
      }],
      payment: {
        cash_cents: 0,
        digital_cents: total,
        credit_cents: 0,
        reference,
      },
    };

    const response = await fetch(PROD_WORKER + '/commands/sale.create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    if (response.status !== 201 || body?.status !== 'created' || body?.operation_id !== operationId) {
      throw new Error('first live canary sale failed: status=' + response.status + ' error=' + (body?.error || body?.status || 'invalid_response'));
    }
    saleCreated = true;

    const replay = await fetch(PROD_WORKER + '/commands/sale.create', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const replayBody = await replay.json().catch(() => null);
    if (!replay.ok || replayBody?.status !== 'already_processed' || replayBody?.idempotent !== true) {
      throw new Error('first live sale idempotency replay failed');
    }

    const state = await verifySale(operationId, candidate);
    await revokeSession(sessionId);
    sessionId = null;
    const after = await trafficState();
    if (after.sales !== 1 || after.sale_items !== 1 || after.cash_movements !== 1 ||
        after.inventory_movements !== 0 || after.sync_operations !== 0 ||
        after.financial_operations !== 0 || after.active_sessions !== 0) {
      throw new Error('post-first-sale traffic invariant failed: ' + JSON.stringify(after));
    }
    writeManifest(state, 'technical-non-inventory-canary');
  } finally {
    if (sessionId) await revokeSession(sessionId).catch(() => {});
    if (!saleCreated) {
      const latest = await controlState().catch(() => null);
      if (latest?.first_live_operation_id) {
        console.log(JSON.stringify({ state: 'FIRST_LIVE_MARKER_PRESENT_AFTER_ERROR', operation_id: latest.first_live_operation_id }));
      }
    }
  }
}

async function main() {
  requireEnv();
  const control = await controlState();
  assertAuthority(control);
  if (control.first_live_operation_id) {
    await validateExistingFirstSale(control);
    return;
  }
  await createTechnicalFirstSale(control);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
