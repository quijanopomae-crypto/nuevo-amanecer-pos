/* Etapa 2 (G): secciones Usuarios y PIN, Aparatos conectados, Copia de seguridad; nombres claros;
   Reseteo al final con reglas seguras. Todo lo sensible lo valida el servidor. */
(function (root) {
  'use strict';
  var doc = root.document;
  var R = function () { return root.NA_ROLES; };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, k) { try { root.toast(m, k || 'success'); } catch (_) {} }
  function cloud() { try { return !!(root.NuevoAmanecerCanonical && root.NuevoAmanecerCanonical.enabled()); } catch (_) { return false; } }
  function head(icon, title, sub) { return '<div class="cfg-screen-head"><div class="cfg-screen-head-main"><div class="cfg-screen-head-icon">' + icon + '</div><div><div class="cfg-screen-head-title">' + esc(title) + '</div><div class="cfg-screen-head-sub">' + esc(sub) + '</div></div></div></div>'; }
  function fmtDate(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return iso; } }

  var SECTIONS = [
    ['usuarios', '🔐', 'Usuarios y PIN', 'PIN del dueño y roles'],
    ['aparatos', '📱', 'Aparatos conectados', 'Celulares y cajas vinculados'],
    ['respaldo', '💾', 'Copia de seguridad', 'Descargar respaldo']
  ];
  var RENAMES = { control: ['Bloqueos y permisos', 'Qué módulos se pueden usar'], info: ['Estado del sistema', 'Versión y datos guardados'], importar: ['Importar productos', 'Catálogo desde Excel o CSV'] };

  function sidebar() {
    var sb = doc.getElementById('cfgSidebar'); if (!sb) return;
    var after = sb.querySelector('.cfg-cat-btn[data-cfgcat="ticket"]');
    SECTIONS.slice().reverse().forEach(function (s) {
      if (sb.querySelector('.cfg-cat-btn[data-cfgcat="' + s[0] + '"]')) return;
      var b = doc.createElement('button'); b.className = 'cfg-cat-btn na-g-cat'; b.dataset.cfgcat = s[0];
      b.setAttribute('onclick', "switchCfgCategory('" + s[0] + "')");
      b.innerHTML = '<span>' + s[1] + '</span><div><strong>' + esc(s[2]) + '</strong><small>' + esc(s[3]) + '</small></div>';
      if (s[0] === 'respaldo') { var imp = sb.querySelector('.cfg-cat-btn[data-cfgcat="importar"]'); if (imp) { imp.after(b); return; } }
      if (after) after.after(b); else sb.appendChild(b);
    });
    Object.keys(RENAMES).forEach(function (k) {
      var b = sb.querySelector('.cfg-cat-btn[data-cfgcat="' + k + '"]'); if (!b) return;
      var st = b.querySelector('strong'), sm = b.querySelector('small');
      if (st) st.textContent = RENAMES[k][0]; if (sm && !b.dataset.naRenamed) sm.textContent = RENAMES[k][1]; b.dataset.naRenamed = '1';
    });
    // Reseteo siempre al final, separado y en rojo.
    var reset = sb.querySelector('.cfg-cat-btn[data-cfgcat="reseteo"]');
    if (reset) { reset.classList.add('na-cfg-danger'); var st2 = reset.querySelector('strong'), sm2 = reset.querySelector('small'); if (st2) st2.textContent = 'Reseteo'; if (sm2) sm2.textContent = 'Borrar datos de este aparato'; sb.appendChild(reset); }
  }

  function usuariosHtml() {
    var r = R(), set = r && r.pinSet;
    return head('🔐', 'Usuarios y PIN', 'El PIN del dueño autoriza anulaciones, ajustes de stock, cambios de precio y el reseteo.')
      + '<div class="cfg-panel"><div class="cfg-panel-title">Este aparato</div><div class="cfg-info-list">'
      + '<div class="cfg-info-row"><span>Rol</span><span>' + (r && r.role === 'empleado' ? 'Empleado' : 'Dueño') + '</span></div>'
      + '<div class="cfg-info-row"><span>PIN del dueño</span><span id="naPinState">' + (set ? 'Configurado' : 'Todavía no configurado') + '</span></div></div></div>'
      + '<div class="cfg-panel"><div class="cfg-panel-title">' + (set ? 'Cambiar PIN del dueño' : 'Crear PIN del dueño') + '</div>'
      + '<div class="cfg-panel-sub">De 4 a 8 dígitos. Se guarda cifrado en el servidor, nunca en este aparato. No lo compartas por chat.</div>'
      + '<div class="na-g-form">' + (set ? '<label>PIN actual<input id="naPinCurrent" class="cfg-input" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>' : '')
      + '<label>PIN nuevo<input id="naPinNew" class="cfg-input" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>'
      + '<label>Repite el PIN nuevo<input id="naPinNew2" class="cfg-input" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>'
      + '<button type="button" class="na-cfg-save-btn" id="naPinSave">Guardar PIN</button></div></div>'
      + '<div class="cfg-business-note">Los cajeros y sus permisos locales siguen en Negocio › Cajeros locales. Para que un empleado use otro celular, ve a Aparatos conectados.</div>';
  }
  async function savePin(who) {
    var cur = doc.getElementById('naPinCurrent'), a = doc.getElementById('naPinNew'), b = doc.getElementById('naPinNew2');
    var clear = function () { [cur, a, b].forEach(function (i) { if (i) i.value = ''; }); };
    if (!/^\d{4,8}$/.test(a.value)) { toast('El PIN debe tener de 4 a 8 dígitos.', 'error'); return; }
    if (a.value !== b.value) { toast('Los dos PIN nuevos no coinciden.', 'error'); return; }
    try { await R().api('/auth/owner-pin', { new_pin: a.value, current_pin: cur ? cur.value : undefined }); clear(); await R().refresh(); toast('PIN del ' + (who === 'admin' ? 'admin' : 'dueño') + ' guardado'); render('usuarios'); }
    catch (e) { clear(); toast(R().message(e), 'error'); }
  }

  function aparatosHtml() {
    return head('📱', 'Aparatos conectados', 'Vincula el celular de un empleado con un código de un solo uso. Puedes desconectarlo cuando quieras.')
      + '<div class="cfg-panel"><div class="cfg-panel-title">Vincular un aparato de empleado</div>'
      + '<div class="cfg-panel-sub">El código dura 15 minutos y sirve una sola vez. El empleado podrá vender, cobrar y registrar, pero no abrir Configuración ni anular o ajustar sin tu PIN.</div>'
      + '<div class="na-g-form"><label>Nombre del aparato (opcional)<input id="naPairLabel" class="cfg-input" maxlength="60" placeholder="Ej. Caja 2, celular de Rosa"></label>'
      + '<button type="button" class="na-cfg-save-btn" id="naPairCreate">Crear código</button></div><div id="naPairOut"></div></div>'
      + '<div class="cfg-panel"><div class="cfg-panel-title">Aparatos</div><div id="naDevList" class="na-g-devs">Cargando…</div></div>';
  }
  async function loadDevices() {
    var box = doc.getElementById('naDevList'); if (!box) return;
    try {
      var d = (await R().api('/auth/devices', {})).devices || [];
      var active = d.filter(function (x) { return x.status === 'active'; });
      box.innerHTML = active.length ? active.map(function (x) {
        return '<div class="na-g-dev"><div><strong>' + esc(x.label || (x.pos_role === 'empleado' ? 'Aparato de empleado' : 'Aparato del dueño')) + (x.current ? ' (este)' : '') + '</strong>'
          + '<small>' + (x.pos_role === 'empleado' ? 'Empleado' : 'Dueño') + ' · desde ' + esc(fmtDate(x.created_at)) + '</small></div>'
          + (x.current ? '' : '<button type="button" class="na-g-revoke" data-dev="' + esc(x.device_id) + '">Desconectar</button>') + '</div>';
      }).join('') : '<div class="cfg-business-note">No hay aparatos activos.</div>';
    } catch (e) { box.textContent = R().message(e); }
  }
  // La llamada al servidor se hace con la ventana del PIN abierta: un PIN incorrecto se escribe DENTRO de
  // la ventana (.na-pin-msg) y se puede reintentar; nada de avisos flotantes que tapa el teclado.
  async function withPin(title, call) {
    var r = R(), out = null, err = null;
    if (!r.pinSet) { try { return { value: await call('') }; } catch (e) { return { error: e }; } }
    var ok = await r.askPin(title, 'Escribe tu PIN de dueño.', async function (pin) {
      try { out = await call(pin); return { ok: true, value: true }; }
      catch (e) { err = e; return { msg: r.message(e), stop: e.message !== 'owner_pin_invalid' && e.message !== 'pin_format' }; }
    });
    return ok ? { value: out } : (err && err.message !== 'owner_pin_invalid' ? { error: err, shown: true } : null);
  }
  async function createPair() {
    var label = (doc.getElementById('naPairLabel') || {}).value || '';
    var res = await withPin('Crear código para empleado', function (pin) { return R().api('/auth/pairing-code', { label: label, pin: pin || undefined }); });
    var out = doc.getElementById('naPairOut');
    if (!res) return;
    if (res.error) { if (out) { out.textContent = R().message(res.error); out.setAttribute('role', 'status'); } return; }
    var r = res.value;
    out.innerHTML = '<div class="na-g-code" aria-live="polite"><div class="na-g-code-val">' + esc(r.code) + '</div><div>Vence: ' + esc(fmtDate(r.expires_at)) + '</div>'
      + '<ol><li>En el celular del empleado abre la página del POS (la misma dirección de siempre, sin /app).</li><li>Toca «Soy empleado: tengo un código».</li><li>Escribe este código y toca «Vincular».</li></ol></div>';
    loadDevices();
  }
  async function revoke(id) {
    var ok = true; try { ok = await root._naConfirmAction('¿Desconectar este aparato? Tendrá que vincularse de nuevo.', { title: 'Desconectar aparato', danger: true, okText: 'Desconectar' }); } catch (_) { ok = root.confirm('¿Desconectar este aparato?'); }
    if (!ok) return;
    var res = await withPin('Desconectar aparato', function (pin) { return R().api('/auth/devices/revoke', { device_id: id, pin: pin || undefined }); });
    if (!res) return;
    var box = doc.getElementById('naDevList');
    if (res.error) { if (box) { var m = doc.createElement('div'); m.className = 'cfg-business-note'; m.setAttribute('role', 'status'); m.textContent = R().message(res.error); box.prepend(m); } return; }
    toast('Aparato desconectado'); loadDevices();
  }

  function respaldoHtml() {
    var c = cloud();
    return head('💾', 'Copia de seguridad', c ? 'Tus ventas, abonos y cajas ya se guardan en la nube con respaldo automático. Aquí puedes descargar una copia para guardarla.' : 'Descarga una copia de todo el sistema o restaura una existente.')
      + '<div class="cfg-panel"><div class="cfg-panel-title">Descargar copia</div><div class="cfg-panel-sub">Archivo JSON con los datos que hay en este aparato.</div>'
      + '<div class="cfg-upload-box"><button class="cfg-save-btn" onclick="exportarRespaldo()">⬇️ Descargar copia de seguridad</button></div></div>'
      + (c ? '<div class="cfg-business-note">Restaurar una copia está desactivado con la nube activa: podría pisar datos ya sincronizados.</div>'
        : '<div class="cfg-panel"><div class="cfg-panel-title">Restaurar copia</div><div class="cfg-upload-box"><input type="file" id="backupFile" accept=".json"><button class="cfg-save-btn" onclick="importarRespaldo()" style="background:var(--blue)">⬆️ Restaurar respaldo</button></div></div>');
  }

  // Reseteo nunca borra ventas, abonos, créditos, cajas, stock, movimientos, compras, fotos
  // ni la Apariencia del aparato. Con la nube solo vuelve a descargar los datos del servidor.
  function reseteoHtml() {
    var keep = 'No se borran ventas, abonos, créditos, cajas, stock, movimientos de inventario, compras aplicadas, fotos de productos ni la Apariencia de este aparato.';
    if (!cloud()) return head('⚠️', 'Reseteo', keep) + '<div class="cfg-business-note">Sin la nube activa no hay nada que volver a descargar. Para empezar de cero, pide ayuda al soporte.</div>';
    return head('⚠️', 'Reseteo', keep)
      + '<div class="cfg-action-card danger"><div class="cfg-action-title">☁️ Volver a descargar de la nube</div>'
      + '<div class="cfg-action-desc">Vuelve a traer los datos del servidor a este aparato. Pide el PIN del dueño (lo valida el servidor), necesita internet y no funciona si hay ventas, abonos o compras sin confirmar.</div>'
      + '<button class="cfg-save-btn" id="naResync" onclick="resetModule(\'nube\')" style="background:var(--red);padding:11px">Volver a descargar</button></div>';
  }
  function online() { try { return root.navigator.onLine !== false; } catch (_) { return true; } }

  function render(cat) {
    var cont = doc.getElementById('cfgContent'); if (!cont) return false;
    if (cat === 'usuarios') { cont.innerHTML = usuariosHtml(); try { if (root.NA_EMPLOYEE_PERMS_UI) root.NA_EMPLOYEE_PERMS_UI.mount(cont); } catch (_) {} }
    else if (cat === 'aparatos') { cont.innerHTML = aparatosHtml(); loadDevices(); }
    else if (cat === 'respaldo') cont.innerHTML = respaldoHtml();
    else if (cat === 'reseteo') cont.innerHTML = reseteoHtml();
    else return false;
    return true;
  }
  function afterBase(cat) {
    var cont = doc.getElementById('cfgContent'); if (!cont) return;
    if (cat === 'importar') { // la copia de seguridad ahora tiene su propia sección
      var f = cont.querySelector('#backupFile'); var panel = f && f.closest('.cfg-panel'); if (panel) panel.remove();
    }
    if (cat === 'reseteo') {
      var h = cont.querySelector('.cfg-screen-head-sub');
      if (h && cloud()) h.textContent = 'Borra datos solo de este aparato. En la nube no se borra nada: las ventas, abonos y cajas sincronizadas vuelven a descargarse. Pide el PIN del dueño y no funciona si hay ventas sin confirmar.';
    }
  }

  // Reseteo con reglas: PIN validado en el servidor y bloqueo si hay ventas sin confirmar.
  function unconfirmedSales() {
    try { if (root.NuevoAmanecerCanonical && root.NuevoAmanecerCanonical.pendingSnapshot()) return true; } catch (_) {}
    try { var rej = JSON.parse(root.localStorage.getItem('na_canonical_rejected_operations') || '[]'); if (rej && (Array.isArray(rej) ? rej.length : Object.keys(rej).length)) return true; } catch (_) {}
    try { return (root.ventas || []).some(function (v) { return v && (v.source === 'CANONICAL_OUTBOX' || v.status === 'PENDING_SYNC' || v.naReview || v.canonicalReview); }); } catch (_) { return false; }
  }
  function wrapReset() {
    if (typeof root.resetModule !== 'function' || root.resetModule.__naG) return;
    var base = root.resetModule;
    root.resetModule = async function (modulo) {
      if (!R() || !R().isOwner()) { toast('Solo el dueño puede usar Reseteo, con el aparato conectado a internet.', 'error'); return; }
      if (!cloud() || modulo !== 'nube') { toast('Reseteo ya no borra datos. Con la nube activa usa «Volver a descargar».', 'error'); return; }
      if (!online()) { toast('Sin internet: Reseteo necesita conexión para validar el PIN.', 'error'); return; }
      if (unconfirmedSales()) { toast('Hay ventas, abonos o compras sin confirmar. Espera a que se sincronicen.', 'error'); return; }
      if (!R().pinSet) { toast('Primero crea el PIN del dueño en Usuarios y PIN.', 'error'); return; }
      // El servidor valida el PIN antes de que el aparato cambie nada.
      var id = await R().approve('reset', null, 'Reseteo', 'Escribe el PIN del dueño para volver a descargar los datos de la nube.');
      if (!id) return;
      try { await R().refresh(); } catch (_) {}
      if (!R().isOwner() || !online() || unconfirmedSales()) { toast('No se hizo: cambió la conexión o hay operaciones pendientes.', 'error'); return; }
      try { await root.NuevoAmanecerCanonical.refresh(); toast('Datos descargados de nuevo desde la nube.'); }
      catch (_) { toast('No se pudo descargar desde la nube. Inténtalo de nuevo.', 'error'); }
    };
    root.resetModule.__naG = true;
  }


  // Negocio, POS y Ticket: el servidor (/settings) es la fuente. Solo el dueño confirmado guarda;
  // los demás aparatos usan una copia local de solo lectura que se vuelve a tomar del servidor.
  // pos.credit y pos.ticket se REEMPLAZAN con el valor del servidor (no se fusionan): un campo viejo que solo tiene
  // este aparato no debe sobrevivir al GET y subir en el próximo guardado real. Ninguno de sus campos es de este
  // aparato: el ticket completo (ancho, letra, pie, formatos, compartir) y la política de crédito ya se guardan como
  // ajuste del negocio. Lo de «este aparato» (apariencia, lector, venta libre, cajeros, impresora) está fuera de SHARED.
  // La base es la de la app (_naDefaults, inline-02.js), nunca el objeto local viejo: si al valor del servidor le falta
  // una clave, queda la de fábrica en vez de perderse.
  /* global _naDefaults */
  function appDefaults(name) { try { return typeof _naDefaults !== 'undefined' && _naDefaults && _naDefaults[name] ? JSON.parse(JSON.stringify(_naDefaults[name])) : {}; } catch (_) { return {}; } }
  var SHARED = {
    'pos.business': { get: function (c) { var b = c.business || {}; return { nombre: b.nombre || '', ruc: b.ruc || '', direccion: b.direccion || '', telefono: b.telefono || '' }; },
      set: function (c, v) { c.business = Object.assign(c.business || {}, v); } },
    'pos.flags': { get: function (c) { return { igvActive: !!c.igvActive, margenActive: !!c.margenActive, stockAlertActive: !!c.stockAlertActive, printAuto: !!c.printAuto, mayoristaActive: !!c.mayoristaActive, alertsEnabled: c.alertsEnabled !== false, stockMin: c.stockMin }; },
      set: function (c, v) { Object.keys(v || {}).forEach(function (k) { c[k] = v[k]; }); } },
    // Línea de crédito inicial, reglas y días para pagar (30 por defecto): una sola política para todos los aparatos.
    'pos.credit': { get: function (c) { return Object.assign({}, c.creditPolicy || {}); }, set: function (c, v) { c.creditPolicy = Object.assign(appDefaults('creditPolicy'), v); } },
    // Interruptor «Permitir vender lotes vencidos»: el servidor lo exige en ventas en línea.
    'pos.lots': { get: function () { try { return { allowExpiredLots: root._naGetSecurityPath('rules.allowExpiredLots') === true }; } catch (_) { return { allowExpiredLots: false }; } },
      set: function (c, v) { try { root._naSetSecurityPath('rules.allowExpiredLots', !!(v && v.allowExpiredLots)); root._naSaveSecurity(); } catch (_) {} } },
    'pos.ticket': { get: function (c) { return Object.assign({}, c.ticket || {}); }, set: function (c, v) { c.ticket = Object.assign(appDefaults('ticket'), v); } }
  };
  var CACHE_KEY = 'na_pos_settings_cache_v1';
  var server = {}; // key -> { value, revision }: copia local (puede venir de la caché) para aplicar en solo lectura.
  try { server = JSON.parse(root.localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (_) { server = {}; }
  // Último valor que el servidor confirmó en esta sesión (GET o POST con éxito). Nunca sale solo de la caché:
  // así un push no puede tomar una revisión vieja de la caché y pisar la configuración buena del servidor.
  var confirmed = {}, pulled = false;
  // Guardado que no llegó al servidor (GET fallido): base con la que se compara cuando vuelva la conexión.
  // Se guarda en el aparato para que recargar o cerrar la app no pierda el cambio pendiente del dueño.
  // Formato: { user, base, values }. user = sesión del dueño que hizo el cambio (NA_ROLES.deviceId, el device_id
  // que devuelve /auth/me); values = sus valores sin subir. Solo esa sesión lo envía: si en este aparato entra otro
  // usuario (p. ej. el cajero), no se envía ni se borra. Una entrada antigua sin usuario se descarta sin enviar.
  var PENDING_KEY = 'na_pos_settings_pending_v1';
  var pendingBase = null, pendingUser = null, pendingValues = null;
  try {
    var stored = JSON.parse(root.localStorage.getItem(PENDING_KEY) || 'null');
    if (stored && typeof stored === 'object' && typeof stored.user === 'string' && stored.user && stored.base && typeof stored.base === 'object') {
      pendingBase = stored.base; pendingUser = stored.user; pendingValues = stored.values && typeof stored.values === 'object' ? stored.values : null;
    } else if (stored) root.localStorage.removeItem(PENDING_KEY);
  } catch (_) { try { root.localStorage.removeItem(PENDING_KEY); } catch (__) {} }
  // appReady: la app ya cargó su configuración local (loadAppState corre después de loadAllData). Antes de eso
  // appConfig tiene los valores por defecto y no sirve para comparar un guardado pendiente.
  var appReady = false, waitingPending = false, deferredApply = false;
  // value = base; se guarda con la sesión actual y los valores locales de ese momento.
  function setPending(value) {
    var c = cfg(), user = String((R() && R().deviceId) || '');
    // Nunca se guarda un pendiente sin usuario (al recargar se descartaría como antiguo, en silencio). Solo llega aquí
    // un dueño confirmado, que siempre trae device_id de /auth/me; si faltara, no se escribe y el guardado queda como
    // «No se guardó en el servidor: revisa internet».
    if (value && !user) return false;
    pendingBase = value || null;
    pendingUser = value ? user : null;
    pendingValues = null;
    if (value && c) { pendingValues = {}; Object.keys(SHARED).forEach(function (k) { pendingValues[k] = copy(SHARED[k].get(c)); }); }
    try { if (value) root.localStorage.setItem(PENDING_KEY, JSON.stringify({ user: pendingUser, base: pendingBase, values: pendingValues })); else root.localStorage.removeItem(PENDING_KEY); } catch (_) {}
  }
  // El pendiente es de la sesión confirmada actual (mismo usuario que lo dejó). Solo identidad: el rol se revisa aparte.
  function pendingMine() { return !!(pendingBase && pendingUser && R() && R().confirmed && R().deviceId && String(R().deviceId) === pendingUser); }
  // Claves que el dueño cambió en el pendiente (frente a base).
  function pendingChanged(k) {
    if (!pendingBase) return false;
    if (!pendingBase[k]) return true;
    return pendingValues && pendingValues[k] !== undefined ? !sameKey(k, pendingValues[k], pendingBase[k].value) : false;
  }
  // El filtro del pendiente solo protege mientras el rol no está confirmado o la sesión es la del dueño que lo dejó.
  // Con otro usuario confirmado (cajero u otra sesión) gana el servidor en todas las claves.
  // El mismo usuario con rol empleado (el dueño le cambió el rol) cuenta como otro usuario: gana el servidor.
  function guardPending() { return !!pendingBase && (!R() || !R().confirmed || (pendingMine() && !!R().isOwner && R().isOwner())); }
  var baseSave = null;
  /* global appConfig */
  function cfg() { try { return typeof appConfig !== 'undefined' ? appConfig : null; } catch (_) { return null; } }
  // Igualdad profunda que no depende del orden de las claves (mismas reglas que JSON: sin undefined ni funciones).
  function stable(v) {
    if (v === null || typeof v !== 'object') return v === undefined ? 'undefined' : JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(function (x) { return x === undefined || typeof x === 'function' ? 'null' : stable(x); }).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined && typeof v[k] !== 'function'; }).map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
  }
  function same(a, b) { return stable(a) === stable(b); }
  // pos.ticket y pos.credit se comparan sobre los valores de fábrica, igual que los aplica set(): a un valor del
  // servidor que no trae una clave de _naDefaults no se le cuenta esa clave como cambio.
  var DEFAULTS_OF = { 'pos.ticket': 'ticket', 'pos.credit': 'creditPolicy' };
  function norm(k, v) { return DEFAULTS_OF[k] && v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(appDefaults(DEFAULTS_OF[k]), v) : v; }
  function sameKey(k, a, b) { return same(norm(k, a), norm(k, b)); }
  function copy(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  // keys: solo esas claves (por defecto, todas las que hay en la copia del servidor).
  function applyServer(keys) {
    var c = cfg(); if (!c) return false; var changed = false;
    // Antes de loadAppState, appConfig tiene los valores por defecto: aplicar y guardar aquí escribiría esos valores
    // en el aparato y la carga los tomaría en vez del cambio del dueño. Se aplica al terminar loadAppState.
    if (!appReady) { deferredApply = true; return false; }
    // Sin claves explícitas y con un guardado pendiente, no se tocan las claves que el dueño cambió: al arrancar,
    // antes de confirmar el rol, el aparato se trata como solo lectura y la copia del servidor pisaría ese cambio.
    var guard = !keys && guardPending();
    var list = keys || Object.keys(SHARED).filter(function (k) { return !guard || (!pendingChanged(k) && pendingBase[k] && sameKey(k, SHARED[k].get(c), pendingBase[k].value)); });
    list.forEach(function (k) { if (!SHARED[k] || !server[k]) return; var before = SHARED[k].get(c); SHARED[k].set(c, server[k].value); if (!sameKey(k, before, SHARED[k].get(c))) changed = true; });
    // baseSave es el saveAppState original (sin envolver): guarda en el aparato y no envía nada al servidor.
    if (changed) { try { root._naApplyConfigUI(); } catch (_) {} try { baseSave && baseSave(); } catch (_) {} }
    return changed;
  }
  // Lee /settings y actualiza lo confirmado. No aplica nada: devuelve true solo si el GET funcionó.
  async function fetchSettings() {
    if (!cloud() || !R()) return false;
    try {
      var out = await R().api('/settings', null, 'GET');
      var fresh = {};
      (out && out.settings || []).forEach(function (r) { if (SHARED[r.key]) fresh[r.key] = { value: r.value, revision: r.revision }; });
      confirmed = fresh; pulled = true;
      Object.keys(fresh).forEach(function (k) { server[k] = copy(fresh[k]); });
      try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(server)); } catch (_) {}
      return true;
    } catch (_) { return false; }
  }
  async function pullSettings() {
    if (!cloud() || !R()) return false;
    // Un cambio del dueño que no se pudo guardar nunca se descarta en silencio: se completa ese guardado
    // (se envía si el servidor no tocó la clave; si la tocó, gana el servidor y se avisa).
    if (pendingMine() && R().isOwner && R().isOwner()) {
      if (!appReady) { waitingPending = true; return false; } // se completa al terminar loadAppState
      await pushSettings(); return true;
    }
    await fetchSettings();
    var owner = R().isOwner && R().isOwner();
    // El dueño solo recibe del servidor lo que ya existe allí; nunca pierde lo que aún no subió.
    return owner ? applyServerIfMissingLocal() : applyServer();
  }
  function applyServerIfMissingLocal() { return Object.keys(server).length ? applyServer() : false; }
  var CONFLICT_MSG = 'Otro equipo cambió la configuración; se cargó la versión del servidor, revisa y guarda de nuevo';
  // Solo se llama al guardar de verdad (guardarConfig o Configuración v9). Envía únicamente las claves que
  // cambiaron frente a lo último confirmado por el servidor; sin un GET exitoso no envía nada.
  async function pushSettings() {
    var c = cfg(); if (!c || !cloud() || !R() || !R().isOwner()) return { ok: false, reason: 'owner_only' };
    // Si el GET del arranque falló, base = lo que tenía este aparato (su copia del servidor). Se envían solo
    // las claves que el dueño cambió frente a base; las demás nunca se envían.
    var base = null, mine = pendingMine();
    // El pendiente de esta sesión vuelve a los valores que el dueño dejó (otro usuario pudo cargar los del servidor).
    if (mine && pendingValues) {
      var restored = false;
      Object.keys(SHARED).forEach(function (k) { if (pendingChanged(k) && pendingValues[k] !== undefined && !sameKey(k, SHARED[k].get(c), pendingValues[k])) { SHARED[k].set(c, copy(pendingValues[k])); restored = true; } });
      if (restored) { try { root._naApplyConfigUI(); } catch (_) {} try { baseSave && baseSave(); } catch (_) {} }
    }
    if (!pulled || mine) { base = mine ? pendingBase : copy(server); if (!(await fetchSettings())) { setPending(base); return { ok: false, reason: 'not_synced', failed: [] }; } }
    var failed = [], conflicts = [], untouched = [];
    for (var k in SHARED) {
      var value = SHARED[k].get(c), now = confirmed[k];
      if (base) {
        var had = base[k];
        if (had && sameKey(k, had.value, value)) { if (now && !sameKey(k, now.value, had.value)) untouched.push(k); continue; } // el dueño no la tocó
        // El dueño la cambió. Si el servidor también cambió desde base (o tiene un valor que este aparato no vio), gana el servidor.
        if (now ? !(had && sameKey(k, now.value, had.value)) && !sameKey(k, now.value, value) : false) { conflicts.push(k); continue; }
      }
      if (now && sameKey(k, now.value, value)) continue;
      try {
        var res = await R().api('/settings', { key: k, value: value, expected_revision: now ? now.revision : 0 });
        confirmed[k] = { value: copy(value), revision: res.revision };
        server[k] = copy(confirmed[k]);
      } catch (e) {
        // Otro aparato guardó antes: gana el servidor y no se reintenta con los valores locales.
        if (e && e.message === 'revision_conflict') conflicts.push(k); else failed.push(k);
      }
    }
    // Terminado (enviado o en conflicto): se borra lo pendiente. Si un POST falló por red, queda pendiente con la
    // copia del servidor como base, para que un pull posterior no pise ese cambio en silencio.
    // El pendiente de otro usuario no se borra aquí: lo envía su propia sesión.
    if (failed.length) setPending(copy(server)); else if (!pendingBase || mine) setPending(null);
    if (conflicts.length) await fetchSettings();
    // Se aplica lo del servidor solo en claves en conflicto o que el dueño no tocó; nunca se pisa un cambio pendiente.
    if (conflicts.length || untouched.length) applyServer(conflicts.concat(untouched));
    try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(server)); } catch (_) {}
    if (conflicts.length) { toast(CONFLICT_MSG, 'error'); return { ok: false, reason: 'revision_conflict', failed: failed.concat(conflicts), conflicts: conflicts }; }
    return { ok: !failed.length, failed: failed };
  }
  function wrapSettings() {
    if (typeof root.saveAppState === 'function' && !root.saveAppState.__naG) {
      baseSave = root.saveAppState;
      root.saveAppState = function () {
        var out = baseSave.apply(this, arguments);
        // Guardar el estado (navegar, abrir reportes, etc.) ya no envía /settings: eso solo pasa al guardar Configuración.
        if (cloud() && R() && !R().isOwner() && Object.keys(server).length) setTimeout(applyServer, 0); // solo lectura: se vuelve a la copia del servidor
        return out;
      };
      root.saveAppState.__naG = true;
    }
    if (typeof root.guardarConfig === 'function' && !root.guardarConfig.__naG) {
      var baseGuardar = root.guardarConfig;
      root.guardarConfig = async function () {
        if (cloud()) {
          if (!R() || !R().isOwner()) { toast(root.navigator.onLine === false ? 'Sin conexión: Configuración necesita internet para confirmar que eres el dueño.' : 'Solo el dueño puede cambiar la configuración.', 'error'); applyServer(); return false; }
          if (root.navigator.onLine === false) { toast('Sin conexión: la configuración se guarda en el servidor. Conéctate e inténtalo de nuevo.', 'error'); return false; }
        }
        var ok = await baseGuardar.apply(this, arguments);
        if (!cloud() || !ok) return ok;
        var res = await pushSettings();
        // En conflicto pushSettings ya avisó con CONFLICT_MSG; «Revisa internet» queda solo para fallas de red.
        if (!res.ok) { if (res.reason !== 'revision_conflict') toast('No se pudo guardar en el servidor. Revisa internet e inténtalo de nuevo.', 'error'); return false; }
        toast('Configuración guardada en el servidor', 'success');
        return true;
      };
      root.guardarConfig.__naG = true;
    }
  }


  // Descuentos de empleado: con internet piden el PIN del dueño (lo valida el servidor).
  // Sin internet se aplican marcados «por autorizar» y, al cobrar, quedan en un registro
  // local de solo agregar: nunca se borran ni se cambian.
  var DISC_KEY = 'na_discounts_por_autorizar_v1';
  /* global cart */
  function cartRef() { try { return typeof cart !== 'undefined' ? cart : []; } catch (_) { return []; } }
  function isEmployee() { return cloud() && R() && R().role === 'empleado'; }
  function discountLog() { try { var v = JSON.parse(root.localStorage.getItem(DISC_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function appendDiscount(entry) {
    var list = discountLog(); if (list.some(function (e) { return e.id === entry.id; })) return false;
    list.push(entry); root.localStorage.setItem(DISC_KEY, JSON.stringify(list));
    return root.localStorage.getItem(DISC_KEY) === JSON.stringify(list);
  }
  function wrapDiscounts() {
    if (typeof root.aplicarDescuentoPorcentaje === 'function' && !root.aplicarDescuentoPorcentaje.__naG) {
      var baseApply = root.aplicarDescuentoPorcentaje;
      root.aplicarDescuentoPorcentaje = async function (value) {
        if (!isEmployee()) return baseApply.apply(this, arguments);
        if (root.navigator.onLine !== false) {
          var id = await R().approve('discount', null, 'Autorización del dueño', 'Descuento de ' + (Number(value) || 0) + '%: pide al dueño que escriba su PIN.');
          if (!id) { toast('Descuento cancelado.', 'error'); return; }
          var r = baseApply.apply(this, arguments);
          cartRef().forEach(function (it) { if (it._descuento != null) { it._descuentoAprobado = id; delete it._descuentoPorAutorizar; } });
          return r;
        }
        var out = baseApply.apply(this, arguments);
        cartRef().forEach(function (it) { if (it._descuento != null && !it._descuentoAprobado) it._descuentoPorAutorizar = true; });
        toast('Sin conexión: el descuento queda «por autorizar» y el dueño lo revisará.', 'error');
        return out;
      };
      root.aplicarDescuentoPorcentaje.__naG = true;
    }
    if (typeof root.confirmarVenta === 'function' && !root.confirmarVenta.__naGDisc) {
      var baseConfirm = root.confirmarVenta;
      root.confirmarVenta = async function () {
        var flagged = cartRef().filter(function (it) { return it._descuentoPorAutorizar; }).map(function (it) {
          return { nombre: String(it.name || it.nombre || ''), cantidad: Number(it.qty) || 0, precio_original: Number(it._precioOriginal) || 0, precio: Number(it.precio) || 0, descuento_pct: Number(it._descuento) || 0 };
        });
        var out = await baseConfirm.apply(this, arguments);
        if (flagged.length && !cartRef().length) {
          var total = flagged.reduce(function (a, i) { return a + (i.precio_original - i.precio) * i.cantidad; }, 0);
          appendDiscount(Object.freeze({ id: 'D-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), registrado: new Date().toISOString(), aparato: (R() && R().label) || '', estado: 'por autorizar', descuento_total: Math.round(total * 100) / 100, items: flagged }));
        }
        return out;
      };
      root.confirmarVenta.__naGDisc = true;
    }
  }

  function markReady() {
    if (appReady) return; appReady = true;
    if (deferredApply) { deferredApply = false; setTimeout(function () { try { applyServer(); } catch (_) {} }, 0); }
    if (waitingPending) { waitingPending = false; setTimeout(function () { pullSettings(); }, 0); }
  }
  // Si loadAllData falla, loadAppState nunca corre: sin esto la sincronización quedaría esperando para siempre.
  var loadSettled = false;
  function wrapLoadAllData() {
    if (typeof root.loadAllData !== 'function' || root.loadAllData.__naG) return;
    var baseLoadAll = root.loadAllData;
    root.loadAllData = function () {
      var p; try { p = Promise.resolve(baseLoadAll.apply(this, arguments)); } catch (e) { p = Promise.reject(e); }
      p.then(function () { loadSettled = true; }, function () { loadSettled = true; setTimeout(function () { if (cfg()) markReady(); }, 0); });
      return p;
    };
    root.loadAllData.__naG = true;
  }
  wrapLoadAllData();
  function wrapLoadAppState() {
    if (typeof root.loadAppState !== 'function' || root.loadAppState.__naG) return;
    var baseLoad = root.loadAppState;
    root.loadAppState = function () {
      var out = baseLoad.apply(this, arguments);
      markReady();
      return out;
    };
    root.loadAppState.__naG = true;
  }
  function install() {
    sidebar(); wrapReset(); wrapSettings(); wrapDiscounts(); wrapLoadAppState();
    if (typeof root.renderCfgContent === 'function' && !root.renderCfgContent.__naG) {
      var base = root.renderCfgContent;
      root.renderCfgContent = function (cat) { if (render(cat)) return; var r = base.apply(this, arguments); try { afterBase(cat); } catch (_) {} return r; };
      root.renderCfgContent.__naG = true;
    }
  }
  doc.addEventListener('click', function (e) {
    var t = e.target; if (!t || !t.closest) return;
    if (t.closest('#naPinSave')) savePin();
    else if (t.closest('#naPairCreate')) createPair();
    else { var rv = t.closest('.na-g-revoke'); if (rv) revoke(rv.dataset.dev); }
  });
  root.addEventListener('na:role', function () { sidebar(); if (R() && (R().confirmed || R().role === 'empleado')) pullSettings(); });
  if (cloud()) setTimeout(function () { try { if (!R() || !R().isOwner()) applyServer(); } catch (_) {} }, 0);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', install); else install();
  root.addEventListener('load', install);
  // Respaldo: en 'load', si appConfig existe y la carga ya terminó (o no se pudo envolver), se marca lista.
  // Mientras loadAllData sigue leyendo IndexedDB no se marca: appConfig todavía tendría los valores por defecto.
  root.addEventListener('load', function () { if (!appReady && cfg() && (loadSettled || !(root.loadAllData && root.loadAllData.__naG))) setTimeout(function () { if (!appReady && cfg()) markReady(); }, 0); });
  // Configuración v9 (PC/tablet): guardar ya y esperar al servidor para mostrar «Guardado ✓».
  async function flush() {
    try { if (baseSave) await baseSave(); else if (typeof root.saveAppState === 'function') await root.saveAppState(); } catch (_) {}
    if (!cloud() || !R()) return { ok: true, local: true };
    return pushSettings();
  }
  // Un ajuste cotidiano pedido en el chat. Se cambia SOLO una bandera del grupo,
  // contra la revisión recién leída, sin enviar otros grupos ni cambios pendientes.
  async function setAssistantFlag(field,value,expected) {
    var allowed=['stockMin','stockAlertActive','printAuto'];
    if(allowed.indexOf(field)<0||(field==='stockMin'?!(Number.isInteger(value)&&value>=0&&value<=100000):typeof value!=='boolean')) return {ok:false,msg:'Ese ajuste no está disponible desde el chat.'};
    if(!R()||!R().isOwner()||!R().confirmed||!cloud()||!appReady) return {ok:false,msg:'Revisa la conexión y entra como Admin.'};
    if(pendingBase) return {ok:false,msg:'Hay cambios de configuración pendientes. Guárdalos antes de aplicar esta tarjeta.'};
    var c=cfg(); if(!c) return {ok:false,msg:'No se pudo leer la configuración.'};
    var local=SHARED['pos.flags'].get(c),known=confirmed['pos.flags'];
    if(known&&!sameKey('pos.flags',local,known.value)) return {ok:false,msg:'Hay cambios de configuración pendientes. Guárdalos primero.'};
    try {
      var out=await R().api('/settings',null,'GET');
      var row=(out&&out.settings||[]).filter(function(r){return r.key==='pos.flags';})[0];
      if(!row||!row.value||typeof row.value!=='object'||Array.isArray(row.value)||!Number.isInteger(row.revision)) return {ok:false,msg:'Primero sincroniza Configuración con el servidor.'};
      if(!R().isOwner()||!R().confirmed) return {ok:false,msg:'Solo el Admin puede cambiar la configuración.'};
      if(pendingBase||!sameKey('pos.flags',SHARED['pos.flags'].get(c),local)) return {ok:false,msg:'La configuración cambió mientras revisabas. Pide la tarjeta de nuevo.'};
      var actual=row.value[field];
      if(actual!==expected&&actual!==value) return {ok:false,msg:'Otro aparato cambió este ajuste. Pide la tarjeta de nuevo.'};
      var next=Object.assign({},row.value);next[field]=value;
      var revision=row.revision;
      if(actual!==value) {
        var saved=await R().api('/settings',{key:'pos.flags',value:next,expected_revision:row.revision});
        if(!saved||!Number.isInteger(saved.revision)) return {ok:false,msg:'No pude comprobar el guardado. Reintenta para verificarlo.'};
        revision=saved.revision;
      }
      confirmed['pos.flags']={value:copy(next),revision:revision};server['pos.flags']=copy(confirmed['pos.flags']);
      // No pisa una edición local que empezó durante el POST.
      Object.keys(next).forEach(function(k){if(c[k]===local[k]) c[k]=next[k];});
      try {root.localStorage.setItem(CACHE_KEY,JSON.stringify(server));}catch(_){}
      try {root._naApplyConfigUI();}catch(_){}
      try {if(baseSave) await baseSave();}catch(_){}
      return {ok:true,msg:'Guardado en todos los aparatos.'};
    } catch(e) {return {ok:false,msg:e&&e.message==='revision_conflict'?'Otro aparato guardó antes. Pide la tarjeta de nuevo.':'No pude comprobar el guardado. Reintenta para verificarlo.'};}
  }
  root.NA_CONFIG_G = { setAssistantFlag:setAssistantFlag, flush: flush, savePin: savePin, loadDevices: loadDevices, render: render, unconfirmedSales: unconfirmedSales, pullSettings: pullSettings, pushSettings: pushSettings, sharedKeys: function () { return Object.keys(SHARED); }, conflictMessage: CONFLICT_MSG, discountLog: function () { return JSON.parse(JSON.stringify(discountLog())); } };
})(window);
