/* Asistente: «abrir cualquier función» y «cambiar configuración» (solo en el aparato, sin cambios en el Worker).
   Detrás del candado 'asistente-acceso-total' de pos-permissions.js (true = apagado; mientras esté apagado handle() devuelve null
   y el asistente se comporta exactamente como hoy).
   Reglas:
   - El asistente actúa con los permisos de la sesión abierta (NA_ROLES), nunca con más:
       dueño confirmado -> puede abrir cualquier pantalla de la lista (si su función no tiene candado) y proponer cambios de configuración;
       empleado confirmado -> solo pantallas de empleado (SCREENS) o las que su casilla del #924 abre (NA_EMPLOYEE_PERMS.may), y nunca configuración.
   - Cerrado por defecto: id desconocido, rol sin confirmar, rol distinto al que dijo el servidor del asistente o cualquier error = negado.
   - Ningún cambio de configuración se guarda sin que la persona pulse «Guardar» en la tarjeta (token de un solo uso, se revisa el rol de nuevo).
   - No existe ninguna acción para cobrar/pagar, anular, tocar pagos pendientes ni borrar: esos pedidos se responden con un aviso.
   - La tarjeta se arma solo con createElement/textContent. */
(function (root) {
  'use strict';
  var LOCK_ID = 'asistente-acceso-total';
  // Pantallas que el asistente puede abrir. feature = id del candado/casilla de esa pantalla (si tiene).
  var TARGETS = Object.freeze([
    { page: 'pageMenu', label: 'Inicio', words: ['inicio', 'menu', 'principal'] },
    { page: 'pagePOS', label: 'Venta', words: ['venta', 'vender', 'pos'] },
    { page: 'pageInventario', label: 'Inventario', words: ['inventario', 'productos', 'stock'] },
    { page: 'pageVentas', label: 'Ventas', words: ['ventas', 'historial de ventas'] },
    { page: 'pageClientes', label: 'Clientes', words: ['clientes', 'cliente', 'creditos'] },
    { page: 'pageCaja', label: 'Caja', words: ['caja', 'cuadre'] },
    { page: 'pageGastos', label: 'Gastos', feature: 'gastos', words: ['gastos', 'gasto'] },
    { page: 'pageConfig', label: 'Configuración', words: ['configuracion', 'ajustes del pos', 'config'] },
    { page: 'pageValorizacion', label: 'Valorización de inventario', feature: 'valorizacion-inventario', words: ['valorizacion'] },
    { page: 'pageRotacionAbc', label: 'Rotación ABC', feature: 'rotacion-abc', words: ['rotacion', 'abc'] },
    { page: 'pageClientesFrecuencia', label: 'Clientes por frecuencia', feature: 'clientes-frecuencia', words: ['frecuencia'] },
    { page: 'pageReporteProductosVencer', label: 'Productos por vencer', feature: 'reporte-productos-vencer', words: ['por vencer', 'vencer', 'vencimiento'] },
    { page: 'pageKardex', label: 'Kardex', feature: 'kardex', words: ['kardex'] },
    { page: 'pageVentasStock', label: 'Ventas y stock', feature: 'reporte-ventas-stock', words: ['ventas y stock', 'ventas stock'] },
    { page: 'pageReporteArqueo', label: 'Arqueos de caja', feature: 'reporte-arqueo', words: ['arqueo', 'arqueos'] },
    { page: 'pageHistorialCompras', label: 'Historial de compras', feature: 'historial-compras-producto', words: ['historial de compras', 'compras'] },
    { page: 'pageClienteHistorial', label: 'Historial del cliente', feature: 'cliente-historial-compras', words: ['historial del cliente', 'historial de cliente'] },
    { page: 'pageEtiquetasPrecios', label: 'Etiquetas de precios', feature: 'etiquetas-precios', words: ['etiquetas', 'etiqueta'] },
    { page: 'pageProductosSinMovimiento', label: 'Productos sin movimiento', feature: 'productos-sin-movimiento', words: ['sin movimiento'] },
    { page: 'pageSugerenciaCompra', label: 'Sugerencia de compra', feature: 'sugerencia-compra', words: ['sugerencia', 'que comprar'] },
    { page: 'pageAjustesInventario', label: 'Ajustes de inventario', feature: 'ajustes-inventario', words: ['ajustes de inventario', 'ajuste de inventario'] },
    { page: 'pageReporteDeuda', label: 'Reporte de deudas', words: ['reporte de deuda', 'reporte de deudas'] },
    { page: 'pageCodigosDuplicados', label: 'Códigos duplicados', words: ['duplicados', 'codigos duplicados'] },
    { page: 'pageProximamente', label: 'Próximamente', words: ['proximamente'] }
  ].map(Object.freeze));
  // Configuración que el asistente puede proponer (lista cerrada; son ajustes del negocio pos.flags, solo dueño = 'settings.set').
  var SETTINGS = Object.freeze({
    igvActive: Object.freeze({ label: 'Calcular IGV', type: 'bool', words: ['igv'] }),
    margenActive: Object.freeze({ label: 'Mostrar margen', type: 'bool', words: ['margen'] }),
    stockAlertActive: Object.freeze({ label: 'Alerta de stock bajo', type: 'bool', words: ['alerta de stock', 'stock bajo'] }),
    printAuto: Object.freeze({ label: 'Imprimir ticket automático', type: 'bool', words: ['imprimir automatico', 'impresion automatica', 'ticket automatico'] }),
    mayoristaActive: Object.freeze({ label: 'Precio mayorista', type: 'bool', words: ['mayorista'] }),
    alertsEnabled: Object.freeze({ label: 'Avisos del POS', type: 'bool', words: ['avisos', 'alertas'] }),
    stockMin: Object.freeze({ label: 'Stock mínimo por defecto', type: 'int', min: 0, max: 9999, words: ['stock minimo'] })
  });
  // Pedidos que el asistente nunca hace (dinero o borrado). Se revisa ANTES que cualquier otra intención.
  var FORBIDDEN = /\b(pag(a|ar|ue|o|os)|cobr\w*|anul\w*|void|elimin\w*|borr\w*|quit(a|ar)\w*|abon\w*|devol\w*|devuelv\w*|extorn\w*|reembols\w*|pendientes?)\b/;
  var FORBIDDEN_MSG = 'Eso no lo hago: el asistente nunca cobra, paga, anula ventas, toca pagos pendientes ni borra nada. Hazlo tú desde su pantalla.';
  var OPEN_RE = /^(?:por favor\s+)?(?:abre|abrir|abreme|ir a|ve a|vamos a|llevame a|lleva(?:me)? a|muestra(?:me)?|mostrar|entra(?:r)? a|quiero ver)\s+(?:la |el |los |las |pantalla (?:de )?)?(.+)$/;
  var BOOL_RE = /^(?:por favor\s+)?(activa|activar|enciende|encender|prende|prender|desactiva|desactivar|apaga|apagar)\s+(?:el |la |los |las )?(.+)$/;
  var INT_RE = /^(?:por favor\s+)?(?:pon|poner|cambia|cambiar|configura|configurar)\s+(?:el |la )?(.+?)\s+(?:en|a)\s+(\d{1,6})$/;

  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function P() { return root.NA_PERMISSIONS; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function unlocked(id) { try { var p = P(); return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(id) === false); } catch (_) { return false; } }
  function enabled() { return unlocked(LOCK_ID); }
  // Sesión: rol confirmado de NA_ROLES. accessRole = lo que dijo el ping del asistente; si no coincide, nadie (cerrado).
  function session(accessRole) {
    try {
      var r = root.NA_ROLES; if (!r || r.confirmed !== true) return 'none';
      var role = r.role === 'owner' && typeof r.isOwner === 'function' && r.isOwner() === true ? 'owner' : (r.role === 'empleado' ? 'empleado' : 'none');
      if (accessRole !== undefined && accessRole !== role) return 'none';
      return role;
    } catch (_) { return 'none'; }
  }
  function target(page) { for (var i = 0; i < TARGETS.length; i++) if (TARGETS[i].page === page) return TARGETS[i]; return null; }
  // ¿Esta sesión puede abrir la pantalla? Cerrado ante cualquier duda.
  function canOpen(page, accessRole) {
    try {
      if (!enabled()) return { ok: false, msg: 'Esta función del asistente todavía no está activada.' };
      var t = typeof page === 'string' ? target(page) : null;
      if (!t) return { ok: false, msg: 'No conozco esa pantalla.' };
      var role = session(accessRole), p = P();
      if (role === 'none') return { ok: false, msg: 'No se sabe quién usa este aparato. Revisa la conexión.' };
      if (t.feature && !unlocked(t.feature)) return { ok: false, msg: '«' + t.label + '» todavía está en Próximamente.' };
      if (role === 'owner') return p.canAccessScreen('owner', t.page) ? { ok: true, target: t } : { ok: false, msg: 'No disponible.' };
      // Empleado: pantalla de empleado, o la casilla del #924 que el dueño le prendió (may ya exige candado abierto y rol empleado).
      if (p.canAccessScreen('empleado', t.page)) return { ok: true, target: t };
      var E = root.NA_EMPLOYEE_PERMS;
      if (t.feature && E && typeof E.may === 'function' && E.may(t.feature) === true && E.SCREEN_FEATURE && E.SCREEN_FEATURE[t.page] === t.feature) return { ok: true, target: t };
      return { ok: false, msg: '«' + t.label + '» es solo para el Admin.' };
    } catch (_) { return { ok: false, msg: 'No disponible.' }; }
  }
  function canConfigure(key, accessRole) {
    try {
      if (!enabled()) return { ok: false, msg: 'Esta función del asistente todavía no está activada.' };
      if (typeof key !== 'string' || !has(SETTINGS, key)) return { ok: false, msg: 'No conozco ese ajuste.' };
      var role = session(accessRole);
      if (role !== 'owner' || !P().canDo('owner', 'settings.set')) return { ok: false, msg: 'Solo el Admin cambia la configuración.' };
      return { ok: true };
    } catch (_) { return { ok: false, msg: 'No disponible.' }; }
  }
  function cleanValue(key, value) {
    var s = SETTINGS[key]; if (!s) return undefined;
    if (s.type === 'bool') return typeof value === 'boolean' ? value : undefined;
    var n = Number(value); return Number.isInteger(n) && n >= s.min && n <= s.max ? n : undefined;
  }
  function findTarget(q) { var best = null, len = 0; TARGETS.forEach(function (t) { t.words.concat([norm(t.label)]).forEach(function (w) { if ((q === w || (' ' + q + ' ').indexOf(' ' + w + ' ') >= 0) && w.length > len) { best = t; len = w.length; } }); }); return best; }
  function findSetting(q) { var best = null, len = 0; Object.keys(SETTINGS).forEach(function (k) { SETTINGS[k].words.forEach(function (w) { if ((' ' + q + ' ').indexOf(' ' + w + ' ') >= 0 && w.length > len) { best = k; len = w.length; } }); }); return best; }
  // Lee el texto. Devuelve null si no es para este módulo (sigue el camino de siempre al servidor).
  function parse(text) {
    var q = norm(text); if (!q) return null;
    if (FORBIDDEN.test(q)) return { kind: 'forbidden' };
    var m = BOOL_RE.exec(q);
    if (m) { var k = findSetting(m[2]); if (k && SETTINGS[k].type === 'bool') return { kind: 'config', key: k, value: /^(activa|enciende|prende)/.test(m[1]) }; }
    m = INT_RE.exec(q);
    if (m) { var k2 = findSetting(m[1]); if (k2 && SETTINGS[k2].type === 'int') return { kind: 'config', key: k2, value: Number(m[2]) }; }
    m = OPEN_RE.exec(q);
    if (m) { var t = findTarget(m[1]); if (t) return { kind: 'open', page: t.page }; return { kind: 'open', page: null }; }
    return null;
  }
  function currentValue(key) { try { /* global appConfig */ var c = typeof appConfig !== 'undefined' ? appConfig : null; if (!c) return undefined; return key === 'alertsEnabled' ? c.alertsEnabled !== false : c[key]; } catch (_) { return undefined; } }
  function shown(key, v) { return SETTINGS[key].type === 'bool' ? (v ? 'Encendido' : 'Apagado') : (v == null ? '-' : String(v)); }
  // Guarda UN ajuste con las funciones de siempre del POS (saveAppState ya lo sube al servidor vía config-g, que exige dueño).
  // Si guardar falla (excepción o promesa rechazada) se vuelve al valor anterior: nunca queda un cambio a medias en pantalla.
  function applySetting(key, value) {
    var c; try { c = typeof appConfig !== 'undefined' ? appConfig : null; } catch (_) { c = null; }
    if (!c) return { ok: false, msg: 'No se pudo leer la configuración de este aparato.' };
    var had = has(c, key), prev = c[key];
    function revert() { if (had) c[key] = prev; else delete c[key]; try { if (typeof root._naApplyConfigUI === 'function') root._naApplyConfigUI(); } catch (_) {} return { ok: false, msg: 'No se pudo guardar. No se cambió nada.' }; }
    var done = { ok: true, msg: 'Guardado: ' + SETTINGS[key].label + ' = ' + shown(key, value) + '.' };
    c[key] = value;
    try { if (typeof root._naApplyConfigUI === 'function') root._naApplyConfigUI(); } catch (_) {}
    var r;
    try { if (typeof root.saveAppState !== 'function') return revert(); r = root.saveAppState(); } catch (_) { return revert(); }
    if (r && typeof r.then === 'function') return Promise.resolve(r).then(function () { return done; }, function () { return revert(); });
    return done;
  }
  function navigate(page, nav) {
    try { if (typeof nav === 'function') return nav(page) !== false; var N = root.NA_MENU_NAVIGATION; if (N && typeof N.navigate === 'function') return N.navigate(page) !== false; if (typeof root.goPage === 'function') { root.goPage(page); return true; } } catch (_) {}
    return false;
  }
  // Decide qué hacer con el texto. null = no es de este módulo o el candado está puesto.
  // Resultado: { kind, ok, msg, ... }. Nada se ejecuta aquí salvo abrir una pantalla permitida (si opts.nav o navegación del POS).
  function handle(text, opts) {
    opts = opts || {};
    if (!enabled()) return null;
    var it = parse(text); if (!it) return null;
    if (it.kind === 'forbidden') return { kind: 'forbidden', ok: false, msg: FORBIDDEN_MSG };
    if (it.kind === 'open') {
      if (!it.page) return { kind: 'open', ok: false, msg: 'No conozco esa pantalla.' };
      var g = canOpen(it.page, opts.accessRole); if (!g.ok) return { kind: 'open', ok: false, msg: g.msg };
      var done = opts.dryRun ? true : navigate(it.page, opts.nav);
      return { kind: 'open', ok: !!done, page: it.page, msg: done ? 'Te abrí «' + g.target.label + '».' : 'No se pudo abrir «' + g.target.label + '».' };
    }
    var c = canConfigure(it.key, opts.accessRole); if (!c.ok) return { kind: 'config', ok: false, msg: c.msg };
    var v = cleanValue(it.key, it.value); if (v === undefined) return { kind: 'config', ok: false, msg: 'Ese valor no es válido para «' + SETTINGS[it.key].label + '».' };
    return { kind: 'config', ok: true, needsConfirm: true, key: it.key, value: v, before: currentValue(it.key), msg: '¿Guardo este cambio?' };
  }
  // Confirmación: solo el botón la llama, con su token de un solo uso; se revisa otra vez el rol.
  var tokens = Object.create(null), seq = 0, TOKEN_TTL_MS = 2 * 60 * 1000;
  function now() { return Date.now(); }
  function newToken(key, value) { var n0 = now(); Object.keys(tokens).forEach(function (k) { if (!(n0 <= tokens[k].exp)) delete tokens[k]; }); var t = 'c' + (++seq) + '-' + Math.random().toString(36).slice(2); tokens[t] = { key: key, value: value, exp: now() + TOKEN_TTL_MS }; return t; }
  function confirm(token, accessRole) {
    if (typeof token !== 'string' || !tokens[token]) return { ok: false, msg: 'Ese cambio ya se usó o venció.' };
    var t = tokens[token]; delete tokens[token];
    if (!(now() <= t.exp)) return { ok: false, msg: 'Ese cambio venció (más de 2 minutos). Pídelo otra vez.' };
    var g = canConfigure(t.key, accessRole); if (!g.ok) return { ok: false, msg: g.msg };
    var v = cleanValue(t.key, t.value); if (v === undefined) return { ok: false, msg: 'Valor no válido.' };
    return applySetting(t.key, v);
  }
  function cancel(token) { if (typeof token === 'string') delete tokens[token]; }
  // Tarjeta (solo textContent). Para «config» trae Guardar / Cancelar; no se guarda nada hasta pulsar Guardar.
  function render(doc, res, opts) {
    opts = opts || {};
    function n(tag, cls, txt) { var e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
    var box = n('div', 'na-asst-msg a na-asst-acc'); box.setAttribute('data-acc', res.kind + (res.ok ? '' : '-no'));
    if (!(res.kind === 'config' && res.ok && res.needsConfirm)) { box.appendChild(n('p', null, res.msg)); return box; }
    var s = SETTINGS[res.key];
    box.appendChild(n('h4', null, 'Cambiar configuración'));
    var row = n('p', 'na-asst-acc-row'); row.appendChild(n('span', null, s.label + ': ')); row.appendChild(n('span', null, shown(res.key, res.before) + ' → ')); row.appendChild(n('b', null, shown(res.key, res.value))); box.appendChild(row);
    box.appendChild(n('p', 'note', 'No se guarda hasta que pulses «Guardar».'));
    var tok = newToken(res.key, res.value), btns = n('div', 'na-asst-acc-btns');
    var ok = n('button', 'na-asst-acc-ok', 'Guardar'), no = n('button', 'na-asst-acc-no', 'Cancelar'); ok.type = 'button'; no.type = 'button';
    var out = n('p', 'na-asst-acc-out'); out.setAttribute('role', 'status');
    function end(msg) { ok.disabled = true; no.disabled = true; out.textContent = msg; }
    ok.addEventListener('click', function () { if (ok.disabled) return; ok.disabled = true; no.disabled = true; Promise.resolve(confirm(tok, opts.accessRole)).then(function (r) { end(r.msg); }, function () { end('No se pudo guardar. No se cambió nada.'); }); });
    no.addEventListener('click', function () { if (no.disabled) return; cancel(tok); end('Cancelado. No se cambió nada.'); });
    btns.appendChild(ok); btns.appendChild(no); box.appendChild(btns); box.appendChild(out);
    return box;
  }
  // Lista de acciones que existen (para pruebas y auditoría): solo abrir y configurar.
  var ACTION_KINDS = Object.freeze(['open', 'config']);
  root.NA_ASISTENTE_ACCIONES = Object.freeze({ LOCK_ID: LOCK_ID, TARGETS: TARGETS, SETTINGS: SETTINGS, ACTION_KINDS: ACTION_KINDS, TOKEN_TTL_MS: TOKEN_TTL_MS, FORBIDDEN_MSG: FORBIDDEN_MSG,
    enabled: enabled, parse: parse, canOpen: canOpen, canConfigure: canConfigure, handle: handle, confirm: confirm, cancel: cancel, render: render });
})(globalThis);
