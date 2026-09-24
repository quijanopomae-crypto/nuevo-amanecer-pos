import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { handleLabWorkspace } from '../tools/cloudflare-lab/src/lab-workspace.js';

const jsonLab = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const deps = {
  jsonLab,
  authorizeRead: () => null,
  authorizeDevice: async () => ({ credentialHash: 'a'.repeat(64) }),
};

function snapshot() {
  return {
    version: 9,
    updatedAt: '2026-09-24T12:00:00.000Z',
    appConfig: {},
    ui: { currentPage: 'pageMenu' },
    locks: { master: false, readOnly: false, modules: {} },
    data: {
      productos: [], ventas: [], clientes: [], creditos: [], gastos: [], cajMovs: [],
      cashClosures: [], inventoryMovements: [],
    },
    cart: [],
    draft: null,
  };
}

test('R2 read token no longer authorizes LAB baseline import signatures', async () => {
  const request = new Request('https://lab.example/lab/workspace/import-baseline', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lab-import-signature': '0'.repeat(64) },
    body: JSON.stringify({
      source_ref: 'r2://nuevo-amanecer-prod-v2-backups/test.sql',
      source_hash: '1'.repeat(64),
      snapshot: snapshot(),
    }),
  });
  const response = await handleLabWorkspace(
    request,
    new URL(request.url),
    { nuevo_amanecer_lab: {}, R2_CANON_READ_TOKEN: 'legacy-read-token' },
    deps,
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'lab_import_hmac_not_configured');
});

test('dedicated LAB import HMAC is required and invalid signatures fail before D1 writes', async () => {
  const request = new Request('https://lab.example/lab/workspace/import-baseline', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lab-import-signature': '0'.repeat(64) },
    body: JSON.stringify({
      source_ref: 'r2://nuevo-amanecer-prod-v2-backups/test.sql',
      source_hash: '1'.repeat(64),
      snapshot: snapshot(),
    }),
  });
  const response = await handleLabWorkspace(
    request,
    new URL(request.url),
    { nuevo_amanecer_lab: {}, LAB_IMPORT_HMAC_SECRET: 'dedicated-import-secret' },
    deps,
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_import_signature');
});

test('publisher and device provisioning no longer reuse the R2 read credential', () => {
  const publisher = readFileSync('tools/cloudflare-lab/scripts/publish-lab-snapshot.mjs', 'utf8');
  const provision = readFileSync('.github/workflows/provision-lab-device.yml', 'utf8');
  assert.match(publisher, /LAB_IMPORT_HMAC_SECRET/);
  assert.doesNotMatch(publisher, /R2_CANON_READ_TOKEN/);
  assert.match(provision, /DEVICE_CREDENTIAL_PEPPER/);
  assert.doesNotMatch(provision, /R2_CANON_READ_TOKEN/);
  assert.doesNotMatch(provision, /derive|Derive server-only device pepper/i);
});

test('all GitHub Actions are pinned to immutable commit SHAs', () => {
  for (const name of readdirSync('.github/workflows').filter(name => /\.ya?ml$/.test(name))) {
    const workflow = readFileSync('.github/workflows/' + name, 'utf8');
    for (const match of workflow.matchAll(/\buses:\s*([^\s#]+)/g)) {
      assert.match(match[1], /@[0-9a-f]{40}$/, name + ': ' + match[1]);
    }
  }
});

test('Pages auto-deploy is LAB-only and canonical POS entry point is replaced', () => {
  const pages = readFileSync('.github/workflows/lab-pages.yml', 'utf8');
  const pushBlock = pages.split('workflow_dispatch:')[0];
  assert.doesNotMatch(pushBlock, /"POS\/\*\*"/);
  assert.doesNotMatch(pushBlock, /\.github\/workflows\/lab-pages\.yml/);
  assert.match(pages, /cp -a POS\/\. _site\/POS\//, 'LAB still needs canonical static assets through its base href');
  assert.match(pages, /cat > _site\/POS\/index\.html/);
  assert.match(pages, /LAB support assets only/);
  assert.match(pages, /canonical POS is not served from GitHub Pages/);
});

test('Pages write permissions are scoped to deploy job', () => {
  const pages = readFileSync('.github/workflows/lab-pages.yml', 'utf8');
  const beforeJobs = pages.split('jobs:')[0];
  assert.match(beforeJobs, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(beforeJobs, /pages: write|id-token: write/);
  assert.match(pages, /deploy:\s*\n\s+permissions:\s*\n\s+pages: write\s*\n\s+id-token: write/);
});

test('Worker import verifier does not retain R2 read token dependency', () => {
  const workspace = readFileSync('tools/cloudflare-lab/src/lab-workspace.js', 'utf8');
  assert.match(workspace, /LAB_IMPORT_HMAC_SECRET/);
  const importSection = workspace.slice(workspace.indexOf('async function importBaseline'), workspace.indexOf('async function verifyHmacHex'));
  assert.doesNotMatch(importSection, /R2_CANON_READ_TOKEN/);
});
