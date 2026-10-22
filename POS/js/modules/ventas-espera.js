// #9 Ventas en espera: varias ventas pausadas guardadas solo en este dispositivo
// (localStorage). Reutiliza cargarBorrador() para reconciliar con el stock real.
// Mientras el candado 'ventas-espera' esté cerrado no se muestra nada y todo es no-op.
(function (root) {
  'use strict';
  var KEY = 'na_held_sales';
  var DRAFT_KEY = 'na_cart_draft';
  var MAX = 20;

  function locked() {
    try { var p = root.NA_PERMISSIONS; return !p || typeof p.featureLocked !== 'function' || p.featureLocked('ventas-espera'); }
    catch (e) { return true; }
  }
  function store() { try { if (typeof storage !== 'undefined' && storage) return storage; } catch (e) {} return root.localStorage; }
  // Las funciones legacy son globales de script (no siempre en window).
  function fn(name) {
    try {
      switch (name) {
        case 'toast': return typeof toast === 'function' ? toast : null;
        case 'closeCartMenu': return typeof closeCartMenu === 'function' ? closeCartMenu : null;
        case 'posUpdateCart': return typeof posUpdateCart === 'function' ? posUpdateCart : null;
        case 'saveAllData': return typeof saveAllData === 'function' ? saveAllData : null;
        case 'cargarBorrador': return typeof cargarBorrador === 'function' ? cargarBorrador : null;
        case '_naConfirmAction': return typeof _naConfirmAction === 'function' ? _naConfirmAction : null;
      }
    } catch (e) {}
    return null;
  }
  function money(n) { return (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function itemsTotal(items) {
    return items.reduce(function (s, it) { return s + (Number(it.precio) || 0) * (Number(it.qty) || 0); }, 0);
  }
  function list() {
    try {
      var raw = store().getItem(KEY); var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (h) { return h && h.id && Array.isArray(h.items) && h.items.length; }) : [];
    } catch (e) { return []; }
  }
  function save(arr) {
    try { store().setItem(KEY, JSON.stringify(arr)); return store().getItem(KEY) === JSON.stringify(arr); }
    catch (e) { return false; }
  }
  function add(items, label) {
    if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'empty' };
    var arr = list();
    if (arr.length >= MAX) return { ok: false, reason: 'full' };
    var h = { id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: String(label || '').slice(0, 60),
      createdAt: new Date().toISOString(), items: JSON.parse(JSON.stringify(items)) };
    h.total = itemsTotal(h.items);
    arr.push(h);
    return save(arr) ? { ok: true, hold: h } : { ok: false, reason: 'storage' };
  }
  function remove(id) { var arr = list(), next = arr.filter(function (h) { return h.id !== id; }); return next.length !== arr.length && save(next); }
  function get(id) { return list().find(function (h) { return h.id === id; }) || null; }

  function notify(msg, t) { var f = fn('toast'); if (f) f(msg, t); }
  function closeMenu() { try { var f = fn('closeCartMenu'); if (f) f(); } catch (e) {} }
  function getCart() { try { return typeof cart !== 'undefined' && Array.isArray(cart) ? cart : []; } catch (e) { return []; } }

  // Pone la venta actual en espera y deja el carrito libre para otro cliente.
  async function ponerEnEspera() {
    if (locked()) return;
    closeMenu();
    var items = getCart();
    if (!items || !items.length) { notify('El carrito está vacío', 'error'); return; }
    var r = add(items, '');
    if (!r.ok) { notify(r.reason === 'full' ? 'Máximo ' + MAX + ' ventas en espera' : 'No se pudo guardar la venta en espera', 'error'); return; }
    try {
      cart.length = 0;
      var up = fn('posUpdateCart'); if (up) up();
      var sv = fn('saveAllData'); if (sv) await sv();
    } catch (e) { console.error('[VentasEspera]', e && e.name); }
    notify('⏸️ Venta puesta en espera', 'success');
  }

  // Retoma una venta: la pasa por cargarBorrador() (stock real + confirmación).
  async function retomar(id) {
    if (locked()) return;
    var h = get(id); if (!h) { notify('La venta en espera ya no existe', 'error'); return; }
    var prevDraft = store().getItem(DRAFT_KEY);
    var before = JSON.stringify(getCart());
    try {
      store().setItem(DRAFT_KEY, JSON.stringify(h.items));
      var cb = fn('cargarBorrador'); if (cb) await cb();
    } finally {
      if (prevDraft == null) store().removeItem(DRAFT_KEY); else store().setItem(DRAFT_KEY, prevDraft);
    }
    var after = JSON.stringify(getCart());
    if (after !== before && getCart().length) { remove(id); cerrarLista(); }
  }

  async function eliminar(id) {
    if (locked()) return;
    var cf = fn('_naConfirmAction');
    var ok = cf
      ? await cf('¿Eliminar esta venta en espera?', { title: 'Ventas en espera', subtitle: 'No afecta stock ni caja.', icon: '🗑️', okText: 'Eliminar' })
      : true;
    if (!ok) return;
    remove(id); renderLista(); notify('Venta en espera eliminada');
  }

  function cerrarLista() { if (!root.document) return; var o = root.document.getElementById('naHeldSalesOverlay'); if (o) o.remove(); }
  function el(tag, cls, text) { var e = root.document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function renderLista() {
    if (!root.document) return;
    var body = root.document.getElementById('naHeldSalesBody'); if (!body) return;
    body.replaceChildren();
    var arr = list();
    if (!arr.length) { body.appendChild(el('div', 'empty-state', 'No hay ventas en espera')); return; }
    arr.forEach(function (h, i) {
      var row = el('div', 'na-held-row'); row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--border)';
      var info = el('div'); info.style.flex = '1';
      var n = h.items.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0);
      var hora = '';
      try { hora = new Date(h.createdAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }); } catch (e) {}
      info.appendChild(el('div', null, 'Venta ' + (i + 1) + (h.label ? ' · ' + h.label : '')));
      var sub = el('div', null, n + ' artículo(s) · ' + hora); sub.style.cssText = 'font-size:12px;opacity:.7';
      info.appendChild(sub);
      var tot = el('div', null, 'S/ ' + money(h.total));
      var bR = el('button', 'btn btn-primary', 'Retomar'); bR.type = 'button'; bR.addEventListener('click', function () { retomar(h.id); });
      var bD = el('button', 'btn', '🗑️'); bD.type = 'button'; bD.title = 'Eliminar'; bD.addEventListener('click', function () { eliminar(h.id); });
      row.append(info, tot, bR, bD); body.appendChild(row);
    });
  }

  function abrirLista() {
    if (locked()) return;
    closeMenu(); cerrarLista();
    var d = root.document;
    var ov = el('div', 'modal-overlay open'); ov.id = 'naHeldSalesOverlay'; ov.style.cssText = 'display:flex;z-index:340';
    var m = el('div', 'modal'); m.style.maxWidth = '520px';
    var head = el('div', 'mhead'); head.appendChild(el('div', 'mhead-title', '⏸️ Ventas en espera'));
    var x = el('button', 'btn-close-m', '✕'); x.type = 'button'; x.addEventListener('click', cerrarLista); head.appendChild(x);
    var body = el('div', 'mbody'); body.id = 'naHeldSalesBody';
    m.append(head, body); ov.appendChild(m);
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrarLista(); });
    d.body.appendChild(ov); renderLista();
  }

  // Punto de entrada: dos opciones dentro del menú ⋮ existente del carrito
  // (no agrega botones visibles a Venta). Solo si el candado está abierto.
  function mountMenu() {
    if (locked()) return;
    var d = root.document, menu = d && d.getElementById('cartMenuDropdown');
    if (!menu || d.getElementById('btnHoldSale')) return;
    var ref = Array.prototype.find.call(menu.querySelectorAll('button'), function (b) { return /cargarBorrador/.test(b.getAttribute('onclick') || ''); });
    var b1 = el('button', 'cart-menu-item', '⏸️ Poner en espera'); b1.id = 'btnHoldSale'; b1.type = 'button'; b1.addEventListener('click', ponerEnEspera);
    var b2 = el('button', 'cart-menu-item', '📋 Ventas en espera'); b2.id = 'btnHeldSales'; b2.type = 'button'; b2.addEventListener('click', abrirLista);
    if (ref && ref.nextSibling) { menu.insertBefore(b2, ref.nextSibling); menu.insertBefore(b1, b2); } else { menu.append(b1, b2); }
  }

  root.NA_VENTAS_ESPERA = { KEY: KEY, MAX: MAX, locked: locked, list: list, add: add, remove: remove, get: get, total: itemsTotal,
    ponerEnEspera: ponerEnEspera, retomar: retomar, eliminar: eliminar, abrirLista: abrirLista, mountMenu: mountMenu };
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mountMenu); else mountMenu();
  }
})(globalThis);
