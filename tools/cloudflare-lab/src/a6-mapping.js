import { sha256Hex, stableStringify } from './a5-import-core.js';

export const A6_MAPPING_VERSION = 'a6-mapping-v1';
export const A6_SCHEMA_VERSION = 'a6-schema-v1';
export const A6_POLICY = Object.freeze({ gate: 'P', baseline: 'A5_PASS', imported_history_effects: 'NONE', unknown_dates: 'NULL', publication: 'CANONICAL_READ_ONLY' });
export const A6_POLICY_HASH_INPUT = stableStringify(A6_POLICY);

export const A6_FIELD_MAP = Object.freeze({
  products: {
    id: 'product_id', name: 'name', sku: 'sku', barcode: 'barcode', codigosAlternativos: 'alternate_codes_json', codigoAlternativo: 'legacy_alternate_code',
    cat: 'category', marca: 'brand', descripcion: 'description', icon: 'icon', imagen: 'image', unidad: 'unit', unidadCompra: 'purchase_unit',
    factorCompra: 'purchase_factor', costo: 'cost_cents', precio: 'price_cents', precioCaja: 'box_price_cents', unidCaja: 'units_per_box',
    stock: 'opening_stock_quantity/current_stock_quantity', stockMin: 'stock_min_quantity', venc: 'expiry_date', incluyeIGV: 'includes_igv',
    tipoImpuesto: 'tax_type', impuestoComplementario: 'complementary_tax', controlInventario: 'tracks_inventory',
  },
  customers: {
    ID: 'customer_id', Nombre: 'name', telefono: 'phone', direccion: 'address', color: 'color', totalCompras: 'total_purchases_cents',
    id: 'customer_id', nombre: 'name', Documento: 'document', Cliente: 'name', 'Saldo imágenes': 'source_image_balance_cents',
    'Saldo documentos': 'source_document_balance_cents', Diferencia: 'source_difference_cents', 'Docs. totales': 'source_documents_total',
    'Docs. pendientes': 'source_documents_pending', 'Docs. pagados': 'source_documents_paid', 'N.º abonos': 'source_payment_count',
    'Crédito original pendiente': 'source_pending_original_cents', 'Abonado en créditos pendientes': 'source_pending_paid_cents',
    '% avance pendiente': 'source_pending_progress_ratio', 'Crédito histórico': 'source_historical_credit_cents', 'Pagado histórico': 'source_historical_paid_cents',
    'Primer crédito': 'source_first_credit_value', 'Último pago': 'source_last_payment_value', 'Pago total previsto': 'source_expected_full_payment_value',
    'Plazo máx. (días)': 'source_max_term_days', 'Días al vencimiento': 'source_days_until_due', Estado: 'source_status', Conciliación: 'source_reconciliation',
  },
  credits: {
    ID: 'credit_id', Cliente_ID: 'customer_id', 'Documento cliente': 'customer_id', Monto: 'original_amount_cents', 'Crédito original': 'original_amount_cents',
    Pagado: 'import_paid_cents', 'Total abonado': 'import_paid_cents', Saldo: 'opening_balance_cents/current_balance_cents',
    id: 'credit_id', cliente_id: 'customer_id', Tienda: 'store', 'Documento crédito': 'document_number', Referencia: 'reference', Concepto: 'concept',
    Vendedor: 'seller', Emisión: 'issued_value', Vencimiento: 'due_value', 'Plazo (días)': 'term_days', monto_cents: 'original_amount_cents',
    pagado_cents: 'import_paid_cents', saldo_cents: 'opening_balance_cents/current_balance_cents', '% avance': 'source_progress_ratio',
    'N.º abonos': 'source_payment_count', 'Días al vencimiento': 'source_days_until_due', Estado: 'source_status',
    'Saldo imágenes cliente': 'source_customer_image_balance_cents', 'Saldo documentos cliente': 'source_customer_document_balance_cents',
    'Diferencia cliente': 'source_customer_difference_cents',
  },
  credit_payments: {
    ID: 'source_payment_id', Credito_ID: 'credit_id', 'Documento crédito': 'credit_id', Monto: 'amount_cents', 'Importe del pago': 'amount_cents',
    Fecha: 'payment_date/payment_timestamp/date_precision', metodo: 'method',
    id: 'source_payment_id', credito_id: 'credit_id', 'Pago N.º (secuencia)': 'source_sequence', monto_cents: 'amount_cents', fecha: 'payment_date',
    fecha_conocida: 'payment_date_known', 'Fecha y hora': 'payment_timestamp/date_precision', Tipo: 'source_method', Origen: 'source_origin',
    'Tipo documento': 'source_document_type', 'N.º operación': 'source_operation_reference', Vendedor: 'seller', 'Observación de fecha': 'date_observation',
    'Documento cliente': 'source_customer_document', Cliente: 'source_customer_name', 'Pagado acumulado': 'source_cumulative_paid_cents',
    'Saldo después del pago': 'source_balance_after_cents', 'Avance acumulado': 'source_progress_ratio', 'Crédito original': 'source_credit_original_cents',
    'Saldo actual documento': 'source_current_document_balance_cents',
  },
});

const safeText = (value) => {
  if(value===null||value===undefined)return null;
  if(typeof value!=='string')throw new Error('invalid_text');
  return value;
};
const finite = (value, field) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`invalid_${field}`);
  return value;
};
const integer = (value, field) => {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isSafeInteger(value)) throw new Error(`invalid_${field}`);
  return value;
};
const boolean = (value, field) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'boolean') throw new Error(`invalid_${field}`);
  return value ? 1 : 0;
};

// Decimal text is converted with BigInt; binary multiplication is never used.
export function decimalToCents(value, field = 'amount') {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().replace(',', '.');
  const match = text.match(/^([+-]?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`invalid_${field}`);
  const cents = BigInt(`${match[1]}${match[2]}`) * 100n + BigInt(`${match[1]}${(match[3] || '').padEnd(2, '0') || '0'}`);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error(`invalid_${field}`);
  return Number(cents);
}

function same(field, values, normalize = (value) => value) {
  const present = values.filter((value) => value !== undefined && value !== null && value !== '').map(normalize);
  if (present.length > 1 && present.some((value) => value !== present[0])) throw new Error(`contradictory_${field}`);
  return present[0] ?? null;
}

function moneyAliases(payload, centsKey, originalKeys, field, required = false) {
  const normalized = centsKey === '__none' ? undefined : payload[centsKey];
  if (normalized !== undefined && normalized !== null && (!Number.isSafeInteger(normalized) || normalized < 0)) throw new Error(`invalid_${field}`);
  const originals = originalKeys.map((key) => payload[key]).filter((value) => value !== undefined && value !== null && value !== '');
  const original = originals.length ? same(field, originals, (value) => decimalToCents(value, field)) : null;
  if (normalized !== undefined && original !== null && normalized !== original) throw new Error(`contradictory_${field}`);
  const result = normalized ?? original;
  if (required && result === null) throw new Error(`missing_${field}`);
  return result;
}

function requiredId(field, values) {
  const value = same(field, values, (item) => String(item));
  if (!value || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`invalid_${field}`);
  return value;
}

function provenance(row, promotionId) {
  return {
    promotion_id: promotionId, source_import_id: row.import_id, source_entity_type: row.entity_type,
    source_name: row.source_name, source_row: Number(row.source_row), source_key: row.source_key,
    source_payload_json: row.payload_json, source_payload_hash: row.payload_hash, mapping_version: A6_MAPPING_VERSION,
  };
}

function validateOriginalDate(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') throw new Error(`invalid_${field}`);
  const text = String(value);
  if (['sin fecha','no registrada'].includes(text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase())) return null;
  if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(text))throw new Error(`invalid_${field}`);
  if (!Number.isFinite(Date.parse(text)) || new Date(`${text.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10)!==text.slice(0,10)) throw new Error(`invalid_${field}`);
  return text;
}

async function paymentId(row) {
  return sha256Hex(stableStringify({ import_id: row.import_id, entity_type: row.entity_type, source_name: row.source_name, source_row: Number(row.source_row), source_key: row.source_key }));
}

export async function mapStagingRow(row, promotionId) {
  if (!row || row.validation_status !== 'VALID' || !A6_FIELD_MAP[row.entity_type]) throw new Error('unsupported_staging_row');
  if (await sha256Hex(row.payload_json) !== row.payload_hash) throw new Error('payload_hash_mismatch');
  const p = JSON.parse(row.payload_json);
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid_payload');
  for(const key of ['venc','Primer crédito','Último pago','Pago total previsto','Emisión','Vencimiento'])if(Object.prototype.hasOwnProperty.call(p,key))validateOriginalDate(p[key],key);
  const base = provenance(row, promotionId);
  if (row.entity_type === 'products') {
    const productId = requiredId('product_id', [p.id, row.source_key]);
    const name = safeText(p.name);
    if (!name) throw new Error('invalid_product_name');
    if (p.codigosAlternativos!=null&&(!Array.isArray(p.codigosAlternativos)||p.codigosAlternativos.some((code)=>typeof code!=='string'))) throw new Error('invalid_alternate_codes');
    return { table: 'products', row: { ...base, product_id: productId, name, sku: safeText(p.sku), barcode: safeText(p.barcode), alternate_codes_json: p.codigosAlternativos == null ? null : JSON.stringify(p.codigosAlternativos), legacy_alternate_code: safeText(p.codigoAlternativo), category: safeText(p.cat), brand: safeText(p.marca), description: safeText(p.descripcion), icon: safeText(p.icon), image: safeText(p.imagen), unit: safeText(p.unidad), purchase_unit: safeText(p.unidadCompra), purchase_factor: finite(p.factorCompra, 'purchase_factor'), cost_cents: moneyAliases(p, '__none', ['costo'], 'cost'), price_cents: moneyAliases(p, '__none', ['precio'], 'price'), box_price_cents: moneyAliases(p, '__none', ['precioCaja'], 'box_price'), units_per_box: finite(p.unidCaja, 'units_per_box'), opening_stock_quantity: finite(p.stock, 'stock'), current_stock_quantity: finite(p.stock, 'stock'), stock_revision: 0, stock_min_quantity: finite(p.stockMin, 'stock_min'), expiry_date: safeText(p.venc), includes_igv: boolean(p.incluyeIGV, 'includes_igv'), tax_type: safeText(p.tipoImpuesto), complementary_tax: safeText(p.impuestoComplementario), tracks_inventory: boolean(p.controlInventario, 'tracks_inventory') } };
  }
  if (row.entity_type === 'customers') {
    const customerId = requiredId('customer_id', [p.id, p.ID, row.source_key]);
    const name = same('customer_name', [p.nombre, p.Nombre, p.Cliente], String);
    if (!name) throw new Error('invalid_customer_name');
    return { table: 'customers', row: { ...base, customer_id: customerId, name, document: safeText(p.Documento), phone: safeText(p.telefono), address: safeText(p.direccion), color: safeText(p.color), total_purchases_cents: moneyAliases(p, '__none', ['totalCompras'], 'total_purchases'), source_image_balance_cents: moneyAliases(p, '__none', ['Saldo imágenes'], 'image_balance'), source_document_balance_cents: moneyAliases(p, '__none', ['Saldo documentos'], 'document_balance'), source_difference_cents: moneyAliases(p, '__none', ['Diferencia'], 'difference'), source_documents_total: integer(p['Docs. totales'], 'documents_total'), source_documents_pending: integer(p['Docs. pendientes'], 'documents_pending'), source_documents_paid: integer(p['Docs. pagados'], 'documents_paid'), source_payment_count: integer(p['N.º abonos'], 'payment_count'), source_pending_original_cents: moneyAliases(p, '__none', ['Crédito original pendiente'], 'pending_original'), source_pending_paid_cents: moneyAliases(p, '__none', ['Abonado en créditos pendientes'], 'pending_paid'), source_pending_progress_ratio: finite(p['% avance pendiente'], 'pending_progress'), source_historical_credit_cents: moneyAliases(p, '__none', ['Crédito histórico'], 'historical_credit'), source_historical_paid_cents: moneyAliases(p, '__none', ['Pagado histórico'], 'historical_paid'), source_first_credit_value: safeText(p['Primer crédito']), source_last_payment_value: safeText(p['Último pago']), source_expected_full_payment_value: safeText(p['Pago total previsto']), source_max_term_days: integer(p['Plazo máx. (días)'], 'max_term_days'), source_days_until_due: integer(p['Días al vencimiento'], 'days_until_due'), source_status: safeText(p.Estado), source_reconciliation: safeText(p.Conciliación) } };
  }
  if (row.entity_type === 'credits') {
    const creditId = requiredId('credit_id', [p.id, p.ID, p['Documento crédito'], row.source_key]);
    const customerId = requiredId('customer_id', [p.cliente_id, p.Cliente_ID, p['Documento cliente']]);
    const amount = moneyAliases(p, 'monto_cents', ['Monto', 'Crédito original'], 'original_amount', true);
    const paid = moneyAliases(p, 'pagado_cents', ['Pagado', 'Total abonado'], 'paid_amount', true);
    const balance = moneyAliases(p, 'saldo_cents', ['Saldo'], 'balance', true);
    return { table: 'credits', row: { ...base, credit_id: creditId, customer_id: customerId, sale_id: null, store: safeText(p.Tienda), document_number: safeText(p['Documento crédito']), reference: safeText(p.Referencia), concept: safeText(p.Concepto), seller: safeText(p.Vendedor), issued_value: safeText(p.Emisión), due_value: safeText(p.Vencimiento), term_days: integer(p['Plazo (días)'], 'term_days'), original_amount_cents: amount, import_paid_cents: paid, opening_balance_cents: balance, current_balance_cents: balance, source_progress_ratio: finite(p['% avance'], 'progress'), source_payment_count: integer(p['N.º abonos'], 'payment_count'), source_days_until_due: integer(p['Días al vencimiento'], 'days_until_due'), source_status: safeText(p.Estado), source_customer_image_balance_cents: moneyAliases(p, '__none', ['Saldo imágenes cliente'], 'customer_image_balance'), source_customer_document_balance_cents: moneyAliases(p, '__none', ['Saldo documentos cliente'], 'customer_document_balance'), source_customer_difference_cents: moneyAliases(p, '__none', ['Diferencia cliente'], 'customer_difference') } };
  }
  const creditId = requiredId('credit_id', [p.credito_id, p.Credito_ID, p['Documento crédito']]);
  const sourcePaymentId = requiredId('source_payment_id', [p.id, p.ID]);
  const amount = moneyAliases(p, 'monto_cents', ['Monto', 'Importe del pago'], 'payment_amount', true);
  if (typeof p.fecha_conocida !== 'boolean') throw new Error('invalid_payment_date_known');
  const known = p.fecha_conocida;
  const normalizedDate = p.fecha === null ? null : safeText(p.fecha);
  const originalDate = validateOriginalDate(p.Fecha, 'payment_date');
  const timestamp = validateOriginalDate(p['Fecha y hora'], 'payment_timestamp');
  if (known === false && (normalizedDate !== null || originalDate !== null || timestamp !== null)) throw new Error('contradictory_payment_date');
  if (known === true && (!normalizedDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate))) throw new Error('invalid_payment_date');
  if(normalizedDate)validateOriginalDate(normalizedDate,'normalized_payment_date');
  for (const value of [originalDate, timestamp]) if (value && new Date(value).toISOString().slice(0, 10) !== normalizedDate) throw new Error('contradictory_payment_date');
  if(originalDate&&timestamp&&originalDate.includes('T')&&timestamp.includes('T')&&Date.parse(originalDate)!==Date.parse(timestamp))throw new Error('contradictory_payment_timestamp');
  const hasTime = known === true && [originalDate, timestamp].some((value) => value && value.includes('T'));
  return { table: 'credit_payments', row: { ...base, payment_id: await paymentId(row), credit_id: creditId, source_payment_id: sourcePaymentId, source_sequence: integer(p['Pago N.º (secuencia)'], 'payment_sequence'), amount_cents: amount, payment_date: known ? normalizedDate : null, payment_timestamp: hasTime ? (timestamp || originalDate) : null, payment_date_known: known ? 1 : 0, date_precision: !known ? 'UNKNOWN' : hasTime ? 'TIMESTAMP' : 'DATE', method: safeText(p.metodo), source_method: safeText(p.Tipo), source_origin: safeText(p.Origen), source_document_type: safeText(p['Tipo documento']), source_operation_reference: safeText(p['N.º operación']), seller: safeText(p.Vendedor), date_observation: safeText(p['Observación de fecha']), source_customer_document: safeText(p['Documento cliente']), source_customer_name: safeText(p.Cliente), source_cumulative_paid_cents: moneyAliases(p, '__none', ['Pagado acumulado'], 'cumulative_paid'), source_balance_after_cents: moneyAliases(p, '__none', ['Saldo después del pago'], 'balance_after'), source_progress_ratio: finite(p['Avance acumulado'], 'payment_progress'), source_credit_original_cents: moneyAliases(p, '__none', ['Crédito original'], 'source_credit_original'), source_current_document_balance_cents: moneyAliases(p, '__none', ['Saldo actual documento'], 'current_document_balance') } };
}

export async function a6PolicyHash() { return sha256Hex(A6_POLICY_HASH_INPUT); }
