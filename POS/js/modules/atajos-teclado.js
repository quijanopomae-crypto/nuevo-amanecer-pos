/* #18 Atajos de teclado para la pantalla Venta (solo escritorio).
 * Reutiliza los botones existentes: nunca confirma un cobro ni toca montos.
 *   F3  → enfocar «Buscar producto»
 *   F4  → abrir el cobro (mismo botón PAGAR; no confirma)
 *   Esc → cerrar la ventana abierta (misma lógica que tocar el fondo)
 *   F1  → mostrar/ocultar la ayuda de atajos (no se usa «?» porque
 *         el lector de códigos captura las teclas sueltas)
 * F2 queda libre: ya es el acceso de Venta libre (VARIOS) configurable.
 */
(function (root) {
  'use strict';
  var SHORTCUTS = Object.freeze([
    Object.freeze({ key: 'F3', label: 'Buscar producto' }),
    Object.freeze({ key: 'F4', label: 'Abrir cobro (PAGAR)' }),
    Object.freeze({ key: 'Esc', label: 'Cerrar ventana' }),
    Object.freeze({ key: 'F1', label: 'Ver esta ayuda' })
  ]);
  var HELP_ID = 'naAtajosAyuda';

  function isEditable(target) {
    return !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(target.tagName) >= 0);
  }
  function isTouchOnly(win) {
    try { return !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(hover: none) and (pointer: coarse)').matches); } catch (_) { return false; }
  }
  function freeSaleKey() {
    try {
      if (typeof root._naFreeSaleCfg === 'function' && typeof root._naNormalizeFreeSaleShortcut === 'function') {
        return root._naNormalizeFreeSaleShortcut(root._naFreeSaleCfg().shortcut) || '';
      }
    } catch (_) {}
    return 'F2';
  }
  /* Decide la acción sin tocar el DOM: fácil de probar. */
  function resolveAction(event, state) {
    if (!event || event.defaultPrevented || event.isComposing) return null;
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    if (state.touchOnly || state.locked) return null;
    var key = event.key;
    if (state.helpOpen && (key === 'Escape' || key === 'F1')) return 'help';
    if (key === 'Escape') return state.modalOpen ? 'close' : null;
    if (!state.posActive) return null;
    if (/^F\d+$/.test(key) && key.toUpperCase() === String(state.freeSaleKey || '').toUpperCase()) return null;
    if (key === 'F3') return state.modalOpen ? null : 'search';
    if (key === 'F4') return state.modalOpen ? null : 'pay';
    if (key === 'F1') return state.modalOpen ? null : 'help';
    return null;
  }

  function doc() { return root.document; }
  function topOverlay() {
    var list = doc().querySelectorAll('.modal-overlay.open');
    return list.length ? list[list.length - 1] : null;
  }
  function currentState(event) {
    var d = doc(), body = d.body;
    var locked = false;
    try { locked = (typeof root.securityIsLocked === 'function' && root.securityIsLocked()) || !!(body && body.classList.contains('security-session-locked')); } catch (_) {}
    return {
      touchOnly: isTouchOnly(root),
      locked: locked,
      posActive: !!(d.getElementById('pagePOS') && d.getElementById('pagePOS').classList.contains('active')),
      modalOpen: !!d.querySelector('.modal-overlay.open,.na-confirm-overlay.open'),
      helpOpen: !!(d.getElementById(HELP_ID) && !d.getElementById(HELP_ID).hidden),
      editable: isEditable(event.target),
      freeSaleKey: freeSaleKey()
    };
  }
  function buildHelp() {
    var d = doc(), box = d.getElementById(HELP_ID);
    if (box) return box;
    box = d.createElement('div');
    box.id = HELP_ID; box.className = 'na-atajos-ayuda'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Atajos de teclado');
    var title = d.createElement('strong'); title.textContent = 'Atajos de teclado'; box.appendChild(title);
    var list = d.createElement('dl');
    SHORTCUTS.forEach(function (s) {
      var dt = d.createElement('dt'); dt.textContent = s.key;
      var dd = d.createElement('dd'); dd.textContent = s.label;
      list.appendChild(dt); list.appendChild(dd);
    });
    box.appendChild(list);
    var hint = d.createElement('small'); hint.textContent = 'Pulsa F1 o Esc para cerrar.'; box.appendChild(hint);
    box.addEventListener('click', function () { box.hidden = true; });
    d.body.appendChild(box);
    return box;
  }
  function run(action) {
    var d = doc();
    if (action === 'search') {
      var s = d.getElementById('posSearch'); if (!s) return false;
      s.focus(); if (typeof s.select === 'function') s.select(); return true;
    }
    if (action === 'pay') {
      var b = d.getElementById('btnPagar'); if (!b || b.disabled || b.hidden) return false;
      b.click(); return true; // solo abre el diálogo de cobro existente
    }
    if (action === 'close') {
      var o = topOverlay(); if (!o) return false;
      o.dispatchEvent(new root.MouseEvent('click', { bubbles: true })); // reutiliza el cierre por fondo (respeta procesos en curso)
      return true;
    }
    if (action === 'help') { var h = buildHelp(); h.hidden = !h.hidden; return true; }
    return false;
  }
  function onKeydown(event) {
    var action = resolveAction(event, currentState(event));
    if (!action) return;
    if (run(action)) event.preventDefault();
  }
  var ready = false;
  function init() {
    if (ready || !root.document) return; ready = true;
    root.document.addEventListener('keydown', onKeydown, false);
  }
  root.NA_ATAJOS_TECLADO = Object.freeze({ SHORTCUTS: SHORTCUTS, resolveAction: resolveAction, isEditable: isEditable, isTouchOnly: isTouchOnly, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init); else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
