/* #141 Sesiones y cierre remoto: el dueño ve los aparatos conectados y puede cerrar la sesión de otro
 * aparato. Usa las rutas que ya existen en el Worker: POST /auth/devices (lista) y
 * POST /auth/devices/revoke { device_id, pin } (PIN solo si el dueño lo tiene configurado).
 * El Worker rechaza cerrar el propio aparato (409 cannot_revoke_self); aquí ese aparato no tiene botón.
 * Candado 'sesion-unica-usuario': mientras siga cerrado la pantalla no muestra nada. Solo textContent.
 */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageSesionesAparatos', LOCK = 'sesion-unica-usuario';
  function text(v) { return v == null ? '' : String(v).trim(); }
  function isOwner() {
    try { var r = root.NA_ROLES; if (!r || typeof r.isOwner !== 'function') return false; return r.isOwner() === true; } catch (_) { return false; }
  }
  function unlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(LOCK) === false); } catch (_) { return false; }
  }
  function policyReady() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID) && !p.canAccessScreen('empleado', PAGE_ID)); } catch (_) { return false; }
  }
  function allowed() { return unlocked() && policyReady() && isOwner(); }
  // Fecha y hora en Lima. Sin zona = UTC (así guarda el Worker: ISO con Z).
  function fmtLima(value) {
    var raw = text(value); if (!raw) return '—';
    var ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : raw.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(ms)) return '—';
    var d = new Date(ms - 5 * 3600000), p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  // Normaliza la respuesta: solo sesiones activas, la actual primero, luego la vista más reciente.
  function normalize(resp) {
    var list = resp && Array.isArray(resp.devices) ? resp.devices : [];
    return list.filter(function (d) { return d && d.status === 'active' && /^session:\S{1,152}$/.test(text(d.device_id)); }).map(function (d) {
      var role = d.pos_role === 'empleado' ? 'empleado' : 'owner';
      return { id: text(d.device_id), role: role, current: d.current === true,
        label: text(d.label) || (role === 'empleado' ? 'Aparato de empleado' : 'Aparato del dueño'),
        since: fmtLima(d.created_at), seen: fmtLima(d.last_seen_at), seenRaw: text(d.last_seen_at) };
    }).sort(function (a, b) { return (b.current - a.current) || (b.seenRaw > a.seenRaw ? 1 : b.seenRaw < a.seenRaw ? -1 : 0); });
  }
  function message(e) { try { return root.NA_ROLES.message(e); } catch (_) { return 'No se pudo completar. Revisa la conexión y vuelve a intentar.'; } }

  var state = { ticket: 0, pending: false, rows: null };
  function el(tag, cls, value) { var n = root.document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = String(value); return n; }
  function nodes() {
    var page = root.document && root.document.getElementById(PAGE_ID);
    return page ? { page: page, list: page.querySelector('[data-sa-list]'), status: page.querySelector('[data-sa-status]'), controls: page.querySelector('[data-sa-controls]') } : null;
  }
  function clear(n, msg) {
    state.ticket++; state.pending = false; state.rows = null;
    if (n.controls) n.controls.hidden = true;
    n.status.textContent = '';
    n.list.replaceChildren(msg ? el('p', 'sa-notice', msg) : '');
    return false;
  }
  function deny(n) { return clear(n, unlocked() ? 'Sin permiso. Solo el dueño puede ver esta pantalla.' : 'Esta función todavía no está disponible.'); }
  function paint(n) {
    var rows = state.rows || [];
    n.status.textContent = rows.length ? rows.length + ' aparato(s) con sesión abierta · horas de Lima' : '';
    if (!rows.length) { n.list.replaceChildren(el('p', 'sa-empty', 'No hay aparatos con sesión abierta.')); return; }
    var ul = el('ul', 'sa-list');
    rows.forEach(function (d) {
      var li = el('li', 'sa-item'); li.setAttribute('data-sa-device', d.id);
      var info = el('div', 'sa-info'), name = el('strong', 'sa-name', d.label);
      info.appendChild(name);
      if (d.current) { var b = el('span', 'sa-badge', 'Este aparato'); li.setAttribute('data-sa-current', ''); info.appendChild(b); }
      info.appendChild(el('small', 'sa-meta', (d.role === 'empleado' ? 'Empleado' : 'Dueño') + ' · conectado desde ' + d.since + ' · última vez ' + d.seen));
      li.appendChild(info);
      if (d.current) li.appendChild(el('small', 'sa-self', 'Para cerrar esta sesión, hazlo desde otro aparato.'));
      else {
        var btn = el('button', 'sa-revoke', 'Cerrar sesión'); btn.type = 'button';
        btn.setAttribute('aria-label', 'Cerrar sesión de ' + d.label);
        btn.addEventListener('click', function () { revoke(d); });
        li.appendChild(btn);
      }
      ul.appendChild(li);
    });
    n.list.replaceChildren(ul);
  }
  async function load() {
    var n = nodes(); if (!n || !n.list || !n.status) return false;
    if (!allowed()) return deny(n);
    if (n.controls) n.controls.hidden = false;
    var own = ++state.ticket; state.pending = true;
    n.status.textContent = 'Cargando aparatos…'; n.list.replaceChildren();
    try {
      var resp = await root.NA_ROLES.api('/auth/devices', {});
      if (own !== state.ticket) return false;
      if (!allowed()) return deny(n);
      state.rows = normalize(resp); paint(n); return true;
    } catch (e) {
      if (own !== state.ticket) return false;
      if (!allowed()) return deny(n);
      n.status.textContent = 'No se pudieron cargar los aparatos. ' + message(e);
      return false;
    } finally { if (own === state.ticket) state.pending = false; }
  }
  async function confirm(d) {
    var msg = '¿Cerrar la sesión de «' + d.label + '»? Ese aparato dejará de vender y cobrar, y tendrá que vincularse de nuevo con un código.';
    try { if (typeof root._naConfirmAction === 'function') return !!(await root._naConfirmAction(msg, { title: 'Cerrar sesión a distancia', subtitle: 'Esta acción no se puede deshacer desde aquí.', danger: true, okText: 'Cerrar sesión', force: true })); } catch (_) { return false; }
    return false;
  }
  async function revoke(d) {
    var n = nodes(); if (!n || !allowed()) return false;
    if (!d || d.current) return false; // nunca el propio aparato (el Worker también lo rechaza)
    if (!(await confirm(d)) || !allowed()) return false;
    var r = root.NA_ROLES, err = null, done = false;
    var call = function (pin) { return r.api('/auth/devices/revoke', { device_id: d.id, pin: pin || undefined }); };
    try {
      if (!r.pinSet) { await call(''); done = true; }
      else {
        done = !!(await r.askPin('Cerrar sesión a distancia', 'Escribe tu PIN de dueño.', async function (pin) {
          try { await call(pin); return { ok: true, value: true }; }
          catch (e) { err = e; return { msg: message(e), stop: e.message !== 'owner_pin_invalid' && e.message !== 'pin_format' }; }
        }));
      }
    } catch (e) { err = e; }
    if (!done) { if (err && err.message !== 'owner_pin_invalid') n.status.textContent = 'No se cerró la sesión. ' + message(err); return false; }
    try { root.toast('Sesión cerrada', 'success'); } catch (_) {}
    await load();
    return true;
  }
  function init() {
    var n = nodes(); if (!n) return;
    var btn = n.page.querySelector('[data-sa-refresh]'); if (btn) btn.addEventListener('click', load);
    function update() {
      if (!allowed()) { deny(n); return; }
      if (n.page.classList.contains('active')) { if (!state.pending && !state.rows) load(); }
      else clear(n, '');
    }
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(n.page, { attributes: true, attributeFilter: ['class'] });
    if (typeof root.addEventListener === 'function') root.addEventListener('na:role', update);
    update();
  }
  root.NA_SESIONES = Object.freeze({ normalize: normalize, fmtLima: fmtLima, isOwner: isOwner, unlocked: unlocked, allowed: allowed, load: load, revoke: revoke });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.NA_SESIONES;
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init(); }
})(globalThis);
