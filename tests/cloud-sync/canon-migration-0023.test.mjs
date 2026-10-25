// Contrato de la migración 0023 (el flujo de GitHub que la aplicó ya cumplió y fue retirado; ver docs/MIGRATION_BACKUP_RESTORE.md).
// Nothing here touches production; the maintenance script runs against local SQLite fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeCanon} from './canon-browser-harness.mjs';
import * as ident from '../../tools/cloudflare-prod/scripts/turso-customer-identity-maintenance.mjs';
import {encryptBackup} from '../../tools/cloudflare-prod/scripts/turso-customer-contacts-maintenance.mjs';

const source=readFileSync(ident.migrationPath,'utf8');
const prior=['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql','0017_canonical_live_customers.sql','0018_canonical_customer_credit_policy.sql','0020_canonical_customer_contacts.sql'];
function adapter(database){
  return {prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async all(){return {results:database.prepare(sql).all(...this.args)};}};},
    async batch(statements){return statements.map(s=>({results:database.prepare(s.sql).all(...s.args)}));}};
}
function apply(database,units){database.exec('BEGIN');for(const sql of units)database.exec(sql);database.exec('COMMIT');}

test('0023 splitter keeps table, view and full triggers; preflight is read-only; additive retry retains ledgers and exact schema',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const before=f.counts();
  const units=ident.migrationUnits(source);
  assert.equal(units.length,7);
  assert.ok(units.every(s=>!/BEGIN SELECT RAISE/.test(s)||/END;$/.test(s)),'every trigger keeps its END');
  const schemaBefore=f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n;
  const report=await ident.preflight(db,source);
  assert.deepEqual({objects:report.objects,already_present:report.already_present},{objects:7,already_present:0});
  assert.ok(report.referenced_tables>=5);
  assert.equal(typeof report.duplicated_documents,'number');
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n,schemaBefore,'preflight must not write');
  await assert.rejects(()=>ident.verify(db,source),/schema mismatch/);
  apply(f.database,units);
  assert.deepEqual(f.counts(),before);
  await ident.verify(db,source);
  apply(f.database,units);
  await ident.verify(db,source);
  assert.equal((await ident.preflight(db,source)).already_present,7);
  assert.deepEqual(f.counts(),before);
  f.database.exec('DROP TRIGGER customer_identity_no_delete');
  await assert.rejects(()=>ident.verify(db,source),/schema mismatch/);
  f.database.exec(units.find(s=>s.includes('CREATE TRIGGER IF NOT EXISTS customer_identity_no_delete')));
  await ident.verify(db,source);
  f.database.exec('DROP VIEW canonical_customer_effective_identity');
  await assert.rejects(()=>ident.verify(db,source),/schema mismatch: canonical_customer_effective_identity/);
});

test('0023 preflight refuses drifted objects and missing referenced tables before any write',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  f.database.exec("CREATE TRIGGER customer_identity_no_update BEFORE UPDATE ON canonical_customer_contacts BEGIN SELECT 1; END;");
  await assert.rejects(()=>ident.preflight(adapter(f.database),source),/schema drift: customer_identity_no_update/);
  const g=await activeCanon(t,{migrations:prior.filter(m=>!m.startsWith('0020'))});
  await assert.rejects(()=>ident.preflight(adapter(g.database),source),/missing referenced tables: .*canonical_customer_contacts/);
});

test('0023 preflight counts documents already shared by several customers (counts only, never values)',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const base=await ident.preflight(db,source);
  // Fixture-only: clone the imported customer (and its staging row) with the same document.
  const src=f.database.prepare("SELECT * FROM customers ORDER BY customer_id LIMIT 1").get();
  assert.ok(src,'fixture needs one imported customer');
  const triggers=f.database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('customers','import_staging')").all();
  for(const tr of triggers)f.database.exec('DROP TRIGGER "'+tr.name+'"');
  const clone=(table,where,args,patch)=>{
    const cols=f.database.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map(r=>r.name);
    const sel=cols.map(c=>patch[c]!==undefined?patch[c]+' AS '+c:c).join(',');
    f.database.prepare(`INSERT INTO ${table}(${cols.join(',')}) SELECT ${sel} FROM ${table} WHERE ${where}`).run(...args);
  };
  clone('import_staging','import_id=? AND entity_type=? AND source_name=? AND source_row=? AND source_key=?',
    [src.source_import_id,src.source_entity_type,src.source_name,src.source_row,src.source_key],{source_key:"source_key||'-dup'"});
  f.database.prepare("UPDATE customers SET document='12345678' WHERE promotion_id=? AND customer_id=?").run(src.promotion_id,src.customer_id);
  clone('customers','promotion_id=? AND customer_id=?',[src.promotion_id,src.customer_id],{customer_id:"customer_id||'-dup'",source_key:"source_key||'-dup'"});
  for(const tr of triggers)f.database.exec(tr.sql);
  const out=await ident.preflight(db,source);
  assert.equal(out.duplicated_documents,base.duplicated_documents+1);
  assert.ok(out.extra_uses>=base.extra_uses+1);
  assert.ok(!JSON.stringify(out).includes('12345678'),'report must not contain document values');
});

test('migration refuses altered source and inactive authority',async(t)=>{
  assert.throws(()=>ident.migrationUnits(source+'\nDELETE FROM sales;'),/hash mismatch/);
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const batch=db.batch;
  db.batch=async statements=>{const out=await batch(statements);if(out[2]?.results?.[0]?.mode)out[2].results[0].mode='SHADOW';return out;};
  await assert.rejects(()=>ident.preflight(db,source),/inactive/);
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
  assert.equal(ident.backupPath,'/tmp/turso-migration-0023-backup.json');
});

test('full logical backup covers schema and every table, encrypted with the existing Turso credential',async(t)=>{
  const {createHash,createDecipheriv}=await import('node:crypto');
  const f=await activeCanon(t,{migrations:prior});
  const saved=process.env.TURSO_PROD_AUTH_TOKEN, secret='fixture-only-token-'.repeat(3);
  process.env.TURSO_PROD_AUTH_TOKEN=secret;
  t.after(()=>{if(saved===undefined)delete process.env.TURSO_PROD_AUTH_TOKEN;else process.env.TURSO_PROD_AUTH_TOKEN=saved;});
  await ident.backup(adapter(f.database));
  const packet=JSON.parse(readFileSync(ident.backupPath,'utf8'));
  const key=createHash('sha256').update('nuevo-amanecer-contact-backup-v1\0'+secret).digest();
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));
  d.setAAD(Buffer.from('nuevo-amanecer-contact-backup-v1'));d.setAuthTag(Buffer.from(packet.tag,'base64'));
  const plain=JSON.parse(Buffer.concat([d.update(Buffer.from(packet.data,'base64')),d.final()]));
  assert.equal(plain.format,'nuevo-amanecer-turso-migration-0023-backup-v1');
  const tables=f.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name).sort();
  assert.deepEqual(Object.keys(plain.tables).sort(),tables);
  assert.equal(plain.tables.customers.length,f.database.prepare('SELECT COUNT(*) n FROM customers').get().n);
  assert.ok(plain.schema.some(s=>s.type==='trigger'));
});
