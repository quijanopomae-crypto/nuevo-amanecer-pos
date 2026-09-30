import { getDatabase } from './database-binding.js';
import { sha256Hex, stableStringify } from './a5-import-core.js';

export const CUSTOMER_CREDIT_POLICY_COMMANDS=new Set(['customer.credit-policy.set']);

const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function validId(v){return typeof v==='string'&&SAFE_ID.test(v);}
function uint(v){return Number.isSafeInteger(v)&&v>=0;}
function clean(v,max,required=true){
  if(v===undefined||v===null||String(v).trim()==='')return required?null:null;
  const out=String(v).trim().replace(/\s+/g,' ');
  if(!out||out.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(out))return null;
  return out;
}
function normalize(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return{error:'invalid_customer_credit_policy'};
  const allowed=new Set(['operation_id','customer_id','promotion_id','authority_epoch','expected_control_revision','client_contract','created_at','mode','manual_limit_cents','expected_policy_revision','reason','administrator_id','administrator_name']);
  if(Object.keys(raw).some(k=>!allowed.has(k)))return{error:'invalid_customer_credit_policy'};
  for(const k of ['operation_id','customer_id','promotion_id','client_contract'])if(!validId(raw[k]))return{error:'invalid_customer_credit_policy',field:k};
  if(!uint(raw.authority_epoch)||!uint(raw.expected_control_revision)||!uint(raw.expected_policy_revision))return{error:'invalid_customer_credit_policy'};
  if(typeof raw.created_at!=='string'||!TIMESTAMP.test(raw.created_at)||!Number.isFinite(Date.parse(raw.created_at)))return{error:'invalid_customer_credit_policy',field:'created_at'};
  const mode=raw.mode;
  if(!['MANUAL','AUTOMATIC'].includes(mode))return{error:'invalid_customer_credit_policy',field:'mode'};
  const limit=mode==='MANUAL'?raw.manual_limit_cents:null;
  if(mode==='MANUAL'&&(!uint(limit)||limit>100000000))return{error:'invalid_customer_credit_policy',field:'manual_limit_cents'};
  if(mode==='AUTOMATIC'&&raw.manual_limit_cents!==null)return{error:'invalid_customer_credit_policy',field:'manual_limit_cents'};
  const reason=clean(raw.reason,500,true),administratorName=clean(raw.administrator_name,160,true);
  const administratorId=raw.administrator_id==null||String(raw.administrator_id).trim()===''?null:clean(raw.administrator_id,160,true);
  if(!reason||reason.length<8||!administratorName||(raw.administrator_id!=null&&String(raw.administrator_id).trim()!==''&&!administratorId))return{error:'invalid_customer_credit_policy'};
  return{value:{
    operation_id:raw.operation_id,customer_id:raw.customer_id,promotion_id:raw.promotion_id,
    authority_epoch:raw.authority_epoch,expected_control_revision:raw.expected_control_revision,
    client_contract:raw.client_contract,created_at:raw.created_at,mode,
    manual_limit_cents:limit,expected_policy_revision:raw.expected_policy_revision,
    reason,administrator_id:administratorId,administrator_name:administratorName
  }};
}
async function schemaReady(db){
  const row=await db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN ('canonical_customer_credit_policy_operations','canonical_customer_credit_policies')").first();
  return Number(row?.count)===2;
}
async function authorityError(db,auth,b){
  const row=await db.prepare(`SELECT c.mode,c.active_promotion_id,c.authority_epoch,c.revision,c.minimum_client_contract,
    d.role device_role,d.status device_status,d.credential_hash
    FROM canonical_control c LEFT JOIN devices d ON d.device_id=?1 WHERE c.id=1`).bind(auth.principalId).first();
  if(!row||row.mode!=='ACTIVE')return'canonical_not_active';
  if(row.active_promotion_id!==b.promotion_id||Number(row.authority_epoch)!==b.authority_epoch||
     Number(row.revision)!==b.expected_control_revision||row.minimum_client_contract!==b.client_contract||
     row.device_role!=='writer'||row.device_status!=='active'||row.credential_hash!==auth.credentialHash)return'stale_authority';
  return null;
}
async function operationConflict(db,id){
  // D1 limits compound SELECT terms; EXISTS retains every collision check.
  const row=await db.prepare(`SELECT
    EXISTS(SELECT 1 FROM sales WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_financial_operations WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_expense_operations WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_product_operations WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_inventory_operations WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_credit_accounts WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_credit_metadata WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_customer_operations WHERE operation_id=?1)
    OR EXISTS(SELECT 1 FROM canonical_command_receipts WHERE operation_id=?1)
    AS collision`).bind(id).first();
  return !!row?.collision;
}

export async function setCanonicalCustomerCreditPolicy(request,env,auth,json){
  let raw;try{raw=await request.json();}catch{return json({error:'invalid_json'},400);}
  const checked=normalize(raw);if(checked.error)return json({error:checked.error,...(checked.field?{field:checked.field}:{})},400);
  const b=checked.value,db=getDatabase(env);
  if(!await schemaReady(db))return json({error:'customer_credit_policy_schema_not_ready'},503);
  const denied=await authorityError(db,auth,b);if(denied)return json({error:denied},409);
  const customer=await db.prepare('SELECT provenance FROM canonical_customer_registry WHERE promotion_id=?1 AND customer_id=?2').bind(b.promotion_id,b.customer_id).first();
  if(!customer)return json({error:'customer_not_found'},409);

  const requestHash=await sha256Hex(stableStringify(b));
  const existing=await db.prepare('SELECT request_hash,result_json FROM canonical_customer_credit_policy_operations WHERE operation_id=?1').bind(b.operation_id).first();
  if(existing){
    const stale=await authorityError(db,auth,b);if(stale)return json({error:stale},409);
    if(existing.request_hash!==requestHash)return json({error:'operation_id_conflict',operation_id:b.operation_id},409);
    return json({...JSON.parse(existing.result_json),status:'already_processed',idempotent:true},200);
  }
  if(await operationConflict(db,b.operation_id))return json({error:'operation_id_conflict',operation_id:b.operation_id},409);

  const current=await db.prepare('SELECT revision FROM canonical_customer_credit_policies WHERE promotion_id=?1 AND customer_id=?2').bind(b.promotion_id,b.customer_id).first();
  const currentRevision=Number(current?.revision)||0;
  if(currentRevision!==b.expected_policy_revision)return json({error:'stale_policy',current_policy_revision:currentRevision},409);
  const nextRevision=currentRevision+1;
  const result={
    status:'created',command:'customer.credit-policy.set',operation_id:b.operation_id,
    promotion_id:b.promotion_id,customer_id:b.customer_id,mode:b.mode,
    manual_limit_cents:b.manual_limit_cents,policy_revision:nextRevision,
    authority_epoch:b.authority_epoch,idempotent:false
  };
  const token='credit-policy:'+crypto.randomUUID();
  const statements=[
    db.prepare(`INSERT INTO canonical_customer_credit_policy_operations
      (operation_id,command,request_hash,result_json,promotion_id,customer_id,mode,manual_limit_cents,reason,administrator_id,administrator_name,
       expected_policy_revision,authority_epoch,control_revision,client_contract,principal_id,credential_hash,created_at)
      VALUES(?1,'customer.credit-policy.set',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`)
      .bind(b.operation_id,requestHash,stableStringify(result),b.promotion_id,b.customer_id,b.mode,b.manual_limit_cents,b.reason,
        b.administrator_id,b.administrator_name,b.expected_policy_revision,b.authority_epoch,b.expected_control_revision,b.client_contract,
        auth.principalId,auth.credentialHash,b.created_at),
    db.prepare('INSERT INTO canonical_assertions(assertion_id,ok) VALUES(?1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(token+':operation')
  ];
  if(currentRevision===0){
    statements.push(
      db.prepare(`INSERT INTO canonical_customer_credit_policies
        (promotion_id,customer_id,mode,manual_limit_cents,reason,administrator_id,administrator_name,updated_at,revision,operation_id)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9)`)
        .bind(b.promotion_id,b.customer_id,b.mode,b.manual_limit_cents,b.reason,b.administrator_id,b.administrator_name,b.created_at,b.operation_id)
    );
  }else{
    statements.push(
      db.prepare(`UPDATE canonical_customer_credit_policies
        SET mode=?1,manual_limit_cents=?2,reason=?3,administrator_id=?4,administrator_name=?5,updated_at=?6,revision=revision+1,operation_id=?7
        WHERE promotion_id=?8 AND customer_id=?9 AND revision=?10`)
        .bind(b.mode,b.manual_limit_cents,b.reason,b.administrator_id,b.administrator_name,b.created_at,b.operation_id,b.promotion_id,b.customer_id,b.expected_policy_revision)
    );
  }
  statements.push(
    db.prepare('INSERT INTO canonical_assertions(assertion_id,ok) VALUES(?1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(token+':policy'),
    db.prepare('DELETE FROM canonical_assertions WHERE assertion_id IN (?1,?2)').bind(token+':operation',token+':policy')
  );
  try{await db.batch(statements);}
  catch{
    const replay=await db.prepare('SELECT request_hash,result_json FROM canonical_customer_credit_policy_operations WHERE operation_id=?1').bind(b.operation_id).first();
    const stale=await authorityError(db,auth,b);if(stale)return json({error:stale},409);
    if(replay?.request_hash===requestHash)return json({...JSON.parse(replay.result_json),status:'already_processed',idempotent:true},200);
    if(replay)return json({error:'operation_id_conflict',operation_id:b.operation_id},409);
    const now=await db.prepare('SELECT revision FROM canonical_customer_credit_policies WHERE promotion_id=?1 AND customer_id=?2').bind(b.promotion_id,b.customer_id).first();
    if((Number(now?.revision)||0)!==b.expected_policy_revision)return json({error:'stale_policy',current_policy_revision:Number(now?.revision)||0},409);
    return json({error:'customer_credit_policy_conflict',operation_id:b.operation_id},409);
  }
  return json(result,201);
}
