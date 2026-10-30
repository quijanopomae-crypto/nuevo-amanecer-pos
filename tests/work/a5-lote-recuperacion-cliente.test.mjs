// GROKBOT 5 (pruebas y calidad), P0-A/P0-B en el CLIENTE: work-host.js REAL con motor FALSO (tests/helpers/a5-work-host-fixture.mjs).
// Nivel A/S: determinista, sin red, sin Worker, sin modelo real, productos sintéticos. No toca CANON.
// Complementa (no repite) tests/work/work-capacidad.test.mjs y work-cards.test.mjs: aquí van los códigos de fallo que allí no se prueban
// a mitad de lote, el lote de AJUSTES de stock, el doble pedido del mismo cambio y la relectura de lo guardado.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,pr,aj,cardMsgs,lote,lastCards,ask,tick} from '../helpers/a5-work-host-fixture.mjs';

const end=(f)=>cardMsgs(f,lote(f).key).pop();
const run=async(f)=>{f.post({type:'na-work:card-confirm-all',key:lote(f).key});await tick(160);};
// Fallos que el servidor/puerta puede devolver en la 2.ª de 3 tarjetas (los nombres son los del Worker y de la puerta del celular).
const FAILS={
  other_device:{ok:false,code:'other_device',msg:'x'}, already_confirmed:{ok:false,code:'already_confirmed',msg:'x'},
  proposal_changed:{ok:false,code:'proposal_changed',msg:'x'}, bad_token:{ok:false,code:'bad_token',msg:'x'},
  HTTP_500:{ok:false,code:'HTTP_500',msg:'x'}, HTTP_502:{ok:false,code:'HTTP_502',msg:'x'}, HTTP_503:{ok:false,code:'HTTP_503',msg:'x'},
  stock_check_unavailable:{ok:false,code:'stock_check_unavailable',retry:true,msg:'x'}, product_missing:{ok:false,code:'product_missing',msg:'x'},
  network:{ok:false,code:'network',retry:true,msg:'x'}, timeout:{ok:false,code:'timeout',retry:true,msg:'x'},
  forbidden_role:{ok:false,code:'forbidden_role',msg:'x'}, assistant_off:{ok:false,code:'assistant_off',msg:'x'}
};

test('A5-C1) fallo parcial: con cualquier error en la 2.ª de 3, el lote se DETIENE, no gasta la 3.ª, guarda solo lo confirmado y nunca dice «todos»',async()=>{
  for(const [code,res] of Object.entries(FAILS)){
    const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),execute:async(k)=>k==='pr-2'?res:{ok:true,msg:'ok'}});
    await ask(f);await run(f);
    assert.deepEqual(f.calls.execute,['pr-1','pr-2'],code+': no se sigue gastando firmas tras un fallo');
    assert.deepEqual(f.calls.save,['P1'],code+': solo se guarda la confirmada');
    const e=end(f);
    assert.equal(e.state,'partial',code);
    assert.match(e.msg,/Se guardaron 1 de 3/,code);
    assert.doesNotMatch(e.msg,/los 3 cambios se guardaron|Listo/i,code+': nunca «todo listo» con fallos');
    assert.notEqual(cardMsgs(f,'pr-2').pop().state,'done',code);
    assert.notEqual(cardMsgs(f,'pr-3').pop()?.state,'done',code);
  }
});

test('A5-C2) la puerta LANZA (excepción de red) a mitad del lote: mismo cierre seguro que un error devuelto',async()=>{
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]}),execute:async(k)=>{if(k==='pr-2')throw new TypeError('Failed to fetch');return {ok:true,msg:'ok'};}});
  await ask(f);await run(f);
  assert.deepEqual(f.calls.execute,['pr-1','pr-2']);assert.deepEqual(f.calls.save,['P1']);
  assert.equal(end(f).state,'partial');assert.doesNotMatch(end(f).msg,/TypeError|fetch/i,'sin texto técnico');
});

test('A5-A1) lote de AJUSTES de stock: cada uno se guarda y se relee; «Listo» solo si el stock leído = stock_despues',async()=>{
  const f=fixture({api:async()=>({texto:'ok',proposals:[aj(1),aj(2),aj(3)],turns:[]})});
  await ask(f);assert.equal(lote(f).count,3);
  await run(f);
  assert.deepEqual(f.calls.save,['P1','P2','P3']);
  for(const p of ['P1','P2','P3'])assert.equal(f.local[p].stock,10);
  assert.equal(end(f).state,'done');
});

test('A5-A2) persistencia: si el POS guarda OTRO stock (p. ej. otra venta en el medio), la tarjeta NO dice «Listo» y el lote se detiene',async()=>{
  const f=fixture({api:async()=>({texto:'ok',proposals:[aj(1),aj(2),aj(3)],turns:[]})});
  await ask(f);
  const real=f.root.guardarMovInv;let n=0;
  f.root.guardarMovInv=async()=>{await real();if(++n===2)f.local.P2.stock=9;}; // quedó 9, se pidió 10
  await run(f);
  assert.equal(cardMsgs(f,'aj-2').pop().state,'failed');assert.match(cardMsgs(f,'aj-2').pop().msg,/No pude comprobar/);
  assert.deepEqual(f.calls.execute,['aj-1','aj-2'],'no sigue con la 3.ª');
  assert.equal(end(f).state,'partial');
});

test('A5-A3) el stock cambió ANTES de confirmar (venta entre la propuesta y el toque): la tarjeta se salta SIN gastar su firma',async()=>{
  const f=fixture({api:async()=>({texto:'ok',proposals:[aj(1),aj(2),aj(3)],turns:[]})});
  await ask(f);f.local.P2.stock=2; // la propuesta decía stock_actual 3
  await run(f);
  assert.deepEqual(f.calls.execute,['aj-1','aj-3']);assert.equal(cardMsgs(f,'aj-2').pop().state,'pending');
});

test('A5-B8) doble pedido del MISMO cambio (el modelo lo vuelve a proponer en otra respuesta): el segundo lote no lo aplica otra vez',async()=>{
  let round=0;
  const f=fixture({api:async()=>({texto:'ok',proposals:round++===0?[pr(1),pr(2)]:[pr(1,{id:'pr-1b',confirm_token:'OTRO1.firma'}),pr(2,{id:'pr-2b',confirm_token:'OTRO2.firma'})],turns:[]})});
  await ask(f);await run(f);
  assert.deepEqual(f.calls.save,['P1','P2']);
  await ask(f,'otra vez');
  const l2=lote(f);
  if(l2){f.post({type:'na-work:card-confirm-all',key:l2.key});await tick(160);}
  assert.deepEqual(f.calls.save,['P1','P2'],'el precio ya no es el «precio_actual» de la propuesta: no es de un toque y no se repite');
  assert.ok(!f.calls.execute.includes('pr-1b')&&!f.calls.execute.includes('pr-2b'),'no se gasta la firma nueva');
});

test('A5-B9) dos toques simultáneos en «Confirmar todo»: cada tarjeta se confirma UNA vez',async()=>{
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1),pr(2),pr(3)],turns:[]})});
  await ask(f);const k=lote(f).key;
  f.post({type:'na-work:card-confirm-all',key:k});f.post({type:'na-work:card-confirm-all',key:k});f.post({type:'na-work:card-confirm-all',key:k});
  await tick(200);
  assert.deepEqual(f.calls.execute,['pr-1','pr-2','pr-3']);assert.deepEqual(f.calls.save,['P1','P2','P3']);
});

test('A5-A4) LÍMITE CONOCIDO (caracterización): «Listo» se decide releyendo el producto LOCAL del POS (motor.product), no una lectura canónica del servidor',()=>{
  const src=readFileSync('POS/js/work-host.js','utf8');
  const body=src.slice(src.indexOf('async function verifySaved'),src.indexOf('async function confirmOnce'));
  assert.match(body,/localProduct\(p\)/);
  assert.doesNotMatch(body,/api\(|fetch\(|canon/i,'si esto falla, alguien añadió la relectura canónica: actualizar el informe de GROKBOT 5');
});

test('A5-A5) P0 pendiente: «Listo» debería exigir confirmación de la escritura CANÓNICA (relectura del servidor o ack de la cola)',{todo:'Hallazgo P0-A: verifySaved (POS/js/work-host.js:392-403) solo relee el producto local; requiere contrato de relectura canónica del Worker'},async()=>{
  const f=fixture({api:async()=>({texto:'ok',proposals:[pr(1)],turns:[]})});
  await ask(f);
  // el POS actualiza su copia local y cierra el formulario, pero la escritura al servidor quedó rechazada/en cola (simulado: sin forma de avisar al host)
  f.root.NA_CANON_WRITE_STATUS={P1:'rejected'};
  f.post({type:'na-work:card-confirm',key:'pr-1'});await tick(80);
  assert.notEqual(cardMsgs(f,'pr-1').pop().state,'done','con la escritura canónica rechazada no debería decir «Listo»');
});
