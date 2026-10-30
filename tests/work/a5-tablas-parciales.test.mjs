// GROKBOT 5 (pruebas y calidad), P0-C en WORK: una tabla de consulta que se recorta (30 filas × 8 columnas, o «Mostrando N de M») debe AVISAR
// que es parcial. work-host.js REAL con motor FALSO (tests/helpers/a5-work-host-fixture.mjs). Nivel A, sin modelo ni red ni datos reales.
// Las pruebas {todo} son bugs REALES documentados: fallan a propósito hasta aplicar el arreglo mínimo (ver informe pruebas-calidad-grokbot5.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ask,lastCards} from '../helpers/a5-work-host-fixture.mjs';

const consulta=(rows,cols,result={},query={tipo:'bajo_stock'})=>({id:'q1',type:'consulta',needsConfirm:false,query,
  result:{titulo:'Consulta de prueba',columnas:Array.from({length:cols},(_,i)=>'C'+i),filas:Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>r*10+c)),texto:'texto del servidor',...result}});
const view=async(p)=>{const f=fixture({api:async()=>({texto:'ok',proposals:[p],turns:[]})});await ask(f);return lastCards(f)[0];};
const all=(v)=>[...(v.warnings||[]),v.note||'',v.text||''].join(' | ');

test('A5-T1) caracterización: WORK pinta como máximo 30 filas × 8 columnas y formatea decimales a 2 cifras',async()=>{
  const v=await view(consulta(40,10,{filas:Array.from({length:40},(_,r)=>Array.from({length:10},(_,c)=>c===0?1.005+r:'x'))}));
  assert.equal(v.kind,'table');assert.equal(v.rows.length,30);assert.equal(v.columns.length,8);assert.ok(v.rows.every(r=>r.length===8));
  assert.equal(v.rows[0][0],'1.00'.replace('1.00',(1.005).toFixed(2)),'decimal con 2 cifras');
});
test('A5-T2) sin recorte no hay aviso falso: 10 filas × 3 columnas con total=10 no lleva advertencias',async()=>{
  const v=await view(consulta(10,3,{total:10}));
  assert.equal(v.warnings.length,0);
});
test('A5-T3) `truncado:true` del servidor sí muestra el aviso «solo se leyó una parte» (lo que ya funciona)',async()=>{
  const v=await view(consulta(10,3,{truncado:true}));
  assert.equal(v.warnings.length,1);assert.match(v.warnings[0],/solo se leyó una parte de los datos/);
});
test('A5-T4) más de 30 filas o más de 8 columnas: la tabla recortada debe decir que es PARCIAL',{todo:'BUG P0-C confirmado (POS/js/work-host.js:273-281 readOnlyView): slice(0,30)/slice(0,8) sin ningún aviso. Arreglo mínimo: si filas.length>30 o alguna fila/columnas >8, añadir warning «Se muestran 30 de N filas / 8 de M columnas».'},async()=>{
  const rows=await view(consulta(40,3));
  assert.match(all(rows),/30 de 40|parcial|primeras? 30/i,'40 filas recortadas a 30 sin aviso');
  const cols=await view(consulta(5,10));
  assert.match(all(cols),/8 de 10|parcial|primeras? 8/i,'10 columnas recortadas a 8 sin aviso');
});
test('A5-T5) lista con más filas que las mostradas (bajo_stock: 10 de 50): WORK debe decir «Mostrando 10 de 50» como el asistente clásico',{todo:'BUG P0-C confirmado: work-host.js readOnlyView ignora result.total y el texto del servidor (solo lo usa si hay error); el asistente clásico lo hace en asistente-ui.js:494-520 (qCount). Arreglo mínimo: warning «Mostrando N de M» para tipos cuyo total es cuenta de filas (bajo_stock, sin_costo, creditos_atrasados, deudas_clientes).'},async()=>{
  for(const tipo of ['bajo_stock','sin_costo','creditos_atrasados']){
    const v=await view(consulta(10,4,{total:50},{tipo}));
    assert.match(all(v),/10 de 50/,tipo);
  }
});
test('A5-T6) un total que es DINERO no se confunde con un conteo (ventas: total 220.5 con 10 filas): nunca «Mostrando 10 de 220.5»',async()=>{
  const v=await view(consulta(10,3,{total:220.5},{tipo:'ventas_periodo'}));
  assert.doesNotMatch(all(v),/de 220/);
});
test('A5-T7) error del servidor en una consulta: se muestra el texto simple y NO una tabla vacía con cara de «0 resultados»',async()=>{
  const v=await view(consulta(0,0,{error:'query_failed',texto:'No pude leer esos datos ahora. Revisa la pantalla de reportes.',filas:[],columnas:[]}));
  assert.equal(v.rows.length,0);assert.match(v.text,/No pude leer esos datos ahora/);
});
