import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tursoConfig = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.turso-prod.jsonc','utf8'));
const d1Config = JSON.parse(readFileSync('tools/cloudflare-prod/wrangler.jsonc','utf8'));

test('active Worker identity remains identical while provider becomes Turso', () => {
  assert.equal(d1Config.name, 'nuevo-amanecer-pos-prod');
  assert.equal(tursoConfig.name, 'nuevo-amanecer-pos-prod');
  assert.equal(tursoConfig.vars.RUNTIME_ENVIRONMENT, 'production');
  assert.equal(tursoConfig.vars.CANONICAL_RUNTIME_ENABLED, 'enabled');
  assert.equal(tursoConfig.vars.DB_PROVIDER, 'turso');
  assert.equal(Array.isArray(tursoConfig.d1_databases), false);
});
