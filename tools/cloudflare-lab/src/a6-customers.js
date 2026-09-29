import { getDatabase } from './database-binding.js';
import { sha256Hex, stableStringify } from './a5-import-core.js';

export const CUSTOMER_COMMANDS = new Set(['customer.create']);

const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function validId(value){return typeof value==='string'&&SAFE_ID.test(value);}
function uint(value){return Number.isSafeInteger(value)&&value>=0;}
function clean(value,max,required=false){
  if(value===undefined||value===null||String(value).trim()===''){
    return required?null:null;
  }
  const out=String(value).trim().replace(/\s+/g,' ');
  if(!out||out.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(out))return null;
  return out;
}

function normalize(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return{error:'invalid_customer_request'};
  const allowed=new Set([
    'operation_id','customer_id','promotion_id','authority_epoch','expected_control_revision','client_contract','created_at',
    'name','document','phone','address','color'
  ]);
  if(Object.keys(body).some((key)=>!allowed.has(key)))return{error:'invalid_customer_request'};
  for(const key of ['operation_id','customer_id','promotion_id','client_contract'])
    if(!validId(body[key]))return{error:'invalid_customer_request',field:key};
  if(!uint(body.authority_epoch)||!uint(body.expected_control_revision))
    return{error:'invalid_customer_request'};
  if(typeof body.created_at!=='string'||!TIMESTAMP.test(body.created_at)||!Number.isFinite(Date.parse(body.created_at)))
    return{error:'invalid_customer_request',field:'created_at'};
  const name=clean(body.name,240,true);
  if(!name)return{error:'invalid_customer_request',field:'name'};
  const optional=(value,max)=>{
    if(value===undefined||value===null||String(value).trim()==='')return null;
    return clean(value,max,false);
  };
  const document=optional(body.document,32);
  const phone=optional(body.phone,64);
  const address=optional(body.address,500);
  if((body.document!=null&&String(body.document).trim()!==''&&!document)||
     (body.phone!=null&&String(body.phone).trim()!==''&&!phone)||
     (body.address!=null&&String(body.address).trim()!==''&&!address))
    return{error:'invalid_customer_request'};
  if(!Number.isInteger(body.color)||body.color<0||body.color>7)
    return{error:'invalid_customer_request',field:'color'};
  return{value:{
    operation_id:body.operation_id,customer_id:body.customer_id,promotion_id:body.promotion_id,
    authority_epoch:body.authority_epoch,expected_control_revision:body.expected_control_revision,
    client_contract:body.client_contract,created_at:body.created_at,name,document,phone,address,color:body.color
  }};
}

async function schemaReady(db){
  const row=await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type='table' AND name IN ('canonical_customer_operations','canonical_customer_registry','canonical_live_customers')`).first();
  return Number(row?.count)===3;
}

async function authorityError(db,auth,body){
  const control=await db.prepare(`SELECT c.*,d.role AS device_role,d.status AS device_status,d.credential_hash
    FROM canonical_control c LEFT JOIN devices d ON d.device_id=?1 WHERE c.id=1`).bind(auth.principalId).first();
  if(!control||control.mode!=='ACTIVE')return'canonical_not_active';
  if(control.active_promotion_id!==body.promotion_id||
     Number(control.authority_epoch)!==body.authority_epoch||
     Number(control.revision)!==body.expected_control_revision||
     control.minimum_client_contract!==body.client_contract||
     control.device_role!=='writer'||control.device_status!=='active'||
     control.credential_hash!==auth.credentialHash)return'stale_authority';
  return null;
}

async function operationConflict(db,operationId){
  const row=await db.prepare(`SELECT operation_id FROM (
    SELECT operation_id FROM sales WHERE operation_id=?1
    UNION ALL SELECT operation_id FROM canonical_financial_operations WHERE operation_id=?1
    UNION ALL SELECT operation_id FROM canonical_expense_operations WHERE operation_id=?1
    UNION ALL SELECT operation_id FROM canonical_product_operations WHERE operation_id=?1
    UNION ALL SELECT operation_id FROM canonical_inventory_operations WHERE operation_id=?1
    UNION ALL SELECT operation_id FROM canonical_credit_accounts WHERE operation_id=?1
    UNION ALL SELECT operation_id FROM canonical_credit_metadata WHERE operation_id=?1
  ) LIMIT 1`).bind(operationId).first();
  return !!row;
}

async function customerIdConflict(db,body){
  const row=await db.prepare(`SELECT customer_id FROM canonical_customer_registry
    WHERE promotion_id=?1 AND customer_id=?2 LIMIT 1`).bind(body.promotion_id,body.customer_id).first();
  return !!row;
}

async function documentConflict(db,body){
  if(!body.document)return null;
  const imported=await db.prepare(`SELECT customer_id FROM customers
    WHERE promotion_id=?1 AND lower(trim(COALESCE(document,'')))=lower(trim(?2)) LIMIT 1`)
    .bind(body.promotion_id,body.document).first();
  if(imported)return imported.customer_id;
  const live=await db.prepare(`SELECT customer_id FROM canonical_live_customers
    WHERE promotion_id=?1 AND lower(trim(COALESCE(document,'')))=lower(trim(?2)) LIMIT 1`)
    .bind(body.promotion_id,body.document).first();
  return live?.customer_id||null;
}

export async function createCanonicalCustomer(request,env,auth,json){
  let raw;try{raw=await request.json();}catch{return json({error:'invalid_json'},400);}
  const checked=normalize(raw);
  if(checked.error)return json({error:checked.error,...(checked.field?{field:checked.field}:{})},400);
  const body=checked.value,db=getDatabase(env);

  if(!await schemaReady(db))return json({error:'customer_schema_not_ready'},503);
  const denied=await authorityError(db,auth,body);
  if(denied)return json({error:denied},409);

  const requestHash=await sha256Hex(stableStringify(body));
  const existing=await db.prepare('SELECT request_hash,result_json FROM canonical_customer_operations WHERE operation_id=?1')
    .bind(body.operation_id).first();
  if(existing){
    const stale=await authorityError(db,auth,body);if(stale)return json({error:stale},409);
    if(existing.request_hash!==requestHash)return json({error:'operation_id_conflict',operation_id:body.operation_id},409);
    return json({...JSON.parse(existing.result_json),status:'already_processed',idempotent:true},200);
  }
  if(await operationConflict(db,body.operation_id))
    return json({error:'operation_id_conflict',operation_id:body.operation_id},409);
  if(await customerIdConflict(db,body))
    return json({error:'customer_id_conflict',customer_id:body.customer_id},409);
  const docOwner=await documentConflict(db,body);
  if(docOwner)return json({error:'customer_document_conflict',customer_id:docOwner},409);

  const result={
    status:'created',command:'customer.create',operation_id:body.operation_id,
    customer_id:body.customer_id,promotion_id:body.promotion_id,
    authority_epoch:body.authority_epoch,idempotent:false
  };
  const token='customer:'+crypto.randomUUID();
  const statements=[
    db.prepare(`INSERT INTO canonical_customer_operations
      (operation_id,command,request_hash,result_json,promotion_id,customer_id,authority_epoch,control_revision,client_contract,principal_id,credential_hash,created_at)
      VALUES(?1,'customer.create',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
      .bind(body.operation_id,requestHash,stableStringify(result),body.promotion_id,body.customer_id,
        body.authority_epoch,body.expected_control_revision,body.client_contract,auth.principalId,auth.credentialHash,body.created_at),
    db.prepare('INSERT INTO canonical_assertions(assertion_id,ok) VALUES(?1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)')
      .bind(token+':operation'),
    db.prepare(`INSERT INTO canonical_customer_registry
      (promotion_id,customer_id,provenance,operation_id,created_at)
      VALUES(?1,?2,'LIVE',?3,?4)`)
      .bind(body.promotion_id,body.customer_id,body.operation_id,body.created_at),
    db.prepare('INSERT INTO canonical_assertions(assertion_id,ok) VALUES(?1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)')
      .bind(token+':registry'),
    db.prepare(`INSERT INTO canonical_live_customers
      (promotion_id,customer_id,operation_id,name,document,phone,address,color,total_purchases_cents,created_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0,?9)`)
      .bind(body.promotion_id,body.customer_id,body.operation_id,body.name,body.document,body.phone,body.address,String(body.color),body.created_at),
    db.prepare('INSERT INTO canonical_assertions(assertion_id,ok) VALUES(?1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)')
      .bind(token+':customer'),
    db.prepare('DELETE FROM canonical_assertions WHERE assertion_id IN (?1,?2,?3)')
      .bind(token+':operation',token+':registry',token+':customer')
  ];

  try{await db.batch(statements);}
  catch{
    const replay=await db.prepare('SELECT request_hash,result_json FROM canonical_customer_operations WHERE operation_id=?1')
      .bind(body.operation_id).first();
    const stale=await authorityError(db,auth,body);if(stale)return json({error:stale},409);
    if(replay?.request_hash===requestHash)
      return json({...JSON.parse(replay.result_json),status:'already_processed',idempotent:true},200);
    if(replay)return json({error:'operation_id_conflict',operation_id:body.operation_id},409);
    const docOwnerAfter=await documentConflict(db,body);
    if(docOwnerAfter)return json({error:'customer_document_conflict',customer_id:docOwnerAfter},409);
    if(await customerIdConflict(db,body))
      return json({error:'customer_id_conflict',customer_id:body.customer_id},409);
    return json({error:'canonical_customer_conflict',operation_id:body.operation_id},409);
  }
  return json(result,201);
}
