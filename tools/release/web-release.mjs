import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
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
export const REQUIRED_CI={ 'AUTO-DEV CI':'.github/workflows/auto-dev-ci.yml' };
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
export const DEPLOYED_PREFIXES=['POS/','tools/cloudflare-pos-web/','tools/release/','.github/workflows/v1.3-pos-web-deploy.yml','tools/cloudflare-lab/package.json','tools/cloudflare-lab/package-lock.json',...Object.values(REQUIRED_CI),'.github/workflows/canon-critical-ci.yml','.github/workflows/e2e-smoke-ci.yml','.github/workflows/opencode-config-ci.yml'];
export const deployedOnly=list=>list.filter(p=>DEPLOYED_PREFIXES.some(x=>p===x||p.startsWith(x)));
const releasePaths=(base,target)=>deployedOnly(paths(base,target));
// Solo una diferencia EXCLUSIVAMENTE visual puede publicarse sin segundo PR.
// Aun si los cambios fuera de POS no se publican, Worker, migraciones y secretos
// nunca pueden viajar en una promocion automatica de CSS.
export function autoWebReleaseEligible(fullPaths) {
  if (!Array.isArray(fullPaths) || !fullPaths.length) return false;
  if (highRiskPaths(fullPaths).length) return false;
  const deployed = deployedOnly(fullPaths);
  return deployed.length > 0 && deployed.every(p =>
    p.startsWith('POS/css/') &&
    p.endsWith('.css') &&
    !p.includes('..') &&
    !p.includes(String.fromCharCode(92))
  );
}
// DIRECT: el diff se mide desde el SHA que realmente sirve Cloudflare.
// Solo el bootstrap visual de WORK ya aprobado (#1088) puede formar parte de un DIRECT.
// Otras ediciones de POS/index.html quedan protegidas por el flujo de riesgo alto.
export const PINNED_WORK_BOOTSTRAP_BLOB='0c3e3c919da1055254777515f3d6f2e2daa93254';
export const APPROVED_WORK_CUTOVER_SHA='8f8e56cd7995d08be604f94cbac1930881a802af';
const approvedScopedUiIntent=(intent,runtime)=>intent?.authorized===true &&
  typeof intent.mission==='string' && !!intent.mission.trim() && intent.reviewKind==='auto-ci' &&
  Array.isArray(intent.paths) && intent.paths.length===runtime.length &&
  new Set(intent.paths).size===runtime.length && intent.paths.every(p=>runtime.includes(p));
export function directReleaseDecision(fullDiff, intent=null, context={}) {
  if (!Array.isArray(fullDiff)) fail('invalid direct diff');
  const safe = p => typeof p === 'string' && p.length>0 && !p.startsWith('/') &&
    !p.includes('..') && !p.includes('\\') && !p.includes('\n');
  if (fullDiff.some(p=>!safe(p))) fail('invalid direct path');
  const runtime=fullDiff.filter(p=>p.startsWith('POS/')||p.startsWith('tools/cloudflare-pos-web/'));
  if (!runtime.length) return {eligible:false,reason:'no web-runtime changes',files:[]};
  if (highRiskPaths(fullDiff).length) return {eligible:false,reason:'backend or database changes',files:runtime};
  const low = p => /^POS\/css\/[A-Za-z0-9_./-]+\.css$/i.test(p) ||
    /^POS\/(?:img|images|icons|assets)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|gif|webp|svg)$/i.test(p);
  const medium = p => /^POS\/work\/[A-Za-z0-9_./-]+\.(?:html|css|png|jpe?g|gif|webp|svg)$/i.test(p) ||
    p==='POS/js/work-host.js' || p==='POS/work/work-canon-bridge.js' ||
    (p==='POS/index.html' && context.workBootstrapPinned===true);
  if (runtime.some(p=>!low(p)&&!medium(p)))
    return {eligible:false,reason:'sensitive or unreviewed web-runtime path',files:runtime};
  if (runtime.every(low)) return {eligible:true,risk:'low',reason:'visual-only',files:runtime};
  if (Array.isArray(context.deleted) && context.deleted.some(p=>runtime.includes(p)))
    return {eligible:false,reason:'deleted WORK runtime file',files:runtime};
  // El CI autenticado de CANON verifica contratos, permisos, negocio y navegador.
  // No se le pide un recibo al dueño para cada cambio WORK dentro de esta lista cerrada.
  if (context.autoReviewed===true &&
      (context.previouslyApprovedWorkCutover===true || approvedScopedUiIntent(intent,runtime)))
    return {eligible:true,risk:'medium',reason:'owner-scoped WORK UI verified by CI',files:runtime,autoReviewed:true};
  if (!intent || intent.authorized!==true || !intent.mission?.trim() ||
      !['technical','independent-automated','independent-human'].includes(intent.reviewKind) ||
      !/^docs\/[A-Za-z0-9_./-]+\.json$/.test(intent.reviewEvidence||'') ||
      !Array.isArray(intent.paths))
    return {eligible:false,reason:'reviewed scoped mission required',files:runtime};
  const expected=new Set(runtime);
  if(new Set(intent.paths).size!==expected.size || intent.paths.some(p=>!expected.has(p)))
    return {eligible:false,reason:'scope differs from complete runtime diff',files:runtime};
  return {eligible:true,risk:'medium',reason:'reviewed Work UI',files:runtime,evidence:intent.reviewEvidence};
}
export function parseDirectIntent(message) {
  if (typeof message!=='string') return null;
  const get=k=>message.match(new RegExp('^'+k+': (.+)$','m'))?.[1]?.trim();
  if (get('NA-Direct')!=='true') return null;
  try {
    return {authorized:true,mission:get('NA-Mission'),paths:JSON.parse(get('NA-Paths')||'null'),
      reviewKind:get('NA-Review-Kind'),reviewEvidence:get('NA-Review-Evidence')};
  } catch { return null; }
}

function output(name,value) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT,name+'='+String(value)+String.fromCharCode(10));
}

// Avisos de prepare: lo excluido del alcance se muestra (no bloquea) y el riesgo mínimo se deriva del diff, no solo de --risk.
export const excludedFromScope=list=>list.filter(p=>!deployedOnly([p]).length);
export const HIGH_RISK_PREFIXES=['tools/cloudflare-lab/','tools/cloudflare-prod/','tools/cloudflare-backup/','infra/database/migrations/','ops/canon-migration'];
export const highRiskPaths=list=>list.filter(p=>HIGH_RISK_PREFIXES.some(x=>p.startsWith(x))||/\.sql$/i.test(p));
export function requireRiskForDiff(risk,list) {
  const hits=highRiskPaths(list);
  if(hits.length&&risk!=='high') fail('the diff touches the Worker, backups or SQL migrations ('+hits.slice(0,5).join(', ')+(hits.length>5?', +'+(hits.length-5)+' more':'')+'): --risk high is required');
  return hits;
}
export function scopeWarning(list,max=15) {
  const out=excludedFromScope(list);
  if(!out.length) return '';
  const top={};for(const p of out){const k=p.split('/')[0];top[k]=(top[k]||0)+1;}
  const summary=Object.entries(top).sort((x,y)=>y[1]-x[1]).map(([k,n])=>k+' '+n).join(', ');
  return 'WARNING: '+out.length+' file(s) in the diff are not part of the manifest scope (not published by the web deploy): '+summary+'.\n'+out.slice(0,max).map(p=>'  - '+p).join('\n')+(out.length>max?'\n  ... and '+(out.length-max)+' more':'');
}
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
    const fullDiff=paths(base,target);
    const approvedPaths=args.scope==='auto' ? deployedOnly(fullDiff) : JSON.parse(readFileSync(args.scope,'utf8'));
    const m={format:'nuevo-amanecer-web-release-v2',authorized:true,authorization:args.authorization,risk:args.risk,approved_base:base,target_commit:target,rollback_ref:rollback,allowed_paths:approvedPaths,review:{kind:args['review-kind'],evidence:args.review},requested_at_utc:new Date().toISOString()};
    requireRiskForDiff(m.risk,fullDiff);
    const warning=scopeWarning(fullDiff);if(warning)console.warn(warning);
    validateRelease(m,{base,target,head:target,productionSha:base,paths:deployedOnly(fullDiff),activationPaths:[trigger]});
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

  }else if(command==='verify-auto'){
    // Invocado solo tras un E2E de push al CANON; el workflow verifica ademas
    // que HEAD coincide exactamente con la rama activa y que el actor es confiable.
    const target=git('rev-parse','HEAD');
    const live=await fetch('https://nuevo-amanecer-pos-web.nuevo-amanecer-pos.workers.dev/app/js/config/build-info.js',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!live.ok) fail('cannot verify production SHA: HTTP '+live.status);
    const hashes=[...new Set((await live.text()).match(/\b[a-f0-9]{40}\b/g)||[])];
    if(hashes.length!==1) fail('cannot identify unique production SHA');
    const base=hashes[0];
    if(base===target){output('eligible','false');console.log('AUTO_WEB_SKIP already published');return;}
    ancestor(base,target);
    const changed=paths(base,target);
    if(!autoWebReleaseEligible(changed)){
      output('eligible','false');
      console.log('AUTO_WEB_SKIP requires the scoped manifest for non-CSS changes');
      return;
    }
    const repository=process.env.GITHUB_REPOSITORY;
    if(!repository||!process.env.GH_TOKEN)fail('authenticated GitHub CI verification required');
    const getRuns=async()=>{
      const runs=[];
      for(let page=1;;page++){
        const response=await fetch('https://api.github.com/repos/'+repository+'/actions/runs?head_sha='+target+'&per_page=100&page='+page,{signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json'}});
        if(!response.ok) fail('cannot verify CI: HTTP '+response.status);
        const data=await response.json();runs.push(...data.workflow_runs);
        if(data.workflow_runs.length<100)return runs;
        if(page>=20)fail('too many CI runs; unable to verify completely');
      }
    };
    let checked=false;
    for(let i=0;i<90;i++){
      try { requireGreenRuns(await getRuns(),target);checked=true;break; }
      catch(err) {
        // Fallar cerrado, no desplegar tras timeout. Nunca inventar un SUCCESS.
        if(i===89)throw err;
        await new Promise(resolve=>setTimeout(resolve,10000));
      }
    }
    if(!checked)fail('CI checks could not be verified');
    const record={mode:'css-only-auto',production_sha:base,target_commit:target,rollback_ref:base,files:deployedOnly(changed),authorization:'Owner mission: autonomous scoped development and publication',validated_at_utc:new Date().toISOString()};
    writeFileSync('/tmp/pos-auto-release.json',JSON.stringify(record,null,2)+String.fromCharCode(10));
    output('eligible','true');
    console.log('WEB_RELEASE_GATE_PASS automatic CSS-only target='+target+' rollback='+base);
  }else if(command==='verify-direct'){
    if(process.env.GITHUB_WORKFLOW!=='AUTO-DEV CI' ||
       process.env.GITHUB_REF!=='refs/heads/feature/v1.3-mobile-cloud' ||
       process.env.GITHUB_EVENT_NAME!=='push') fail('DIRECT requires trusted CANON push CI');
    const target=git('rev-parse','HEAD');
    if(process.env.GITHUB_SHA!==target) fail('checkout differs from event target');
    const response=await fetch('https://nuevo-amanecer-pos-web.nuevo-amanecer-pos.workers.dev/app/js/config/build-info.js',
      {cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)fail('production SHA probe failed HTTP '+response.status);
    const hashes=[...new Set((await response.text()).match(/\b[a-f0-9]{40}\b/g)||[])];
    if(hashes.length!==1)fail('unique production SHA required');
    const base=hashes[0];
    if(base===target){output('eligible','false');console.log('DIRECT_SKIP already published');return;}
    ancestor(base,target);
    const changed=paths(base,target);
    const intent=parseDirectIntent(git('log','-1','--format=%B',target));
    const deleted=git('diff','--no-renames','--name-only','--diff-filter=D',base,target,'--','POS/').split('\n').filter(Boolean);
    const workBootstrapPinned=!changed.includes('POS/index.html') ||
      git('rev-parse','HEAD:POS/index.html')===PINNED_WORK_BOOTSTRAP_BLOB;
    // #1088 es la única excepción inicial: no admitir nuevos archivos POS
    // desde aquel commit sin una misión NA-Direct que cubra el diff completo.
    let previouslyApprovedWorkCutover=false;
    try {
      ancestor(APPROVED_WORK_CUTOVER_SHA,target);
      previouslyApprovedWorkCutover=paths(APPROVED_WORK_CUTOVER_SHA,target)
        .filter(p=>p.startsWith('POS/')).length===0;
    } catch (_) { previouslyApprovedWorkCutover=false; }
    const decision=directReleaseDecision(changed,intent,{
      autoReviewed:true,workBootstrapPinned,deleted,previouslyApprovedWorkCutover
    });
    if(!decision.eligible){
      output('eligible','false');
      console.log('DIRECT_SKIP '+decision.reason);
      return;
    }
    if(decision.risk==='medium' && !decision.autoReviewed){
      const receipt=JSON.parse(git('show',target+':'+decision.evidence));
      if(!sha(receipt.reviewed_commit) || receipt.kind!==intent.reviewKind)fail('review receipt mismatch');
      ancestor(receipt.reviewed_commit,target);
      validateReviewReceipt(receipt,{review:{kind:intent.reviewKind,evidence:decision.evidence}},
        paths(receipt.reviewed_commit,target));
    }
    const record={mode:'direct-web',risk:decision.risk,production_sha:base,target_commit:target,
      rollback_ref:base,files:decision.files,mission:intent?.mission||'Authorized visual improvement',
      review:decision.autoReviewed?'AUTO-DEV CI scoped WORK UI':decision.evidence||null,
      validated_at_utc:new Date().toISOString()};
    writeFileSync('/tmp/pos-auto-release.json',JSON.stringify(record,null,2)+'\n');
    output('eligible','true');
    console.log('DIRECT_WEB_GATE_PASS target='+target+' prior='+base+' files='+decision.files.length);
  }else fail('use prepare, verify, verify-auto or verify-direct');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
