import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const module = await import('../../tools/release/web-release.mjs').catch(() => ({}));
const { validateRelease, requireGreenRuns, validateReviewReceipt, deployedOnly, REQUIRED_CI, excludedFromScope, highRiskPaths, requireRiskForDiff, scopeWarning, autoWebReleaseEligible, directReleaseDecision, parseDirectIntent } = module;

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
test('missing, failed, untrusted or pending unified CI cannot be called green', () => {
  const runs=[{name:'AUTO-DEV CI',head_sha:b,status:'completed',conclusion:'success',run_number:1,path:'.github/workflows/auto-dev-ci.yml',event:'push'}];
  assert.equal(requireGreenRuns(runs,b),true);
  assert.throws(()=>requireGreenRuns(runs.map(r=>({...r,path:'.github/workflows/fake.yml'})),b),/CI/);
  assert.throws(()=>requireGreenRuns(runs.map(r=>({...r,event:'untrusted'})),b),/CI/);
  assert.throws(()=>requireGreenRuns([],b),/CI/);
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

test('release scope lists only what the web deploy publishes or gates; tests, docs and deleted lab files are excluded',()=>{
 const inScope=['POS/css/x.css','POS/js/sync/outbox.js','tools/cloudflare-pos-web/src/worker.js','tools/release/web-release.mjs','.github/workflows/v1.3-pos-web-deploy.yml','tools/cloudflare-lab/package.json','tools/cloudflare-lab/package-lock.json','.github/workflows/auto-dev-ci.yml','.github/workflows/canon-critical-ci.yml','.github/workflows/e2e-smoke-ci.yml','.github/workflows/opencode-config-ci.yml'];
 const out=['tests/e2e/a.spec.ts','docs/a.md','laboratorio/pos-lab/index.html','tools/cloudflare-lab/src/worker.js','infra/database/migrations/0034.sql','.github/workflows/visual-regression.yml'];
 assert.deepEqual(deployedOnly([...out.slice(0,2),...inScope,...out.slice(2)]),inScope);
 // un archivo de POS no declarado en el alcance sigue bloqueando la publicación
 assert.throws(()=>validateRelease(valid(),{...changes,paths:deployedOnly(['POS/js/work-host.js','POS/js/sync/outbox.js'])}),/scope/);
});

test('unified CI plus historical gate removals are included in complete release scope',()=>{
  assert.deepEqual(Object.values(REQUIRED_CI),['.github/workflows/auto-dev-ci.yml']);
  const gatePaths=['.github/workflows/auto-dev-ci.yml','.github/workflows/canon-critical-ci.yml','.github/workflows/e2e-smoke-ci.yml','.github/workflows/opencode-config-ci.yml'];
  for(const wf of gatePaths){
    const diff=deployedOnly(['POS/js/work-host.js',wf]);
    assert.deepEqual(diff,['POS/js/work-host.js',wf]);
    assert.throws(()=>validateRelease(valid(),{...changes,paths:diff}),/scope/);
    assert.equal(validateRelease({...valid(),allowed_paths:diff},{...changes,paths:diff}),true);
  }
  assert.deepEqual(deployedOnly(['tools/cloudflare-lab/package.json']),['tools/cloudflare-lab/package.json']);
});

test('changes after the independent review are checked against the full diff, never the filtered scope',()=>{
 const m={...valid(),review:{kind:'independent-automated',evidence:'docs/review.json'}};
 const receipt={reviewed_commit:a,result:'pass',reviewer:'x',kind:'independent-automated'};
 for(const p of ['.github/workflows/canon-critical-ci.yml','tools/cloudflare-lab/package.json','docs/DEVELOPMENT_RISK_POLICY.md','tests/e2e/a.spec.ts']) assert.throws(()=>validateReviewReceipt(receipt,m,[p]),/after independent review/);
 assert.equal(validateReviewReceipt(receipt,m,['docs/review.json']),true);
 // la CLI debe pasar el diff completo (paths), no releasePaths, al validar el recibo
 const src=readFileSync(new URL('../../tools/release/web-release.mjs',import.meta.url),'utf8');
 assert.match(src,/validateReviewReceipt\(receipt,m,paths\(receipt\.reviewed_commit,m\.target_commit\)\)/);
});

test('prepare helpers: excluded files are reported and Worker/SQL changes derive a minimum risk of high',()=>{
 const diff=['POS/css/x.css','docs/a.md','tests/e2e/a.spec.ts'];
 assert.deepEqual(excludedFromScope(diff),['docs/a.md','tests/e2e/a.spec.ts']);
 assert.match(scopeWarning(diff),/^WARNING: 2 file\(s\).*docs 1, tests 1/s);
 assert.equal(scopeWarning(['POS/css/x.css']),'');
 assert.match(scopeWarning(Array.from({length:40},(_,i)=>'laboratorio/f'+i+'.html')),/laboratorio 40[\s\S]*and 25 more/);
 for(const hit of ['tools/cloudflare-lab/src/worker.js','tools/cloudflare-prod/src/worker.js','tools/cloudflare-backup/run.mjs','infra/database/migrations/0099_x.sql','ops/canon-migration-0034.json','ops/canon-migrations-0021-0022.json','db/other.SQL']) {
  assert.deepEqual(highRiskPaths(['POS/css/x.css',hit]),[hit]);
  for(const risk of ['low','medium']) assert.throws(()=>requireRiskForDiff(risk,['POS/css/x.css',hit]),/--risk high is required/);
  assert.deepEqual(requireRiskForDiff('high',['POS/css/x.css',hit]),[hit]);
 }
 // cambios solo de POS (o de la web estática, workflow, docs) no exigen riesgo alto
 assert.deepEqual(requireRiskForDiff('low',['POS/css/x.css','tools/cloudflare-pos-web/src/worker.js','docs/a.md','ops/v1.3-pos-web-deploy-trigger.json','tools/cloudflare-staging/x.mjs']),[]);
});

test('prepare CLI warns about excluded files without blocking and requires --risk high for Worker or migrations',()=>{
 const root=mkdtempSync(join(tmpdir(),'web-release-warn-'));
 const repo=join(root,'repo');
 const run=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 const script=new URL('../../tools/release/web-release.mjs',import.meta.url).pathname;
 const prepare=(base,target,scopeList,risk,review)=>{
  const scope=join(root,'scope.json');writeFileSync(scope,JSON.stringify(scopeList));
  rmSync(join(repo,'ops/v1.3-pos-web-deploy-trigger.json'),{force:true});
  return spawnSync(process.execPath,[script,'prepare','--base',base,'--target',target,'--rollback',base,'--scope',scope,'--authorization','owner fixture scope','--risk',risk,'--review-kind',review,'--review','docs/review.json'],{cwd:repo,encoding:'utf8'});
 };
 try{
 execFileSync('mkdir',['-p',join(repo,'ops'),join(repo,'POS'),join(repo,'docs'),join(repo,'tools/cloudflare-lab/src'),join(repo,'infra/database/migrations')]);
 run('init','-q');run('config','user.name','Fixture');run('config','user.email','fixture@example.test');
 writeFileSync(join(repo,'POS/ui.css'),'old');writeFileSync(join(repo,'docs/a.md'),'old');writeFileSync(join(repo,'tools/cloudflare-lab/src/worker.js'),'old');
 run('add','.');run('commit','-qm','baseline');const base=run('rev-parse','HEAD');
 // 1) una línea de CSS en POS: sin aviso y sin exigir riesgo alto
 writeFileSync(join(repo,'POS/ui.css'),'new');run('commit','-qam','css');const css=run('rev-parse','HEAD');
 let r=prepare(base,css,['POS/ui.css'],'low','self');
 assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
 // 2) POS + docs: avisa del archivo excluido, no bloquea
 writeFileSync(join(repo,'docs/a.md'),'new');run('commit','-qam','docs');const docs=run('rev-parse','HEAD');
 r=prepare(base,docs,['POS/ui.css'],'low','self');
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/WARNING: 1 file\(s\).*\n\s+- docs\/a\.md/);
 // 3) Worker: falla con riesgo bajo, pasa con alto (avisando del archivo excluido)
 writeFileSync(join(repo,'tools/cloudflare-lab/src/worker.js'),'new');run('commit','-qam','worker');const worker=run('rev-parse','HEAD');
 r=prepare(base,worker,['POS/ui.css'],'low','self');
 assert.notEqual(r.status,0);assert.match(r.stderr,/--risk high is required/);
 r=prepare(base,worker,['POS/ui.css'],'medium','technical');
 assert.notEqual(r.status,0);assert.match(r.stderr,/--risk high is required/);
 r=prepare(base,worker,['POS/ui.css'],'high','independent-automated');
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/tools\/cloudflare-lab\/src\/worker\.js/);
 // 4) migración SQL nueva: igual
 writeFileSync(join(repo,'infra/database/migrations/0099_x.sql'),'select 1;');run('add','infra');run('commit','-qm','migration');const mig=run('rev-parse','HEAD');
 r=prepare(base,mig,['POS/ui.css'],'low','self');
 assert.notEqual(r.status,0);assert.match(r.stderr,/--risk high is required/);
 // 5) prod, backup y ops/canon-migration-*: igual
 for(const f of ['tools/cloudflare-prod/w.js','tools/cloudflare-backup/b.mjs','ops/canon-migration-0099.json']){
  execFileSync('mkdir',['-p',join(repo,f.replace(/\/[^/]*$/,''))]);writeFileSync(join(repo,f),'x');run('add',f);run('commit','-qm',f);
  r=prepare(base,run('rev-parse','HEAD'),['POS/ui.css'],'low','self');
  assert.notEqual(r.status,0,f);assert.match(r.stderr,/--risk high is required/,f);
 }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('automatic web deployment is limited to isolated CSS changes with no backend, secrets or release gate edits', () => {
  assert.equal(typeof autoWebReleaseEligible, 'function');
  assert.equal(autoWebReleaseEligible(['POS/css/base.css','docs/reviews/note.md']), true);
  assert.equal(autoWebReleaseEligible(['docs/reviews/note.md']), false);
  for (const paths of [
    [],['POS/index.html'],['POS/js/sync/outbox.js'],['POS/css/base.css','POS/js/work-host.js'],
    ['POS/css/base.css','tools/cloudflare-lab/src/worker.js'],
    ['POS/css/base.css','infra/database/migrations/0020.sql'],
    ['POS/css/base.css','.github/workflows/v1.3-pos-web-deploy.yml'],
    ['POS/css/base.css','tools/release/web-release.mjs'],
    ['POS/css/../secrets.css']
  ]) assert.equal(autoWebReleaseEligible(paths), false, JSON.stringify(paths));
});


test('DIRECT skips the 53 historic infrastructure commits when POS runtime did not change',()=>{
  assert.deepEqual(directReleaseDecision(['.github/workflows/auto-dev-ci.yml','tools/release/web-release.mjs','docs/a.md']).eligible,false);
});

test('DIRECT publishes visual improvements without second PR despite prior administrative diff',()=>{
  const d=directReleaseDecision(['.github/workflows/auto-dev-ci.yml','docs/update.md','POS/css/work.css']);
  assert.equal(d.eligible,true);
  assert.equal(d.risk,'low');
  assert.deepEqual(d.files,['POS/css/work.css']);
});

test('DIRECT blocks business writes, Worker, schema, unreviewed HTML and arbitrary source',()=>{
  for(const paths of [
    ['POS/js/sync/outbox.js'],
    ['POS/css/a.css','POS/js/modules/ventas-stock.js'],
    ['POS/css/a.css','tools/cloudflare-lab/src/worker.js'],
    ['POS/css/a.css','infra/database/migrations/0099.sql'],
    ['POS/index.html'],
    ['POS/work/index.html'],
    ['POS/css/a.css','tools/cloudflare-pos-web/src/worker.js'],
    ['POS/js/config/pos-permissions.js']
  ]) assert.equal(directReleaseDecision(paths).eligible,false,JSON.stringify(paths));
});

test('DIRECT Work UI needs scoped recorded review from the authorized mission',()=>{
  const intent={authorized:true,mission:'Actualizar Inicio WORK',paths:['POS/work/index.html','POS/js/work-host.js'],
    reviewKind:'technical',reviewEvidence:'docs/reviews/work-ui.json'};
  assert.equal(directReleaseDecision(intent.paths,intent).eligible,true);
  assert.equal(directReleaseDecision(intent.paths,{...intent,paths:['POS/work/index.html']}).eligible,false);
  assert.equal(directReleaseDecision(intent.paths,{...intent,mission:''}).eligible,false);
  assert.equal(directReleaseDecision(intent.paths,{...intent,reviewKind:'self'}).eligible,false);
  assert.equal(directReleaseDecision(intent.paths,{...intent,reviewEvidence:'../fake.json'}).eligible,false);
  assert.throws(()=>directReleaseDecision(['POS/css/../trick.css']));
});

test('DIRECT parses exact in-commit authorization without manual release manifest',()=>{
  const data='feat: UX\n\nNA-Direct: true\nNA-Mission: Actualizar Inicio WORK\nNA-Paths: ["POS/work/index.html"]\nNA-Review-Kind: technical\nNA-Review-Evidence: docs/reviews/work-ui.json\n';
  assert.deepEqual(parseDirectIntent(data),{authorized:true,mission:'Actualizar Inicio WORK',paths:['POS/work/index.html'],reviewKind:'technical',reviewEvidence:'docs/reviews/work-ui.json'});
  assert.equal(parseDirectIntent('NA-Direct: false'),null);
  assert.equal(parseDirectIntent('NA-Direct: true\nNA-Paths: {bad json}'),null);
});

test('both legacy and direct guards read Cloudflare response body once',()=>{
  const src=readFileSync(new URL('../../tools/release/web-release.mjs',import.meta.url),'utf8');
  assert.match(src,/liveText\.match\(\/\\b\[a-f0-9\]\{40\}\\b\/g\)/);
  assert.doesNotMatch(src,/const liveText=await live\.text\(\);[\s\S]{0,100}\(await live\.text\(\)\)/);
});

test('DIRECT WORK UI uses the completed CANON CI instead of repeated owner receipts',()=>{
  const changed=['.github/workflows/auto-dev-ci.yml','tools/release/web-release.mjs',
    'POS/index.html','POS/js/work-host.js','POS/work/index.html','POS/work/work-canon-bridge.js'];
  const accepted=directReleaseDecision(changed,null,{autoReviewed:true,workBootstrapPinned:true,deleted:[]});
  assert.equal(accepted.eligible,true);
  assert.equal(accepted.risk,'medium');
  assert.equal(accepted.autoReviewed,true);
  assert.deepEqual(accepted.files,changed.filter(p=>p.startsWith('POS/')));
  assert.equal(directReleaseDecision(changed,null,{autoReviewed:true,workBootstrapPinned:false}).eligible,false);
  assert.equal(directReleaseDecision(changed).eligible,false);
  assert.equal(directReleaseDecision(['POS/work/index.html'],null,{autoReviewed:true,deleted:['POS/work/index.html']}).eligible,false);
  assert.equal(directReleaseDecision(['POS/js/sync/outbox.js','POS/work/index.html'],null,{autoReviewed:true}).eligible,false);
  assert.equal(directReleaseDecision(['POS/js/config/pos-permissions.js','POS/work/index.html'],null,{autoReviewed:true}).eligible,false);
  assert.equal(directReleaseDecision(['POS/work/new-auth.js'],null,{autoReviewed:true}).eligible,false);
  assert.equal(directReleaseDecision(['POS/work/index.html'],{authorized:true,mission:'fake',paths:[]},{autoReviewed:true}).eligible,false);
});

test('trusted visual bootstrap is pinned to the exact approved POS file, not arbitrary HTML',()=>{
  const src=readFileSync(new URL('../../tools/release/web-release.mjs',import.meta.url),'utf8');
  assert.match(src,/PINNED_WORK_BOOTSTRAP_BLOB='0c3e3c919da1055254777515f3d6f2e2daa93254'/);
  assert.match(src,/git\('rev-parse','HEAD:POS\/index.html'\)===PINNED_WORK_BOOTSTRAP_BLOB/);
  assert.match(src,/GITHUB_EVENT_NAME!=='push'/);
  assert.match(src,/diff-filter=D/);
});
