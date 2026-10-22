/* Permisos por empleado: panel «Qué puede hacer o ver el empleado» dentro de Configuración › Usuarios y PIN.
   - Solo el dueño confirmado (NA_ROLES.isOwner, falla cerrada) y solo con su propio candado abierto.
   - Todo con textContent y createElement (nunca HTML armado con datos). Todas las casillas arrancan apagadas.
   - Se guarda en el servidor con aprobación del PIN del dueño ligada a operation_id; el servidor decide. */
(function (root) {
  'use strict';
  var doc = root.document;
  var T = function () { return root.NA_EMPLOYEE_TOGGLES; };
  var LOCK_ID = 'permisos-por-empleado';
  var PATH = '/auth/employee-permissions';
  function panelUnlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(LOCK_ID) === false); } catch (_) { return false; }
  }
  function ownerOnly() {
    try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; }
  }
  function canShow() { return panelUnlocked() && ownerOnly() && !!T(); }
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function opId() {
    try { if (root.crypto && root.crypto.randomUUID) return 'emp-perm-' + root.crypto.randomUUID(); } catch (_) {}
    return 'emp-perm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function setStatus(box, text) { var s = box.querySelector('.na-emp-perm-status'); if (s) s.textContent = text; }
  function build() {
    var box = el('div', 'cfg-panel na9-sub na-emp-perm'); box.id = 'naEmpPerm';
    box.appendChild(el('h4', 'cfg-panel-title', 'Qué puede hacer o ver el empleado'));
    box.appendChild(el('p', 'cfg-panel-sub na9-muted', 'Marca lo que el empleado puede usar. Todo empieza apagado. Los costos, cierres de caja, tesorería, ajustes y proveedores siempre quedan solo para el dueño.'));
    T().GROUPS.forEach(function (g) {
      var fs = el('fieldset', 'na-emp-perm-group'); fs.appendChild(el('legend', 'na-emp-perm-legend', g.title));
      g.items.forEach(function (it) {
        var lab = el('label', 'na-emp-perm-row'); var cb = doc.createElement('input'); cb.type = 'checkbox'; cb.dataset.perm = it[0]; cb.checked = false; cb.disabled = true;
        lab.appendChild(cb); lab.appendChild(el('span', null, 'El empleado puede: ' + it[1].charAt(0).toLowerCase() + it[1].slice(1))); fs.appendChild(lab);
      });
      box.appendChild(fs);
    });
    var save = el('button', 'na-cfg-save-btn na9-btn', 'Guardar permisos'); save.type = 'button'; save.id = 'naEmpPermSave'; save.disabled = true;
    box.appendChild(save);
    var st = el('div', 'cfg-business-note na-emp-perm-status', 'Cargando…'); st.setAttribute('role', 'status'); box.appendChild(st);
    save.addEventListener('click', function () { saveNow(box); });
    return box;
  }
  function boxes(box) { return Array.prototype.slice.call(box.querySelectorAll('input[data-perm]')); }
  function apply(box, allow) {
    var a = T().normalize({ allow: allow });
    boxes(box).forEach(function (cb) { cb.checked = a[cb.dataset.perm] === true; cb.disabled = false; });
    box.querySelector('#naEmpPermSave').disabled = false;
  }
  async function load(box) {
    try { var d = await root.NA_ROLES.api(PATH); apply(box, d && d.allow); setStatus(box, ''); }
    catch (e) { boxes(box).forEach(function (cb) { cb.checked = false; cb.disabled = true; }); setStatus(box, 'No se pudo leer los permisos. Revisa internet. Mientras tanto, el empleado no tiene acceso a estas funciones.'); }
  }
  async function saveNow(box) {
    if (!canShow()) return;
    var r = root.NA_ROLES, btn = box.querySelector('#naEmpPermSave');
    if (!r.pinSet) { setStatus(box, 'Primero crea el PIN del dueño en esta misma pantalla.'); return; }
    var allow = {}; boxes(box).forEach(function (cb) { allow[cb.dataset.perm] = !!cb.checked; });
    var op = opId();
    btn.disabled = true;
    try {
      var approval = await r.approve('employee.permissions', op, 'Guardar permisos del empleado', 'Escribe tu PIN de dueño para guardar.');
      if (!approval) { setStatus(box, 'No se guardó.'); return; }
      var res = await r.api(PATH, { allow: allow, operation_id: op }, 'POST', { 'x-owner-approval': approval });
      apply(box, res && res.allow); setStatus(box, 'Permisos guardados.');
    } catch (e) { setStatus(box, 'No se guardó. ' + (r.message ? r.message(e) : '')); }
    finally { btn.disabled = false; }
  }
  function mount(cont) {
    try {
      if (!cont || !canShow()) return false;
      var old = cont.querySelector('#naEmpPerm'); if (old) old.remove();
      var box = build();
      var legacy = cont.querySelector('.na9-legacy-host'); var before = legacy ? legacy.closest('.na9-sub') : cont.querySelector(':scope > .cfg-business-note');
      if (before && before.parentNode === cont) cont.insertBefore(box, before); else cont.appendChild(box);
      load(box);
      return true;
    } catch (_) { return false; }
  }
  // El rol del dueño puede confirmarse después de dibujar la pestaña: se vuelve a revisar con cada na:role.
  // Sin permiso se quita el panel (falla cerrada); con permiso se monta una sola vez.
  function sync() {
    try {
      var cont = doc.querySelector && doc.querySelector('.na9-bd[data-sec="pin"]'); if (!cont) return false;
      var old = cont.querySelector('#naEmpPerm');
      if (!canShow()) { if (old) old.remove(); return false; }
      if (old) return false;
      return mount(cont);
    } catch (_) { return false; }
  }
  try { if (typeof root.addEventListener === 'function') root.addEventListener('na:role', sync); } catch (_) {}
  root.NA_EMPLOYEE_PERMS_UI = Object.freeze({ mount: mount, canShow: canShow, sync: sync, LOCK_ID: LOCK_ID });
})(globalThis);
