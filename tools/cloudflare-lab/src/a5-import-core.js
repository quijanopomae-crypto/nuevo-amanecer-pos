const TYPES = new Set(['products', 'sales', 'customers', 'credits', 'credit_payments', 'expenses', 'cash_movements', 'cash_closures', 'inventory_movements']);
export const A5_TRANSFORM_VERSION = 'a5-v1';

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function sha256Hex(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function issue(code, entityType, sourceKey, details, severity = 'ERROR') {
  return { severity, code, entity_type: entityType || null, source_key: sourceKey || null, details };
}

function cents(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number >= 0 && Number.isSafeInteger(Math.round(number * 100)) ? Math.round(number * 100) : null;
}

function signedCents(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && Number.isSafeInteger(Math.round(number * 100)) ? Math.round(number * 100) : null;
}

function id(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const result = String(value).trim();
  return result && result.length <= 160 && !/[\x00-\x1f\x7f]/.test(result) ? result : null;
}

function date(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw) return raw;
  const match = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return null;
  const normalized = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return new Date(`${normalized}T00:00:00Z`).toISOString().slice(0, 10) === normalized ? normalized : null;
}

function normalizedKeys(raw) {
  const out = {};
  for (const [key, value] of Object.entries(cleanObject(raw))) {
    const normalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    out[normalized] = value;
  }
  return out;
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record must be an object');
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('dangerous property');
    if (item !== undefined) out[key] = item;
  }
  return out;
}

function normalizeCustomer(raw) {
  const original = cleanObject(raw);
  const source = normalizedKeys(original);
  const customerId = id(source.id ?? source.cliente_id ?? source.clienteid);
  const name = String(source.nombre ?? source.name ?? '').trim();
  if (!customerId || !name) throw new Error('customer requires id and nombre');
  return { ...original, id: customerId, nombre: name };
}

function normalizeCredit(raw) {
  const original = cleanObject(raw);
  const source = normalizedKeys(original);
  const creditId = id(source.id ?? source.credito_id ?? source.creditoid);
  const customerId = id(source.cli_id ?? source.cliid ?? source.cliente_id ?? source.clienteid);
  const amountCents = cents(source.monto ?? source.importe);
  const paidCents = cents(source.pagado);
  const balanceCents = cents(source.saldo);
  if (!creditId || !customerId || amountCents === null || paidCents === null || balanceCents === null) throw new Error('credit requires id, customer and non-negative amounts');
  return { ...original, id: creditId, cliente_id: customerId, monto_cents: amountCents, pagado_cents: paidCents, saldo_cents: balanceCents };
}

function normalizePayment(raw, fallbackCreditId = null) {
  const original = cleanObject(raw);
  const source = normalizedKeys(original);
  const creditId = id(source.credito_id ?? source.creditoid ?? fallbackCreditId);
  const amountCents = cents(source.monto ?? source.monto_pagado ?? source.montopagado ?? source.importe);
  const paymentId = id(source.id ?? source.pago_id ?? source.pagoid);
  if (!paymentId || !creditId || amountCents === null || amountCents <= 0) throw new Error('payment requires credit, identity and positive amount');
  const rawDate = source.fecha ?? source.date ?? null;
  const knownDate = date(rawDate);
  if (rawDate !== null && rawDate !== undefined && String(rawDate).trim() && !knownDate) throw new Error('payment date is invalid');
  return { ...original, id: paymentId, credito_id: creditId, monto_cents: amountCents, fecha: knownDate, fecha_conocida: knownDate !== null };
}

function realWorkbookRecord(entityType, raw) {
  const source = normalizedKeys(raw);
  if (entityType === 'customers') return { ...raw, ID: source.documento, Nombre: source.cliente };
  if (entityType === 'credits') return { ...raw, ID: source.documento_credito, Cliente_ID: source.documento_cliente, Monto: source.credito_original, Pagado: source.total_abonado, Saldo: source.saldo };
  const sequence = id(source.pago_n_secuencia);
  const creditId = id(source.documento_credito);
  const rawDate = source.fecha_y_hora;
  const unknownDate = typeof rawDate === 'string' && ['sin fecha', 'no registrada'].includes(normalizedText(rawDate));
  return { ...raw, ID: creditId && sequence ? `${creditId}:${sequence}` : null, Credito_ID: creditId, Monto: source.importe_del_pago, Fecha: unknownDate ? null : rawDate };
}

function normalizedText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function normalizeBackup(document, sourceName = 'backup.json') {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('backup must be an object');
  const snapshot = document.format === 'nuevo-amanecer-pos-backup' ? document.payload : document;
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.data || typeof snapshot.data !== 'object') throw new Error('backup must contain payload.data or data');
  if (![8, 9].includes(Number(snapshot.version))) throw new Error('backup version must be 8 or 9');
  const mapping = { productos: 'products', ventas: 'sales', clientes: 'customers', creditos: 'credits', gastos: 'expenses', cajMovs: 'cash_movements', cashClosures: 'cash_closures', inventoryMovements: 'inventory_movements' };
  const rows = [];
  for (const [sourceKey, entityType] of Object.entries(mapping)) {
    const records = snapshot.data[sourceKey] ?? [];
    if (!Array.isArray(records)) throw new Error(`data.${sourceKey} must be an array`);
    for (const [index, raw] of records.entries()) {
      const payload = entityType === 'customers' ? normalizeCustomer(raw) : entityType === 'credits' ? normalizeCredit(raw) : cleanObject(raw);
      const sourceId = id(payload.id ?? payload.operation ?? payload.movement_id);
      if (!sourceId) throw new Error(`${sourceKey}[${index}] requires a stable id`);
      rows.push({ entity_type: entityType, source_key: sourceId, source_name: sourceName, source_row: index + 1, payload });
      if (entityType === 'credits') {
        const payments = Array.isArray(raw.pagos) ? raw.pagos : [];
        for (const [paymentIndex, payment] of payments.entries()) {
          const normalized = normalizePayment(payment, sourceId);
          rows.push({ entity_type: 'credit_payments', source_key: `${sourceId}:${normalized.id}`, source_name: sourceName, source_row: index + 1, payload: normalized });
        }
      }
    }
  }
  return rows;
}

export function normalizeWorkbook(sheets, sourceName = 'clientes-creditos.xlsx') {
  if (!sheets || typeof sheets !== 'object' || Array.isArray(sheets)) throw new Error('workbook sheets are required');
  const aliases = { clientes: 'customers', customers: 'customers', creditos: 'credits', credits: 'credits', pagos: 'credit_payments', abonos: 'credit_payments', payments: 'credit_payments', 'resumen clientes': 'customers', 'detalle creditos': 'credits', 'historial pagos': 'credit_payments' };
  const rows = [];
  for (const [sheetName, records] of Object.entries(sheets)) {
    const normalizedSheetName = normalizedText(sheetName);
    const entityType = aliases[normalizedSheetName];
    if (!entityType) continue;
    if (!Array.isArray(records)) throw new Error(`sheet ${sheetName} must contain rows`);
    for (const [index, raw] of records.entries()) {
      const mapped = ['resumen clientes', 'detalle creditos', 'historial pagos'].includes(normalizedSheetName) ? realWorkbookRecord(entityType, raw) : raw;
      const payload = entityType === 'customers' ? normalizeCustomer(mapped) : entityType === 'credits' ? normalizeCredit(mapped) : normalizePayment(mapped);
      const sourceKey = entityType === 'credit_payments' ? `${payload.credito_id}:${payload.id}` : payload.id;
      rows.push({ entity_type: entityType, source_key: sourceKey, source_name: sourceName, source_row: index + (records.headerRow ?? 1) + 1, payload });
    }
  }
  if (!rows.length) throw new Error('XLSX must contain Clientes, Creditos and/or Pagos sheets');
  return rows;
}

export async function buildManifest({ importId, sources, rows }) {
  if (!id(importId)) throw new Error('import_id is invalid');
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 2) throw new Error('one or two sources are required');
  const issues = [];
  const identities = new Map();
  for (const row of rows) {
    const key = `${row.entity_type}:${row.source_key}`;
    identities.set(key, (identities.get(key) || 0) + 1);
  }
  const normalizedRows = [];
  for (const row of rows) {
    if (!TYPES.has(row.entity_type) || !id(row.source_key)) throw new Error('invalid staging row identity');
    const key = `${row.entity_type}:${row.source_key}`;
    const duplicate = identities.get(key) > 1;
    if (duplicate) issues.push(issue('DUPLICATE_SOURCE_KEY', row.entity_type, row.source_key, { source_name: row.source_name, source_row: row.source_row }));
    const payloadJson = stableStringify(row.payload);
    normalizedRows.push({ ...row, payload_json: payloadJson, payload_hash: await sha256Hex(payloadJson), validation_status: duplicate ? 'REVIEW' : 'VALID' });
  }
  const customers = new Set(normalizedRows.filter((row) => row.entity_type === 'customers').map((row) => row.source_key));
  const credits = new Map(normalizedRows.filter((row) => row.entity_type === 'credits').map((row) => [row.source_key, row.payload]));
  for (const row of normalizedRows.filter((item) => item.entity_type === 'credits')) {
    if (!customers.has(row.payload.cliente_id)) issues.push(issue('ORPHAN_CREDIT_CUSTOMER', 'credits', row.source_key, { cliente_id: row.payload.cliente_id }));
  }
  for (const row of normalizedRows.filter((item) => item.entity_type === 'customers')) {
    const source = normalizedKeys(row.payload);
    const declaredDifference = signedCents(source.diferencia);
    if (declaredDifference !== null && declaredDifference !== 0) issues.push(issue('CUSTOMER_BALANCE_DIFFERENCE', 'customers', row.source_key, { image_balance_cents: cents(source.saldo_imagenes), document_balance_cents: cents(source.saldo_documentos), difference_cents: declaredDifference }, 'DIFFERENCE'));
  }
  const paymentTotals = new Map();
  for (const row of normalizedRows.filter((item) => item.entity_type === 'credit_payments')) {
    if (!credits.has(row.payload.credito_id)) issues.push(issue('ORPHAN_PAYMENT_CREDIT', 'credit_payments', row.source_key, { credito_id: row.payload.credito_id }));
    paymentTotals.set(row.payload.credito_id, (paymentTotals.get(row.payload.credito_id) || 0) + row.payload.monto_cents);
  }
  for (const [creditId, credit] of credits) {
    const payments = paymentTotals.get(creditId) || 0;
    if (credit.pagado_cents !== payments) issues.push(issue('CREDIT_PAYMENT_TOTAL_DIFFERENCE', 'credits', creditId, { declared_cents: credit.pagado_cents, payments_cents: payments }, 'DIFFERENCE'));
    if (credit.monto_cents - credit.pagado_cents !== credit.saldo_cents) issues.push(issue('CREDIT_BALANCE_DIFFERENCE', 'credits', creditId, { amount_cents: credit.monto_cents, paid_cents: credit.pagado_cents, balance_cents: credit.saldo_cents }, 'DIFFERENCE'));
  }
  const counts = {};
  const amounts = { credit_amount_cents: 0, credit_paid_cents: 0, credit_balance_cents: 0, payment_amount_cents: 0, sales_total_cents: 0 };
  for (const row of normalizedRows) {
    counts[row.entity_type] = (counts[row.entity_type] || 0) + 1;
    if (row.entity_type === 'credits') { amounts.credit_amount_cents += row.payload.monto_cents; amounts.credit_paid_cents += row.payload.pagado_cents; amounts.credit_balance_cents += row.payload.saldo_cents; }
    if (row.entity_type === 'credit_payments') amounts.payment_amount_cents += row.payload.monto_cents;
    if (row.entity_type === 'sales') {
      const total = cents(row.payload.total);
      if (total === null) issues.push(issue('INVALID_SALE_TOTAL', 'sales', row.source_key, { total: row.payload.total ?? null }));
      else amounts.sales_total_cents += total;
    }
  }
  normalizedRows.sort((a, b) => `${a.entity_type}:${a.source_key}:${a.source_name}:${a.source_row}`.localeCompare(`${b.entity_type}:${b.source_key}:${b.source_name}:${b.source_row}`));
  issues.sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const sourceIdentities = sources.map(({ name, type, sha256, bytes }) => {
    if (typeof name !== 'string' || !name || name.length > 240 || !['POS_JSON', 'CLIENT_CREDIT_XLSX'].includes(type) || !/^[0-9a-f]{64}$/.test(sha256) || !Number.isSafeInteger(bytes) || bytes < 1) throw new Error('invalid source descriptor');
    return { name, type, sha256, bytes };
  }).sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const sourceHash = await sha256Hex(stableStringify(sourceIdentities));
  const manifestHash = await sha256Hex(stableStringify(normalizedRows.map(({ entity_type, source_key, payload_hash }) => ({ entity_type, source_key, payload_hash }))));
  return { import_id: importId, transform_version: A5_TRANSFORM_VERSION, source_hash: sourceHash, manifest_hash: manifestHash, sources, rows: normalizedRows, report: { verdict: issues.length ? 'FAIL' : 'PASS', counts, amounts, issue_count: issues.length, issues } };
}

export async function validateManifest(manifest) {
  if (!manifest || manifest.transform_version !== A5_TRANSFORM_VERSION) throw new Error('unsupported transform_version');
  const rebuilt = await buildManifest({ importId: manifest.import_id, sources: manifest.sources, rows: manifest.rows.map((row) => ({ entity_type: row.entity_type, source_key: row.source_key, source_name: row.source_name, source_row: row.source_row, payload: JSON.parse(row.payload_json) })) });
  if (rebuilt.source_hash !== manifest.source_hash || rebuilt.manifest_hash !== manifest.manifest_hash || stableStringify(rebuilt.report) !== stableStringify(manifest.report)) throw new Error('manifest integrity mismatch');
  return rebuilt;
}
