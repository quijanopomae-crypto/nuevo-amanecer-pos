/* Misión 3 (#857): sincroniza na_price_history_v1 con la nube (docs/propuestas/historial-precios-nube.md).
   Orden: al iniciar sesión (/auth/me confirmado) corre PRIMERO el backfill de lo local; recién al terminar
   se activa leer cambios de la nube y subir los nuevos. Nunca borra una entrada local por sincronizar.
   Si el servidor no tiene la función (404/503) todo sigue solo local, sin avisos al usuario.
   El costo: el servidor no lo devuelve a un empleado; en el aparato del empleado, tras confirmarse,
   se quitan los montos de las entradas de costo (la nube conserva el dato). */
(function (root) {
  'use strict';
  var DONE_KEY = 'na_price_history_backfill_v1';
  var BATCH = 100, CAP = 200;
  var running = null, again = false;

  function H() { return root.NA_PRICE_HISTORY; }
  function roles() { return root.NA_ROLES; }
  function ready() { try { var r = roles(); return !!(r && r.confirmed === true && typeof r.api === 'function' && r.deviceId && H()); } catch (_) { return false; } }
  function isOwner() { try { var r = roles(); return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; } }
  function store() { return root.localStorage; }
  function getJSON(key) { try { var v = store().getItem(key); return v ? JSON.parse(v) : null; } catch (_) { return null; } }
  function setJSON(key, value) { try { store().setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }
  function cents(v) { if (v === null || v === undefined || v === '') return null; var n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : null; }
  function backfillDone(device) { var d = getJSON(DONE_KEY); return !!(d && d.device_id === device && d.done_at); }

  async function sha256(text) {
    var subtle = root.crypto && root.crypto.subtle;
    if (!subtle || typeof root.TextEncoder !== 'function') throw new Error('SIN_CRYPTO');
    var buf = await subtle.digest('SHA-256', new root.TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  // Clave determinista para lo que ya estaba en el aparato: reintentar (otra pestaña) da el mismo change_id.
  async function legacyId(device, e) { return 'ph1:legacy:' + (await sha256(device + '|' + e.id + '|' + e.at + '|' + e.type)).slice(0, 64); }

  function toServer(productId, e) {
    var ref = e.ref ? String(e.ref) : null;
    if (ref && ref.slice(-(e.type.length + 1)) === ':' + e.type) ref = ref.slice(0, -(e.type.length + 1));
    return { change_id: e.cid, product_id: String(productId), field: e.type, before_cents: cents(e.before), after_cents: cents(e.after),
      origin: e.origin, ref: ref, user_name: String(e.user || 'Usuario').slice(0, 80), user_id: e.userId ? String(e.userId).slice(0, 80) : null,
      changed_at: e.at, legacy_id: e.id ? String(e.id).slice(0, 300) : null };
  }
  // Aplica cambios sobre una lectura FRESCA (otra pestaña pudo escribir entre medio): solo toca entradas por cid.
  function patch(byCid) {
    var data = H().readAll(), touched = false;
    Object.keys(data).forEach(function (pid) {
      (Array.isArray(data[pid]) ? data[pid] : []).forEach(function (e) {
        var p = e && ((e.cid && byCid[e.cid]) || (!e.cid && e.id && byCid['id:' + pid + ':' + e.id]));
        if (p) { Object.assign(e, p); touched = true; }
      });
    });
    if (touched) H().writeAll(data);
  }
  async function assignIds(device) {
    var data = H().readAll(), byCid = {}, n = 0;
    for (var pid of Object.keys(data)) for (var e of (Array.isArray(data[pid]) ? data[pid] : [])) {
      if (e && !e.cid && e.id) { byCid['id:' + pid + ':' + e.id] = { cid: await legacyId(device, e) }; n++; }
    }
    if (n) patch(byCid);
    return n;
  }
  function pending() {
    var data = H().readAll(), out = [];
    Object.keys(data).forEach(function (pid) { (Array.isArray(data[pid]) ? data[pid] : []).forEach(function (e) { if (e && e.cid && !e.synced && !e.syncError && !e.redacted) out.push(toServer(pid, e)); }); });
    return out;
  }
  async function push() {
    var list = pending(), sent = 0;
    for (var i = 0; i < list.length; i += BATCH) {
      var chunk = list.slice(i, i + BATCH);
      var out = await roles().api('/auth/price-history/batch', { entries: chunk });
      var byCid = {};
      (out && Array.isArray(out.results) ? out.results : []).forEach(function (r) {
        if (!r || !r.change_id) return;
        if (r.status === 'inserted' || r.status === 'duplicate') byCid[r.change_id] = { synced: true };
        else if (r.status === 'conflict' || r.status === 'invalid') byCid[r.change_id] = { syncError: r.status }; // se conserva local
      });
      patch(byCid); sent += chunk.length;
    }
    return sent;
  }
  // Empleado: el costo ya está en la nube; en su teléfono se quitan los montos (#857 §4.7).
  function redactCosts() {
    if (isOwner()) return;
    var data = H().readAll(), touched = false;
    Object.keys(data).forEach(function (pid) { (Array.isArray(data[pid]) ? data[pid] : []).forEach(function (e) {
      if (e && e.type === 'costo' && e.synced && !e.redacted) { e.before = null; e.after = null; e.redacted = true; touched = true; }
    }); });
    if (touched) H().writeAll(data);
    var cloud = H().readCloud(), drop = false;
    Object.keys(cloud.rows).forEach(function (pid) { var k = cloud.rows[pid].filter(function (r) { return r.field !== 'costo'; }); if (k.length !== cloud.rows[pid].length) { cloud.rows[pid] = k; drop = true; } });
    if (drop) setJSON(H().CLOUD_KEY, cloud);
  }
  async function pull() {
    var cloud = H().readCloud(), cur = cloud.cursor || { since: '', since_id: '' }, got = 0;
    for (var guard = 0; guard < 50; guard++) {
      var out = await roles().api('/auth/price-history/changes?since=' + encodeURIComponent(cur.since || '') + '&since_id=' + encodeURIComponent(cur.since_id || '') + '&limit=200');
      (out && Array.isArray(out.rows) ? out.rows : []).forEach(function (r) {
        if (!r || !r.product_id || !r.change_id) return;
        if (r.field === 'costo' && !isOwner()) return;
        var list = cloud.rows[r.product_id] || (cloud.rows[r.product_id] = []);
        if (list.some(function (x) { return x.change_id === r.change_id; })) return;
        list.unshift(r); if (list.length > CAP) list.length = CAP; got++;
      });
      if (out && out.cursor) cur = out.cursor;
      if (!out || !out.more) break;
    }
    cloud.cursor = cur;
    setJSON(H().CLOUD_KEY, cloud);
    try { if (got && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('na:price-history-cloud')); } catch (_) {}
    return got;
  }
  function unavailable(e) { var s = e && e.status; return s === 404 || s === 503 || s === 405 || (e && e.message === 'SIN_SESION'); }

  async function run() {
    if (!ready()) return { ok: false, reason: 'sin_sesion' };
    var device = String(roles().deviceId);
    try {
      var first = !backfillDone(device);
      await assignIds(device); // también entradas hechas antes de conocer el aparato
      await push();
      if (first && pending().length) return { ok: false, reason: 'backfill_incompleto' };
      redactCosts();
      var pulled = await pull(); // confirma además que el servidor tiene la función
      // Recién con todo lo local confirmado y la nube respondiendo se activa la función en este aparato.
      if (first) setJSON(DONE_KEY, { device_id: device, done_at: new Date().toISOString() });
      return { ok: true, pulled: pulled };
    } catch (e) {
      return { ok: false, reason: unavailable(e) ? 'no_disponible' : 'error' };
    }
  }
  function sync() {
    if (running) { again = true; return running; }
    running = run().finally(function () { running = null; if (again) { again = false; sync(); } });
    return running;
  }
  root.NA_PRICE_HISTORY_SYNC = Object.freeze({ sync: sync, enabled: function () { try { return backfillDone(String(roles().deviceId)); } catch (_) { return false; } }, DONE_KEY: DONE_KEY, _toServer: toServer });
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('na:role', function () { sync(); });
    root.addEventListener('na:price-history', function () { if (root.NA_PRICE_HISTORY_SYNC.enabled()) sync(); });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
