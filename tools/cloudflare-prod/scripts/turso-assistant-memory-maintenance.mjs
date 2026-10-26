import { backupSelectSql } from './backup-select.mjs';
// Maintenance for migration 0038 (permanent business memory of the assistant: table pos_assistant_memory).
// BORRADOR: the SQL still lives in infra/database/borradores/ until A3 numbers it. At numbering time change migrationPath and migrationHash (see the report).
// Run only by an owner-authorized ops workflow (canon-migration-0038.yml, NOT included in this patch).
// Commands: preflight (read-only) | backup | migrate | verify.
// The migration is additive: one CREATE TABLE IF NOT EXISTS and two CREATE INDEX IF NOT EXISTS. No existing row is changed;
// a retry never overwrites an existing object.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { TursoD1Adapter } from '../../cloudflare-lab/src/turso-d1-adapter.js';
import { healthy, encryptBackup } from './turso-customer-contacts-maintenance.mjs';

export const migrationPath='infra/database/borradores/0038_BORRADOR_pos_assistant_memory.sql';
export const migrationHash='be796976d6f88af253d9ea24ac4a4d78e7caf3eabcf47e187aabc48d12ca710f';
export const backupPath='/tmp/turso-migration-0038-backup.json';
const noComments=s=>s.replace(/--[^\n]*/g,'');
export function migrationUnits(source){
  if(createHash('sha256').update(source).digest('hex')!==migrationHash)throw new Error('migration 0038 hash mismatch');
  const units=source.replace(/\r\n/g,'\n').split(/;\s*\n(?=(?:\s*--[^\n]*\n)*\s*CREATE)/i).map(s=>s.trim()).filter(Boolean).map(s=>s.endsWith(';')?s:s+';');
  if(units.length!==3)throw new Error('migration 0038 statement count mismatch');
  if(units.some(s=>!/^CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS /i.test(noComments(s).trim())))throw new Error('migration must contain only additive DDL');
  if(/\b(?:DROP|DELETE|UPDATE|INSERT|ALTER)\b/i.test(noComments(source)))throw new Error('migration must contain only additive DDL');
  return units;
}
function objects(units){
  return units.map(s=>{
    const m=noComments(s).match(/CREATE (?:UNIQUE )?(TABLE|INDEX) IF NOT EXISTS (\w+)/i);
    return {type:m[1].toLowerCase(),name:m[2]};
  });
}
const canonical=s=>s.replace(/--[^\n]*/g,'').replace(/\bIF NOT EXISTS\s*/gi,'').replace(/\s+/g,'').replace(/;$/,'').toLowerCase();
async function currentSql(db,names){
  const results=await db.batch(names.map(n=>db.prepare('SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2').bind(n.type,n.name)));
  return results.map(r=>r.results[0]?.sql||null);
}
// Read-only: any object already present must be equivalent (IF NOT EXISTS would silently keep a different definition).
// The migration references no other table, so nothing else is required.
export async function preflight(db,source){
  await healthy(db);
  const units=migrationUnits(source);
  const names=objects(units);
  const sql=await currentSql(db,names);
  const present=sql.filter(Boolean).length;
  const drift=names.filter((n,i)=>sql[i]&&canonical(sql[i])!==canonical(units[i])).map(n=>n.name);
  if(drift.length)throw new Error('schema drift: '+drift.join(','));
  const report={state:'ASSISTANT_MEMORY_PREFLIGHT',objects:names.length,already_present:present};
  console.log(JSON.stringify(report));
  return report;
}
export async function verify(db,source){
  const units=migrationUnits(source);
  const names=objects(units);
  const sql=await currentSql(db,names);
  for(let i=0;i<names.length;i++)if(canonical(sql[i]||'')!==canonical(units[i]))throw new Error('schema mismatch: '+names[i].name);
  await healthy(db);
  console.log('TURSO_ASSISTANT_MEMORY_SCHEMA_PASS objects='+names.length);
}
// Full consistent logical backup (schema + every table, one read transaction), encrypted
// before it leaves the runner. Taken before 0038 is applied.
export async function backup(db){
  await healthy(db);
  const schema=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results;
  const names=schema.filter(s=>s.type==='table').map(s=>s.name);
  const rows=await db.batch(names.map(n=>db.prepare(backupSelectSql(n))));
  const tables=Object.fromEntries(names.map((n,i)=>[n,rows[i].results]));
  const bytes=Buffer.from(JSON.stringify({format:'nuevo-amanecer-turso-migration-0038-backup-v1',created_at:new Date().toISOString(),schema,tables}));
  const encrypted=encryptBackup(bytes,process.env.TURSO_PROD_AUTH_TOKEN);
  writeFileSync(backupPath,encrypted,{mode:0o600});
  console.log(JSON.stringify({state:'TURSO_MIGRATION_0038_BACKUP_READY',tables:names.length,size_bytes:encrypted.length,sha256:createHash('sha256').update(encrypted).digest('hex')}));
}
export async function main(){
  const db=new TursoD1Adapter({url:process.env.TURSO_PROD_DATABASE_URL,authToken:process.env.TURSO_PROD_AUTH_TOKEN});
  const source=readFileSync(migrationPath,'utf8');
  const command=process.argv[2];
  if(command==='preflight')return preflight(db,source);
  if(command==='backup')return backup(db);
  if(command==='verify')return verify(db,source);
  if(command==='migrate'){
    await preflight(db,source);
    // One atomic batch; a retry creates missing objects and never overwrites existing ones.
    await db.batch(migrationUnits(source).map(sql=>db.prepare(sql)));
    await verify(db,source);
    console.log('MIGRATION_0038_APPLIED_OR_ALREADY_PRESENT');
    return;
  }
  throw new Error('unknown command');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
