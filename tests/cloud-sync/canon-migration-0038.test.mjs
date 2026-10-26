// Contrato de la migración 0038 (memoria permanente de negocio del asistente: pos_assistant_memory). BORRADOR: el SQL sigue en infra/database/borradores/.
// Nothing here touches production; the maintenance script runs against local SQLite fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeCanon} from './canon-browser-harness.mjs';
import * as memory from '../../tools/cloudflare-prod/scripts/turso-assistant-memory-maintenance.mjs';
import {encryptBackup} from '../../tools/cloudflare-prod/scripts/turso-customer-contacts-maintenance.mjs';

const source=readFileSync(memory.migrationPath,'utf8');
const prior=['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql','0017_canonical_live_customers.sql','0018_canonical_customer_credit_policy.sql','0020_canonical_customer_contacts.sql','0023_canonical_customer_identity.sql'];
function adapter(database){
  return {prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async all(){return {results:database.prepare(sql).all(...this.args)};}};},
    async batch(statements){return statements.map(s=>({results:database.prepare(s.sql).all(...s.args)}));}};
}
function apply(database,units){database.exec('BEGIN');for(const sql of units)database.exec(sql);database.exec('COMMIT');}
const row=(o={})=>({memory_id:'m1',scope:'negocio',kind:'presentacion',subject_ref:'P12',value_json:'{"presentacion":"caja","unidades":24}',rol_min:'empleado',source:'ensenado',state:'activa',version:1,device_id:'abcd1234abcd1234',created_at:'2026-10-26',updated_at:'2026-10-26',...o});
const insert=(database,o)=>{const r=row(o),k=Object.keys(r);database.prepare('INSERT INTO pos_assistant_memory('+k.join(',')+') VALUES('+k.map(()=>'?').join(',')+')').run(...k.map(x=>r[x]));};

test('0038 is one table and two indexes, additive only; preflight is read-only; retry retains rows and exact schema',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const before=f.counts();
  const units=memory.migrationUnits(source);
  assert.equal(units.length,3);
  assert.match(units[0],/CREATE TABLE IF NOT EXISTS pos_assistant_memory/);
  assert.ok(units.slice(1).every(s=>/CREATE (UNIQUE )?INDEX IF NOT EXISTS pos_assistant_memory_/.test(s)));
  assert.doesNotMatch(source.replace(/--[^\n]*/g,''),/\b(ALTER|DROP|DELETE|UPDATE|INSERT)\b/i);
  assert.ok(source.split('\n').filter(l=>l.includes('--')).every(l=>!l.includes(';')),'ningun comentario lleva punto y coma (el analizador de scripts de Turso corta ahi)');
  assert.doesNotMatch(source,/DROP/i,'ni siquiera como comentario');
  const schemaBefore=f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n;
  const report=await memory.preflight(db,source);
  assert.deepEqual({objects:report.objects,already_present:report.already_present},{objects:3,already_present:0});
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM sqlite_master').get().n,schemaBefore,'preflight must not write');
  await assert.rejects(()=>memory.verify(db,source),/schema mismatch/);
  apply(f.database,units);
  assert.deepEqual(f.counts(),before,'no existing table changes');
  await memory.verify(db,source);
  insert(f.database,{});
  apply(f.database,units);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM pos_assistant_memory').get().n,1,'retry keeps rows');
  await memory.verify(db,source);
  assert.equal((await memory.preflight(db,source)).already_present,3);
  f.database.exec('DROP INDEX pos_assistant_memory_lookup');
  await assert.rejects(()=>memory.verify(db,source),/schema mismatch: pos_assistant_memory_lookup/);
});

test('0038 table rules: kind/rol_min CHECK, one active row per subject, closed vocab, size caps',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  apply(f.database,memory.migrationUnits(source));
  const d=f.database;
  insert(d,{});
  insert(d,{memory_id:'m2',kind:'preferencia',subject_ref:'t:0123456789abcdef',value_json:'{"clave":"venta_por","valor":"display"}',rol_min:'owner'});
  assert.throws(()=>insert(d,{memory_id:'m3',kind:'preferencia',subject_ref:'t:aaaaaaaaaaaaaaaa',value_json:'{"clave":"cobro","valor":"yape"}',rol_min:'empleado'}),/CHECK/,'una preferencia nunca es visible al empleado');
  assert.throws(()=>insert(d,{memory_id:'m4',kind:'proveedor'}),/CHECK/);
  assert.throws(()=>insert(d,{memory_id:'m5',source:'conversacion'}),/CHECK/);
  assert.throws(()=>insert(d,{memory_id:'m6',value_json:'no es json'}),/CHECK/);
  assert.throws(()=>insert(d,{memory_id:'m7',value_json:JSON.stringify({x:'y'.repeat(1001)})}),/CHECK/);
  assert.throws(()=>insert(d,{memory_id:'m8'}),/UNIQUE/,'segunda activa del mismo sujeto');
  d.prepare("UPDATE pos_assistant_memory SET state='reemplazada' WHERE memory_id='m1'").run();
  insert(d,{memory_id:'m9',version:2});
  assert.equal(d.prepare("SELECT COUNT(*) n FROM pos_assistant_memory WHERE state='activa' AND subject_ref='P12'").get().n,1);
  assert.throws(()=>d.prepare("UPDATE pos_assistant_memory SET state='borrada' WHERE memory_id='m9'").run(),/CHECK/);
  d.prepare("UPDATE pos_assistant_memory SET state='olvidada',value_json='{}',forgotten_by='abcd1234abcd1234',forgotten_at='2026-10-27' WHERE memory_id='m9'").run();
  assert.equal(d.prepare("SELECT forgotten_by FROM pos_assistant_memory WHERE memory_id='m9'").get().forgotten_by,'abcd1234abcd1234');
  assert.ok(!/business_id/.test(source.replace(/--[^\n]*/g,'')),'un negocio por base: ninguna migracion del repo usa business_id');
});

test('0038 preflight refuses a drifted pos_assistant_memory before any write',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  f.database.exec("CREATE TABLE pos_assistant_memory(memory_id TEXT PRIMARY KEY)");
  await assert.rejects(()=>memory.preflight(adapter(f.database),source),/schema drift: pos_assistant_memory/);
});

test('0038 migration refuses altered source and inactive authority',async(t)=>{
  assert.throws(()=>memory.migrationUnits(source+'\nDELETE FROM sales;'),/hash mismatch/);
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const batch=db.batch;
  db.batch=async statements=>{const out=await batch(statements);if(out[2]?.results?.[0]?.mode)out[2].results[0].mode='SHADOW';return out;};
  await assert.rejects(()=>memory.preflight(db,source),/inactive/);
});

test('0038 backups are authenticated encrypted before upload and reject absent keys',async()=>{
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
  assert.equal(memory.backupPath,'/tmp/turso-migration-0038-backup.json');
});

test('0038 full logical backup covers schema and every table, encrypted with the existing Turso credential',async(t)=>{
  const {createHash,createDecipheriv}=await import('node:crypto');
  const f=await activeCanon(t,{migrations:prior});
  const saved=process.env.TURSO_PROD_AUTH_TOKEN, secret='fixture-only-token-'.repeat(3);
  process.env.TURSO_PROD_AUTH_TOKEN=secret;
  t.after(()=>{if(saved===undefined)delete process.env.TURSO_PROD_AUTH_TOKEN;else process.env.TURSO_PROD_AUTH_TOKEN=saved;});
  await memory.backup(adapter(f.database));
  const packet=JSON.parse(readFileSync(memory.backupPath,'utf8'));
  const key=createHash('sha256').update('nuevo-amanecer-contact-backup-v1\0'+secret).digest();
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));
  d.setAAD(Buffer.from('nuevo-amanecer-contact-backup-v1'));d.setAuthTag(Buffer.from(packet.tag,'base64'));
  const plain=JSON.parse(Buffer.concat([d.update(Buffer.from(packet.data,'base64')),d.final()]));
  assert.equal(plain.format,'nuevo-amanecer-turso-migration-0038-backup-v1');
  const tables=f.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name).sort();
  assert.deepEqual(Object.keys(plain.tables).sort(),tables);
  assert.equal(plain.tables.customers.length,f.database.prepare('SELECT COUNT(*) n FROM customers').get().n);
});
