// Migración 0034 (price_history, Misión 3 / #857): aditiva, idempotente, sin tocar filas existentes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeCanon} from './canon-browser-harness.mjs';
import * as migration from '../../tools/cloudflare-prod/scripts/turso-price-history-maintenance.mjs';
const source=readFileSync(migration.migrationPath,'utf8');
function adapter(database){return {prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async all(){return {results:database.prepare(sql).all(...this.args)};}};},async batch(statements){database.exec('BEGIN');try{const results=statements.map(s=>({results:database.prepare(s.sql).all(...s.args)}));database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};}
test('0034 es aditiva, idempotente y conserva todas las filas y objetos previos',async t=>{
  const f=await activeCanon(t),db=adapter(f.database);
  const schema=f.database.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const tables=schema.filter(r=>r.type==='table').map(r=>r.name);
  const before=tables.map(name=>f.database.prepare('SELECT * FROM "'+name+'"').all());
  assert.equal((await migration.preflight(db,source)).already_present,0);
  await assert.rejects(()=>migration.verify(db,source),/schema mismatch/);
  await migration.migrate(db,source);await migration.migrate(db,source);
  assert.deepEqual(tables.map(name=>f.database.prepare('SELECT * FROM "'+name+'"').all()),before);
  for(const object of schema)assert.deepEqual(f.database.prepare('SELECT type,name,sql FROM sqlite_master WHERE name=?').get(object.name),object);
  assert.equal((await migration.preflight(db,source)).already_present,4);
  assert.throws(()=>migration.migrationUnits(source+'DELETE FROM sales;'),/hash mismatch/);
  assert.doesNotMatch(source,/\b(DROP|DELETE|UPDATE|ALTER)\b/i);
});
test('0034: clave única por cambio y por (ref, field); ON CONFLICT DO NOTHING sin destino no falla',async t=>{
  const f=await activeCanon(t);f.database.exec(source);
  const ins=f.database.prepare("INSERT INTO price_history(change_id,product_id,field,before_cents,after_cents,origin,ref,user_name,user_id,changed_at,device_id,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING change_id");
  const row=(id,ref)=>[id,'P1','costo',100,120,'compra',ref,'Ana · "X" | 1','C-1','2026-10-21T03:30:00.000Z','dev','2026-10-21T03:31:00.000Z'];
  assert.equal(ins.all(...row('ph1:a','PUR-1:1')).length,1);
  assert.equal(ins.all(...row('ph1:a','PUR-1:1')).length,0,'mismo change_id');
  assert.equal(ins.all(...row('ph1:b','PUR-1:1')).length,0,'misma (ref, field)');
  assert.equal(ins.all(...row('ph1:c',null)).length,1);
  assert.throws(()=>f.database.exec("INSERT INTO price_history(change_id,product_id,field,origin,user_name,changed_at,device_id,received_at) VALUES('x','P','costo','ficha','A','t','d','t')"),/CHECK/);
  assert.throws(()=>f.database.exec("INSERT INTO price_history(change_id,product_id,field,origin,user_name,changed_at,device_id,received_at) VALUES('ph1:z','P','otro','ficha','A','t','d','t')"),/CHECK/);
});
test('0034: el workflow verifica contratos y respalda antes de aplicar; disparador acotado',()=>{
  const workflow=readFileSync('.github/workflows/canon-migration-0034.yml','utf8');
  assert.match(workflow,/ops\/canon-migration-0034\.json/);
  assert.ok(workflow.indexOf('Verify migration contracts')<workflow.indexOf('Read-only preflight'));
  assert.ok(workflow.indexOf('Store and verify backup')<workflow.indexOf('Apply additive migration'));
  assert.match(workflow,/\["0034"\]/);
});
