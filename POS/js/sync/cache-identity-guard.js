/* Caché local atada a la identidad (T-47 S3).
   La réplica canónica en caché (na_snapshot_v9 en localStorage, su copia de sessionStorage e
   IndexedDB NuevoAmanecerPOS/state/snapshot_v9) guarda gastos con notas, costos y
   proveedor/factura de quien la descargó. Si el navegador cambia de identidad (reactivación o
   vinculación con otro token, o el servidor confirma otro aparato/rol), esa caché NO debe llegar
   a la nueva sesión, ni siquiera sin conexión.
   - Etiqueta na_cache_identity_v1 = { fp, role, device_id }. fp es una huella del token guardado
     (el token ya está en claro en na_cloud_sync_credentials; la huella solo sirve para comparar).
   - Al arrancar (antes de loadAllData) y al activar/vincular: si la huella no coincide, se DEPURA: se quitan
     costos, proveedor/factura, gastos, cierres, ajustes y movimientos, pero se conserva el catálogo (precios,
     stock), clientes, créditos y ventas para vender sin conexión. Lo que no se puede depurar con seguridad se borra.
   - Falla cerrada si IndexedDB no responde, da error o está bloqueada: no se escribe la etiqueta (se reintenta en
     el próximo arranque) y en esta carga no se lee ni la réplica ni el snapshot de IndexedDB.
   - Los campos quitados quedan AUSENTES (nunca 0).
   - Caché heredada sin etiqueta: solo se conserva si el rol en caché es «owner» (confirmado por el
     servidor con este token); en otro caso se purga (falla cerrada).
   - Cuando /auth/me confirma aparato y rol: si difieren de la etiqueta, se depura (también la memoria) y se pide relectura.
   - La purga NO toca colas ni pendientes: na_canonical_sale_outbox_v1, na_canonical_sale_journal,
     cuarentenas, cloudSync del snapshot, compras/notas pendientes. Solo réplica y datos restringidos. */
(function (root) {
  'use strict';
  var TAG = 'na_cache_identity_v1', CRED = 'na_cloud_sync_credentials', ROLE = 'na_pos_role_v1';
  var LOCAL_SNAPSHOTS = ['na_snapshot_v9'], SESSION_SNAPSHOTS = ['na_snapshot_v9_session', 'na_snapshot_v9'];
  // Cachés que solo existen para el dueño o contienen costos/estado completo del usuario anterior.
  // na_snapshot_v10 (+ conflictos): V10 inactivo, forma no garantizada => se borra entero (falla cerrada).
  // na_device_revoked_v1 pertenece a la sesión anterior (pos-roles-client.js:74): no debe mostrarse a la nueva.
  var LOCAL_DROP = ['na_price_history_v1', 'na_pos_reviews_cache_v1', 'na_pre_restore_snapshot_v1', 'na_gastos', 'na_snapshot_v10', 'na_device_revoked_v1'];
  var LOCAL_DROP_PREFIX = ['na_snapshot_v10_conflict_'];
  var SESSION_DROP = ['na_pre_restore_snapshot_v1_session'];
  var IDB_NAME = 'NuevoAmanecerPOS', IDB_STORE = 'state', IDB_KEY = 'snapshot_v9';
  var RESTRICTED = /^(costo\w*|cost|cost_cents|unit_cost_cents|avg_cost_cents|supplier\w*|proveedor\w*|document_ref|invoice\w*|factura\w*|ganancia\w*|utilidad\w*|margen|profit\w*)$/i;
  // Cierres de caja: lo contado/esperado/diferencia y quién cerró (cash_sessions canónicas y cajEstado heredado).
  var CLOSE_FIELDS = /^(counted_cents|expected_cents|difference_cents|closed_by\w*|closing_watermark|contado|esperado|diferencia|horaCierre\w*)$/;
  // Movimientos de caja de la vista heredada que son gastos, egresos o ajustes del dueño (canonical-ui-adapter.js:514-535, :606-619).
  function restrictedCashMove(m) { return !m || typeof m !== 'object' || m.tipo === 'gas' || m.tipo === 'egr' || m.tipo === 'aju' || m.expenseId != null || m.cat === 'Ajuste' || m.cat === 'Compensación'; }
  function stripClose(value) {
    if (Array.isArray(value)) { var c = false; value.forEach(function (x) { if (stripClose(x)) c = true; }); return c; }
    if (!value || typeof value !== 'object') return false;
    var hit = false; Object.keys(value).forEach(function (k) { if (CLOSE_FIELDS.test(k)) { delete value[k]; hit = true; } }); return hit;
  }
  // cash_sessions canónicas: además, la caja ABIERTA lleva expected_withheld (sin monto) para que openSession()
  // de canonical-client.js la acepte: el esperado incluye los gastos en efectivo, así que nunca se conserva.
  function stripSessions(list) { var hit = stripClose(list || []); (list || []).forEach(function (s) { if (s && s.status === 'OPEN' && s.expected_withheld !== true) { s.expected_withheld = true; hit = true; } }); return hit; }
  function filterCashMoves(list) { if (!Array.isArray(list)) return false; var n = list.length; for (var i = list.length - 1; i >= 0; i--) if (restrictedCashMove(list[i])) list.splice(i, 1); return list.length !== n; }
  // financial_events: se conservan los cobros de crédito y sus anulaciones (las necesitan los saldos de crédito,
  // canonical-ui-adapter.js compensationsByTarget). Se quitan ajustes y compensaciones de dinero (decisión D3).
  function filterFinancial(list) { if (!Array.isArray(list)) return false; var n = list.length; for (var i = list.length - 1; i >= 0; i--) { var e = list[i]; if (!e || !(e.event_type === 'PAYMENT' || e.credit_id != null)) list.splice(i, 1); } return list.length !== n; }
  var state = { decision: null, purges: [], ready: null };

  function ls() { try { return root.localStorage || null; } catch (_) { return null; } }
  function ss() { try { return root.sessionStorage || null; } catch (_) { return null; } }
  function readJSON(store, key) { try { var raw = store && store.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
  // Huella no criptográfica (FNV-1a 2×32 bits). Solo compara identidades: no protege el token.
  function fingerprint(token) {
    var a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    for (var i = 0; i < token.length; i++) { var c = token.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; b ^= b >>> 13; }
    return 'f1:' + ('0000000' + a.toString(16)).slice(-8) + ('0000000' + (b >>> 0).toString(16)).slice(-8);
  }
  function currentFp() { var c = readJSON(ls(), CRED); return c && typeof c.token === 'string' && c.token ? fingerprint(c.token) : null; }
  function readTag() { var t = readJSON(ls(), TAG); return t && t.v === 1 && typeof t.fp === 'string' ? t : null; }
  function writeTag(fp, role, deviceId, why) {
    try { ls().setItem(TAG, JSON.stringify({ v: 1, fp: fp, role: role || null, device_id: deviceId || null, why: why || null, at: Date.now() })); } catch (_) {}
  }
  function strip(value) {
    if (Array.isArray(value)) { var changed = false; value.forEach(function (x) { if (strip(x)) changed = true; }); return changed; }
    if (!value || typeof value !== 'object') return false;
    var hit = false;
    Object.keys(value).forEach(function (k) { if (RESTRICTED.test(k)) { delete value[k]; hit = true; } else if (value[k] && typeof value[k] === 'object' && strip(value[k])) hit = true; });
    return hit;
  }
  // Réplica canónica (canonical-client.js replicaOf, schema 2): es el catálogo offline en modo canónico.
  // Se depura EN SU LUGAR: sin costos (products, sale_items), sin gastos y sin movimientos de inventario
  // (su `reason` lleva proveedor y factura en texto libre). Se borran los sellos de validación remota y los
  // digests: así la réplica sigue pasando validReplica() pero nunca califica para la re-confirmación rápida
  // (fastRevalidationCandidate / cacheMatchesStatus) y la siguiente lectura con red es completa y reemplaza todo.
  // Falla cerrada: si el esquema no es el conocido, la réplica se borra entera.
  var REPLICA_SCHEMA = 2;
  function scrubReplica(snap) {
    var r = snap.canonicalReplica;
    if (!r || typeof r !== 'object' || Array.isArray(r) || r.schema_version !== REPLICA_SCHEMA || !Array.isArray(r.products)) { delete snap.canonicalReplica; return true; }
    if (r.identity_scrubbed_at && !r.remote_validated_at) {
      // Ya depurada y sin relectura desde entonces: solo verificar que no volvieron datos restringidos.
      var again = strip(r.products) | strip(r.sale_items || []) | stripSessions(r.cash_sessions) | filterFinancial(r.financial_events);
      if ((r.expenses || []).length || (r.inventory_movements || []).length) { r.expenses = []; r.inventory_movements = []; again = 1; }
      return !!again;
    }
    strip(r.products); strip(r.sale_items || []); stripSessions(r.cash_sessions); filterFinancial(r.financial_events);
    r.expenses = []; r.inventory_movements = [];
    delete r.remote_validated_at; delete r.remote_validated_context; delete r.remote_validated_build;
    r.digests = {}; r.canonical_digest = null;
    r.identity_scrubbed_at = new Date().toISOString();
    return true;
  }
  // Depura el snapshot: réplica canónica en su lugar y datos restringidos del modo heredado.
  // Conserva catálogo con precios y stock, clientes, créditos, ventas, cloudSync, carrito (sin costos) y config.
  function scrubSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return false;
    var changed = false;
    if (Object.prototype.hasOwnProperty.call(snap, 'canonicalReplica') && scrubReplica(snap)) changed = true;
    var d = snap.data;
    if (d && typeof d === 'object') {
      ['gastos', 'cashClosures', 'inventoryMovements'].forEach(function (k) { if (Array.isArray(d[k]) && d[k].length) { d[k] = []; changed = true; } });
      if (strip(d.productos)) changed = true;
      if (strip(d.ventas)) changed = true;
      if (filterCashMoves(d.cajMovs)) changed = true;
      if (stripClose(d.cajEstado)) changed = true;
    }
    if (strip(snap.cart)) changed = true;
    if (strip(snap.draft)) changed = true;
    return changed;
  }
  function rewrite(store, key, out, where) {
    if (!store) return;
    var raw; try { raw = store.getItem(key); } catch (_) { return; }
    if (!raw) return;
    var snap; try { snap = JSON.parse(raw); } catch (_) { try { store.removeItem(key); out.push(where + key + ':removed-unparseable'); } catch (_) {} return; }
    if (!scrubSnapshot(snap)) return;
    try { store.setItem(key, JSON.stringify(snap)); out.push(where + key + ':scrubbed'); }
    catch (_) { try { store.removeItem(key); out.push(where + key + ':removed'); } catch (_) {} }
  }
  function purgeStorageSync(out) {
    var l = ls(), s = ss();
    LOCAL_SNAPSHOTS.forEach(function (k) { rewrite(l, k, out, 'localStorage.'); });
    SESSION_SNAPSHOTS.forEach(function (k) { rewrite(s, k, out, 'sessionStorage.'); });
    LOCAL_DROP.forEach(function (k) { try { if (l && l.getItem(k) !== null) { l.removeItem(k); out.push('localStorage.' + k + ':removed'); } } catch (_) {} });
    SESSION_DROP.forEach(function (k) { try { if (s && s.getItem(k) !== null) { s.removeItem(k); out.push('sessionStorage.' + k + ':removed'); } } catch (_) {} });
    try { if (l) for (var i = l.length - 1; i >= 0; i--) { var key = l.key(i); if (key && LOCAL_DROP_PREFIX.some(function (pre) { return key.indexOf(pre) === 0; })) { l.removeItem(key); out.push('localStorage.' + key + ':removed'); } } } catch (_) {}
    // Claves heredadas (pre-v9, _naLegacySnapshot inline-02.js:420): sin costos, sin gastos/ajustes de caja, sin cierre.
    [['na_productos', strip], ['na_ventas', strip], ['na_cajMovs', filterCashMoves], ['na_cajEstado', stripClose]].forEach(function (e) {
      try { var v = readJSON(l, e[0]); if (v && e[1](v)) { l.setItem(e[0], JSON.stringify(v)); out.push('localStorage.' + e[0] + ':scrubbed'); } } catch (_) { try { l.removeItem(e[0]); out.push('localStorage.' + e[0] + ':removed'); } catch (__) {} }
    });
  }
  // Almacenes IndexedDB atados a la identidad. Modos:
  //  - 'scrub': cada clave de `keys` es un snapshot V9 al que se le quitan réplica y datos restringidos.
  //  - 'clear': caché descartable; se vacía entera al cambiar de identidad.
  //  - 'hide' : datos que NO se pueden borrar (p. ej. el diario futuro de operaciones confirmadas de
  //    SPEC-restauracion.md, necesario para recuperar tras una restauración). El guardián no lo toca:
  //    quien lo lea debe pasar cada registro por visible(record) / visibleRecords(list), que oculta lo
  //    que no lleve la huella (identity_fp) de la identidad actual. Ocultar NO protege contra devtools.
  // Se registran con registerStore({ db, store, mode, keys? }).
  //  - 'drop' : borra solo las claves `keys` del almacén (uso interno, V10).
  // V10 usa la MISMA BD NuevoAmanecerPOS (inline-17.js:16): state/snapshot_v10 y checkpoints guardan snapshots completos.
  // operations (V10) son operaciones pendientes: no se tocan.
  var IDB_TARGETS = [{ db: IDB_NAME, store: IDB_STORE, mode: 'scrub', keys: [IDB_KEY] },
    { db: IDB_NAME, store: IDB_STORE, mode: 'drop', keys: ['snapshot_v10'] },
    { db: IDB_NAME, store: 'checkpoints', mode: 'clear' }];
  var HOOKS = [];
  function registerStore(target) {
    if (!target || typeof target.db !== 'string' || typeof target.store !== 'string' || ['scrub', 'clear', 'hide', 'drop'].indexOf(target.mode) === -1) throw new Error('CACHE_IDENTITY_INVALID_STORE');
    IDB_TARGETS.push(target);
    if (target.mode === 'hide') return state.ready;
    // Registrado después del arranque: 'clear'/'scrub' se aplican si este arranque ya purgó.
    var fp = currentFp(), purged = /scrubbed$/.test(String(state.decision || ''));
    if (fp && purged) {
      var out = []; state.purges.push({ reason: 'late-register:' + target.db + '.' + target.store, at: Date.now(), removed: out });
      var run = function () { return purgeTarget(target, fp, out).then(function (r) { if (!r.ok) state.failClosed = true; }); };
      state.ready = Promise.resolve(state.ready).then(run, run);
    }
    return state.ready;
  }
  function onPurge(hook) { if (typeof hook === 'function') HOOKS.push(hook); }
  // IndexedDB: nunca crea la base (si no existe se aborta la creación) ni cambia su versión.
  // Resuelve { ok }. ok:false si IndexedDB no respondió (timeout 2 s), dio error, quedó bloqueada (otra pestaña
  // con la BD abierta) o abortó la transacción: entonces la purga NO está hecha y check() falla cerrado.
  function purgeTarget(target, fp, out) {
    return new Promise(function (resolve) {
      var idb; try { idb = root.indexedDB; } catch (_) { idb = null; }
      if (!idb) return resolve({ ok: true });
      var where = 'indexedDB.' + target.db + '.' + target.store;
      var settled = false, timer = null;
      var finish = function (ok, why) { if (settled) return; settled = true; if (timer) clearTimeout(timer); if (why) out.push(where + ':' + why); resolve({ ok: ok }); };
      timer = setTimeout(function () { finish(false, 'timeout'); }, 2000);
      var req; try { req = idb.open(target.db); } catch (_) { return finish(false, 'error'); }
      // BD inexistente: se aborta su creación; el error que sigue no es una falla (no hay nada que purgar).
      req.onupgradeneeded = function () { req.__naNoDb = true; try { req.transaction.abort(); } catch (_) {} };
      req.onerror = function (ev) {
        if (req.__naNoDb) { try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (_) {} return finish(true, null); }
        finish(false, 'error');
      };
      req.onblocked = function () { finish(false, 'blocked'); };
      req.onsuccess = function () {
        var db = req.result;
        if (settled) { try { db.close(); } catch (_) {} return; }
        try {
          if (!db.objectStoreNames.contains(target.store)) { db.close(); return finish(true, null); }
          var tx = db.transaction(target.store, 'readwrite'), st = tx.objectStore(target.store);
          if (target.mode === 'clear') { st.clear(); out.push(where + ':cleared'); }
          else if (target.mode === 'drop') (target.keys || []).forEach(function (key) { st.delete(key); out.push(where + ':' + key + ':dropped'); });
          else (target.keys || []).forEach(function (key) {
            var g = st.get(key); g.onsuccess = function () { var snap = g.result; if (snap && scrubSnapshot(snap)) { st.put(snap, key); out.push(where + ':' + key + ':scrubbed'); } };
          });
          tx.oncomplete = function () { try { db.close(); } catch (_) {} finish(true, null); };
          tx.onabort = tx.onerror = function () { try { db.close(); } catch (_) {} finish(false, 'abort'); };
        } catch (_) { try { db.close(); } catch (__) {} finish(false, 'error'); }
      };
    });
  }
  function purgeIDB(out) {
    var fp = currentFp(), failedDb = {};
    return IDB_TARGETS.filter(function (t) { return t.mode !== 'hide'; })
      .reduce(function (chain, target) {
        return chain.then(function (ok) {
          // Una BD que ya falló no se reintenta en esta purga (evita sumar 2 s por almacén en un aparato lento).
          if (failedDb[target.db]) { out.push('indexedDB.' + target.db + '.' + target.store + ':skipped'); return false; }
          return purgeTarget(target, fp, out).then(function (r) { if (!(r && r.ok)) failedDb[target.db] = true; return ok && !!(r && r.ok); });
        });
      }, Promise.resolve(true));
  }
  // Ocultar por identidad (modo 'hide'): sin credenciales (modo local, dueño) todo es visible;
  // con credenciales solo lo que lleve la huella actual. Registros sin huella: ocultos (falla cerrada).
  function visible(record) { var fp = currentFp(); return !fp || !!(record && record.identity_fp === fp); }
  function visibleRecords(list) { return (Array.isArray(list) ? list : []).filter(visible); }
  // Antes de tocar el almacenamiento (síncrono, también en onConfirmed): canonical-client.js descarta la memoria,
  // la base/sellos y lo parcial de la identidad anterior, y toda lectura o escritura suya en vuelo queda anulada.
  function resetCanonical() { try { var c = root.NuevoAmanecerCanonical; if (c && typeof c.resetForIdentityChange === 'function') c.resetForIdentityChange(); } catch (_) {} }
  function purge(reason) {
    resetCanonical();
    var out = [], entry = { reason: reason, at: Date.now(), removed: out };
    state.purges.push(entry);
    purgeStorageSync(out);
    return purgeIDB(out).then(function (ok) {
      entry.ok = ok;
      if (!ok) { state.failClosed = true; return entry; }
      HOOKS.forEach(function (hook) { try { hook({ reason: reason, fp: currentFp() }); } catch (_) {} });
      return entry;
    });
  }
  // Decide con la identidad guardada (sin red). Devuelve una promesa que termina tras la purga.
  function check(source) {
    var fp = currentFp();
    if (!fp) { state.decision = 'no-credentials'; return Promise.resolve(state.decision); }
    var tag = readTag();
    if (tag && tag.fp === fp) { state.decision = 'match'; return Promise.resolve(state.decision); }
    if (!tag) {
      var cached = readJSON(ls(), ROLE);
      if (cached && cached.role === 'owner') { writeTag(fp, 'owner', null, 'legacy-owner'); state.decision = 'legacy-owner-adopted'; return Promise.resolve(state.decision); }
      state.decision = 'legacy-untagged-scrubbed';
    } else state.decision = 'identity-changed-scrubbed';
    var decision = state.decision;
    return purge(decision + ':' + (source || 'boot')).then(function (entry) {
      // IndexedDB sin purgar: sin etiqueta (se reintenta en el próximo arranque) y lectura IDB/réplica anulada en esta carga.
      if (!entry.ok) { state.decision = decision.replace(/-scrubbed$/, '-idb-failed'); return state.decision; }
      state.failClosed = false; writeTag(fp, null, null, decision); return decision;
    });
  }
  // Memoria de la página: globals clásicos (let) de inline-02.js, referenciados directamente (sin eval: compatible con
  // una CSP sin 'unsafe-eval'). typeof evita ReferenceError fuera de la app (lanzador, pruebas). Al confirmar otra
  // identidad con la app abierta se vacían de inmediato gastos, cierres, movimientos, costos y cierre de caja, y se
  // vuelve a pintar, sin esperar a refresh(). No cambia la UI: solo vacía datos y usa el render existente.
  var MEMORY_PAGES = ['pageMenu', 'pagePOS', 'pageInventario', 'pageGastos', 'pageCaja', 'pageVentas'];
  function clearMemory() {
    var out = [];
    function empty(name, a) { if (Array.isArray(a) && a.length) { a.length = 0; out.push(name); } }
    function scrub(name, a, fn) { if (a && fn(a)) out.push(name); }
    /* global gastos, cashClosures, inventoryMovements, productos, cart, ventas, cajMovs, cajEstado */
    try { if (typeof gastos !== 'undefined') empty('gastos', gastos); } catch (_) {}
    try { if (typeof cashClosures !== 'undefined') empty('cashClosures', cashClosures); } catch (_) {}
    try { if (typeof inventoryMovements !== 'undefined') empty('inventoryMovements', inventoryMovements); } catch (_) {}
    try { if (typeof productos !== 'undefined') scrub('productos', productos, strip); } catch (_) {}
    try { if (typeof cart !== 'undefined') scrub('cart', cart, strip); } catch (_) {}
    try { if (typeof ventas !== 'undefined') scrub('ventas', ventas, strip); } catch (_) {}
    try { if (typeof cajMovs !== 'undefined') scrub('cajMovs', cajMovs, filterCashMoves); } catch (_) {}
    try { if (typeof cajEstado !== 'undefined') scrub('cajEstado', cajEstado, stripClose); } catch (_) {}
  // Re-pinta con los renderizadores existentes (también pantallas ya pintadas y ocultas).
    if (typeof root._naRenderPageNow === 'function') MEMORY_PAGES.forEach(function (id) { try { if (root.document.getElementById(id)) root._naRenderPageNow(id); } catch (_) {} });
    state.memoryCleared = out;
    return out;
  }
  // Entre la confirmación y la relectura del servidor, la proyección canónica→vista heredada no debe volver a
  // traer de la memoria de canonical-client.js los gastos/costos del dueño. Filtro temporal; se apaga al terminar refresh().
  function filterProjection() {
    var base = root._naApplyCanonicalLegacyView;
    if (typeof base !== 'function' || base.__naCacheIdentity) return;
    var wrapped = function (canonical) {
      state.projections = (state.projections || 0) + 1;
      if (state.memoryFilter && canonical && typeof canonical === 'object') {
        state.filtered = (state.filtered || 0) + 1;
        canonical.expenses = []; canonical.inventoryMovements = [];
        strip(canonical.products); strip(canonical.sales); filterCashMoves(canonical.cashMovements); stripClose(canonical.cashState);
      }
      return base.apply(this, arguments);
    };
    wrapped.__naCacheIdentity = true; root._naApplyCanonicalLegacyView = wrapped;
    // canonical-sale-view.js rebuild() (síncrono, en estos eventos) vuelve a poner productos desde la memoria de
    // canonical-client.js con runtime.setProducts. Este oyente se registra después, así que corre después y depura otra vez.
    if (!state.viewListener) {
      state.viewListener = true;
      ['na:canonical-updated', 'na:canonical-sale-projection', 'na:canonical-sale-receipt', 'storage'].forEach(function (name) {
        try { root.addEventListener(name, function () { if (state.memoryFilter) clearMemory(); }); } catch (_) {}
      });
    }
  }
  // Identidad confirmada por el servidor (/auth/me): aparato o rol distintos a la etiqueta => purga.
  function onConfirmed() {
    var r = root.NA_ROLES; if (!r || !r.confirmed || !r.deviceId) return;
    var fp = currentFp(); if (!fp) return;
    var role = r.role === 'owner' || r.role === 'empleado' ? r.role : null, tag = readTag();
    var mismatch = !tag || tag.fp !== fp || (tag.device_id && tag.device_id !== r.deviceId) || (tag.role && role && tag.role !== role);
    if (!mismatch) { if (!tag.device_id || tag.role !== role) writeTag(fp, role, r.deviceId, 'confirmed'); return; }
    // Empleado: filtro en memoria hasta que termine el refresh() pedido aquí; si falla, sigue (falla cerrada) hasta recargar.
    if (role !== 'owner') { state.memoryFilter = true; filterProjection(); clearMemory(); } else state.memoryFilter = false;
    purge('confirmed-identity-changed').then(function (entry) {
      if (!entry.ok) return; // IndexedDB sin purgar: sin etiqueta; se reintenta al próximo arranque o confirmación.
      state.failClosed = false;
      writeTag(fp, role, r.deviceId, 'confirmed');
      try {
        var c = root.NuevoAmanecerCanonical;
        // Lectura COMPLETA forzada: descarta lo parcial/afterCommit, la base y los sellos de la identidad anterior.
        var read = c && (typeof c.refreshFull === 'function' ? function () { return c.refreshFull({ identityChanged: true, repurge: function () { return purge('confirmed-inflight-settled'); } }); } : typeof c.refresh === 'function' ? function () { return c.refresh(); } : null);
        if (read) read().then(function () { state.memoryFilter = false; }, function () {});
      } catch (_) {}
    });
  }

  state.ready = check('boot');
  // La app lee la caché en loadAllData() y la réplica en _naReadCanonicalReplica(): ambas esperan la purga.
  function gate(name) {
    var base = root[name];
    if (typeof base !== 'function' || base.__naCacheIdentity) return;
    var wrapped = function () { var self = this, args = arguments; return state.ready.then(function () { return base.apply(self, args); }, function () { return base.apply(self, args); }); };
    wrapped.__naCacheIdentity = true; root[name] = wrapped;
  }
  // Falla cerrada (purga IDB incompleta): en esta carga la réplica y el snapshot de IndexedDB no se leen.
  function gateFailClosed(name) {
    var base = root[name];
    if (typeof base !== 'function' || base.__naCacheIdentityFC) return;
    var wrapped = function () { var self = this, args = arguments; return Promise.resolve(state.ready).then(null, function () {}).then(function () { return state.failClosed ? null : base.apply(self, args); }); };
    wrapped.__naCacheIdentity = base.__naCacheIdentity; wrapped.__naCacheIdentityFC = true; root[name] = wrapped;
  }
  gate('loadAllData'); gate('_naReadCanonicalReplica');
  gateFailClosed('_naReadCanonicalReplica'); gateFailClosed('_naReadIDBSnapshot');
  try { root.addEventListener('na:role', onConfirmed); } catch (_) {}

  root.NuevoAmanecerCacheIdentity = {
    // Idempotente: espera a la comprobación en curso (p. ej. la de arranque al cargar en el lanzador) y
    // vuelve a decidir con la etiqueta ya escrita, así una misma identidad no se depura dos veces.
    check: function (source) { var run = function () { return check(source); }; state.ready = Promise.resolve(state.ready).then(run, run); return state.ready; },
    clearMemory: clearMemory,
    purge: purge, scrubSnapshot: scrubSnapshot, fingerprint: fingerprint, registerStore: registerStore, onPurge: onPurge,
    visible: visible, visibleRecords: visibleRecords,
    currentFingerprint: currentFp,
    get ready() { return state.ready; }, get decision() { return state.decision; },
    get failClosed() { return !!state.failClosed; },
    diagnostics: function () { return { decision: state.decision, failClosed: !!state.failClosed, memoryFilter: !!state.memoryFilter, memoryCleared: state.memoryCleared || null, projections: state.projections || 0, filtered: state.filtered || 0, tag: readTag(), purges: JSON.parse(JSON.stringify(state.purges)) }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
