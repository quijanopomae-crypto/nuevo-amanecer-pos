import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildManifest,
  normalizeBackup,
  normalizeWorkbook,
  quarantineA4TestTransactions,
  stableStringify,
  sha256Hex
} from './src/a5-import-core.js';
import { readWorkbookSheets } from './src/a5-workbook.js';
import {
  mapStagingRow,
  A6_MAPPING_VERSION,
  A6_SCHEMA_VERSION,
  a6PolicyHash
} from './src/a6-mapping.js';

const IMPORT='a5-mery43250-2026-09-20-v3';
const PROMO='promotion-a5-mery43250-2026-09-20-v3';
const OP='direct-prod-a5-mery43250-2026-09-20-v3';
const DEVICE='prod-direct-import-20260920';

const JSON_PATH='./private/a5-inputs/ef4fc9a1-7a5e-4f12-a539-7dfe17ebf2bc.json';
const XLSX_PATH='./private/a5-inputs/creditos_clientes_corregido_saldo_298_mery43250_2026-09-20.xlsx';
const BACKUP_PATH='./private/a5-inputs/prod-prefreeze-20260920.sql';
const OUT='./private/a5-inputs/direct-prod-import-20260920.sql';

const EXPECTED={
  products:408,customers:31,credits:313,credit_payments:131,
  sales:0,sale_items:0,cash_movements:0,inventory_movements:0,
  expenses:0,cash_closures:0,
  credit_amount_cents:2968150,
  credit_paid_cents:864462,
  credit_balance_cents:2103688,
  payment_amount_cents:864462,
  sales_total_cents:0,
  known_payment_dates:73,
  unknown_payment_dates:58
};

const EXPECTED_SOURCE='50f73791a6762fbb38357fa0e09de74ef39bcc4fb07fc9ab7a10e941bb482589';
const EXPECTED_MANIFEST='6b3ee021113fc960c5bd8b0663160a037fa9acc106b7745eed4e7e64485b7cde';
const EXPECTED_DIGEST='0c6a87e18de4c35973c7657a4392426a3350c176a6308d086ff747a980789c45';

const TABLES={
  products:['product_id','name','sku','barcode','alternate_codes_json','legacy_alternate_code','category','brand','description','icon','image','unit','purchase_unit','purchase_factor','cost_cents','price_cents','box_price_cents','units_per_box','opening_stock_quantity','current_stock_quantity','stock_revision','stock_min_quantity','expiry_date','includes_igv','tax_type','complementary_tax','tracks_inventory'],
  customers:['customer_id','name','document','phone','address','color','total_purchases_cents','source_image_balance_cents','source_document_balance_cents','source_difference_cents','source_documents_total','source_documents_pending','source_documents_paid','source_payment_count','source_pending_original_cents','source_pending_paid_cents','source_pending_progress_ratio','source_historical_credit_cents','source_historical_paid_cents','source_first_credit_value','source_last_payment_value','source_expected_full_payment_value','source_max_term_days','source_days_until_due','source_status','source_reconciliation'],
  credits:['credit_id','customer_id','sale_id','store','document_number','reference','concept','seller','issued_value','due_value','term_days','original_amount_cents','import_paid_cents','opening_balance_cents','current_balance_cents','source_progress_ratio','source_payment_count','source_days_until_due','source_status','source_customer_image_balance_cents','source_customer_document_balance_cents','source_customer_difference_cents'],
  credit_payments:['payment_id','credit_id','source_payment_id','source_sequence','amount_cents','payment_date','payment_timestamp','payment_date_known','date_precision','method','source_method','source_origin','source_document_type','source_operation_reference','seller','date_observation','source_customer_document','source_customer_name','source_cumulative_paid_cents','source_balance_after_cents','source_progress_ratio','source_credit_original_cents','source_current_document_balance_cents']
};

const ORDER=['products','customers','credits','credit_payments'];

const must=(x,m)=>{if(!x)throw new Error(m)};
const hash=b=>createHash('sha256').update(b).digest('hex');

function sql(v){
  if(v===null||v===undefined)return 'NULL';
  if(typeof v==='number'){
    if(!Number.isFinite(v))throw new Error('non-finite SQL number');
    return String(v);
  }
  if(typeof v==='boolean')return v?'1':'0';
  return `'${String(v).replaceAll("'","''")}'`;
}

function insert(table,row){
  const cols=Object.keys(row);
  return `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(k=>sql(row[k])).join(',')});`;
}

const jsonBytes=await readFile(JSON_PATH);
const xlsxBytes=await readFile(XLSX_PATH);

must(hash(jsonBytes)==='51229f1c1b37ab28a6865ac9935450207a56d5f3a48073c75b9527c5b68e7d8f','JSON source hash mismatch');
must(hash(xlsxBytes)==='cba956295eb2f59eee82eb5551c02b58731bda9ae8756b0e3017c86bf6ae7e39','XLSX source hash mismatch');

const document=JSON.parse(jsonBytes.toString('utf8'));
if(document.integrity!=null){
  must(document.integrity.algorithm==='SHA-256','backup integrity algorithm');
  must(document.integrity.scope==='payload-json','backup integrity scope');
  must(hash(JSON.stringify(document.payload))===document.integrity.value,'backup integrity mismatch');
}

const sources=[
  {name:basename(JSON_PATH),type:'POS_JSON',sha256:hash(jsonBytes),bytes:jsonBytes.length},
  {name:basename(XLSX_PATH),type:'CLIENT_CREDIT_XLSX',sha256:hash(xlsxBytes),bytes:xlsxBytes.length}
];

const rows=[
  ...normalizeBackup(document,basename(JSON_PATH)),
  ...normalizeWorkbook(await readWorkbookSheets(xlsxBytes),basename(XLSX_PATH))
];

const quarantine=quarantineA4TestTransactions(rows,sources);
const manifest=await buildManifest({
  importId:IMPORT,
  sources,
  rows:quarantine.rows,
  exclusions:quarantine.exclusions
});

must(manifest.report.verdict==='PASS','A5 verdict is not PASS');
must(manifest.rows.length===883,'A5 row count is not 883');
must(manifest.source_hash===EXPECTED_SOURCE,'source_hash mismatch');
must(manifest.manifest_hash===EXPECTED_MANIFEST,'manifest_hash mismatch');
must(manifest.transform_version==='a5-v2-date-fidelity-a4-quarantine-v1','transform version mismatch');

for(const k of ['products','customers','credits','credit_payments'])
  must(manifest.report.counts[k]===EXPECTED[k],`count mismatch ${k}`);

for(const k of ['credit_amount_cents','credit_paid_cents','credit_balance_cents','payment_amount_cents','sales_total_cents'])
  must(manifest.report.amounts[k]===EXPECTED[k],`amount mismatch ${k}`);

const paymentSources=manifest.rows.filter(r=>r.entity_type==='credit_payments');
must(paymentSources.filter(r=>r.payload.fecha_conocida===true).length===73,'known dates mismatch');
must(paymentSources.filter(r=>r.payload.fecha_conocida===false).length===58,'unknown dates mismatch');

const staged=manifest.rows.map(r=>({...r,import_id:IMPORT}));
const mapped=[];
for(const row of staged){
  must(ORDER.includes(row.entity_type),`unexpected staged type ${row.entity_type}`);
  mapped.push(await mapStagingRow(row,PROMO));
}

const grouped=Object.fromEntries(ORDER.map(t=>[
  t,
  mapped.filter(x=>x.table===t).sort((a,b)=>{
    const key=TABLES[t][0];
    return String(a.row[key])<String(b.row[key])?-1:String(a.row[key])>String(b.row[key])?1:0;
  })
]));

for(const t of ORDER)must(grouped[t].length===EXPECTED[t],`mapped count mismatch ${t}`);

const digestRows=[];
const entityDigests={};

for(const table of ORDER){
  const entity=[];
  for(const item of grouped[table]){
    const r=item.row;
    const digestRow={
      entity_type:table,
      row:Object.fromEntries(
        [...TABLES[table],'source_name','source_row','source_key','source_payload_hash']
          .map(k=>[k,r[k]??null])
      )
    };
    entity.push(digestRow);
    digestRows.push(digestRow);
  }
  entityDigests[table]=await sha256Hex(stableStringify(entity));
}

const canonicalDigest=await sha256Hex(stableStringify(digestRows));
must(canonicalDigest===EXPECTED_DIGEST,`canonical digest mismatch: ${canonicalDigest}`);

const policyHash=await a6PolicyHash();
const backupBytes=await readFile(BACKUP_PATH);
const workerHash=hash(await readFile('./src/worker.js'));
const clientHash=hash(await readFile('./scripts/a5-migrate.mjs'));
const backupHash=hash(backupBytes);

const operational={
  environment:'local',
  database_id:'5189bf2c-c3ae-4a0a-82c9-547c5ef09181',
  worker_hash:workerHash,
  client_hash:clientHash,
  operator:'direct-d1-approved-a5-20260920',
  backup_hash:backupHash,
  run:{
    import_id:IMPORT,
    source_hash:manifest.source_hash,
    manifest_hash:manifest.manifest_hash,
    transform_version:manifest.transform_version,
    staging_revision:883
  },
  mapping_version:A6_MAPPING_VERSION,
  schema_version:A6_SCHEMA_VERSION,
  policy_hash:policyHash,
  expected:EXPECTED,
  local_pending_count:0,
  local_delta_count:0
};

const operationalJson=stableStringify(operational);
const operationalHash=await sha256Hex(operationalJson);
const requestHash=await sha256Hex(stableStringify({
  operation_id:OP,
  promotion_id:PROMO,
  import_id:IMPORT,
  method:'direct-d1-approved-a5'
}));

const deviceHash=await sha256Hex('prod-direct-import-writer-20260920');

const result={
  status:'COMMITTED',
  operation_id:OP,
  promotion_id:PROMO,
  canonical_digest:canonicalDigest,
  entity_digests:entityDigests,
  counts:{
    products:408,
    customers:31,
    credits:313,
    credit_payments:131,
    sales:0,
    sale_items:0,
    cash_movements:0,
    inventory_movements:0,
    expenses:0,
    cash_closures:0
  },
  amounts:{
    credit_amount_cents:2968150,
    credit_paid_cents:864462,
    credit_balance_cents:2103688,
    payment_amount_cents:864462
  },
  mode:'CANONICAL_READ_ONLY',
  read_only:true,
  revision:2,
  authority_epoch:2
};

const out=[];
out.push('PRAGMA foreign_keys = ON;');

out.push(`INSERT INTO devices(device_id,role,status,credential_hash) VALUES(${sql(DEVICE)},'writer','active',${sql(deviceHash)});`);

out.push(`INSERT INTO import_runs(import_id,source_hash,manifest_hash,transform_version,device_id,status,source_files,sources_json,row_count,report_json,revision)
VALUES(${sql(IMPORT)},${sql(manifest.source_hash)},${sql(manifest.manifest_hash)},${sql(manifest.transform_version)},${sql(DEVICE)},'STAGING',2,${sql(stableStringify(manifest.sources))},883,${sql(stableStringify(manifest.report))},0);`);

for(const r of staged){
  out.push(`INSERT INTO import_staging(import_id,entity_type,source_key,source_name,source_row,payload_json,payload_hash,validation_status)
VALUES(${sql(IMPORT)},${sql(r.entity_type)},${sql(r.source_key)},${sql(r.source_name)},${sql(r.source_row)},${sql(r.payload_json)},${sql(r.payload_hash)},${sql(r.validation_status)});`);
}

out.push(`UPDATE import_runs SET status='PASS' WHERE import_id=${sql(IMPORT)} AND revision=883;`);

out.push(`UPDATE canonical_control
SET mode='FROZEN',revision=revision+1,authority_epoch=authority_epoch+1,writer_device_id=${sql(DEVICE)}
WHERE id=1 AND mode='LEGACY' AND revision=0 AND authority_epoch=0;`);

out.push(`INSERT INTO canonical_promotions(
promotion_id,operation_id,request_hash,import_id,source_hash,manifest_hash,transform_version,
staging_revision,mapping_version,schema_version,policy_hash,control_revision,
operational_manifest_json,operational_manifest_hash,device_id,status,candidate_revision,
previous_promotion_id,previous_mode)
VALUES(
${sql(PROMO)},${sql(OP)},${sql(requestHash)},${sql(IMPORT)},${sql(manifest.source_hash)},
${sql(manifest.manifest_hash)},${sql(manifest.transform_version)},883,
${sql(A6_MAPPING_VERSION)},${sql(A6_SCHEMA_VERSION)},${sql(policyHash)},1,
${sql(operationalJson)},${sql(operationalHash)},${sql(DEVICE)},'PREPARED',0,NULL,'FROZEN'
);`);

for(const table of ORDER)
  for(const item of grouped[table])
    out.push(insert(table,item.row));

out.push(`UPDATE canonical_promotions
SET status='COMMITTED',
sealed_revision=candidate_revision,
canonical_digest=${sql(canonicalDigest)},
result_json=${sql(stableStringify(result))},
committed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE promotion_id=${sql(PROMO)}
AND status='PREPARED'
AND candidate_revision=883;`);

out.push(`UPDATE canonical_control
SET mode='CANONICAL_READ_ONLY',
active_promotion_id=${sql(PROMO)},
revision=revision+1,
authority_epoch=authority_epoch+1
WHERE id=1
AND mode='FROZEN'
AND revision=1
AND authority_epoch=1
AND first_live_operation_id IS NULL;`);

out.push(`INSERT INTO canonical_assertions(assertion_id,ok)
SELECT 'direct-prod-final',
CASE WHEN
  (SELECT mode FROM canonical_control WHERE id=1)='CANONICAL_READ_ONLY'
  AND (SELECT active_promotion_id FROM canonical_control WHERE id=1)=${sql(PROMO)}
  AND (SELECT first_live_operation_id FROM canonical_control WHERE id=1) IS NULL
  AND (SELECT status FROM canonical_promotions WHERE promotion_id=${sql(PROMO)})='COMMITTED'
  AND (SELECT canonical_digest FROM canonical_promotions WHERE promotion_id=${sql(PROMO)})=${sql(canonicalDigest)}
  AND (SELECT COUNT(*) FROM products WHERE promotion_id=${sql(PROMO)})=408
  AND (SELECT COUNT(*) FROM customers WHERE promotion_id=${sql(PROMO)})=31
  AND (SELECT COUNT(*) FROM credits WHERE promotion_id=${sql(PROMO)})=313
  AND (SELECT COUNT(*) FROM credit_payments WHERE promotion_id=${sql(PROMO)})=131
  AND (SELECT SUM(original_amount_cents) FROM credits WHERE promotion_id=${sql(PROMO)})=2968150
  AND (SELECT SUM(import_paid_cents) FROM credits WHERE promotion_id=${sql(PROMO)})=864462
  AND (SELECT SUM(current_balance_cents) FROM credits WHERE promotion_id=${sql(PROMO)})=2103688
  AND (SELECT SUM(amount_cents) FROM credit_payments WHERE promotion_id=${sql(PROMO)})=864462
  AND (SELECT COUNT(*) FROM credit_payments WHERE promotion_id=${sql(PROMO)} AND payment_date_known=1)=73
  AND (SELECT COUNT(*) FROM credit_payments WHERE promotion_id=${sql(PROMO)} AND payment_date_known=0)=58
  AND (SELECT status FROM import_runs WHERE import_id=${sql(IMPORT)})='PASS'
  AND (SELECT revision FROM import_runs WHERE import_id=${sql(IMPORT)})=883
THEN 1 ELSE 0 END;`);

out.push(`DELETE FROM canonical_assertions WHERE assertion_id='direct-prod-final';`);
out.push(`UPDATE devices SET status='revoked' WHERE device_id=${sql(DEVICE)};`);

await writeFile(OUT,out.join('\n')+'\n');

console.log('SQL_READY');
console.log('rows=883');
console.log('products=408 customers=31 credits=313 payments=131');
console.log('canonical_digest='+canonicalDigest);