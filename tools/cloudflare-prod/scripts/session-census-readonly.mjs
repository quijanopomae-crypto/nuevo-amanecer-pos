import { appendFileSync } from 'node:fs';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';

function requireEnv() {
  if (!/^[a-f0-9]{32}$/.test(ACCOUNT)) throw new Error('invalid CLOUDFLARE_ACCOUNT_ID');
  if (!TOKEN) throw new Error('missing CLOUDFLARE_API_TOKEN');
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

function num(value) {
  return Number(value || 0);
}

async function columns(table) {
  const rows = await query('pragma ' + table, 'PRAGMA table_info(' + table + ')');
  return new Set(rows.map(r => String(r.name)));
}

async function controlState() {
  const row = (await query('canonical control',
    'SELECT mode,revision,authority_epoch,first_live_operation_id FROM canonical_control WHERE id=1'))[0];
  if (!row) throw new Error('canonical_control missing');
  return {
    mode: row.mode,
    revision: num(row.revision),
    authority_epoch: num(row.authority_epoch),
    first_live_operation_id: row.first_live_operation_id === null || row.first_live_operation_id === undefined
      ? null : String(row.first_live_operation_id),
  };
}

async function sessionCensus() {
  const cols = await columns('auth_sessions');
  const hasExpires = cols.has('expires_at');

  const total = num((await query('sessions total', 'SELECT COUNT(*) n FROM auth_sessions'))[0]?.n);

  const byStatus = {};
  for (const row of await query('sessions by status',
    'SELECT status, COUNT(*) n FROM auth_sessions GROUP BY status')) {
    byStatus[String(row.status ?? 'unknown')] = num(row.n);
  }

  const bounds = (await query('session created bounds',
    'SELECT MIN(created_at) oldest, MAX(created_at) newest FROM auth_sessions'))[0] || {};

  let expiredActive = null;
  let liveActive = null;
  if (hasExpires) {
    expiredActive = num((await query('active but expired',
      "SELECT COUNT(*) n FROM auth_sessions WHERE status='active' AND expires_at IS NOT NULL AND expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')"))[0]?.n);
    liveActive = num((await query('active and not expired',
      "SELECT COUNT(*) n FROM auth_sessions WHERE status='active' AND (expires_at IS NULL OR expires_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now'))"))[0]?.n);
  }

  return {
    total,
    active: num(byStatus.active),
    revoked: num(byStatus.revoked),
    expired: num(byStatus.expired),
    other: total - num(byStatus.active) - num(byStatus.revoked) - num(byStatus.expired),
    status_breakdown: byStatus,
    oldest_session: bounds.oldest ?? null,
    newest_session: bounds.newest ?? null,
    has_expires_at: hasExpires,
    active_but_expired: expiredActive,
    active_and_live: liveActive,
  };
}

async function deviceCensus() {
  const byStatus = {};
  for (const row of await query('devices by status',
    'SELECT status, COUNT(*) n FROM devices GROUP BY status')) {
    byStatus[String(row.status ?? 'unknown')] = num(row.n);
  }
  const sessionPrincipals = num((await query('session principals',
    "SELECT COUNT(*) n FROM devices WHERE device_id LIKE 'session:%'"))[0]?.n);
  return { status_breakdown: byStatus, session_principals: sessionPrincipals };
}

async function trafficState() {
  const row = (await query('traffic',
    'SELECT (SELECT COUNT(*) FROM sales) sales,' +
    '(SELECT COUNT(*) FROM sale_items) sale_items,' +
    '(SELECT COUNT(*) FROM cash_movements) cash_movements,' +
    '(SELECT COUNT(*) FROM inventory_movements) inventory_movements,' +
    '(SELECT COUNT(*) FROM sync_operations) sync_operations,' +
    '(SELECT COUNT(*) FROM canonical_financial_operations) financial_operations'))[0];
  return Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, num(v)]));
}

function writeSummary(payload) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const s = payload.sessions;
  const t = payload.traffic;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## V1.3 Session Census — READ ONLY',
    '- Status: SESSION_CENSUS_READONLY_PASS',
    '- canonical_mode: ' + payload.canonical_mode,
    '- first_live_operation_id: ' + (payload.first_live_operation_id ?? 'NULL'),
    '- sessions_total: ' + s.total,
    '- sessions_active: ' + s.active,
    '- sessions_expired: ' + s.expired,
    '- sessions_revoked: ' + s.revoked,
    '- sessions_other: ' + s.other,
    '- active_but_expired: ' + (s.active_but_expired ?? 'n/a'),
    '- active_and_live: ' + (s.active_and_live ?? 'n/a'),
    '- oldest_session: ' + (s.oldest_session ?? 'n/a'),
    '- newest_session: ' + (s.newest_session ?? 'n/a'),
    '- sales: ' + t.sales,
    '- sale_items: ' + t.sale_items,
    '- cash_movements: ' + t.cash_movements,
    '- inventory_movements: ' + t.inventory_movements,
    '- sync_operations: ' + t.sync_operations,
    '- financial_operations: ' + t.financial_operations,
    '- COMMERCIAL_TRAFFIC_ZERO: ' + payload.commercial_traffic_zero,
    '- ACTIVE_SESSIONS_EXPLAINED: ' + payload.active_sessions_explained,
    '',
  ].join('\n'));
}

requireEnv();
const control = await controlState();
const sessions = await sessionCensus();
const devices = await deviceCensus();
const traffic = await trafficState();

const commercialTrafficZero =
  traffic.sales === 0 && traffic.sale_items === 0 && traffic.cash_movements === 0 &&
  traffic.inventory_movements === 0 && traffic.sync_operations === 0 &&
  traffic.financial_operations === 0 && control.first_live_operation_id === null;

const activeSessionsExplained =
  commercialTrafficZero && sessions.active > 0;

const payload = {
  state: 'SESSION_CENSUS_READONLY_PASS',
  canonical_mode: control.mode,
  first_live_operation_id: control.first_live_operation_id,
  revision: control.revision,
  authority_epoch: control.authority_epoch,
  sessions,
  devices,
  traffic,
  commercial_traffic_zero: commercialTrafficZero,
  active_sessions_explained: activeSessionsExplained,
};

writeSummary(payload);
console.log(JSON.stringify(payload));
