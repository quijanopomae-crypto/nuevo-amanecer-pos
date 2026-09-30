import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('POS/js/legacy-inline/inline-02.js', 'utf8').replace(/\r\n/g,'\n');
function harness() {
  const values = new Map();
  const context = vm.createContext({ localStorage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) },
    SECURITY_KEY:'na_security_v26', _naSecMerge: raw => ({ pinEnabled:false, pinHash:'', ...raw }),
    _naValidSnapshot: () => true, _naMerge: (a,b) => b, _naDefaults:{}, _naEnsureCashierConfig(){},
    _naApplyLocks(){}, storage:{setItem(){}}, console,
    NuevoAmanecerCanonical:{enabled:()=>true}, saveAppState:()=>({durable:false,error:'CANONICAL_LEGACY_PERSISTENCE_BLOCKED'}),
    _naSecurity:{pinEnabled:true,pinHash:'synthetic-hash'}, cajEstado:{}, currentCfgCategory:'control' });
  for (const name of ['_naLoadSecurity','_naSaveSecurity','_naApplySnapshot']) {
    const start=source.indexOf(`function ${name}(`), next=source.indexOf('\n}',start);
    const line=source.slice(start,source.indexOf('\n',start));
    vm.runInContext(line.endsWith('}') ? line : source.slice(start,next+2),context);
  }
  return {context,values};
}
const stale = { security:{pinEnabled:false,pinHash:''}, data:{productos:[],ventas:[],clientes:[],creditos:[],gastos:[],cajMovs:[]} };
test('CANON security save is durable and reload cannot replace it with stale snapshot security',()=>{
  const {context:c}=harness();
  assert.equal(c._naSaveSecurity().durable,true);
  c._naSecurity=c._naLoadSecurity();
  c._naApplySnapshot(stale,true,true);
  assert.equal(c._naSecurity.pinEnabled,true);
  assert.equal(c._naSecurity.pinHash,'synthetic-hash');
});
test('explicit restore still applies snapshot security',()=>{
  const {context:c}=harness(); c._naSaveSecurity();
  c._naApplySnapshot(stale,true);
  assert.equal(c._naSecurity.pinEnabled,false);
});
test('unwritable security storage cannot report durable success',()=>{
  const {context:c}=harness();
  c.localStorage.setItem=()=>{throw new Error('Storage unavailable');};
  assert.equal(c._naSaveSecurity().durable,false);
});
