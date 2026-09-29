import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';
const PROD_WORKER = process.env.PROD_WORKER_URL || 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
const PROMOTION = 'promotion-a5-mery43250-2026-09-20-v3';

function requireEnv() {
  if (!/^[a-f0-9]{32}$/.test(ACCOUNT)) throw new Error('invalid CLOUDFLARE_ACCOUNT_ID');
  if (!TOKEN) throw new Error('missing CLOUDFLARE_API_TOKEN');
}

function env(name, value) {
  if (!process.env.GITHUB_ENV) return;
  appendFileSync(process.env.GITHUB_ENV, name + '=' + String(value) + '\n');
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

async function query(database, label, sql, params) {
  const result = await cf('/d1/database/' + database + '/query', {
    method: 'POST',
    body: JSON.stringify(params ? { sql, params } : { sql }),
  });
  const first = Array.isArray(result) ? result[0] : result;
  if (!first || first.success === false) throw new Error(label + ' returned failure');
  return Array.isArray(first.results) ? first.results : [];
}

async function productionState() {
  const control = (await query(PROD_DB, 'control',
    "SELECT mode,active_promotion_id,revision,authority_epoch,minimum_client_contract,first_live_operation_id FROM canonical_control WHERE id=1"))[0];
  if (!control) throw new Error('canonical_control missing');

  const schema = (await query(PROD_DB, 'schema',
    "SELECT " +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions') has_auth_sessions," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_financial_operations') has_financial_operations," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_write_guards') has_write_guards," +
    "COALESCE((SELECT instr(sql,'principal_id')>0 FROM sqlite_master WHERE type='table' AND name='canonical_write_guards'),0) has_principal_guard," +
    "COALESCE((SELECT instr(sql,'credential_hash')>0 FROM sqlite_master WHERE type='table' AND name='canonical_write_guards'),0) has_credential_guard," +
    "COALESCE((SELECT instr(sql,'NEW.principal_id')>0 FROM sqlite_master WHERE type='trigger' AND name='canonical_write_guards_authorized_insert'),0) has_session_trigger," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_credit_accounts') has_credit_accounts," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_credit_metadata') has_credit_metadata," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_credit_installments') has_credit_installments," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_expense_operations') has_expense_operations," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_expenses') has_expenses," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_product_operations') has_product_operations," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_live_products') has_live_products_table," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_live_inventory_effects') has_live_inventory_effects," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_inventory_operations') has_inventory_operations," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_manual_inventory_movements') has_manual_inventory_movements," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_generic_sale_lines') has_generic_sale_lines_table," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_operations') has_customer_operations," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_registry') has_customer_registry," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_live_customers') has_live_customers_table," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_credit_policy_operations') has_customer_credit_policy_operations," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_credit_policies') has_customer_credit_policies," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='customer_credit_policy_update_guard') has_customer_credit_policy_update_guard," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='customer_credit_policy_operations_no_update') has_customer_credit_policy_operations_no_update," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='customer_credit_policy_operations_no_delete') has_customer_credit_policy_operations_no_delete," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='customer_credit_policy_no_delete') has_customer_credit_policy_no_delete"))[0];

  const traffic = (await query(PROD_DB, 'traffic',
    "SELECT " +
    "(SELECT COUNT(*) FROM sales) sales," +
    "(SELECT COUNT(*) FROM sale_items) sale_items," +
    "(SELECT COUNT(*) FROM cash_movements) cash_movements," +
    "(SELECT COUNT(*) FROM inventory_movements) inventory_movements," +
    "(SELECT COUNT(*) FROM sync_operations) sync_operations"))[0];

  traffic.financial_operations = Number(schema.has_financial_operations)
    ? Number((await query(PROD_DB, 'financial operations', "SELECT COUNT(*) n FROM canonical_financial_operations"))[0]?.n || 0)
    : 0;
  traffic.active_sessions = Number(schema.has_auth_sessions)
    ? Number((await query(PROD_DB, 'active sessions', "SELECT COUNT(*) n FROM auth_sessions WHERE status='active'"))[0]?.n || 0)
    : 0;

  const numericSchema = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, Number(value)]));
  numericSchema.has_expenses_v1 = Number(numericSchema.has_expense_operations === 1 && numericSchema.has_expenses === 1);
  numericSchema.has_live_products = Number(
    numericSchema.has_product_operations === 1 &&
    numericSchema.has_live_products_table === 1 &&
    numericSchema.has_live_inventory_effects === 1
  );
  numericSchema.has_inventory_adjust = Number(
    numericSchema.has_inventory_operations === 1 &&
    numericSchema.has_manual_inventory_movements === 1
  );
  numericSchema.has_generic_sale_lines = Number(numericSchema.has_generic_sale_lines_table === 1);
  numericSchema.has_live_customers = Number(
    numericSchema.has_customer_operations === 1 &&
    numericSchema.has_customer_registry === 1 &&
    numericSchema.has_live_customers_table === 1
  );
  numericSchema.has_customer_credit_policy = Number(
    numericSchema.has_customer_credit_policy_operations === 1 &&
    numericSchema.has_customer_credit_policies === 1 &&
    numericSchema.has_customer_credit_policy_update_guard === 1 &&
    numericSchema.has_customer_credit_policy_operations_no_update === 1 &&
    numericSchema.has_customer_credit_policy_operations_no_delete === 1 &&
    numericSchema.has_customer_credit_policy_no_delete === 1
  );

  return {
    control: {
      ...control,
      revision: Number(control.revision),
      authority_epoch: Number(control.authority_epoch),
    },
    schema: numericSchema,
    traffic: Object.fromEntries(Object.entries(traffic).map(([key, value]) => [key, Number(value)])),
  };
}

function assertMigrationGroupsCompleteOrAbsent(state) {
  const groups = {
    '0013_canonical_expenses.sql': ['has_expense_operations','has_expenses'],
    '0014_canonical_live_products.sql': ['has_product_operations','has_live_products_table','has_live_inventory_effects'],
    '0015_canonical_inventory_adjust.sql': ['has_inventory_operations','has_manual_inventory_movements'],
    '0016_canonical_generic_sale_lines.sql': ['has_generic_sale_lines_table'],
    '0017_canonical_live_customers.sql': ['has_customer_operations','has_customer_registry','has_live_customers_table'],
    '0018_canonical_customer_credit_policy.sql': [
      'has_customer_credit_policy_operations',
      'has_customer_credit_policies',
      'has_customer_credit_policy_update_guard',
      'has_customer_credit_policy_operations_no_update',
      'has_customer_credit_policy_operations_no_delete',
      'has_customer_credit_policy_no_delete',
    ],
  };
  for (const [migration, keys] of Object.entries(groups)) {
    const present = keys.reduce((sum, key) => sum + Number(state.schema[key] === 1), 0);
    if (present !== 0 && present !== keys.length) {
      throw new Error('partial production schema for ' + migration);
    }
  }
}

function assertCleanPreFirstSale(state) {
  assertMigrationGroupsCompleteOrAbsent(state);
  const c = state.control;
  if (c.mode !== 'ACTIVE') throw new Error('production authority is not ACTIVE');
  if (c.active_promotion_id !== PROMOTION) throw new Error('unexpected active promotion');
  if (c.minimum_client_contract !== 'a6-gate-c-v1') throw new Error('unexpected client contract');
  if (c.first_live_operation_id !== null) throw new Error('first live operation already exists');
  for (const key of ['sales','sale_items','cash_movements','inventory_movements','sync_operations','financial_operations']) {
    if (Number(state.traffic[key]) !== 0) throw new Error('unexpected pre-cutover traffic: ' + key);
  }
}

async function cmdPreflight() {
  const state = await productionState();
  assertCleanPreFirstSale(state);
  env('CUTOVER_CONTROL_REVISION', state.control.revision);
  env('CUTOVER_AUTHORITY_EPOCH', state.control.authority_epoch);
  env('HAS_AUTH_SESSIONS', state.schema.has_auth_sessions);
  env('HAS_PRINCIPAL_GUARD', state.schema.has_principal_guard);
  env('HAS_SESSION_TRIGGER', state.schema.has_session_trigger);
  env('HAS_CREDIT_ACCOUNTS_V2', state.schema.has_credit_accounts);
  env('HAS_CREDIT_METADATA_V2', state.schema.has_credit_metadata);
  env('HAS_CREDIT_INSTALLMENTS_V2', state.schema.has_credit_installments);
  env('HAS_EXPENSES_V1', state.schema.has_expenses_v1);
  env('HAS_LIVE_PRODUCTS', state.schema.has_live_products);
  env('HAS_INVENTORY_ADJUST', state.schema.has_inventory_adjust);
  env('HAS_GENERIC_SALE_LINES', state.schema.has_generic_sale_lines);
  env('HAS_LIVE_CUSTOMERS', state.schema.has_live_customers);
  env('HAS_CUSTOMER_CREDIT_POLICY', state.schema.has_customer_credit_policy);
  env('CUTOVER_ACTIVE_SESSIONS', state.traffic.active_sessions);
  console.log(JSON.stringify({ state: 'PRE_CUTOVER_PASS', database_id: PROD_DB, ...state }));
}

async function cmdExport() {
  const endpoint = '/d1/database/' + PROD_DB + '/export';
  const start = await cf(endpoint, { method: 'POST', body: JSON.stringify({ output_format: 'polling' }) });
  if (!start?.at_bookmark) throw new Error('missing export bookmark');

  let complete = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await cf(endpoint, {
      method: 'POST',
      body: JSON.stringify({ output_format: 'polling', current_bookmark: start.at_bookmark }),
    });
    if (result?.status === 'error') throw new Error('D1 export failed');
    if (result?.status === 'complete' && result?.result?.signed_url) {
      complete = result;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!complete) throw new Error('D1 export timed out');

  const download = await fetch(complete.result.signed_url);
  if (!download.ok) throw new Error('D1 export download failed');
  const bytes = Buffer.from(await download.arrayBuffer());
  if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('invalid export size');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  writeFileSync('/tmp/v1.3-pre-cutover.sql', bytes);
  writeFileSync('/tmp/v1.3-pre-cutover.sha256', sha256);
  console.log(JSON.stringify({ state: 'BACKUP_EXPORTED', database_id: PROD_DB, size_bytes: bytes.length, sha256 }));
}

async function cmdCreateRehearsal() {
  const name = 'nuevo-amanecer-v13-cutover-rehearsal-' + (process.env.GITHUB_RUN_ID || Date.now());
  const result = await cf('/d1/database', { method: 'POST', body: JSON.stringify({ name }) });
  if (!result?.uuid) throw new Error('temporary D1 creation failed');
  env('REHEARSAL_DB_NAME', name);
  env('REHEARSAL_DB_ID', result.uuid);
  console.log(JSON.stringify({ state: 'REHEARSAL_CREATED', name, id: result.uuid }));
}

async function schemaReady(database) {
  const row = (await query(database, 'schema readiness',
    "SELECT " +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions') auth," +
    "COALESCE((SELECT instr(sql,'principal_id')>0 FROM sqlite_master WHERE type='table' AND name='canonical_write_guards'),0) principal," +
    "COALESCE((SELECT instr(sql,'credential_hash')>0 FROM sqlite_master WHERE type='table' AND name='canonical_write_guards'),0) credential," +
    "COALESCE((SELECT instr(sql,'NEW.principal_id')>0 FROM sqlite_master WHERE type='trigger' AND name='canonical_write_guards_authorized_insert'),0) guard," +
    "(SELECT mode='ACTIVE' FROM canonical_control WHERE id=1) active," +
    "(SELECT first_live_operation_id IS NULL FROM canonical_control WHERE id=1) first_live_empty," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_credit_accounts') credit_accounts," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_credit_metadata') credit_metadata," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_credit_installments') credit_installments," +
    "(EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_expense_operations') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_expenses')) expenses_v1," +
    "(EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_product_operations') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_live_products') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_live_inventory_effects')) live_products," +
    "(EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_inventory_operations') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_manual_inventory_movements')) inventory_adjust," +
    "EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_generic_sale_lines') generic_sale_lines," +
    "(EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_operations') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_registry') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_live_customers')) live_customers," +
    "(EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_credit_policy_operations') AND EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='canonical_customer_credit_policies')) customer_credit_policy," +
    "(SELECT COUNT(*) FROM sales) sales"))[0];

  const ready = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, Number(value)]));
  const quickRows = await query(database, 'PRAGMA quick_check', 'PRAGMA quick_check;');
  ready.quick_check = String(Object.values(quickRows[0] || {})[0] || '').toLowerCase();
  ready.foreign_key_violations = (await query(database, 'PRAGMA foreign_key_check', 'PRAGMA foreign_key_check;')).length;
  ready.v17_residue_objects = (await query(database, '__v17 residue',
    "SELECT type,name FROM sqlite_master WHERE name LIKE '%__v17%' OR instr(COALESCE(sql,''),'__v17') > 0;")).length;

  const policyTables = ['canonical_customer_credit_policy_operations','canonical_customer_credit_policies'];
  let policyFks = 0;
  for (const table of policyTables) {
    const rows = await query(database, 'customer credit policy FK ' + table, 'PRAGMA foreign_key_list("' + table + '");');
    if (rows.some(item => String(item.table) === 'canonical_customer_registry')) policyFks++;
  }
  ready.customer_credit_policy_fks = policyFks;
  ready.customer_credit_policy_guards = Number((await query(database, 'customer credit policy guards',
    "SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name IN (" +
    "'customer_credit_policy_operation_authorized_insert'," +
    "'customer_credit_policy_operations_no_update'," +
    "'customer_credit_policy_operations_no_delete'," +
    "'customer_credit_policy_operations_no_replace'," +
    "'customer_credit_policy_insert_guard'," +
    "'customer_credit_policy_update_guard'," +
    "'customer_credit_policy_no_delete'," +
    "'customer_credit_policy_no_replace')"))[0]?.n || 0);
  const policyCas = (await query(database, 'customer credit policy CAS',
    "SELECT " +
    "COALESCE((SELECT instr(sql,'expected_policy_revision')>0 FROM sqlite_master WHERE type='table' AND name='canonical_customer_credit_policy_operations'),0) has_expected_revision," +
    "COALESCE((SELECT instr(sql,'OLD.revision')>0 AND instr(sql,'NEW.revision=OLD.revision+1')>0 FROM sqlite_master WHERE type='trigger' AND name='customer_credit_policy_update_guard'),0) has_revision_guard"))[0] || {};
  ready.customer_credit_policy_cas = Number(policyCas.has_expected_revision === 1 && policyCas.has_revision_guard === 1);

  const customerTables = ['canonical_sale_context','live_credits','canonical_credit_accounts','canonical_credit_metadata'];
  let registryFks = 0;
  for (const table of customerTables) {
    const rows = await query(database, 'customer registry FK ' + table, 'PRAGMA foreign_key_list("' + table + '");');
    if (rows.some(item => String(item.table) === 'canonical_customer_registry')) registryFks++;
  }
  ready.customer_registry_fks = registryFks;
  return ready;
}

function assertSchemaReady(row, label) {
  for (const key of [
    'auth','principal','credential','guard','active','first_live_empty',
    'credit_accounts','credit_metadata','credit_installments','expenses_v1',
    'live_products','inventory_adjust','generic_sale_lines','live_customers','customer_credit_policy',
  ]) {
    if (row[key] !== 1) throw new Error(label + ' invariant failed: ' + key);
  }
  if (row.customer_credit_policy_fks !== 2) throw new Error(label + ' customer credit policy FK graph incomplete');
  if (row.customer_credit_policy_guards !== 8) throw new Error(label + ' customer credit policy guard set incomplete');
  if (row.customer_credit_policy_cas !== 1) throw new Error(label + ' customer credit policy CAS guard incomplete');
  if (row.sales !== 0) throw new Error(label + ' contains sales');
  if (row.quick_check !== 'ok') throw new Error(label + ' PRAGMA quick_check failed');
  if (row.foreign_key_violations !== 0) throw new Error(label + ' PRAGMA foreign_key_check failed');
  if (row.v17_residue_objects !== 0) throw new Error(label + ' __v17 residue remains');
  if (row.customer_registry_fks !== 4) throw new Error(label + ' customer registry FK graph incomplete');
}

async function cmdVerifyRehearsal() {
  const id = process.env.REHEARSAL_DB_ID;
  if (!id) throw new Error('missing REHEARSAL_DB_ID');
  const row = await schemaReady(id);
  assertSchemaReady(row, 'rehearsal');
  console.log(JSON.stringify({ state: 'REHEARSAL_PASS', schema: row }));
}

async function cmdRecheck() {
  const state = await productionState();
  assertCleanPreFirstSale(state);
  if (state.control.revision !== Number(process.env.CUTOVER_CONTROL_REVISION) ||
      state.control.authority_epoch !== Number(process.env.CUTOVER_AUTHORITY_EPOCH)) {
    throw new Error('production authority changed during rehearsal');
  }
  const baselineActiveSessions = Number(process.env.CUTOVER_ACTIVE_SESSIONS);
  if (!Number.isSafeInteger(baselineActiveSessions) || baselineActiveSessions < 0) throw new Error('missing active session baseline');
  if (state.traffic.active_sessions !== baselineActiveSessions) throw new Error('active session baseline changed before production mutation');
  console.log(JSON.stringify({ state: 'PRODUCTION_RECHECK_PASS', revision: state.control.revision, authority_epoch: state.control.authority_epoch, active_sessions: state.traffic.active_sessions }));
}

async function cmdVerifyProduction() {
  const state = await productionState();
  assertCleanPreFirstSale(state);
  const row = await schemaReady(PROD_DB);
  assertSchemaReady(row, 'production');
  console.log(JSON.stringify({ state: 'PRODUCTION_MIGRATIONS_PASS', schema: row }));
}

async function cmdProbeWorker() {
  const secret = process.env.POS_ACTIVATION_SECRET || '';
  if (!secret) throw new Error('missing POS_ACTIVATION_SECRET');
  let sessionId = null;
  try {
    let activation = null;
    let activated = null;
    for (let attempt = 1; attempt <= 12; attempt++) {
      activation = await fetch(PROD_WORKER + '/auth/activate', {
        method: 'POST',
        headers: { 'x-activation-secret': secret },
      });
      activated = await activation.json().catch(() => null);
      if (activation.ok && typeof activated?.session_token === 'string' && activated.session_token) break;

      const errorCode = typeof activated?.error === 'string' ? activated.error : 'invalid_response';
      if (activation.status === 503 && errorCode === 'activation_not_configured' && attempt < 12) {
        console.log(JSON.stringify({
          state: 'PRODUCTION_ACTIVATION_WAIT',
          attempt,
          status: activation.status,
          error: errorCode,
        }));
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      throw new Error('production activation probe failed: status=' + activation.status + ' error=' + errorCode);
    }

    if (!activation?.ok || typeof activated?.session_token !== 'string' || !activated.session_token) {
      throw new Error('production activation probe failed after propagation retries');
    }
    const sessionToken = activated.session_token;

    const session = await fetch(PROD_WORKER + '/auth/session', {
      headers: { authorization: 'Bearer ' + sessionToken },
    });
    const sessionBody = await session.json().catch(() => null);
    if (!session.ok || typeof sessionBody?.session_id !== 'string') throw new Error('production session probe failed');
    sessionId = sessionBody.session_id;

    const status = await fetch(PROD_WORKER + '/read/canonical/status', {
      headers: { authorization: 'Bearer ' + sessionToken },
    });
    const canonical = await status.json().catch(() => null);
    if (!status.ok || canonical?.authority !== 'canonical' || canonical?.mode !== 'ACTIVE' || canonical?.promotion_id !== PROMOTION) {
      throw new Error('canonical production read probe failed');
    }
    for (const path of ['/read/canonical/products?limit=5','/read/canonical/customers?limit=5']) {
      const response = await fetch(PROD_WORKER + path, { headers: { authorization: 'Bearer ' + sessionToken } });
      const body = await response.json().catch(() => null);
      if (!response.ok || body == null) throw new Error('canonical production route probe failed: ' + path);
    }
    console.log(JSON.stringify({
      state: 'PRODUCTION_WORKER_PROBE_PASS',
      mode: canonical.mode,
      promotion_id: canonical.promotion_id,
      revision: canonical.revision,
      authority_epoch: canonical.authority_epoch,
      financial_revision: canonical.financial_revision || 0,
    }));
  } finally {
    if (sessionId) {
      await query(PROD_DB, 'probe session delete', "DELETE FROM auth_sessions WHERE session_id=?1", [sessionId]);
      await query(PROD_DB, 'probe principal delete', "DELETE FROM devices WHERE device_id=?1", ['session:' + sessionId]);
    }
  }
}

async function cmdFinal() {
  const state = await productionState();
  assertCleanPreFirstSale(state);
  const baselineActiveSessions = Number(process.env.CUTOVER_ACTIVE_SESSIONS);
  if (!Number.isSafeInteger(baselineActiveSessions) || baselineActiveSessions < 0) throw new Error('missing active session baseline');
  if (state.traffic.active_sessions !== baselineActiveSessions) throw new Error('probe session baseline changed');
  const row = await schemaReady(PROD_DB);
  assertSchemaReady(row, 'final');
  console.log(JSON.stringify({
    state: 'READY_FOR_FIRST_SALE',
    database_id: PROD_DB,
    mode: state.control.mode,
    promotion_id: state.control.active_promotion_id,
    revision: state.control.revision,
    authority_epoch: state.control.authority_epoch,
    first_live_operation_id: null,
    traffic: state.traffic,
  }));
}

const commands = {
  preflight: cmdPreflight,
  export: cmdExport,
  'create-rehearsal': cmdCreateRehearsal,
  'verify-rehearsal': cmdVerifyRehearsal,
  recheck: cmdRecheck,
  'verify-production': cmdVerifyProduction,
  'probe-worker': cmdProbeWorker,
  final: cmdFinal,
};

const command = process.argv[2];
if (!Object.hasOwn(commands, command)) {
  console.error('usage: cutover-prepare.mjs <' + Object.keys(commands).join('|') + '>');
  process.exit(2);
}

commands[command]().catch(error => {
  console.error(error.message);
  process.exit(1);
});
