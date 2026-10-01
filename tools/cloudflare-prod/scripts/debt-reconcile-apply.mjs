import { readFileSync } from 'node:fs';
import { TursoD1Adapter } from '../../cloudflare-lab/src/turso-d1-adapter.js';
import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
} from 'node:crypto';

const TRIGGER_PATH = process.env.DEBT_RECONCILE_TRIGGER_PATH || 'ops/v1.3-prod-debt-reconcile-apply-trigger.json';
const PROVIDER = String(process.env.DEBT_RECONCILE_PROVIDER || 'd1').trim().toLowerCase();
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';
const TURSO_URL = process.env.TURSO_PROD_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_PROD_AUTH_TOKEN || '';
let tursoDb = null;
const PROD_WORKER = process.env.PROD_WORKER_URL || 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
const POS_SECRET = process.env.POS_ACTIVATION_SECRET || '';
const EXPECTED_COUNT = 29;
const EXPECTED_TOTAL_CENTS = 2368495;
const SOURCE_LABEL = 'casamarket-2026-10-01';
const PRIVATE_AAD = Buffer.from('nuevo-amanecer-debt-reconcile-private-v1');
const PAYLOAD_AAD = Buffer.from('nuevo-amanecer-debt-reconcile-payload-v1');

function unb64(value) {
  if (typeof value !== 'string' || !value) throw new Error('invalid encrypted field');
  return Buffer.from(value,'base64');
}
function privateSealKey() {
  if (!POS_SECRET || POS_SECRET.length < 12) throw new Error('POS_ACTIVATION_SECRET missing or invalid');
  return createHash('sha256')
    .update('nuevo-amanecer-debt-reconcile-private-key-v1\0')
    .update(POS_SECRET)
    .digest();
}
function openPrivate(sealed) {
  const decipher = createDecipheriv('aes-256-gcm',privateSealKey(),unb64(sealed.iv_b64));
  decipher.setAAD(PRIVATE_AAD);
  decipher.setAuthTag(unb64(sealed.tag_b64));
  return Buffer.concat([decipher.update(unb64(sealed.ciphertext_b64)),decipher.final()]);
}
function openPayload(trigger) {
  if (!trigger.key_material || !trigger.payload) throw new Error('missing encrypted target payload');
  const privateKey = createPrivateKey({key:openPrivate(trigger.key_material.sealed_private),format:'der',type:'pkcs8'});
  const ephemeralDer = unb64(trigger.payload.ephemeral_spki_b64);
  const ephemeral = createPublicKey({key:ephemeralDer,format:'der',type:'spki'});
  const shared = diffieHellman({privateKey,publicKey:ephemeral});
  const publicDer = unb64(trigger.key_material.public_spki_b64);
  const salt = createHash('sha256').update(publicDer).update(ephemeralDer).digest();
  const key = Buffer.from(hkdfSync('sha256',shared,salt,Buffer.from('nuevo-amanecer-debt-reconcile-payload-key-v1'),32));
  const decipher = createDecipheriv('aes-256-gcm',key,unb64(trigger.payload.iv_b64));
  decipher.setAAD(PAYLOAD_AAD);
  decipher.setAuthTag(unb64(trigger.payload.tag_b64));
  return JSON.parse(Buffer.concat([
    decipher.update(unb64(trigger.payload.ciphertext_b64)),
    decipher.final()
  ]).toString('utf8'));
}
function validateTargets(payload) {
  if (!payload || payload.format !== 'casamarket-customer-debt-target-v1' || !Array.isArray(payload.rows)) throw new Error('invalid target payload');
  if (payload.rows.length !== EXPECTED_COUNT) throw new Error('target row count mismatch');
  let total=0;
  const documents=new Set();
  payload.rows.forEach((row,index)=>{
    if(!row||typeof row.document!=='string'||! /^\d{8}$/.test(row.document))throw new Error('invalid target document at index '+(index+1));
    if(typeof row.name!=='string'||row.name.trim().length<1||row.name.trim().length>240)throw new Error('invalid target name at index '+(index+1));
    if(!Number.isSafeInteger(row.target_cents)||row.target_cents<0)throw new Error('invalid target cents at index '+(index+1));
    if(documents.has(row.document))throw new Error('duplicate target document');
    documents.add(row.document);
    total+=row.target_cents;
  });
  if(total!==EXPECTED_TOTAL_CENTS)throw new Error('target total mismatch');
  return payload.rows;
}
function normalizeName(value) {
  return String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function requireEnv() {
  if(!['d1','turso'].includes(PROVIDER))throw new Error('invalid debt reconciliation provider');
  if(PROVIDER==='d1'){
    if(!/^[a-f0-9]{32}$/.test(ACCOUNT))throw new Error('invalid CLOUDFLARE_ACCOUNT_ID');
    if(!TOKEN)throw new Error('missing CLOUDFLARE_API_TOKEN');
  }else{
    if(!TURSO_URL)throw new Error('missing TURSO_PROD_DATABASE_URL');
    if(!TURSO_TOKEN)throw new Error('missing TURSO_PROD_AUTH_TOKEN');
  }
  if(!POS_SECRET||POS_SECRET.length<12)throw new Error('missing POS_ACTIVATION_SECRET');
}
function tursoDatabase(){
  if(!tursoDb)tursoDb=new TursoD1Adapter({url:TURSO_URL,authToken:TURSO_TOKEN});
  return tursoDb;
}
async function cfRaw(sql,params=[]) {
  requireEnv();
  if(PROVIDER==='turso'){
    const statement=tursoDatabase().prepare(sql);
    return params.length?statement.bind(...params).all():statement.all();
  }
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+PROD_DB+'/query',{
    method:'POST',
    headers:{authorization:'Bearer '+TOKEN,'content-type':'application/json'},
    body:JSON.stringify({sql,params})
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success!==true)throw new Error('Cloudflare D1 query failed '+response.status);
  const first=Array.isArray(body.result)?body.result[0]:body.result;
  if(!first||first.success===false)throw new Error('Cloudflare D1 query returned failure');
  return first;
}
async function cfQuery(sql,params=[]) {
  const out=await cfRaw(sql,params);
  return Array.isArray(out.results)?out.results:[];
}
async function fetchJson(url,options={}) {
  const response=await fetch(url,{redirect:'error',cache:'no-store',...options});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body)throw new Error('production Worker request failed '+response.status);
  return body;
}
function stableId(prefix,value) {
  return prefix+createHash('sha256').update(value).digest('hex').slice(0,32);
}
async function control() {
  const row=(await cfQuery("SELECT mode,active_promotion_id,revision,authority_epoch,minimum_client_contract FROM canonical_control WHERE id=1"))[0];
  if(!row||row.mode!=='ACTIVE'||!row.active_promotion_id)throw new Error('production CANON is not ACTIVE');
  return row;
}
async function schemaReady() {
  const row=(await cfQuery("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('canonical_reconciliation_credits','canonical_credit_baseline_adjustments')"))[0];
  if(Number(row?.n)!==2)throw new Error('reconciliation schema not ready');
}
async function protectedCounts() {
  const row=(await cfQuery(
    "SELECT "+
    "(SELECT COUNT(*) FROM credit_payments) imported_payments,"+
    "(SELECT COUNT(*) FROM canonical_financial_events) financial_events,"+
    "(SELECT COUNT(*) FROM cash_movements) cash_movements,"+
    "(SELECT COUNT(*) FROM canonical_expenses) expenses,"+
    "(SELECT COUNT(*) FROM sales) sales,"+
    "(SELECT COUNT(*) FROM sale_items) sale_items"
  ))[0];
  return Object.fromEntries(Object.entries(row||{}).map(([key,value])=>[key,Number(value)]));
}
async function identityRows(promotionId) {
  return await cfQuery([
    "WITH identity AS (",
    " SELECT customer_id,trim(document) AS document,name,'IMPORT' AS customer_provenance FROM customers WHERE promotion_id=?1",
    " UNION ALL",
    " SELECT customer_id,trim(document) AS document,name,'LIVE' AS customer_provenance FROM canonical_live_customers WHERE promotion_id=?1",
    "), credit_map AS (",
    " SELECT promotion_id,customer_id,credit_id,'IMPORT' AS credit_provenance FROM credits",
    " UNION ALL SELECT promotion_id,customer_id,credit_id,'LIVE' FROM live_credits",
    " UNION ALL SELECT promotion_id,customer_id,credit_id,'IMPORT' FROM canonical_reconciliation_credits",
    "), agg AS (",
    " SELECT m.customer_id,COUNT(*) credit_count,COALESCE(SUM(b.current_balance_cents),0) current_cents",
    " FROM credit_map m JOIN canonical_credit_balances b",
    " ON b.promotion_id=m.promotion_id AND b.credit_id=m.credit_id AND b.provenance=m.credit_provenance",
    " WHERE m.promotion_id=?1 GROUP BY m.customer_id",
    ") SELECT i.customer_id,i.document,i.name,i.customer_provenance,COALESCE(a.credit_count,0) credit_count,COALESCE(a.current_cents,0) current_cents",
    " FROM identity i LEFT JOIN agg a ON a.customer_id=i.customer_id ORDER BY i.customer_id"
  ].join(' '),[promotionId]);
}
function matchTargets(targets,identities,{allowMissing=false}={}) {
  const byDoc=new Map(),byName=new Map();
  for(const row of identities){
    const doc=String(row.document||'').trim();
    if(doc){const list=byDoc.get(doc)||[];list.push(row);byDoc.set(doc,list);}
    const key=normalizeName(row.name);
    if(key){const list=byName.get(key)||[];list.push(row);byName.set(key,list);}
  }
  return targets.map((target,index)=>{
    const docs=byDoc.get(target.document)||[];
    const names=byName.get(normalizeName(target.name))||[];
    let matches=docs,matchedBy='document';
    if(matches.length===0){matches=names;matchedBy='name';}
    if(matches.length===0&&allowMissing)return{index:index+1,target,customer:null,matchedBy:'missing'};
    if(matches.length!==1)throw new Error('target identity match count invalid at index '+(index+1));
    if(docs.length===1&&names.length===1&&docs[0].customer_id!==names[0].customer_id)throw new Error('target identity disagreement at index '+(index+1));
    return{index:index+1,target,customer:matches[0],matchedBy};
  });
}
async function activateWriter() {
  const activated=await fetchJson(PROD_WORKER+'/auth/activate',{method:'POST',headers:{'x-activation-secret':POS_SECRET}});
  if(typeof activated.session_token!=='string'||!activated.session_token)throw new Error('activation token missing');
  const headers={authorization:'Bearer '+activated.session_token,'content-type':'application/json'};
  const session=await fetchJson(PROD_WORKER+'/auth/session',{headers});
  if(typeof session.session_id!=='string'||!session.session_id)throw new Error('session id missing');
  const status=await fetchJson(PROD_WORKER+'/read/canonical/status',{headers});
  if(status.authority!=='canonical'||status.mode!=='ACTIVE')throw new Error('canonical Worker status invalid');
  return{headers,sessionId:session.session_id,status};
}
async function cleanupWriter(sessionId) {
  if(!sessionId)return;
  await cfRaw("UPDATE auth_sessions SET status='revoked' WHERE session_id=?1 AND status='active'",[sessionId]);
  await cfRaw("UPDATE devices SET status='revoked' WHERE device_id=?1 AND status='active'",['session:'+sessionId]);
}
async function customerCreateDiagnostics(match,writer) {
  const tables=['canonical_customer_operations','canonical_customer_registry','canonical_live_customers','canonical_expense_operations','canonical_product_operations','canonical_inventory_operations','canonical_credit_accounts','canonical_credit_metadata'];
  const tableRows=await cfQuery("SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+tables.map((_,i)=>'?'+(i+1)).join(',')+")",tables);
  const present=new Set(tableRows.map(row=>String(row.name)));
  const operationId=stableId('debt-reconcile-customer-',SOURCE_LABEL+':'+match.index);
  const customerId=stableId('recon-customer-',SOURCE_LABEL+':'+match.index);
  const [operationCollision,customerCollision,documentCollision]=await Promise.all([
    cfQuery("SELECT COUNT(*) AS n FROM (SELECT operation_id FROM sales WHERE operation_id=?1 UNION ALL SELECT operation_id FROM canonical_financial_operations WHERE operation_id=?1 UNION ALL SELECT operation_id FROM canonical_expense_operations WHERE operation_id=?1 UNION ALL SELECT operation_id FROM canonical_product_operations WHERE operation_id=?1 UNION ALL SELECT operation_id FROM canonical_inventory_operations WHERE operation_id=?1 UNION ALL SELECT operation_id FROM canonical_credit_accounts WHERE operation_id=?1 UNION ALL SELECT operation_id FROM canonical_credit_metadata WHERE operation_id=?1 UNION ALL SELECT operation_id FROM canonical_customer_operations WHERE operation_id=?1)",[operationId]),
    cfQuery("SELECT COUNT(*) AS n FROM canonical_customer_registry WHERE promotion_id=?1 AND customer_id=?2",[writer.status.promotion_id,customerId]),
    cfQuery("SELECT (SELECT COUNT(*) FROM customers WHERE promotion_id=?1 AND lower(trim(COALESCE(document,'')))=lower(trim(?2)))+(SELECT COUNT(*) FROM canonical_live_customers WHERE promotion_id=?1 AND lower(trim(COALESCE(document,'')))=lower(trim(?2))) AS n",[writer.status.promotion_id,match.target.document])
  ]);
  return {
    missing_tables:tables.filter(name=>!present.has(name)),
    operation_collision:Number(operationCollision[0]?.n||0),
    customer_id_collision:Number(customerCollision[0]?.n||0),
    document_collision:Number(documentCollision[0]?.n||0)
  };
}

async function createMissingCustomers(matches,writer,trigger) {
  const createdAt=trigger.source_effective_at_utc;
  if(typeof createdAt!=='string'||! /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt))throw new Error('invalid reconciliation timestamp');
  for(const match of matches){
    if(match.customer)continue;
    const body={
      operation_id:stableId('debt-reconcile-customer-',SOURCE_LABEL+':'+match.index),
      customer_id:stableId('recon-customer-',SOURCE_LABEL+':'+match.index),
      promotion_id:writer.status.promotion_id,
      authority_epoch:Number(writer.status.authority_epoch),
      expected_control_revision:Number(writer.status.revision),
      client_contract:writer.status.minimum_client_contract,
      created_at:createdAt,
      name:match.target.name,
      document:match.target.document,
      phone:null,
      address:null,
      color:(match.index-1)%8
    };
    const response=await fetch(PROD_WORKER+'/commands/customer.create',{
      method:'POST',headers:writer.headers,body:JSON.stringify(body),redirect:'error',cache:'no-store'
    });
    const receipt=await response.json().catch(()=>null);
    if(!response.ok||!receipt||!['created','already_processed'].includes(String(receipt.status||''))){
      const diagnostic=await customerCreateDiagnostics(match,writer).catch(()=>({diagnostic_failed:true}));
      throw new Error('customer creation failed at index '+match.index+' status='+response.status+' code='+String(receipt?.error||'unknown')+' diag='+JSON.stringify(diagnostic));
    }
  }
}
async function insertSyntheticCredit(promotionId,match,delta,createdAt) {
  const creditId=stableId('recon-credit-',promotionId+':'+SOURCE_LABEL+':'+match.index);
  const reconciliationId=stableId('debt-reconcile-',SOURCE_LABEL+':'+match.index);
  const existing=(await cfQuery(
    "SELECT customer_id,original_amount_cents,target_customer_balance_cents,source_index,source_label FROM canonical_reconciliation_credits WHERE reconciliation_id=?1",
    [reconciliationId]
  ))[0];
  if(existing){
    if(String(existing.customer_id)!==String(match.customer.customer_id)||
       Number(existing.original_amount_cents)!==delta||
       Number(existing.target_customer_balance_cents)!==match.target.target_cents||
       Number(existing.source_index)!==match.index||
       String(existing.source_label)!==SOURCE_LABEL)throw new Error('reconciliation replay mismatch at index '+match.index);
    return;
  }
  await cfRaw(
    "INSERT INTO canonical_reconciliation_credits(reconciliation_id,promotion_id,credit_id,customer_id,original_amount_cents,target_customer_balance_cents,source_index,source_label,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
    [reconciliationId,promotionId,creditId,String(match.customer.customer_id),delta,match.target.target_cents,match.index,SOURCE_LABEL,createdAt]
  );
}
async function reduceBaseline(promotionId,match,amount,createdAt) {
  let remaining=amount;
  const rows=await cfQuery([
    "SELECT b.credit_id,b.provenance,b.current_balance_cents",
    "FROM canonical_credit_balances b",
    "JOIN (",
    " SELECT promotion_id,customer_id,credit_id,'IMPORT' provenance FROM credits",
    " UNION ALL SELECT promotion_id,customer_id,credit_id,'LIVE' FROM live_credits",
    ") m ON m.promotion_id=b.promotion_id AND m.credit_id=b.credit_id AND m.provenance=b.provenance",
    "WHERE b.promotion_id=?1 AND m.customer_id=?2 AND b.current_balance_cents>0",
    "ORDER BY b.current_balance_cents DESC,b.credit_id"
  ].join(' '),[promotionId,String(match.customer.customer_id)]);
  let part=0;
  for(const row of rows){
    if(remaining<=0)break;
    const available=Number(row.current_balance_cents);
    if(!Number.isSafeInteger(available)||available<=0)continue;
    const take=Math.min(remaining,available);
    part+=1;
    const adjustmentId=stableId('debt-baseline-',SOURCE_LABEL+':'+match.index+':'+part+':'+row.credit_id);
    const existing=(await cfQuery(
      "SELECT credit_id,credit_provenance,customer_id,delta_cents,target_customer_balance_cents,source_index,source_label FROM canonical_credit_baseline_adjustments WHERE adjustment_id=?1",
      [adjustmentId]
    ))[0];
    if(existing){
      if(String(existing.credit_id)!==String(row.credit_id)||String(existing.credit_provenance)!==String(row.provenance)||
         String(existing.customer_id)!==String(match.customer.customer_id)||Number(existing.delta_cents)!==-take||
         Number(existing.target_customer_balance_cents)!==match.target.target_cents||Number(existing.source_index)!==match.index||
         String(existing.source_label)!==SOURCE_LABEL)throw new Error('baseline replay mismatch at index '+match.index);
    }else{
      await cfRaw(
        "INSERT INTO canonical_credit_baseline_adjustments(adjustment_id,promotion_id,credit_id,credit_provenance,customer_id,delta_cents,target_customer_balance_cents,source_index,source_label,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        [adjustmentId,promotionId,String(row.credit_id),String(row.provenance),String(match.customer.customer_id),-take,match.target.target_cents,match.index,SOURCE_LABEL,createdAt]
      );
    }
    remaining-=take;
  }
  if(remaining!==0)throw new Error('insufficient baseline to reduce at index '+match.index);
}
async function verifyExact(targets,promotionId) {
  const identities=await identityRows(promotionId);
  const matches=matchTargets(targets,identities);
  let total=0;
  for(const match of matches){
    const current=Number(match.customer.current_cents||0);
    if(current!==match.target.target_cents)throw new Error('post-write balance mismatch at index '+match.index);
    total+=current;
  }
  if(total!==EXPECTED_TOTAL_CENTS)throw new Error('post-write matched total mismatch');
  const global=(await cfQuery("SELECT COALESCE(SUM(current_balance_cents),0) AS total FROM canonical_credit_balances WHERE promotion_id=?1",[promotionId]))[0];
  if(Number(global?.total)!==EXPECTED_TOTAL_CENTS)throw new Error('post-write global debt total mismatch');
  return matches;
}

async function main() {
  requireEnv();
  const trigger=JSON.parse(readFileSync(TRIGGER_PATH,'utf8'));
  if(trigger.authorized!==true||trigger.authorized_by!=='owner'||trigger.mode!=='apply')throw new Error('owner apply authorization missing');
  if(trigger.target_count!==EXPECTED_COUNT||trigger.target_total_cents!==EXPECTED_TOTAL_CENTS)throw new Error('trigger invariant mismatch');
  const targets=validateTargets(openPayload(trigger));
  await schemaReady();
  const c=await control();
  const beforeProtected=await protectedCounts();
  let writer=null;
  try{
    let identities=await identityRows(c.active_promotion_id);
    let matches=matchTargets(targets,identities,{allowMissing:true});
    writer=await activateWriter();
    if(writer.status.promotion_id!==c.active_promotion_id||
       Number(writer.status.authority_epoch)!==Number(c.authority_epoch)||
       Number(writer.status.revision)!==Number(c.revision))throw new Error('Worker authority differs from reconciliation provider');
    await createMissingCustomers(matches,writer,trigger);

    identities=await identityRows(c.active_promotion_id);
    matches=matchTargets(targets,identities);
    for(const match of matches){
      const current=Number(match.customer.current_cents||0);
      const delta=match.target.target_cents-current;
      if(delta>0)await insertSyntheticCredit(c.active_promotion_id,match,delta,trigger.source_effective_at_utc);
      else if(delta<0)await reduceBaseline(c.active_promotion_id,match,-delta,trigger.source_effective_at_utc);
    }

    const verified=await verifyExact(targets,c.active_promotion_id);
    const afterProtected=await protectedCounts();
    if(JSON.stringify(beforeProtected)!==JSON.stringify(afterProtected))throw new Error('protected commercial ledgers changed during reconciliation');
    const stats=(await cfQuery(
      "SELECT (SELECT COUNT(*) FROM canonical_reconciliation_credits WHERE promotion_id=?1) synthetic_credits,"+
      "(SELECT COUNT(*) FROM canonical_credit_baseline_adjustments WHERE promotion_id=?1) baseline_adjustments",
      [c.active_promotion_id]
    ))[0];
    console.log('DEBT_RECONCILE_APPLY='+JSON.stringify({
      state:'APPLY_PASS',
      target_count:verified.length,
      total_cents:EXPECTED_TOTAL_CENTS,
      synthetic_credits:Number(stats?.synthetic_credits||0),
      baseline_adjustments:Number(stats?.baseline_adjustments||0),
      protected_ledgers_unchanged:true
    }));
  } finally {
    if(writer?.sessionId)await cleanupWriter(writer.sessionId);
  }
}
main().catch(error=>{console.error('DEBT_RECONCILE_APPLY_FAIL='+String(error?.message||error));process.exit(1);});
