import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const sw=readFileSync('POS/sw.js','utf8');
function worker(cached, fetcher){
 const listeners={};
 vm.runInNewContext(sw,{URL,Request,Response,Promise,Set,fetch:fetcher,caches:{open:async()=>({match:async()=>cached})},self:{location:{origin:'https://pos.test'},registration:{scope:'https://pos.test/app/'},addEventListener:(name,handler)=>listeners[name]=handler}});
 return async request=>{let response;listeners.fetch({request,respondWith:p=>response=p});return response;};
}
test('a missing shell stylesheet recovers online instead of returning unstyled 503',async()=>{
 let calls=0;const handle=worker(undefined,async()=>{calls++;return new Response('body { color: teal }',{headers:{'Content-Type':'text/css'}});});
 const result=await handle(new Request('https://pos.test/app/css/base.css'));
 assert.equal(result.status,200);assert.equal(calls,1);assert.match(await result.text(),/teal/);
});
test('a complete cached generation stays offline first',async()=>{
 const cached=new Response('cached');const handle=worker(cached,()=>{throw Error('network must not run');});
 assert.equal(await (await handle(new Request('https://pos.test/app/css/base.css'))).text(),'cached');
});
test('authenticated requests remain outside shell recovery',async()=>{
 const handle=worker(undefined,()=>{throw Error('must not run');});
 assert.equal(await handle(new Request('https://pos.test/app/css/base.css',{headers:{authorization:'Bearer test'}})),undefined);
});
test('mobile stylesheet participates in head loading and old home is gated until enhancement',()=>{
 const index=readFileSync('POS/index.html','utf8');const css=readFileSync('POS/css/canon-mobile-home.css','utf8');
 assert.match(index.split('</head>')[0],/id="naMobileHomeBaseStyles"[^>]*href="css\/canon-mobile-home.css"/);
 assert.match(css,/#pageMenu:not\(\.na-mobile-ready\)/);
});
test('shell refresh cannot delete files still used by other tabs',()=>{
 const source=readFileSync('tools/cloudflare-pos-web/public/activate.js','utf8');
 const block=source.slice(source.indexOf('async function refreshShellOnly'),source.indexOf('function validRuntimeConfig'));
 assert.doesNotMatch(block,/caches\.delete/);
});
test('a missing navigation script recovers without changing the installed generation',async()=>{
 const handle=worker(undefined,async()=>new Response('window.recovered = true;', {headers:{'Content-Type':'application/javascript'}}));
 assert.match(await (await handle(new Request('https://pos.test/app/js/navigation/menu-navigation.js'))).text(),/recovered/);
});
test('offline incomplete shell reports an error rather than pretending it loaded',async()=>{
 const handle=worker(undefined,async()=>{throw Error('offline');});
 assert.equal((await handle(new Request('https://pos.test/app/css/base.css'))).status,503);
});
