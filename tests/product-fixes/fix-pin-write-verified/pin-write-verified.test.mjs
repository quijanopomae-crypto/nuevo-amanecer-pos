// Crear el PIN maestro no debe anunciar «PIN activado» si la escritura local falla o no se puede verificar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const inline02 = readFileSync(new URL('../../../POS/js/legacy-inline/inline-02.js', import.meta.url), 'utf8');
const grab = re => { const m = inline02.match(re); assert.ok(m, 'fragmento no encontrado: ' + re); return m[0]; };

function sandbox({ writable = true, corrupt = false } = {}) {
  const store = new Map(), toasts = [], audits = [];
  const ctx = {
    SECURITY_KEY: 'na_security_test', toasts, audits, store,
    localStorage: {
      setItem(k, v) { if (!writable) throw new Error('QuotaExceededError'); store.set(k, corrupt ? v + 'x' : v); },
      getItem(k) { return store.has(k) ? store.get(k) : null; }
    },
    sessionStorage: { removeItem() {} },
    console: { warn() {} },
    structuredClone,
    prompt: () => '1234',
    toast: (msg, kind) => toasts.push([msg, kind || 'info']),
    _naAudit: a => audits.push(a), _naResetAutoLockTimer() {}, renderCfgContent() {},
    _naSecHash: v => 'h' + v,
    _naClone: v => JSON.parse(JSON.stringify(v)),
    saveAppState: () => null
  };
  vm.createContext(ctx);
  vm.runInContext([
    'let _naSecurity={pinEnabled:false,pinHash:"",rules:{auditEnabled:true},requirePin:{},logs:[]};',
    grab(/function _naWriteSecurityVerified\(\)\{[^\n]+/), grab(/function _naSaveSecurity\(persist=true\)\{[^\n]+/),
    grab(/function securitySetPin\(\)\{[^\n]+/),
    'this.get=()=>_naSecurity;'
  ].join('\n'), ctx);
  return ctx;
}

test('PIN: con almacenamiento sano se activa, se guarda y se avisa', () => {
  const s = sandbox();
  assert.equal(s.securitySetPin(), true);
  assert.equal(s.get().pinEnabled, true);
  assert.equal(JSON.parse(s.store.get('na_security_test')).pinHash, 'h1234');
  assert.deepEqual(s.toasts.at(-1), ['PIN maestro activado', 'success']);
});

test('PIN: si la escritura lanza error NO se anuncia éxito y la configuración vuelve a su estado previo', () => {
  const s = sandbox({ writable: false });
  assert.equal(s.securitySetPin(), false);
  assert.equal(s.get().pinEnabled, false);
  assert.equal(s.get().pinHash, '');
  assert.deepEqual(s.toasts.at(-1), ['No se pudo guardar el PIN en este dispositivo', 'error']);
  assert.ok(!s.toasts.some(t => /PIN maestro activado/.test(t[0])));
  assert.equal(s.audits.length, 0, 'no se audita una configuración que no quedó guardada');
});

test('PIN: si la relectura no coincide (escritura no verificable) tampoco se anuncia éxito', () => {
  const s = sandbox({ corrupt: true });
  assert.equal(s.securitySetPin(), false);
  assert.equal(s.get().pinEnabled, false);
  assert.deepEqual(s.toasts.at(-1), ['No se pudo guardar el PIN en este dispositivo', 'error']);
});
