import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const module = await import('../../tools/release/web-release.mjs').catch(() => ({}));
const { validateRelease, requireGreenRuns, validateReviewReceipt } = module;

test('release validator exists', () => assert.equal(typeof validateRelease, 'function'));
const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
const valid = () => ({format:'nuevo-amanecer-web-release-v2',authorized:true,authorization:'Misión del propietario 2026-10-25',risk:'medium',approved_base:a,target_commit:b,rollback_ref:a,allowed_paths:['POS/js/work-host.js'],review:{kind:'independent-automated',evidence:'docs/review.md'}});
const changes = {base:a,target:b,head:c,paths:['POS/js/work-host.js'],productionSha:a,activationPaths:['ops/v1.3-pos-web-deploy-trigger.json']};
test('accepts exact release scope with rollback and recorded review', () => assert.equal(validateRelease(valid(),changes),true));
test('rejects accumulated unapproved paths, including deletions', () => assert.throws(()=>validateRelease(valid(),{...changes,paths:[...changes.paths,'POS/js/sync/outbox.js']}),/scope/));
test('rejects unrelated changes bundled after target', () => assert.throws(()=>validateRelease(valid(),{...changes,activationPaths:['POS/index.html']}),/activation/));
test('rejects old authorization format, absent rollback, wildcard scope and unknown risk', () => {
  for(const patch of [{format:'old'},{authorized:false},{authorization:''},{rollback_ref:''},{allowed_paths:['POS/**']},{risk:'unknown'},{review:{kind:'self',evidence:''}}]) assert.throws(()=>validateRelease({...valid(),...patch},changes));
});
test('high risk needs genuine independent evidence', () => {
  assert.throws(()=>validateRelease({...valid(),risk:'high',review:{kind:'self',evidence:'docs/review.md'}},changes),/independent/);
});
test('missing, failed or newest pending CI cannot be called green', () => {
 const runs=[{name:'CANON Critical CI',head_sha:b,status:'completed',conclusion:'success',run_number:1,path:'.github/workflows/canon-critical-ci.yml',event:'push'},{name:'E2E Smoke CI',head_sha:b,status:'completed',conclusion:'success',run_number:1,path:'.github/workflows/e2e-smoke-ci.yml',event:'push'},{name:'OpenCode Role Map CI',head_sha:b,status:'completed',conclusion:'success',run_number:1,path:'.github/workflows/opencode-config-ci.yml',event:'push'}];
 assert.equal(requireGreenRuns(runs,b),true);
 assert.throws(()=>requireGreenRuns(runs.map(r=>({...r,path:'.github/workflows/fake.yml'})),b),/CI/);
 assert.throws(()=>requireGreenRuns(runs.map(r=>({...r,event:'untrusted'})),b),/CI/);
 assert.throws(()=>requireGreenRuns(runs.slice(0,1),b),/CI/);
 assert.throws(()=>requireGreenRuns([...runs,{...runs[0],run_number:2,status:'in_progress',conclusion:null}],b),/CI/);
 assert.throws(()=>requireGreenRuns(runs.map(r=>({...r,head_sha:a})),b),/CI/);
 assert.throws(()=>requireGreenRuns(runs.map(r=>({...r,conclusion:'failure'})),b),/CI/);
});

test('release base must match the SHA served in production', () => {
 assert.throws(()=>validateRelease(valid(),{...changes,productionSha:c}),/production/);
});

test('review receipt binds a real reviewed commit and forbids post-review code changes',()=>{
 const m=valid();m.review.evidence='docs/review.json';
 const receipt={reviewed_commit:b,kind:'independent-automated',result:'pass',reviewer:'independent agent'};
 assert.equal(validateReviewReceipt(receipt,m,['docs/review.json']),true);
 assert.throws(()=>validateReviewReceipt({...receipt,result:'pending'},m,[]));
 assert.throws(()=>validateReviewReceipt({...receipt,reviewed_commit:''},m,[]));
 assert.throws(()=>validateReviewReceipt(receipt,m,['POS/js/work-host.js']));
});
test('prepare CLI validates real Git diff and generates one activation file',()=>{
 const root=mkdtempSync(join(tmpdir(),'web-release-'));
 const repo=join(root,'repo');
 const run=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 const script=new URL('../../tools/release/web-release.mjs',import.meta.url).pathname;
 try{
 execFileSync('mkdir',['-p',join(repo,'ops'),join(repo,'POS')]);
 run('init','-q');run('config','user.name','Fixture');run('config','user.email','fixture@example.test');
 writeFileSync(join(repo,'POS/ui.css'),'old');run('add','.');run('commit','-qm','baseline');const base=run('rev-parse','HEAD');
 writeFileSync(join(repo,'POS/ui.css'),'new');run('add','.');run('commit','-qm','approved');const target=run('rev-parse','HEAD');
 const scope=join(root,'scope.json');writeFileSync(scope,JSON.stringify(['POS/ui.css']));
 const args=['prepare','--base',base,'--target',target,'--rollback',base,'--scope',scope,'--authorization','owner fixture scope','--risk','low','--review-kind','self','--review','docs/review.json'];
 execFileSync(process.execPath,[script,...args],{cwd:repo});
 const manifest=JSON.parse(readFileSync(join(repo,'ops/v1.3-pos-web-deploy-trigger.json'),'utf8'));
 assert.equal(manifest.target_commit,target);assert.deepEqual(manifest.allowed_paths,['POS/ui.css']);
 assert.equal(run('status','--porcelain').includes('?? ops/'),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
