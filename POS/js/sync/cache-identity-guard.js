/* Caché local atada a la identidad (T-47 S3).
   La réplica canónica en caché (na_snapshot_v9 en localStorage, su copia de sessionStorage e
   IndexedDB NuevoAmanecerPOS/state/snapshot_v9) guarda gastos con notas, costos y
   proveedor/factura de quien la descargó. Si el navegador cambia de identidad (reactivación o
   vinculación con otro token, o el servidor confirma otro aparato/rol), esa caché NO debe llegar
   a la nueva sesión, ni siquiera sin conexión.
   - Etiqueta na_cache_identity_v1 = { fp, role, device_id }. fp es una huella del token guardado
     (el token ya está en claro en na_cloud_sync_credentials; la huella solo sirve para comparar).
   - Al arrancar (antes de loadAllData) y al activar/vincular: si la huella no coincide, se purga.
   - Caché heredada sin etiqueta: solo se conserva si el rol en caché es «owner» (confirmado por el
     servidor con este token); en otro caso se purga (falla cerrada).
   - Cuando /auth/me confirma aparato y rol: si difieren de la etiqueta, se purga y se pide relectura.
   - La purga NO toca colas ni pendientes: na_canonical_sale_outbox_v1, na_canonical_sale_journal,
     cuarentenas, cloudSync del snapshot, compras/notas pendientes. Solo réplica y datos restringidos. */
(function (root) {
  'use strict';
  var TAG = 'na_cache_identity_v1', CRED = 'na_cloud_sync_credentials', ROLE = 'na_pos_role_v1';
  var LOCAL_SNAPSHOTS = ['na_snapshot_v9'], SESSION_SNAPSHOTS = ['na_snapshot_v9_session', 'na_snapshot_v9'];
  // Cachés que solo existen para el dueño o contienen costos/estado completo del usuario anterior.
  var LOCAL_DROP = ['na_price_history_v1', 'na_pos_reviews_cache_v1', 'na_pre_restore_snapshot_v1', 'na_gastos'];
  var SESSION_DROP = ['na_pre_restore_snapshot_v1_session'];
  var IDB_NAME = 'NuevoAmanecerPOS', IDB_STORE = 'state', IDB_KEY = 'snapshot_v9';
  var RESTRICTED = /^(costo\w*|cost|cost_cents|unit_cost_cents|avg_cost_cents|supplier\w*|proveedor\w*|document_ref|invoice\w*|factura\w*)$/i;
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
  // Quita del snapshot la réplica canónica y los datos restringidos. Conserva cloudSync, ventas, carrito (sin costos), config.
  function scrubSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return false;
    var changed = false;
    if (Object.prototype.hasOwnProperty.call(snap, 'canonicalReplica')) { delete snap.canonicalReplica; changed = true; }
    var d = snap.data;
    if (d && typeof d === 'object') {
      ['gastos', 'cashClosures', 'inventoryMovements'].forEach(function (k) { if (Array.isArray(d[k]) && d[k].length) { d[k] = []; changed = true; } });
      if (strip(d.productos)) changed = true;
      if (strip(d.ventas)) changed = true;
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
    // Catálogo heredado (pre-v9): sin costos.
    try { var p = readJSON(l, 'na_productos'); if (p && strip(p)) { l.setItem('na_productos', JSON.stringify(p)); out.push('localStorage.na_productos:scrubbed'); } } catch (_) {}
  }
  // Almacenes IndexedDB atados a la identidad. Modos:
  //  - 'scrub': cada clave de `keys` es un snapshot V9 al que se le quitan réplica y datos restringidos.
  //  - 'clear': caché descartable; se vacía entera al cambiar de identidad.
  //  - 'hide' : datos que NO se pueden borrar (p. ej. el diario futuro de operaciones confirmadas de
  //    SPEC-restauracion.md, necesario para recuperar tras una restauración). El guardián no lo toca:
  //    quien lo lea debe pasar cada registro por visible(record) / visibleRecords(list), que oculta lo
  //    que no lleve la huella (identity_fp) de la identidad actual. Ocultar NO protege contra devtools.
  // Se registran con registerStore({ db, store, mode, keys? }).
  var IDB_TARGETS = [{ db: IDB_NAME, store: IDB_STORE, mode: 'scrub', keys: [IDB_KEY] }];
  var HOOKS = [];
  function registerStore(target) {
    if (!target || typeof target.db !== 'string' || typeof target.store !== 'string' || ['scrub', 'clear', 'hide'].indexOf(target.mode) === -1) throw new Error('CACHE_IDENTITY_INVALID_STORE');
    IDB_TARGETS.push(target);
    if (target.mode === 'hide') return state.ready;
    // Registrado después del arranque: 'clear'/'scrub' se aplican si este arranque ya purgó.
    var fp = currentFp(), purged = /purged$/.test(String(state.decision || ''));
    if (fp && purged) {
      var out = []; state.purges.push({ reason: 'late-register:' + target.db + '.' + target.store, at: Date.now(), removed: out });
      var run = function () { return purgeTarget(target, fp, out); };
      state.ready = Promise.resolve(state.ready).then(run, run);
    }
    return state.ready;
  }
  function onPurge(hook) { if (typeof hook === 'function') HOOKS.push(hook); }
  // IndexedDB: nunca crea la base (si no existe se aborta la creación) ni cambia su versión.
  function purgeTarget(target, fp, out) {
    return new Promise(function (resolve) {
      var idb; try { idb = root.indexedDB; } catch (_) { idb = null; }
      if (!idb) return resolve();
      var where = 'indexedDB.' + target.db + '.' + target.store;
      var settled = false, finish = function () { if (!settled) { settled = true; resolve(); } };
      var timer = setTimeout(function () { out.push(where + ':timeout'); finish(); }, 2000);
      var req; try { req = idb.open(target.db); } catch (_) { clearTimeout(timer); return finish(); }
      req.onupgradeneeded = function () { try { req.transaction.abort(); } catch (_) {} };
      req.onerror = function () { clearTimeout(timer); finish(); };
      req.onblocked = function () { clearTimeout(timer); out.push(where + ':blocked'); finish(); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          if (!db.objectStoreNames.contains(target.store)) { db.close(); clearTimeout(timer); return finish(); }
          var tx = db.transaction(target.store, 'readwrite'), st = tx.objectStore(target.store);
          if (target.mode === 'clear') { st.clear(); out.push(where + ':cleared'); }
          else (target.keys || []).forEach(function (key) {
            var g = st.get(key); g.onsuccess = function () { var snap = g.result; if (snap && scrubSnapshot(snap)) { st.put(snap, key); out.push(where + ':' + key + ':scrubbed'); } };
          });
          tx.oncomplete = tx.onabort = tx.onerror = function () { try { db.close(); } catch (_) {} clearTimeout(timer); finish(); };
        } catch (_) { try { db.close(); } catch (__) {} clearTimeout(timer); finish(); }
      };
    });
  }
  function purgeIDB(out) {
    var fp = currentFp();
    return IDB_TARGETS.filter(function (t) { return t.mode !== 'hide'; })
      .reduce(function (chain, target) { return chain.then(function () { return purgeTarget(target, fp, out); }); }, Promise.resolve());
  }
  // Ocultar por identidad (modo 'hide'): sin credenciales (modo local, dueño) todo es visible;
  // con credenciales solo lo que lleve la huella actual. Registros sin huella: ocultos (falla cerrada).
  function visible(record) { var fp = currentFp(); return !fp || !!(record && record.identity_fp === fp); }
  function visibleRecords(list) { return (Array.isArray(list) ? list : []).filter(visible); }
  function purge(reason) {
    var out = [], entry = { reason: reason, at: Date.now(), removed: out };
    state.purges.push(entry);
    purgeStorageSync(out);
    return purgeIDB(out).then(function () {
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
      state.decision = 'legacy-untagged-purged';
    } else state.decision = 'identity-changed-purged';
    var decision = state.decision;
    return purge(decision + ':' + (source || 'boot')).then(function () { writeTag(fp, null, null, decision); return decision; });
  }
  // Identidad confirmada por el servidor (/auth/me): aparato o rol distintos a la etiqueta => purga.
  function onConfirmed() {
    var r = root.NA_ROLES; if (!r || !r.confirmed || !r.deviceId) return;
    var fp = currentFp(); if (!fp) return;
    var role = r.role === 'owner' || r.role === 'empleado' ? r.role : null, tag = readTag();
    var mismatch = !tag || tag.fp !== fp || (tag.device_id && tag.device_id !== r.deviceId) || (tag.role && role && tag.role !== role);
    if (!mismatch) { if (!tag.device_id || tag.role !== role) writeTag(fp, role, r.deviceId, 'confirmed'); return; }
    purge('confirmed-identity-changed').then(function () {
      writeTag(fp, role, r.deviceId, 'confirmed');
      try { if (root.NuevoAmanecerCanonical && typeof root.NuevoAmanecerCanonical.refresh === 'function') root.NuevoAmanecerCanonical.refresh().catch(function () {}); } catch (_) {}
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
  gate('loadAllData'); gate('_naReadCanonicalReplica');
  try { root.addEventListener('na:role', onConfirmed); } catch (_) {}

  root.NuevoAmanecerCacheIdentity = {
    check: function (source) { state.ready = check(source); return state.ready; },
    purge: purge, scrubSnapshot: scrubSnapshot, fingerprint: fingerprint, registerStore: registerStore, onPurge: onPurge,
    visible: visible, visibleRecords: visibleRecords,
    currentFingerprint: currentFp,
    get ready() { return state.ready; }, get decision() { return state.decision; },
    diagnostics: function () { return { decision: state.decision, tag: readTag(), purges: JSON.parse(JSON.stringify(state.purges)) }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
