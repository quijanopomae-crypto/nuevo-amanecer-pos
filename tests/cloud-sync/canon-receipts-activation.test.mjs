import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activeCanon} from './canon-browser-harness.mjs';
import {migrationPath,migrationUnits,verify,healthy,encryptBackup} from '../../tools/cloudflare-prod/scripts/turso-customer-contacts-maintenance.mjs';
const source=readFileSync(migrationPath,'utf8');
const prior=['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql','0017_canonical_live_customers.sql','0018_canonical_customer_credit_policy.sql'];
function adapter(database){
  return {prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;}};},async batch(statements){return statements.map(s=>({results:database.prepare(s.sql).all(...s.args)}));}};
}
test('migration splitter preserves full triggers; additive retry retains ledgers and exact schema',async(t)=>{
  const f=await activeCanon(t,{migrations:prior});
  const before=f.counts();
  const units=migrationUnits(source);
  f.database.exec('BEGIN');
  for(const sql of units)f.database.exec(sql);
  f.database.exec('COMMIT');
  assert.deepEqual(f.counts(),before);
  await verify(adapter(f.database),source);
  for(const sql of units)f.database.exec(sql);
  await verify(adapter(f.database),source);
  assert.deepEqual(f.counts(),before);
  f.database.exec('DROP TRIGGER customer_contact_no_delete');
  await assert.rejects(()=>verify(adapter(f.database),source),/schema mismatch/);
  f.database.exec(units.find(s=>s.includes('CREATE TRIGGER IF NOT EXISTS customer_contact_no_delete')));
  await verify(adapter(f.database),source);
});
test('activation refuses altered migration and inactive authority',async(t)=>{
  assert.throws(()=>migrationUnits(source+'\nDELETE FROM sales;'),/hash mismatch/);
  const f=await activeCanon(t,{migrations:prior});
  const db=adapter(f.database);
  const batch=db.batch;
  db.batch=async statements=>{const out=await batch(statements);out[2].results[0].mode='SHADOW';return out;};
  await assert.rejects(()=>healthy(db),/inactive/);
});

test('backups are authenticated encrypted before upload and reject absent keys',async()=>{
  const {createHash,createDecipheriv}=await import('node:crypto');
  const secret='test-only-secret-'.repeat(4), plain=Buffer.from('{"customer":"private contact"}');
  const out=encryptBackup(plain,secret);
  assert.ok(!out.toString().includes('private contact'));
  assert.throws(()=>encryptBackup(plain,''),/secret/);
  const packet=JSON.parse(out);
  const key=createHash('sha256').update('nuevo-amanecer-contact-backup-v1\0'+secret).digest();
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(packet.iv,'base64'));
  decipher.setAAD(Buffer.from('nuevo-amanecer-contact-backup-v1'));
  decipher.setAuthTag(Buffer.from(packet.tag,'base64'));
  assert.deepEqual(Buffer.concat([decipher.update(Buffer.from(packet.data,'base64')),decipher.final()]),plain);
});

test('workflow refresh preserves ancestry needed to validate approved feature commit',async(t)=>{
  const {mkdtempSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {execFileSync,spawnSync}=await import('node:child_process');
  const root=mkdtempSync(join(tmpdir(),'receipt-history-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const origin=join(root,'origin'),clone=join(root,'clone');
  const git=(cwd,...args)=>execFileSync('git',args,{cwd,stdio:['ignore','pipe','pipe']}).toString().trim();
  git(root,'init','--initial-branch=feature/v1.3-mobile-cloud',origin);
  git(origin,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','approved feature');
  const feature=git(origin,'rev-parse','HEAD');
  git(origin,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','activation');
  git(root,'clone','file://'+origin,clone);
  const workflow=readFileSync('.github/workflows/canon-whatsapp-receipts-activation.yml','utf8');
  const fetch=workflow.split('\n').find(line=>line.trim().startsWith('git fetch origin ')).trim().split(/\s+/).slice(1);
  git(clone,...fetch);
  const out=spawnSync('git',['merge-base','--is-ancestor',feature,'HEAD'],{cwd:clone});
  assert.equal(out.status,0,'refresh must retain feature ancestry');
});
