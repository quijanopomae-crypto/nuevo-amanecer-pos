import { sha256Hex, stableStringify } from './a5-import-core.js';

const METHODS = new Set(['efectivo', 'yape', 'plin', 'transferencia', 'credito', 'mixto']);
export const CANONICAL_CLIENT_CONTRACT = 'a6-gate-c-v1';
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

export function validateCanonicalSale(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  for (const key of ['operation_id','sale_id','promotion_id','client_contract']) if (!validId(body[key])) return { error: `invalid_${key}` };
  if (body.client_contract !== CANONICAL_CLIENT_CONTRACT || !Number.isSafeInteger(body.authority_epoch) || body.authority_epoch < 0 || !Number.isSafeInteger(body.expected_control_revision) || body.expected_control_revision < 0) return { error: 'invalid_authority_revision' };
  if (!METHODS.has(body.payment_method) || !Number.isSafeInteger(body.total_cents) || body.total_cents <= 0) return { error: 'invalid_sale' };
  if (typeof body.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(body.created_at) ||
      !validDate(body.created_at.slice(0,10)) || !Number.isFinite(Date.parse(body.created_at))) return { error: 'invalid_created_at' };
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500) return { error: 'invalid_items' };
  let total = 0;
  const seen = new Set();
  for (const item of body.items) {
    if (!isObject(item) || !validId(item.product_id) || seen.has(item.product_id) || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(item.unit_price_cents) || item.unit_price_cents < 0 || !Number.isSafeInteger(item.line_total_cents) ||
        item.line_total_cents !== Math.round(item.quantity * item.unit_price_cents) ||
        !Number.isSafeInteger(item.expected_stock_revision) || item.expected_stock_revision < 0) return { error: 'invalid_item' };
    seen.add(item.product_id); total += item.line_total_cents;
    if (!Number.isSafeInteger(total)) return { error: 'unsafe_total' };
  }
  if (total !== body.total_cents) return { error: 'total_mismatch' };
  const payment = body.payment;
  if (!isObject(payment) || !['cash_cents','digital_cents','credit_cents'].every(key => Number.isSafeInteger(payment[key]) && payment[key] >= 0)) return { error: 'invalid_payment' };
  const cash = body.payment_method === 'efectivo' ? total : body.payment_method === 'mixto' ? payment.cash_cents : 0;
  const digital = ['yape','plin','transferencia'].includes(body.payment_method) ? total : body.payment_method === 'mixto' ? payment.digital_cents : 0;
  const credit = body.payment_method === 'credito' ? total : 0;
  if (![cash,digital,credit].every(Number.isSafeInteger) || cash < 0 || digital < 0 || cash + digital + credit !== total) return { error: 'invalid_payment' };
  if (payment.cash_cents !== cash || payment.digital_cents !== digital || payment.credit_cents !== credit) return { error: 'invalid_payment' };
  if (body.payment_method === 'mixto' && (cash <= 0 || digital <= 0 || !['yape','plin','transferencia'].includes(payment.digital_method))) return { error: 'invalid_payment' };
  if (payment.reference !== undefined && payment.reference !== null && (typeof payment.reference !== 'string' || payment.reference.length > 160 || /[\x00-\x1f\x7f]/.test(payment.reference))) return { error: 'invalid_reference' };
  if (body.payment_method === 'credito' && (!validId(body.customer_id) || !validDate(body.credit_due))) return { error: 'invalid_credit' };
  if (body.customer_id != null && !validId(body.customer_id)) return { error: 'invalid_customer_id' };
  if (body.session_id !== undefined && (!validId(body.session_id) || cash === 0)) return { error:'invalid_session_id' };
  return { value: { ...body, created_at: new Date(body.created_at).toISOString(), payment: { cash_cents: cash, digital_cents: digital, credit_cents: credit,
    digital_method: digital ? (body.payment_method === 'mixto' ? payment.digital_method : body.payment_method) : null, reference: payment.reference || null } } };
}

export async function createCanonicalSale(request, env, auth, json) {
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const checked = validateCanonicalSale(body);
  if (checked.error) return json({ error: checked.error }, 400);
  body = checked.value;
  const principalId = auth.principalId;
  const db = env.nuevo_amanecer_lab;
  // Authorization and the authority contract apply even to a durable replay.
  // Recheck again after replay lookup (including recovery from a lost ACK).
  async function authorityError() {
    const control = await db.prepare(`SELECT c.*,d.role AS device_role,d.status AS device_status,d.credential_hash
      FROM canonical_control c LEFT JOIN devices d ON d.device_id=?1 WHERE c.id=1`).bind(principalId).first();
    if (!control || control.mode !== 'ACTIVE') return 'canonical_not_active';
    if (control.active_promotion_id !== body.promotion_id || Number(control.authority_epoch) !== body.authority_epoch ||
        Number(control.revision) !== body.expected_control_revision || control.minimum_client_contract !== body.client_contract ||
        control.writer_device_id !== principalId || control.device_role !== 'writer' ||
        control.device_status !== 'active' || control.credential_hash !== auth.credentialHash) return 'stale_authority';
    return null;
  }
  const denied = await authorityError();
  if (denied) return json({ error:denied },409);
  const payloadHash = await sha256Hex(stableStringify(body));
  const existing = await db.prepare('SELECT sale_id,payload_hash FROM sales WHERE operation_id=?1').bind(body.operation_id).first();
  if (existing) {
    const stale = await authorityError();
    if (stale) return json({ error:stale },409);
    return existing.payload_hash === payloadHash
      ? json({ status:'already_processed',operation_id:body.operation_id,sale_id:existing.sale_id,idempotent:true })
      : json({ error:'operation_id_conflict',operation_id:body.operation_id },409);
  }
  if (await db.prepare('SELECT operation_id FROM canonical_financial_operations WHERE operation_id=?1').bind(body.operation_id).first()) return json({error:'operation_id_conflict',operation_id:body.operation_id},409);
  const products = [];
  for (const item of body.items) {
    const product = await db.prepare('SELECT product_id,current_stock_quantity,stock_revision,tracks_inventory FROM products WHERE promotion_id=?1 AND product_id=?2').bind(body.promotion_id,item.product_id).first();
    if (!product || ![0,1].includes(product.tracks_inventory) || Number(product.stock_revision) !== item.expected_stock_revision ||
        (product.tracks_inventory === 1 && (product.current_stock_quantity === null || Number(product.current_stock_quantity) < item.quantity))) return json({ error:'stale_stock',product_id:item.product_id },409);
    products.push(product);
  }
  if (body.customer_id) {
    const customer = await db.prepare('SELECT 1 ok FROM customers WHERE promotion_id=?1 AND customer_id=?2').bind(body.promotion_id,body.customer_id).first();
    if (!customer) return json({ error:'customer_not_found' },409);
  }
  const token = crypto.randomUUID();
  const statements = [
    db.prepare(`INSERT INTO canonical_write_guards(operation_id,commit_token,promotion_id,authority_epoch,control_revision,client_contract)
      SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS(SELECT 1 FROM canonical_control c JOIN devices d ON d.device_id=?7
      WHERE c.id=1 AND c.mode='ACTIVE' AND c.active_promotion_id=?3 AND c.authority_epoch=?4 AND c.revision=?5
      AND c.minimum_client_contract=?6 AND c.writer_device_id=?7 AND d.role='writer' AND d.status='active' AND d.credential_hash=?8)`).bind(body.operation_id,token,body.promotion_id,body.authority_epoch,body.expected_control_revision,body.client_contract,principalId,auth.credentialHash),
    db.prepare(`INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,payment_reference,created_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9 WHERE EXISTS(SELECT 1 FROM canonical_write_guards WHERE operation_id=?2 AND commit_token=?4)`).bind(body.sale_id,body.operation_id,payloadHash,token,principalId,body.payment_method,body.total_cents,body.payment.reference,body.created_at),
    db.prepare(`INSERT INTO canonical_sale_context(sale_id,operation_id,promotion_id,authority_epoch,control_revision,customer_id,client_contract,created_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM sales WHERE operation_id=?2 AND commit_token=?9)`).bind(body.sale_id,body.operation_id,body.promotion_id,body.authority_epoch,body.expected_control_revision,body.customer_id||null,body.client_contract,body.created_at,token),
  ];
  // Optional explicit identity fences a stale till selection. Without it, the
  // unique open session owns the sale through immutable rowid watermarks.
  if (body.session_id) statements.push(db.prepare(`INSERT INTO canonical_assertions(assertion_id,ok)
    SELECT ?1,CASE WHEN EXISTS(SELECT 1 FROM canonical_cash_state WHERE promotion_id=?2 AND session_id=?3 AND status='OPEN') THEN 1 ELSE 0 END`)
    .bind(`${token}:session`,body.promotion_id,body.session_id));
  for (let index=0; index<body.items.length; index++) {
    const item=body.items[index], line=index+1, product=products[index];
    statements.push(db.prepare(`INSERT INTO canonical_assertions(assertion_id,ok) SELECT ?1,CASE WHEN EXISTS(
      SELECT 1 FROM products WHERE promotion_id=?2 AND product_id=?3 AND stock_revision=?4 AND tracks_inventory=?5
      AND (tracks_inventory=0 OR current_stock_quantity>=?6)) THEN 1 ELSE 0 END`).bind(`${token}:stock:${line}`,body.promotion_id,item.product_id,item.expected_stock_revision,product.tracks_inventory,item.quantity));
    statements.push(db.prepare(`INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE EXISTS(SELECT 1 FROM canonical_write_guards WHERE operation_id=?3)`).bind(body.sale_id,line,body.operation_id,item.product_id,item.quantity,item.unit_price_cents,item.line_total_cents,body.created_at));
    if (product.tracks_inventory !== 0) {
      statements.push(db.prepare(`UPDATE products SET current_stock_quantity=current_stock_quantity-?1,stock_revision=stock_revision+1
        WHERE promotion_id=?2 AND product_id=?3 AND stock_revision=?4 AND current_stock_quantity>=?1`).bind(item.quantity,body.promotion_id,item.product_id,item.expected_stock_revision));
      statements.push(db.prepare(`INSERT INTO inventory_movements(movement_id,operation_id,sale_id,line_number,product_id,quantity,created_at)
        SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE changes()=1`).bind(`${body.operation_id}:inventory:${line}`,body.operation_id,body.sale_id,line,item.product_id,-item.quantity,body.created_at));
      statements.push(db.prepare(`INSERT INTO canonical_inventory_effects(movement_id,operation_id,promotion_id,product_id,stock_revision_before,stock_revision_after,quantity)
        SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE changes()=1`).bind(`${body.operation_id}:inventory:${line}`,body.operation_id,body.promotion_id,item.product_id,item.expected_stock_revision,item.expected_stock_revision+1,-item.quantity));
    }
  }
  statements.push(db.prepare(`INSERT INTO cash_movements(movement_id,operation_id,sale_id,payment_method,amount_cents,cash_cents,digital_cents,credit_cents,digital_method,reference,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11 WHERE EXISTS(SELECT 1 FROM canonical_write_guards WHERE operation_id=?2)`).bind(`${body.operation_id}:cash`,body.operation_id,body.sale_id,body.payment_method,body.total_cents,body.payment.cash_cents,body.payment.digital_cents,body.payment.credit_cents,body.payment.digital_method,body.payment.reference,body.created_at));
  if (body.payment_method === 'credito') statements.push(db.prepare(`INSERT INTO live_credits(promotion_id,credit_id,operation_id,sale_id,customer_id,original_amount_cents,current_balance_cents,due_date,status,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,?6,?7,'LIVE',?8 WHERE EXISTS(SELECT 1 FROM canonical_write_guards WHERE operation_id=?3)`).bind(body.promotion_id,`${body.operation_id}:credit`,body.operation_id,body.sale_id,body.customer_id,body.total_cents,body.credit_due,body.created_at));
  statements.push(db.prepare(`UPDATE canonical_control SET first_live_operation_id=COALESCE(first_live_operation_id,?1)
    WHERE id=1 AND mode='ACTIVE' AND active_promotion_id=?2 AND authority_epoch=?3 AND revision=?4
    AND EXISTS(SELECT 1 FROM sales WHERE operation_id=?1 AND commit_token=?5)`).bind(body.operation_id,body.promotion_id,body.authority_epoch,body.expected_control_revision,token));
  statements.push(db.prepare('DELETE FROM canonical_write_guards WHERE operation_id=?1').bind(body.operation_id));
  // Every zero-row mutation is fatal inside D1, not an optimistic HTTP success.
  const atomic=[];
  for (const [index,statement] of statements.entries()) {
    atomic.push(statement,db.prepare('INSERT INTO canonical_assertions(assertion_id,ok) VALUES(?1,CASE WHEN changes()=1 THEN 1 ELSE 0 END)').bind(`${token}:changed:${index}`));
  }
  atomic.push(db.prepare('DELETE FROM canonical_assertions WHERE assertion_id LIKE ?1').bind(`${token}:%`));
  try { await db.batch(atomic); }
  catch { const replay=await db.prepare('SELECT sale_id,payload_hash FROM sales WHERE operation_id=?1').bind(body.operation_id).first();
    const stale=await authorityError();
    if(stale)return json({error:stale},409);
    if(replay?.payload_hash===payloadHash)return json({status:'already_processed',operation_id:body.operation_id,sale_id:replay.sale_id,idempotent:true});
    if(replay)return json({error:'operation_id_conflict',operation_id:body.operation_id},409);
    if(await db.prepare('SELECT operation_id FROM canonical_financial_operations WHERE operation_id=?1').bind(body.operation_id).first())return json({error:'operation_id_conflict',operation_id:body.operation_id},409);
    return json({error:'canonical_sale_conflict',operation_id:body.operation_id},409); }
  return json({status:'created',operation_id:body.operation_id,sale_id:body.sale_id,promotion_id:body.promotion_id,authority_epoch:body.authority_epoch,idempotent:false},201);
}
