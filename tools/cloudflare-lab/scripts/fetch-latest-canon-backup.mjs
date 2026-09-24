import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseAndValidateCanonManifest, DEFAULT_CANON_DATABASE_ID } from './canon-backup-manifest.mjs';

const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const token=process.env.R2_CANON_READ_TOKEN;
const bucket=process.env.R2_CANON_BUCKET||'nuevo-amanecer-prod-v2-backups';
const prefix=process.env.R2_CANON_PREFIX||'nuevo-amanecer-prod-v2/';
const expectedDatabaseId=process.env.R2_CANON_DATABASE_ID||DEFAULT_CANON_DATABASE_ID;
if(!account||!token) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID/R2_CANON_READ_TOKEN');

const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/r2/buckets/'+encodeURIComponent(bucket)+'/objects';
const listUrl=new URL(base);
listUrl.searchParams.set('prefix',prefix);
listUrl.searchParams.set('per_page','1000');
const auth={authorization:'Bearer '+token};

const listed=await fetch(listUrl,{headers:auth});
if(!listed.ok) throw new Error('R2 list failed '+listed.status);
const payload=await listed.json();
const rows=Array.isArray(payload.result)?payload.result:[];
const sqls=rows.filter(x=>typeof x?.key==='string'&&x.key.endsWith('.sql')).sort((a,b)=>{
 const ta=Date.parse(a.last_modified||a.lastModified||a.uploaded||'')||0;
 const tb=Date.parse(b.last_modified||b.lastModified||b.uploaded||'')||0;
 return tb-ta||String(b.key).localeCompare(String(a.key));
});
if(!sqls.length) throw new Error('No .sql backup found');
const latest=sqls[0];
const manifestKey=latest.key.replace(/\.sql$/,'.manifest.json');

async function getObject(key){
 const encoded=String(key).split('/').map(encodeURIComponent).join('/');
 const r=await fetch(base+'/'+encoded,{headers:auth});
 if(!r.ok) throw new Error('R2 get failed '+r.status+' '+key);
 return Buffer.from(await r.arrayBuffer());
}
const sql=await getObject(latest.key);
const manifest=await getObject(manifestKey);
const { manifest: parsedManifest, sourceHash } = parseAndValidateCanonManifest({
  raw: manifest,
  sqlKey: latest.key,
  sqlBytes: sql,
  expectedDatabaseId,
});
writeFileSync('/tmp/canon.sql',sql);
writeFileSync('/tmp/canon.manifest.json',manifest);

const meta={
 bucket,
 sql_key:latest.key,
 manifest_key:manifestKey,
 source_ref:'r2://'+bucket+'/'+latest.key,
 source_hash:sourceHash,
 manifest_hash:createHash('sha256').update(manifest).digest('hex'),
 size:sql.length,
 database_id:parsedManifest.database_id,
 bookmark:parsedManifest.bookmark,
 manifest_status:parsedManifest.status,
 manifest_format:parsedManifest.format
};
writeFileSync('/tmp/canon-meta.json',JSON.stringify(meta));
console.log(JSON.stringify(meta));
