/* Permisos del empleado frente a CasaMarket (ítem 3). SOLO DUEÑO, dentro de Configuración.
 * Muestra, solo lectura, qué acciones sensibles piden el PIN del dueño y agrega UN ajuste:
 * «compras.pin_empleado» (pos_settings, sin migración). false = el empleado registra compras sin PIN,
 * como CasaMarket. Por defecto se sigue pidiendo. El servidor aplica el mismo ajuste. Solo textContent. */
(function (root) {
  'use strict';
  var KEY = 'compras.pin_empleado', BOX_ID = 'naPermisosEmpleado';
  var RULES = [
    ['Anular una venta', 'Siempre pide el PIN del dueño, también en su aparato'],
    ['Ajustar stock (entrada o salida)', 'PIN del dueño si lo hace el empleado'],
    ['Editar producto o precio', 'PIN del dueño si lo hace el empleado'],
    ['Cambiar el límite de crédito del cliente', 'PIN del dueño si lo hace el empleado'],
    ['Ajustes y compensaciones de caja', 'PIN del dueño si lo hace el empleado'],
    ['Ver costos, reportes y cierres de caja', 'Solo el dueño']
  ];
  var state = { revision: null, value: true, loaded: false, busy: false };
  function isOwner() { try { var r = root.NA_ROLES; return !!(r && r.isOwner() === true && r.confirmed); } catch (_) { return false; } }
  function el(tag, cls, text) { var n = root.document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; }
  async function load() {
    var R = root.NA_ROLES;
    try { var out = await R.api('/settings'); var row = (out && out.settings || []).find(function (x) { return x && x.key === KEY; });
      state.value = !(row && row.value === false); state.revision = row ? row.revision : 0; state.loaded = true; }
    catch (_) { state.loaded = false; }
  }
  async function save(value, status, box) {
    if (state.busy || !isOwner()) return;
    state.busy = true; box.disabled = true; status.textContent = 'Guardando…';
    try {
      await root.NA_ROLES.api('/settings', { key: KEY, value: value, expected_revision: state.revision });
      await load(); status.textContent = value ? 'Listo: el empleado necesita tu PIN para registrar compras.' : 'Listo: el empleado registra compras sin tu PIN.';
    } catch (e) { box.checked = state.value; status.textContent = 'No se pudo guardar. Revisa internet y vuelve a intentar.'; }
    finally { state.busy = false; box.disabled = false; }
  }
  async function render() {
    var page = root.document && root.document.getElementById('pageConfig');
    if (!page) return false;
    var card = root.document.getElementById(BOX_ID);
    if (!isOwner()) { if (card) card.hidden = true; return false; }
    if (!card) {
      card = el('section', 'pe-card'); card.id = BOX_ID; card.setAttribute('aria-labelledby', BOX_ID + 'T');
      var h = el('h3', 'pe-title', 'Permisos del empleado'); h.id = BOX_ID + 'T';
      var list = el('ul', 'pe-list');
      RULES.forEach(function (r) { var li = el('li', 'pe-row'); li.append(el('strong', '', r[0]), el('span', '', r[1])); list.appendChild(li); });
      var label = el('label', 'pe-toggle'), box = el('input'); box.type = 'checkbox'; box.dataset.peCompras = '';
      label.append(box, el('span', '', 'Pedir mi PIN cuando el empleado registra una compra'));
      var status = el('p', 'pe-status'); status.setAttribute('aria-live', 'polite'); status.dataset.peStatus = '';
      box.addEventListener('change', function () { save(box.checked, status, box); });
      card.append(h, list, label, status);
      page.appendChild(card);
    }
    card.hidden = false;
    await load();
    var b = card.querySelector('[data-pe-compras]'), st = card.querySelector('[data-pe-status]');
    b.checked = state.value; b.disabled = !state.loaded;
    if (!state.loaded) st.textContent = 'Sin conexión: no se puede cambiar este ajuste ahora.';
    return true;
  }
  function init() {
    var page = root.document.getElementById('pageConfig');
    if (!page || page.__naPeBound) return;
    page.__naPeBound = true;
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(function () { if (page.classList.contains('active')) render(); }).observe(page, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', render);
  }
  root.NA_PERMISOS_EMPLEADO = Object.freeze({ render: render, KEY: KEY, RULES: RULES });
  if (root.document) { if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true }); else init(); }
})(globalThis);
