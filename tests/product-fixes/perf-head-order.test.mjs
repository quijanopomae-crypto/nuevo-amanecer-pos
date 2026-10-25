import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync('POS/index.html', 'utf8');
const launcher = readFileSync('tools/cloudflare-pos-web/public/index.html', 'utf8');
const guard = readFileSync('POS/js/sync/hosted-canonical-guard.js', 'utf8');
const early = ['/runtime-config.js', 'js/sync/hosted-canonical-guard.js'];
const scripts = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const sources = html => scripts(html).map(m => /\bsrc="([^"]+)"/.exec(m[1])?.[1]).filter(Boolean);

test('runtime config then guard are the first synchronous head scripts, before assets', () => {
  const head = /<head>([\s\S]*?)<\/head>/.exec(app)[1];
  assert.deepEqual(sources(head).slice(0, 2), early);
  for (const tag of scripts(head).slice(0, 2)) assert.doesNotMatch(tag[1], /\b(?:async|defer|type)\b/);
  assert.ok(head.indexOf(early[1]) < head.indexOf('<link'));
  for (const src of early) assert.equal(sources(app).filter(value => value === src).length, 1);
});

const fast = m => /na_cloud_sync_credentials/.test(m[0]) && !/\bsrc=/.test(m[1]);
test('fast launcher redirect is the first script, hosted /app/ only, and only when no saved credentials (subset of the guard)', () => {
  const all = scripts(app);
  assert.ok(fast(all[0]), 'inline fast check runs before any external script');
  const code = all[0][0];
  assert.match(code, /nuevo-amanecer-pos\\\.workers\\\.dev\$/);
  assert.match(code, /\^\\\/app\(\\\/\|\$\)/);
  assert.match(code, /typeof c\.token!=='string'\|\|!c\.token\)l\.replace\(l\.origin\+'\/'\)/);
  assert.match(code, /catch\(_\)\{\}/);
  const guard = readFileSync(new URL('../../POS/js/sync/hosted-canonical-guard.js', import.meta.url), 'utf8');
  assert.match(guard, /validCredentials\(credentials\)/);
  assert.match(guard, /root\.location\.replace\(root\.location\.origin \+ '\/'\)/);
});

test('launcher reserves card and status space at desktop and phone widths', () => {
  assert.match(launcher, /\.card\{min-height:440px;/);
  assert.match(launcher, /\.status\{min-height:56px;/);
  assert.match(launcher, /@media\(max-width:520px\)\{\.card\{min-height:520px;/);
  assert.match(launcher, /id="openPos"[^>]*href="\/app\/"/);
});

test('guard runs without body, redirects unbound hosted browsers, and ignores localhost without config', () => {
  const redirects = [];
  const root = {
    location: { hostname: 'production.nuevo-amanecer-pos.workers.dev', pathname: '/app/', origin: 'https://production.nuevo-amanecer-pos.workers.dev', replace: url => redirects.push(url) },
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem: () => null },
    NA_HOSTED_CONFIG: { environment: 'production', hostedHost: 'production.nuevo-amanecer-pos.workers.dev', apiOrigin: 'https://api.example.test' },
  };
  vm.runInNewContext(guard, { window: root, URL });
  assert.equal(root.document.documentElement.dataset.naHostedCanon, 'activation-required');
  assert.deepEqual(redirects, [root.location.origin + '/']);
  vm.runInNewContext(guard, { window: { location: { hostname: 'localhost' } }, URL });
  root.localStorage.getItem = key => JSON.stringify(key === 'na_canonical_binding'
    ? { endpoint: root.NA_HOSTED_CONFIG.apiOrigin, promotion_id: 'fixture', authority_epoch: 0, revision: 0 }
    : { endpoint: root.NA_HOSTED_CONFIG.apiOrigin, token: 'test-only' });
  vm.runInNewContext(guard, { window: root, URL });
  assert.equal(root.document.documentElement.dataset.naHostedCanon, 'bound');
  assert.equal(redirects.length, 1);
});
