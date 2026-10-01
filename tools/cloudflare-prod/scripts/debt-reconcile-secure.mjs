import { readFileSync } from 'node:fs';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const TRIGGER_PATH = 'ops/v1.3-prod-debt-reconcile-trigger.json';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const PROD_DB = process.env.PROD_DATABASE_ID || 'cf2c83d3-f187-472e-967b-0ad24be969eb';
const POS_SECRET = process.env.POS_ACTIVATION_SECRET || '';
const EXPECTED_COUNT = 29;
const EXPECTED_TOTAL_CENTS = 2368495;
const PRIVATE_AAD = Buffer.from('nuevo-amanecer-debt-reconcile-private-v1');
const PAYLOAD_AAD = Buffer.from('nuevo-amanecer-debt-reconcile-payload-v1');

function b64(buf) { return Buffer.from(buf).toString('base64'); }
function unb64(value) {
  if (typeof value !== 'string' || !value) throw new Error('invalid base64 field');
  return Buffer.from(value, 'base64');
}
function requireOwnerSecret() {
  if (!POS_SECRET || POS_SECRET.length < 12) throw new Error('POS_ACTIVATION_SECRET missing or invalid');
}
function privateSealKey() {
  requireOwnerSecret();
  return createHash('sha256')
    .update('nuevo-amanecer-debt-reconcile-private-key-v1\0')
    .update(POS_SECRET)
    .digest();
}
function sealPrivate(privateDer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', privateSealKey(), iv);
  cipher.setAAD(PRIVATE_AAD);
  const ciphertext = Buffer.concat([cipher.update(privateDer), cipher.final()]);
  return { iv_b64:b64(iv), tag_b64:b64(cipher.getAuthTag()), ciphertext_b64:b64(ciphertext) };
}
function openPrivate(sealed) {
  const decipher = createDecipheriv('aes-256-gcm', privateSealKey(), unb64(sealed.iv_b64));
  decipher.setAAD(PRIVATE_AAD);
  decipher.setAuthTag(unb64(sealed.tag_b64));
  return Buffer.concat([decipher.update(unb64(sealed.ciphertext_b64)), decipher.final()]);
}
function payloadKey(privateKey, publicSpkiB64, ephemeralSpkiB64) {
  const ephemeral = createPublicKey({ key:unb64(ephemeralSpkiB64), format:'der', type:'spki' });
  const shared = diffieHellman({ privateKey, publicKey:ephemeral });
  const salt = createHash('sha256')
    .update(unb64(publicSpkiB64))
    .update(unb64(ephemeralSpkiB64))
    .digest();
  return Buffer.from(hkdfSync(
    'sha256',
    shared,
    salt,
    Buffer.from('nuevo-amanecer-debt-reconcile-payload-key-v1'),
    32
  ));
}
function openPayload(trigger) {
  if (!trigger.key_material || !trigger.payload) throw new Error('missing secure payload');
  const privateDer = openPrivate(trigger.key_material.sealed_private);
  const privateKey = createPrivateKey({ key:privateDer, format:'der', type:'pkcs8' });
  const key = payloadKey(
    privateKey,
    trigger.key_material.public_spki_b64,
    trigger.payload.ephemeral_spki_b64
  );
  const decipher = createDecipheriv('aes-256-gcm', key, unb64(trigger.payload.iv_b64));
  decipher.setAAD(PAYLOAD_AAD);
  decipher.setAuthTag(unb64(trigger.payload.tag_b64));
  const plaintext = Buffer.concat([
    decipher.update(unb64(trigger.payload.ciphertext_b64)),
    decipher.final()
  ]).toString('utf8');
  return JSON.parse(plaintext);
}
function validateTargets(payload) {
  if (!payload || payload.format !== 'casamarket-customer-debt-target-v1' || !Array.isArray(payload.rows)) {
    throw new Error('invalid target payload');
  }
  if (payload.rows.length !== EXPECTED_COUNT) throw new Error('target row count mismatch');
  const seen = new Set();
  let total = 0;
  payload.rows.forEach((row,index) => {
    if (!row || typeof row.document !== 'string' || !/^\d{8}$/.test(row.document)) {
      throw new Error('invalid target document at index '+(index+1));
    }
    if (typeof row.name !== 'string' || row.name.trim().length < 1 || row.name.trim().length > 240) {
      throw new Error('invalid target name at index '+(index+1));
    }
    if (!Number.isSafeInteger(row.target_cents) || row.target_cents < 0) {
      throw new Error('invalid target cents at index '+(index+1));
    }
    if (seen.has(row.document)) throw new Error('duplicate target document');
    seen.add(row.document);
    total += row.target_cents;
  });
  if (total !== EXPECTED_TOTAL_CENTS) throw new Error('target total mismatch');
  return payload.rows;
}
function requireCloudflare() {
  if (!/^[a-f0-9]{32}$/.test(ACCOUNT)) throw new Error('invalid CLOUDFLARE_ACCOUNT_ID');
  if (!TOKEN) throw new Error('missing CLOUDFLARE_API_TOKEN');
}
async function cfQuery(sql,params=[]) {
  requireCloudflare();
  const response = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+PROD_DB+'/query',
    {
      method:'POST',
      headers:{ authorization:'Bearer '+TOKEN, 'content-type':'application/json' },
      body:JSON.stringify({ sql, params })
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    const detail = body?.errors?.map(x => x?.message).filter(Boolean).join('; ') || 'unknown';
    throw new Error('Cloudflare D1 query failed '+response.status+': '+detail);
  }
  const first = Array.isArray(body.result) ? body.result[0] : body.result;
  if (!first || first.success === false) throw new Error('Cloudflare D1 query returned failure');
  return Array.isArray(first.results) ? first.results : [];
}
function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu,'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .trim()
    .replace(/\s+/g,' ');
}

async function inspect(rows) {
  const control = (await cfQuery(
    "SELECT mode,active_promotion_id,revision,authority_epoch,minimum_client_contract FROM canonical_control WHERE id=1"
  ))[0];
  if (!control || control.mode !== 'ACTIVE' || !control.active_promotion_id) {
    throw new Error('production CANON is not ACTIVE');
  }

  const sql = `
    WITH identity AS (
      SELECT customer_id,trim(document) AS document,name,'IMPORT' AS customer_provenance
      FROM customers WHERE promotion_id=?1
      UNION ALL
      SELECT customer_id,trim(document) AS document,name,'LIVE' AS customer_provenance
      FROM canonical_live_customers WHERE promotion_id=?1
    ),
    credit_map AS (
      SELECT promotion_id,customer_id,credit_id,'IMPORT' AS credit_provenance FROM credits
      UNION ALL
      SELECT promotion_id,customer_id,credit_id,'LIVE' AS credit_provenance FROM live_credits
    ),
    agg AS (
      SELECT m.customer_id,
        COUNT(*) AS credit_count,
        SUM(CASE WHEN m.credit_provenance='IMPORT' THEN 1 ELSE 0 END) AS import_credits,
        SUM(CASE WHEN m.credit_provenance='LIVE' THEN 1 ELSE 0 END) AS live_credits,
        COALESCE(SUM(b.opening_balance_cents),0) AS opening_cents,
        COALESCE(SUM(b.current_balance_cents),0) AS current_cents
      FROM credit_map m
      JOIN canonical_credit_balances b
        ON b.promotion_id=m.promotion_id
       AND b.credit_id=m.credit_id
       AND b.provenance=m.credit_provenance
      WHERE m.promotion_id=?1
      GROUP BY m.customer_id
    )
    SELECT i.customer_id,i.document,i.name,i.customer_provenance,
      COALESCE(a.credit_count,0) AS credit_count,
      COALESCE(a.import_credits,0) AS import_credits,
      COALESCE(a.live_credits,0) AS live_credits,
      COALESCE(a.opening_cents,0) AS opening_cents,
      COALESCE(a.current_cents,0) AS current_cents
    FROM identity i
    LEFT JOIN agg a ON a.customer_id=i.customer_id
    ORDER BY i.customer_id`;

  const found = await cfQuery(sql,[control.active_promotion_id]);
  const byDoc = new Map();
  const byName = new Map();
  for (const row of found) {
    const document = String(row.document || '').trim();
    if (document) {
      const list = byDoc.get(document) || [];
      list.push(row);
      byDoc.set(document,list);
    }
    const nameKey = normalizeName(row.name);
    if (nameKey) {
      const list = byName.get(nameKey) || [];
      list.push(row);
      byName.set(nameKey,list);
    }
  }

  const sanitized = [];
  let currentTotal = 0, openingTotal = 0, targetTotal = 0;
  for (let index=0; index<rows.length; index++) {
    const target = rows[index];
    const docMatches = byDoc.get(target.document) || [];
    const nameMatches = byName.get(normalizeName(target.name)) || [];
    let matches = docMatches;
    let matchedBy = 'document';
    if (matches.length === 0) {
      matches = nameMatches;
      matchedBy = 'name';
    }
    if (matches.length !== 1) {
      throw new Error('target identity match count at index '+(index+1)+' is '+matches.length);
    }
    const match = matches[0];
    if (docMatches.length === 1 && nameMatches.length === 1 && docMatches[0].customer_id !== nameMatches[0].customer_id) {
      throw new Error('target identity disagreement at index '+(index+1));
    }
    const current = Number(match.current_cents||0);
    const opening = Number(match.opening_cents||0);
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(opening)) {
      throw new Error('invalid canonical cents at index '+(index+1));
    }
    currentTotal += current;
    openingTotal += opening;
    targetTotal += target.target_cents;
    sanitized.push({
      index:index+1,
      current_cents:current,
      target_cents:target.target_cents,
      delta_cents:target.target_cents-current,
      opening_cents:opening,
      credit_count:Number(match.credit_count||0),
      import_credits:Number(match.import_credits||0),
      live_credits:Number(match.live_credits||0),
      target_within_opening:target.target_cents<=opening,
      matched_by:matchedBy
    });
  }

  const global = (await cfQuery(
    "SELECT COALESCE(SUM(current_balance_cents),0) total_current_cents,"+
    "COALESCE(SUM(opening_balance_cents),0) total_opening_cents,"+
    "COUNT(*) credit_count FROM canonical_credit_balances WHERE promotion_id=?1",
    [control.active_promotion_id]
  ))[0] || {};

  console.log('DEBT_RECONCILE_INSPECT='+JSON.stringify({
    state:'INSPECT_PASS',
    target_count:rows.length,
    target_total_cents:targetTotal,
    matched_current_total_cents:currentTotal,
    matched_opening_total_cents:openingTotal,
    global_current_total_cents:Number(global.total_current_cents||0),
    global_opening_total_cents:Number(global.total_opening_cents||0),
    global_credit_count:Number(global.credit_count||0),
    control_revision:Number(control.revision),
    authority_epoch:Number(control.authority_epoch),
    rows:sanitized
  }));
}
async function main() {
  const trigger = JSON.parse(readFileSync(TRIGGER_PATH,'utf8'));
  if (trigger.authorized !== true || trigger.authorized_by !== 'owner') {
    throw new Error('owner authorization missing');
  }
  if (trigger.target_count !== EXPECTED_COUNT || trigger.target_total_cents !== EXPECTED_TOTAL_CENTS) {
    throw new Error('trigger target invariant mismatch');
  }

  if (trigger.mode === 'prepare-key') {
    requireOwnerSecret();
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    const publicDer = publicKey.export({ format:'der', type:'spki' });
    const privateDer = privateKey.export({ format:'der', type:'pkcs8' });
    const material = {
      public_spki_b64:b64(publicDer),
      sealed_private:sealPrivate(privateDer)
    };
    console.log(
      'SECURE_DEBT_KEY_MATERIAL='+
      Buffer.from(JSON.stringify(material)).toString('base64url')
    );
    return;
  }

  if (trigger.mode === 'inspect') {
    const rows = validateTargets(openPayload(trigger));
    await inspect(rows);
    return;
  }

  throw new Error('unsupported reconciliation mode');
}
main().catch(error => {
  console.error('DEBT_RECONCILE_FAIL='+String(error?.message||error));
  process.exit(1);
});
