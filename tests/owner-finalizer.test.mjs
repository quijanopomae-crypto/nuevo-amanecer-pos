import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const finalizer = readFileSync('tools/owner-finalize-v1.3.ps1', 'utf8');
const drill = readFileSync('.github/workflows/owner-backup-recovery-drill.yml', 'utf8');

test('owner finalizer configures import signing plus one reusable activation secret', () => {
  assert.match(finalizer, /New-HexSecret 32/);
  assert.match(finalizer, /gh secret set LAB_IMPORT_HMAC_SECRET/);
  assert.match(finalizer, /gh secret set POS_ACTIVATION_SECRET/);
  assert.match(finalizer, /Read-Host .*activation secret.*-AsSecureString/i);
  assert.doesNotMatch(finalizer, /Write-Host.*activationSecret/i);
});

test('owner finalizer protects main and disables force push/deletion', () => {
  assert.match(finalizer, /required_pull_request_reviews/);
  assert.match(finalizer, /allow_force_pushes = \$false/);
  assert.match(finalizer, /allow_deletions = \$false/);
  assert.match(finalizer, /required_conversation_resolution = \$true/);
});

test('owner finalizer runs deployment and recovery closure workflows', () => {
  assert.match(finalizer, /deploy-lab-cloud\.yml/);
  assert.match(finalizer, /owner-backup-recovery-drill\.yml/);
  assert.match(finalizer, /gh run watch/);
});

test('real recovery drill is manual and restores only into a temporary D1', () => {
  assert.match(drill, /workflow_dispatch/);
  assert.doesNotMatch(drill, /\npush:/);
  assert.match(drill, /Export production D1 read-only/);
  assert.match(drill, /recovery-drills\//);
  assert.match(drill, /Create temporary recovery D1/);
  assert.match(drill, /Restore SQL into temporary D1/);
  assert.doesNotMatch(drill, /PRAGMA integrity_check/);
  assert.doesNotMatch(drill, /PRAGMA foreign_key_check/);
  assert.match(drill, /sqlite_master/);
  assert.match(drill, /orphan_payment_credits/);
  assert.match(drill, /invalid_credit_balance_rows/);
  assert.match(drill, /canonical_control/);
  assert.match(drill, /Delete temporary recovery D1/);
  assert.match(drill, /-X DELETE/);
});

test('restore command and verification queries target only the temporary database', () => {
  const executeLines = drill.split('\n').filter(line => /wrangler d1 execute/.test(line));
  assert.equal(executeLines.length, 1);
  assert.match(executeLines[0], /\$DRILL_DB_NAME/);
  assert.doesNotMatch(executeLines[0], /nuevo-amanecer-prod-v2|\$PROD_DATABASE_ID/);
  assert.match(drill, /const database = process\.env\.DRILL_DB_ID/);
  assert.match(drill, /\/d1\/database\/.*\/query/);
});


test('gh JSON helper is Windows PowerShell safe', () => {
  assert.match(finalizer, /Invoke-GhJson\(\[string\[\]\]\$GhArgs\)/);
  assert.match(finalizer, /& gh @GhArgs/);
  assert.match(finalizer, /\$output -join \[Environment\]::NewLine/);
  assert.doesNotMatch(finalizer, /Invoke-GhJson\(\[string\[\]\]\$Args\)/);
});


test('secret generation remains compatible with Windows PowerShell 5.1', () => {
  assert.match(finalizer, /RandomNumberGenerator\]::Create\(\)/);
  assert.match(finalizer, /\.GetBytes\(\$raw\)/);
  assert.match(finalizer, /BitConverter\]::ToString\(\$raw\)/);
  assert.doesNotMatch(finalizer, /RandomNumberGenerator\]::GetBytes\(\$Bytes\)/);
  assert.doesNotMatch(finalizer, /Convert\]::ToHexString/);
});
