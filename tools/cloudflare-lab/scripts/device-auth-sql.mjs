import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Offline SQL preparation only. Never sends credentials as Wrangler arguments.
export function deviceAuthSql(action, env) {
  const id = env.DEVICE_ID;
  if (typeof id !== 'string' || !id || id.length > 160 || /[\x00-\x1f\x7f]/.test(id)) throw new Error('Invalid DEVICE_ID');
  const quotedId = "'" + id.replaceAll("'", "''") + "'";
  if (action === 'revoke') return `UPDATE devices SET status = 'revoked' WHERE device_id = ${quotedId};`;
  if (action !== 'register' || !['writer', 'read_only'].includes(env.DEVICE_ROLE)) throw new Error('Expected register/revoke and DEVICE_ROLE writer/read_only');
  const credential = env.DEVICE_CREDENTIAL;
  const pepper = env.DEVICE_CREDENTIAL_PEPPER;
  if (!/^[a-f0-9]{64}$/.test(credential || '') || !/^[a-f0-9]{64}$/.test(pepper || '') || credential === pepper || credential === env.READ_TOKEN) {
    throw new Error('Use distinct random 32-byte lowercase hex credential and pepper');
  }
  const hash = createHmac('sha256', pepper).update(credential).digest('hex');
  return `INSERT INTO devices (device_id, role, status, credential_hash) VALUES (${quotedId}, '${env.DEVICE_ROLE}', 'active', '${hash}');`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(deviceAuthSql(process.argv[2], process.env)); }
  catch { console.error('Device SQL rejected: check action, DEVICE_ID, DEVICE_ROLE and distinct random hex secrets.'); process.exitCode = 1; }
}
