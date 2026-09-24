import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { a6Fixture, response, WRITER, intercept, deferred, syntheticRows } from './a6-fixture.mjs';

const migration = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0007_canonical_commerce.sql', import.meta.url), 'utf8');

async function activeFixture(t, options) {
  const f = await a6Fixture(t, options);
  await response(await f.freeze(), 201);
  await response(await f.promote(), 201);

  // Test-only setup: 0007 intentionally does not ship an ACTIVE transition.
  f.database.exec('DROP TRIGGER canonical_control_no_legacy');
  f.exec(`UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1,
    writer_device_id=?,minimum_client_contract='a6-gate-c-v1' WHERE id=1`, WRITER['x-device-id']);
  f.database.exec(migration);
  return f;
}

function sale(f, changes = {}) {
  const control = f.control();
  return {
    operation_id: 'first-live-sale', sale_id: 'first-live-sale-id', promotion_id: control.active_promotion_id,
    client_contract: control.minimum_client_contract, authority_epoch: control.authority_epoch,
    expected_control_revision: control.revision, created_at: '2026-09-20T12:00:00.000Z',
    payment_method: 'efectivo', total_cents: 1234,
    payment: { cash_cents: 1234, digital_cents: 0, credit_cents: 0 },
    items: [{ product_id: '00003', quantity: 1, unit_price_cents: 1234, line_total_cents: 1234, expected_stock_revision: 0 }],
    ...changes,
  };
}

test('first_live marker-only se fija con la primera venta ACTIVE atomica y no puede resetearse ni sobrescribirse', async (t) => {
  const f = await activeFixture(t);
  const before = f.control();
  const result = await response(await f.post('/commands/sale.create', sale(f)), 201);
  assert.equal(result.status, 'created');

  const after = f.control();
  assert.equal(after.first_live_operation_id, 'first-live-sale');
  for (const field of ['mode','active_promotion_id','revision','authority_epoch','writer_device_id','minimum_client_contract']) {
    assert.equal(after[field], before[field], field);
  }
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_write_guards").n, 0);
  assert.equal(f.sql("SELECT COUNT(*) n FROM sales WHERE operation_id='first-live-sale'").n, 1);
  assert.equal(f.sql("SELECT COUNT(*) n FROM canonical_sale_context WHERE operation_id='first-live-sale'").n, 1);
  assert.equal(f.sql("SELECT COUNT(*) n FROM sale_items WHERE operation_id='first-live-sale'").n, 1);
  assert.equal(f.sql("SELECT COUNT(*) n FROM cash_movements WHERE operation_id='first-live-sale'").n, 1);
  // Either BEFORE trigger may reject first; SQLite does not promise their order.
  assert.throws(() => f.exec('UPDATE canonical_control SET first_live_operation_id=NULL WHERE id=1'), /immutable_first_live|gate_p_control/);
  assert.throws(() => f.exec("UPDATE canonical_control SET first_live_operation_id='other-operation' WHERE id=1"), /immutable_first_live|gate_p_control/);
  assert.equal(f.control().first_live_operation_id, 'first-live-sale');
  const original = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0006_canonical_promotion.sql', import.meta.url), 'utf8')
    .match(/CREATE TRIGGER IF NOT EXISTS canonical_control_first_live_no_reset[\s\S]*?END;/)[0]
    .replace(' IF NOT EXISTS', '').replace(/;$/, '');
  assert.equal(f.sql("SELECT sql FROM sqlite_master WHERE name='canonical_control_first_live_no_reset'").sql, original);
});

test('first_live exige guard, venta, contexto, items, caja y credito cuando corresponde', async (t) => {
  const required = ['canonical_write_guards', 'sales', 'canonical_sale_context', 'sale_items', 'cash_movements', 'live_credits'];
  for (const missing of required) await t.test(`sin ${missing}`, async (t) => {
    const f = await activeFixture(t);
    for(const trigger of ['canonical_sale_context_authorized_insert','canonical_sale_item_authorized_insert','canonical_inventory_movement_authorized_insert','canonical_inventory_effect_authorized_insert','live_credits_authorized_insert','fence_cash_insert'])
      f.database.exec(`DROP TRIGGER ${trigger}`);
    const control = f.control();
    const operation = `partial-${missing}`;
    const saleId = `${operation}-sale`;
    const token = `${operation}-token`;
    f.database.exec('PRAGMA foreign_keys=OFF');
    f.exec('INSERT INTO canonical_write_guards VALUES(?,?,?,?,?,?)', operation, token, control.active_promotion_id, control.authority_epoch, control.revision, control.minimum_client_contract);
    if (missing !== 'sales') f.exec('INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)', saleId, operation, 'a'.repeat(64), token, control.writer_device_id, 'credito', 100, '2026-09-20T12:00:00.000Z');
    if (missing !== 'canonical_sale_context') f.exec('INSERT INTO canonical_sale_context VALUES(?,?,?,?,?,?,?,?)', saleId, operation, control.active_promotion_id, control.authority_epoch, control.revision, '000C', control.minimum_client_contract, '2026-09-20T12:00:00.000Z');
    if (missing !== 'sale_items') f.exec('INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)', saleId, 1, operation, '00001', 1, 100, 100, '2026-09-20T12:00:00.000Z');
    if (missing !== 'cash_movements') f.exec('INSERT INTO cash_movements(movement_id,operation_id,sale_id,payment_method,amount_cents,cash_cents,digital_cents,credit_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?)', `${operation}-cash`, operation, saleId, 'credito', 100, 0, 0, 100, '2026-09-20T12:00:00.000Z');
    if (missing !== 'live_credits') f.exec("INSERT INTO live_credits VALUES(?,?,?,?,?,?,?,?, 'LIVE',0,?)", control.active_promotion_id, `${operation}-credit`, operation, saleId, '000C', 100, 100, '2026-10-20', '2026-09-20T12:00:00.000Z');
    if (missing === 'canonical_write_guards') f.exec('DELETE FROM canonical_write_guards WHERE operation_id=?', operation);
    assert.throws(() => f.exec('UPDATE canonical_control SET first_live_operation_id=? WHERE id=1', operation), /gate_p_control/);
    assert.equal(f.control().first_live_operation_id, null);
  });
});

test('first_live marker-only no autoriza transicion ACTIVE ni cambios de control', async (t) => {
  const f = await activeFixture(t);
  for(const trigger of ['canonical_sale_context_authorized_insert','canonical_sale_item_authorized_insert'])f.database.exec(`DROP TRIGGER ${trigger}`);
  const operation = 'complete-operation';
  const saleId = 'complete-sale';
  const token = 'complete-token';
  const control = f.control();
  f.exec('INSERT INTO canonical_write_guards VALUES(?,?,?,?,?,?)', operation, token, control.active_promotion_id, control.authority_epoch, control.revision, control.minimum_client_contract);
  f.exec('INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)', saleId, operation, 'b'.repeat(64), token, control.writer_device_id, 'efectivo', 100, '2026-09-20T12:00:00.000Z');
  f.exec('INSERT INTO canonical_sale_context VALUES(?,?,?,?,?,?,?,?)', saleId, operation, control.active_promotion_id, control.authority_epoch, control.revision, null, control.minimum_client_contract, '2026-09-20T12:00:00.000Z');
  f.exec('INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)', saleId, 1, operation, '00001', 1, 100, 100, '2026-09-20T12:00:00.000Z');
  f.exec('INSERT INTO cash_movements(movement_id,operation_id,sale_id,payment_method,amount_cents,cash_cents,digital_cents,credit_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?)', `${operation}-cash`, operation, saleId, 'efectivo', 100, 100, 0, 0, '2026-09-20T12:00:00.000Z');

  for (const mutation of [
    "active_promotion_id=NULL", 'revision=revision+1', 'authority_epoch=authority_epoch+1',
    "writer_device_id=NULL", "minimum_client_contract='other-contract'",
  ]) assert.throws(() => f.database.exec(`UPDATE canonical_control SET first_live_operation_id='${operation}',${mutation} WHERE id=1`), /gate_p_control/, mutation);

  f.database.exec('DROP TRIGGER canonical_control_no_legacy');
  f.exec("UPDATE canonical_control SET mode='CANONICAL_READ_ONLY',revision=revision+1,authority_epoch=authority_epoch+1 WHERE id=1");
  f.database.exec(migration);
  assert.throws(() => f.exec("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1 WHERE id=1"), /gate_p_control/);
});

const durableTables = ['canonical_control','canonical_promotions','products','customers','credits','credit_payments',
  'sales','sale_items','cash_movements','inventory_movements','canonical_sale_context','canonical_inventory_effects',
  'live_credits','canonical_write_guards','canonical_assertions','sync_operations'];
function durable(f) {
  return Object.fromEntries(durableTables.map(table => [table, f.all(`SELECT * FROM ${table} ORDER BY rowid`)]));
}
function creditSale(f, changes = {}) {
  return sale(f, { payment_method:'credito', customer_id:'000C', credit_due:'2026-10-20',
    payment:{cash_cents:0,digital_cents:0,credit_cents:1234}, ...changes });
}
function assertSale(f, body, tracked = true) {
  for (const table of ['sales','sale_items','cash_movements','canonical_sale_context'])
    assert.equal(f.sql(`SELECT COUNT(*) n FROM ${table} WHERE operation_id=?`, body.operation_id).n, table==='sale_items' ? body.items.length : 1, table);
  const cash=f.sql('SELECT * FROM cash_movements WHERE operation_id=?',body.operation_id);
  for(const key of ['cash_cents','digital_cents','credit_cents'])assert.equal(cash[key],body.payment[key],key);
  assert.equal(cash.amount_cents,body.total_cents);
  assert.equal(f.sql('SELECT COUNT(*) n FROM live_credits WHERE operation_id=?',body.operation_id).n,body.payment_method==='credito'?1:0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_inventory_effects WHERE operation_id=?',body.operation_id).n,tracked?1:0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM inventory_movements WHERE operation_id=?',body.operation_id).n,tracked?1:0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_write_guards').n,0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n,0);
  assert.deepEqual(f.all('PRAGMA foreign_key_check'),[]);
}

test('cada metodo persiste venta/caja/stock/credito una vez; retry no cambia ningun dato durable', async (t) => {
  for(const method of ['efectivo','yape','plin','transferencia','credito','mixto'])await t.test(method,async(t)=>{
    const f=await activeFixture(t);
    const payment={cash_cents:method==='efectivo'?1234:method==='mixto'?234:0,
      digital_cents:['yape','plin','transferencia'].includes(method)?1234:method==='mixto'?1000:0,
      credit_cents:method==='credito'?1234:0};
    if(method==='mixto')payment.digital_method='yape';
    if(payment.digital_cents)payment.reference=`reference-${method}`;
    const body=sale(f,{payment_method:method,payment,...(method==='credito'?{customer_id:'000C',credit_due:'2026-10-20'}:{})});
    const opening=f.sql("SELECT * FROM products WHERE product_id='00003'");
    await response(await f.post('/commands/sale.create',body),201);
    assertSale(f,body);
    const product=f.sql("SELECT * FROM products WHERE product_id='00003'");
    assert.equal(product.current_stock_quantity,0.125);
    assert.equal(product.stock_revision,1);
    assert.equal(product.opening_stock_quantity,opening.opening_stock_quantity);
    if(method==='credito'){
      const credit=f.sql('SELECT * FROM live_credits');
      assert.equal(credit.sale_id,body.sale_id);assert.equal(credit.customer_id,'000C');
      assert.equal(credit.current_balance_cents,1234);assert.equal(credit.original_amount_cents,1234);
      assert.equal(credit.status,'LIVE');assert.equal(credit.due_date,'2026-10-20');
    }
    const saved=durable(f);
    assert.equal((await response(await f.post('/commands/sale.create',body),200)).status,'already_processed');
    assert.deepEqual(durable(f),saved);
    assert.equal((await response(await f.post('/commands/sale.create',{...body,created_at:'2026-09-20T13:00:00Z'}),409)).error,'operation_id_conflict');
    assert.deepEqual(durable(f),saved);
  });
});

test('no controlInventario no mueve stock; ventas posteriores conservan primer marcador',async(t)=>{
  const f=await activeFixture(t);
  const before=f.sql("SELECT * FROM products WHERE product_id='00000'");
  for(const id of ['untracked-1','untracked-2']){
    const body=sale(f,{operation_id:id,sale_id:id,items:[{...sale(f).items[0],product_id:'00000'}]});
    await response(await f.post('/commands/sale.create',body),201);
    assertSale(f,body,false);
  }
  assert.deepEqual(f.sql("SELECT * FROM products WHERE product_id='00000'"),before);
  assert.equal(f.control().first_live_operation_id,'untracked-1');
});

test('stock agotado, stale revision, cliente/producto inexistente y referencia repetida no dejan efectos',async(t)=>{
  const f=await activeFixture(t);
  const body=sale(f,{payment:{cash_cents:1234,digital_cents:0,credit_cents:0,reference:'unique-ref'}});
  await response(await f.post('/commands/sale.create',body),201);
  const saved=durable(f);
  const next=sale(f,{operation_id:'next',sale_id:'next',items:[{...body.items[0],expected_stock_revision:1}]});
  for(const input of [next,{...next,items:body.items},
    {...next,items:[{...next.items[0],product_id:'00001',expected_stock_revision:0}]},
    {...next,items:[{...next.items[0],product_id:'missing',expected_stock_revision:0}]},
    {...next,items:[{...body.items[0],product_id:'00000'}],customer_id:'missing'},
    {...next,items:[{...body.items[0],product_id:'00000'}],payment:body.payment}]){
    await response(await f.post('/commands/sale.create',input),409);
    assert.deepEqual(durable(f),saved);
  }
});

test('historial financiero rechaza UPDATE y DELETE directos en cualquier modo',async(t)=>{
  const f=await activeFixture(t),body=sale(f);
  await response(await f.post('/commands/sale.create',body),201);
  const saved=durable(f);
  const mutations=[
    "UPDATE sales SET total_cents=1 WHERE sale_id='first-live-sale-id'",
    "DELETE FROM sales WHERE sale_id='first-live-sale-id'",
    "UPDATE sale_items SET line_total_cents=1 WHERE sale_id='first-live-sale-id'",
    "DELETE FROM sale_items WHERE sale_id='first-live-sale-id'",
    "UPDATE cash_movements SET amount_cents=1 WHERE sale_id='first-live-sale-id'",
    "DELETE FROM cash_movements WHERE sale_id='first-live-sale-id'",
    "UPDATE inventory_movements SET quantity=-0.5 WHERE sale_id='first-live-sale-id'",
    "DELETE FROM inventory_movements WHERE sale_id='first-live-sale-id'",
  ];
  for(const sql of mutations){assert.throws(()=>f.database.exec(sql),/immutable_financial_history/);assert.deepEqual(durable(f),saved);}
  f.database.exec('DROP TRIGGER canonical_control_no_legacy');
  f.exec("UPDATE canonical_control SET mode='LEGACY',active_promotion_id=NULL,revision=revision+1,authority_epoch=authority_epoch+1 WHERE id=1");
  f.database.exec(migration);
  const legacySaved=durable(f);
  for(const sql of mutations){assert.throws(()=>f.database.exec(sql),/immutable_financial_history/);assert.deepEqual(durable(f),legacySaved);}
  f.database.exec('PRAGMA recursive_triggers=OFF');
  for(const table of ['sales','sale_items','cash_movements','inventory_movements','canonical_sale_context','canonical_inventory_effects']){
    assert.throws(()=>f.database.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),/financial_replace_forbidden/);
    assert.deepEqual(durable(f),legacySaved);
  }
});

test('guard de otra linea no autoriza disminuir stock sin su efecto exacto',async(t)=>{
  const f=await activeFixture(t),control=f.control(),operation='stock-forgery',token='stock-forgery-token';
  f.exec('INSERT INTO canonical_write_guards VALUES(?,?,?,?,?,?)',operation,token,control.active_promotion_id,control.authority_epoch,control.revision,control.minimum_client_contract);
  f.exec('INSERT INTO sales(sale_id,operation_id,payload_hash,commit_token,device_id,payment_method,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)','stock-forgery-sale',operation,'f'.repeat(64),token,control.writer_device_id,'efectivo',100,'2026-09-20T12:00:00.000Z');
  f.exec('INSERT INTO canonical_sale_context VALUES(?,?,?,?,?,?,?,?)','stock-forgery-sale',operation,control.active_promotion_id,control.authority_epoch,control.revision,null,control.minimum_client_contract,'2026-09-20T12:00:00.000Z');
  const product=f.sql("SELECT * FROM products WHERE product_id='00003'");
  f.exec('INSERT INTO sale_items(sale_id,line_number,operation_id,product_id,quantity,unit_price_cents,line_total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)','stock-forgery-sale',1,operation,'00003',1,100,100,'2026-09-20T12:00:00.000Z');
  assert.throws(()=>f.exec("UPDATE products SET current_stock_quantity=current_stock_quantity-0.5,stock_revision=stock_revision+1 WHERE product_id='00003'"),/immutable_canonical_candidate/);
  assert.deepEqual(f.sql("SELECT * FROM products WHERE product_id='00003'"),product);
  assert.throws(()=>f.exec("UPDATE products SET current_stock_quantity=current_stock_quantity-1,stock_revision=stock_revision+1 WHERE product_id='00005'"),/immutable_canonical_candidate/);
});

test('objetos faltantes/malformados, fechas imposibles e importes invalidos son 400, nunca 500',async(t)=>{
  const f=await activeFixture(t),saved=durable(f),base=sale(f);
  const cases=[
    ...[undefined,null,[],true,123,'cash',{}].map(payment=>({payment})),
    ...[null,[],true,123,'item',{}].map(item=>({items:[item]})),
    {items:[]},{items:[base.items[0],base.items[0]]},
    ...['invalid','2026-02-30T12:00:00Z','2025-02-29T12:00:00Z','2026-09-20T24:00:00Z','2026-09-20'].map(created_at=>({created_at})),
    ...[-1,0,1.5,Number.MAX_SAFE_INTEGER+1,'1234'].map(total_cents=>({total_cents})),
    ...[-1,0,null,'1'].map(quantity=>({items:[{...base.items[0],quantity}]})),
    {items:[{...base.items[0],line_total_cents:1233}]},
    {payment:{...base.payment,cash_cents:1233}},{payment:{...base.payment,digital_cents:1}},
    {payment:{...base.payment,reference:{}}},
    ...['2026-02-30','2025-02-29',{},null,'bad'].map(credit_due=>({...creditSale(f),credit_due})),
  ];
  for(const changes of cases){await response(await f.post('/commands/sale.create',{...base,...changes}),400);assert.deepEqual(durable(f),saved);}
  for(const body of [null,[],42,'sale'])await response(await f.post('/commands/sale.create',body),400);
});

test('misma identidad concurrente converge; payload competidor y dos ventas por ultimo stock no duplican',async(t)=>{
  for(const mode of ['same','conflict','stock'])await t.test(mode,async(t)=>{
    const f=await activeFixture(t),body=creditSale(f),barrier=deferred();let arrivals=0;
    const restore=intercept(f,async e=>{if(e.method==='batch'&&e.when==='before'){if(++arrivals===2)barrier.resolve();await barrier.promise;}});
    const second=mode==='same'?body:mode==='conflict'?{...body,created_at:'2026-09-20T13:00:00Z'}:{...body,operation_id:'competitor',sale_id:'competitor'};
    const results=await Promise.all([f.post('/commands/sale.create',body),f.post('/commands/sale.create',second)]);
    restore();assert.equal(arrivals,2);
    assert.deepEqual(results.map(r=>r.status).sort(),mode==='same'?[200,201]:[201,409]);
    if(mode==='conflict')assert.equal((await results.find(r=>r.status===409).json()).error,'operation_id_conflict');
    assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n,1);assert.equal(f.sql('SELECT COUNT(*) n FROM live_credits').n,1);
    assert.equal(f.sql("SELECT current_stock_quantity FROM products WHERE product_id='00003'").current_stock_quantity,0.125);
    assert.equal(f.sql('SELECT COUNT(*) n FROM cash_movements').n,1);
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_write_guards').n,0);
  });
});

test('cada statement del batch real revierte venta/items/caja/stock/credito/marcador; retry recupera',async(t)=>{
  const f=await activeFixture(t),body=creditSale(f),saved=durable(f);let length=0;
  let restore=intercept(f,e=>{if(e.method==='batch'&&e.when==='before'){length=e.statements.length;throw new Error('probe before batch');}});
  await response(await f.post('/commands/sale.create',body),409);restore();assert.ok(length>20);
  for(let index=0;index<length;index++)await t.test(`statement-${index}`,async()=>{
    f.failBatchAt(index);await response(await f.post('/commands/sale.create',body),409);
    assert.deepEqual(durable(f),saved);
  });
  f.failBatchAt(null);await response(await f.post('/commands/sale.create',body),201);assertSale(f,body);
});

test('lost ACK despues de COMMIT recupera venta durable y retry no reaplica',async(t)=>{
  const f=await activeFixture(t),body=creditSale(f);let committed=false;
  const restore=intercept(f,e=>{if(e.method==='batch'&&e.when==='after'){committed=true;throw new Error('lost ACK');}});
  assert.equal((await response(await f.post('/commands/sale.create',body),200)).status,'already_processed');
  restore();assert.equal(committed,true);assertSale(f,body);
  const saved=durable(f);await response(await f.post('/commands/sale.create',body),200);assert.deepEqual(durable(f),saved);
});

test('auth/control se revalidan antes de replay y dentro del batch',async(t)=>{
  for(const timing of ['before-replay','before-batch','after-replay-lookup','after-lost-ack']){
    for(const mutation of ['rotate','revoke','role','freeze'])await t.test(`${timing}/${mutation}`,async(t)=>{
      const f=await activeFixture(t),body=sale(f);
      if(timing==='before-replay'||timing==='after-replay-lookup')await response(await f.post('/commands/sale.create',body),201);
      const mutate=()=>{
        if(mutation==='rotate')f.rotate();
        if(mutation==='revoke')f.exec("UPDATE devices SET status='revoked' WHERE device_id=?",WRITER['x-device-id']);
        if(mutation==='role')f.exec("UPDATE devices SET role='read_only' WHERE device_id=?",WRITER['x-device-id']);
        if(mutation==='freeze')f.bumpControl(",mode='FROZEN'");
      };
      if(timing==='before-replay')mutate();
      let fired=false;
      const restore=intercept(f,e=>{
        const match=timing==='before-batch'&&e.method==='batch'&&e.when==='before'||
          timing==='after-lost-ack'&&e.method==='batch'&&e.when==='after'||
          timing==='after-replay-lookup'&&e.method==='first'&&e.when==='after'&&e.sql.startsWith('SELECT sale_id,payload_hash');
        if(!fired&&match){fired=true;mutate();if(timing==='after-lost-ack')throw new Error('lost ACK with stale auth');}
      });
      const result=await f.post('/commands/sale.create',body);restore();
      assert.ok([401,403,409].includes(result.status),`${result.status}: ${await result.text()}`);
      if(timing!=='before-replay')assert.equal(fired,true);
      assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n,timing==='before-batch'?0:1);
      assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_write_guards').n,0);
      assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n,0);
    });
  }
});

test('epoch/revision/promotion/contract obsoletos y lector fallan antes de replay',async(t)=>{
  const f=await activeFixture(t),body=sale(f);await response(await f.post('/commands/sale.create',body),201);
  const saved=durable(f);
  for(const changes of [{authority_epoch:0},{expected_control_revision:0},{promotion_id:'other'},{client_contract:'a6-gate-p-v1'}]){
    const r=await f.post('/commands/sale.create',{...body,...changes});assert.ok([400,409].includes(r.status));
    assert.deepEqual(durable(f),saved);
  }
  await response(await f.post('/commands/sale.create',body,{'x-device-id':'a6-reader','x-sync-token':'a6-reader-secret'}),403);
  assert.deepEqual(durable(f),saved);
});

test('identidad LIVE generada no puede colisionar con credito importado ni vincular su historial',async(t)=>{
  const rows=syntheticRows(),id='first-live-sale:credit';
  const imported=rows.find(r=>r.entity_type==='credits');imported.source_key=id;imported.payload.id=id;
  for(const row of rows.filter(r=>r.entity_type==='credit_payments'))row.payload.credito_id=id;
  const f=await activeFixture(t,{rows}),saved=durable(f);
  await response(await f.post('/commands/sale.create',creditSale(f)),409);
  assert.deepEqual(durable(f),saved);
});

test('ACTIVE publica campos canonicos e IMPORT+LIVE paginados sin colisiones; status concilia efectos',async(t)=>{
  const f=await activeFixture(t);
  const readAll=async(route)=>{
    const items=[],seen=new Set();let cursor=null;
    do{
      const page=await response(await f.read(route,'?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),200);
      assert.equal(page.mode,'ACTIVE');assert.equal(page.read_only,false);assert.equal(page.minimum_client_contract,'a6-gate-c-v1');
      items.push(...page.items);cursor=page.next_cursor;
      if(cursor){assert.ok(!seen.has(cursor));seen.add(cursor);}
    }while(cursor);
    return items;
  };
  const products=await readAll('products'),customers=await readAll('customers'),payments=await readAll('credit-payments');
  for(const [table,items,key] of [['products',products,'product_id'],['customers',customers,'customer_id'],['credit_payments',payments,'payment_id']]){
    assert.equal(items.length,f.sql(`SELECT COUNT(*) n FROM ${table}`).n);
    for(const item of items){const row=f.sql(`SELECT * FROM ${table} WHERE ${key}=?`,item[key]);for(const [field,value] of Object.entries(item))assert.equal(value,row[field],`${table}.${field}`);}
  }
  assert.equal(products[3].purchase_factor,2.5);assert.equal(products[3].price_cents,1234);
  assert.equal(customers[0].phone,'000123');assert.deepEqual(payments.map(p=>p.date_precision).sort(),['DATE','TIMESTAMP','UNKNOWN']);
  // Both sides of the import's lexical ID: plain ID-only cursors would skip one.
  for(const operation_id of ['A-live','Z-live'])await response(await f.post('/commands/sale.create',creditSale(f,{
    operation_id,sale_id:operation_id,items:[{...sale(f).items[0],product_id:'00000'}]})),201);
  const credits=await readAll('credits');
  assert.deepEqual(credits.map(c=>[c.provenance,c.credit_id]),[['IMPORT','CR:001'],['LIVE','A-live:credit'],['LIVE','Z-live:credit']]);
  assert.equal(credits[0].current_balance_cents,700);
  for(const credit of credits.slice(1)){
    assert.equal(credit.status,'LIVE');assert.equal(credit.due_date,'2026-10-20');assert.equal(credit.due_value,credit.due_date);
    assert.equal(credit.current_balance_cents,1234);assert.equal(credit.customer_id,'000C');assert.equal(credit.operation_id,credit.sale_id);
  }
  assert.deepEqual(await readAll('credit-payments'),payments);
  for(const route of ['sales','sale-items','cash-movements'])assert.equal((await readAll(route)).length,2);
  for(const liveSale of await readAll('sales')){
    assert.equal(liveSale.customer_id,'000C');assert.equal(liveSale.promotion_id,f.control().active_promotion_id);
    assert.equal(liveSale.authority_epoch,f.control().authority_epoch);assert.equal(liveSale.client_contract,'a6-gate-c-v1');
  }
  assert.equal((await readAll('inventory-movements')).length,0);
  const status=await response(await f.read('status'),200);
  assert.deepEqual(status.counts,{products:28,customers:1,credits:3,credit_payments:3,imported_credits:1,live_credits:2,sales:2,sale_items:2,inventory_movements:0,cash_movements:2});
  assert.ok(!JSON.stringify([...products,...customers,...payments,...credits]).includes('synthetic-source-secret'));
});

test('venta multilinea agota stock exactamente; fallo tardio revierte tambien las lineas anteriores',async(t)=>{
  const f=await activeFixture(t);
  const body=creditSale(f,{total_cents:1025,payment:{cash_cents:0,digital_cents:0,credit_cents:1025},items:[
    {product_id:'00003',quantity:1.125,unit_price_cents:800,line_total_cents:900,expected_stock_revision:0},
    {product_id:'00005',quantity:0.125,unit_price_cents:800,line_total_cents:100,expected_stock_revision:0},
    {product_id:'00000',quantity:1,unit_price_cents:25,line_total_cents:25,expected_stock_revision:0},
  ]});
  const saved=durable(f);let injected=false;
  const restore=intercept(f,e=>{
    if(e.method==='batch'&&e.when==='before'){
      const index=e.entries.findIndex(row=>row.sql.startsWith('INSERT INTO live_credits'));
      assert.ok(index>20);f.failBatchAt(index);injected=true;
    }
  });
  await response(await f.post('/commands/sale.create',body),409);restore();assert.equal(injected,true);
  assert.deepEqual(durable(f),saved);f.failBatchAt(null);
  await response(await f.post('/commands/sale.create',body),201);
  assert.equal(f.sql("SELECT current_stock_quantity FROM products WHERE product_id='00003'").current_stock_quantity,0);
  assert.equal(f.sql("SELECT current_stock_quantity FROM products WHERE product_id='00005'").current_stock_quantity,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM sale_items').n,3);
  assert.equal(f.sql('SELECT COUNT(*) n FROM inventory_movements').n,2);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_inventory_effects').n,2);
  assert.equal(f.sql('SELECT current_balance_cents FROM live_credits').current_balance_cents,1025);
  const committed=durable(f);await response(await f.post('/commands/sale.create',body),200);assert.deepEqual(durable(f),committed);
});

test('lectura ACTIVE rechaza cambio de autoridad y cursor previo; lectura no autoriza activacion',async(t)=>{
  const f=await activeFixture(t);
  const first=await response(await f.read('products','?limit=1'),200);let fired=false;
  const restore=intercept(f,e=>{
    if(!fired&&e.method==='all'&&e.when==='after'&&e.sql.includes('FROM products')){fired=true;f.bumpControl(",mode='FROZEN'");}
  });
  assert.equal((await response(await f.read('products'),409)).error,'authority_changed');restore();assert.equal(fired,true);
  await response(await f.read('status'),409);
  assert.throws(()=>f.bumpControl(",mode='ACTIVE'"),/gate_p_control/);
  // Legal Gate P transition for fixture: the previous ACTIVE cursor is now stale.
  f.bumpControl(",mode='CANONICAL_READ_ONLY'");
  assert.equal((await response(await f.read('products','?cursor='+encodeURIComponent(first.next_cursor)),400)).error,'stale_cursor');
});
