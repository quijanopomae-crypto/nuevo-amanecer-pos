import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('tools/cloudflare-prod/scripts/credit-document-audit-readonly.mjs', 'utf8');
const trigger = JSON.parse(readFileSync('ops/v1.3-turso-credit-document-audit-trigger.json', 'utf8'));

test('credit document audit is read-only by construction', () => {
  assert.doesNotMatch(source, /\.run\s*\(/);
  assert.doesNotMatch(source, /\.batch\s*\(/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b\s+(?:INTO|TABLE|VIEW|TRIGGER|INDEX)?/i);
});

test('audit trigger stores hashes instead of clear customer/document labels', () => {
  assert.equal(trigger.mode, 'readonly');
  assert.equal(trigger.provider, 'turso');
  assert.ok(Array.isArray(trigger.targets) && trigger.targets.length === 2);
  for (const target of trigger.targets) {
    assert.match(target.name_hash, /^[0-9a-f]{64}$/);
    for (const doc of target.expected_documents) assert.match(doc.document_hash, /^[0-9a-f]{64}$/);
  }
  const raw = JSON.stringify(trigger).toLowerCase();
  for (const forbidden of ['luis', 'cristian', 'paredes', 'vargas', '01-58', '10-4246']) {
    assert.equal(raw.includes(forbidden), false);
  }
});
