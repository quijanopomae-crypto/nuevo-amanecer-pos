import { sha256Hex, stableStringify } from './a5-import-core.js';

export const FINANCIAL_COMMANDS = new Set(['payment.create','cash.open','cash.close','adjustment.create','compensation.create']);
const COMMON = ['operation_id','promotion_id','client_contract','authority_epoch','expected_control_revision','created_at'];
const FIELDS = {
  'payment.create': ['credit_id','expected_credit_revision','amount_cents','payment_method','session_id','reference'],
  'cash.open': ['session_id','opening_cents'],
  'cash.close': ['session_id','expected_session_revision','counted_cents'],
  'adjustment.create': ['session_id','expected_session_revision','amount_cents','reason'],
  'compensation.create': ['compensates_operation_id','session_id','expected_session_revision','expected_credit_revision','reason'],
};
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 160 && !/[\x00-\x1f\x7f]/.test(v);
const uint = v => Number.isSafeInteger(v) && v >= 0;
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 500 && !/[\x00-\x1f\x7f]/.test(v);

function validate(command, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'invalid_body';
  if (Object.keys(b).some(k => ![...COMMON,...FIELDS[command]].includes(k))) return 'unexpected_field';
  if (!['operation_id','promotion_id'].every(k => id(b[k]))) return 'invalid_identity';
  if (b.client_contract !== 'a6-gate-c-v1' || !uint(b.authority_epoch) || !uint(b.expected_control_revision)) return 'invalid_authority_revision';
  if (typeof b.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(b.created_at) ||
      !Number.isFinite(Date.parse(b.created_at)) || !Number.isFinite(Date.parse(b.created_at.slice(0,10))) ||
      new Date(b.created_at.slice(0,10)).toISOString().slice(0,10) !== b.created_at.slice(0,10)) return 'invalid_created_at';
  if (b.session_id !== undefined && !id(b.session_id)) return 'invalid_session_id';
  if (b.expected_session_revision !== undefined && !uint(b.expected_session_revision)) return 'invalid_session_revision';
  if (b.expected_credit_revision !== undefined && !uint(b.expected_credit_revision)) return 'invalid_credit_revision';
  if (command === 'payment.create') {
    if (!id(b.credit_id) || !uint(b.expected_credit_revision) || !uint(b.amount_cents) || b.amount_cents === 0 ||
        !['efectivo','yape','plin','transferencia'].includes(b.payment_method)) return 'invalid_payment';
    if (b.payment_method === 'efectivo' ? !id(b.session_id) : b.session_id !== undefined) return 'invalid_payment_session';
    if (b.reference !== undefined && !id(b.reference)) return 'invalid_reference';
  }
  if (command === 'cash.open' && (!id(b.session_id) || !uint(b.opening_cents))) return 'invalid_opening';
  if (command === 'cash.close' && (!id(b.session_id) || !uint(b.expected_session_revision) || !uint(b.counted_cents))) return 'invalid_closure';
  if (command === 'adjustment.create' && (!id(b.session_id) || !uint(b.expected_session_revision) || !Number.isSafeInteger(b.amount_cents) || b.amount_cents === 0)) return 'invalid_adjustment';
  if (['adjustment.create','compensation.create'].includes(command) && !text(b.reason)) return 'reason_required';
  if (command === 'compensation.create' && !id(b.compensates_operation_id)) return 'invalid_compensation';
  return null;
}

export async function createCanonicalFinancial(command, request, env, auth, json) {
  let body;
  try { body = await request.json(); } catch { return json({error:'invalid_json'},400); }
  const invalid = validate(command,body);
  if (invalid) return json({error:invalid},400);
  const db = env.nuevo_amanecer_lab;
  const hash = await sha256Hex(stableStringify({command,body}));
  async function authorityError() {
    const c = await db.prepare(`SELECT c.*,d.role,d.status,d.credential_hash FROM canonical_control c
      LEFT JOIN devices d ON d.device_id=?1 WHERE c.id=1`).bind(auth.principalId).first();
    if (!c || c.mode !== 'ACTIVE') return 'canonical_not_active';
    if (c.active_promotion_id !== body.promotion_id || c.authority_epoch !== body.authority_epoch ||
        c.revision !== body.expected_control_revision || c.minimum_client_contract !== body.client_contract ||
        c.role !== 'writer' || c.status !== 'active' || c.credential_hash !== auth.credentialHash) return 'stale_authority';
    return null;
  }
  async function replay() {
    const row = await db.prepare('SELECT command,request_hash,result_json FROM canonical_financial_operations WHERE operation_id=?1').bind(body.operation_id).first();
    const collision = row ? null : await db.prepare('SELECT operation_id FROM sales WHERE operation_id=?1').bind(body.operation_id).first();
    const denied = await authorityError();
    if (denied) return json({error:denied},409);
    if (collision || (row && (row.command !== command || row.request_hash !== hash))) return json({error:'operation_id_conflict',operation_id:body.operation_id},409);
    return row ? json({...JSON.parse(row.result_json),status:'already_processed',idempotent:true}) : null;
  }
  const denied = await authorityError();
  if (denied) return json({error:denied},409);
  const previous = await replay();
  if (previous) return previous;

  const token = crypto.randomUUID();
  const assertions = [];
  const assert = (condition, ...params) => assertions.push(db.prepare(`INSERT INTO canonical_assertions(assertion_id,ok)
    SELECT ?1,CASE WHEN ${condition} THEN 1 ELSE 0 END`).bind(`${token}:cas:${assertions.length}`,...params));
  const result = {status:'created',operation_id:body.operation_id,command,promotion_id:body.promotion_id,authority_epoch:body.authority_epoch,idempotent:false};
  let credit = null, session = null, target = null;
  let creditDelta = 0, cashDelta = 0;
  let method = body.payment_method ?? null;
  if (command === 'compensation.create') {
    target = await db.prepare(`SELECT * FROM canonical_financial_events WHERE operation_id=?1 AND promotion_id=?2
      AND event_type IN ('PAYMENT','ADJUSTMENT')`).bind(body.compensates_operation_id,body.promotion_id).first();
    if (!target) return json({error:'compensation_target_not_found'},409);
    if (await db.prepare('SELECT 1 ok FROM canonical_financial_events WHERE compensates_operation_id=?1').bind(body.compensates_operation_id).first()) return json({error:'already_compensated'},409);
    creditDelta = -target.credit_delta_cents; cashDelta = -target.cash_delta_cents; method = target.payment_method;
    if (cashDelta !== 0 ? !id(body.session_id) || !uint(body.expected_session_revision) : body.session_id !== undefined || body.expected_session_revision !== undefined) return json({error:'invalid_compensation_session'},400);
    if (target.credit_id !== null ? !uint(body.expected_credit_revision) : body.expected_credit_revision !== undefined) return json({error:'invalid_credit_revision'},400);
    result.compensates_operation_id = body.compensates_operation_id;
  }
  if (command === 'payment.create') { creditDelta = -body.amount_cents; cashDelta = method === 'efectivo' ? body.amount_cents : 0; }
  if (command === 'adjustment.create') cashDelta = body.amount_cents;
  const creditId = command === 'payment.create' ? body.credit_id : target?.credit_id;
  if (creditId) {
    credit = await db.prepare('SELECT * FROM canonical_credit_balances WHERE promotion_id=?1 AND credit_id=?2').bind(body.promotion_id,creditId).first();
    if (!credit || credit.revision !== body.expected_credit_revision) return json({error:'stale_credit'},409);
    const balance = credit.current_balance_cents + creditDelta;
    if (!uint(balance) || balance > credit.opening_balance_cents) return json({error:'credit_balance_conflict'},409);
    assert(`EXISTS(SELECT 1 FROM canonical_credit_balances WHERE promotion_id=?2 AND credit_id=?3 AND provenance=?4
      AND revision=?5 AND current_balance_cents=?6)`,body.promotion_id,creditId,credit.provenance,credit.revision,credit.current_balance_cents);
    Object.assign(result,{credit_id:creditId,credit_provenance:credit.provenance,current_balance_cents:balance,credit_revision:credit.revision+1});
  }
  if (body.session_id && command !== 'cash.open') {
    session = await db.prepare('SELECT * FROM canonical_cash_state WHERE promotion_id=?1 AND session_id=?2').bind(body.promotion_id,body.session_id).first();
    if (!session || session.status !== 'OPEN' || (body.expected_session_revision !== undefined && session.revision !== body.expected_session_revision)) return json({error:'stale_session'},409);
    if (!uint(session.expected_cents + cashDelta)) return json({error:'cash_balance_conflict'},409);
    assert(`EXISTS(SELECT 1 FROM canonical_cash_state WHERE promotion_id=?2 AND session_id=?3 AND status='OPEN'
      AND revision=?4 AND expected_cents=?5 AND closing_watermark=?6)`,body.promotion_id,body.session_id,session.revision,session.expected_cents,session.closing_watermark);
    Object.assign(result,{session_id:body.session_id,session_revision:session.revision+1,expected_cents:session.expected_cents+cashDelta});
  }
  const effects = [];
  if (command === 'cash.open') {
    Object.assign(result,{session_id:body.session_id,session_revision:0,expected_cents:body.opening_cents});
    effects.push(db.prepare(`INSERT INTO canonical_cash_sessions(session_id,promotion_id,open_operation_id,opening_cents,cash_movement_watermark,opened_at)
      VALUES(?1,?2,?3,?4,(SELECT COALESCE(MAX(rowid),0) FROM cash_movements),?5)`)
      .bind(body.session_id,body.promotion_id,body.operation_id,body.opening_cents,body.created_at));
  } else if (command === 'cash.close') {
    Object.assign(result,{counted_cents:body.counted_cents,difference_cents:body.counted_cents-session.expected_cents});
    effects.push(db.prepare(`INSERT INTO canonical_cash_closures(session_id,close_operation_id,expected_cents,counted_cents,difference_cents,cash_movement_watermark,closed_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(body.session_id,body.operation_id,session.expected_cents,body.counted_cents,result.difference_cents,session.closing_watermark,body.created_at));
  } else {
    result.event_id = body.operation_id;
    result.cash_delta_cents = cashDelta;
    result.credit_delta_cents = creditDelta;
    effects.push(db.prepare(`INSERT INTO canonical_financial_events(event_id,operation_id,promotion_id,event_type,session_id,credit_id,credit_provenance,
      credit_delta_cents,cash_delta_cents,payment_method,reference,reason,compensates_operation_id,created_at)
      VALUES(?1,?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`)
      .bind(body.operation_id,body.promotion_id,command==='payment.create'?'PAYMENT':command==='adjustment.create'?'ADJUSTMENT':'COMPENSATION',
        body.session_id??null,creditId??null,credit?.provenance??null,creditDelta,cashDelta,method,body.reference??null,body.reason??null,body.compensates_operation_id??null,body.created_at));
  }
  const receipt = db.prepare(`INSERT INTO canonical_financial_operations(operation_id,command,request_hash,result_json,promotion_id,
    authority_epoch,control_revision,client_contract,device_id,credential_hash,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
    .bind(body.operation_id,command,hash,stableStringify(result),body.promotion_id,body.authority_epoch,body.expected_control_revision,body.client_contract,auth.principalId,auth.credentialHash,body.created_at);
  const guard = db.prepare(`INSERT INTO canonical_write_guards(operation_id,commit_token,promotion_id,authority_epoch,control_revision,client_contract,principal_id,credential_hash)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`).bind(body.operation_id,token,body.promotion_id,body.authority_epoch,body.expected_control_revision,body.client_contract,auth.principalId,auth.credentialHash);
  const marker = db.prepare(`UPDATE canonical_control SET first_live_operation_id=COALESCE(first_live_operation_id,?1)
    WHERE id=1 AND mode='ACTIVE' AND active_promotion_id=?2 AND authority_epoch=?3 AND revision=?4
    AND EXISTS(SELECT 1 FROM canonical_write_guards WHERE operation_id=?1 AND commit_token=?5)`)
    .bind(body.operation_id,body.promotion_id,body.authority_epoch,body.expected_control_revision,token);
  // D1 batch is the durable boundary: receipt, CAS checks and effect commit together.
  // A zero-row mutation cannot become a successful receipt.
  const statements = [];
  for (const [i, statement] of [guard,receipt,...assertions,...effects,marker,
    db.prepare('DELETE FROM canonical_write_guards WHERE operation_id=?1 AND commit_token=?2').bind(body.operation_id,token)].entries()) {
    statements.push(statement,db.prepare('INSERT INTO canonical_assertions(assertion_id,ok) VALUES(?1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(`${token}:changed:${i}`));
  }
  statements.push(db.prepare('DELETE FROM canonical_assertions WHERE assertion_id LIKE ?1').bind(`${token}:%`));
  try { await db.batch(statements); }
  catch (error) {
    const recovered = await replay();
    if (recovered) return recovered;
    // Storage/transport failures are not disguised as business conflicts or success.
    const conflict = /constraint|conflict|stale_authority|gate_p_control|invalid_|forbidden/i.test(String(error?.message));
    return json({error:conflict?'financial_conflict':'financial_storage_error',operation_id:body.operation_id,retry_same_operation_id:true},conflict?409:503);
  }
  return json(result,201);
}
