import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('POS/js/products/image-batch.js','utf8');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jT3sAAAAASUVORK5CYII=';
function api(){const ctx={};vm.runInNewContext(source,ctx);return ctx.NuevoAmanecerImageBatch;}
const p={id:'p1',name:'Producto',sku:'04692485',barcode:'01',codigosAlternativos:['12345'],stock:20,precio:2};
test('match exacto por SKU, principal y alternativo conserva ceros; no usa nombre',()=>{
 const a=api();for(const code of ['04692485','01','12345'])assert.equal(a.plan([{codes:[code],image}], [p],[])[0].status,'ready');
 assert.equal(a.plan([{codes:['4692485'],name:p.name,image}],[p],[])[0].status,'missing');
});
test('rechaza códigos numéricos, SVG, URLs y lotes fuera del límite',()=>{
 const a=api();for(const bad of [1,null,''])assert.throws(()=>a.plan([{codes:[bad],image}],[p],[]));
 for(const bad of ['https://site/image.jpg','data:image/svg+xml;base64,AAAA','data:image/png;base64,AAAA'])assert.throws(()=>a.plan([{codes:['01'],image:bad}],[p],[]));
 assert.throws(()=>a.plan(Array(501).fill({codes:['01'],image}),[p],[]));
});
test('ambigüedad entre productos o entre entradas no aplica fotos',()=>{
 const a=api();assert.equal(a.plan([{codes:['01'],image}],[p,{...p,id:'p2'}],[])[0].status,'ambiguous');
 const rows=a.plan([{codes:['01'],image},{codes:['12345'],image}],[p],[]);assert.ok(rows.every(r=>r.status==='duplicate'));
});
test('protege imagen existente y reconoce reimportación sin duplicar',()=>{
 const a=api(),entries=[{codes:['01'],image}];assert.equal(a.plan(entries,[{...p,imagen:image}],[])[0].status,'existing');
 assert.equal(a.plan(entries,[p],entries)[0].status,'unchanged');
 assert.equal(a.plan(entries,[{...p,imagen:image}],[],true)[0].status,'ready');
});
test('el catálogo visual no muta stock, precio, códigos ni imagen del producto',()=>{
 const a=api(),before=JSON.stringify(p);a.plan([{codes:['01'],image}],[p],[]);assert.equal(JSON.stringify(p),before);
});
test('asset resolver fails closed after a product-code collision',()=>{
 const a=api();assert.equal(a.resolve(p,[{codes:['01'],image}],[p]),image);
 assert.equal(a.resolve(p,[{codes:['01'],image}],[p,{...p,id:'p2'}]),null);
 assert.equal(a.resolve({...p,id:'new'},[{codes:['01'],image,targetId:'p1'}],[{...p,id:'new'}]),null);
 assert.equal(a.resolve({...p,sku:'changed',barcode:'',codigosAlternativos:[]},[{codes:['01'],image}],[p]),null);
});
test('CANON, tarjetas, inventario y shell offline integran el mismo módulo',()=>{
 const html=fs.readFileSync('POS/index.html','utf8'),sw=fs.readFileSync('POS/sw.js','utf8');
 assert.match(html,/js\/products\/image-batch\.js/);assert.match(html,/id="productImageBatchFiles"/);
 assert.match(sw,/\.\/js\/products\/image-batch\.js/);
 assert.match(fs.readFileSync('POS/js/legacy-inline/inline-13.js','utf8'),/NuevoAmanecerImageBatch/);
 assert.match(fs.readFileSync('POS/js/legacy-inline/inline-01.js','utf8'),/safeImage=.*_naProductImageSource\(p\)/);
});

test('photo lookups read small authority metadata without copying the full canonical snapshot',()=>{
 let metadataReads=0,snapshotReads=0;
 const ctx={productos:[],NuevoAmanecerCanonical:{enabled:()=>true,sourceState:()=>{metadataReads++;return {cache:{promotion_id:'photos'}};},snapshot:()=>{snapshotReads++;throw Error('Full snapshot must not be copied for a photo');}}};
 vm.runInNewContext(source,ctx);
 for(let i=0;i<500;i++)assert.equal(ctx.NuevoAmanecerImageBatch.source(p),null);
 assert.equal(snapshotReads,0);assert.ok(metadataReads>=500);
});
test('missing canonical metadata never falls back to a stale full snapshot',()=>{
 let snapshots=0;const ctx={NuevoAmanecerCanonical:{enabled:()=>true,sourceState:()=>({cache:null}),snapshot:()=>{snapshots++;return {promotion_id:'old'};}}};
 vm.runInNewContext(source,ctx);assert.equal(ctx.NuevoAmanecerImageBatch.source(p),null);assert.equal(snapshots,0);
});
