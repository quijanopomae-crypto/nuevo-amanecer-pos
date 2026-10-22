/* Nuevo Amanecer — #45 «Importar clientes» desde un archivo CSV (también el CSV que guarda Excel).
 * Solo en el navegador. Cada fila válida se guarda por el MISMO camino que «+ Cliente»
 * (guardarCli → permisos F10 → puente CANON o guardado local), una por una, así que la
 * sincronización y las validaciones son las de un alta manual. Nunca sobrescribe ni edita
 * clientes existentes: los duplicados por DNI/RUC o teléfono se omiten. No muestra costos
 * ni datos de proveedores. No cambia permisos, migraciones ni rutas del Worker. */
(function (root) {
  'use strict';

  var doc = root.document;
  var PANEL_ID = 'naImportarClientes';
  var BUTTON_ID = 'naImportarClientesBtn';
  var MAX_ROWS = 500;
  var MAX_BYTES = 1024 * 1024;
  // Solo campos que ya existen en el formulario de cliente (cNombre, cDni, cTel, cDir, cLinea).
  var COLUMNS = ['nombre', 'documento', 'telefono', 'direccion', 'linea_credito'];
  var ALIASES = {
    nombre: ['nombre', 'nombres', 'cliente', 'razon social', 'razon_social', 'name'],
    documento: ['documento', 'dni', 'ruc', 'dni/ruc', 'dni_ruc', 'nro documento', 'numero documento', 'doc'],
    telefono: ['telefono', 'celular', 'tel', 'movil', 'whatsapp', 'phone'],
    direccion: ['direccion', 'domicilio', 'address'],
    linea_credito: ['linea_credito', 'linea credito', 'linea de credito', 'limite credito', 'limite_credito', 'limite de credito', 'credito']
  };
  var STATUS_LABEL = { valido: 'Lista para importar', duplicado: 'Duplicado (se omite)', error: 'Con error (se omite)' };
  var preview = null;
  var busy = false;
  var initialized = false;
  var timer = null;

  function clean(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' '); }
  function fold(v) { return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function docDigits(v) { var d = String(v || '').replace(/[\s.\-]/g, ''); return /^(\d{8}|\d{11})$/.test(d) ? d : clean(v); }
  // Misma regla que el puente CANON (celular peruano de 9 dígitos o +código de país).
  function normalizePhone(raw) {
    raw = String(raw || '').trim(); if (!raw || !/^[+\d\s().-]+$/.test(raw)) return '';
    var n = raw.replace(/\D/g, ''); if (n.indexOf('00') === 0) n = n.slice(2);
    if (/^9\d{8}$/.test(n)) n = '51' + n;
    if (n.indexOf('51') === 0) return /^519\d{8}$/.test(n) ? '+' + n : '';
    return (raw.charAt(0) === '+' || raw.indexOf('00') === 0) && /^[1-9]\d{8,14}$/.test(n) ? '+' + n : '';
  }
  function phoneKey(raw) { var e = normalizePhone(raw); if (e) return e; var d = String(raw || '').replace(/\D/g, ''); return d.length >= 6 ? d : ''; }

  // CSV con comillas, separador «;» o «,» (Excel en español guarda con «;»), BOM y saltos CRLF.
  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length && first.indexOf(';') !== -1 ? ';' : (first.indexOf('\t') !== -1 && first.indexOf(',') === -1 ? '\t' : ',');
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (q) {
        if (ch === '"') { if (text.charAt(i + 1) === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"' && field === '') q = true;
      else if (ch === sep) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(field); field = ''; rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return clean(c) !== ''; }); });
  }

  function mapHeader(header) {
    var map = {};
    header.forEach(function (h, i) {
      var key = fold(h).replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
      COLUMNS.forEach(function (col) {
        if (map[col] !== undefined) return;
        if (ALIASES[col].some(function (a) { return a.replace(/_/g, ' ') === key; })) map[col] = i;
      });
    });
    return map;
  }

  function parseLine(raw) {
    var s = clean(raw).replace(/^s\/\s*/i, '').replace(/\s/g, '');
    if (!s) return { cents: null };
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return { error: 'Línea de crédito inválida (usa un monto como 150 o 150.50)' };
    var cents = Math.round(Number(s) * 100);
    if (!Number.isSafeInteger(cents) || cents > 100000000) return { error: 'La línea de crédito máxima es S/ 1,000,000' };
    return { cents: cents, text: (cents / 100).toFixed(2) };
  }

  // Clientes que ya existen: vista local (clientes) y, si está activo, la foto CANON.
  function existingKeys() {
    var docs = {}, phones = {};
    var add = function (d, p, name) {
      var dd = docDigits(d); if (dd) docs[dd.toLowerCase()] = clean(name) || 'otro cliente';
      var pk = phoneKey(p); if (pk) phones[pk] = clean(name) || 'otro cliente';
    };
    try { (typeof clientes !== 'undefined' && Array.isArray(clientes) ? clientes : []).forEach(function (c) { if (c) add(c.dni || c.document, c.tel || c.telefono || c.phone, c.nombre || c.name); }); } catch (_) {}
    try {
      var canon = root.NuevoAmanecerCanonical;
      var snap = canon && typeof canon.snapshot === 'function' ? canon.snapshot() : null;
      (Array.isArray(snap && snap.customers) ? snap.customers : []).forEach(function (c) { if (c) add(c.document, c.phone, c.name); });
    } catch (_) {}
    return { docs: docs, phones: phones };
  }

  function buildPreview(text, existing) {
    var table = parseCsv(text);
    if (!table.length) return { error: 'El archivo está vacío.' };
    var map = mapHeader(table[0]);
    if (map.nombre === undefined) return { error: 'No se encontró la columna «nombre». Usa la plantilla.' };
    var body = table.slice(1);
    if (!body.length) return { error: 'El archivo no tiene filas de clientes.' };
    if (body.length > MAX_ROWS) return { error: 'El archivo tiene ' + body.length + ' filas. El máximo por importación es ' + MAX_ROWS + '.' };
    existing = existing || existingKeys();
    var ownerLine = isOwner();
    var seenDocs = {}, seenPhones = {};
    var rows = body.map(function (cells, idx) {
      var get = function (col) { return map[col] === undefined ? '' : clean(cells[map[col]]); };
      var r = { line: idx + 2, nombre: get('nombre'), documento: docDigits(get('documento')), telefono: get('telefono'),
        direccion: get('direccion'), lineaTexto: '', lineaCents: null, status: 'valido', reason: '' };
      var line = ownerLine ? parseLine(get('linea_credito')) : { cents: null };
      var fail = function (msg) { r.status = 'error'; r.reason = msg; };
      var dup = function (msg) { r.status = 'duplicado'; r.reason = msg; };
      if (!r.nombre) fail('Falta el nombre');
      else if (r.nombre.length > 240 || r.documento.length > 32 || r.telefono.length > 64 || r.direccion.length > 500) fail('Un dato es demasiado largo');
      else if (r.documento && !/^(\d{8}|\d{11})$/.test(r.documento)) fail('El DNI debe tener 8 dígitos y el RUC 11');
      else if (r.telefono && !normalizePhone(r.telefono)) fail('Teléfono inválido (celular de 9 dígitos o +código de país)');
      else if (line.error) fail(line.error);
      else {
        r.lineaCents = line.cents; r.lineaTexto = line.text || '';
        var dk = r.documento.toLowerCase(), pk = phoneKey(r.telefono);
        if (dk && existing.docs[dk]) dup('Ya existe «' + existing.docs[dk] + '» con ese DNI / RUC');
        else if (pk && existing.phones[pk]) dup('Ya existe «' + existing.phones[pk] + '» con ese teléfono');
        else if (dk && seenDocs[dk]) dup('DNI / RUC repetido en la fila ' + seenDocs[dk]);
        else if (pk && seenPhones[pk]) dup('Teléfono repetido en la fila ' + seenPhones[pk]);
        if (dk && !seenDocs[dk]) seenDocs[dk] = r.line;
        if (pk && !seenPhones[pk]) seenPhones[pk] = r.line;
      }
      return r;
    });
    var count = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
    return { lineIgnored: !ownerLine && map.linea_credito !== undefined, rows: rows, valid: count('valido'), duplicates: count('duplicado'), errors: count('error') };
  }

  function templateCsv() {
    return '\uFEFF' + 'nombre;documento;telefono;direccion;linea_credito\r\n' +
      'Juana Pérez Ramos;12345678;987654321;Jr. Los Olivos 123;150.00\r\n' +
      'Bodega El Sol SAC;20123456789;;Av. Grau 456;\r\n';
  }

  function el(tag, className, text) {
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = String(text);
    return n;
  }

  // Candado propio (#904). Falla cerrado: sin NA_PERMISSIONS, sin el id o con error, queda cerrado.
  var LOCK_ID = 'importar-clientes';
  function importarClientesUnlocked() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(LOCK_ID) === false); }
    catch (_) { return false; }
  }
  function canImport() {
    try { if (typeof isModuleLocked === 'function' && isModuleLocked('clientes', { canonicalCustomerUi: true })) return false; } catch (_) {}
    try { var b = root.NuevoAmanecerCanonicalCustomerBridge; if (b && typeof b.userLocked === 'function' && b.userLocked()) return false; } catch (_) {}
    try { if (typeof _naF10HasPermission === 'function') return !!_naF10HasPermission('clients'); } catch (_) { return false; }
    return typeof root.guardarCli === 'function';
  }

  function status(msg) { var s = doc.querySelector('#' + PANEL_ID + ' [data-ic-status]'); if (s) s.textContent = msg || ''; }

  function renderPreview() {
    var panel = doc.getElementById(PANEL_ID); if (!panel) return;
    var box = panel.querySelector('[data-ic-preview]');
    var confirm = panel.querySelector('[data-ic-confirm]');
    box.replaceChildren();
    confirm.hidden = !(preview && preview.valid > 0);
    confirm.disabled = busy;
    if (!preview) return;
    var sum = el('p', 'ic-summary');
    sum.dataset.icSummary = '';
    sum.textContent = preview.valid + ' para importar · ' + preview.duplicates + ' duplicados · ' + preview.errors + ' con error';
    var list = el('ul', 'ic-list');
    list.setAttribute('aria-label', 'Vista previa de la importación');
    preview.rows.forEach(function (r) {
      var li = el('li', 'ic-row ic-' + r.status);
      li.dataset.icRow = r.status;
      li.dataset.icLine = String(r.line);
      var head = el('div', 'ic-head');
      head.append(el('strong', 'ic-name', r.nombre || '(sin nombre)'), el('span', 'ic-badge', r.result || STATUS_LABEL[r.status]));
      var meta = el('p', 'ic-meta', 'Fila ' + r.line +
        (r.documento ? ' · DNI/RUC ' + r.documento : '') + (r.telefono ? ' · Tel. ' + r.telefono : '') +
        (r.direccion ? ' · ' + r.direccion : '') + (r.lineaTexto ? ' · Línea S/ ' + r.lineaTexto : ''));
      li.append(head, meta);
      if (r.reason) li.append(el('p', 'ic-reason', r.reason));
      list.append(li);
    });
    box.append(sum, list);
  }

  function readFile(file) {
    if (!file || !importarClientesUnlocked()) return;
    if (file.size > MAX_BYTES) { preview = null; renderPreview(); status('El archivo pesa más de 1 MB.'); return; }
    var name = String(file.name || '').toLowerCase();
    if (/\.(xlsx|xls|ods)$/.test(name)) { preview = null; renderPreview(); status('Guarda tu hoja de Excel como «CSV (delimitado por comas)» y súbela de nuevo.'); return; }
    var reader = new root.FileReader();
    reader.onload = function () { loadText(String(reader.result || '')); };
    reader.onerror = function () { status('No se pudo leer el archivo.'); };
    reader.readAsText(file, 'utf-8');
  }

  function loadText(text) {
    if (!importarClientesUnlocked()) { preview = null; return { error: 'Disponible pronto.' }; }
    var res = buildPreview(text);
    if (res.error) { preview = null; renderPreview(); status(res.error); return res; }
    preview = res; status((res.lineIgnored ? 'La columna «Línea» se ignora: solo el dueño puede fijar línea de crédito. ' : '') + (res.valid ? 'Revisa la lista y pulsa «Importar ' + res.valid + (res.valid === 1 ? ' cliente»' : ' clientes»') + '.' : 'No hay filas nuevas para importar.'));
    var c = doc.querySelector('#' + PANEL_ID + ' [data-ic-confirm]');
    if (c) c.textContent = 'Importar ' + res.valid + (res.valid === 1 ? ' cliente' : ' clientes');
    renderPreview();
    return res;
  }

  var FORM_IDS = ['cNombre', 'cDni', 'cTel', 'cDir', 'cLinea'];
  // Solo el dueño puede fijar línea de crédito al importar. Falla cerrado: sin NA_ROLES no es dueño
  // (el modo local ya fija el rol de dueño en pos-roles-client.js).
  function isOwner() {
    try { var r = root.NA_ROLES; if (!r || typeof r.isOwner !== 'function') return false; return r.isOwner() === true; } catch (_) { return false; }
  }
  function formHasText() {
    return FORM_IDS.some(function (id) { var n = doc.getElementById(id); return !!(n && String(n.value || '').trim()); });
  }
  var FORM_BUSY_MSG = 'Tienes datos sin guardar en «+ Cliente». Guárdalos o bórralos antes de importar.';
  function setField(id, v) { var n = doc.getElementById(id); if (n) n.value = v; }
  function countClients() { try { return Array.isArray(clientes) ? clientes.length : 0; } catch (_) { return 0; } }

  // Una fila = un alta manual por guardarCli (mismo camino, mismas validaciones y la misma sincronización).
  async function saveRow(r) {
    setField('cNombre', r.nombre); setField('cDni', r.documento); setField('cTel', r.telefono);
    setField('cDir', r.direccion); setField('cLinea', r.lineaTexto);
    var before = countClients(), result;
    try { result = await root.guardarCli(); } catch (_) { result = false; }
    FORM_IDS.forEach(function (id) { setField(id, ''); });
    return result === true || countClients() > before;
  }

  async function confirmImport() {
    if (busy || !preview || !preview.valid) return;
    if (!importarClientesUnlocked()) { preview = null; status('Disponible pronto.'); return; }
    if (!canImport()) { status('No tienes permiso para registrar clientes o el módulo está bloqueado.'); return; }
    if (typeof root.guardarCli !== 'function') { status('El registro de clientes no está disponible.'); return; }
    if (formHasText()) { status(FORM_BUSY_MSG); return; }
    var fresh = existingKeys();
    busy = true; renderPreview();
    var ok = 0, fail = 0, skipped = 0;
    try {
      for (var i = 0; i < preview.rows.length; i++) {
        var r = preview.rows[i];
        if (r.status !== 'valido') continue;
        var dk = r.documento.toLowerCase(), pk = phoneKey(r.telefono);
        if ((dk && fresh.docs[dk]) || (pk && fresh.phones[pk])) { r.status = 'duplicado'; r.reason = 'Se registró otro cliente con ese dato mientras importabas'; skipped++; continue; }
        status('Guardando ' + (ok + fail + 1) + ' de ' + preview.valid + '…');
        if (await saveRow(r)) { ok++; r.status = 'importado'; r.result = 'Importado'; r.reason = '';
          if (dk) fresh.docs[dk] = r.nombre; if (pk) fresh.phones[pk] = r.nombre; }
        else { fail++; r.status = 'error'; r.reason = 'No se guardó; revisa el aviso y vuelve a intentarlo'; }
      }
    } finally {
      busy = false;
      preview.valid = 0;
      renderPreview();
      var summary = ok + (ok === 1 ? ' cliente importado' : ' clientes importados') + (fail ? ' · ' + fail + ' no se guardaron' : '') +
        (skipped ? ' · ' + skipped + ' omitidos por duplicado' : '') + '. Los clientes existentes no se modificaron.';
      status(summary);
      // Un solo aviso final: reemplaza los «Cliente registrado» de cada fila (el aviso es un único elemento).
      try { if (typeof root.toast === 'function') root.toast(summary, fail ? 'warning' : 'success'); } catch (_) {}
      try { if (typeof root.cliRender === 'function') root.cliRender(); } catch (_) {}
    }
    return { ok: ok, fail: fail, skipped: skipped };
  }

  function downloadTemplate() {
    var blob = new root.Blob([templateCsv()], { type: 'text/csv;charset=utf-8' });
    var url = root.URL.createObjectURL(blob);
    var a = el('a'); a.href = url; a.download = 'plantilla-clientes.csv';
    doc.body.append(a); a.click(); a.remove();
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000);
  }

  function ensureUi() {
    var bar = doc.querySelector('#pageClientes .filter-bar');
    if (!bar) return;
    var btn = doc.getElementById(BUTTON_ID);
    if (!importarClientesUnlocked()) { // candado cerrado: no se crea ni se muestra nada
      if (btn) { btn.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
      var lp = doc.getElementById(PANEL_ID); if (lp) lp.hidden = true;
      preview = null; return;
    }
    if (!btn) {
      btn = el('button', 'f-select ic-entry', 'Importar clientes');
      btn.id = BUTTON_ID; btn.type = 'button';
      btn.setAttribute('aria-controls', PANEL_ID); btn.setAttribute('aria-expanded', 'false');
      var panel = el('section', 'ic-panel'); panel.id = PANEL_ID; panel.hidden = true;
      panel.setAttribute('aria-label', 'Importar clientes');
      btn.addEventListener('click', function () {
        if (panel.hidden && formHasText()) { var t = FORM_BUSY_MSG; try { if (typeof root.toast === 'function') root.toast(t, 'warning'); } catch (_) {} return; }
        panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden));
      });
      var help = el('p', 'ic-help', 'Sube un archivo CSV con las columnas nombre, documento, telefono, direccion y linea_credito. Desde Excel: Archivo → Guardar como → CSV. Solo se agregan clientes nuevos; los que ya existen no se tocan.');
      var actions = el('div', 'ic-actions');
      var tpl = el('button', 'ic-btn', 'Descargar plantilla');
      tpl.type = 'button'; tpl.dataset.icTemplate = '';
      tpl.addEventListener('click', downloadTemplate);
      var label = el('label', 'ic-btn ic-file');
      label.append(el('span', '', 'Elegir archivo CSV'));
      var input = el('input'); input.type = 'file'; input.accept = '.csv,text/csv,.txt'; input.dataset.icFile = '';
      input.setAttribute('aria-label', 'Archivo CSV de clientes');
      input.addEventListener('change', function () { readFile(input.files && input.files[0]); input.value = ''; });
      label.append(input);
      var confirm = el('button', 'ic-btn ic-primary', 'Importar');
      confirm.type = 'button'; confirm.hidden = true; confirm.dataset.icConfirm = '';
      confirm.addEventListener('click', confirmImport);
      actions.append(tpl, label, confirm);
      var st = el('p', 'ic-status-msg'); st.dataset.icStatus = ''; st.setAttribute('aria-live', 'polite');
      var box = el('div', 'ic-preview'); box.dataset.icPreview = '';
      panel.append(help, actions, st, box);
      bar.parentNode.insertBefore(panel, bar.nextSibling);
      bar.parentNode.insertBefore(btn, bar.nextSibling);
    }
    var allowed = canImport();
    btn.hidden = !allowed;
    if (!allowed) { var p = doc.getElementById(PANEL_ID); if (p) p.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  }

  function schedule() {
    if (timer !== null) return;
    timer = root.setTimeout(function () { timer = null; ensureUi(); }, 0);
  }

  function init() {
    if (!doc || initialized || !doc.getElementById('pageClientes')) return;
    initialized = true;
    ['na:role', 'na:canonical-updated', 'focus', 'pageshow', 'storage'].forEach(function (n) { root.addEventListener(n, schedule); });
    ensureUi();
  }

  root.NA_CLIENTES_IMPORTAR = Object.freeze({ parseCsv: parseCsv, buildPreview: buildPreview, templateCsv: templateCsv,
    loadText: loadText, confirmImport: confirmImport, render: ensureUi, init: init, unlocked: importarClientesUnlocked });
  if (doc) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
    root.addEventListener('load', init, { once: true });
  }
})(globalThis);
