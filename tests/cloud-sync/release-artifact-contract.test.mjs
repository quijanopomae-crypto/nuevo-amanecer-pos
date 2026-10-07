import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, verifyManifest, FORMAT } from '../../tools/release/site-artifact.mjs';

test('site artifact manifest is deterministic, ordered and verifies exact bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'na-site-artifact-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  await mkdir(join(root,'app','js'), { recursive:true });
  await writeFile(join(root,'index.html'), '<h1>launcher</h1>\n');
  await writeFile(join(root,'app','index.html'), '<h1>pos</h1>\n');
  await writeFile(join(root,'app','js','app.js'), 'console.log("ok");\n');

  const head = 'a'.repeat(40);
  const one = await buildManifest(root, head);
  const two = await buildManifest(root, head);
  assert.deepEqual(one,two);
  assert.equal(one.format, FORMAT);
  assert.equal(one.target_head, head);
  assert.equal(one.file_count, 3);
  assert.deepEqual(one.files.map(file=>file.path), ['app/index.html','app/js/app.js','index.html']);
  await verifyManifest(root, one, head);
});

test('site artifact verification rejects content tampering and target mismatch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'na-site-tamper-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  await writeFile(join(root,'index.html'), 'before');
  const head = 'b'.repeat(40);
  const manifest = await buildManifest(root, head);
  await writeFile(join(root,'index.html'), 'after');
  await assert.rejects(() => verifyManifest(root,manifest,head), /content mismatch/);
  await assert.rejects(() => verifyManifest(root,manifest,'c'.repeat(40)), /target_head mismatch/);
});

test('site artifact verification rejects unsafe or reordered descriptors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'na-site-shape-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  await mkdir(join(root,'app'), { recursive:true });
  await writeFile(join(root,'index.html'), 'root');
  await writeFile(join(root,'app','index.html'), 'app');
  const head = 'd'.repeat(40);
  const manifest = await buildManifest(root,head);

  const unsafe = structuredClone(manifest);
  unsafe.files[0].path = '../escape';
  await assert.rejects(() => verifyManifest(root,unsafe,head), /invalid site artifact file descriptor/);

  const reversed = structuredClone(manifest);
  reversed.files.reverse();
  await assert.rejects(() => verifyManifest(root,reversed,head), /order\/uniqueness invalid/);
});

test('STAGING publishes release candidate only after smoke and seals exactly what it deploys', () => {
  const workflow = readFileSync('.github/workflows/staging-deploy.yml','utf8');
  const assemble = workflow.indexOf('- name: Assemble the exact staging POS shell');
  const seal = workflow.indexOf('- name: Seal immutable STAGING site candidate');
  const deploy = workflow.indexOf('- name: STAGING web dry-run and deploy');
  const smoke = workflow.indexOf('- name: Smoke STAGING backend and web');
  const publish = workflow.indexOf('- name: Publish smoke-verified immutable release candidate');
  assert.ok(assemble >= 0 && seal > assemble && deploy > seal && smoke > deploy && publish > smoke);
  assert.match(workflow,/site-artifact\.mjs build/);
  assert.match(workflow,/tar --sort=name --mtime='UTC 1970-01-01'/);
  assert.match(workflow,/gzip -n/);
  assert.match(workflow,/status.*STAGING_SMOKE_PASS/);
  assert.match(workflow,/release-candidates\/\$STAGING_TARGET_HEAD\/\$SITE_ARTIFACT_SHA256\/pos-site\.tar\.gz/);
  assert.match(workflow,/release-candidates\/\$STAGING_TARGET_HEAD\/candidate\.json/);
  assert.match(workflow,/r2 object put "\$STAGING_R2_BUCKET\/\$ARTIFACT_KEY" --remote --file=\/tmp\/na-site\.tar\.gz/);
  assert.match(workflow,/r2 object put "\$STAGING_R2_BUCKET\/\$CANDIDATE_KEY" --remote --file=\/tmp\/release-candidate\.json/);
});

test('production release promotes verified STAGING bytes and never rebuilds static POS', () => {
  const workflow = readFileSync('.github/workflows/production-release.yml','utf8');
  assert.match(workflow,/ops\/production-release-trigger\.json/);
  assert.match(workflow,/group: nuevo-amanecer-production-change/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.doesNotMatch(workflow,/workflow_dispatch:/);
  assert.match(workflow,/candidate did not pass staging smoke/);
  assert.match(workflow,/RELEASE_ARTIFACT_SHA256/);
  assert.match(workflow,/RELEASE_MANIFEST_SHA256/);
  assert.match(workflow,/site-artifact\.mjs verify/);
  assert.match(workflow,/mv \/tmp\/na-prod-release\/site tools\/cloudflare-pos-web\/_site/);
  assert.doesNotMatch(workflow,/cp -a POS\//);
  assert.doesNotMatch(workflow,/sed -i .*__BUILD_HASH__/);
  assert.doesNotMatch(workflow,/d1 (?:execute|migrations|create|delete)/);
  assert.doesNotMatch(workflow,/tools\/cloudflare-prod/);
  assert.match(workflow,/r2 object get "\$ARTIFACT_BUCKET\/\$CANDIDATE_KEY" --remote --file=\/tmp\/release-candidate\.json/);
  assert.match(workflow,/r2 object get "\$ARTIFACT_BUCKET\/\$RELEASE_ARTIFACT_KEY" --remote --file=\/tmp\/na-prod-site\.tar\.gz/);
  assert.match(workflow,/grep -Fq "\$PROD_WEB_URL" \/tmp\/prod-runtime-config\.js/);
  assert.match(workflow,/\$PROD_WEB_URL\/health/);
  assert.match(workflow,/service!==\"nuevo-amanecer-pos-prod\"/);
});

test('production release validates archive namespace before extraction', () => {
  const workflow = readFileSync('.github/workflows/production-release.yml','utf8');
  const list = workflow.indexOf('tar -tzf /tmp/na-prod-site.tar.gz');
  const validate = workflow.indexOf('unexpected release archive entry');
  const extract = workflow.indexOf('tar -xzf /tmp/na-prod-site.tar.gz');
  assert.ok(list >= 0 && validate > list && extract > validate);
  assert.match(workflow,/entry\.startsWith\("\/"\)/);
  assert.match(workflow,/entry\.includes\("\.\.\/"\)/);
  assert.match(workflow,/site-manifest\.json/);
});
