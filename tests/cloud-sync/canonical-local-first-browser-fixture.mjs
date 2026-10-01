// Separate Node process: Playwright 1.47 transforms .mjs fixtures incorrectly.
// All data and credentials are synthetic. D1 is deliberately inaccessible.
import { activeCanon, device } from './canon-browser-harness.mjs';
import { tursoSqlite } from './turso-sqlite-protocol.mjs';
const f=await activeCanon({after(){}},{migrations:['0014_canonical_live_products.sql','0015_canonical_inventory_adjust.sql','0016_canonical_generic_sale_lines.sql','0017_canonical_live_customers.sql','0018_canonical_customer_credit_policy.sql','0019_canonical_local_first.sql']});
f.env.POS_ACTIVATION_SECRET='synthetic-owner-secret';
const turso=tursoSqlite(f.database); f.env.DB=turso.adapter;
f.env.nuevo_amanecer_lab={prepare(){throw Error('D1 forbidden');}};
const writer=await device(f,{token:'writer-token',deviceId:'first'});
await writer.api.adjustInventory({product_id:'00001',movement_type:'ENTRADA',quantity:173,reason:'Synthetic stock'});
await device(f,{token:'second-token',deviceId:'second'});
process.on('message',async message=>{
  try {
    let value;
    if(message.type==='fetch') {const response=await f.fetch(message.url,message.options);value={status:response.status,body:await response.text()};}
    else if(message.type==='sql') value=f.sql(message.sql);
    else throw Error('Unknown synthetic fixture request');
    process.send({id:message.id,value});
  }catch(error){process.send({id:message.id,error:String(error)});}
});
process.send({ready:true,control:f.control()});
