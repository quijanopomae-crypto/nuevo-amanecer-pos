// La sonda de rendimiento de caja (#432) solo se descarga bajo demanda: ?perf=1|true|yes o
// localStorage.na_cash_perf = "1". Sin la condición no se pide ni se ejecuta, y tampoco se precachea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const index = readFileSync('POS/index.html', 'utf8');
const sw = readFileSync('POS/sw.js', 'utf8');
const PROBE = 'js/perf/cash-perf-probe.js';

function list(name) {
  const start = sw.indexOf('const ' + name + ' = [');
  assert.ok(start >= 0, 'falta ' + name);
  const block = sw.slice(start, sw.indexOf('];', start));
  return [...block.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
}

function injector() {
  const m = index.match(/<script>(\(function\(\)\{var r=window;[^\n]*cash-perf-probe\.js[^\n]*)<\/script>/);
  assert.ok(m, 'falta el inyector inline de la sonda en index.html');
  return m[1];
}

function run({ search = '', stored = null, throwStorage = false } = {}) {
  const appended = [];
  const body = { appendChild(el) { appended.push(el.src); } };
  const win = {
    location: { search },
    localStorage: {
      getItem(key) { if (throwStorage) throw new Error('storage bloqueado'); return key === 'na_cash_perf' ? stored : null; }
    }
  };
  const doc = { body, documentElement: body, createElement: () => ({ src: '' }) };
  vm.runInNewContext(injector(), { window: win, document: doc, URLSearchParams, Object });
  return { appended, global: win.NA_CASH_PERF };
}

test('index.html ya no carga la sonda con <script src> en cada arranque', () => {
  assert.doesNotMatch(index, /<script[^>]+src=["'][^"']*cash-perf-probe\.js["']/);
  assert.ok(existsSync('POS/' + PROBE), 'el archivo de la sonda sigue existiendo');
});

test('sw.js no precachea la sonda: queda en la lista diferida', () => {
  assert.ok(!list('PRECACHE_URLS').includes(PROBE));
  assert.ok(list('LAZY_URLS').includes(PROBE));
});

test('sin ?perf ni na_cash_perf no se inyecta nada y NA_CASH_PERF queda inactivo', () => {
  for (const opts of [{}, { search: '?perf=0' }, { search: '?x=1' }, { stored: '0' }, { throwStorage: true }]) {
    const { appended, global } = run(opts);
    assert.deepEqual(appended, []);
    assert.equal(global.active, false);
    assert.equal(global.reason, 'gate_off');
    assert.ok(Object.isFrozen(global));
  }
});

test('con ?perf=1|true|yes o na_cash_perf=1 se inyecta la sonda una sola vez', () => {
  for (const opts of [{ search: '?perf=1' }, { search: '?a=b&perf=true' }, { search: '?perf=yes' }, { stored: '1' }]) {
    const { appended, global } = run(opts);
    assert.deepEqual(appended, [PROBE]);
    assert.equal(global, undefined);
  }
});

test('la condición del inyector es la misma que la de la propia sonda', () => {
  const probe = readFileSync('POS/' + PROBE, 'utf8');
  for (const token of ["'1'", "'true'", "'yes'", "'perf'", "'na_cash_perf'"]) {
    assert.ok(probe.includes(token), 'la sonda ya no usa ' + token);
    assert.ok(injector().includes(token), 'el inyector no usa ' + token);
  }
});
