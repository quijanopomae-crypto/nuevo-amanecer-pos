/**
 * FASE 4 cash performance probe (candidate only).
 * Gate: ?perf=1|true|yes OR localStorage.na_cash_perf === "1"
 * When off: no wraps, no marks. Validations untouched.
 *
 * Marks (Performance API + console):
 *   cash_open_t0 … cash_open_t8
 *   cash_close_t0 … cash_close_t8
 *   cash_sale_t0 … cash_sale_t8
 *   cash_prep_close_t0 … (sync)
 *
 * Suggested phase meaning (legacy Path A default):
 *   t0 entry → t1 post-gate/auth → t2 pre-persist → t3 persist-start
 *   → t4 persist-end → t5 post-persist → t6 pre-render → t7 post-render → t8 done
 * Canonical (when enabled): facade wraps prepare/openCash/closeCash/createSale/refresh
 *   with canon_*_start/end marks + phase t2–t5; Object.freeze client is replaced safely.
 */
(function (root) {
  'use strict';
  if (!root || !root.document) return;

  function gated() {
    try {
      var q = new URLSearchParams(root.location.search || '');
      var flag = q.get('perf');
      if (flag === '1' || flag === 'true' || flag === 'yes') return true;
      if (root.localStorage && root.localStorage.getItem('na_cash_perf') === '1') return true;
    } catch (_) {}
    return false;
  }

  if (!gated()) {
    root.NA_CASH_PERF = Object.freeze({ active: false, reason: 'gate_off' });
    return;
  }

  var marks = [];
  var measures = [];
  var activePrefix = null;
  var phase = Object.create(null);

  function now() {
    return (root.performance && typeof root.performance.now === 'function')
      ? root.performance.now()
      : Date.now();
  }

  function mark(name) {
    var ts = now();
    marks.push({ name: name, t: ts });
    try {
      if (root.performance && typeof root.performance.mark === 'function') root.performance.mark(name);
    } catch (_) {}
    try { root.console && root.console.debug && root.console.debug('[cash-perf]', name, ts.toFixed(2)); } catch (_) {}
    return ts;
  }

  function markPhase(n) {
    if (!activePrefix) return;
    var key = activePrefix + '_t' + n;
    if (phase[key]) return;
    phase[key] = true;
    mark(key);
  }

  function measure(name, startMark, endMark) {
    try {
      if (root.performance && typeof root.performance.measure === 'function') {
        root.performance.measure(name, startMark, endMark);
      }
    } catch (_) {}
    var a = marks.filter(function (m) { return m.name === startMark; }).pop();
    var b = marks.filter(function (m) { return m.name === endMark; }).pop();
    if (!a || !b) return null;
    var row = { name: name, ms: b.t - a.t, start: startMark, end: endMark };
    measures.push(row);
    try { root.console && root.console.info && root.console.info('[cash-perf]', name, row.ms.toFixed(1) + 'ms'); } catch (_) {}
    return row;
  }

  function dump(prefix) {
    var related = marks.filter(function (m) { return m.name.indexOf(prefix) === 0; });
    var base = related.length ? related[0].t : 0;
    var table = related.map(function (m) {
      return { mark: m.name, abs_ms: Number(m.t.toFixed(2)), delta_ms: Number((m.t - base).toFixed(2)) };
    });
    try { root.console && root.console.table && root.console.table(table); } catch (_) {}
    return table;
  }

  function wrapNamed(name, fn, isAsync) {
    if (typeof fn !== 'function') return fn;
    if (isAsync) {
      return async function () {
        var prev = activePrefix;
        activePrefix = name;
        phase = Object.create(null);
        markPhase(0);
        markPhase(1);
        var error;
        var result;
        try {
          markPhase(2);
          result = await fn.apply(this, arguments);
        } catch (e) {
          error = e;
        }
        markPhase(5);
        markPhase(6);
        markPhase(7);
        markPhase(8);
        measure(name + '_total', name + '_t0', name + '_t8');
        dump(name);
        activePrefix = prev;
        if (error) throw error;
        return result;
      };
    }
    return function () {
      var prev = activePrefix;
      activePrefix = name;
      phase = Object.create(null);
      markPhase(0);
      markPhase(1);
      markPhase(2);
      var error;
      var result;
      try {
        result = fn.apply(this, arguments);
      } catch (e) {
        error = e;
      }
      markPhase(5);
      markPhase(6);
      markPhase(7);
      markPhase(8);
      measure(name + '_total', name + '_t0', name + '_t8');
      dump(name);
      activePrefix = prev;
      if (error) throw error;
      return result;
    };
  }

  function wrapPersist(fn) {
    if (typeof fn !== 'function') return fn;
    return async function () {
      markPhase(3);
      try {
        var result = await fn.apply(this, arguments);
        markPhase(4);
        return result;
      } catch (e) {
        markPhase(4);
        throw e;
      }
    };
  }

  function wrapRender(fn) {
    if (typeof fn !== 'function') return fn;
    return function () {
      markPhase(6);
      try {
        return fn.apply(this, arguments);
      } finally {
        markPhase(7);
      }
    };
  }

  function wrapClientMethod(obj, key, startPhase, endPhase, markName) {
    if (!obj || typeof obj[key] !== 'function') return;
    var original = obj[key];
    obj[key] = function () {
      if (markName) mark('canon_' + markName + '_start');
      markPhase(startPhase);
      var ret = original.apply(this, arguments);
      function done() {
        markPhase(endPhase);
        if (markName) mark('canon_' + markName + '_end');
      }
      if (ret && typeof ret.then === 'function') {
        return ret.then(function (value) {
          done();
          if (markName) {
            measure('canon_' + markName, 'canon_' + markName + '_start', 'canon_' + markName + '_end');
          }
          return value;
        }, function (err) {
          done();
          if (markName) {
            measure('canon_' + markName, 'canon_' + markName + '_start', 'canon_' + markName + '_end');
          }
          throw err;
        });
      }
      done();
      if (markName) {
        measure('canon_' + markName, 'canon_' + markName + '_start', 'canon_' + markName + '_end');
      }
      return ret;
    };
  }

  function instrumentCanonicalClient() {
    var client = root.NuevoAmanecerCanonical;
    if (!client || client.__naCashPerfWrapped) return !!client;
    // NuevoAmanecerCanonical is Object.freeze'd — replace the window binding with a facade.
    var facade = {};
    try {
      Object.keys(client).forEach(function (key) { facade[key] = client[key]; });
    } catch (_) {
      return false;
    }
    wrapClientMethod(facade, 'prepareCommand', 2, 3, 'prepare');
    wrapClientMethod(facade, 'openCash', 3, 4, 'openCash');
    wrapClientMethod(facade, 'closeCash', 3, 4, 'closeCash');
    wrapClientMethod(facade, 'createSale', 3, 4, 'createSale');
    wrapClientMethod(facade, 'refresh', 5, 5, 'refresh');
    facade.__naCashPerfWrapped = true;
    try {
      root.NuevoAmanecerCanonical = Object.freeze(facade);
    } catch (_) {
      try { root.NuevoAmanecerCanonical = facade; } catch (__) { return false; }
    }
    return true;
  }

  function instrument() {
    if (typeof root.abrirCaja === 'function') root.abrirCaja = wrapNamed('cash_open', root.abrirCaja, true);
    if (typeof root.cerrarCaja === 'function') root.cerrarCaja = wrapNamed('cash_close', root.cerrarCaja, true);
    if (typeof root.prepCierre === 'function') root.prepCierre = wrapNamed('cash_prep_close', root.prepCierre, false);
    if (typeof root.confirmarVenta === 'function') root.confirmarVenta = wrapNamed('cash_sale', root.confirmarVenta, true);
    if (typeof root.guardarMovCaja === 'function') root.guardarMovCaja = wrapNamed('cash_mov', root.guardarMovCaja, true);

    if (typeof root.saveAllData === 'function') root.saveAllData = wrapPersist(root.saveAllData);
    if (typeof root.cajRender === 'function') root.cajRender = wrapRender(root.cajRender);

    var canonWrapped = instrumentCanonicalClient();

    try {
      root.console && root.console.info && root.console.info(
        '[cash-perf] ACTIVE — open DevTools Performance / Console; NA_CASH_PERF.dump("cash_open")' +
        (canonWrapped ? ' · canonical facade wrapped (prepare/openCash/closeCash/createSale/refresh)' : ' · canonical client not present yet')
      );
    } catch (_) {}
  }

  root.setTimeout(instrument, 0);

  root.NA_CASH_PERF = Object.freeze({
    active: true,
    mark: mark,
    measure: measure,
    dump: dump,
    getMarks: function () { return marks.slice(); },
    getMeasures: function () { return measures.slice(); },
    reinstrument: instrument,
    instrumentCanonical: instrumentCanonicalClient
  });
})(globalThis);
