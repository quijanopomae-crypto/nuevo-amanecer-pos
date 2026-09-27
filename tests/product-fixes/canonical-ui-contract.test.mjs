import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const adapterSource = readFileSync('POS/js/adapters/canonical-ui-adapter.js','utf8');
const canonicalSource = readFileSync('POS/js/sync/canonical-client.js','utf8');
const indexSource = readFileSync('POS/index.html','utf8');
const swSource = readFileSync('POS/sw.js','utf8');

function loadAdapter() {
  const context = { globalThis: {} };
  vm.runInNewContext(adapterSource, context);
  return context.globalThis.NuevoAmanecerCanonicalUIAdapter;
}

test('canonical UI adapter maps the complete product contract consumed by POS and inventory', () => {
  const adapter = loadAdapter();
  const product = adapter.product({
    product_id:'p-1',
    name:'Gaseosa',
    sku:'SKU-1',
    barcode:'7750001',
    alternate_codes_json:'["ALT-1","ALT-2"]',
    legacy_alternate_code:'ALT-3',
    category:'BEBIDAS',
    brand:'Marca',
    description:'Botella',
    icon:'🥤',
    image:null,
    unit:'unidad',
    purchase_unit:'caja',
    purchase_factor:12,
    cost_cents:150,
    price_cents:250,
    box_price_cents:2700,
    units_per_box:12,
    current_stock_quantity:24,
    stock_revision:9,
    stock_min_quantity:4,
    expiry_date:'2027-01-31',
    includes_igv:0,
    tax_type:'exonerado',
    complementary_tax:'ISC',
    tracks_inventory:0
  });

  assert.equal(product.id,'p-1');
  assert.equal(product.product_id,'p-1');
  assert.equal(product.name,'Gaseosa');
  assert.equal(product.nombre,'Gaseosa');
  assert.equal(product.barcode,'7750001');
  assert.equal(product.codigo,'7750001');
  assert.deepEqual([...product.codigosAlternativos],['ALT-1','ALT-2','ALT-3']);
  assert.equal(product.cat,'bebidas');
  assert.equal(product.categoria,'bebidas');
  assert.equal(product.icon,'🥤');
  assert.equal(product.icono,'🥤');
  assert.equal(product.controlInventario,false);
  assert.equal(product.controlaStock,false);
  assert.equal(product.unidadCompra,'caja');
  assert.equal(product.factorCompra,12);
  assert.equal(product.precioCaja,27);
  assert.equal(product.unidCaja,12);
  assert.equal(product.stock,24);
  assert.equal(product.stockRevision,9);
  assert.equal(product.incluyeIGV,false);
  assert.equal(product.tipoImpuesto,'exonerado');
  assert.equal(product.impuestoComplementario,'ISC');
});

test('canonical UI adapter is fail-soft for optional product JSON without inventing authority', () => {
  const adapter = loadAdapter();
  const product = adapter.product({
    product_id:'p-2',
    name:'',
    alternate_codes_json:'{broken',
    category:null,
    tracks_inventory:1,
    purchase_factor:0,
    units_per_box:0,
    price_cents:0,
    current_stock_quantity:0
  });
  assert.equal(product.name,'PRODUCTO');
  assert.deepEqual([...product.codigosAlternativos],[]);
  assert.equal(product.cat,'');
  assert.equal(product.controlInventario,true);
  assert.equal(product.factorCompra,1);
  assert.equal(product.precio,0);
  assert.equal(product.stock,0);
  assert.equal(product.canonical,true);
});

test('canonical snapshot centralizes customer, credit, payment and sale linkage projection', () => {
  const adapter = loadAdapter();
  const out = adapter.snapshot({
    authority:'canonical',
    promotion_id:'promo-1',
    authority_epoch:3,
    revision:8,
    financial_revision:5,
    mode:'ACTIVE',
    read_only:false,
    products:[],
    creditAccounts:[{customer_id:'c-1',account_id:'tech',name:'Tecnología',mode:'separate',created_at:'2026-09-01'}],
    customers:[{customer_id:'c-1',name:'Misael',document:'70000001',phone:'999000001',address:'Ica',total_purchases_cents:12345}],
    payments:[{payment_id:'pay-1',credit_id:'cr-1',amount_cents:3000,payment_date_known:1,payment_date:'2026-09-20',payment_timestamp:'2026-09-20T10:15:00',date_precision:'TIMESTAMP',method:'efectivo',source_operation_reference:'OP-1',seller:'Frank'}],
    credits:[{credit_id:'cr-1',customer_id:'c-1',sale_id:'sale-9',concept:'Celular',seller:'Frank',issued_value:'2026-09-01T09:00:00',due_value:'2026-10-01',original_amount_cents:12000,current_balance_cents:9000,source_status:'activo',account_id:'tech',account_name:'Tecnología',account_mode:'separate',installments_json:'[{"number":1,"due_date":"2026-10-01","amount_cents":12000}]'}]
  });
  assert.equal(out.customers[0].nombre,'Misael');
  assert.equal(out.customers[0].creditCategories[0].id,'tech');
  assert.equal(out.credits[0].ventaId,'sale-9');
  assert.equal(out.credits[0].sale_id,'sale-9');
  assert.equal(out.credits[0].saldo,90);
  assert.equal(out.credits[0].pagado,30);
  assert.equal(out.credits[0].pagos[0].pagoId,'pay-1');
  assert.equal(out.credits[0].creditAccount.categoryId,'tech');
  assert.equal(out.credits[0].installments[0].amount,120);
});

test('canonical-client delegates UI translation instead of maintaining a second field map', () => {
  assert.match(canonicalSource,/NuevoAmanecerCanonicalUIAdapter/);
  assert.match(canonicalSource,/return adapter\.snapshot\(data\)/);
  assert.doesNotMatch(canonicalSource,/categoria:\s*p\.category/);
  assert.doesNotMatch(canonicalSource,/codigo:\s*p\.barcode/);
});

test('hosted shell loads and precaches the adapter before canonical-client', () => {
  const adapterIndex=indexSource.indexOf('js/adapters/canonical-ui-adapter.js');
  const clientIndex=indexSource.indexOf('js/sync/canonical-client.js');
  assert.ok(adapterIndex>=0 && clientIndex>adapterIndex);
  assert.match(swSource,/\.\/js\/adapters\/canonical-ui-adapter\.js/);
});
