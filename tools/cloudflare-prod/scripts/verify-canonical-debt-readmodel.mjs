import { TursoD1Adapter } from '../../cloudflare-lab/src/turso-d1-adapter.js';

const ENDPOINT=String(process.env.CANON_READ_ENDPOINT||'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev').replace(/\/+$/,'');
const SECRET=process.env.POS_ACTIVATION_SECRET||'';
const TURSO_URL=process.env.TURSO_PROD_DATABASE_URL||'';
const TURSO_TOKEN=process.env.TURSO_PROD_AUTH_TOKEN||'';
const EXPECTED_TOTAL=Number(process.env.EXPECTED_DEBT_CENTS||2368495);
const EXPECTED_POSITIVE_CUSTOMERS=Number(process.env.EXPECTED_DEBT_CUSTOMERS||29);

if(!SECRET)throw new Error('missing POS_ACTIVATION_SECRET');

async function json(url,options={}){
  const response=await fetch(url,{redirect:'error',cache:'no-store',...options});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body)throw new Error('request failed '+response.status+' '+new URL(url).pathname);
  return body;
}
async function readAll(route,headers,status){
  const items=[]; let cursor=null; const seen=new Set();
  do{
    const url=new URL(ENDPOINT+'/read/canonical/'+route);
    url.searchParams.set('limit','100');
    if(cursor)url.searchParams.set('cursor',cursor);
    const page=await json(url.href,{headers});
    if(page.authority!=='canonical'||page.mode!=='ACTIVE')throw new Error(route+' non-active authority');
    if(page.promotion_id!==status.promotion_id||Number(page.authority_epoch)!==Number(status.authority_epoch))throw new Error(route+' authority drift');
    if(Number(page.financial_revision)!==Number(status.financial_revision))throw new Error(route+' financial revision drift');
    if(!Array.isArray(page.items))throw new Error(route+' items missing');
    items.push(...page.items);
    cursor=page.next_cursor||null;
    if(cursor&&seen.has(cursor))throw new Error(route+' cursor repeated');
    if(cursor)seen.add(cursor);
  }while(cursor);
  return items;
}
let sessionId=null;
try{
  const activated=await json(ENDPOINT+'/auth/activate',{method:'POST',headers:{'x-activation-secret':SECRET}});
  if(typeof activated.session_token!=='string'||!activated.session_token)throw new Error('activation token missing');
  const headers={authorization:'Bearer '+activated.session_token};
  const session=await json(ENDPOINT+'/auth/session',{headers});
  sessionId=String(session.session_id||'');
  const status=await json(ENDPOINT+'/read/canonical/status',{headers});
  if(status.authority!=='canonical'||status.mode!=='ACTIVE')throw new Error('canonical status invalid');
  const [customers,credits]=await Promise.all([
    readAll('customers',headers,status),
    readAll('credits',headers,status)
  ]);
  const byCustomer=new Map();
  for(const credit of credits){
    const amount=Number(credit.current_balance_cents);
    if(!Number.isSafeInteger(amount)||amount<0)throw new Error('invalid current_balance_cents');
    const id=String(credit.customer_id||'');
    if(!id)throw new Error('credit customer missing');
    byCustomer.set(id,(byCustomer.get(id)||0)+amount);
  }
  const total=[...byCustomer.values()].reduce((a,b)=>a+b,0);
  const positive=[...byCustomer.values()].filter(v=>v>0).length;
  if(total!==EXPECTED_TOTAL)throw new Error('canonical credit read total mismatch: '+total);
  if(positive!==EXPECTED_POSITIVE_CUSTOMERS)throw new Error('canonical positive-customer count mismatch: '+positive);
  console.log(JSON.stringify({
    state:'CANON_DEBT_READMODEL_PASS',
    endpoint:ENDPOINT,
    customers:customers.length,
    credits:credits.length,
    positive_customers:positive,
    total_cents:total,
    financial_revision:Number(status.financial_revision)
  }));
}finally{
  if(sessionId&&TURSO_URL&&TURSO_TOKEN){
    const db=new TursoD1Adapter({url:TURSO_URL,authToken:TURSO_TOKEN});
    await db.prepare("UPDATE auth_sessions SET status='revoked' WHERE session_id=?1 AND status='active'").bind(sessionId).run();
    await db.prepare("UPDATE devices SET status='revoked' WHERE device_id=?1 AND status='active'").bind('session:'+sessionId).run();
  }
}
