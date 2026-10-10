import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const legacy=readFileSync('POS/js/legacy-inline/inline-01.js','utf8');
const closingSource=legacy.slice(legacy.includes('function _naRefreshClosingCashTotals(')?legacy.indexOf('function _naRefreshClosingCashTotals('):legacy.indexOf('function prepCierre()'),legacy.indexOf('// ===== VENTAS ====='));
const cacheDeclaration=legacy.match(/let _naClosingCashExpected[^\n]*/)?.[0]||'';
const renderSource=readFileSync('POS/js/legacy-inline/inline-11.js','utf8');
const renderer=renderSource.slice(renderSource.indexOf('cajRender=function()'),renderSource.indexOf("document.getElementById('cajContent')?.addEventListener"));
function harness(){
  const elements=new Map();
  for(const id of ['cierreBox','cajContado','difBanner','difLbl','difVal','mCierre','cajContent']){
    const classes=new Set();elements.set(id,{value:'',innerHTML:'',textContent:'',style:{},classList:{add:x=>classes.add(x),contains:x=>classes.has(x),remove:x=>classes.delete(x)},replaceChildren(){}});
  }
  let scans=0;let expected=100;
  const context=vm.createContext({document:{getElementById:id=>elements.get(id)},cajEstado:{abierta:true,cerrada:false},cajMovs:[],cajTab:'resumen',cajTotales(){scans++;return {ef:expected,ven:expected,egr:0};},fmt:n=>Number(n).toFixed(2),toast(){},isModuleLocked:()=>false,obtenerHoy:()=>'',_naCajaMovsSesion:()=>[],_naSecCashBanner(){},_naSecCashStats(){},_naSecCashActions(){},_naSecCashMovementList(){},updateDashboard(){}});
  vm.runInContext(cacheDeclaration+'\n'+closingSource+'\n'+renderer,context);
  return {context,elements,scans:()=>scans,setExpected:n=>expected=n};
}
test('typing counted cash uses the displayed balance without scanning history again',()=>{
  const h=harness();h.context.prepCierre();const scans=h.scans();
  for(const value of ['1','10','100','100.5','100.50']){h.elements.get('cajContado').value=value;h.context.calcDif();}
  assert.equal(h.scans(),scans,'each keystroke must not recalculate the ledger');
  assert.equal(h.elements.get('difVal').textContent,'+0.50');
});
test('cash refresh updates an open closing dialog without discarding counted cash',()=>{
  const h=harness();h.context.prepCierre();h.elements.get('cajContado').value='100';h.context.calcDif();
  h.setExpected(110);h.context.cajRender();
  assert.equal(h.elements.get('cajContado').value,'100');
  assert.equal(h.elements.get('difVal').textContent,'-10.00');
  assert.match(h.elements.get('cierreBox').innerHTML,/110.00/);
});
test('reopening closing dialog uses current balance and clears old input',()=>{
  const h=harness();h.context.prepCierre();h.elements.get('cajContado').value='100';h.setExpected(200);h.context.prepCierre();
  assert.equal(h.elements.get('cajContado').value,'');h.elements.get('cajContado').value='200';h.context.calcDif();
  assert.equal(h.elements.get('difVal').textContent,'Sin diferencia');
});
