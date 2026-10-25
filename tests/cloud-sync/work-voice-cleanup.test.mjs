import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('POS/work/work-canon-bridge.js','utf8');
test('leaving voice aborts actual recognition and ignores late transcripts',()=>{
 const controls={},posts=[];let recog,aborts=0;
 for(const id of ['voiceMic','voiceExit','chatBack'])controls['#'+id]={listeners:{},addEventListener(e,fn){this.listeners[e]=fn;},setAttribute(){}};
 const body={appendChild(){},classList:{add(){}}};
 const win={location:{origin:'https://pos.test'},parent:{location:{origin:'https://pos.test'},postMessage(m){posts.push(m);}},document:{body,querySelector:q=>controls[q]||null,addEventListener(){},createElement:()=>({style:{},setAttribute(){},addEventListener(){}})},navigator:{onLine:true},addEventListener(){},SpeechRecognition:class{constructor(){recog=this;}start(){}abort(){aborts++;}}};
 vm.runInNewContext(source,{window:win,Map,Array,Object,String,Date});
 const event={preventDefault(){},stopImmediatePropagation(){}};
 controls['#voiceMic'].listeners.click(event);assert.ok(recog);
 controls['#voiceExit'].listeners.click?.(event);
 assert.equal(aborts,1);
 recog.onresult({results:[[{transcript:'mensaje tardío'}]]});
 assert.equal(posts.some(p=>p.type==='na-work:chat'),false);
});
