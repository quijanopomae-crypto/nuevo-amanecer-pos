import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { a6Fixture, response, WRITER, intercept, deferred } from './a6-fixture.mjs';

const commerceMigration = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0007_canonical_commerce.sql', import.meta.url),'utf8');
const financialMigration = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0008_canonical_financial.sql', import.meta.url),'utf8');
const tables = ['canonical_control','canonical_promotions','products','customers','credits','credit_payments','sales','sale_items',
  'cash_movements','inventory_movements','live_credits','canonical_sale_context','canonical_inventory_effects',
  'canonical_financial_operations','canonical_financial_events','canonical_cash_sessions','canonical_cash_closures','canonical_assertions','canonical_write_guards'];
const durable = f => Object.fromEntries(tables.map(table=>[table,f.all(`SELECT * FROM ${table} ORDER BY rowid`)]));
const credit = (f,id='CR:001') => f.sql('SELECT * FROM canonical_credit_balances WHERE credit_id=?',id);
const session = (f,id='till') => f.sql('SELECT * FROM canonical_cash_state WHERE session_id=?',id);
function common(f,operation_id) {
  const c=f.control();
  return {operation_id,device_id:WRITER['x-device-id'],promotion_id:c.active_promotion_id,client_contract:'a6-gate-c-v1',
    authority_epoch:c.authority_epoch,expected_control_revision:c.revision,created_at:'2026-09-21T12:00:00.000Z'};
}
function sale(f,operation_id='seed',changes={}) {
  return {...common(f,operation_id),sale_id:operation_id,payment_method:'credito',customer_id:'000C',credit_due:'2026-10-20',
    total_cents:1000,payment:{cash_cents:0,digital_cents:0,credit_cents:1000},
    items:[{product_id:'00000',quantity:1,unit_price_cents:1000,line_total_cents:1000,expected_stock_revision:0}],...changes};
}
function payment(f,operation_id='pay',changes={}) {
  return {...common(f,operation_id),credit_id:'CR:001',expected_credit_revision:0,amount_cents:100,payment_method:'yape',...changes};
}
const send = (f,command,body) => f.post(`/commands/${command}`,body);
const open = (f,id='till',opening=1000,operation_id=`open-${id}`) => send(f,'cash.open',{...common(f,operation_id),session_id:id,opening_cents:opening});
const close = (f,id='till',changes={}) => send(f,'cash.close',{...common(f,`close-${id}`),session_id:id,expected_session_revision:session(f,id).revision,counted_cents:session(f,id).expected_cents,...changes});
async function active(t,{seed=true}={}) {
  const f=await a6Fixture(t);
  await response(await f.freeze(),201);await response(await f.promote(),201);
  // Test-only ACTIVE. Production migrations and Worker contain no activation route.
  f.database.exec('DROP TRIGGER canonical_control_no_legacy');
  f.exec("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1,minimum_client_contract='a6-gate-c-v1' WHERE id=1");
  f.database.exec(commerceMigration);f.database.exec(financialMigration);
  if(seed)await response(await send(f,'sale.create',sale(f)),201);
  return f;
}
async function allRead(f,route) {
  const out=[];let cursor=null;
  do {const page=await response(await f.read(route,'?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):'')),200);
    out.push(...page.items);cursor=page.next_cursor;
  }while(cursor);
  return out;
}

test('IMPORT y LIVE: cents exactos, cero, sobrepago, CAS y base inmutable; lecturas combinadas',async t=>{
  const f=await active(t),base={credits:f.all('SELECT * FROM credits'),payments:f.all('SELECT * FROM credit_payments'),live:f.all('SELECT * FROM live_credits')};
  for(const [id,amount] of [['CR:001',700],['seed:credit',1000]]){
    const body=payment(f,`pay-${id}`,{credit_id:id,amount_cents:amount});
    const r=await response(await send(f,'payment.create',body),201);
    assert.equal(r.current_balance_cents,0);assert.equal(r.credit_revision,1);assert.equal(r.cash_delta_cents,0);
    const saved=durable(f);
    assert.equal((await response(await send(f,'payment.create',body),200)).status,'already_processed');
    await response(await send(f,'payment.create',{...body,amount_cents:1}),409);
    await response(await send(f,'payment.create',{...body,operation_id:`over-${id}`,expected_credit_revision:1,amount_cents:1}),409);
    assert.deepEqual(durable(f),saved);
  }
  assert.deepEqual(f.all('SELECT * FROM credits'),base.credits);assert.deepEqual(f.all('SELECT * FROM credit_payments'),base.payments);assert.deepEqual(f.all('SELECT * FROM live_credits'),base.live);
  const credits=await allRead(f,'credits');assert.deepEqual(credits.map(c=>[c.current_balance_cents,c.revision]),[[0,1],[0,1]]);
  const payments=await allRead(f,'credit-payments');assert.equal(payments.length,5);assert.equal(payments.filter(p=>p.provenance==='LIVE').length,2);
  const events=await allRead(f,'financial-events');assert.equal(events.length,2);
  assert.ok(!JSON.stringify([...payments,...events]).includes('credential_hash'));
  assert.equal((await response(await f.read('status'),200)).counts.credit_payments,5);
});

test('caja unica, ventas por watermark, efectivo/digital, cierre contado/diferencia y fence post cierre',async t=>{
  const f=await active(t);
  // Cash before the first session is external, not re-counted as an entry.
  const cashSale=(id,changes={})=>sale(f,id,{payment_method:'efectivo',payment:{cash_cents:1000,digital_cents:0,credit_cents:0},...changes});
  await response(await send(f,'sale.create',cashSale('external')),201);
  await response(await open(f),201);
  assert.equal(session(f).expected_cents,1000);
  await response(await open(f,'second'),409);
  await response(await send(f,'payment.create',payment(f,'missing-session',{payment_method:'efectivo'})),400);
  await response(await send(f,'payment.create',payment(f,'wrong-session',{payment_method:'efectivo',session_id:'missing'})),409);
  await response(await send(f,'sale.create',cashSale('inside',{session_id:'till'})),201);
  await response(await send(f,'sale.create',sale(f,'mixed',{payment_method:'mixto',payment:{cash_cents:400,digital_cents:600,credit_cents:0,digital_method:'plin'}})),201);
  await response(await send(f,'payment.create',payment(f,'cash-pay',{payment_method:'efectivo',session_id:'till'})),201);
  for(const [i,method] of ['yape','plin','transferencia'].entries())await response(await send(f,'payment.create',payment(f,method,{expected_credit_revision:i+1,payment_method:method})),201);
  assert.equal(session(f).expected_cents,2500);assert.equal(session(f).revision,3);
  await response(await send(f,'adjustment.create',{...common(f,'expense'),session_id:'till',expected_session_revision:3,amount_cents:-200,reason:'Gasto documentado'}),201);
  const result=await response(await close(f,'till',{counted_cents:2299}),201);
  assert.equal(result.expected_cents,2300);assert.equal(result.difference_cents,-1);assert.equal(result.session_revision,5);
  const closed=session(f);assert.equal(closed.status,'CLOSED');assert.equal(closed.expected_cents,2300);
  const saved=durable(f);
  await response(await send(f,'sale.create',cashSale('after-close')),409);
  await response(await send(f,'payment.create',payment(f,'after-close-pay',{expected_credit_revision:4,payment_method:'efectivo',session_id:'till'})),409);
  await response(await close(f,'till',{operation_id:'another-close'}),409);
  await response(await open(f,'till',1000,'reuse-session'),409);
  assert.deepEqual(durable(f),saved);
  await response(await open(f,'next',10),201);
  await response(await send(f,'sale.create',cashSale('next-sale',{session_id:'next'})),201);
  await response(await send(f,'sale.create',cashSale('stale-till',{session_id:'till'})),409);
  assert.deepEqual(session(f),closed);assert.equal(session(f,'next').expected_cents,1010);
  assert.equal((await allRead(f,'cash-sessions')).length,2);
});

test('compensaciones payment/adjustment una sola vez, incluso en nueva sesion; no compensan venta ni IMPORT',async t=>{
  const f=await active(t);await response(await open(f),201);
  await response(await send(f,'payment.create',payment(f,'cash-pay',{payment_method:'efectivo',session_id:'till',amount_cents:700})),201);
  await response(await close(f),201);const immutableClose=session(f);
  await response(await open(f,'next',1000),201);
  const undo={...common(f,'undo-payment'),compensates_operation_id:'cash-pay',session_id:'next',expected_session_revision:0,expected_credit_revision:1,reason:'Abono equivocado'};
  const result=await response(await send(f,'compensation.create',undo),201);
  assert.equal(result.current_balance_cents,700);assert.equal(result.expected_cents,300);assert.equal(result.credit_revision,2);
  await response(await send(f,'compensation.create',undo),200);
  await response(await send(f,'compensation.create',{...undo,operation_id:'double-undo',expected_session_revision:1,expected_credit_revision:2}),409);
  const adjustment={...common(f,'adjust'),session_id:'next',expected_session_revision:1,amount_cents:-100,reason:'Salida'};
  await response(await send(f,'adjustment.create',adjustment),201);
  await response(await send(f,'compensation.create',{...common(f,'undo-adjust'),compensates_operation_id:'adjust',session_id:'next',expected_session_revision:2,reason:'Correccion'}),201);
  assert.equal(session(f,'next').expected_cents,300);assert.deepEqual(session(f),immutableClose);
  for(const target of ['seed','PAY:0','undo-payment'])await response(await send(f,'compensation.create',{...common(f,`forbidden-${target}`),compensates_operation_id:target,reason:'No soportado'}),409);
  const entries=await allRead(f,'credit-payments');assert.equal(entries.filter(e=>e.provenance==='LIVE').reduce((n,e)=>n+e.amount_cents,0),0);
});

test('compensacion digital no afecta caja; negativa, razon y dinero inseguro se rechazan',async t=>{
  const f=await active(t);await response(await open(f,'till',0),201);
  await response(await send(f,'payment.create',payment(f)),201);
  await response(await send(f,'compensation.create',{...common(f,'undo'),compensates_operation_id:'pay',expected_credit_revision:1,reason:'Error'}),201);
  assert.equal(credit(f).current_balance_cents,700);assert.equal(session(f).revision,0);
  const saved=durable(f);
  for(const amount_cents of [0,0.1,-1,Number.MAX_SAFE_INTEGER+1,'1'])await response(await send(f,'payment.create',payment(f,'invalid',{amount_cents})),400);
  for(const reason of ['', '  ',null,42])await response(await send(f,'adjustment.create',{...common(f,'bad-reason'),session_id:'till',expected_session_revision:0,amount_cents:10,reason}),400);
  await response(await send(f,'adjustment.create',{...common(f,'negative'),session_id:'till',expected_session_revision:0,amount_cents:-1,reason:'Sin fondos'}),409);
  await response(await send(f,'payment.create',payment(f,'bad-date',{created_at:'2026-02-30T12:00:00Z'})),400);
  await response(await send(f,'payment.create',payment(f,'unknown',{arbitrary_stock:10})),400);
  assert.deepEqual(durable(f),saved);
});

test('concurrencia: same opId, payload conflict y revision CAS una sola ganadora',async t=>{
  for(const mode of ['same','payload','credit','session','open','compensation'])await t.test(mode,async t=>{
    const f=await active(t);let command='payment.create',a=payment(f),b;
    if(mode==='same')b=a;
    if(mode==='payload')b={...a,amount_cents:200};
    if(mode==='credit')b={...a,operation_id:'competitor'};
    if(mode==='open'){command='cash.open';a={...common(f,'a'),session_id:'a',opening_cents:0};b={...a,operation_id:'b',session_id:'b'};}
    if(mode==='session'){await response(await open(f),201);command='adjustment.create';a={...common(f,'a'),session_id:'till',expected_session_revision:0,amount_cents:100,reason:'Entrada'};b={...a,operation_id:'b'};}
    if(mode==='compensation'){await response(await send(f,'payment.create',a),201);command='compensation.create';a={...common(f,'undo-a'),compensates_operation_id:'pay',expected_credit_revision:1,reason:'Error'};b={...a,operation_id:'undo-b'};}
    const barrier=deferred();let arrivals=0;
    const restore=intercept(f,async e=>{if(e.method==='batch'&&e.when==='before'){if(++arrivals===2)barrier.resolve();await barrier.promise;}});
    const results=await Promise.all([send(f,command,a),send(f,command,b)]);restore();assert.equal(arrivals,2);
    assert.deepEqual(results.map(r=>r.status).sort(),mode==='same'?[200,201]:[201,409]);
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n,0);
    assert.deepEqual(f.all('PRAGMA foreign_key_check'),[]);
  });
});

test('opId unico sale/financial en ambos sentidos y en carrera',async t=>{
  const f=await active(t);
  await response(await send(f,'payment.create',payment(f,'seed')),409);
  await response(await send(f,'payment.create',payment(f,'pay')),201);
  await response(await send(f,'sale.create',sale(f,'pay')),409);
  await response(await open(f,'till',0,'pay'),409);
  const barrier=deferred();let arrivals=0;
  const restore=intercept(f,async e=>{if(e.method==='batch'&&e.when==='before'){if(++arrivals===2)barrier.resolve();await barrier.promise;}});
  const results=await Promise.all([send(f,'sale.create',sale(f,'race')),send(f,'payment.create',payment(f,'race',{expected_credit_revision:1}))]);
  restore();assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await results.find(r=>r.status===409).json()).error,'operation_id_conflict');
  assert.equal(f.sql("SELECT (SELECT COUNT(*) FROM sales WHERE operation_id='race')+(SELECT COUNT(*) FROM canonical_financial_operations WHERE operation_id='race') n").n,1);
});

async function preparedCommand(t,command) {
  const f=await active(t);let body;
  if(command==='cash.open')body={...common(f,'open'),session_id:'till',opening_cents:1000};
  else {
    await response(await open(f),201);
    if(command==='payment.create')body=payment(f,'pay',{payment_method:'efectivo',session_id:'till'});
    if(command==='cash.close')body={...common(f,'close'),session_id:'till',expected_session_revision:0,counted_cents:999};
    if(command==='adjustment.create')body={...common(f,'adjust'),session_id:'till',expected_session_revision:0,amount_cents:-100,reason:'Salida'};
    if(command==='compensation.create'){
      await response(await send(f,'payment.create',payment(f,'pay',{payment_method:'efectivo',session_id:'till'})),201);
      body={...common(f,'undo'),compensates_operation_id:'pay',session_id:'till',expected_session_revision:1,expected_credit_revision:1,reason:'Correccion'};
    }
  }
  return {f,body};
}

for(const command of ['payment.create','cash.open','cash.close','adjustment.create','compensation.create']){
  test(`${command}: fallo de CADA statement real no deja parciales; lostACK recupera recibo exacto`,async t=>{
    const {f,body}=await preparedCommand(t,command),saved=durable(f);let length=0;
    let restore=intercept(f,e=>{if(e.method==='batch'&&e.when==='before'){length=e.statements.length;throw new Error('probe');}});
    await response(await send(f,command,body),503);restore();assert.ok(length>=5);
    for(let i=0;i<length;i++){f.failBatchAt(i);await response(await send(f,command,body),503);assert.deepEqual(durable(f),saved,`statement ${i}`);}
    f.failBatchAt(null);let committed=false;
    restore=intercept(f,e=>{if(e.method==='batch'&&e.when==='after'){committed=true;throw new Error('lost ACK');}});
    const recovered=await response(await send(f,command,body),200);restore();assert.equal(committed,true);assert.equal(recovered.idempotent,true);
    const durableResult=JSON.parse(f.sql('SELECT result_json FROM canonical_financial_operations WHERE operation_id=?',body.operation_id).result_json);
    assert.deepEqual(recovered,{...durableResult,status:'already_processed',idempotent:true});
    const after=durable(f);assert.deepEqual(await response(await send(f,command,body),200),recovered);assert.deepEqual(durable(f),after);
  });
}

test('authority fencing antes del batch y replay/lostACK: credencial, revocacion, rol, writer, epoch, revision, freeze',async t=>{
  for(const timing of ['before-batch','after-lookup','lost-ack'])for(const mutation of ['rotate','revoke','role','writer','epoch','revision','freeze'])await t.test(`${timing}/${mutation}`,async t=>{
    const f=await active(t),body=payment(f);if(timing==='after-lookup')await response(await send(f,'payment.create',body),201);
    let fired=false;
    const mutate=()=>{
      if(mutation==='rotate')f.rotate();
      if(mutation==='revoke')f.exec("UPDATE devices SET status='revoked' WHERE device_id=?",WRITER['x-device-id']);
      if(mutation==='role')f.exec("UPDATE devices SET role='read_only' WHERE device_id=?",WRITER['x-device-id']);
      if(['writer','epoch','revision'].includes(mutation)){
        // Test-only corruption/race injection: bypass only the transition trigger,
        // then restore the real migration before the request continues.
        f.database.exec('DROP TRIGGER canonical_control_no_legacy');
        if(mutation==='writer')f.exec("UPDATE canonical_control SET writer_device_id='a6-reader' WHERE id=1");
        if(mutation==='epoch')f.exec('UPDATE canonical_control SET authority_epoch=authority_epoch+1 WHERE id=1');
        if(mutation==='revision')f.exec('UPDATE canonical_control SET revision=revision+1 WHERE id=1');
        f.database.exec(commerceMigration);f.database.exec(financialMigration);
      }
      if(mutation==='freeze')f.bumpControl(",mode='FROZEN'");
    };
    const restore=intercept(f,e=>{
      const match=timing==='before-batch'&&e.method==='batch'&&e.when==='before'||timing==='lost-ack'&&e.method==='batch'&&e.when==='after'||
        timing==='after-lookup'&&e.method==='first'&&e.when==='after'&&e.sql.startsWith('SELECT command,request_hash,result_json');
      if(!fired&&match){fired=true;mutate();if(timing==='lost-ack')throw new Error('lost ACK');}
    });
    await response(await send(f,'payment.create',body),409);restore();assert.equal(fired,true);
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_financial_events').n,timing==='before-batch'?0:1);
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n,0);
  });
});

test('historia nueva no UPDATE/DELETE/REPLACE incluso rowid; GateP y local-only permanecen',async t=>{
  const f=await active(t);await response(await open(f),201);await response(await send(f,'payment.create',payment(f)),201);await response(await close(f),201);
  const saved=durable(f);f.database.exec('PRAGMA recursive_triggers=OFF');
  for(const table of ['canonical_financial_operations','canonical_financial_events','canonical_cash_sessions','canonical_cash_closures']){
    assert.throws(()=>f.database.exec(`UPDATE ${table} SET rowid=rowid`),/immutable_financial_history/);
    assert.throws(()=>f.database.exec(`DELETE FROM ${table}`),/immutable_financial_history/);
    assert.throws(()=>f.database.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),/financial_replace_forbidden/);
    assert.throws(()=>f.database.exec(`INSERT OR REPLACE INTO ${table}(rowid,${f.all(`PRAGMA table_info(${table})`).map(c=>c.name).join(',')}) SELECT rowid,* FROM ${table}`),/financial_replace_forbidden/);
    assert.deepEqual(durable(f),saved);
  }
  assert.equal(f.control().first_live_operation_id,'seed');
  assert.throws(()=>f.exec('UPDATE canonical_control SET first_live_operation_id=NULL WHERE id=1'),/gate_p_control|immutable_first_live/);
  await response(await f.rollback(),409);
  assert.equal((await f.fetch('https://example.com/commands/payment.create',{method:'POST',headers:WRITER,body:JSON.stringify(payment(f,'remote'))})).status,404);
  delete f.env.A6_LOCAL_GATE;await response(await send(f,'payment.create',payment(f,'disabled')),404);
});

test('cash.open y payment digital pueden ser primer LIVE y fijan marker sin habilitar ACTIVE',async t=>{
  for(const command of ['cash.open','payment.create'])await t.test(command,async t=>{
    const f=await active(t,{seed:false}),before=f.control();
    const body=command==='cash.open'?{...common(f,'first-open'),session_id:'till',opening_cents:1000}:payment(f,'first-payment');
    await response(await send(f,command,body),201);
    const after=f.control();assert.equal(after.first_live_operation_id,body.operation_id);
    for(const field of ['mode','active_promotion_id','revision','authority_epoch','writer_device_id','minimum_client_contract'])assert.equal(after[field],before[field],field);
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_financial_operations').n,1);
    assert.equal(f.sql(`SELECT COUNT(*) n FROM ${command==='cash.open'?'canonical_cash_sessions':'canonical_financial_events'}`).n,1);
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_write_guards').n,0);
    assert.throws(()=>f.exec('UPDATE canonical_control SET first_live_operation_id=NULL WHERE id=1'),/gate_p_control|immutable_first_live/);
    await response(await f.freeze(`freeze-after-${command}`),409);
    await response(await f.rollback(),409);
    await response(await send(f,'sale.create',sale(f,'later-sale')),201);
    await response(await send(f,'payment.create',payment(f,'later-payment',{expected_credit_revision:command==='payment.create'?1:0})),201);
    assert.equal(f.control().first_live_operation_id,body.operation_id);
    f.bumpControl(",mode='FROZEN'");assert.throws(()=>f.bumpControl(",mode='ACTIVE'"),/gate_p_control/);
  });
});

test('fallo de cada statement del primer financiero revierte tambien first_live marker',async t=>{
  for(const command of ['cash.open','payment.create'])await t.test(command,async t=>{
    const f=await active(t,{seed:false});
    const body=command==='cash.open'?{...common(f,'first-open'),session_id:'till',opening_cents:1000}:payment(f,'first-payment');
    const saved=durable(f);let length=0;
    let restore=intercept(f,e=>{if(e.method==='batch'&&e.when==='before'){length=e.statements.length;throw new Error('probe');}});
    await response(await send(f,command,body),503);restore();assert.ok(length>=9);
    for(let index=0;index<length;index++){
      f.failBatchAt(index);await response(await send(f,command,body),503);
      assert.equal(f.control().first_live_operation_id,null,`statement ${index}`);assert.deepEqual(durable(f),saved,`statement ${index}`);
    }
    f.failBatchAt(null);await response(await send(f,command,body),201);assert.equal(f.control().first_live_operation_id,body.operation_id);
  });
});

test('cierre contra venta/abono concurrente: revision o caja cerrada rechaza al perdedor',async t=>{
  for(const command of ['sale.create','payment.create'])await t.test(command,async t=>{
    const f=await active(t);await response(await open(f),201);
    const closer={...common(f,'close-race'),session_id:'till',expected_session_revision:0,counted_cents:1000};
    const other=command==='sale.create'?sale(f,'cash-race',{session_id:'till',payment_method:'efectivo',payment:{cash_cents:1000,digital_cents:0,credit_cents:0}}):
      payment(f,'cash-race',{session_id:'till',payment_method:'efectivo'});
    const barrier=deferred();let arrivals=0;
    const restore=intercept(f,async e=>{if(e.method==='batch'&&e.when==='before'){if(++arrivals===2)barrier.resolve();await barrier.promise;}});
    const results=await Promise.all([send(f,'cash.close',closer),send(f,command,other)]);restore();
    assert.equal(arrivals,2);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
    const s=session(f);assert.equal(s.expected_cents,s.status==='CLOSED'?1000:command==='sale.create'?2000:1100);
    assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_assertions').n,0);
  });
});

test('mutaciones de cero filas abortan recibo; overflow de caja y cambios de payload no pasan',async t=>{
  for(const [command,table] of [['cash.open','canonical_cash_sessions'],['cash.close','canonical_cash_closures'],['payment.create','canonical_financial_events']])await t.test(command,async t=>{
    const {f,body}=await preparedCommand(t,command),saved=durable(f);
    f.database.exec(`CREATE TRIGGER test_ignore BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END;`);
    await response(await send(f,command,body),409);assert.deepEqual(durable(f),saved);
  });
  const f=await active(t);await response(await open(f,'till',Number.MAX_SAFE_INTEGER),201);const saved=durable(f);
  await response(await send(f,'adjustment.create',{...common(f,'overflow'),session_id:'till',expected_session_revision:0,amount_cents:1,reason:'No seguro'}),409);
  await response(await send(f,'sale.create',sale(f,'overflow-sale',{payment_method:'efectivo',payment:{cash_cents:1000,digital_cents:0,credit_cents:0}})),409);
  assert.deepEqual(durable(f),saved);
});

test('revocacion antes de batch protege cada comando, incluido cierre',async t=>{
  for(const command of ['cash.open','cash.close','adjustment.create','compensation.create'])await t.test(command,async t=>{
    const {f,body}=await preparedCommand(t,command),saved=durable(f);let fired=false;
    const restore=intercept(f,e=>{if(e.method==='batch'&&e.when==='before'){fired=true;f.rotate();}});
    await response(await send(f,command,body),409);restore();assert.equal(fired,true);assert.deepEqual(durable(f),saved);
  });
});

test('lectura paginada rechaza cambio de autoridad; credentials/epoch/contract invalidos no escriben',async t=>{
  const f=await active(t);await response(await send(f,'payment.create',payment(f)),201);const saved=durable(f);
  for(const changes of [{authority_epoch:0},{expected_control_revision:0},{promotion_id:'other'},{client_contract:'old'},{device_id:'other'}]){
    const r=await send(f,'payment.create',payment(f,'invalid',changes));assert.ok([400,403,409].includes(r.status));assert.deepEqual(durable(f),saved);
  }
  await response(await f.post('/commands/payment.create',payment(f,'reader', {device_id:'a6-reader'}),{'x-device-id':'a6-reader','x-sync-token':'a6-reader-secret'}),403);
  let fired=false;
  const restore=intercept(f,e=>{if(!fired&&e.method==='all'&&e.when==='after'&&e.sql.includes('FROM canonical_financial_events')){fired=true;f.bumpControl(",mode='FROZEN'");}});
  assert.equal((await response(await f.read('financial-events'),409)).error,'authority_changed');restore();assert.equal(fired,true);
});

test('financial_revision invalida cursor si entra ID detras y evita mezclar saldo/historia',async t=>{
  const f=await active(t);await response(await send(f,'payment.create',payment(f,'z-payment',{amount_cents:100})),201);
  await response(await send(f,'payment.create',payment(f,'zz-payment',{expected_credit_revision:1,amount_cents:100})),201);
  const first=await response(await f.read('credit-payments','?limit=1'),200);
  const eventPage=await response(await f.read('financial-events','?limit=1'),200);
  const creditPage=await response(await f.read('credits','?limit=1'),200);
  assert.equal(eventPage.items[0].event_id,'z-payment');assert.ok(eventPage.next_cursor);assert.ok(creditPage.next_cursor);
  assert.equal(first.financial_revision,3);assert.ok(first.next_cursor);
  const unchanged=await response(await send(f,'payment.create',payment(f,'zz-payment',{expected_credit_revision:1,amount_cents:100})),200);
  assert.equal(unchanged.status,'already_processed');
  assert.equal((await response(await f.read('status'),200)).financial_revision,3);
  await response(await send(f,'payment.create',payment(f,'a-payment',{expected_credit_revision:2,amount_cents:100})),201);
  const stale=await response(await f.read('credit-payments','?limit=1&cursor='+encodeURIComponent(first.next_cursor)),400);
  assert.equal(stale.error,'stale_cursor');
  for(const [route,page] of [['financial-events',eventPage],['credits',creditPage]])assert.equal((await response(await f.read(route,'?cursor='+encodeURIComponent(page.next_cursor)),400)).error,'stale_cursor');
  const refreshed=await response(await f.read('credits','?limit=100'),200);
  assert.equal(refreshed.financial_revision,4);
  assert.equal(refreshed.items.find(c=>c.credit_id==='CR:001').current_balance_cents,400);

  let fired=false;
  const restore=intercept(f,async e=>{
    if(!fired&&e.method==='all'&&e.when==='after'&&e.sql.includes("FROM canonical_financial_events WHERE promotion_id=?1 AND credit_id IS NOT NULL")){
      fired=true;await response(await send(f,'payment.create',payment(f,'mid-read',{expected_credit_revision:3,amount_cents:100})),201);
    }
  });
  assert.equal((await response(await f.read('credit-payments','?limit=100'),409)).error,'authority_changed');restore();assert.equal(fired,true);
  const final=await response(await f.read('credit-payments','?limit=100'),200);
  assert.equal(final.financial_revision,5);assert.equal(final.items.filter(p=>p.provenance==='LIVE').length,4);
});

test('CANONICAL_READ_ONLY conserva meta previa sin financial_revision',async t=>{
  const f=await a6Fixture(t);await response(await f.freeze(),201);await response(await f.promote(),201);
  const page=await response(await f.read('credits','?limit=1'),200);
  assert.equal(Object.hasOwn(page,'financial_revision'),false);
  assert.equal(page.read_only,true);assert.equal(page.mode,'CANONICAL_READ_ONLY');
});

test('financial_revision avanza por cada comando y venta, no por rollback ni replay',async t=>{
  const f=await active(t,{seed:false});
  const rev=async()=> (await response(await f.read('status'),200)).financial_revision;
  assert.equal(await rev(),0);
  await response(await open(f),201);assert.equal(await rev(),1);
  await response(await open(f),200);assert.equal(await rev(),1);
  const failed=payment(f,'failed');f.failBatchAt(4);
  await response(await send(f,'payment.create',failed),503);f.failBatchAt(null);assert.equal(await rev(),1);
  await response(await send(f,'payment.create',payment(f)),201);assert.equal(await rev(),2);
  await response(await send(f,'sale.create',sale(f,'sale')),201);assert.equal(await rev(),3);
  await response(await send(f,'adjustment.create',{...common(f,'adjust'),session_id:'till',expected_session_revision:0,amount_cents:10,reason:'Entrada'}),201);assert.equal(await rev(),4);
  await response(await send(f,'compensation.create',{...common(f,'undo'),compensates_operation_id:'adjust',session_id:'till',expected_session_revision:1,reason:'Correccion'}),201);assert.equal(await rev(),5);
  await response(await close(f),201);assert.equal(await rev(),6);
});

test('marker SQL exige efecto completo aun sin assertion de changes; no modifica otros campos',async t=>{
  for(const command of ['cash.open','payment.create'])await t.test(command,async t=>{
    const f=await active(t,{seed:false}),saved=durable(f);
    const body=command==='cash.open'?{...common(f,'first'),session_id:'till',opening_cents:1000}:payment(f,'first');
    let fired=false;
    const restore=intercept(f,e=>{
      if(e.method==='batch'&&e.when==='before'){
        const index=e.entries.findIndex(entry=>entry.sql.startsWith(`INSERT INTO ${command==='cash.open'?'canonical_cash_sessions':'canonical_financial_events'}(`));
        assert.ok(index>0);e.statements.splice(index,2);fired=true;
      }
    });
    await response(await send(f,command,body),409);restore();assert.equal(fired,true);assert.deepEqual(durable(f),saved);
    const restoreMutation=intercept(f,e=>{
      if(e.method==='batch'&&e.when==='before'){
        const index=e.entries.findIndex(entry=>entry.sql.startsWith('UPDATE canonical_control SET first_live_operation_id'));
        e.statements[index]=f.binding.prepare("UPDATE canonical_control SET first_live_operation_id=?1,minimum_client_contract='other' WHERE id=1").bind(body.operation_id);
      }
    });
    await response(await send(f,command,body),409);restoreMutation();assert.deepEqual(durable(f),saved);
  });
});
