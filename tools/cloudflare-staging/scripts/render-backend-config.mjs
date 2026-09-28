import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const id = String(process.env.STAGING_D1_DATABASE_ID || '').trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
  throw new Error('invalid STAGING_D1_DATABASE_ID');
}
const root = resolve(import.meta.dirname, '..');
const template = resolve(root, 'wrangler.backend.template.jsonc');
const output = resolve(root, 'wrangler.backend.generated.jsonc');
const source = readFileSync(template, 'utf8');
if (!source.includes('__STAGING_D1_DATABASE_ID__')) throw new Error('staging D1 placeholder missing');
const rendered = source.replaceAll('__STAGING_D1_DATABASE_ID__', id);
for (const forbidden of [
  'cf2c83d3-f187-472e-967b-0ad24be969eb',
  'e734e6f1-41c4-4bfa-ab1f-5acbcdd2272e',
  'nuevo-amanecer-prod-v2',
  'nuevo-amanecer-prod-v2-backups',
  'nuevo-amanecer-lab',
  'nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev'
]) {
  if (rendered.includes(forbidden)) throw new Error('forbidden non-staging resource in rendered config: ' + forbidden);
}
const parsed = JSON.parse(rendered);
if (parsed.name !== 'nuevo-amanecer-pos-staging') throw new Error('unexpected staging worker name');
if (parsed.vars?.RUNTIME_ENVIRONMENT !== 'staging') throw new Error('staging runtime identity missing');
if (parsed.vars?.DATA_POLICY !== 'synthetic-only') throw new Error('staging synthetic-only policy missing');
if (parsed.d1_databases?.length !== 1 ||
    parsed.d1_databases[0].binding !== 'DB' ||
    parsed.d1_databases[0].database_name !== 'nuevo-amanecer-staging' ||
    parsed.d1_databases[0].database_id !== id) {
  throw new Error('rendered staging D1 contract mismatch');
}
writeFileSync(output, rendered);
console.log(JSON.stringify({ status:'STAGING_BACKEND_CONFIG_RENDERED', database_id:id, output }));
