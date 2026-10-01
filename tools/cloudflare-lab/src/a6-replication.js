// No replication protocol: commands keep their existing transaction/idempotency.
// The only missing backend primitive is a single operational browser writer.
import { getDatabase } from './database-binding.js';
export async function localWriter(db) {
  try {
    return await db.prepare(`SELECT w.* FROM canonical_local_writer w JOIN canonical_control c ON c.id=1
      WHERE w.id=1 AND w.promotion_id=c.active_promotion_id AND w.authority_epoch=c.authority_epoch`).first();
  } catch (error) {
    if (/no such table.*canonical_local_writer/i.test(String(error))) return null;
    throw error;
  }
}
function equal(a,b) { if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0; }
export async function localWriterRoute(request,env,auth,json) {
  const db=getDatabase(env),current=await localWriter(db);
  if(request.method==='GET')return json(current ? {writer:current.principal_id===auth.principalId,writer_id:current.principal_id,grant_id:current.grant_id,promotion_id:current.promotion_id,authority_epoch:Number(current.authority_epoch)} : {writer:false,enabled:false});
  if(request.method==='POST' && auth.role!=='writer')return json({error:'read_only_session'},403);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  // Reuse the owner activation credential. Never persist it in a grant/backup.
  const owner=String(env.POS_ACTIVATION_SECRET||''),provided=String(request.headers.get('x-activation-secret')||'');
  if(!owner || !provided || provided.length>1024 || !equal(owner,provided))return json({error:'owner_authorization_required'},401);
  let body;try{body=await request.json();}catch{return json({error:'invalid_json'},400);}
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length)return json({error:'invalid_writer_request'},400);
  const control=await db.prepare('SELECT mode,active_promotion_id,authority_epoch FROM canonical_control WHERE id=1').first();
  if(!control || control.mode!=='ACTIVE')return json({error:'canonical_not_active'},409);
  if(current && current.principal_id!==auth.principalId)return json({error:'writer_handover_required'},409);
  if(current)return json({writer:true,writer_id:current.principal_id,grant_id:current.grant_id,promotion_id:current.promotion_id,authority_epoch:Number(current.authority_epoch)},200);
  const value={writer:true,writer_id:auth.principalId,grant_id:crypto.randomUUID(),promotion_id:control.active_promotion_id,authority_epoch:Number(control.authority_epoch)};
  try {
    const result=await db.prepare(`INSERT INTO canonical_local_writer(id,principal_id,promotion_id,authority_epoch,grant_id,granted_at)
      SELECT 1,?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM canonical_control WHERE id=1 AND mode='ACTIVE' AND active_promotion_id=?2 AND authority_epoch=?3)
      ON CONFLICT(id) DO UPDATE SET principal_id=excluded.principal_id,promotion_id=excluded.promotion_id,authority_epoch=excluded.authority_epoch,grant_id=excluded.grant_id,granted_at=excluded.granted_at
      WHERE canonical_local_writer.promotion_id<>excluded.promotion_id OR canonical_local_writer.authority_epoch<>excluded.authority_epoch`)
      .bind(auth.principalId,value.promotion_id,value.authority_epoch,value.grant_id,new Date().toISOString()).run();
    if(result.meta?.changes!==1)return json({error:'writer_handover_required'},409);
  }catch(error){if(/no such table/i.test(String(error)))return json({error:'local_first_schema_required'},503);throw error;}
  return json(value,201);
}
