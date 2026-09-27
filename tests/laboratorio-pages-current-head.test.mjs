import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/lab-pages.yml','utf8');

test('LAB Pages stays LAB-scoped while following successful CANON CI head SHA',()=>{
  const pushBlock=workflow.split('workflow_dispatch:')[0];
  assert.doesNotMatch(pushBlock,/"POS\/\*\*"/);
  assert.doesNotMatch(pushBlock,/\.github\/workflows\/lab-pages\.yml/);
  assert.match(workflow,/workflow_run:/);
  assert.match(workflow,/CANON Critical CI/);
  assert.match(workflow,/github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow,/github\.event\.workflow_run\.head_sha/);
  assert.match(workflow,/ref:\s*\$\{\{ env\.LAB_BUILD_SHA \}\}/);
});

test('LAB Pages pipeline validates and stamps the exact static artifact before upload',()=>{
  assert.match(workflow,/verify-pages-site\.mjs/);
  assert.match(workflow,/--site _site/);
  assert.match(workflow,/--build "\$LAB_BUILD_SHA"/);
  assert.match(workflow,/--stamp/);
  assert.match(workflow,/na-lab-build/);
  assert.match(workflow,/POS\/js\/adapters\/canonical-ui-adapter\.js/);
  assert.match(workflow,/POS\/js\/motion\/scroll-motion\.js/);
});

test('static-site verifier resolves LAB assets through the POS base and stamps build SHA without changing source files',()=>{
  const root=mkdtempSync(join(tmpdir(),'na-lab-pages-'));
  const lab=join(root,'laboratorio/pos-lab');
  const posCss=join(root,'POS/css');
  const labStyles=join(lab,'styles');
  mkdirSync(labStyles,{recursive:true});
  mkdirSync(posCss,{recursive:true});

  writeFileSync(join(posCss,'base.css'),'body{}');
  writeFileSync(join(labStyles,'lab.css'),'.x{}');
  writeFileSync(join(lab,'lab.js'),'window.ok=true');
  writeFileSync(join(lab,'index.html'),`<!doctype html><html><head><base href="../../POS/"><link rel="stylesheet" href="css/base.css"><link rel="stylesheet" href="../laboratorio/pos-lab/styles/lab.css"><script src="../laboratorio/pos-lab/lab.js"></script></head><body></body></html>`);

  const run=spawnSync(process.execPath,[
    'laboratorio/pos-lab/verify-pages-site.mjs',
    '--site',root,
    '--build','abc123',
    '--stamp'
  ],{encoding:'utf8'});

  assert.equal(run.status,0,run.stderr||run.stdout);
  const html=readFileSync(join(lab,'index.html'),'utf8');
  assert.match(html,/name="na-lab-build" content="abc123"/);
  assert.match(html,/css\/base\.css\?build=abc123/);
  assert.match(html,/styles\/lab\.css\?build=abc123/);
  assert.match(html,/lab\.js\?build=abc123/);
});

test('static-site verifier fails closed when a referenced local LAB/POS asset is absent',()=>{
  const root=mkdtempSync(join(tmpdir(),'na-lab-pages-missing-'));
  const lab=join(root,'laboratorio/pos-lab');
  mkdirSync(lab,{recursive:true});
  writeFileSync(join(lab,'index.html'),`<!doctype html><html><head><base href="../../POS/"><link rel="stylesheet" href="css/missing.css"></head></html>`);
  const run=spawnSync(process.execPath,[
    'laboratorio/pos-lab/verify-pages-site.mjs',
    '--site',root,
    '--build','deadbeef',
    '--stamp'
  ],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/LAB_PAGES_ASSET_MISSING/);
});
