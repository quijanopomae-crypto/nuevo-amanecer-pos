import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

function buildSeededDatabase() {
  const db = new DatabaseSync(':memory:');
  const migrations = readdirSync('infra/database/migrations')
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const name of migrations) {
    db.exec(readFileSync('infra/database/migrations/' + name, 'utf8'));
  }
  db.exec(readFileSync('tools/cloudflare-staging/synthetic-seed.sql', 'utf8'));
  return db;
}

test('synthetic STAGING seed follows the canonical promotion state machine end to end', () => {
  const db = buildSeededDatabase();
  try {
    const control = db.prepare(
      'SELECT mode,active_promotion_id,revision,authority_epoch,minimum_client_contract FROM canonical_control WHERE id=1'
    ).get();
    assert.equal(control.mode, 'CANONICAL_READ_ONLY');
    assert.equal(control.active_promotion_id, 'staging-synthetic-promotion-v1');
    assert.equal(control.minimum_client_contract, 'a6-gate-p-v1');
    assert.equal(Number(control.revision), 2);
    assert.equal(Number(control.authority_epoch), 2);

    const promotion = db.prepare(
      "SELECT status,candidate_revision,sealed_revision FROM canonical_promotions WHERE promotion_id='staging-synthetic-promotion-v1'"
    ).get();
    assert.equal(promotion.status, 'COMMITTED');
    assert.equal(Number(promotion.candidate_revision), 2);
    assert.equal(Number(promotion.sealed_revision), 2);

    assert.equal(Number(db.prepare(
      "SELECT COUNT(*) n FROM products WHERE promotion_id='staging-synthetic-promotion-v1'"
    ).get().n), 1);
    assert.equal(Number(db.prepare(
      "SELECT COUNT(*) n FROM customers WHERE promotion_id='staging-synthetic-promotion-v1'"
    ).get().n), 1);

    const guard = db.prepare(
      "SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name='canonical_control_no_legacy'"
    ).get();
    assert.equal(Number(guard.n), 1);
  } finally {
    db.close();
  }
});

test('synthetic seed contains no real-store identifiers and no explicit transaction wrapper', () => {
  const source = readFileSync('tools/cloudflare-staging/synthetic-seed.sql','utf8');
  assert.doesNotMatch(source,/\bBEGIN(?:\s+IMMEDIATE|\s+TRANSACTION)?\b/i);
  assert.doesNotMatch(source,/\bCOMMIT\b/i);
  assert.doesNotMatch(source,/MERY|MISAEL|JOSY|70000001/i);
  assert.match(source,/Producto Sintético/);
  assert.match(source,/Cliente Sintético/);
});
