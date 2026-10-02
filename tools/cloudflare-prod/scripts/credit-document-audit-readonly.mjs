import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TursoD1Adapter } from '../../cloudflare-lab/src/turso-d1-adapter.js';

const TRIGGER_PATH = process.env.CREDIT_AUDIT_TRIGGER_PATH || 'ops/v1.3-turso-credit-document-audit-trigger.json';
const TURSO_URL = process.env.TURSO_PROD_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_PROD_AUTH_TOKEN || '';

function sha256(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function validHash(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function validateTrigger(trigger) {
  if (!trigger || trigger.format !== 'nuevo-amanecer-v1.3-turso-credit-document-audit-v1') throw new Error('invalid audit trigger format');
  if (trigger.authorized !== true || trigger.authorized_by !== 'owner' || trigger.mode !== 'readonly') throw new Error('owner readonly authorization missing');
  if (trigger.provider !== 'turso') throw new Error('audit provider must be turso');
  if (!Array.isArray(trigger.targets) || trigger.targets.length < 1 || trigger.targets.length > 10) throw new Error('invalid audit targets');
  const aliases = new Set();
  for (const target of trigger.targets) {
    if (!target || typeof target.alias !== 'string' || !/^[A-Z][A-Z0-9_-]{0,15}$/.test(target.alias)) throw new Error('invalid audit alias');
    if (aliases.has(target.alias)) throw new Error('duplicate audit alias');
    aliases.add(target.alias);
    if (!validHash(target.name_hash)) throw new Error('invalid customer name hash');
    if (!Number.isSafeInteger(target.expected_current_cents) || target.expected_current_cents < 0) throw new Error('invalid expected customer balance');
    if (!Array.isArray(target.expected_documents) || target.expected_documents.length < 1 || target.expected_documents.length > 30) throw new Error('invalid expected document set');
    const docs = new Set();
    for (const doc of target.expected_documents) {
      if (!doc || !validHash(doc.document_hash)) throw new Error('invalid document hash');
      if (docs.has(doc.document_hash)) throw new Error('duplicate expected document hash');
      docs.add(doc.document_hash);
      for (const key of ['total_cents', 'paid_cents', 'current_cents']) {
        if (!Number.isSafeInteger(doc[key]) || doc[key] < 0) throw new Error('invalid expected document amount');
      }
      if (doc.total_cents - doc.paid_cents !== doc.current_cents) throw new Error('expected document arithmetic mismatch');
    }
  }
  return trigger.targets;
}

function requireEnv() {
  if (!TURSO_URL) throw new Error('missing TURSO_PROD_DATABASE_URL');
  if (!TURSO_TOKEN) throw new Error('missing TURSO_PROD_AUTH_TOKEN');
}

async function all(db, sql, params = []) {
  const statement = db.prepare(sql);
  const result = params.length ? await statement.bind(...params).all() : await statement.all();
  return Array.isArray(result.results) ? result.results : [];
}

async function first(db, sql, params = []) {
  const statement = db.prepare(sql);
  return params.length ? statement.bind(...params).first() : statement.first();
}

async function schemaReady(db) {
  const row = await first(db, `
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type='view' AND name='canonical_credit_balances') AS balances_view,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='canonical_reconciliation_credits') AS reconciliation_table,
      (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='canonical_credit_installments') AS installments_table
  `);
  if (!row || Number(row.balances_view) !== 1 || Number(row.reconciliation_table) !== 1 || Number(row.installments_table) !== 1) {
    throw new Error('production credit audit schema not ready');
  }
}

async function control(db) {
  const row = await first(db, `SELECT mode,active_promotion_id,revision,authority_epoch FROM canonical_control WHERE id=1`);
  if (!row || row.mode !== 'ACTIVE' || !row.active_promotion_id) throw new Error('production CANON is not ACTIVE');
  return row;
}

async function identities(db, promotionId) {
  return all(db, `
    SELECT customer_id,name,'IMPORT' AS provenance
    FROM customers
    WHERE promotion_id=?1
    UNION ALL
    SELECT customer_id,name,'LIVE' AS provenance
    FROM canonical_live_customers
    WHERE promotion_id=?1
  `, [promotionId]);
}

async function creditRows(db, promotionId, customerId) {
  return all(db, `
    SELECT * FROM (
      SELECT
        'IMPORT' AS source,
        c.credit_id AS credit_id,
        c.document_number AS document_number,
        c.original_amount_cents + COALESCE(b.baseline_delta_cents,0) AS total_cents,
        b.current_balance_cents AS current_cents,
        c.import_paid_cents AS imported_paid_cents,
        c.due_value AS due_value,
        (SELECT COUNT(*) FROM canonical_credit_installments ci
          WHERE ci.promotion_id=c.promotion_id AND ci.credit_id=c.credit_id AND ci.credit_provenance='IMPORT') AS installment_count,
        (SELECT COUNT(*) FROM credit_payments p
          WHERE p.promotion_id=c.promotion_id AND p.credit_id=c.credit_id) +
        (SELECT COUNT(*) FROM canonical_financial_events e
          WHERE e.promotion_id=c.promotion_id AND e.credit_id=c.credit_id AND e.credit_provenance='IMPORT') AS payment_count
      FROM credits c
      JOIN canonical_credit_balances b
        ON b.promotion_id=c.promotion_id AND b.credit_id=c.credit_id AND b.provenance='IMPORT'
      WHERE c.promotion_id=?1 AND c.customer_id=?2

      UNION ALL

      SELECT
        'LIVE' AS source,
        l.credit_id,
        NULL AS document_number,
        l.original_amount_cents + COALESCE(b.baseline_delta_cents,0) AS total_cents,
        b.current_balance_cents AS current_cents,
        0 AS imported_paid_cents,
        l.due_date AS due_value,
        (SELECT COUNT(*) FROM canonical_credit_installments ci
          WHERE ci.promotion_id=l.promotion_id AND ci.credit_id=l.credit_id AND ci.credit_provenance='LIVE') AS installment_count,
        (SELECT COUNT(*) FROM canonical_financial_events e
          WHERE e.promotion_id=l.promotion_id AND e.credit_id=l.credit_id AND e.credit_provenance='LIVE') AS payment_count
      FROM live_credits l
      JOIN canonical_credit_balances b
        ON b.promotion_id=l.promotion_id AND b.credit_id=l.credit_id AND b.provenance='LIVE'
      WHERE l.promotion_id=?1 AND l.customer_id=?2

      UNION ALL

      SELECT
        'RECONCILED' AS source,
        r.credit_id,
        NULL AS document_number,
        r.original_amount_cents AS total_cents,
        b.current_balance_cents AS current_cents,
        0 AS imported_paid_cents,
        NULL AS due_value,
        0 AS installment_count,
        (SELECT COUNT(*) FROM canonical_financial_events e
          WHERE e.promotion_id=r.promotion_id AND e.credit_id=r.credit_id AND e.credit_provenance='IMPORT') AS payment_count
      FROM canonical_reconciliation_credits r
      JOIN canonical_credit_balances b
        ON b.promotion_id=r.promotion_id AND b.credit_id=r.credit_id AND b.provenance='IMPORT'
      WHERE r.promotion_id=?1 AND r.customer_id=?2
    )
    ORDER BY source,credit_id
  `, [promotionId, customerId]);
}

function sanitizeCredit(row) {
  const total = Number(row.total_cents || 0);
  const current = Number(row.current_cents || 0);
  return {
    source: String(row.source || ''),
    document_hash: row.document_number ? sha256(String(row.document_number).trim()) : null,
    total_cents: total,
    paid_cents: total - current,
    current_cents: current,
    installment_count: Number(row.installment_count || 0),
    payment_count: Number(row.payment_count || 0),
  };
}

function compareTarget(target, rows) {
  const sanitized = rows.map(sanitizeCredit);
  const positive = sanitized.filter(row => row.current_cents > 0);
  const documented = new Map();
  for (const row of sanitized) {
    if (!row.document_hash) continue;
    const list = documented.get(row.document_hash) || [];
    list.push(row);
    documented.set(row.document_hash, list);
  }

  const documents = target.expected_documents.map(expected => {
    const found = documented.get(expected.document_hash) || [];
    if (found.length !== 1) {
      return {
        document_hash: expected.document_hash,
        present: false,
        match_count: found.length,
        amounts_match: false,
        expected: {
          total_cents: expected.total_cents,
          paid_cents: expected.paid_cents,
          current_cents: expected.current_cents,
        },
      };
    }
    const row = found[0];
    const amountsMatch =
      row.total_cents === expected.total_cents &&
      row.paid_cents === expected.paid_cents &&
      row.current_cents === expected.current_cents;
    return {
      document_hash: expected.document_hash,
      present: true,
      match_count: 1,
      amounts_match: amountsMatch,
      expected: {
        total_cents: expected.total_cents,
        paid_cents: expected.paid_cents,
        current_cents: expected.current_cents,
      },
      actual: row,
    };
  });

  const expectedHashes = new Set(target.expected_documents.map(row => row.document_hash));
  const extras = positive
    .filter(row => !row.document_hash || !expectedHashes.has(row.document_hash))
    .map(row => ({
      source: row.source,
      document_hash: row.document_hash,
      total_cents: row.total_cents,
      paid_cents: row.paid_cents,
      current_cents: row.current_cents,
      installment_count: row.installment_count,
      payment_count: row.payment_count,
    }));

  const currentTotal = positive.reduce((sum, row) => sum + row.current_cents, 0);
  const exactDocuments = documents.every(row => row.present && row.amounts_match);
  const aggregateMatch = currentTotal === target.expected_current_cents;
  const exact = exactDocuments && aggregateMatch && extras.length === 0;

  return {
    expected_current_cents: target.expected_current_cents,
    actual_current_cents: currentTotal,
    aggregate_match: aggregateMatch,
    expected_document_count: target.expected_documents.length,
    exact_document_count: documents.filter(row => row.present && row.amounts_match).length,
    documents,
    extra_positive_credits: extras,
    exact_match: exact,
  };
}

async function main() {
  requireEnv();
  const trigger = JSON.parse(readFileSync(TRIGGER_PATH, 'utf8'));
  const targets = validateTrigger(trigger);
  const db = new TursoD1Adapter({ url:TURSO_URL, authToken:TURSO_TOKEN });

  await schemaReady(db);
  const state = await control(db);
  const identityRows = await identities(db, state.active_promotion_id);

  const results = [];
  for (const target of targets) {
    const matched = identityRows.filter(row => sha256(normalizeName(row.name)) === target.name_hash);
    const unique = new Map(matched.map(row => [String(row.customer_id), row]));
    if (unique.size !== 1) throw new Error('customer hash match count for alias '+target.alias+' is '+unique.size);
    const customer = [...unique.values()][0];
    const rows = await creditRows(db, state.active_promotion_id, customer.customer_id);
    results.push({
      alias: target.alias,
      credit_row_count: rows.length,
      ...compareTarget(target, rows),
    });
  }

  const output = {
    state: 'CANON_TURSO_CREDIT_DOCUMENT_AUDIT_PASS',
    mode: state.mode,
    control_revision: Number(state.revision),
    authority_epoch: Number(state.authority_epoch),
    targets: results,
    all_exact: results.every(row => row.exact_match),
    writes_performed: false,
  };

  console.log('CREDIT_DOCUMENT_AUDIT='+JSON.stringify(output));
}

main().catch(error => {
  console.error('CREDIT_DOCUMENT_AUDIT_FAIL='+String(error?.message || error));
  process.exit(1);
});
