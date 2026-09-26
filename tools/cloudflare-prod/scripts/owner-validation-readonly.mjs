import { appendFileSync } from 'node:fs';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const ACTIVATION_SECRET = process.env.POS_ACTIVATION_SECRET || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';
const PROD_WORKER = process.env.PROD_WORKER_URL || 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
const PROMOTION = 'promotion-a5-mery43250-2026-09-20-v3';

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

async function query(label, sql, params) {
  const result = await cf('/d1/database/' + PROD_DB + '/query', {
    method: 'POST',
    body: JSON.stringify(params ? { sql, params } : { sql }),
  });
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || first.success === false) throw new Error(label + ' returned failure');
  return Array.isArray(first.results) ? first.results : [];
}

async function businessSnapshot() {
  const row = (await query('business snapshot',
    'SELECT ' +
    '(SELECT COUNT(*) FROM products) products,' +
    '(SELECT COUNT(*) FROM customers) customers,' +
    '(SELECT COUNT(*) FROM credits) import_credits,' +
    '(SELECT COUNT(*) FROM live_credits) live_credits,' +
    '(SELECT COUNT(*) FROM credit_payments) import_credit_payments,' +
    '(SELECT COUNT(*) FROM canonical_credit_accounts) credit_accounts,' +
    '(SELECT COUNT(*) FROM canonical_credit_metadata) credit_metadata,' +
    '(SELECT COUNT(*) FROM canonical_credit_installments) credit_installments,' +
    '(SELECT COUNT(*) FROM sales) sales,' +
    '(SELECT COUNT(*) FROM sale_items) sale_items,' +
    '(SELECT COUNT(*) FROM cash_movements) cash_movements,' +
    '(SELECT COUNT(*) FROM inventory_movements) inventory_movements,' +
    '(SELECT COUNT(*) FROM sync_operations) sync_operations,' +
    '(SELECT COUNT(*) FROM canonical_financial_operations) financial_operations'
  ))[0];
  if (!row) throw new Error('business snapshot missing');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error('request failed ' + response.status + ' ' + new URL(url).pathname);
  return body;
}

function verifyAuthority(body, status) {
  if (body.authority !== 'canonical') throw new Error('non-canonical read');
  if (body.mode !== 'ACTIVE') throw new Error('canonical mode is not ACTIVE');
  if (body.promotion_id !== PROMOTION) throw new Error('unexpected promotion');
  if (Number(body.authority_epoch) !== Number(status.authority_epoch)) throw new Error('authority epoch drift');
  if (Number(body.revision) !== Number(status.revision)) throw new Error('revision drift');
  if (Number(body.financial_revision) !== Number(status.financial_revision)) throw new Error('financial revision drift');
}

async function readAll(route, headers, status) {
  const items = [];
  const cursors = new Set();
  let cursor = null;
  do {
    const url = new URL(PROD_WORKER + '/read/canonical/' + route);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const page = await fetchJson(url.href, { headers });
    verifyAuthority(page, status);
    if (typeof page.read_only !== 'boolean') throw new Error(route + ' read_only missing');
    if (page.read_only !== (page.mode !== 'ACTIVE')) throw new Error(route + ' read_only/mode mismatch');
    if (!Array.isArray(page.items)) throw new Error(route + ' items missing');
    items.push(...page.items);
    cursor = page.next_cursor || null;
    if (cursor && cursors.has(cursor)) throw new Error(route + ' cursor repeated');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

function uniqueCount(items, key) {
  return new Set(items.map(row => String(row?.[key] ?? ''))).size;
}

function validateCredits(credits, customerIds) {
  let tagged = 0;
  let scheduled = 0;
  for (const credit of credits) {
    if (!customerIds.has(String(credit.customer_id))) throw new Error('credit references missing customer');
    if (credit.account_id) tagged += 1;
    if (credit.installments_json) {
      let rows;
      try { rows = JSON.parse(credit.installments_json); } catch { throw new Error('invalid installments_json'); }
      if (!Array.isArray(rows)) throw new Error('invalid installment schedule');
      if (rows.length) scheduled += 1;
      rows.forEach((row, index) => {
        if (Number(row.number) !== index + 1) throw new Error('installment order mismatch');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.due_date || ''))) throw new Error('invalid installment date');
        if (!Number.isSafeInteger(Number(row.amount_cents)) || Number(row.amount_cents) <= 0) throw new Error('invalid installment amount');
      });
    }
  }
  return { tagged, scheduled };
}

function writeSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## V1.3 CANON Owner Validation — READ ONLY',
    '- Status: PASS',
    '- Authority: canonical / ACTIVE',
    '- Products: ' + result.products,
    '- Customers: ' + result.customers,
    '- Credits: ' + result.credits,
    '- Credit payments: ' + result.credit_payments,
    '- Custom credit accounts: ' + result.credit_accounts,
    '- Credits with V2 metadata: ' + result.v2_tagged_credits,
    '- Credits with persisted schedules: ' + result.scheduled_credits,
    '- Business counts changed: NO',
    '- Temporary session cleaned: YES',
    '',
  ].join('\n'));
}

requireEnv();
const before = await businessSnapshot();
let sessionId = null;
let validationError = null;
let result = null;

try {
  const health = await fetchJson(PROD_WORKER + '/health');
  if (health.ok !== true || health.service !== 'nuevo-amanecer-pos-prod' || health.d1 !== 'ok') {
    throw new Error('production health failed');
  }

  const activated = await fetchJson(PROD_WORKER + '/auth/activate', {
    method: 'POST',
    headers: { 'x-activation-secret': ACTIVATION_SECRET },
  });
  if (typeof activated.session_token !== 'string' || !activated.session_token) throw new Error('activation token missing');
  const authHeaders = { authorization: 'Bearer ' + activated.session_token };

  const session = await fetchJson(PROD_WORKER + '/auth/session', { headers: authHeaders });
  if (typeof session.session_id !== 'string' || !session.session_id) throw new Error('session id missing');
  sessionId = session.session_id;

  const status = await fetchJson(PROD_WORKER + '/read/canonical/status', { headers: authHeaders });
  if (status.authority !== 'canonical' || status.mode !== 'ACTIVE' || status.promotion_id !== PROMOTION) {
    throw new Error('canonical status invalid');
  }
  if (!Number.isSafeInteger(Number(status.financial_revision)) || Number(status.financial_revision) < 0) {
    throw new Error('financial revision invalid');
  }

  const [products, customers, credits, creditPayments, creditAccounts] = await Promise.all([
    readAll('products', authHeaders, status),
    readAll('customers', authHeaders, status),
    readAll('credits', authHeaders, status),
    readAll('credit-payments', authHeaders, status),
    readAll('credit-accounts', authHeaders, status),
  ]);

  if (products.length === 0) throw new Error('production products are empty');
  if (customers.length === 0) throw new Error('production customers are empty');
  if (credits.length === 0) throw new Error('production credits are empty');
  if (uniqueCount(products, 'product_id') !== products.length) throw new Error('duplicate product ids');
  if (uniqueCount(customers, 'customer_id') !== customers.length) throw new Error('duplicate customer ids');
  const creditIdentities = credits.map(row => String(row.provenance || 'IMPORT') + ':' + String(row.credit_id || ''));
  if (creditIdentities.some(value => /:$/.test(value))) throw new Error('credit identity missing');
  if (new Set(creditIdentities).size !== credits.length) throw new Error('duplicate credit identities');

  const customerIds = new Set(customers.map(row => String(row.customer_id)));
  for (const account of creditAccounts) {
    if (!customerIds.has(String(account.customer_id))) throw new Error('credit account references missing customer');
    if (!['accumulated','separate'].includes(account.mode)) throw new Error('invalid credit account mode');
  }
  const creditShape = validateCredits(credits, customerIds);

  if (products.length !== before.products) throw new Error('product read count differs from D1');
  if (customers.length !== before.customers) throw new Error('customer read count differs from D1');
  if (credits.length !== before.import_credits + before.live_credits) throw new Error('credit read count differs from D1');
  if (creditAccounts.length !== before.credit_accounts) throw new Error('credit account read count differs from D1');

  result = {
    authority: status.authority,
    mode: status.mode,
    revision: Number(status.revision),
    authority_epoch: Number(status.authority_epoch),
    financial_revision: Number(status.financial_revision),
    products: products.length,
    customers: customers.length,
    credits: credits.length,
    credit_payments: creditPayments.length,
    credit_accounts: creditAccounts.length,
    v2_tagged_credits: creditShape.tagged,
    scheduled_credits: creditShape.scheduled,
  };
} catch (error) {
  validationError = error;
} finally {
  if (sessionId) {
    await query('temporary session cleanup', 'DELETE FROM auth_sessions WHERE session_id=?1', [sessionId]);
    await query('temporary principal cleanup', 'DELETE FROM devices WHERE device_id=?1', ['session:' + sessionId]);
  }
}

const after = await businessSnapshot();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('business state changed during readonly validation');
if (validationError) throw validationError;
if (!result) throw new Error('validation result missing');

writeSummary(result);
console.log(JSON.stringify({
  state: 'CANON_OWNER_VALIDATION_READONLY_PASS',
  ...result,
  business_state_unchanged: true,
  temporary_session_cleaned: true,
}));
