import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export function frozenRules(source, scope='') {
 const rows=[]; source=source.replace(/\/\*[\s\S]*?\*\//g,''); let cursor=0;
 while(cursor<source.length){
  const start=source.indexOf('{',cursor);if(start<0)break;
  const selector=source.slice(cursor,start).trim();let depth=1,end=start+1;
  for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
  const body=source.slice(start+1,end-1);cursor=end;
  if(selector.startsWith('@media'))rows.push(...frozenRules(body,scope+selector+'/'));
  else if(!/^#pagePOS (?:#cartDrawer )?\.(?:cart-(?!fab\b)|ci-|qty-|btn-rm\b|total-|btn-cobro\b)/.test(selector))rows.push(scope+selector+'{'+body+'}');
 }
 return rows;
}
const hash=value=>createHash('sha256').update(value).digest('hex');

test('all CSS outside Venta actual and the reference decorator remain frozen',()=>{
 // Baseline: CANON 9278e2ce95df9ce01deec220a16e858551ad4e33.
 assert.equal(hash(frozenRules(readFileSync('POS/css/canon-pos-reference-ui.css','utf8')).join('\n')), '23d82354eed75dce6b59a345785eb81f9cae5f34b90db8c333e484a0a6604ac1');
 assert.equal(hash(readFileSync('POS/js/canon-pos-reference-ui.js','utf8').replace(/\r\n/g,'\n')), '2acea7c1562d0e3f1b8294bcf3fab59128f54deec73c7109f21cee55892f1a33');
});
