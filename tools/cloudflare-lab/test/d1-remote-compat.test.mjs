import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = [
  'tools/cloudflare-lab/migrations/0006_canonical_promotion.sql',
  'tools/cloudflare-lab/migrations/0007_lab_workspace.sql'
];

test('remote D1 trigger migrations avoid known parser traps', () => {
  for (const file of files) {
    const raw = readFileSync(file);
    const text = raw.toString('utf8');
    assert.equal(raw.includes(13), false, file + ' must use LF, not CRLF');
    assert.doesNotMatch(text, /\bSELECT\s+CASE\b/, file + ' contains unparenthesized SELECT CASE');
    for (const match of text.matchAll(/CREATE\s+TRIGGER[\s\S]*?;/gi)) {
      if (/\bBEGIN\b/i.test(match[0])) {
        assert.match(match[0], /\bBEGIN\b/, file + ' trigger BEGIN must be uppercase');
      }
    }
  }
});
