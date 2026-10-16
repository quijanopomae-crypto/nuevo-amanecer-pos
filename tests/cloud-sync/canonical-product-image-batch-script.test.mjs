import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, prepareManifestImages, safeDataUrl } from '../../tools/cloudflare-prod/scripts/product-image-batch-apply.mjs';

function manifest() {
  return {
    schema:'nuevo-amanecer.canon-product-image-batch/v1',
    batch_id:'001',
    approved_by_owner:true,
    max_items:10,
    entries:Array.from({length:10},(_,index)=>({
      id:`p-${index}`,
      product_name:`PRODUCT ${index}`,
      expected_presentation:'90 g',
      source_page:`https://example.test/source/${index}`,
      image_url:`https://example.test/image/${index}.jpg`
    }))
  };
}

test('production image manifest requires exactly ten unique approved entries',()=>{
  const input=manifest();
  assert.equal(validateManifest(input).entries.length,10);
  assert.throws(()=>validateManifest({...input,approved_by_owner:false}),/owner approval/);
  assert.throws(()=>validateManifest({...input,entries:input.entries.slice(0,9)}),/exactly 10/);
  const duplicate=manifest();duplicate.entries[9]={...duplicate.entries[9],id:'p-0'};
  assert.throws(()=>validateManifest(duplicate),/duplicate entry id/);
});

test('prepareManifestImages converts only allowed raster bytes into bounded data URLs',async()=>{
  const bytes=Buffer.from('small-jpeg-fixture');
  const prepared=await prepareManifestImages(manifest(),{
    fetchFn:async()=>({
      ok:true,status:200,
      headers:{get(name){return name.toLowerCase()==='content-type'?'image/jpeg':null;}},
      async arrayBuffer(){return bytes;}
    })
  });
  assert.equal(prepared.entries.length,10);
  assert.ok(prepared.entries.every((entry)=>entry.image.startsWith('data:image/jpeg;base64,')));
  assert.ok(prepared.entries.every((entry)=>/^[0-9a-f]{64}$/.test(entry.image_sha256)));
});

test('prepareManifestImages fails closed on non-raster content',async()=>{
  await assert.rejects(
    prepareManifestImages(manifest(),{
      fetchFn:async()=>({ok:true,status:200,headers:{get(){return 'image/svg+xml';}},async arrayBuffer(){return Buffer.from('<svg/>');}})
    }),
    /unsupported image MIME/
  );
});

test('safeDataUrl rejects payloads that would exceed the CANON image bound',()=>{
  assert.throws(()=>safeDataUrl('image/jpeg',Buffer.alloc(140000,1)),/safe data URL limit/);
  assert.throws(()=>safeDataUrl('image/svg+xml',Buffer.from('x')),/unsupported image MIME/);
});
