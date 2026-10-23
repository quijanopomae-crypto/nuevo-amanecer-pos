/* CM-073 · Regularización de stock negativo (candado 'stock-negativo-configurable', solo dueño).
 * Lista los productos con stock < 0 dentro de «Ajustes de inventario» y permite llevar cada uno a un
 * valor elegido por el dueño. Nunca fuerza un valor: el campo empieza vacío (0 es solo la propuesta),
 * se muestra la simulación (antes → después) y hace falta «Confirmar». Reutiliza el flujo existente
 * NA_AJUSTES_INVENTARIO.register (Corrección · Sumar), así queda como movimiento de kardex con motivo.
 * Idempotente: se confirma contra el stock visto en la simulación; si ya cambió (p. ej. un reintento
 * después de aplicarlo) no se registra otra vez. Solo textContent. No toca ventas, pagos ni precios de compra. */
(function (root) {
  'use strict';
  var FEATURE_ID = 'stock-negativo-configurable', PAGE_ID = 'pageAjustesInventario';
  var DECIMAL = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
  // Decimales solo en kg, g, L y mL; UND y demás, enteros.
  var FRACTIONAL_UNITS = /^(kg|kgs|kilos?|kilogramos?|g|gr|grs|gramos?|l|lt|lts|litros?|ml|mililitros?)$/i;
  function aj() { return root.NA_AJUSTES_INVENTARIO || null; }
  function isOwner() { try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; } }
  function available() {
    try {
      var p = root.NA_PERMISSIONS, a = aj();
      return isOwner() && !!(p && typeof p.featureLocked === 'function' && p.featureLocked(FEATURE_ID) === false) && !!(a && typeof a.available === 'function' && a.available());
    } catch (_) { return false; }
  }
  function pid(p) { return String(p.id != null ? p.id : p.product_id); }
  function stockOf(p) {
    var v = p && (typeof p.current_stock_quantity === 'number' ? p.current_stock_quantity : Number(p.stock));
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  function tracked(p) { return !!p && p.controlInventario !== false && p.track_inventory !== false && p.inventory_enabled !== false; }
  // Lista pura: productos con control de stock y stock < 0, del más negativo al menos negativo.
  function negatives(list) {
    return (Array.isArray(list) ? list : []).filter(function (p) { var s = stockOf(p); return tracked(p) && s !== null && s < 0; })
      .map(function (p) { return { id: pid(p), name: String(p.name || p.nombre || 'Producto'), stock: stockOf(p), unit: String(p.unit || p.unidad || ''), proposed: 0, lots: lotsOf(p) }; })
      .sort(function (a, b) { return a.stock - b.stock || a.name.localeCompare(b.name); });
  }
  // Productos con lotes: no se regularizan aquí (la regla de lotes se define aparte); solo se marcan.
  var LOTS_MESSAGE = 'Este producto tiene lotes: regularízalo desde Inventario. Aquí no se ajusta para no tocar los lotes.';
  function lotsOf(p) { var a = aj(); try { return !!(a && typeof a.hasLots === 'function' && a.hasLots(p)); } catch (_) { return true; } }
  // Id único por simulación: cada «Revisar ajuste» crea uno nuevo; reintentar la MISMA simulación no duplica.
  var simSeq = 0;
  function newSimId() {
    try { if (root.crypto && typeof root.crypto.randomUUID === 'function') return 'sn-' + root.crypto.randomUUID(); } catch (_) {}
    return 'sn-' + Date.now().toString(36) + '-' + (++simSeq).toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function fmt(v) { return Number(v).toLocaleString('es-PE', { maximumFractionDigits: 3 }); }
  // Simulación pura: valida el valor elegido y devuelve el ajuste. No hay valor por defecto: vacío = error.
  function simulate(row, target) {
    if (row.lots) return { ok: false, blocked: 'LOTS', message: LOTS_MESSAGE };
    var raw = String(target == null ? '' : target).trim();
    if (!raw) return { ok: false, message: 'Escribe el stock final que quieres dejar (por ejemplo 0).' };
    if (!DECIMAL.test(raw)) return { ok: false, message: 'Escribe el stock final solo con números, sin signos.' };
    var t = Number(raw.replace(',', '.'));
    if (!Number.isFinite(t) || t < 0) return { ok: false, message: 'El stock final no puede ser negativo.' };
    if (!FRACTIONAL_UNITS.test(row.unit) && !Number.isInteger(t)) return { ok: false, message: 'Este producto se mueve en unidades enteras.' };
    var delta = Math.round((t - row.stock) * 1000) / 1000;
    if (!(delta > 0)) return { ok: false, message: 'El stock final debe ser mayor que el actual.' };
    return { ok: true, simId: newSimId(), productId: row.id, before: row.stock, after: t, delta: delta,
      summary: row.name + ': ' + fmt(row.stock) + ' → ' + fmt(t) + ' (suma ' + fmt(delta) + ')' };
  }
  function noteFor(sim, extra) {
    var n = 'Regularización de stock negativo: de ' + fmt(sim.before) + ' a ' + fmt(sim.after);
    extra = String(extra == null ? '' : extra).replace(/\s+/g, ' ').trim();
    return (extra ? n + '. ' + extra : n).slice(0, 300);
  }
  // Registro de idempotencia persistido (localStorage), además de la verificación de stock esperado.
  var DONE_KEY = 'na_stock_negativo_done_v1', MAX_DONE = 50, inFlight = {};
  function store() { try { return root.localStorage || null; } catch (_) { return null; } }
  function readDone() { var s = store(); try { var v = s && JSON.parse(s.getItem(DONE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function isDone(k) { return readDone().indexOf(k) >= 0; }
  function markDone(k) { var s = store(); if (!s) return; var v = readDone().filter(function (x) { return x !== k; }); v.push(k); try { s.setItem(DONE_KEY, JSON.stringify(v.slice(-MAX_DONE))); } catch (_) {} }
  function key(sim) { return String(sim.simId || ''); }
  function products() {
    var c = root.NuevoAmanecerCanonical;
    try { if (c && typeof c.enabled === 'function' && c.enabled()) { var s = c.snapshot(); if (s && Array.isArray(s.products)) return s.products; } } catch (_) {}
    return typeof productos !== 'undefined' ? productos : root.productos || []; // eslint-disable-line no-undef
  }
  // Aplica un ajuste ya simulado y confirmado. Reintentos y doble clic no duplican.
  async function apply(sim, extraNote) {
    if (!available()) return { ok: false, message: 'Sin permiso.' };
    if (!sim || !sim.ok) return { ok: false, message: 'Primero revisa el ajuste.' };
    var k = key(sim);
    if (!k) return { ok: false, message: 'Primero revisa el ajuste.' };
    if (isDone(k)) return { ok: true, duplicate: true, message: 'Este ajuste ya se registró.' };
    if (inFlight[k]) return { ok: false, duplicate: true, message: 'Este ajuste ya se está registrando.' };
    var prod = products().find(function (p) { return p && pid(p) === sim.productId; });
    if (!prod) return { ok: false, message: 'Producto no encontrado.' };
    if (lotsOf(prod)) return { ok: false, blocked: 'LOTS', message: LOTS_MESSAGE };
    if (stockOf(prod) !== sim.before) return { ok: false, stale: true, message: 'El stock de este producto cambió (ahora ' + fmt(stockOf(prod)) + '). No se registró nada; revisa de nuevo.' };
    inFlight[k] = true;
    try {
      var res = await aj().register({ productId: sim.productId, type: 'correccion', direction: 'sumar', quantity: String(sim.delta), note: noteFor(sim, extraNote) });
      if (res && res.ok) markDone(k);
      return res || { ok: false, message: 'No se registró el ajuste.' };
    } finally { delete inFlight[k]; }
  }
  // ---- Interfaz (dentro de la página de Ajustes de inventario) ----
  function el(tag, cls, value) { var n = root.document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = String(value); return n; }
  function section(page) {
    var s = page.querySelector('[data-sn-root]');
    if (!s) {
      var main = page.querySelector('[data-aj-main]'); if (!main) return null;
      s = el('section', 'sn-shell'); s.setAttribute('data-sn-root', ''); s.setAttribute('aria-labelledby', 'snTitle');
      var h = el('h2', '', 'Stock negativo (solo dueño)'); h.id = 'snTitle'; s.appendChild(h);
      s.appendChild(el('p', 'aj-description', 'Elige el stock final de cada producto, revisa el cambio y confírmalo. Nada se ajusta solo.'));
      var list = el('div'); list.setAttribute('data-sn-list', ''); s.appendChild(list);
      main.insertBefore(s, main.firstChild);
    }
    return s;
  }
  function renderRow(row) {
    var card = el('div', 'sn-row'); card.setAttribute('data-sn-row', row.id);
    card.appendChild(el('strong', 'sn-name', row.name));
    card.appendChild(el('span', 'sn-stock', 'Stock actual: ' + fmt(row.stock)));
    var lab = el('label', '', 'Stock final'), inp = el('input');
    inp.type = 'text'; inp.inputMode = 'decimal'; inp.autocomplete = 'off'; inp.placeholder = 'Propuesto: ' + fmt(row.proposed); inp.setAttribute('data-sn-target', '');
    lab.appendChild(inp); card.appendChild(lab);
    if (row.lots) { inp.disabled = true; card.appendChild(el('p', 'aj-lot-note', LOTS_MESSAGE)); }
    var rev = el('button', '', 'Revisar ajuste'); rev.type = 'button'; rev.disabled = !!row.lots; rev.setAttribute('data-sn-review', ''); card.appendChild(rev);
    var conf = el('div', 'sn-confirm'); conf.hidden = true; conf.setAttribute('data-sn-confirm', '');
    var sum = el('p', 'sn-summary'); sum.setAttribute('data-sn-summary', ''); conf.appendChild(sum);
    var ok = el('button', 'aj-submit', 'Confirmar ajuste'); ok.type = 'button'; ok.setAttribute('data-sn-apply', ''); conf.appendChild(ok);
    var no = el('button', '', 'Cancelar'); no.type = 'button'; no.setAttribute('data-sn-cancel', ''); conf.appendChild(no);
    card.appendChild(conf);
    var msg = el('p', 'aj-message'); msg.setAttribute('data-sn-message', ''); msg.setAttribute('role', 'status'); card.appendChild(msg);
    return card;
  }
  function render() {
    var page = root.document && root.document.getElementById(PAGE_ID); if (!page) return false;
    var s = page.querySelector('[data-sn-root]');
    if (!available()) { if (s) s.remove(); return false; }
    s = section(page); if (!s) return false;
    var list = s.querySelector('[data-sn-list]'), rows = negatives(products());
    list.replaceChildren();
    if (!rows.length) { list.appendChild(el('p', 'aj-empty', 'No hay productos con stock negativo.')); return true; }
    rows.forEach(function (r) { list.appendChild(renderRow(r)); });
    return true;
  }
  var pending = new WeakMap();
  function rowData(card) { var id = card.getAttribute('data-sn-row'); return negatives(products()).find(function (r) { return r.id === id; }) || null; }
  async function onClick(e) {
    var t = e.target, card = t && t.closest && t.closest('[data-sn-row]'); if (!card) return;
    var msg = card.querySelector('[data-sn-message]'), conf = card.querySelector('[data-sn-confirm]');
    if (t.closest('[data-sn-review]')) {
      var row = rowData(card); if (!row) { render(); return; }
      var sim = simulate(row, card.querySelector('[data-sn-target]').value);
      msg.textContent = sim.ok ? '' : sim.message; msg.setAttribute('data-aj-ok', sim.ok ? '' : 'false');
      if (sim.ok) { pending.set(card, sim); card.querySelector('[data-sn-summary]').textContent = sim.summary; }
      conf.hidden = !sim.ok; return;
    }
    if (t.closest('[data-sn-cancel]')) { pending.delete(card); conf.hidden = true; msg.textContent = ''; return; }
    if (t.closest('[data-sn-apply]')) {
      var s2 = pending.get(card); if (!s2) return;
      var btn = card.querySelector('[data-sn-apply]'); btn.disabled = true;
      var res = await apply(s2);
      msg.textContent = res.ok ? 'Ajuste registrado.' : res.message; msg.setAttribute('data-aj-ok', res.ok ? 'true' : 'false');
      if (res.ok) { pending.delete(card); try { var a = aj(); if (a && a.render) a.render(); } catch (_) {} render(); }
      else btn.disabled = false;
    }
  }
  function init() {
    var page = root.document && root.document.getElementById(PAGE_ID); if (!page || page.__naSnBound) return; page.__naSnBound = true;
    page.addEventListener('click', function (e) { onClick(e); });
    function update() { if (page.classList.contains('active')) render(); }
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', render);
    root.addEventListener('na:canonical-updated', update);
    update();
  }
  root.NA_STOCK_NEGATIVO = Object.freeze({ FEATURE_ID: FEATURE_ID, available: available, negatives: negatives, simulate: simulate, noteFor: noteFor, apply: apply, render: render, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
