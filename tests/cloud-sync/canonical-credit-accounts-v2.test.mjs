import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { validateCanonicalSale } from '../../tools/cloudflare-lab/src/a6-commerce.js';

const migration = readFileSync(new URL('../../tools/cloudflare-lab/migrations/0012_credit_accounts_v2.sql', import.meta.url), 'utf8');
const canonicalRead = readFileSync(new URL('../../tools/cloudflare-lab/src/a6-canonical.js', import.meta.url), 'utf8');
const commerce = readFileSync(new URL('../../tools/cloudflare-lab/src/a6-commerce.js', import.meta.url), 'utf8');

function baseSale(extra={}) {
  return {
    operation_id:'op-credit-v2-1',
    sale_id:'sale-credit-v2-1',
    promotion_id:'promo-1',
    client_contract:'a6-gate-c-v1',
    authority_epoch:1,
    expected_control_revision:1,
    created_at:'2026-09-26T20:00:00.000Z',
    customer_id:'cust-1',
    payment_method:'credito',
    total_cents:412500,
    credit_due:'2026-10-01',
    payment:{cash_cents:0,digital_cents:0,credit_cents:412500},
    items:[{product_id:'p-1',quantity:1,unit_price_cents:412500,line_total_cents:412500,expected_stock_revision:0}],
    ...extra
  };
}

test('sale validation defaults any uncategorized credit to Créditos pequeños regardless of amount',()=>{
  const out=validateCanonicalSale(baseSale({total_cents:500000,payment:{cash_cents:0,digital_cents:0,credit_cents:500000},items:[{product_id:'p-1',quantity:1,unit_price_cents:500000,line_total_cents:500000,expected_stock_revision:0}]}));
  assert.equal(out.error,undefined);
  assert.deepEqual(out.value.credit_account,{account_id:'small',name:'Créditos pequeños',mode:'accumulated',builtin:true});
  assert.deepEqual(out.value.installments,[]);
});

test('sale validation preserves a reusable custom account and exact 11-installment schedule',()=>{
  const dates=['2026-10-01','2026-11-01','2026-12-01','2027-01-01','2027-02-01','2027-03-01','2027-04-01','2027-05-01','2027-06-01','2027-07-01','2027-08-01'];
  const installments=dates.map((due_date,index)=>({number:index+1,due_date,amount_cents:37500}));
  const out=validateCanonicalSale(baseSale({
    credit_account:{account_id:'cat-tech',name:'Tecnología',mode:'separate'},
    installments
  }));
  assert.equal(out.error,undefined);
  assert.equal(out.value.credit_account.account_id,'cat-tech');
  assert.equal(out.value.credit_account.mode,'separate');
  assert.equal(out.value.installments.length,11);
  assert.equal(out.value.installments.reduce((sum,row)=>sum+row.amount_cents,0),412500);
  assert.equal(out.value.installments.at(-1).due_date,'2027-08-01');
});

test('sale validation rejects malformed account metadata, schedules and non-credit sidecars',()=>{
  assert.equal(validateCanonicalSale(baseSale({credit_account:{account_id:'x',name:'',mode:'separate'}})).error,'invalid_credit_metadata');
  assert.equal(validateCanonicalSale(baseSale({installments:[{number:1,due_date:'2026-10-01',amount_cents:1}]})).error,'invalid_credit_metadata');
  const cash=baseSale({payment_method:'efectivo',customer_id:undefined,credit_due:undefined,credit_account:{account_id:'small',name:'Créditos pequeños',mode:'accumulated'},payment:{cash_cents:412500,digital_cents:0,credit_cents:0}});
  assert.equal(validateCanonicalSale(cash).error,'invalid_credit_metadata');
});

function dbWithParents() {
  const db=new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE canonical_promotions(promotion_id TEXT PRIMARY KEY);
    CREATE TABLE customers(promotion_id TEXT NOT NULL, customer_id TEXT NOT NULL, PRIMARY KEY(promotion_id,customer_id));
    CREATE TABLE devices(device_id TEXT PRIMARY KEY, role TEXT NOT NULL, status TEXT NOT NULL, credential_hash TEXT NOT NULL);
    CREATE TABLE canonical_control(id INTEGER PRIMARY KEY, mode TEXT NOT NULL, active_promotion_id TEXT);
    CREATE TABLE live_credits(promotion_id TEXT NOT NULL,credit_id TEXT NOT NULL,customer_id TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(promotion_id,credit_id));
    CREATE TABLE credits(promotion_id TEXT NOT NULL,credit_id TEXT NOT NULL,customer_id TEXT NOT NULL,PRIMARY KEY(promotion_id,credit_id));
    INSERT INTO canonical_promotions VALUES('promo-1');
    INSERT INTO customers VALUES('promo-1','cust-1');
    INSERT INTO devices VALUES('writer-1','writer','active','${'a'.repeat(64)}');
    INSERT INTO canonical_control VALUES(1,'ACTIVE','promo-1');
    INSERT INTO credits VALUES('promo-1','legacy-1','cust-1');
  `);
  return db;
}

test('0012 is additive: existing legacy rows survive and sidecars are immutable',()=>{
  const db=dbWithParents();
  db.exec(migration);
  assert.equal(db.prepare("SELECT count(*) n FROM credits WHERE credit_id='legacy-1'").get().n,1);
  const hash='b'.repeat(64), credential='a'.repeat(64);
  db.prepare(`INSERT INTO canonical_credit_accounts
    (promotion_id,customer_id,account_id,name,mode,operation_id,request_hash,principal_id,credential_hash,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run('promo-1','cust-1','cat-tech','Tecnología','separate','account-op-1',hash,'writer-1',credential,'2026-09-26T20:00:00.000Z');
  assert.equal(db.prepare("SELECT mode FROM canonical_credit_accounts WHERE account_id='cat-tech'").get().mode,'separate');
  assert.throws(()=>db.prepare("UPDATE canonical_credit_accounts SET name='Otro' WHERE account_id='cat-tech'").run(),/immutable_credit_account/);
  assert.throws(()=>db.prepare("DELETE FROM canonical_credit_accounts WHERE account_id='cat-tech'").run(),/immutable_credit_account/);
});

test('sidecars require a real credit identity and preserve original ledger rows',()=>{
  const db=dbWithParents();
  db.exec(migration);
  db.prepare("INSERT INTO live_credits VALUES('promo-1','live-1','cust-1','sale-op-1')").run();
  db.prepare(`INSERT INTO canonical_credit_metadata
    (promotion_id,credit_id,credit_provenance,customer_id,account_id,account_name,account_mode,operation_id,assigned_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('promo-1','live-1','LIVE','cust-1','small','Créditos pequeños','accumulated','sale-op-1','2026-09-26T20:00:00.000Z');
  db.prepare(`INSERT INTO canonical_credit_installments
    (promotion_id,credit_id,credit_provenance,installment_number,due_date,amount_cents,operation_id,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('promo-1','live-1','LIVE',1,'2026-10-01',10000,'sale-op-1','2026-09-26T20:00:00.000Z');
  assert.equal(db.prepare("SELECT count(*) n FROM live_credits WHERE credit_id='live-1'").get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM canonical_credit_installments WHERE credit_id='live-1'").get().n,1);
  assert.throws(()=>db.prepare(`INSERT INTO canonical_credit_metadata
    (promotion_id,credit_id,credit_provenance,customer_id,account_id,account_name,account_mode,operation_id,assigned_at)
    VALUES('promo-1','missing','LIVE','cust-1','small','Créditos pequeños','accumulated','missing-op','2026-09-26T20:00:00.000Z')`).run(),/invalid_credit_metadata/);
});

test('migration contains no destructive rewrite and read model exposes optional V2 metadata',()=>{
  assert.doesNotMatch(migration,/\bDROP\s+TABLE\b|\bALTER\s+TABLE\b|\bDELETE\s+FROM\b|\bUPDATE\s+(credits|live_credits|credit_payments|canonical_financial_events)\b/i);
  for(const table of ['canonical_credit_accounts','canonical_credit_metadata','canonical_credit_installments']) assert.match(migration,new RegExp('CREATE TABLE IF NOT EXISTS '+table));
  assert.match(canonicalRead,/credit-accounts/);
  assert.match(canonicalRead,/m\\.account_id,m\\.account_name,m\\.account_mode/);
  assert.match(canonicalRead,/installments_json/);
  assert.match(commerce,/INSERT INTO canonical_credit_metadata/);
  assert.match(commerce,/INSERT INTO canonical_credit_installments/);
  assert.doesNotMatch(commerce,/INSERT INTO canonical_financial_events[\s\S]*credit_account/i);
});
