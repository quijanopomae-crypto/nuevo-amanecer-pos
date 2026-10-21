// One operation_id names exactly one accepted command across every canonical
// ledger. Each table below is the idempotency receipt of a command family
// (sale, cash/payment, expense, product, inventory, customer, credit, control).
// Derived rows (sale_items, movements, effects, write guards, owner approvals)
// are not receipts and are deliberately absent.

import { TursoD1Adapter } from './turso-d1-adapter.js';

export const OPERATION_LEDGER_TABLES = Object.freeze([
  'sales',
  'canonical_financial_operations',
  'canonical_expense_operations',
  'canonical_expense_revisions',
  'canonical_product_operations',
  'canonical_product_revisions',
  'canonical_inventory_operations',
  'canonical_credit_accounts',
  'canonical_credit_metadata',
  'canonical_customer_operations',
  'canonical_customer_credit_policy_operations',
  'canonical_customer_contacts',
  'canonical_command_receipts',
]);

// Short, stable label for the 409 detail (never a table name contract for clients beyond this map).
export const OPERATION_LEDGER_LABELS = Object.freeze({
  sales: 'sale',
  canonical_financial_operations: 'financial',
  canonical_expense_operations: 'expense',
  canonical_expense_revisions: 'expense_revision',
  canonical_product_operations: 'product',
  canonical_product_revisions: 'product_revision',
  canonical_inventory_operations: 'inventory',
  canonical_credit_accounts: 'credit_account',
  canonical_credit_metadata: 'credit',
  canonical_customer_operations: 'customer',
  canonical_customer_credit_policy_operations: 'credit_policy',
  canonical_customer_contacts: 'customer_contact',
  canonical_command_receipts: 'control',
});

// 409 body when another ledger owns the id. Same error code as a same-ledger
// mismatch (clients already quarantine it), plus a distinguishable detail.
// Never a stale_* code: the operation does exist on the server, under another command.
export function crossLedgerConflict(operationId, row) {
  return { error: 'operation_id_conflict', operation_id: operationId, conflict: 'cross_ledger',
    ledger: OPERATION_LEDGER_LABELS[row?.ledger] || 'other' };
}

// Per-isolate cache of which ledger tables exist. Keyed by the database
// *identity* as a string: 'turso:<TURSO_DATABASE_URL>' for the Turso adapter,
// 'd1' otherwise. Never keyed by the env/db object (worker-entry.js copies env
// on every request, so object keys never hit) and never by the D1 binding, so a
// Turso schema can never be confused with the old D1 one.
// TTL: all 13 present -> kept for the isolate's life (migrations are additive;
// a dropped table would make the ledger SQL fail with "no such table" = the
// write is rejected, never silently accepted). Some missing -> re-probe after
// 60 s, so a newly migrated ledger is picked up without a deploy.
const ledgerCache = new Map();
const ORDER = new Map(OPERATION_LEDGER_TABLES.map((name, index) => [name, index]));
const LEDGER_TTL_INCOMPLETE_MS = 60000;
const LEDGER_LIST_SQL = OPERATION_LEDGER_TABLES.map(name => `'${name}'`).join(',');

export function operationLedgerCacheKey(db) {
  return db instanceof TursoD1Adapter ? 'turso:' + db.baseUrl : 'd1';
}

// Tests build many databases (different schemas) in one process: reset between fixtures.
export function resetOperationLedgerCache() { ledgerCache.clear(); }

// Scalar column to fold the ledger probe into a sqlite_master read that a
// command already does (no extra statement or round trip).
export const OPERATION_LEDGER_COLUMN_SQL =
  `(SELECT group_concat(name) FROM sqlite_master WHERE type='table' AND name IN (${LEDGER_LIST_SQL}))`;

// Remember exactly the ledgers that exist now (no union with older answers).
export function rememberOperationLedgers(db, names) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return;
  const tables = OPERATION_LEDGER_TABLES.filter(name => names.has(name));
  ledgerCache.set(operationLedgerCacheKey(db), { tables,
    expiresAt: tables.length === OPERATION_LEDGER_TABLES.length ? Infinity : Date.now() + LEDGER_TTL_INCOMPLETE_MS });
}

// Same, from the value of OPERATION_LEDGER_COLUMN_SQL (comma-separated names or NULL).
export function rememberOperationLedgerColumn(db, value) {
  rememberOperationLedgers(db, new Set(String(value || '').split(',').filter(Boolean)));
}

// Existing ledger tables: from the isolate cache when fresh (no round trip),
// otherwise one sqlite_master read (cold isolate whose command has no probe to fold into).
export async function operationLedgers(db) {
  const cached = ledgerCache.get(operationLedgerCacheKey(db));
  if (cached && Date.now() < cached.expiresAt) return cached.tables;
  const rows = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${LEDGER_LIST_SQL})`).all();
  rememberOperationLedgers(db, new Set((rows?.results ?? []).map(row => row.name)));
  return ledgerCache.get(operationLedgerCacheKey(db)).tables;
}

const others = (tables, own) => tables.filter(name => !own.includes(name)).sort((a, b) => ORDER.get(a) - ORDER.get(b));

// SQL predicate: true when operation_id (parameter `param`) already lives in another ledger.
export function foreignOperationSql(tables, own = [], param = '?1') {
  const list = others(tables, own);
  return list.length ? '(' + list.map(name => `EXISTS(SELECT 1 FROM ${name} WHERE operation_id=${param})`).join(' OR ') + ')' : '0';
}

// Read statement: first foreign ledger holding the operation_id, or no row.
export function foreignOperationRead(db, operationId, tables, own = []) {
  const list = others(tables, own);
  if (!list.length) return db.prepare('SELECT NULL AS ledger WHERE 0');
  return db.prepare(`SELECT ledger FROM (${list.map(name => `SELECT '${name}' AS ledger FROM ${name} WHERE operation_id=?1`).join(' UNION ALL ')}) LIMIT 1`).bind(operationId);
}

// Scalar subquery: name of the first other ledger holding `param`, or NULL.
export function foreignOperationLedgerSql(tables, own = [], param = '?1') {
  const list = others(tables, own);
  return list.length ? `(SELECT ledger FROM (${list.map(name => `SELECT '${name}' AS ledger FROM ${name} WHERE operation_id=${param}`).join(' UNION ALL ')}) LIMIT 1)` : 'NULL';
}

// Scalar subquery for packed reads: JSON {ledger,operation_id} of the first id in
// `params` (SQL placeholders, e.g. ['?3','?4']) owned by another ledger, or NULL.
export function foreignOperationsJsonSql(tables, own = [], params = ['?1']) {
  const list = others(tables, own);
  if (!list.length || !params.length) return 'NULL';
  const ids = params.join(',');
  return `(SELECT json_object('ledger',ledger,'operation_id',operation_id) FROM (${list.map(name => `SELECT '${name}' AS ledger,operation_id FROM ${name} WHERE operation_id IN (${ids})`).join(' UNION ALL ')}) LIMIT 1)`;
}

export async function foreignOperationLedger(db, operationId, own = []) {
  const row = await foreignOperationRead(db, operationId, await operationLedgers(db), own).first();
  return row?.ledger || null;
}

// Atomic fence inside a write batch: aborts the batch (CHECK ok=1) if another
// ledger claimed the operation_id between the pre-read and the commit.
export function foreignOperationAssertion(db, assertionId, operationId, tables, own = []) {
  return db.prepare(`INSERT INTO canonical_assertions(assertion_id,ok)
    SELECT ?2,CASE WHEN ${foreignOperationSql(tables, own, '?1')} THEN 0 ELSE 1 END`).bind(operationId, assertionId);
}
