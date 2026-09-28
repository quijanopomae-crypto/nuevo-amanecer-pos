import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const expected = {
  "0001_sync_operations.sql": "2dd70b17dc9736783e07b4202adde0b9520391d4",
  "0002_read_only_indexes.sql": "abb1c52fd1b0831e8afec2eae2af9435e87ef64e",
  "0003_device_auth.sql": "5cc26ef68b6a7cf7df7cddc47c635cb2b01ae879",
  "0004_sale_create.sql": "0c92e2252fc910bcf30e203018af80ab8325b827",
  "0005_import_staging.sql": "ec7f1c5f8ca4344b6a2fb56c31c95014bb7ed9ca",
  "0006_canonical_promotion.sql": "7944f35c82c44fd13ee6599ec12e071802abd72b",
  "0007_lab_workspace.sql": "2e634d4c16234942e17bf51c92dd0476cb6815f4",
  "0008_canonical_commerce.sql": "dcab9b07f8e0f99127537e5a13614e497f82c905",
  "0009_canonical_financial.sql": "78286801dfabd37183c26776e51958d8ea9fcb99",
  "0010_session_auth.sql": "f7a781ff0cc27d25a98076739d2bcda61a149a04",
  "0011_canonical_session_runtime.sql": "355b8f40d7f2c0eee954c9e56c5889f637e73178",
  "0012_credit_accounts_v2.sql": "e36c565672d4d3de9791bde50294837fbb186811",
  "0013_canonical_expenses.sql": "d11792cddfb1de8174dcbe1c75a4dc095dba1329"
};

test('neutral migration source preserves every historical blob exactly', () => {
  assert.equal(existsSync('tools/cloudflare-lab/migrations'), false, 'legacy migration directory must not remain');
  for (const [name, sha] of Object.entries(expected)) {
    const path = 'infra/database/migrations/' + name;
    assert.equal(existsSync(path), true, path + ' missing');
    const actual = execFileSync('git', ['hash-object', path], { encoding:'utf8' }).trim();
    assert.equal(actual, sha, name + ' content changed during neutral move');
  }
});

test('LAB PROD and STAGING resolve the same neutral migration source', () => {
  const files = [
    ['LAB','tools/cloudflare-lab/wrangler.jsonc'],
    ['PROD','tools/cloudflare-prod/wrangler.jsonc'],
    ['STAGING','tools/cloudflare-staging/wrangler.backend.template.jsonc'],
  ];
  for (const [label,path] of files) {
    const source = readFileSync(path,'utf8');
    assert.match(source, /"migrations_dir": "\.\.\/\.\.\/infra\/database\/migrations"/, label + ' does not use neutral migrations');
    assert.doesNotMatch(source, /cloudflare-lab\/migrations/, label + ' still depends on LAB migration path');
  }
  const prod = readFileSync('tools/cloudflare-prod/wrangler.jsonc','utf8');
  assert.doesNotMatch(prod, /e734e6f1-41c4-4bfa-ab1f-5acbcdd2272e/, 'PROD must never contain LAB D1 id');
});
