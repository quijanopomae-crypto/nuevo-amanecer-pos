/* Ajustes de inventario con motivo (id ajustes-inventario). Registra mermas, roturas, vencidos y
 * correcciones con tipo, usuario (Nombre · ID), fecha (Lima) y nota. NO escribe stock directamente:
 * - CANON activo: NuevoAmanecerCanonical.adjustInventory con movement_type ENTRADA/SALIDA (el Worker
 *   ya los acepta; sin cambios de servidor).
 * - Modo local: applyInventoryMovement (punto central del ledger) + saveAllData, con reversión.
 * El motivo viaja codificado: 'ajuste:v1:' + JSON {t, u:{n,i}, n}. Compras, ventas y movimientos
 * normales nunca empiezan con ese prefijo. No toca ventas ni pagos. Reporte solo para el dueño. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageAjustesInventario', FEATURE_ID = 'ajustes-inventario';
  var PREFIX = 'ajuste:v1:', MAX_REASON = 500;
  var TYPES = { merma: 'Merma', rotura: 'Rotura', vencido: 'Vencido', correccion: 'Corrección' };
  var HAS = Object.prototype.hasOwnProperty;
  // Solo claves propias: rechaza heredadas como 'constructor' o 'toString'.
  function own(map, key) { return typeof key === 'string' && HAS.call(map, key); }
  function isType(type) { return own(TYPES, type); }
  function text(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }
  // Motivo estructurado; recorta la nota para no pasar de 500 caracteres (límite del Worker).
  function encodeReason(type, user, note) {
    if (!isType(type)) throw new Error('TIPO_INVALIDO');
    var u = { n: text(user && user.nombre).slice(0, 100) || 'Sin nombre', i: text(user && user.id).slice(0, 60) };
    var n = text(note).slice(0, 400), out;
    for (;;) {
      out = PREFIX + JSON.stringify({ t: type, u: u, n: n });
      if (out.length <= MAX_REASON || !n) return out.slice(0, MAX_REASON);
      n = n.slice(0, Math.max(0, n.length - (out.length - MAX_REASON) - 1));
    }
  }
  function parseReason(reason) {
    if (typeof reason !== 'string' || reason.indexOf(PREFIX) !== 0) return null;
    try {
      var o = JSON.parse(reason.slice(PREFIX.length));
      if (!o || typeof o !== 'object' || !isType(o.t) || !o.u || typeof o.u !== 'object') return null;
      return { type: o.t, label: TYPES[o.t], user: { nombre: String(o.u.n || ''), id: String(o.u.i || '') }, note: typeof o.n === 'string' ? o.n : '' };
    } catch (_) { return null; }
  }
  function isAdjustment(move) { return !!(move && parseReason(move.reason)); }
  // Bloqueo provisional: el Worker no permite elegir el lote en una SALIDA (reparte FEFO: primero lotes
  // vigentes; los vencidos solo con aprobación). Por eso «Rotura» y «Vencido» quedan desactivados en
  // productos con lotes hasta que el servidor permita elegir el lote. Merma y Corrección siguen igual.
  var LOT_BLOCKED = { rotura: true, vencido: true };
  var LOT_BLOCK_MESSAGE = 'Este producto tiene lotes: «Rotura» y «Vencido» están desactivados porque el servidor todavía no permite elegir de qué lote se descuenta (descontaría primero de un lote vigente). Se habilitarán cuando el servidor permita elegir el lote.';
  // Con lotes = al menos un lote con cantidad > 0 (o datos de lotes ilegibles, por precaución).
  function hasLots(product) {
    if (!product) return false;
    var rows = product.lots;
    if (!Array.isArray(rows)) {
      if (product.lots_json === undefined || product.lots_json === null || product.lots_json === '') return false;
      try { rows = JSON.parse(product.lots_json); } catch (_) { return true; }
      if (!Array.isArray(rows)) return true;
    }
    return rows.some(function (r) { return !!r && !(Number(r.quantity) <= 0); });
  }
  function lotBlocked(type, product) { return own(LOT_BLOCKED, type) && hasLots(product); }
  // Merma, rotura y vencido restan; la corrección puede sumar o restar.
  function plan(type, quantity, direction) {
    var q = Number(quantity);
    if (!isType(type) || !Number.isFinite(q) || q <= 0) return null;
    var up = type === 'correccion' && direction === 'sumar';
    return { movement_type: up ? 'ENTRADA' : 'SALIDA', delta: up ? q : -q, quantity: q };
  }
  // Validación de cantidad (UI y register). MAX_QTY: tope sano por ajuste; una Corrección que suma no puede
  // dejar el stock por encima de stock actual + MAX_CORRECTION_UP. Solo los productos por peso/volumen/longitud
  // (misma regla de unidad que el movimiento de Inventario y CANON) aceptan decimales, hasta 3.
  var MAX_QTY = 1000000, MAX_CORRECTION_UP = 10000;
  var FRACTIONAL_UNITS = /^(kilogramos?|kilos?|kgs?|gramos?|grs?|g|litros?|lts?|l|mililitros?|ml|metros?|m)$/i;
  function allowsFraction(product) { return !!product && FRACTIONAL_UNITS.test(text(product.unit || product.unidad)); }
  function currentStock(product) {
    var v = product && (typeof product.current_stock_quantity === 'number' ? product.current_stock_quantity : Number(product.stock));
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  function fmtQty(v) { return Number(v).toLocaleString('es-PE', { maximumFractionDigits: 3 }); }
  // Devuelve '' si la cantidad es válida, o el mensaje en español.
  // Cantidad: número tal cual; texto solo decimal estricto («12», «2.5», «2,5», «.5», «,5»). Rechaza hex
  // («0x10»), exponentes («1e3»), signos, «Infinity» y vacío (Number() los aceptaría). El campo de la
  // pantalla es de texto (no type=number) para que el navegador no convierta «1,5» en 15.
  var DECIMAL = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;
  var EXPONENT = /^[\d.,]*[eE][+-]?\d*$/;
  function parseQuantity(quantity) {
    if (typeof quantity === 'number') return quantity;
    var raw = String(quantity == null ? '' : quantity).trim();
    return DECIMAL.test(raw) ? Number(raw.replace(',', '.')) : NaN;
  }
  function quantityError(product, type, quantity, direction) {
    var q = parseQuantity(quantity), raw = typeof quantity === 'string' ? quantity.trim() : '';
    var tooBig = 'La cantidad no puede superar ' + fmtQty(MAX_QTY) + ' por ajuste.';
    // «1e12» o 400 nueves: se avisa del tope, no con el mensaje genérico.
    if (EXPONENT.test(raw)) return Number(raw.replace(',', '.')) > MAX_QTY ? tooBig : 'Escribe la cantidad solo con números, sin «e» (ej. 1000).';
    if (q === Infinity && DECIMAL.test(raw)) return tooBig;
    if (!Number.isFinite(q) || q <= 0) return 'Ingresa una cantidad válida mayor que 0.';
    if (q > MAX_QTY) return tooBig;
    if (!allowsFraction(product) && !Number.isInteger(q)) return 'Este producto se mueve en unidades enteras. Para decimales (ej. 2.5) el producto debe venderse por kilogramo, gramo o litro.';
    if (allowsFraction(product) && Math.abs(Math.round(q * 1000) - q * 1000) > 1e-6) return 'Usa como máximo 3 decimales.';
    var stock = currentStock(product), up = type === 'correccion' && direction === 'sumar';
    if (stock !== null && !up && q > stock + 1e-9) return 'No puedes descontar más que el stock actual (' + fmtQty(stock) + ').';
    if (up && q > MAX_CORRECTION_UP) return 'Una corrección no puede sumar más de ' + fmtQty(MAX_CORRECTION_UP) + ' sobre el stock actual' + (stock !== null ? ' (' + fmtQty(stock) + ')' : '') + '.';
    return '';
  }
  function limaDay(ts) {
    var t = Date.parse(ts); if (!Number.isFinite(t)) return '';
    return new Date(t - 5 * 3600000).toISOString().slice(0, 10);
  }
  function limaLabel(ts) {
    var t = Date.parse(ts); if (!Number.isFinite(t)) return '';
    var d = new Date(t - 5 * 3600000).toISOString();
    return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) + ' ' + d.slice(11, 16);
  }
  // Une movimientos locales y de CANON; solo los que llevan el prefijo de ajuste.
  function collect(localMoves, canonicalMoves, products) {
    var names = new Map();
    (Array.isArray(products) ? products : []).forEach(function (p) { if (p) names.set(String(p.id != null ? p.id : p.product_id), String(p.name || p.nombre || '')); });
    var rows = [], seen = new Set();
    function push(move, canonical) {
      var info = parseReason(move && move.reason); if (!info) return;
      var id = String(move.operation_id || move.movement_id || move.id || '');
      if (id && seen.has(id)) return; if (id) seen.add(id);
      var pid = String(move.product_id != null ? move.product_id : move.productId);
      // CANON exporta quantity con signo; si llega positiva en una SALIDA, se resta.
      var q = Number(move.quantity), delta = move.delta != null ? Number(move.delta) : canonical ? (String(move.movement_type).toUpperCase() === 'SALIDA' && q > 0 ? -q : q) : NaN;
      var ts = move.created_at || move.timestamp || '';
      rows.push({ id: id, productId: pid, product: names.get(pid) || 'Producto ' + pid, type: info.type, label: info.label, user: info.user, note: info.note,
        delta: Number.isFinite(delta) ? delta : 0, timestamp: ts, day: limaDay(ts) });
    }
    (Array.isArray(canonicalMoves) ? canonicalMoves : []).forEach(function (m) { push(m, true); });
    (Array.isArray(localMoves) ? localMoves : []).forEach(function (m) { push(m, false); });
    rows.sort(function (a, b) { return String(b.timestamp).localeCompare(String(a.timestamp)) || a.id.localeCompare(b.id); });
    return rows;
  }
  function summary(rows) {
    var out = { merma: 0, rotura: 0, vencido: 0, correccion: 0 };
    rows.forEach(function (r) { out[r.type] += r.delta; });
    return out;
  }
  function csvCell(value) {
    var raw = String(value == null ? '' : value);
    if (typeof value === 'string' && /^[=+@\t\r\n-]/.test(raw.replace(/^ +/, ''))) raw = "'" + raw;
    return /[",\r\n]/.test(raw) ? '"' + raw.replace(/"/g, '""') + '"' : raw;
  }
  function toCsv(rows) {
    var lines = [['Fecha (Lima)', 'Producto', 'Tipo', 'Cantidad', 'Usuario', 'Nota']];
    rows.forEach(function (r) { lines.push([limaLabel(r.timestamp), r.product, r.label, r.delta, r.user.nombre + (r.user.id ? ' · ' + r.user.id : ''), r.note]); });
    return '\uFEFF' + lines.map(function (l) { return l.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }
  function isOwner() {
    try { var roles = root.NA_ROLES; return !!(roles && typeof roles.isOwner === 'function' && roles.isOwner() === true); } catch (_) { return false; }
  }
  function available() {
    try {
      var p = root.NA_PERMISSIONS;
      return isOwner() && !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID) && typeof p.featureLocked === 'function' && !p.featureLocked(FEATURE_ID));
    } catch (_) { return false; }
  }
  // ---- Datos del POS ----
  function canon() { var c = root.NuevoAmanecerCanonical; try { return c && typeof c.enabled === 'function' && c.enabled() ? c : null; } catch (_) { return null; } }
  function products() {
    var c = canon();
    if (c) { try { var s = c.snapshot(); if (s && Array.isArray(s.products)) return s.products; } catch (_) {} }
    return typeof productos !== 'undefined' ? productos : root.productos || []; // eslint-disable-line no-undef
  }
  function localMoves() { try { return typeof inventoryMovements !== 'undefined' ? inventoryMovements : root.inventoryMovements; } catch (_) { return []; } } // eslint-disable-line no-undef
  function canonicalMoves() { var c = canon(); try { var s = c && c.snapshot(); return s && Array.isArray(s.inventoryMovements) ? s.inventoryMovements : []; } catch (_) { return []; } }
  function currentUser() {
    try { var a = typeof _naGetActiveCashier === 'function' ? _naGetActiveCashier() : null; if (a && (a.nombre || a.id)) return { nombre: a.nombre, id: a.id }; } catch (_) {} // eslint-disable-line no-undef
    return { nombre: 'Dueño', id: '' };
  }
  // Mensajes en español para los códigos que puede devolver un ajuste en CANON (en vez del código crudo).
  var EXPIRED_ONLY_MESSAGE = 'Este producto solo tiene stock en lotes vencidos y este ajuste no puede descontarlos. Registra la salida desde Inventario con el botón «Salida» del producto: pide el PIN del dueño para usar lotes vencidos (requiere «Permitir vender lotes vencidos» activo en Configuración). Una salida hecha con «Salida» no aparece como «Vencido» en el reporte de Ajustes. No se modificó el stock.';
  var CANON_MESSAGES = {
    expired_lots_confirmation_required: EXPIRED_ONLY_MESSAGE,
    EXPIRED_LOTS_CONFIRMATION_REQUIRED: EXPIRED_ONLY_MESSAGE,
    expired_lot_approval_required: 'No se autorizó la salida de lotes vencidos. No se modificó el stock.',
    insufficient_stock: 'No hay suficiente stock en CANON para este ajuste. No se modificó el stock.',
    INSUFFICIENT_CANONICAL_STOCK: 'No hay suficiente stock en CANON para este ajuste. No se modificó el stock.',
    INSUFFICIENT_PROJECTED_STOCK: 'No se registró el ajuste: parte de ese stock ya está vendido en ventas que aún se están enviando a CANON. Espera a que se sincronicen o registra una cantidad menor.',
    LOT_STOCK_RESERVED_BY_PENDING_SALE: 'No se registró el ajuste: hay lotes reservados por ventas pendientes de este producto. Espera a que se confirmen antes de retirar stock.',
    stale_stock: 'El stock cambió en CANON mientras registrabas el ajuste. No se modificó el stock; revisa el stock actual y vuelve a intentarlo.',
    product_not_found: 'CANON no encontró este producto. No se modificó el stock.',
    product_inventory_disabled: 'Este producto no controla inventario en CANON. No se modificó el stock.',
    invalid_lot_state: 'Los lotes de este producto en CANON no cuadran con su stock. No se modificó el stock; revisa los lotes en Inventario.',
    stale_authority: 'Este dispositivo ya no tiene una autorización vigente para escribir en CANON (cambió la caja principal o sus credenciales). No se modificó el stock; vuelve a conectar el dispositivo antes de registrar ajustes.',
    canonical_inventory_conflict: 'CANON no pudo guardar el ajuste porque otra operación cambió este producto al mismo tiempo. No se modificó el stock; revisa el stock actual y vuelve a intentarlo.',
    CANONICAL_FINANCIAL_PENDING: 'Hay otra operación de CANON pendiente de confirmar. No se registró el ajuste; espera a que se confirme o se resuelva y vuelve a intentarlo.'
  };
  var PREVIOUS_PENDING_MESSAGE = 'Tu ajuste anterior sigue pendiente en CANON y se reintentará solo. Este nuevo ajuste no se registró: espera a que se confirme el anterior y no lo registres de nuevo.';
  function canonMessage(code) {
    code = text(code);
    return own(CANON_MESSAGES, code) ? CANON_MESSAGES[code] : 'CANON no registró el ajuste (' + code + ').';
  }
  // Un rechazo definitivo del Worker llega como CANONICAL_FINANCIAL_REJECTED_<status> y deja el comando en
  // el diario con last_error. Se lee el código real y se libera el diario con discardRejectedInventory (el
  // mismo camino que usa el movimiento de Inventario), para no bloquear las siguientes operaciones.
  // operation_id propio (UUID, el mismo formato que genera el cliente) para reconocer nuestra entrada del diario.
  // Nunca devuelve '': sin randomUUID arma un UUID v4 con crypto.getRandomValues; sin crypto, con hora + Math.random.
  function newOperationId() {
    try { if (root.crypto && typeof root.crypto.randomUUID === 'function') { var u = root.crypto.randomUUID(); if (u) return String(u); } } catch (_) {}
    var b = new Array(16), i;
    try {
      if (root.crypto && typeof root.crypto.getRandomValues === 'function') { var a = root.crypto.getRandomValues(new Uint8Array(16)); for (i = 0; i < 16; i++) b[i] = a[i]; }
      else throw new Error('sin crypto');
    } catch (_) { var t = Date.now(); for (i = 0; i < 16; i++) b[i] = (Math.floor(Math.random() * 256) ^ (i < 6 ? (t / Math.pow(256, i)) & 255 : 0)) & 255; }
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = b.map(function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  // Igual que Movimientos de Inventario: sin respuesta definitiva se conserva la MISMA operación y se reintenta.
  function retryMessage(code) {
    // Solo códigos (p. ej. CANONICAL_READ_503); un texto del navegador como «Failed to fetch» no se muestra.
    code = /^[A-Za-z0-9_]+$/.test(code) ? code : '';
    return 'CANON no respondió' + (code ? ' (' + code + ')' : '') + '. El ajuste quedó pendiente y se reintentará solo, sin duplicar, cuando vuelva la conexión. No lo registres de nuevo.';
  }
  function pendingOf(c) { try { return typeof c.pendingSnapshot === 'function' ? c.pendingSnapshot() : null; } catch (_) { return null; } }
  function pendingRetry(code, operationId, entry) {
    return { ok: false, code: code, pending: true, retry: true, operationId: operationId, message: retryMessage(text(entry && (entry.last_error || entry.last_status)) || (code === 'CANONICAL_FINANCIAL_PENDING' ? '' : code)) };
  }
  async function canonFailure(c, error, operationId) {
    var code = text(error && error.message);
    // Solo se toca la entrada del diario si es la de ESTE ajuste (mismo operation_id); si no, no se descarta.
    var pending = pendingOf(c);
    var mine = !!(operationId && pending && pending.payload && pending.payload.operation_id === operationId);
    if (/^CANONICAL_FINANCIAL_REJECTED_\d+$/.test(code)) {
      if (pending && pending.command === 'inventory.adjust' && pending.last_error && !mine) {
        return { ok: false, code: text(pending.last_error), pending: true, message: 'CANON rechazó una operación pendiente que no es este ajuste (' + text(pending.last_error) + '). No se descartó; revísala desde Inventario antes de registrar ajustes.' };
      }
      if (mine && pending.command === 'inventory.adjust' && pending.last_error) {
        code = text(pending.last_error);
        var discarded = false;
        try { discarded = typeof c.discardRejectedInventory === 'function' && (await c.discardRejectedInventory()) === true; } catch (_) {}
        // No es un rechazo definitivo (p. ej. 5xx): el ajuste sigue pendiente en el diario de CANON.
        if (!discarded) {
          var st = Number(pending.last_status);
          if (!st || st === 429 || st >= 500) return pendingRetry(code, operationId, null);
          return { ok: false, code: code, pending: true, message: 'CANON rechazó el ajuste (' + code + ') y quedó pendiente sin descartar. Revísalo desde Inventario antes de registrar otro.' };
        }
        return { ok: false, code: code, message: canonMessage(code) };
      }
    }
    // Cualquier otro error (red caída, ACK perdido, timeout, 5xx o fallo de la lectura de estado previa al
    // POST): si el diario conserva la entrada de ESTE ajuste, se reintentará sola. Nunca decir «no registró».
    if (mine) return pendingRetry(code, operationId, pending);
    if (code === 'CANONICAL_FINANCIAL_PENDING') {
      // La entrada pendiente es un ajuste anterior de esta pantalla (otro clic): no es «otra operación».
      if (pending && pending.command === 'inventory.adjust' && pending.payload && parseReason(pending.payload.reason)) {
        var last = Number(pending.last_status);
        if (last && last !== 429 && last < 500) return { ok: false, code: code, pending: true, message: 'Tu ajuste anterior fue rechazado por CANON (' + text(pending.last_error || last) + ') y sigue pendiente sin descartar. Revísalo desde Inventario antes de registrar otro.' };
        return { ok: false, code: code, pending: true, retry: true, previous: true, operationId: text(pending.payload.operation_id), message: PREVIOUS_PENDING_MESSAGE };
      }
    }
    return { ok: false, code: code, message: canonMessage(code) };
  }
  function productId(p) { return String(p.id != null ? p.id : p.product_id); }
  function productName(p) { return String(p.name || p.nombre || 'Producto'); }
  async function register(input) {
    if (!available()) return { ok: false, message: 'Sin permiso.' };
    if (!isType(input.type)) return { ok: false, message: 'Revisa el tipo y la cantidad.' };
    var product = products().find(function (p) { return p && productId(p) === String(input.productId); });
    if (!product) return { ok: false, message: 'Producto no encontrado.' };
    var qtyError = quantityError(product, input.type, input.quantity, input.direction);
    if (qtyError) return { ok: false, invalidQuantity: true, message: qtyError };
    var step = plan(input.type, parseQuantity(input.quantity), input.direction);
    if (!step) return { ok: false, message: 'Revisa el tipo y la cantidad.' };
    // Guardia antes de enviar (CANON o local): nunca se manda un ajuste Rotura/Vencido sin poder elegir lote.
    if (lotBlocked(input.type, product)) return { ok: false, blocked: 'LOTS_REQUIRE_LOT_SELECTION', message: LOT_BLOCK_MESSAGE };
    var reason = encodeReason(input.type, currentUser(), input.note);
    var c = canon();
    if (c) {
      if (typeof c.adjustInventory !== 'function') return { ok: false, message: 'CANON no disponible para ajustes.' };
      var operationId = newOperationId(), body = { product_id: productId(product), movement_type: step.movement_type, quantity: step.quantity, reason: reason };
      body.operation_id = operationId;
      try { await c.adjustInventory(body); }
      catch (e) { return canonFailure(c, e, operationId); }
      try { if (typeof c.refresh === 'function') await c.refresh(); } catch (_) {}
      return { ok: true, canonical: true };
    }
    if (typeof applyInventoryMovement !== 'function') return { ok: false, message: 'Inventario no disponible.' }; // eslint-disable-line no-undef
    var before = product.stock;
    var outcome = applyInventoryMovement({ productId: product.id, type: step.movement_type, delta: step.delta, reason: reason, source: 'ADJUSTMENT', referenceId: String(product.id) }); // eslint-disable-line no-undef
    if (!outcome || !outcome.ok) return { ok: false, message: (outcome && outcome.message) || 'Ajuste bloqueado.' };
    try {
      var saved = typeof saveAllData === 'function' ? await saveAllData() : null; // eslint-disable-line no-undef
      if (typeof _naWasPersisted === 'function' && !_naWasPersisted(saved)) throw new Error('NO_PERSISTIDO'); // eslint-disable-line no-undef
    } catch (_) {
      var m = localMoves(), own = outcome.movement;
      if (Array.isArray(m) && own) { // quita solo nuestro movimiento (por identidad o id), nunca recorta la lista
        var at = m.indexOf(own); if (at < 0 && own.id != null) at = m.findIndex(function (x) { return x && x.id === own.id; });
        if (at >= 0) m.splice(at, 1);
      }
      product.stock = before;
      try { if (typeof saveAllData === 'function') await saveAllData(); } catch (_) {} // eslint-disable-line no-undef
      return { ok: false, message: 'No se guardó el ajuste; el stock fue restaurado.' };
    }
    return { ok: true, movement: outcome.movement };
  }
  // ---- Interfaz ----
  function element(tag, className, value) { var n = root.document.createElement(tag); if (className) n.className = className; if (value !== undefined) n.textContent = String(value); return n; }
  function page() { return root.document && root.document.getElementById(PAGE_ID); }
  function units(v) { return (v > 0 ? '+' : '') + v.toLocaleString('es-PE', { maximumFractionDigits: 3 }); }
  function renderProducts(p) {
    var sel = p.querySelector('[data-aj-product]'), q = p.querySelector('[data-aj-search]'); if (!sel) return;
    var term = text(q && q.value).toLowerCase(), current = sel.value;
    sel.replaceChildren();
    var first = element('option', '', 'Elige un producto'); first.value = ''; sel.appendChild(first);
    products().filter(function (x) { return x && x.activo !== false && x.controlInventario !== false && (!term || (productName(x) + ' ' + (x.sku || '') + ' ' + (x.barcode || '')).toLowerCase().indexOf(term) >= 0); })
      .slice(0, 200).forEach(function (x) { var o = element('option', '', productName(x) + ' · stock ' + (x.stock != null ? x.stock : '—')); o.value = productId(x); sel.appendChild(o); });
    sel.value = current;
    syncLots(p);
  }
  function renderReport(p) {
    var box = p.querySelector('[data-aj-report]'); if (!box) return;
    box.replaceChildren();
    var rows = collect(localMoves(), canonicalMoves(), products());
    var s = summary(rows), cards = element('div', 'aj-summary');
    Object.keys(TYPES).forEach(function (k) { var c = element('div', 'aj-card'); c.appendChild(element('span', '', TYPES[k])); var v = element('strong', '', units(s[k])); v.setAttribute('data-aj-sum', k); c.appendChild(v); cards.appendChild(c); });
    box.appendChild(cards);
    if (!rows.length) { box.appendChild(element('p', 'aj-empty', 'Aún no hay ajustes registrados.')); return; }
    var table = element('table', 'aj-table'), head = element('thead'), tr = element('tr');
    ['Fecha (Lima)', 'Producto', 'Tipo', 'Cantidad', 'Usuario', 'Nota'].forEach(function (l, i) { var th = element('th', i === 3 ? 'aj-num' : '', l); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    var body = element('tbody');
    rows.forEach(function (r) {
      var line = element('tr'); line.setAttribute('data-aj-row', r.type);
      [['Fecha (Lima)', limaLabel(r.timestamp), ''], ['Producto', r.product, 'aj-product'], ['Tipo', r.label, ''], ['Cantidad', units(r.delta), 'aj-num'],
        ['Usuario', r.user.nombre + (r.user.id ? ' · ' + r.user.id : ''), ''], ['Nota', r.note || '—', 'aj-note']].forEach(function (c) {
        var td = element('td', c[2], c[1]); td.setAttribute('data-label', c[0]); line.appendChild(td);
      });
      body.appendChild(line);
    });
    table.appendChild(body); box.appendChild(table);
  }
  function render() {
    var p = page(); if (!p) return false;
    var status = p.querySelector('[data-aj-status]'), main = p.querySelector('[data-aj-main]');
    if (!available()) {
      if (main) main.hidden = true;
      var rep = p.querySelector('[data-aj-report]'); if (rep) rep.replaceChildren();
      if (status) status.textContent = 'Sin permiso. Pídele acceso al dueño.';
      return false;
    }
    if (main) main.hidden = false;
    if (status) status.textContent = (canon() ? 'Se registra en CANON' : 'Se registra en este dispositivo') + ' · fechas en hora de Lima · no cambia ventas ni pagos';
    renderProducts(p); renderReport(p); syncDirection(p);
    return true;
  }
  function syncDirection(p) { syncLots(p); var t = p.querySelector('[data-aj-type]'), d = p.querySelector('[data-aj-direction-wrap]'); if (t && d) d.hidden = t.value !== 'correccion'; syncQuantity(p); }
  // Validación en vivo de la cantidad (texto crudo del campo, type=text) con el mensaje en español debajo.
  function syncQuantity(p) {
    var qty = p.querySelector('[data-aj-qty]'); if (!qty) return '';
    var sel = p.querySelector('[data-aj-product]'), t = p.querySelector('[data-aj-type]'), dir = p.querySelector('[data-aj-direction]');
    var product = sel && sel.value ? products().find(function (x) { return x && productId(x) === String(sel.value); }) : null;
    var box = p.querySelector('[data-aj-qty-error]');
    if (!box && qty.parentNode) { box = element('span', 'aj-qty-error'); box.setAttribute('data-aj-qty-error', ''); box.setAttribute('role', 'alert'); box.hidden = true; qty.parentNode.appendChild(box); }
    var raw = text(qty.value), msg = product && raw ? quantityError(product, t ? t.value : '', raw, dir ? dir.value : 'restar') : '';
    if (typeof qty.setCustomValidity === 'function') qty.setCustomValidity(msg);
    if (msg) qty.setAttribute('aria-invalid', 'true'); else qty.removeAttribute('aria-invalid');
    if (box) { box.textContent = msg; box.hidden = !msg; }
    return msg;
  }
  // Desactiva «Rotura» y «Vencido» si el producto elegido tiene lotes, con la explicación visible.
  function syncLots(p) {
    var t = p.querySelector('[data-aj-type]'), sel = p.querySelector('[data-aj-product]'), note = p.querySelector('[data-aj-lot-note]');
    if (!t) return;
    var id = sel ? sel.value : '';
    var product = id ? products().find(function (x) { return x && productId(x) === String(id); }) : null;
    var locked = hasLots(product);
    Array.prototype.forEach.call(t.options, function (o) {
      if (!own(LOT_BLOCKED, o.value)) return;
      o.disabled = locked;
      o.textContent = TYPES[o.value] + (locked ? ' (no disponible con lotes)' : '');
    });
    if (locked && own(LOT_BLOCKED, t.value)) t.value = 'merma';
    if (note) { note.hidden = !locked; note.textContent = locked ? LOT_BLOCK_MESSAGE : ''; }
  }
  function exportCsv() {
    if (!available()) return false;
    var p = page(), url = root.URL.createObjectURL(new root.Blob([toCsv(collect(localMoves(), canonicalMoves(), products()))], { type: 'text/csv;charset=utf-8' }));
    var link = element('a'); link.href = url; link.download = 'ajustes-inventario-' + limaDay(new Date().toISOString()) + '.csv';
    try { p.appendChild(link); link.click(); } finally { link.remove(); root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000); }
    return true;
  }
  var busy = false, pendingOp = '', pendingTimer = 0;
  function setMessage(p, value, state) {
    var msg = p.querySelector('[data-aj-message]'); if (!msg) return;
    msg.textContent = value; msg.setAttribute('data-aj-ok', state);
  }
  // Mientras el ajuste propio siga pendiente en el diario de CANON, «Registrar» queda desactivado para que no
  // se registre dos veces. Se vuelve a revisar con cada actualización de CANON y cada pocos segundos.
  function holdPending(p, operationId) {
    pendingOp = operationId;
    var btn = p.querySelector('[data-aj-submit]'); if (btn) btn.disabled = true;
    if (!pendingTimer && typeof root.setInterval === 'function') pendingTimer = root.setInterval(function () { checkPending(p); }, 3000);
  }
  function checkPending(p) {
    if (!pendingOp) return false;
    var c = canon(), entry = c ? pendingOf(c) : null;
    if (entry && entry.payload && entry.payload.operation_id === pendingOp) return true;
    var done = pendingOp, receipt = null;
    pendingOp = '';
    if (pendingTimer) { root.clearInterval(pendingTimer); pendingTimer = 0; }
    try { receipt = c && typeof c.receiptSnapshot === 'function' ? c.receiptSnapshot() : null; } catch (_) {}
    var btn = p.querySelector('[data-aj-submit]'); if (btn && !busy) btn.disabled = false;
    if (receipt && receipt.operation_id === done) setMessage(p, 'El ajuste pendiente se confirmó en CANON.', 'true');
    else setMessage(p, 'El ajuste pendiente ya no está en espera. Revisa el stock y el reporte antes de registrar otro.', 'pending');
    render();
    return false;
  }
  async function submit(p) {
    if (busy || (pendingOp && checkPending(p))) return; busy = true;
    var msg = p.querySelector('[data-aj-message]'), btn = p.querySelector('[data-aj-submit]');
    if (btn) btn.disabled = true;
    try {
      var dir = p.querySelector('[data-aj-direction]');
      var res = await register({ productId: p.querySelector('[data-aj-product]').value, type: p.querySelector('[data-aj-type]').value,
        quantity: String(p.querySelector('[data-aj-qty]').value), direction: dir ? dir.value : 'restar', note: p.querySelector('[data-aj-note]').value });
      // Pendiente propio: aviso ámbar (no rojo de error) y «Registrar» desactivado hasta que se resuelva.
      var held = !res.ok && res.pending && res.retry && !!res.operationId;
      if (msg) setMessage(p, res.ok ? 'Ajuste registrado.' : res.message, res.ok ? 'true' : held ? 'pending' : 'false');
      if (held) holdPending(p, res.operationId);
      if (res.ok) { p.querySelector('[data-aj-qty]').value = ''; syncQuantity(p); p.querySelector('[data-aj-note]').value = ''; ['invRender', 'posRender', 'updateDashboard'].forEach(function (n) { try { if (typeof root[n] === 'function') root[n](); } catch (_) {} }); render(); }
    } finally { busy = false; if (btn) btn.disabled = !!pendingOp; }
  }
  function init() {
    var p = page(); if (!p || p.__naAjBound) return; p.__naAjBound = true;
    function update() { if (p.classList.contains('active')) render(); }
    p.addEventListener('input', function (e) { if (e.target.matches && e.target.matches('[data-aj-search]')) renderProducts(p); if (e.target.matches && e.target.matches('[data-aj-qty]')) syncQuantity(p); });
    p.addEventListener('change', function (e) { if (e.target.matches && e.target.matches('[data-aj-type], [data-aj-product], [data-aj-direction]')) syncDirection(p); });
    p.addEventListener('submit', function (e) { e.preventDefault(); submit(p); });
    p.addEventListener('click', function (e) { if (e.target.closest('[data-aj-export]')) exportCsv(); });
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(p, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { render(); });
    root.addEventListener('na:canonical-updated', function () { checkPending(p); update(); });
    update();
  }
  root.NA_AJUSTES_INVENTARIO = Object.freeze({ PREFIX: PREFIX, TYPES: TYPES, encodeReason: encodeReason, parseReason: parseReason, isAdjustment: isAdjustment, isType: isType, canonMessage: canonMessage, MAX_QTY: MAX_QTY, parseQuantity: parseQuantity, MAX_CORRECTION_UP: MAX_CORRECTION_UP, quantityError: quantityError, hasLots: hasLots, lotBlocked: lotBlocked, plan: plan, collect: collect, summary: summary, toCsv: toCsv, limaLabel: limaLabel, available: available, register: register, render: render, exportCsv: exportCsv, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
