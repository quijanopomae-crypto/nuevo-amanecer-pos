import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const trigger='ops/v1.3-pos-web-deploy-trigger.json';
const sha = value => typeof value==='string' && /^[a-f0-9]{40}$/.test(value);
const fail = message => { throw new Error(message); };
export function validateRelease(m, diff) {
  if(m.format!=='nuevo-amanecer-web-release-v2'||m.authorized!==true||!m.authorization?.trim()) fail('explicit scoped authorization required');
  if(!['low','medium','high'].includes(m.risk)) fail('invalid risk');
  for(const key of ['approved_base','target_commit','rollback_ref']) if(!sha(m[key])) fail('invalid '+key);
  if(m.approved_base!==diff.productionSha) fail('production SHA differs from approved base');
  if(m.approved_base!==diff.base||m.target_commit!==diff.target) fail('release SHA mismatch');
  if(!Array.isArray(m.allowed_paths)||!m.allowed_paths.length||m.allowed_paths.some(p=>typeof p!=='string'||!p||/[?*\[\]\\\n\r]/.test(p)||p.startsWith('/')||p.split('/').includes('..'))) fail('exact scope required');
  const allowed=new Set(m.allowed_paths);
  if(diff.paths.some(p=>!allowed.has(p))||m.allowed_paths.some(p=>!diff.paths.includes(p))) fail('scope differs from complete release diff');
  if(diff.activationPaths.length!==1||diff.activationPaths[0]!==trigger) fail('activation commit contains unrelated changes');
  if(!m.review?.evidence?.trim()||!['self','technical','independent-automated','independent-human'].includes(m.review.kind)) fail('documented review required');
  if(m.risk==='medium'&&m.review.kind==='self') fail('technical review required');
  if(m.risk==='high'&&!m.review.kind.startsWith('independent-')) fail('independent review required');
  return true;
}
export const REQUIRED_CI={ 'CANON Critical CI':'.github/workflows/canon-critical-ci.yml', 'E2E Smoke CI':'.github/workflows/e2e-smoke-ci.yml', 'OpenCode Role Map CI':'.github/workflows/opencode-config-ci.yml' };
export function requireGreenRuns(runs,target) {
  for(const name of Object.keys(REQUIRED_CI)) {
    const expectedPath=REQUIRED_CI[name];
    const candidates=runs.filter(r=>r.name===name&&r.head_sha===target&&r.path===expectedPath&&['push','pull_request','workflow_dispatch'].includes(r.event)).sort((a,b)=>(b.run_number-a.run_number)||(b.run_attempt||1)-(a.run_attempt||1));
    const r=candidates[0];
    if(!r||r.status!=='completed'||r.conclusion!=='success') fail('CI not green on exact target: '+name);
  }
  // Unrelated workflows are reported separately; they do not become universal release gates.
  return true;
}
export function validateReviewReceipt(r,m,afterReview) {
  if(!r||!sha(r.reviewed_commit)||r.result!=='pass'||!r.reviewer?.trim()||r.kind!==m.review.kind)fail('invalid review receipt');
  if(afterReview.some(p=>p!==m.review.evidence))fail('code changed after independent review');
  return true;
}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const paths=(base,target)=>execFileSync('git',['diff','--no-renames','--name-only','-z',base,target],{encoding:'utf8'}).split('\0').filter(Boolean);
// Solo lo que el workflow de deploy publica o ejecuta (POS/**, Worker web, workflow de deploy, guard, el wrangler fijado en tools/cloudflare-lab y los 3 workflows de CI que definen los checks exigidos por requireGreenRuns).
// Tests, docs y archivos eliminados fuera de esas rutas no cambian la web publicada y no se listan en el alcance.
export const DEPLOYED_PREFIXES=['POS/','tools/cloudflare-pos-web/','tools/release/','.github/workflows/v1.3-pos-web-deploy.yml','tools/cloudflare-lab/package.json','tools/cloudflare-lab/package-lock.json',...Object.values(REQUIRED_CI)];
export const deployedOnly=list=>list.filter(p=>DEPLOYED_PREFIXES.some(x=>p===x||p.startsWith(x)));
const releasePaths=(base,target)=>deployedOnly(paths(base,target));
function ancestor(base,target){execFileSync('git',['merge-base','--is-ancestor',base,target]);}
async function main(){
  const [command,...rest]=process.argv.slice(2);
  const args={};
  for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||!rest[i+1])fail('expected --key value');args[rest[i].slice(2)]=rest[i+1];}
  if(command==='prepare'){
    // --scope is a reviewed JSON array, NOT inferred authorization from the entire diff.
    const target=git('rev-parse',args.target||'HEAD'),base=args.base,rollback=args.rollback;
    if(!sha(base)||!sha(rollback)) fail('full base and rollback SHA required');
    ancestor(base,target);ancestor(rollback,target);
    if(git('status','--porcelain'))fail('prepare requires clean worktree');
    const m={format:'nuevo-amanecer-web-release-v2',authorized:true,authorization:args.authorization,risk:args.risk,approved_base:base,target_commit:target,rollback_ref:rollback,allowed_paths:JSON.parse(readFileSync(args.scope,'utf8')),review:{kind:args['review-kind'],evidence:args.review},requested_at_utc:new Date().toISOString()};
    validateRelease(m,{base,target,head:target,productionSha:base,paths:releasePaths(base,target),activationPaths:[trigger]});
    writeFileSync(trigger,JSON.stringify(m,null,2)+'\n');
    console.log('Prepared exact release manifest. Commit only '+trigger+' and open PR; no deployment performed.');
  }else if(command==='verify'){
    const m=JSON.parse(readFileSync(trigger,'utf8')),head=git('rev-parse','HEAD');
    if(!sha(m.approved_base)||!sha(m.target_commit)||!sha(m.rollback_ref))fail('v2 manifest with full SHAs required');
    ancestor(m.approved_base,m.target_commit);ancestor(m.target_commit,head);ancestor(m.rollback_ref,m.target_commit);
    const live=await fetch('https://nuevo-amanecer-pos-web.nuevo-amanecer-pos.workers.dev/app/js/config/build-info.js',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!live.ok)fail('cannot verify production SHA: HTTP '+live.status);
    const liveText=await live.text();
    const hashes=[...new Set(liveText.match(/\b[a-f0-9]{40}\b/g)||[])];
    if(hashes.length!==1)fail('cannot identify unique production SHA');
    validateRelease(m,{productionSha:hashes[0],base:m.approved_base,target:m.target_commit,head,paths:releasePaths(m.approved_base,m.target_commit),activationPaths:paths(m.target_commit,head)});
    if(!/^docs\/[A-Za-z0-9_./-]+\.json$/.test(m.review.evidence)||m.review.evidence.split('/').includes('..'))fail('review evidence must be a versioned docs JSON receipt');
    const receipt=JSON.parse(git('show',m.target_commit+':'+m.review.evidence));
    if(!sha(receipt.reviewed_commit))fail('reviewed commit required');
    ancestor(receipt.reviewed_commit,m.target_commit);
    validateReviewReceipt(receipt,m,paths(receipt.reviewed_commit,m.target_commit));
    const repository=process.env.GITHUB_REPOSITORY;
    if(!repository||!process.env.GH_TOKEN)fail('authenticated GitHub CI verification required');
    let runs=[];
    for(let page=1;;page++){
      const response=await fetch(`https://api.github.com/repos/${repository}/actions/runs?head_sha=${m.target_commit}&per_page=100&page=${page}`,{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'}});
      if(!response.ok)fail('cannot verify CI: HTTP '+response.status);
      const data=await response.json();runs.push(...data.workflow_runs);
      if(data.workflow_runs.length<100)break;
      if(page>=20)fail('too many CI runs; unable to verify completely');
    }
    requireGreenRuns(runs,m.target_commit);
    console.log('WEB_RELEASE_GATE_PASS target='+m.target_commit+' rollback='+m.rollback_ref);
  }else fail('use prepare or verify');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
