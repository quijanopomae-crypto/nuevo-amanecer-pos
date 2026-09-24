import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

test('private input locations do not contain tracked commercial source files', () => {
  const allowed = new Set([
    'tools/cloudflare-lab/private/a5-inputs/.gitkeep',
  ]);
  const privateTracked = tracked.filter(path =>
    path.startsWith('tools/cloudflare-lab/private/') ||
    path.startsWith('laboratorio/private/')
  );
  for (const path of privateTracked) {
    assert.equal(allowed.has(path), true, 'unexpected tracked private input: ' + path);
  }
});

test('sensitive local environment files are not tracked', () => {
  for (const path of tracked) {
    assert.equal(/(^|\/)\.env($|\.)/.test(path), false, 'tracked env file: ' + path);
    if (/(^|\/)\.dev\.vars$/.test(path)) {
      assert.fail('tracked .dev.vars file: ' + path);
    }
    assert.equal(/\.(pem|p12|pfx|key)$/i.test(path), false, 'tracked key material: ' + path);
  }
});

test('tracked text does not contain common live-secret signatures', () => {
  const patterns = [
    { name: 'OpenAI-style secret', re: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
    { name: 'GitHub classic token', re: /\bghp_[A-Za-z0-9]{30,}\b/ },
    { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
    { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  ];

  for (const path of tracked) {
    if (path === 'tests/final-repository-boundaries.test.mjs') continue;
    const full = resolve(root, path);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;

    let bytes;
    try { bytes = readFileSync(full); } catch { continue; }
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    for (const { name, re } of patterns) {
      assert.doesNotMatch(text, re, name + ' in ' + path);
    }
  }
});

test('final status does not claim production cutover or a clean pass', () => {
  const status = readFileSync(resolve(root, 'docs/V1.3_STATUS.md'), 'utf8');
  const map = readFileSync(resolve(root, 'REPO_MAP.yaml'), 'utf8');
  assert.match(status, /CODE_REMEDIATION_PASS/);
  assert.match(status, /OWNER_ONLY_PENDING/);
  assert.match(map, /overall_clean_pass: false/);
  assert.match(map, /production_cutover: not_authorized/);
});
