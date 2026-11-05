import { readFileSync } from 'node:fs';

const MANIFEST_PATH = process.env.PRODUCT_IMAGE_BATCH_PATH || 'ops/product-images/batch-001.json';
const PREPARED_PATH = process.env.PRODUCT_IMAGE_PREPARED_PATH || '/tmp/product-image-batch-001-prepared.json';
const WORKER = process.env.PROD_WORKER_URL || 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
const SECRET = process.env.POS_ACTIVATION_SECRET || '';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';

function requireEnv(){
  if(!SECRET||SECRET.length<12)throw new Error('POS_ACTIVATION_SECRET missing or invalid');
  if(!/^[a-f0-9]{32}$/.test(ACCOUNT)||!TOKEN)throw new Error('Cloudflare credentials missing or invalid');
}
async function json(url,options={}){
  const response=await fetch(url,{redirect:'error',cache:'no-store',...options});
  const body=await response.json().catch(()=>null);
  if(!response.ok||!body)throw new Error(`production Worker request failed ${response.status}`);
  return body;
}
async function d1(sql,params=[]){
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${PROD_DB}/query`,{
    method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({sql,params})
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.success!==true)throw new Error('D1 cleanup failed');
}

async function main(){
  requireEnv();
  const manifest=JSON.parse(readFileSync(MANIFEST_PATH,'utf8'));
  const prepared=JSON.parse(readFileSync(PREPARED_PATH,'utf8'));
  if(!Array.isArray(manifest.entries)||manifest.entries.length!==10||!Array.isArray(prepared.entries)||prepared.entries.length!==10)throw new Error('batch/prepared count invalid');
  const expected=new Map(prepared.entries.map(entry=>[entry.product_name,entry.image]));
  let sessionId='';
  try{
    const activated=await json(`${WORKER}/auth/activate`,{method:'POST',headers:{'x-activation-secret':SECRET}});
    if(typeof activated.session_token!=='string'||!activated.session_token)throw new Error('activation token missing');
    const headers={authorization:`Bearer ${activated.session_token}`};
    const session=await json(`${WORKER}/auth/session`,{headers});
    sessionId=String(session.session_id||'');
    if(!sessionId)throw new Error('session id missing');
    const status=await json(`${WORKER}/read/canonical/status`,{headers});
    if(status.authority!=='canonical'||status.mode!=='ACTIVE')throw new Error('CANON Worker is not ACTIVE');

    let cursor=null;
    const found=new Map();
    do{
      const page=await json(`${WORKER}/read/canonical/products?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{headers});
      if(!Array.isArray(page.items))throw new Error('invalid CANON product page');
      for(const product of page.items){
        if(expected.has(product.name)){
          if(found.has(product.name))throw new Error(`duplicate CANON product ${product.name}`);
          found.set(product.name,product.image??null);
        }
      }
      cursor=page.next_cursor||null;
    }while(cursor);

    for(const [name,image] of expected){
      if(!found.has(name))throw new Error(`CANON product not visible: ${name}`);
      if(found.get(name)!==image)throw new Error(`CANON image mismatch: ${name}`);
    }
    console.log(JSON.stringify({state:'CANON_PRODUCT_IMAGES_WORKER_VERIFY_PASS',batch_id:manifest.batch_id,count:found.size}));
  }finally{
    if(sessionId){
      await d1("UPDATE auth_sessions SET status='revoked' WHERE session_id=?1 AND status='active'",[sessionId]).catch(()=>{});
      await d1("UPDATE devices SET status='revoked' WHERE device_id=?1 AND status='active'",[`session:${sessionId}`]).catch(()=>{});
    }
  }
}
main().catch(error=>{console.error(error?.stack||error?.message||error);process.exit(1);});
