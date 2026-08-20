import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, 'cash-v10-regression.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test('inline scripts parse', () => {
  assert.ok(scripts.length >= 1, 'expected at least one inline script, got ' + scripts.length);
  scripts.forEach((code, i) => {
    try {
      new vm.Script(code, { filename: 'cash-v10-regression.html#script' + i });
    } catch (e) {
      assert.fail('script ' + i + ' syntax error: ' + (e.stack || e.message));
    }
  });
});

test('embedded bootstraps present', () => {
  assert.ok(html.includes('function isolationBootstrap'), 'isolationBootstrap missing');
  assert.ok(html.includes('function cashBridgeBootstrap'), 'cashBridgeBootstrap missing');
  assert.ok(html.includes('function bootWorker'), 'bootWorker missing');
});
