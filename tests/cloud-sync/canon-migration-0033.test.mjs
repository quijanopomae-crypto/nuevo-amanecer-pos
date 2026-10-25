import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeCanon} from './canon-browser-harness.mjs';
import * as migration from '../../tools/cloudflare-prod/scripts/turso-expense-server-received-maintenance.mjs';
const source=readFileSync(migration.migrationPath,'utf8');
function adapter(database){return {prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async all(){return {results:database.prepare(sql).all(...this.args)};}};},async batch(statements){database.exec('BEGIN');try{const results=statements.map(s=>({results:database.prepare(s.sql).all(...s.args)}));database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};}
test('0033 is purely additive, idempotent and preserves all prior rows, views and triggers',async t=>{
 const f=await activeCanon(t),db=adapter(f.database);
 f.database.exec('ALTER TABLE canonical_expenses DROP COLUMN server_received_at'); // estado previo a 0033
 const schema=f.database.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
 const tables=schema.filter(r=>r.type==='table').map(r=>r.name);
 f.addDevice('migration-owner','writer','active','migration-token');
 const control=f.control();
 const before=tables.map(name=>f.database.prepare('SELECT * FROM "'+name+'"').all());
 assert.equal(source,'ALTER TABLE canonical_expenses ADD COLUMN server_received_at TEXT;\n');
 assert.equal((await migration.preflight(db,source)).already_present,0);
 await assert.rejects(()=>migration.verify(db,source),/schema mismatch/);
 await migration.migrate(db,source);await migration.migrate(db,source);
 assert.deepEqual(tables.map(name=>f.database.prepare('SELECT * FROM "'+name+'"').all().map(row=>{if(name==='canonical_expenses'){assert.equal(row.server_received_at,null);delete row.server_received_at;}return row;})),before);
 for(const object of schema.filter(row=>row.name!=='canonical_expenses'))assert.deepEqual(f.database.prepare('SELECT type,name,sql FROM sqlite_master WHERE name=?').get(object.name),object);
 assert.equal((await migration.preflight(db,source)).already_present,1);
 assert.throws(()=>migration.migrationUnits(source+'DELETE FROM sales;'),/hash mismatch/);
});
test('0033 maintenance rejects column drift and skips an already applied migration',async t=>{
 const f=await activeCanon(t),db=adapter(f.database);await migration.migrate(db,source);
 assert.equal((await migration.preflight(db,source)).already_present,1);
 const drift=await activeCanon(t);
 drift.database.exec('ALTER TABLE canonical_expenses DROP COLUMN server_received_at');
 drift.database.exec('ALTER TABLE canonical_expenses ADD COLUMN server_received_at INTEGER;');
 await assert.rejects(()=>migration.preflight(adapter(drift.database),source),/schema drift/);
});
