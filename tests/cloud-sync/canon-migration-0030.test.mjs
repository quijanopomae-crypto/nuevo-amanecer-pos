// Contrato de la migración 0030 (el flujo de GitHub que la aplicó ya cumplió y fue retirado; ver docs/MIGRATION_BACKUP_RESTORE.md).
// Nothing here touches production; the maintenance script runs against local SQLite fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeCanon} from './canon-browser-harness.mjs';
import * as roles from '../../tools/cloudflare-prod/scripts/turso-stock-lots-maintenance.mjs';
import {encryptBackup} from '../../tools/cloudflare-prod/scripts/turso-customer-contacts-maintenance.mjs';

const source=readFileSync(roles.migrationPath,'utf8');
const prior=['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql','0017_canonical_live_customers.sql','0018_canonical_customer_credit_policy.sql','0020_canonical_customer_contacts.sql','0023_canonical_customer_identity.sql','0024_pos_roles_owner_pin.sql','0025_pos_reviews_pin_failures.sql','0026_pos_sale_annulments.sql','0027_pos_sale_notes.sql','0028_pos_purchases.sql'];
function adapter(database){
  return {prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async all(){return {results:database.prepare(sql).all(...this.args)};}};},
    async batch(statements){return statements.map(s=>({results:database.prepare(s.sql).all(...s.args)}));}};
}
function apply(database,units){database.exec('BEGIN');for(const sql of units)database.exec(sql);database.exec('COMMIT');}

test('0030 is five additive objects (3 tables, 2 indexes); preflight is read-only; retry retains rows and exact schema',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const before=f.counts();
  const units=roles.migrationUnits(source);
  assert.equal(units.length,5);
  assert.ok(units.every(s=>/^(?:--[^\n]*\n)*CREATE (TABLE|INDEX) IF NOT EXISTS (canonical_stock_lot|pos_purchase_line_lots)/.test(s)));
  assert.doesNotMatch(source,/\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
  const schemaBefore=f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n;
  const report=await roles.preflight(db,source);
  assert.deepEqual({objects:report.objects,already_present:report.already_present},{objects:5,already_present:0});
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n,schemaBefore,'preflight must not write');
  await assert.rejects(()=>roles.verify(db,source),/schema mismatch/);
  apply(f.database,units);
  assert.deepEqual(f.counts(),before);
  await roles.verify(db,source);
  apply(f.database,units);
  await roles.verify(db,source);
  assert.equal((await roles.preflight(db,source)).already_present,5);
  f.database.exec('DROP TABLE canonical_stock_lots');
  await assert.rejects(()=>roles.verify(db,source),/schema mismatch: canonical_stock_lots/);
});

test('0030 preflight refuses drifted objects before any write',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  f.database.exec("CREATE TABLE canonical_stock_lots(sale_id TEXT PRIMARY KEY)");
  await assert.rejects(()=>roles.preflight(adapter(f.database),source),/schema drift: canonical_stock_lots/);
});

test('migration refuses altered source and inactive authority',async(t)=>{
  assert.throws(()=>roles.migrationUnits(source+'\nDELETE FROM sales;'),/hash mismatch/);
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const batch=db.batch;
  db.batch=async statements=>{const out=await batch(statements);if(out[2]?.results?.[0]?.mode)out[2].results[0].mode='SHADOW';return out;};
  await assert.rejects(()=>roles.preflight(db,source),/inactive/);
});

test('backups are authenticated encrypted before upload and reject absent keys',async()=>{
  const {createHash,createDecipheriv}=await import('node:crypto');
  const secret='test-only-secret-'.repeat(4), plain=Buffer.from('{"document":"private dni"}');
  const out=encryptBackup(plain,secret);
  assert.ok(!out.toString().includes('private dni'));
  assert.throws(()=>encryptBackup(plain,''),/secret/);
  const packet=JSON.parse(out);
  const key=createHash('sha256').update('nuevo-amanecer-contact-backup-v1\0'+secret).digest();
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));
  decipher.setAAD(Buffer.from('nuevo-amanecer-contact-backup-v1'));
  decipher.setAuthTag(Buffer.from(packet.tag,'base64'));
  assert.deepEqual(Buffer.concat([decipher.update(Buffer.from(packet.data,'base64')),decipher.final()]),plain);
  assert.equal(roles.backupPath,'/tmp/turso-migration-0030-backup.json');
});

test('full logical backup covers schema and every table, encrypted with the existing Turso credential',async(t)=>{
  const {createHash,createDecipheriv}=await import('node:crypto');
  const f=await activeCanon(t,{migrations:prior});
  const saved=process.env.TURSO_PROD_AUTH_TOKEN, secret='fixture-only-token-'.repeat(3);
  process.env.TURSO_PROD_AUTH_TOKEN=secret;
  t.after(()=>{if(saved===undefined)delete process.env.TURSO_PROD_AUTH_TOKEN;else process.env.TURSO_PROD_AUTH_TOKEN=saved;});
  await roles.backup(adapter(f.database));
  const packet=JSON.parse(readFileSync(roles.backupPath,'utf8'));
  const key=createHash('sha256').update('nuevo-amanecer-contact-backup-v1\0'+secret).digest();
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));
  d.setAAD(Buffer.from('nuevo-amanecer-contact-backup-v1'));d.setAuthTag(Buffer.from(packet.tag,'base64'));
  const plain=JSON.parse(Buffer.concat([d.update(Buffer.from(packet.data,'base64')),d.final()]));
  assert.equal(plain.format,'nuevo-amanecer-turso-migration-0030-backup-v1');
  const tables=f.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name).sort();
  assert.deepEqual(Object.keys(plain.tables).sort(),tables);
  assert.equal(plain.tables.customers.length,f.database.prepare('SELECT COUNT(*) n FROM customers').get().n);
  assert.ok(plain.schema.some(s=>s.type==='trigger'));
});

test('0030 needs 0028 purchase tables (FK) but not 0029; preflight blocks before any write when 0028 is missing',async(t)=>{
  const f=await activeCanon(t,{migrations:prior.filter(m=>!m.startsWith('0028'))});
  const db=adapter(f.database);
  const schemaBefore=f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n;
  await assert.rejects(()=>roles.preflight(db,source),/missing referenced tables: pos_purchase_lines,pos_purchases/);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n,schemaBefore);
});
