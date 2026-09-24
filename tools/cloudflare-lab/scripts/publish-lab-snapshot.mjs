import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

const token=process.env.R2_CANON_READ_TOKEN;
const endpoint=(process.env.LAB_WORKER_URL||'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev').replace(/\/+$/,'');
if(!token) throw new Error('Missing R2_CANON_READ_TOKEN');

const meta=JSON.parse(readFileSync('/tmp/canon-meta.json','utf8'));
const snapshot=JSON.parse(readFileSync('/tmp/lab-snapshot.json','utf8'));
const snapshotRaw=JSON.stringify(snapshot);
const snapshotHash=createHash('sha256').update(snapshotRaw).digest('hex');
const message=[meta.source_ref,meta.source_hash,snapshotHash].join('\n');
const signature=createHmac('sha256',token).update(message).digest('hex');

const body={
 source_ref:meta.source_ref,
 source_hash:meta.source_hash,
 manifest_ref:meta.manifest_key?'r2://'+meta.bucket+'/'+meta.manifest_key:null,
 manifest_hash:meta.manifest_hash,
 snapshot
};
const response=await fetch(endpoint+'/lab/workspace/import-baseline',{
 method:'POST',
 headers:{'content-type':'application/json','x-lab-import-signature':signature},
 body:JSON.stringify(body)
});
const text=await response.text();
console.log(text);
if(!response.ok) throw new Error('LAB baseline import failed '+response.status);
