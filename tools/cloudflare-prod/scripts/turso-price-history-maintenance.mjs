import { backupSelectSql } from './backup-select.mjs';
// Maintenance for migration 0034 (price_history, Misión 3 / #857).
// Run only by the owner-authorized ops workflow canon-migration-0034.yml.
// Commands: preflight (read-only) | backup | migrate | verify.
// Additive: one CREATE TABLE IF NOT EXISTS plus three CREATE [UNIQUE] INDEX IF NOT EXISTS. No existing row changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { TursoD1Adapter } from '../../cloudflare-lab/src/turso-d1-adapter.js';
import { healthy, encryptBackup } from './turso-customer-contacts-maintenance.mjs';

export const migrationPath='infra/database/migrations/0034_price_history.sql';
export const migrationHash='9ae36d254d6f093c9d2c221db207a5f1bc15ce2e114968357f0ae12cb26a6520';
export const backupPath='/tmp/turso-migration-0034-backup.json';
export function migrationUnits(source){
  if(createHash('sha256').update(source).digest('hex')!==migrationHash)throw new Error('migration 0034 hash mismatch');
  const units=source.replace(/\r\n/g,'\n').replace(/^--[^\n]*\n/gm,'').split(/;\s*\n/).map(s=>s.trim()).filter(Boolean).map(s=>s.endsWith(';')?s:s+';');
  if(units.length!==4)throw new Error('migration 0034 statement count mismatch');
  if(units.some(s=>!/^CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS /i.test(s)))throw new Error('migration must contain only additive DDL');
  return units;
}
function objects(units){ return units.map(s=>{ const m=s.match(/CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS (\w+)/i); return {type:/TABLE/i.test(m[1])?'table':'index',name:m[2]}; }); }
const canonical=s=>s.replace(/--[^\n]*/g,'').replace(/\bIF NOT EXISTS\s*/gi,'').replace(/\s+/g,'').replace(/;$/,'').toLowerCase();
async function currentSql(db,names){
  const results=await db.batch(names.map(n=>db.prepare('SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2').bind(n.type,n.name)));
  return results.map(r=>r.results[0]?.sql||null);
}
export async function preflight(db,source){
  await healthy(db);
  const units=migrationUnits(source), names=objects(units), sql=await currentSql(db,names);
  const drift=names.filter((n,i)=>sql[i]&&canonical(sql[i])!==canonical(units[i])).map(n=>n.name);
  if(drift.length)throw new Error('schema drift: '+drift.join(','));
  const report={state:'PRICE_HISTORY_PREFLIGHT',objects:names.length,already_present:sql.filter(Boolean).length};
  console.log(JSON.stringify(report));
  return report;
}
export async function verify(db,source){
  const units=migrationUnits(source), names=objects(units), sql=await currentSql(db,names);
  for(let i=0;i<names.length;i++)if(canonical(sql[i]||'')!==canonical(units[i]))throw new Error('schema mismatch: '+names[i].name);
  await healthy(db);
  console.log('TURSO_PRICE_HISTORY_SCHEMA_PASS objects='+names.length);
}
export async function backup(db){
  await healthy(db);
  const schema=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results;
  const names=schema.filter(s=>s.type==='table').map(s=>s.name);
  const rows=await db.batch(names.map(n=>db.prepare(backupSelectSql(n))));
  const tables=Object.fromEntries(names.map((n,i)=>[n,rows[i].results]));
  const bytes=Buffer.from(JSON.stringify({format:'nuevo-amanecer-turso-migration-0034-backup-v1',created_at:new Date().toISOString(),schema,tables}));
  const encrypted=encryptBackup(bytes,process.env.TURSO_PROD_AUTH_TOKEN);
  writeFileSync(backupPath,encrypted,{mode:0o600});
  console.log(JSON.stringify({state:'TURSO_MIGRATION_0034_BACKUP_READY',tables:names.length,size_bytes:encrypted.length,sha256:createHash('sha256').update(encrypted).digest('hex')}));
}
export async function migrate(db,source){
  await preflight(db,source);
  // One atomic batch; a retry creates missing objects and never overwrites existing ones.
  await db.batch(migrationUnits(source).map(sql=>db.prepare(sql)));
  await verify(db,source);
  console.log('MIGRATION_0034_APPLIED_OR_ALREADY_PRESENT');
}
export async function main(){
  const db=new TursoD1Adapter({url:process.env.TURSO_PROD_DATABASE_URL,authToken:process.env.TURSO_PROD_AUTH_TOKEN});
  const source=readFileSync(migrationPath,'utf8');
  const command=process.argv[2];
  if(command==='preflight')return preflight(db,source);
  if(command==='backup')return backup(db);
  if(command==='verify')return verify(db,source);
  if(command==='migrate')return migrate(db,source);
  throw new Error('unknown command');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
