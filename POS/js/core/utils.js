/*
 * js/core/utils.js - utilidades TRANSVERSALES compartidas del POS (ETAPA 4, work item CORE/UTILS).
 *
 * Criterio estricto de transversalidad (demostrada por dependencia de uso
 * multi-modulo o bloque UTILS original del autor):
 *   fmt(224 usos) fmtS nowT obtenerHoy(51) HOY diasHasta(17) sinTildes(38)
 *   initials COLORS colorFor _naEsc(199) _naClean _naNumber(271) _naInt
 *   _naClone(65) _naIsPlainObject(15) _naRoundMoney(10)
 * Excluidas deliberadamente (dominio unico): familia ticket (_naTk, _naTicket),
 * familia reportes (_naF8, _naF9), importacion/productos (_naImport, alt-codes,
 * category), impresion-UI (_naEsAndroid, _naEsMovil), seguridad (_naSecHash),
 * _naNewUuid (reside dentro del script V10 dormante) y un-consumidor
 * (_naTime24, _naParseTime24, _naUnitsPerQty, _naUnitsSold, _naLineKey,
 * _naDatePlus, _naCashierIdNumber, _naCsvCell).
 *
 * Extraidas byte-exacto desde POS/index.html @ 45c8c1e (FASE 7 frozen).
 * Codigo MOVIDO, no reescrito. Classic script SIN defer/async; carga antes
 * de todos los scripts inline. Sin negocio, sin storage, sin DOM, sin V10.
 */


// ===== UTILS =====
const fmt=n=>`S/ ${parseFloat(n||0).toFixed(2)}`;
const fmtS=n=>`S/${parseFloat(n||0).toFixed(0)}`;
const nowT=()=>new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
function obtenerHoy(){const ahora=new Date();const local=new Date(ahora.getTime()-(ahora.getTimezoneOffset()*60000));return local.toISOString().split('T')[0];}
const HOY=obtenerHoy;
const diasHasta=s=>{if(!s)return null;const d=new Date(String(s).slice(0,10)+'T00:00:00');if(Number.isNaN(d.getTime()))return null;const hoyD=new Date(obtenerHoy()+'T00:00:00');return Math.round((d-hoyD)/86400000);};
const sinTildes=str=>str.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const initials=n=>n.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
const COLORS=['#00bca4','#ff7043','#a855f7','#3b82f6','#f59e0b','#ef4444','#22c55e','#64748b'];
const colorFor=i=>COLORS[i%8];
const _naEsc=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const _naClean=value=>String(value??'').replace(/[<>]/g,'').trim();
const _naNumber=(value,fallback=0)=>{if(typeof value==='number')return Number.isFinite(value)?value:fallback;let str=String(value??'').trim().replace(/\s/g,'');if(!str)return fallback;if(str.includes(',')&&str.includes('.')){if(str.lastIndexOf(',')>str.lastIndexOf('.'))str=str.replace(/\./g,'').replace(',','.');else str=str.replace(/,/g,'');}else if(str.includes(','))str=str.replace(',','.');str=str.replace(/[^0-9.-]/g,'');const n=Number(str);return Number.isFinite(n)?n:fallback;};
const _naInt=(value,fallback=0)=>{const n=Math.trunc(_naNumber(value,NaN));return Number.isFinite(n)?n:fallback;};
const _naClone=value=>{try{return structuredClone(value);}catch(error){return JSON.parse(JSON.stringify(value));}};
function _naIsPlainObject(value){if(!value||Object.prototype.toString.call(value)!=='[object Object]')return false;const proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null;}
function _naRoundMoney(value){return Number(Math.max(0,_naNumber(value)).toFixed(2));}

// Document placeholders are storage identities, never customer document numbers.
function isPlaceholderDoc(v) { return /^SIN-DOC/i.test(String(v ?? '').trim()); }
function displayDoc(v) { const doc = String(v ?? '').trim(); return !doc || isPlaceholderDoc(doc) ? 'Sin DNI' : doc; }
function _naDocumentValue(v) { return isPlaceholderDoc(v) ? '' : String(v ?? '').trim(); }
if (typeof window !== 'undefined') window.NA_DOC = { isPlaceholderDoc, displayDoc };

// Crédito anulado: anulado:true o status/estado/source_status que empiece por 'anul' (anulado, anulada, ANULADO), sin distinguir
// mayúsculas y recortando espacios. Los estados de sincronización CANON (LIVE, RECONCILED) nunca cuentan.
// Única regla para ficha, filtro, reporte, índice, deudaT, puntaje y «Por cobrar». Vive aquí porque utils.js carga primero.
function _naIsCreditVoided(cr){if(!cr)return false;if(cr.anulado===true)return true;return[cr.status,cr.estado,cr.source_status].some(v=>String(v??'').trim().toLowerCase().startsWith('anul'));}
if (typeof window !== 'undefined') window._naIsCreditVoided = _naIsCreditVoided;

// Presentation computations for Inicio; no mutation of credits or cash state.
function _naInicioMoney(v) { return 'S/ ' + _naNumber(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function _naInicioCredits(records) {
  const active = records.filter(cr => {
    const states = [cr.status, cr.estado].map(v => String(v || '').toLowerCase());
    return !_naIsCreditVoided(cr) && !cr.anulado && !cr.anulada && !cr.voided && !states.some(s => ['cancelado','pagado','paid','anulado','anulada','annulled','void','voided'].includes(s)) && _naInicioBalance(cr) > 0;
  });
  return { active, debt: Number(active.reduce((sum, cr) => sum + _naInicioBalance(cr), 0).toFixed(2)) };
}
function _naInicioBalance(cr) { const computed = _naNumber(cr.monto) - _naNumber(cr.pagado); return Math.max(0, Number((cr.saldo != null && cr.saldo !== '' ? _naNumber(cr.saldo) : computed).toFixed(2))); }
// Crítico (decisión del owner): producto que controla stock y está agotado (stock <= 0) o por debajo de un mínimo > 0.
function _naCriticalStock(p) {
  return p?.controlInventario !== false && p?.trackStock !== false && p?.track_stock !== false && ![p?.tipo,p?.type,p?.unidad,p?.cat].some(v => /^(servicio|service)$/i.test(String(v || ''))) && (_naNumber(p?.stock) <= 0 || (_naNumber(p?.stockMin) > 0 && _naNumber(p?.stock) <= _naNumber(p?.stockMin)));
}
function _naInicioCashText(state) {
  const name = String(state?.cajeroNombre || state?.cajero || '').trim();
  let time = '';
  const stamp = state?.timestampApertura;
  if (stamp && Number.isFinite(new Date(stamp).getTime())) time = new Date(stamp).toLocaleTimeString('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
  else {
    const raw = String(state?.hora24 || state?.horaApertura || state?.hora || '');
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
    if (match) { let hour = Number(match[1]); if (match[3]) hour = hour % 12 + (/^p/i.test(match[3]) ? 12 : 0); if (hour < 24 && Number(match[2]) < 60) time = String(hour).padStart(2,'0') + ':' + match[2]; }
  }
  return ['Abierta', name, time].filter(Boolean).join(' · ');
}

/* NA_DECIMAL: montos y cantidades ESCRITOS A MANO en formularios.
   Un <input type="number"> de Chrome descarta la coma: «4,50» llegaba como 450. Esos campos ahora son
   type="text" con inputmode="decimal" (o "numeric" para enteros) y se leen solo con este parser.
   Formato del negocio (decidido por el dueño): coma para miles y punto para decimales, «1,000.00».
   - punto decimal: «450», «4.50», «.5», «1.000» (= 1.00) y punto final «2.» (= 2.00); «2,» se rechaza;
   - coma de miles solo con agrupación válida: primer grupo de 1 a 3 dígitos sin 0 inicial y cada grupo
     siguiente de EXACTAMENTE 3 dígitos, con «.dd» opcional: «1,000», «4,500», «1,000,000», «1,000.50»;
   - una sola coma seguida de 1 o 2 dígitos es decimal: «4,50» = 4.50, «1,5» = 1.50, «1,00» = 1.00;
   - con 0 inicial o sin nada antes de la coma también es decimal: «0,500» = 0.50, «,500» = 0.50, «,50» = 0.50;
   - montos: como mucho 2 decimales significativos («4.500» vale, «12,3456» o «4.505» se rechazan);
     las cantidades (data-na-decimal="qty") admiten más decimales con punto;
   - entero (data-na-decimal="int"): «3», «1,000»; «4,50» o «4.50» se rechazan en vez de truncar;
   - rechaza «1,2345», «1,0000», «1,23,456», «12,34,56», «1.000,50» (europeo), exponentes («1e2»),
     signos («+2», «-2»), hexadecimales («0x10»), espacios internos, letras y cualquier otra cosa;
   - al salir del campo el monto se muestra con miles y 2 decimales («450» → «450.00», «1000» → «1,000.00»)
     y volver a editar «1,000.00» se lee otra vez como 1000.00.
   _naNumber NO cambia: sigue leyendo datos guardados e importaciones (por ejemplo «1.5E+3» de Excel).
   toCents mantiene el redondeo de hoy: Math.round(monto * 100), y exige un entero seguro. */
(function (root) {
  'use strict';
  var PLAIN = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
  var GROUPED = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?$/;
  var COMMA_DECIMAL = /^(?:\d+,\d{1,2}|0?,\d+)$/;
  var DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d*)?|\d+,\d{1,2}|0?,\d+)$/;
  var INTEGER = /^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)$/;
  var EXAMPLE = 'Usa punto para los decimales y, si quieres, coma para los miles (por ejemplo 4.50 o 1,000.00).';
  var EXAMPLE_INT = 'Escribe un número entero, sin decimales (por ejemplo 3 o 1,000).';

  function text(raw) { return raw == null ? '' : String(raw).trim(); }
  function isInt(opts) { return !!(opts && opts.integer); }
  function isQty(opts) { return !!(opts && opts.qty); }

  // Texto normalizado con punto decimal («1000.5») o null si no cumple el formato.
  function normalize(s, opts) {
    if (isInt(opts)) return INTEGER.test(s) ? s.replace(/,/g, '') : null;
    if (PLAIN.test(s)) return s;
    if (GROUPED.test(s)) return s.replace(/,/g, '');
    if (COMMA_DECIMAL.test(s)) return s.replace(',', '.');
    return null;
  }
  // Decimales significativos (sin ceros finales): «4.500» → 1, «12.3456» → 4.
  function decimals(norm) { var d = norm.split('.')[1] || ''; return d.replace(/0+$/, '').length; }

  // Número o NaN. Vacío también es NaN: cada pantalla decide qué hacer con un campo vacío.
  function parse(raw, opts) {
    var norm = normalize(text(raw), opts);
    if (norm == null || (!isInt(opts) && !isQty(opts) && decimals(norm) > 2)) return NaN;
    var n = Number(norm);
    return Number.isFinite(n) && (!isInt(opts) || Number.isSafeInteger(n)) ? n : NaN;
  }

  // Céntimos enteros (Math.round, como hoy) o NaN.
  function toCents(raw) {
    var n = typeof raw === 'number' ? raw : parse(raw);
    if (!Number.isFinite(n)) return NaN;
    var c = Math.round(n * 100);
    return Number.isSafeInteger(c) ? c : NaN;
  }

  function group(intDigits) { return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // Texto para mostrar: monto «1,000.00»; cantidad «1,000.5»; entero «1,000».
  function format(n, kind) {
    if (!Number.isFinite(n)) return '';
    if (kind === 'int') return group(String(Math.round(n)));
    if (kind === 'qty') { var q = String(n).split('.'); return /e/i.test(q[0]) ? String(n) : group(q[0]) + (q[1] ? '.' + q[1] : ''); }
    var fixed = (Math.round(n * 100) / 100).toFixed(2).split('.');
    return group(fixed[0]) + '.' + fixed[1];
  }

  // Valor GUARDADO (número del producto, de la política…) listo para poner en un campo al editar:
  // montos redondeados a 2 decimales con miles («3.3333» → «3.33», 0.30000000000000004 → «0.30»), para que
  // un campo que el usuario no tocó nunca bloquee Guardar. Vacío/null/no numérico → ''.
  function display(stored, kind) {
    if (stored == null || stored === '') return '';
    var n = typeof stored === 'number' ? stored : Number(String(stored).trim());
    if (!Number.isFinite(n)) return String(stored);
    // Un entero guardado con decimales (dato antiguo) se muestra tal cual, sin redondear a escondidas.
    return format(n, kind === 'int' && !Number.isInteger(n) ? 'qty' : kind);
  }

  function reason(s, opts) {
    var hint = isInt(opts) ? EXAMPLE_INT : EXAMPLE, digits = /^[\d.,]+$/.test(s);
    if (/[eE]/.test(s) && /\d/.test(s)) return 'no se aceptan exponentes («' + s + '»). ' + hint;
    if (/^[+-]/.test(s)) return 'no se aceptan signos («' + s + '»). ' + hint;
    if (isInt(opts) && DECIMAL.test(s)) return '«' + s + '» no es un número entero. ' + hint;
    var norm = normalize(s, opts);
    if (norm != null && decimals(norm) > 2) return '«' + s + '» tiene más de 2 decimales. Escribe como mucho 2 (por ejemplo 4.50).';
    if (/^[\d.,]*\d,$/.test(s)) return '«' + s + '» termina en coma. Escribe los decimales (por ejemplo 2,50 o 2.50) o quita la coma.';
    if (/^\d*,\d{4,}$/.test(s)) return '«' + s + '»: después de una sola coma van 1 o 2 decimales (4,50) o exactamente 3 dígitos de miles (1,000).';
    if (digits && /\.\d*,/.test(s)) return '«' + s + '» usa punto para los miles. Usa coma para los miles y punto para los decimales: 1,000.50.';
    if (digits && /,/.test(s)) return '«' + s + '» tiene la coma de miles mal ubicada. La coma de miles va cada 3 dígitos (1,000.50); para decimales usa punto (4.50).';
    if (digits) return '«' + s + '» tiene más de un punto decimal. ' + hint;
    return '«' + s + '» no es un número válido. ' + hint;
  }

  // { empty, ok, value, message }. message va en español y sin el nombre del campo.
  function check(raw, opts) {
    var s = text(raw);
    if (!s) return { empty: true, ok: false, value: NaN, message: '' };
    var n = parse(s, opts);
    if (Number.isFinite(n)) return { empty: false, ok: true, value: n, message: '' };
    return { empty: false, ok: false, value: NaN, message: reason(s, opts) };
  }

  function el(ref) {
    if (ref && typeof ref === 'object') return ref;
    try { return root.document.getElementById(String(ref)); } catch (_) { return null; }
  }
  function kindOf(node) {
    try { var k = node && node.getAttribute ? node.getAttribute('data-na-decimal') : null; return k === 'int' || k === 'qty' ? k : 'money'; } catch (_) { return 'money'; }
  }
  function optsOf(node, opts) {
    if (opts) return opts;
    var k = kindOf(node);
    return k === 'int' ? { integer: true } : k === 'qty' ? { qty: true } : null;
  }

  // Valor de un campo: vacío → emptyValue (NaN si no se indica); inválido → NaN.
  function value(ref, emptyValue, opts) {
    var node = el(ref), r = check(node ? node.value : '', optsOf(node, opts));
    if (r.empty) return arguments.length > 1 ? emptyValue : NaN;
    return r.value;
  }

  // Mensaje junto al campo (debajo). Solo existe mientras el campo es inválido; sin error no ocupa espacio.
  function messageHost(node) {
    var parent = node.parentNode;
    try {
      var d = root.getComputedStyle && parent && parent.nodeType === 1 ? root.getComputedStyle(parent).display : '';
      if (/flex|grid/.test(d) && !/\bfg\b/.test(parent.className || '')) return parent; // p. ej. «S/ [campo]» en una fila
    } catch (_) {}
    return node;
  }
  function inlineMessage(node, message) {
    var doc = root.document, id = node.id ? node.id + 'NaDecimalMsg' : '';
    var host = messageHost(node), next = host && host.nextSibling;
    var box = next && next.nodeType === 1 && next.getAttribute && next.getAttribute('data-na-decimal-msg') != null ? next : null;
    if (!message) { if (box && box.parentNode) box.parentNode.removeChild(box); try { node.removeAttribute('aria-describedby'); } catch (_) {} return; }
    if (!doc || !host || !host.parentNode) return;
    if (!box) {
      box = doc.createElement('div');
      box.setAttribute('data-na-decimal-msg', '');
      box.setAttribute('role', 'alert');
      box.className = 'na-decimal-msg';
      if (id) box.id = id;
      host.parentNode.insertBefore(box, host.nextSibling);
    }
    box.textContent = message;
    if (box.id) try { node.setAttribute('aria-describedby', box.id); } catch (_) {}
  }

  // Marca el campo: borde rojo, mensaje nativo y mensaje en línea debajo. No cambia alto ni relleno del campo.
  function mark(node, opts) {
    if (!node) return true;
    var r = check(node.value, optsOf(node, opts)), bad = !r.empty && !r.ok;
    try { if (bad) node.setAttribute('aria-invalid', 'true'); else node.removeAttribute('aria-invalid'); } catch (_) {}
    try { node.setCustomValidity(bad ? r.message : ''); } catch (_) {}
    try { inlineMessage(node, bad ? r.message : ''); } catch (_) {}
    return !bad;
  }

  // Al salir del campo: si es válido se muestra con formato («1,000.00»); si no, se deja como está y se marca.
  function reformat(node) {
    if (!node) return;
    var kind = kindOf(node), r = check(node.value, optsOf(node));
    if (r.ok) { var shown = format(r.value, kind); if (shown && node.value !== shown) node.value = shown; }
    mark(node);
  }

  function notify(message) {
    try { if (typeof root.toast === 'function') root.toast(message, 'error'); } catch (_) {}
  }

  // Revisa antes de guardar. fields: [[id|elemento, 'Etiqueta', {integer}?], ...]. Si uno es inválido avisa, enfoca y devuelve false.
  function validate(fields) {
    for (var i = 0; i < (fields || []).length; i++) {
      var pair = fields[i], node = el(pair[0]);
      if (!node) continue;
      var opts = optsOf(node, pair[2]), r = check(node.value, opts);
      mark(node, opts);
      if (r.empty || r.ok) continue;
      notify((pair[1] ? pair[1] + ': ' : '') + r.message);
      try { node.focus(); } catch (_) {}
      return false;
    }
    return true;
  }

  function install() {
    var doc = root.document;
    if (!doc || typeof doc.addEventListener !== 'function' || root.__naDecimalInstalled) return;
    root.__naDecimalInstalled = true;
    function own(ev) { var t = ev && ev.target; return t && t.hasAttribute && t.hasAttribute('data-na-decimal') ? t : null; }
    // Mientras se escribe solo se quita el error (escribir «1,» camino a «1,000» no debe saltar en rojo);
    // el error aparece al salir del campo o al intentar guardar.
    doc.addEventListener('input', function (ev) {
      var t = own(ev);
      if (!t || t.getAttribute('aria-invalid') !== 'true') return;
      var r = check(t.value, optsOf(t));
      if (r.ok || r.empty) mark(t);
    }, true);
    // El mensaje en línea empuja hacia abajo lo que está debajo. Si se sale del campo pulsando un botón
    // (por ejemplo Guardar), se espera a que termine ese clic para no mover el botón bajo el dedo.
    doc.addEventListener('focusout', function (ev) {
      var t = own(ev);
      if (!t) return;
      var next = ev.relatedTarget, typing = next && next.matches && next.matches('input,select,textarea');
      if (typing) { reformat(t); return; }
      var done = false;
      function later() { if (done) return; done = true; if (doc.activeElement !== t) reformat(t); }
      doc.addEventListener('click', function () { root.setTimeout(later, 0); }, { capture: true, once: true });
      root.setTimeout(later, 400);
    }, true);
    try {
      var st = doc.createElement('style');
      st.id = 'naDecimalStyle';
      st.textContent = 'input[data-na-decimal][aria-invalid="true"]{border-color:#dc2626 !important;outline-color:#dc2626}' +
        '.na-decimal-msg{color:#b91c1c;font-size:12px;line-height:1.35;margin-top:4px}body.dark .na-decimal-msg{color:#fca5a5}';
      (doc.head || doc.documentElement).appendChild(st);
    } catch (_) {}
  }

  root.NA_DECIMAL = Object.freeze({ PATTERN: DECIMAL, INTEGER: INTEGER, parse: parse, toCents: toCents, check: check, value: value, mark: mark, validate: validate, format: format, display: display, reformat: reformat, GROUPED: GROUPED });
  install();
})(typeof window !== 'undefined' ? window : globalThis);
