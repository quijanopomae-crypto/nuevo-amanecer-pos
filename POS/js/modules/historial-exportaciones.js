/* Historial de archivos exportados (id historial-exportaciones, #95). Registra en ESTE dispositivo
 * (localStorage, máx. 200 entradas) cada archivo descargado desde el POS: fecha/hora de Lima, tipo,
 * reporte, filas y quién lo exportó. Nunca guarda el contenido del archivo, montos ni costos.
 * Engancha un solo punto común: toda descarga del POS termina en un <a download> (incluido
 * XLSX.writeFile de SheetJS), así que se envuelve HTMLAnchorElement.prototype.click y se escuchan los
 * clics reales en enlaces con «download». No toca la base, el Worker, CANON ni pos-permissions.js.
 * Con el candado cerrado (o permisos sin cargar) no registra ni muestra nada: falla cerrada. */
(function (root) {
  'use strict';
  var PAGE_ID = 'pageHistorialExportaciones', FEATURE_ID = 'historial-exportaciones';
  var KEY = 'na_export_history_v1', MAX = 200, BLOBS_MAX = 40;
  var REPORTS = [
    [/^kardex-/, 'Kardex'], [/^sugerencia-compra-/, 'Sugerencia de compra'],
    [/^productos-sin-movimiento-/, 'Productos sin movimiento'], [/^ajustes-inventario-/, 'Ajustes de inventario'],
    [/^cliente-historial-compras/, 'Historial de compras del cliente'], [/^productos-por-vencer-/, 'Productos por vencer'],
    [/^ventas-con-stock-/, 'Ventas con stock'], [/^arqueo-caja-/, 'Reporte de arqueo'],
    [/^reporte_ganancias_/, 'Reporte de ganancias'], [/^plantilla_productos/, 'Plantilla de productos'],
    [/^productos_nuevo_amanecer_/, 'Productos'], [/^auditoria_nuevo_amanecer_/, 'Auditoría'],
    [/^seguridad_nuevo_amanecer_/, 'Registro de seguridad'], [/^nuevo_amanecer_/, 'Respaldo completo'],
    [/^fotos-productos/, 'Fotos de productos'], [/^comprobante-/, 'Comprobante']
  ];
  var TYPES = { csv: 'CSV', xlsx: 'Excel', xls: 'Excel', pdf: 'PDF', json: 'JSON', txt: 'Texto', png: 'Imagen', jpg: 'Imagen', jpeg: 'Imagen', html: 'HTML' };

  function permissions() { try { return root.NA_PERMISSIONS || null; } catch (_) { return null; } }
  // Falla cerrada: sin permisos cargados o si featureLocked no devuelve exactamente false.
  function unlocked() {
    try { var p = permissions(); return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(FEATURE_ID) === false); } catch (_) { return false; }
  }
  function isOwner() {
    try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; }
  }
  function policyReady() {
    try { var p = permissions(); return !!(p && typeof p.canAccessScreen === 'function' && p.canAccessScreen('owner', PAGE_ID)); } catch (_) { return false; }
  }
  function available() { return unlocked() && isOwner() && policyReady(); }

  function clean(value, max) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 120); }
  function baseName(name) { name = clean(name, 200); var i = name.lastIndexOf('/'); return i >= 0 ? name.slice(i + 1) : name; }
  function extension(name) { var m = /\.([a-z0-9]{1,5})$/i.exec(name); return m ? m[1].toLowerCase() : ''; }
  function fileType(name, mime) {
    var ext = extension(name); if (TYPES[ext]) return TYPES[ext];
    mime = String(mime || '');
    if (/csv/.test(mime)) return 'CSV'; if (/pdf/.test(mime)) return 'PDF'; if (/sheet|excel/.test(mime)) return 'Excel'; if (/json/.test(mime)) return 'JSON';
    return ext ? ext.toUpperCase() : 'Archivo';
  }
  function reportName(name) {
    for (var i = 0; i < REPORTS.length; i++) if (REPORTS[i][0].test(name)) return REPORTS[i][1];
    var stem = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]?\d{4}-\d{2}-\d{2}.*$/, '').replace(/[_-]+/g, ' ').trim();
    return stem ? stem.charAt(0).toUpperCase() + stem.slice(1) : 'Archivo';
  }
  function who() {
    var role = '', label = '';
    try { var r = root.NA_ROLES; role = r ? String(r.role || '') : ''; label = r && r.label ? clean(r.label, 60) : ''; } catch (_) {}
    var base = role === 'owner' ? 'Dueño' : role === 'empleado' ? 'Empleado' : 'Sin confirmar';
    return label ? base + ' · ' + label : base;
  }
  // Filas de datos de un CSV: registros no vacíos después del encabezado. Las líneas de título de una
  // sola celda antes del encabezado (p. ej. «Sin ventas del…») no cuentan.
  function csvRows(text) {
    var body = String(text || '').replace(/^\uFEFF/, ''), records = [], cells = 1, data = false, inQuote = false;
    for (var i = 0; i <= body.length; i++) {
      var ch = i < body.length ? body[i] : '\n';
      if (ch === '"') inQuote = !inQuote;
      if (!inQuote && (ch === '\n' || ch === '\r')) { if (data) records.push(cells); cells = 1; data = false; continue; }
      if (!inQuote && ch === ',') cells++;
      if (ch !== ' ') data = true;
    }
    var wide = records.some(function (n) { return n > 1; }), start = 0;
    if (wide) while (start < records.length && records[start] === 1) start++;
    return Math.max(0, records.length - start - 1);
  }
  function jsonRows(text) {
    try { var v = JSON.parse(text); if (Array.isArray(v)) return v.length; if (v && Array.isArray(v.entries)) return v.entries.length; } catch (_) {}
    return null;
  }

  function storage() { try { return root.localStorage || null; } catch (_) { return null; } }
  function load() {
    var s = storage(); if (!s) return [];
    try { var list = JSON.parse(s.getItem(KEY) || '[]'); return Array.isArray(list) ? list.filter(function (e) { return e && typeof e === 'object' && typeof e.at === 'string'; }).slice(0, MAX) : []; } catch (_) { return []; }
  }
  function save(list) {
    var s = storage(); if (!s) return false;
    list = list.slice(0, MAX);
    for (var n = list.length; n >= 0; n = n > 20 ? Math.floor(n / 2) : n - 1) {
      try { s.setItem(KEY, JSON.stringify(list.slice(0, n))); return true; } catch (_) { if (n === 0) return false; }
    }
    return false;
  }
  var seq = 0;
  function record(info) {
    if (!unlocked()) return null; // candado cerrado o permisos sin cargar: no registra
    var name = baseName(info && info.fileName); if (!name) return null;
    var entry = { id: Date.now().toString(36) + '-' + (++seq), at: new Date(info.at || Date.now()).toISOString(), file: name,
      type: fileType(name, info.mime), report: clean(info.report, 80) || reportName(name),
      rows: typeof info.rows === 'number' && info.rows >= 0 && isFinite(info.rows) ? Math.floor(info.rows) : null, by: clean(info.by, 80) || who() };
    var list = load(); list.unshift(entry); save(list);
    try { root.dispatchEvent(new CustomEvent('na:export-logged', { detail: { id: entry.id } })); } catch (_) {}
    return entry;
  }
  function updateRows(id, rows) {
    if (typeof rows !== 'number' || !(rows >= 0)) return;
    var list = load(), hit = list.find(function (e) { return e.id === id; }); if (!hit) return;
    hit.rows = Math.floor(rows); save(list); if (isActive()) render();
  }
  function clear() { if (!available()) return false; var s = storage(); try { if (s) s.removeItem(KEY); } catch (_) {} render(); return true; }

  // --- Enganche común de descargas ---
  var blobs = new Map(), lastXlsxRows = null;
  function rememberBlob(url, blob) {
    if (typeof url !== 'string' || !blob) return;
    blobs.set(url, blob); if (blobs.size > BLOBS_MAX) blobs.delete(blobs.keys().next().value);
  }
  function wrapXlsx() {
    try {
      var X = root.XLSX; if (!X || typeof X.writeFile !== 'function' || X.writeFile.__naExportLog) return;
      var original = X.writeFile, wrapped = function (wb) {
        try {
          var total = 0; (wb && wb.SheetNames || []).forEach(function (n) { var ws = wb.Sheets[n], ref = ws && ws['!ref']; if (ref && X.utils && X.utils.decode_range) { var r = X.utils.decode_range(ref); total += Math.max(0, r.e.r - r.s.r); } });
          lastXlsxRows = { rows: total, at: Date.now() };
        } catch (_) { lastXlsxRows = null; }
        return original.apply(this, arguments);
      };
      wrapped.__naExportLog = true; X.writeFile = wrapped;
    } catch (_) {}
  }
  function onDownload(anchor) {
    try {
      if (!anchor || !unlocked()) return;
      var name = anchor.getAttribute('download'); if (name == null) return;
      var href = String(anchor.href || ''); name = name || decodeURIComponent(href.split(/[?#]/)[0].split('/').pop() || '');
      if (!name) return;
      var blob = blobs.get(href), ext = extension(name), rows = null;
      if ((ext === 'xlsx' || ext === 'xls') && lastXlsxRows && Date.now() - lastXlsxRows.at < 5000) { rows = lastXlsxRows.rows; lastXlsxRows = null; }
      var entry = record({ fileName: name, mime: blob && blob.type, rows: rows }); if (!entry) return;
      if (rows === null && blob && typeof blob.text === 'function' && (ext === 'csv' || ext === 'json' || /csv|json/.test(blob.type || '')) && blob.size < 5e6) {
        blob.text().then(function (t) { var n = ext === 'json' || /json/.test(blob.type || '') ? jsonRows(t) : csvRows(t); if (n !== null) updateRows(entry.id, n); }, function () {});
      }
    } catch (_) {}
  }
  function install() {
    if (root.__naExportLogInstalled) return; root.__naExportLogInstalled = true;
    try {
      var U = root.URL;
      if (U && typeof U.createObjectURL === 'function') {
        var create = U.createObjectURL, revoke = U.revokeObjectURL;
        U.createObjectURL = function (obj) { var url = create.apply(this, arguments); wrapXlsx(); try { if (obj && typeof obj.size === 'number') rememberBlob(url, obj); } catch (_) {} return url; };
        if (typeof revoke === 'function') U.revokeObjectURL = function (url) { var b = blobs.get(url); var out = revoke.apply(this, arguments); if (b) root.setTimeout(function () { blobs.delete(url); }, 0); return out; };
      }
    } catch (_) {}
    try {
      var A = root.HTMLAnchorElement && root.HTMLAnchorElement.prototype;
      if (A && typeof A.click === 'function') {
        var click = A.click;
        A.click = function () { if (this.hasAttribute && this.hasAttribute('download')) onDownload(this); return click.apply(this, arguments); };
      }
    } catch (_) {}
    try {
      // Clics reales en enlaces <a download> del DOM (los programáticos ya pasan por click()).
      root.document.addEventListener('click', function (ev) {
        if (!ev.isTrusted) return;
        var a = ev.target && ev.target.closest ? ev.target.closest('a[download]') : null; if (a) onDownload(a);
      }, true);
    } catch (_) {}
    wrapXlsx();
  }

  // --- Pantalla ---
  function limaDateTime(iso) {
    try { return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (_) { return iso; }
  }
  function element(tag, className, value) {
    var node = root.document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function page() { return root.document && root.document.getElementById(PAGE_ID); }
  function isActive() { var p = page(); return !!(p && p.classList.contains('active')); }
  function render() {
    var p = page(); if (!p) return false;
    var content = p.querySelector('[data-hx-content]'), status = p.querySelector('[data-hx-status]'), controls = p.querySelector('[data-hx-controls]');
    if (!content || !status) return false;
    content.replaceChildren();
    if (controls) controls.hidden = true;
    if (!unlocked()) { status.textContent = 'Esta función todavía no está disponible.'; return false; }
    if (!isOwner() || !policyReady()) { status.textContent = 'Sin permiso. Pídele acceso al dueño.'; return false; }
    if (controls) controls.hidden = false;
    var list = load(), filter = p.querySelector('[data-hx-type]'), type = filter ? filter.value : '';
    var rows = type ? list.filter(function (e) { return e.type === type; }) : list;
    status.textContent = rows.length + (rows.length === 1 ? ' archivo' : ' archivos') + ' · hora de Lima · solo este dispositivo (últimos ' + MAX + ')';
    if (!rows.length) { content.appendChild(element('p', 'hx-empty', list.length ? 'No hay archivos de este tipo.' : 'Todavía no se exportó ningún archivo en este dispositivo.')); return true; }
    var table = element('table', 'hx-table');
    table.appendChild(element('caption', 'hx-sr-only', 'Archivos exportados, más reciente primero'));
    var head = element('thead'), tr = element('tr');
    ['Fecha y hora', 'Reporte', 'Tipo', 'Filas', 'Exportó'].forEach(function (label, i) { var th = element('th', i === 3 ? 'hx-num' : '', label); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    var body = element('tbody');
    rows.forEach(function (e) {
      var line = element('tr'); line.setAttribute('data-hx-row', e.id);
      var cells = [['Fecha y hora', limaDateTime(e.at), ''], ['Reporte', e.report, 'hx-report'], ['Tipo', e.type, ''], ['Filas', e.rows == null ? '—' : e.rows.toLocaleString('es-PE'), 'hx-num'], ['Exportó', e.by, '']];
      cells.forEach(function (c, i) {
        var td = element('td', c[2], c[1]); td.setAttribute('data-label', c[0]);
        if (i === 1) td.appendChild(element('small', '', e.file));
        line.appendChild(td);
      });
      body.appendChild(line);
    });
    table.appendChild(body); content.appendChild(table);
    return true;
  }
  function init() {
    var p = page(); if (!p || p.__naHxBound) return; p.__naHxBound = true;
    function update() { if (p.classList.contains('active')) render(); }
    p.addEventListener('change', update);
    var refresh = p.querySelector('[data-hx-refresh]'), clr = p.querySelector('[data-hx-clear]');
    if (refresh) refresh.addEventListener('click', update);
    if (clr) clr.addEventListener('click', function () { if (!available()) return; if (typeof root.confirm !== 'function' || root.confirm('¿Borrar el historial de exportaciones de este dispositivo? Los archivos ya descargados no se borran.')) clear(); });
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(update).observe(p, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', function () { if (!available()) render(); else update(); });
    root.addEventListener('na:export-logged', update);
    update();
  }
  install();
  root.NA_HISTORIAL_EXPORTACIONES = Object.freeze({ KEY: KEY, MAX: MAX, record: record, load: load, clear: clear, csvRows: csvRows, reportName: reportName, fileType: fileType, available: available, unlocked: unlocked, render: render, init: init });
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
})(globalThis);
