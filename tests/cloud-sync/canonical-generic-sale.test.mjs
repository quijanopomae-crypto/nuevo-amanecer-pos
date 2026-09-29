import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device } from './canon-browser-harness.mjs';

const intentSource=readFileSync('POS/js/sync/canonical-sale-intent.js','utf8');
const inline01=readFileSync('POS/js/legacy-inline/inline-01.js','utf8');
const migration=readFileSync('infra/database/migrations/0016_canonical_generic_sale_lines.sql','utf8');
const scripts=[['canonical-sale-intent.js',intentSource]];
const migrations=['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql'];

async function saleTab(f,options={}){
  const deviceOptions={
    token:options.token||'device-a-token',
    localStorage:options.localStorage,
    scripts,
    onFetch:options.onFetch
  };
  if(Object.prototype.hasOwnProperty.call(options,'deviceId'))deviceOptions.deviceId=options.deviceId;
  else if(!options.localStorage)deviceOptions.deviceId='device-a';
  return device(f,deviceOptions);
}

function genericIntent(tab,overrides={}){
  return tab.context.NuevoAmanecerCanonicalSaleIntent.build({
    payment_method:'transferencia',
    payment:{reference:overrides.reference||'GENERIC-REF-1'},
    items:[{
      ventaLibre:true,
      quantity:overrides.quantity||2,
      unit_price_cents:overrides.unit_price_cents||350,
      name:overrides.name||'Recarga libre',
      codigoIngresado:overrides.code||'REC-01',
      ...(overrides.genericId?{canonicalGenericId:overrides.genericId}:{})
    }]
  });
}

function liveProductInput(){
  return {
    name:'Producto mixto',
    sku:'MIX-LIVE-001',
    barcode:'775000009901',
    alternate_codes:[],
    category:'abarrotes',
    brand:'Prueba',
    description:null,
    icon:'📦',
    image:null,
    unit:'unidad',
    purchase_unit:'unidad',
    purchase_factor:1,
    cost_cents:200,
    price_cents:500,
    box_price_cents:null,
    units_per_box:null,
    initial_stock_quantity:5,
    stock_min_quantity:0,
    expiry_date:null,
    includes_igv:true,
    tax_type:'gravado',
    complementary_tax:'',
    tracks_inventory:true
  };
}

test('VARIOS persists through sale.create, creates no catalog/inventory ghost and is visible on a second device',async(t)=>{
  const f=await activeCanon(t,{migrations});
  const tab=await saleTab(f);
  const beforeProducts=f.sql('SELECT COUNT(*) n FROM products').n;
  const intent=genericIntent(tab);

  assert.match(intent.items[0].product_id,/^GENERIC:/);
  assert.deepEqual(JSON.parse(JSON.stringify(intent.items[0].generic_line)),{name:'Recarga libre',code:'REC-01'});

  const receipt=await tab.api.createSale(intent);
  assert.equal(receipt.status,'created');
  assert.equal(f.sql('SELECT COUNT(*) n FROM sales').n,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM sale_items').n,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_generic_sale_lines').n,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM products').n,beforeProducts);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_live_products').n,0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM inventory_movements').n,0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_manual_inventory_movements').n,0);

  const generic=f.sql('SELECT * FROM canonical_generic_sale_lines');
  assert.equal(generic.generic_product_id,intent.items[0].product_id);
  assert.equal(generic.name,'Recarga libre');
  assert.equal(generic.code,'REC-01');
  assert.equal(generic.quantity,2);
  assert.equal(generic.unit_price_cents,350);
  assert.equal(generic.line_total_cents,700);

  await tab.api.refresh();
  const raw=tab.api.snapshot().saleItems.find((row)=>row.product_id===intent.items[0].product_id);
  assert.equal(raw.line_type,'GENERIC');
  assert.equal(raw.generic_name,'Recarga libre');
  assert.equal(raw.generic_code,'REC-01');

  const localSale=tab.api.legacySnapshot().sales.find((sale)=>sale.sale_id===receipt.sale_id);
  assert.equal(localSale.items[0].nombre,'Recarga libre');
  assert.equal(localSale.items[0].codigoIngresado,'REC-01');
  assert.equal(localSale.items[0].ventaLibre,true);
  assert.equal(localSale.items[0].controlInventario,false);

  const other=await saleTab(f,{token:'device-b-token',deviceId:'device-b'});
  const remoteSale=other.api.legacySnapshot().sales.find((sale)=>sale.sale_id===receipt.sale_id);
  assert.ok(remoteSale);
  assert.equal(remoteSale.items[0].nombre,'Recarga libre');
  assert.equal(remoteSale.items[0].ventaLibre,true);
});

test('mixed sale decrements only the real LIVE product while VARIOS remains stockless',async(t)=>{
  const f=await activeCanon(t,{migrations});
  const tab=await saleTab(f);
  const productReceipt=await tab.api.createProduct(liveProductInput());
  await tab.api.refresh();
  const product=tab.api.snapshot().products.find((row)=>row.product_id===productReceipt.product_id);
  assert.ok(product);

  const intent=tab.context.NuevoAmanecerCanonicalSaleIntent.build({
    payment_method:'transferencia',
    payment:{reference:'MIX-GENERIC-REF-1'},
    items:[
      {product_id:product.product_id,quantity:2,unit_price_cents:500},
      {ventaLibre:true,quantity:1,unit_price_cents:300,name:'Servicio VARIOS',codigoIngresado:'SV-01'}
    ]
  });
  const receipt=await tab.api.createSale(intent);
  assert.equal(receipt.status,'created');

  const after=f.sql('SELECT current_stock_quantity,stock_revision FROM canonical_live_products WHERE product_id=?',product.product_id);
  assert.equal(after.current_stock_quantity,3);
  assert.equal(after.stock_revision,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM inventory_movements WHERE operation_id=?',intent.operation_id).n,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_live_inventory_effects WHERE operation_id=?',intent.operation_id).n,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_generic_sale_lines WHERE operation_id=?',intent.operation_id).n,1);
  const genericId=intent.items[1].product_id;
  assert.equal(f.sql('SELECT COUNT(*) n FROM products WHERE product_id=?',genericId).n,0);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_live_products WHERE product_id=?',genericId).n,0);
});

test('lost ACK replays the same generic sale operation without duplicating sale or metadata',async(t)=>{
  const f=await activeCanon(t,{migrations});
  let drop=true;
  const tab=await saleTab(f,{
    async onFetch(url,options,forward){
      if(url.endsWith('/commands/sale.create')&&drop){
        drop=false;
        await forward();
        throw new TypeError('lost ack after generic sale commit');
      }
      return null;
    }
  });
  const intent=genericIntent(tab,{reference:'GENERIC-ACK-1',genericId:'GENERIC:ack-stable-1'});

  await assert.rejects(tab.api.createSale(intent),/CANONICAL_FINANCIAL_PENDING/);
  assert.equal(f.sql('SELECT COUNT(*) n FROM sales WHERE operation_id=?',intent.operation_id).n,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_generic_sale_lines WHERE operation_id=?',intent.operation_id).n,1);
  const pending=tab.api.pendingSnapshot();
  assert.equal(pending.command,'sale.create');
  assert.equal(pending.payload.items[0].product_id,'GENERIC:ack-stable-1');

  const replay=await tab.api.retryPending();
  assert.equal(replay.status,'already_processed');
  assert.equal(replay.sale_id,intent.sale_id);
  assert.equal(f.sql('SELECT COUNT(*) n FROM sales WHERE operation_id=?',intent.operation_id).n,1);
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_generic_sale_lines WHERE operation_id=?',intent.operation_id).n,1);
});

test('VARIOS migration remains narrowly fenced and CANON add-to-cart skips legacy persistence only in canonical mode',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS canonical_generic_sale_lines/);
  assert.match(migration,/canonical_sale_item_authorized_insert/);
  assert.match(migration,/canonical_generic_sale_line_authorized_insert/);
  assert.match(migration,/generic_product_id/);
  assert.match(inline01,/_naFreeSaleLocked\(\)/);
  assert.match(inline01,/canonicalSaleCapture:true/);
  assert.match(inline01,/canonicalGenericId:genericId/);
  assert.match(inline01,/if\(!canonical\)\{const result=await saveAllData\(\)/);
});
