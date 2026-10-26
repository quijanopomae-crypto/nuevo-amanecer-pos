/* Asistente del POS (PROTOTIPO AISLADO, SOLO DUEÑO / modo admin). Lógica sin pantalla: privacidad, permisos y confirmación.
   No vende ni llena el carrito.
   Funciona en el navegador (window.NA_ASISTENTE_CORE) y en Node (pruebas).
   Regla de oro: una propuesta solo se ejecuta con execute(id, {confirmed:true}) llamado desde el
   botón «Confirmar», una sola vez, y usando funciones que el POS ya tiene. */
(function (root) {
  'use strict';
  var PATTERNS = [
    // (auditoría 500, OCR-023) «pin» + espacio + palabra de solo letras («CHUPETIN PIN POP», «pin pon») es nombre de producto: no se tapa.
    [/\b(pin|clave|contrase(?:ñ|n)a|password|token|api[ _-]?key)\b(\s*(?:es|era|de|:|=)?\s*)([^\s,.;]{3,})/gi, function (m, k, sep, val) {
      return /^pin$/i.test(k) && /^[ \t]+$/.test(sep) && !/\d/.test(val) && !/^(?:es|era|de|actual|nuevo|nueva|secreto)$/i.test(val) ? m : k + sep + '[oculto]'; }],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo oculto]'],
    [/\b(?:RUC\s*(?:N[°º.]?\s*)?[:#-]?\s*)?(?:10|15|17|20)\d{9}\b/gi, '[RUC oculto]'],
    [/(?<![0-9])(?:\+?51[\s-]?)?9\d{2}[\s-]?\d{3}[\s-]?\d{3}(?![0-9])/g, '[teléfono oculto]'],
    [/\b(?:DNI\s*[:#-]?\s*)?\d{8}\b/gi, '[DNI oculto]'],
    // (auditoría de privacidad 2026-10-22) mismo criterio que el servidor: fijo con separadores, DNI con separadores y correo disfrazado.
    [/(?<![0-9.,])(?:\+?51[\s-]?)?(?:\(0?\d{1,2}\)|0\d{1,2})[\s-]?\d{3}[\s-]\d{3,4}(?![0-9]|[.,]\d)/g, '[teléfono oculto]'],
    [/(?<![0-9.,])(?:DNI\s*[:#-]?\s*)?(?:\d{2}\.\d{3}\.\d{3}|\d{4}[ .]\d{4}|\d{2} \d{3} \d{3})(?![0-9]|[.,]\d)/gi, '[DNI oculto]'],
    [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}[ \t]{0,3}(?:[(\[{][ \t]{0,2}(?:at|arroba)[ \t]{0,2}[)\]}]|[ \t]arroba[ \t]|[ \t]@[ \t]?|@[ \t])[ \t]{0,3}(?:[A-Za-z0-9-]{1,63}[ \t]{0,3}(?:\.|[(\[{][ \t]{0,2}(?:dot|punto)[ \t]{0,2}[)\]}]|[ \t](?:dot|punto)[ \t])[ \t]{0,3}){1,8}[A-Za-z]{2,24}\b/gi, '[correo oculto]']
  ];
  function redactText(v) { var s = String(v == null ? '' : v); PATTERNS.forEach(function (p) { s = s.replace(p[0], p[1]); }); return s; }
  // (Bot 2 sobre 6280deae) contexto del DUEÑO: RUC de empresa (20/15/17) y 8 dígitos junto a «código», «cód.», «EAN» o «barra(s)» van exactos.
  // RUC 10 y 8 dígitos sueltos, tapados. El servidor vuelve a filtrar según el rol de SU sesión (esto solo es lo que manda el aparato).
  var CODE_LABEL = /(?:^|[^a-záéíóúñü])(?:c[óo]d(?:igos?)?\.?|ean(?:-?(?:13|8))?|barras?)(?![a-záéíóúñü])[^\n\d]{0,24}$/i;
  function redactOwnerContext(v) { var s = String(v == null ? '' : v);
    PATTERNS.forEach(function (p, i) {
      if (i === 2) s = s.replace(p[0], function (m) { return /^(?:20|15|17)/.test(m.replace(/^\D+/, '')) ? m : '[RUC oculto]'; });
      else if (i === 4) s = s.replace(p[0], function (m, off, str) { return /^\d/.test(m) && CODE_LABEL.test(str.slice(Math.max(0, off - 48), off)) ? m : '[DNI oculto]'; });
      else s = s.replace(p[0], p[1]); });
    return s; }
  // (Bot 2 sobre 6280deae) Tarjeta de compra: un campo que el servidor dejó vacío (tenía algo tapado) se completa a mano. Borde de alerta,
  // «Complete este dato», foco en el primero y «Confirmar» apagado hasta llenarlos. Solo createElement / textContent. Lo escrito queda en
  // state (fuera de la propuesta firmada) y lo usa fillPurchase; nunca se escribe una máscara.
  // (Bot 5 sobre 58200f60) igual que MASK_LEFT_RE del servidor: también «∗∗∗∗6789», «••••6789», «**6789», «…6789», «xxxx6789», «(oculto)»
  // (Bot 5 sobre d72b7601) y «____6789», «####6789», «▪▪▪▪», «XXX-XX-6789», «*6789» (un carácter al inicio o tras la serie «F001-»); sin lookbehind
  var MASK_LEFT = /\*{3,}|[*∗＊•●·⁎✱⁕⁑⁂\u2732-\u273D\u2749-\u274B⚹⊛٭﹡]{2,}(?=[\s-]?\d)|[∗＊•●·▪■◦□▫]{3,}|[▪■◦□▫]{2,}|(?:_{2,}|#{2,}|~{2,}|\?{2,}|-{3,})(?=[\s-]?\d)|(?:^\s*|\b[A-Z0-9]{4}-)[*∗＊•●·▪■◦#_⁎✱⁕⁑⁂\u2732-\u273D\u2749-\u274B⚹⊛٭﹡](?=\d)|…\s?\d|\bx{3,}\d|\bx{2,}(?:-x+)+-?\d|\[[^\]\n]{0,24}(?:oculto|omitid|dato)[^\]\n]{0,24}\]|\((?:oculto|omitid[oa])\)/i;
  function maskLeft(v) { return MASK_LEFT.test(String(v == null ? '' : v)); }
  // (Bot 2 sobre d72b7601, decisión final) misma regla que normManual/manualBad del servidor: fuera invisibles y de control, NBSP/U+2007/U+202F → espacio,
  // U+2010-U+2015 → «-», recorte; malo si queda vacío o sin letra/dígito, con 2+ símbolos de relleno seguidos o con «[oculto]»; solo el documento
  // además «XX6789» (2+ X y dígitos) y el resto de MASK_LEFT. «Ferretería XXL SAC» y «Distribuidora XX» pasan.
  // (Bot 5 sobre 3ee80c18) igual que el servidor: NFC; fuera \p{Cf} (dirección U+202A-202E/U+2066-2069, U+00AD, U+2061, etiquetas U+E0000-E007F…),
  // U+FE00-FE0F, U+034F y las marcas combinantes que no van pegadas a una letra; NFC otra vez. «José» (acento combinante) sigue válido.
  var MANUAL_FMT = /[\p{Cf}\uFE00-\uFE0F\u034F\u{E0000}-\u{E007F}]/gu, MANUAL_LOOSE_MARK = /(^|[^\p{L}\p{M}])\p{M}+/gu;
  // (Bot 4 sobre 5646a4c9) inputClean = normManual sin el recorte de los extremos: es lo que se deja VISIBLE en el campo mientras se escribe,
  // así lo que se ve es lo que se manda (normManual(x) === inputClean(x).trim()).
  function inputClean(v) { return String(v == null ? '' : v).normalize('NFC').replace(MANUAL_FMT, '').replace(MANUAL_LOOSE_MARK, '$1').normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, ' ').replace(/[\u00A0\u2007\u202F]/g, ' ').replace(/[\u2010-\u2015]/g, '-'); }
  function normManual(v) { return inputClean(v).trim(); }
  // (Bot 2 sobre 3ee80c18) igual que el servidor: ∙ ✱ ⁎ en el relleno; revisiones sobre una copia NFKC (se guarda NFC); documento: «x x 6789»;
  // proveedor: «*6789» (asterisco pegado a dígitos al inicio de una palabra).
  // (Bot 5 sobre 5646a4c9) igual que el servidor: ⁕ ⁑ ⁂ ✲-✽ ❉-❋ ⚹ ⊛ ٭ ﹡ en el relleno y pegados a dígitos
  var FILL_STAR1 = /(?<![\p{L}\p{N}])[*∗＊⁎✱⁕⁑⁂\u2732-\u273D\u2749-\u274B⚹⊛٭﹡](?=\d)/u;
  var FILL_RUN = /[*∗＊•●·∙✱⁎_#▪■×…◦□▫~⁕⁑⁂\u2732-\u273D\u2749-\u274B⚹⊛٭﹡](?:\s?[*∗＊•●·∙✱⁎_#▪■×…◦□▫~⁕⁑⁂\u2732-\u273D\u2749-\u274B⚹⊛٭﹡])+/u, MARK = /\[[^\]\n]{0,24}(?:oculto|omitid|dato)[^\]\n]{0,24}\]|\((?:oculto|omitid[oa])\)/i;
  function manualBad1(n, k) { if (!/[\p{L}\p{N}]/u.test(k) || FILL_RUN.test(k) || MARK.test(k)) return true;
    if (FILL_STAR1.test(k)) return true;
    return (n === 'documento' || n === 'ruc') ? (/(?<!\p{L})x(?:[\s-]?x)+[\s-]?\d/iu.test(k) || maskLeft(k)) : false; }
  function manualBad(n, v) { if (!v) return true; v = String(v); return manualBad1(n, v) || manualBad1(n, v.normalize('NFKC')); } // NFC y copia NFKC
  var NEED_LABEL = { proveedor: 'Proveedor', documento: 'Documento' }, NEED_MAX = { proveedor: 120, documento: 80 };
  // (#967 teléfono) Tarjeta «configuracion» de RUC (destino servidor) con el RUC tapado: llega SIN valor y con el campo a completar
  // («completar» o «needFields»). La persona escribe el RUC en el teléfono; va en body.manual del confirm (fuera de la propuesta firmada)
  // y nunca en el chat ni a la IA. Solo esa tarjeta y solo esos nombres.
  var RUC_FIELDS = ['ruc', 'valor'], RUC_RE = /^(10|15|16|17|20)\d{9}$/;
  function isRucCard(p) { return !!p && p.type === 'configuracion' && p.destino === 'servidor' && p.ajuste === 'negocio_ruc'; }
  function needLabel(p, n) { return isRucCard(p) ? (RUC_FIELDS.indexOf(n) >= 0 ? 'RUC' : null) : (p && p.type === 'compra' ? NEED_LABEL[n] || null : null); }
  function needMax(p, n) { return isRucCard(p) ? 16 : NEED_MAX[n]; } // 11 dígitos + espacios, puntos o guiones al pegar; se valida sobre los dígitos
  function rucDigits(v) { return String(v == null ? '' : v).replace(/[\s.\-]/g, ''); }
  function needList(p) { return p && Array.isArray(p.completar) ? p.completar : p && Array.isArray(p.needFields) ? p.needFields : null; }
  function needNames(p) { var l = needList(p); return l ? l.filter(function (n, i, a) { return typeof n === 'string' && needLabel(p, n) && a.indexOf(n) === i; }) : []; }
  function needFields(doc, p, onChange) {
    var names = needNames(p), rucCard = isRucCard(p), NEED_MAX = {};
    names.forEach(function (n) { NEED_MAX[n] = needMax(p, n); });
    if (!names.length) return null;
    var state = {}, stale = {}, inputs = [], hints = {}, byName = {}, checks = [], box = doc.createElement('div'); box.className = 'na-asst-need-box';
    names.forEach(function (n, i) {
      var lab = doc.createElement('label'); lab.className = 'na-asst-need-l';
      var t = doc.createElement('span'); t.className = 'na-asst-need-n'; t.textContent = needLabel(p, n);
      var inp = doc.createElement('input'); inp.type = 'text'; inp.className = 'na-asst-need'; inp.maxLength = NEED_MAX[n] * 2; // (Bot 3 sobre 6e0b3c5d) holgura: lo pegado con caracteres de formato se limpia ANTES de recortar a NEED_MAX (cleanField)
      inp.setAttribute('data-need', n); inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('autocomplete', 'off');
      if (rucCard) { inp.setAttribute('inputmode', 'numeric'); inp.setAttribute('placeholder', '11 dígitos'); }
      var HINT = rucCard ? 'Escriba los 11 dígitos del RUC' : 'Complete este dato';
      var hint = doc.createElement('span'); hint.className = 'na-asst-need-t'; hint.textContent = HINT; hint.id = 'naNeed' + n + (++needSeq);
      inp.setAttribute('aria-describedby', hint.id);
      // (Bot 2 sobre 84a49517) la parte exacta que trajo el servidor («F001-») va de inicio; cuenta solo cuando se le agrega lo que falta
      // (Bot 4 sobre 5646a4c9) el inicio que trae la propuesta también sin caracteres de formato (lo que se ve = lo que se manda)
      // RUC: el campo empieza SIEMPRE vacío (lo tapado no se muestra ni se completa a medias)
      var pre0 = !rucCard && p[n] && typeof p[n] === 'string' ? inputClean(p[n]) : '', pre = pre0 && !maskLeft(pre0) ? pre0.slice(0, NEED_MAX[n]) : '';
      if (pre) inp.value = pre;
      hints[n] = hint; byName[n] = inp;
      // (Bot 4 sobre 5646a4c9) el CAMPO muestra lo limpio: si inputClean cambia lo escrito/pegado (U+202E, U+00AD, U+200B…), se reescribe el valor
      // y el cursor/selección retrocede lo quitado antes de él (pegar deja el cursor al final de lo pegado). Durante una composición (IME,
      // teclado con acentos) no se toca; se limpia en compositionend. Solo si cambia: escribir normal no mueve nada.
      var composing = false;
      function cleanField() { var raw = String(inp.value == null ? '' : inp.value), c0 = inputClean(raw), max = NEED_MAX[n], c = c0;
        var s0 = inp.selectionStart, e0 = inp.selectionEnd, at = function (k) { return typeof k === 'number' ? Math.min(c0.length, inputClean(raw.slice(0, k)).length) : null; };
        var s1 = at(s0), e1 = at(e0);
        // (Bot 4 sobre 39ccd25c) como maxlength nativo: lo que no cabe se quita de lo RECIÉN escrito (justo antes del cursor); el resto del campo
        // queda igual (antes se recortaba el final: escribir en medio de un campo lleno borraba el último carácter sin avisar)
        if (c0.length > max) { var cut = c0.length - max;
          if (e1 != null && e1 >= cut) { c = c0.slice(0, e1 - cut) + c0.slice(e1); e1 -= cut; s1 = Math.min(s1, e1); } else { c = c0.slice(0, max); if (s1 != null) { s1 = Math.min(s1, max); e1 = e1 == null ? null : Math.min(e1, max); } } }
        if (c === raw) return false;
        inp.value = c;
        if (s1 != null && typeof inp.setSelectionRange === 'function') { try { inp.setSelectionRange(s1, e1 == null ? s1 : Math.max(s1, e1)); } catch (_) {} }
        return true; }
      var lastRaw = null;
      function sync() {
        // (Bots 4/5 sobre 6e0b3c5d) mientras el campo MUESTRA algo distinto de lo que se mandaría (composición abierta o colgada sin compositionend,
        // con U+202E crudo a la vista), no cuenta: «Confirmar» apagado hasta que lo visible sea lo limpio
        var raw = String(inp.value == null ? '' : inp.value); lastRaw = raw; var v = normManual(raw).slice(0, NEED_MAX[n]).trim(), ok = !manualBad(n, v) && v !== normManual(pre) && inputClean(raw) === raw && raw.length <= NEED_MAX[n];
        if (rucCard) { v = rucDigits(v); ok = ok && RUC_RE.test(v); } state[n] = ok ? v : '';
        if (stale[n] != null && v !== stale[n]) delete stale[n]; // (Bot 4 sobre 58200f60) tras un 422 cuenta recién cuando cambia
        ok = ok && stale[n] == null;
        hint.textContent = HINT;
        inp.setAttribute('aria-invalid', ok ? 'false' : 'true'); setCls(inp, 'ok', ok); hint.hidden = ok; // (Bot 4) classList: na-asst-ltr se queda
        if (onChange) onChange(); }
      // (Bot 5 sobre 39ccd25c) valor cambiado SIN evento (script, extensión): al pulsar «Confirmar» se vuelve a mirar; si cambió se limpia A LA
      // VISTA, se recalcula y ese toque no manda nada (lo que se ve = lo que se mandaría en el siguiente)
      // (Bot 5 sobre 36f6ae51) con el foco en el campo, el toque con el mouse saca el foco ANTES del clic y el blur ya recalculaba: el primer toque
      // mandaba. Ahora, si el blur encuentra un valor cambiado sin evento (scriptDirty), el primer toque de «Confirmar» que sigue tampoco manda.
      // Se borra con una entrada real (input/composición) o con ese toque. Sin temporizador.
      var scriptDirty = false;
      checks.push(function () { var raw = String(inp.value == null ? '' : inp.value), d = scriptDirty; scriptDirty = false; if (raw === lastRaw && !d) return false; if (!composing) cleanField(); sync(); return true; });
      inp.addEventListener('compositionstart', function () { composing = true; });
      inp.addEventListener('compositionend', function () { composing = false; scriptDirty = false; cleanField(); sync(); });
      // (Bots 4/5 sobre 6e0b3c5d) composición que termina sin compositionend: al salir del campo se suelta y se limpia
      inp.addEventListener('blur', function () { composing = false; if (String(inp.value == null ? '' : inp.value) !== (lastRaw === null ? (pre || '') : lastRaw)) scriptDirty = true; cleanField(); sync(); });
      // (Bot 4 sobre 6e0b3c5d) pegar/soltar (y un reemplazo del corrector con caracteres de control): se limpia ANTES de entrar, con
      // execCommand('insertText'), que deja la pila de deshacer del navegador entera (Ctrl+Z quita lo pegado; rehacer no concatena). El recorte a
      // NEED_MAX va DESPUÉS de limpiar. Si execCommand no está o devuelve false, setRangeText (no guarda deshacer, pero lo visible = lo limpio).
      // Escribir normal sigue por 'input' (solo se reescribe si cambia); durante una composición no se toca nada.
      var handled = false;
      inp.addEventListener('beforeinput', function (ev) {
        var t = ev && ev.inputType;
        // (Bot 4 sobre 39ccd25c) campo lleno: escribir no inserta nada y el valor queda igual (como maxlength nativo)
        if (t === 'insertText' && !composing && !(ev && ev.isComposing) && ev.data) { var cv = String(inp.value == null ? '' : inp.value), a = typeof inp.selectionStart === 'number' ? inp.selectionStart : cv.length, b = typeof inp.selectionEnd === 'number' ? inp.selectionEnd : a;
          if (cv.length - (b - a) >= NEED_MAX[n] && typeof ev.preventDefault === 'function') ev.preventDefault(); return; }
        if (composing || (ev && ev.isComposing) || (t !== 'insertFromPaste' && t !== 'insertFromDrop' && t !== 'insertReplacementText')) return;
        var dt = ev.dataTransfer, raw = ev.data != null ? String(ev.data) : (dt && typeof dt.getData === 'function' ? String(dt.getData('text/plain') || '') : null);
        if (raw == null) return;
        var cur = String(inp.value == null ? '' : inp.value), s0 = typeof inp.selectionStart === 'number' ? inp.selectionStart : cur.length, e0 = typeof inp.selectionEnd === 'number' ? inp.selectionEnd : s0;
        var room = Math.max(0, NEED_MAX[n] - (cur.length - (e0 - s0))), lim = room * 8 + 32, src = raw.length > lim ? raw.slice(0, lim) : raw;
        var c = inputClean(src.replace(/\r\n?|\n/g, ' ')); if (c.length < room && src !== raw) c = inputClean(raw.replace(/\r\n?|\n/g, ' ')); // (CPU) 100 KB pegados: se limpia solo lo que puede caber
        if (c.length > room) c = c.slice(0, room);
        if (c === raw) return; // nada que limpiar ni recortar: lo hace el navegador
        if (t === 'insertReplacementText' && inputClean(raw) === raw && c.length === raw.length) return;
        ev.preventDefault(); var d = inp.ownerDocument || doc, ok = false;
        if (c && d && typeof d.execCommand === 'function') { handled = true; try { ok = d.execCommand('insertText', false, c); } catch (_) { ok = false; } if (!ok) handled = false; }
        if (!ok && c && typeof inp.setRangeText === 'function') { inp.setRangeText(c, s0, e0, 'end'); ok = true; }
        if (!c && s0 !== e0 && typeof inp.setRangeText === 'function') inp.setRangeText('', s0, e0, 'end');
        sync();
      });
      // respaldo (autocompletar, teclados o arrastres que no pasan por beforeinput): si lo que entró trae caracteres de formato, se reescribe;
      // tras un pegado ya limpiado arriba no hace nada. sync() sigue exigiendo inputClean(v) === v para encender «Confirmar».
      inp.addEventListener('input', function (ev) { scriptDirty = false; if (handled) { handled = false; sync(); return; } if (!composing && !(ev && ev.isComposing)) cleanField(); sync(); });
      lab.appendChild(t); lab.appendChild(inp); lab.appendChild(hint); box.appendChild(lab); inputs.push(inp);
    });
    // (Bot 4 sobre 84a49517) el servidor rechazó (422 fields_required): aviso junto a cada campo nombrado, foco en el primero; lo escrito queda.
    // Devuelve los nombres que no son campos de esta tarjeta (para el aviso general).
    function flag(fields, text) {
      var other = [], first = null;
      (Array.isArray(fields) ? fields : []).forEach(function (n) {
        var inp = byName[n], hint = hints[n]; if (!inp) { other.push(String(n)); return; }
        hint.hidden = false; hint.textContent = text || (rucCard ? 'Escriba los 11 dígitos del RUC' : 'Complete este dato'); inp.setAttribute('aria-invalid', 'true'); setCls(inp, 'ok', false); if (!first) first = inp;
        // (Bot 4 sobre 58200f60) lo escrito queda, pero el campo no vuelve a contar como lleno (ni «Confirmar» se enciende) hasta que cambie
        stale[n] = normManual(inp.value).slice(0, NEED_MAX[n]).trim(); if (rucCard) stale[n] = rucDigits(stale[n]); });
      if (first) { try { first.focus({ preventScroll: false }); } catch (_) {} }
      return other;
    }
    function recheck() { var changed = false; checks.forEach(function (f) { if (f()) changed = true; }); return changed; }
    function values() { var o = {}; names.forEach(function (n) { if (state[n]) o[n] = state[n]; }); return o; }
    return { el: box, state: state, names: names.slice(), first: inputs[0], inputs: inputs, flag: flag, values: values, recheck: recheck, missing: function () { return names.filter(function (n) { return !state[n] || stale[n] != null; }).length; } };
  }
  var needSeq = 0;
  // (Bot 4 sobre 5646a4c9) poner/quitar una clase sin pisar las demás (na-asst-need, na-asst-ltr de ltrIsolate)
  function setCls(el, k, on) { if (el.classList && typeof el.classList.toggle === 'function') { el.classList.toggle(k, !!on); return; }
    var a = String(el.className || '').split(/\s+/).filter(function (x) { return x && x !== k; }); if (on) a.push(k); el.className = a.join(' '); }
  // valor para «Nueva compra»: lo escrito a mano, o el de la tarjeta si no trae máscara; nunca una máscara
  // (Bot 5 sobre 5646a4c9) el valor de la propuesta también sin caracteres de formato (igual que fmtClean del servidor): «U+202E 1234-100F» se
  // muestra y se escribe en «Nueva compra» como «1234-100F» (dir=ltr no deshace un U+202E de adentro)
  function fmtClean(v) { return String(v == null ? '' : v).normalize('NFC').replace(MANUAL_FMT, '').replace(MANUAL_LOOSE_MARK, '$1').normalize('NFC'); }
  function purchaseValue(p, n) { var m = p && p._manual && normManual(p._manual[n]); if (m && !manualBad(n, m)) return m; var v = p ? fmtClean(p[n]).trim() : ''; return v && !maskLeft(v) ? v : ''; }
  // lo escrito a mano para los campos de «completar» (va en body.manual del confirm, fuera de la propuesta firmada); nunca una máscara
  function fillValues(p) { var m = p && p._manual; if (!m || !needList(p)) return null; var o = {}, k = 0, ruc = isRucCard(p);
    needNames(p).forEach(function (n) { var v = typeof m[n] === 'string' ? normManual(m[n]).slice(0, needMax(p, n)).trim() : ''; if (ruc) v = RUC_RE.test(rucDigits(v)) ? rucDigits(v) : '';
      if (v && !manualBad(n, v)) { o[n] = v; k++; } }); return k ? o : null; }
  function perms() { return root.NA_PERMISSIONS; }
  function canDo(role, action) { var P = perms(); return !!(P && P.canDo(role, action)); }

  // Contexto que viaja al Worker: solo productos (id, nombre, precio, stock; costo solo si el rol lo ve). Nunca clientes.
  function buildContext(productos, role, screen, query) {
    var list = Array.isArray(productos) ? productos : [];
    var q = String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var words = q.split(/\s+/).filter(function (w) { return w.length >= 4; });
    function score(p) { var n = String(p.name || p.nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); return words.some(function (w) { return n.indexOf(w) >= 0; }) ? 1 : 0; }
    var ranked = list.slice().sort(function (a, b) { return score(b) - score(a); }).slice(0, 80);
    var costs = canDo(role, 'purchases.costs.view');
    return capContext({ screen: screen || null, products: ranked.map(function (p) {
      var o = { id: String(p.id), nombre: (role === 'owner' ? redactOwnerContext : redactText)(String(p.name || p.nombre || '')).slice(0, 60), precio: Number(p.precio) || 0, stock: Number(p.stock) || 0 };
      if (costs && Number(p.costo) > 0) o.costo = Number(p.costo);
      if (!tracksStock(p)) o.controla = false;
      return o;
    }) }, 2000, 25);
  }

  // ¿Puede ESTE aparato ejecutar ESTA propuesta? (el Worker ya filtró y vuelve a revisar al confirmar; esto es la segunda barrera).
  // Dueño: sí. Empleado: solo si el SERVIDOR le dio un nivel (roles.level viene del último ping, nunca de una caché local);
  // y aun así NO recibe tarjetas que cambian algo (solo el dueño confirma). Documentos del empleado: solo lista de precios y pedido.
  var TYPES = ['configuracion', 'compra', 'precio', 'costo', 'ajuste', 'producto', 'documento', 'consulta', 'pasos'];
  var EMP_LEVELS = ['consultas', 'consultas_documentos'], EMP_DOCS = ['lista_precios', 'lista_pedido'];
  // (#967 teléfono) Datos del negocio y del ticket (destino servidor): los aplica el Admin o el nivel 3 con «costos y cambios» (roles.cambios,
  // del ping). Las tarjetas del aparato (#972: apariencia, lector, stock…) siguen solo del Admin. Misma lista cerrada que el Worker (CONFIG_KEYS).
  var SERVER_CONFIG_KEYS = ['negocio_nombre', 'negocio_ruc', 'negocio_direccion', 'ticket_pie', 'ticket_ancho', 'ticket_logo', 'ticket_igv', 'ticket_forma_pago', 'avisos'];
  function isServerConfig(p) { return !!p && p.type === 'configuracion' && p.destino === 'servidor' && SERVER_CONFIG_KEYS.indexOf(p.ajuste) >= 0; }
  function canExecute(roles, proposal) {
    var role = roles && roles.role;
    if (role !== 'owner' && role !== 'empleado') return { ok: false, msg: 'No se sabe quién usa este aparato. Revisa la conexión.' };
    if (role === 'owner' && roles.isOwner && !roles.isOwner()) return { ok: false, msg: 'El asistente es solo para el Admin.' };
    if (role === 'empleado') {
      if (EMP_LEVELS.indexOf(roles.level) < 0) return { ok: false, msg: 'El asistente es solo para el Admin.' };
      if (proposal && proposal.type === 'configuracion') return isServerConfig(proposal) && roles.cambios === true && roles.level === 'consultas_documentos' ? { ok: true } // el nivel 3 llega como consultas_documentos
        : { ok: false, msg: isServerConfig(proposal) ? 'Los datos del negocio y del ticket los cambia el Admin o quien tenga el permiso «costos y cambios».' : 'Ese ajuste es solo del Admin.' };
      if (proposal && proposal.type === 'costo') return { ok: false, msg: 'Solo el Admin puede cambiar costos.' };
      if (proposal && (proposal.needsConfirm || ['compra', 'precio', 'ajuste', 'producto'].indexOf(proposal.type) >= 0)) return { ok: false, msg: 'Los cambios los hace el Admin desde su teléfono.' };
      if (proposal && proposal.type === 'documento' && (roles.level !== 'consultas_documentos' || EMP_DOCS.indexOf(proposal.tipo) < 0)) return { ok: false, msg: 'Ese documento es solo para el Admin.' };
    }
    if (!proposal || TYPES.indexOf(proposal.type) < 0) return { ok: false, msg: 'Acción desconocida.' };
    return { ok: true };
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '\x26amp;', '<': '\x26lt;', '>': '\x26gt;', '"': '\x26quot;', "'": '\x26#39;' }[c]; }); } // \x26 = «&» (mismo texto; así una herramienta que decodifica entidades no puede romperlo)
  function soles(n) { return n == null || !isFinite(n) ? '-' : 'S/ ' + Number(n).toFixed(2); }

  // ---------- Documentos internos (solo lectura, armados en el aparato con datos que el POS ya tiene) ----------
  // Siempre marcados «NO ES COMPROBANTE SUNAT». Nunca emiten nada fiscal ni escriben datos.
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function maskDoc(d) { var s = String(d || '').replace(/\s/g, ''); return s.length >= 4 ? '****' + s.slice(-4) : (s ? '****' : '-'); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function pname(p) { return p.name || p.nombre || ''; }
  function tracks(p) { return p.controlInventario !== false && p.tracksInventory !== false; }
  function inRange(f, d, h) { f = String(f || '').slice(0, 10); return (!d || f >= d) && (!h || f <= h); }
  function docShell(title, sub, head, rows, foot, note, business) {
    return '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      'body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#0f172a}h1{font-size:20px;margin:0 0 2px}.s{color:#334155;margin-bottom:6px}.w{border:2px dashed #b91c1c;color:#991b1b;padding:6px 10px;font-weight:800;margin:10px 0;text-align:center}' +
      'table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #cbd5e1;padding:6px 4px;text-align:left}th{background:#f1f5f9}.r{text-align:right}tfoot td{font-weight:800}.n{color:#334155;font-size:12px;margin-top:10px}@media print{.w{border-color:#000;color:#000}}</style></head><body>' +
      '<h1>' + esc(business || MEMORY.fallbackName) + '</h1><div class="s">' + esc(title) + (sub ? ' · ' + esc(sub) : '') + ' · Generado ' + esc(new Date().toLocaleString('es-PE')) + '</div>' +
      '<div class="w">DOCUMENTO INTERNO · NO ES COMPROBANTE SUNAT</div>' +
      '<table><thead><tr>' + head.map(function (h, i) { return '<th' + (i && h.r ? ' class="r"' : '') + '>' + esc(h.t || h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (head[i] && head[i].r ? ' class="r"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + head.length + '">Sin datos.</td></tr>') +
      '</tbody>' + (foot ? '<tfoot><tr>' + foot.map(function (c, i) { return '<td' + (head[i] && head[i].r ? ' class="r"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr></tfoot>' : '') + '</table>' +
      (note ? '<div class="n">' + esc(note) + '</div>' : '') + '</body></html>';
  }
  var R = function (t) { return { t: t, r: true }; };
  // Avisos heredados de Reportes (ver docs/asistente/PLAN.md). Van al pie del documento donde aplican.
  var KNOWN = { caja: 'Aviso heredado de Reportes: el flujo de caja todavía no separa bien efectivo y pagos digitales.', costo: 'Aviso heredado: registrar una compra no actualiza el costo del producto; el valor al costo puede estar desfasado.' };
  function unavailable(p, what, business) { return { title: p.title, rows: 0, html: docShell(p.title, null, ['Detalle'], [], null, 'No disponible: falta ' + what + ' en este aparato.', business) }; }
  // Los documentos usan los MISMOS cálculos que las pantallas del POS (data.api): así el PDF sale igual que la pantalla al céntimo.
  // El asistente no hace cuentas propias de dinero, solo da formato.
  async function buildDocument(p, data, business) {
    data = data || {}; var api = data.api || {}, prods = data.productos || [], d = p.desde || null, h = p.hasta || p.desde || null;
    // Aparato de empleado: filas armadas por el SERVIDOR (sin costos). No se usan los datos locales del aparato.
    if (p.data) {
      if (p.data.error || !Array.isArray(p.data.filas)) return unavailable(p, 'la lista del servidor', business);
      var er = p.data.filas.map(function (f) { return f.map(function (v, i) { return p.tipo === 'lista_precios' && i === 1 ? soles(num(v)) : v; }); });
      var eh = (p.data.columnas || []).map(function (c, i) { return i ? R(c) : c; });
      return { title: p.title, rows: er.length, html: docShell(p.title, p.tipo === 'lista_pedido' ? 'Lista de pedido para proveedor' : null, eh, er, null,
        (p.tipo === 'lista_pedido' ? 'Cantidad sugerida: hasta el doble del mínimo. Revísala antes de pedir.' : 'Precios de venta de la ficha de cada producto.') + (p.data.truncado ? ' Lista larga: se muestran los primeros productos.' : ''), business) };
    }
    if (p.tipo === 'inventario_valorizado') {
      if (typeof api.valorizacion !== 'function') return unavailable(p, 'el reporte de Valorización', business);
      var rep = api.valorizacion(prods), t = rep.totals || {};
      var rows = (rep.rows || rep.categories || []).map(function (r) { return [r.category || r.key || '-', num(r.products), num(r.units), soles(num(r.costValue)), soles(num(r.saleValue))]; });
      return { title: p.title, rows: rows.length, html: docShell(p.title, 'Mismo cálculo que Valorización de inventario', ['Categoría', R('Productos'), R('Unidades'), R('Valor costo'), R('Valor venta')], rows,
        ['Total', num(t.products), num(t.units), soles(num(t.costValue)), soles(num(t.saleValue))], (t.noCostProducts ? (t.noCostProducts === 1 ? '1 producto sin costo:' : t.noCostProducts + ' productos sin costo:') + ' el valor al costo está incompleto. ' : '') + KNOWN.costo, business) };
    }
    if (p.tipo === 'lista_precios') {
      var lr = prods.slice().sort(function (a, b) { return pname(a).localeCompare(pname(b)); }).map(function (x) { return [pname(x), soles(num(x.precio)), x.precioCaja ? soles(num(x.precioCaja)) : '-']; });
      return { title: p.title, rows: lr.length, html: docShell(p.title, null, ['Producto', R('Precio'), R('Precio caja')], lr, null, 'Precios de la ficha de cada producto.', business) };
    }
    if (p.tipo === 'lista_pedido') {
      // Mismo criterio que el aviso de stock bajo del inventario: stock en o bajo el mínimo. La cantidad sugerida es solo una ayuda.
      var rr = prods.filter(function (x) { return tracks(x) && (num(x.stock) <= 0 || num(x.stock) <= num(x.stockMin)); })
        .sort(function (a, b) { return (num(a.stock) - num(a.stockMin)) - (num(b.stock) - num(b.stockMin)); })
        .map(function (x) { var q = Math.max(1, Math.ceil(num(x.stockMin) * 2 - num(x.stock))), c = num(x.costo); return [pname(x), num(x.stock), num(x.stockMin), q, c > 0 ? soles(c) : '-', c > 0 ? soles(c * q) : '-', c > 0 ? Math.round(c * q * 100) : 0]; });
      // Versión del dueño: con costo de referencia e inversión estimada (la del empleado no los trae).
      var inv = rr.reduce(function (a, r) { return a + r.pop(); }, 0);
      return { title: p.title, rows: rr.length, html: docShell(p.title, 'Lista de pedido para proveedor', ['Producto', R('Stock'), R('Mínimo'), R('Pedir'), R('Costo ref.'), R('Inversión')], rr, ['Total estimado', '', '', '', '', soles(inv / 100)], 'Cantidad sugerida: hasta el doble del mínimo. Revísala antes de pedir. ' + KNOWN.costo, business) };
    }
    if (p.tipo === 'reporte_ventas') {
      if (typeof api.totalV !== 'function') return unavailable(p, 'el cálculo de Ventas', business);
      // Igual que la pantalla Ventas: excluye anuladas (v.anulada) y suma totalV(v).
      var vs = (data.ventas || []).filter(function (v) { return !v.anulada && inRange(v.fecha, d, h); }), byDay = {}, byM = {}, total = 0;
      vs.forEach(function (v) { var f = String(v.fecha).slice(0, 10), tv = num(api.totalV(v)), m = v.metodo || 'otro'; total += tv; byDay[f] = (byDay[f] || 0) + tv; byM[m] = (byM[m] || 0) + tv; });
      var vr = Object.keys(byDay).sort().map(function (k) { return ['Día ' + k, soles(byDay[k])]; }).concat(Object.keys(byM).sort().map(function (k) { return ['Método: ' + k, soles(byM[k])]; }));
      return { title: p.title, rows: vs.length, html: docShell(p.title, (d || 'todas') + (h && h !== d ? ' a ' + h : ''), ['Detalle', R('S/')], vr, ['Total (' + vs.length + ' ventas)', soles(total)], 'Mismo cálculo que la pantalla Ventas (sin anuladas). ' + KNOWN.caja, business) };
    }
    if (p.tipo === 'estado_cuenta') {
      if (typeof api.summarizeClient !== 'function' || typeof api.effectiveBalance !== 'function') return unavailable(p, 'el resumen de créditos', business);
      // (auditoría de privacidad 2026-10-22) el cliente llega por su CÓDIGO (cliente_id) y se busca en la lista de este aparato; una tarjeta
      // vieja con nombre (p.cliente) se sigue buscando por nombre.
      var cli = null;
      if (p.cliente_id != null && p.cliente_id !== '') cli = (data.clientes || []).find(function (c) { return c && String(c.id) === String(p.cliente_id); }) || null;
      else { var words = norm(p.cliente).split(/\s+/).filter(function (w) { return w.length >= 3; });
        cli = words.length ? (data.clientes || []).find(function (c) { var n = norm(c.nombre || c.name); return words.every(function (w) { return n.indexOf(w) >= 0; }); }) : null; }
      if (!cli) return { title: p.title, rows: 0, html: docShell(p.title, 'Cliente no encontrado', ['Detalle'], [], null, 'Pida el estado de cuenta con el nombre del cliente como está en Clientes.', business) };
      // Igual que Deudas de clientes: summarizeClient(cliente, solo lectura) + effectiveBalance (pagos en cola incluidos).
      var sum = api.summarizeClient(cli, true), saldo = num(api.effectiveBalance(sum, api.pending ? api.pending() : null));
      var cr = (sum.active || []).map(function (c) { return [c.desc || c.concepto || c.tipo || 'Crédito', soles(num(c.monto)), soles(num(c.pagado)), soles(num(api.outstanding ? api.outstanding(c) : num(c.monto) - num(c.pagado))), c.vence || '-']; });
      return { title: p.title, rows: cr.length, html: docShell(p.title, (cli.nombre || cli.name) + ' · Doc. ' + maskDoc(cli.dni || cli.documento || cli.document), ['Concepto', R('Monto'), R('Pagado'), R('Pendiente'), 'Vence'], cr,
        ['Saldo (como en Clientes)', '', '', soles(saldo), ''], 'El documento del cliente se muestra oculto. Vencido: ' + soles(num(sum.overdueDebt)) + '.', business) };
    }
    if (p.tipo === 'resumen_cierre') {
      if (typeof api.cashCloses !== 'function') return unavailable(p, 'el reporte de Arqueo', business);
      // Mismo origen y cálculo que «Reporte de arqueo»: GET /auth/cash-closes + NA_REPORTE_ARQUEO.buildReport.
      var ar = await api.cashCloses(d, h), at = ar.report.totals;
      var crow = ar.report.rows.map(function (r) { return [r.fechaLabel + (r.hora ? ' ' + r.hora : ''), r.closedByName, soles(r.esperado / 100), r.contado == null ? 'sin contar' : soles(r.contado / 100), r.diferencia == null ? '-' : soles(r.diferencia / 100)]; });
      return { title: p.title, rows: crow.length, html: docShell(p.title, ar.report.range.desde + ' a ' + ar.report.range.hasta + (ar.fromServer ? ' · servidor' : ' · copia local'), ['Cierre', 'Cerró', R('Esperado'), R('Contado'), R('Diferencia')], crow,
        ['Total (' + at.count + ')', '', soles(at.esperado / 100), soles(at.contado / 100), soles(at.diferencia / 100)], (at.sinContar ? (at.sinContar === 1 ? '1 cierre sin contar no suma. ' : at.sinContar + ' cierres sin contar no suman. ') : '') + KNOWN.caja, business) };
    }
    return unavailable(p, 'ese tipo de documento', business);
  }

  // Ejecutores: usan SOLO funciones existentes del POS, inyectadas (deps) para poder probarlos.
  var EXECUTORS = {
    // destino servidor: ya lo guardó /auth/assistant/confirm; aquí solo se vuelve a leer pos.business, pos.ticket y pos.flags (sin recargar la página)
    configuracion: function (p,d) {
      if (p && p.destino === 'servidor') { var done = { ok: true, msg: 'Guardado para todos los aparatos.' };
        return Promise.resolve(d.reloadSettings ? d.reloadSettings(p) : null).then(function () { return done; }, function () { return done; }); }
      return d.applyConfiguration ? d.applyConfiguration(p) : {ok:false,msg:'No se pudo abrir la configuración. Intenta de nuevo.'}; },
    compra: function (p, d) {
      var w = d.openPurchase();
      if (!w) return { ok: false, msg: 'No se pudo abrir «Nueva compra».' };
      d.fillPurchase(w, p);
      return { ok: true, msg: 'Abrí «Nueva compra» con ' + (p.lineas.length === 1 ? '1 línea' : p.lineas.length + ' líneas') + '. Revisa y pulsa «Registrar compra».' };
    },
    precio: function (p, d) {
      var prod = (d.productos() || []).find(function (x) { return String(x.id) === String(p.product_id); });
      if (!prod) return { ok: false, msg: 'Ese producto ya no está en el inventario.' };
      d.openProductEditor(prod.id, { precio: p.precio_nuevo });
      return { ok: true, msg: 'Abrí la ficha de ' + pname(prod) + ' con el precio nuevo. Pulsa Guardar para aplicarlo.' };
    },
    costo: function (p, d) {
      var prod = (d.productos() || []).find(function (x) { return String(x.id) === String(p.product_id); });
      if (!prod) return { ok: false, msg: 'Ese producto ya no está en el inventario.' };
      d.openProductEditor(prod.id, { costo: p.costo_nuevo });
      return { ok: true, msg: 'Abrí la ficha de ' + pname(prod) + ' con el costo nuevo. Pulsa Guardar para aplicarlo.' };
    },
    ajuste: function (p, d) {
      var prod = (d.productos() || []).find(function (x) { return String(x.id) === String(p.product_id); });
      if (!prod) return { ok: false, msg: 'Ese producto ya no está en el inventario.' };
      var o = d.openStockMove(prod.id, p.tipo, p.cantidad, p.motivo);
      if (o !== true) return { ok: false, msg: typeof o === 'string' && o ? o : 'No se pudo abrir «Registrar movimiento». Ábrelo desde Inventario.' };
      return { ok: true, msg: 'Abrí «Registrar movimiento» de ' + pname(prod) + ' lleno. Revisa y pulsa Guardar.' };
    },
    producto: function (p, d) {
      if (!d.openNewProduct(p)) return { ok: false, msg: 'No se pudo abrir «Nuevo producto».' };
      return { ok: true, msg: 'Abrí «Nuevo producto» lleno. Revisa y pulsa Guardar.' };
    },
    documento: async function (p, d) { var doc = await buildDocument(p, d.data ? d.data() : {}, d.businessName && d.businessName()); d.showDocument(doc.html, p); return { ok: true, msg: 'Documento listo (' + doc.rows + (doc.rows === 1 ? ' fila' : ' filas') + '). No es comprobante SUNAT.' }; },
    consulta: function () { return { ok: true, msg: '' }; },
    pasos: function (p, d) { if (p.pantalla) d.navigate(p.pantalla); return { ok: true, msg: 'Te llevé a la pantalla.' }; }
  };

  // Puerta de confirmación. execute() es asíncrono:
  // 1) exige confirmed:true (solo lo pasa el botón «Confirmar»);
  // 2) revisa el rol en el aparato (segunda barrera);
  // 3) pide al Worker que gaste el token de un solo uso (deps.confirm). El token trae un operation_id
  //    creado UNA vez; si se corta la señal se reenvía el MISMO token y el Worker devuelve el mismo id;
  // 4) recién entonces llama a las funciones existentes del POS. Un doble toque comparte la misma promesa.
  // Pedido con límite de tiempo (solo para el asistente; no cambia NA_ROLES.api del resto del POS).
  // Si no responde en ms, se aborta y lanza un error con timeout=true.
  // (Bot 3 sobre 39ccd25c, 7a) cada intento arma SU propio límite ANTES de llamar a fetch y lo quita solo en finally. Además del temporizador,
  // un reloj revisa el límite cada segundo y al volver la pantalla/la red (visibilitychange, focus, pageshow, online):
  // si el navegador demoró el temporizador largo (pestaña en segundo plano, ahorro de batería), el intento se corta igual al pasar ms.
  // (Bot 3 sobre f773911f) ese reloj es performance.now (monótono: un salto del reloj de pared no corta antes de tiempo); Date.now solo si no hay.
  // Un 2xx cuyo cuerpo no se puede leer como JSON (cortado o roto) vuelve con bodyError:true (data = {} como antes); confirmRemote lo trata
  // como un corte de red (el chat no cambia).
  var REQ_WAKE = ['visibilitychange', 'focus', 'pageshow', 'online'];
  function monoNow() { var pf = root && root.performance; if (!pf || typeof pf.now !== 'function') pf = typeof performance !== 'undefined' ? performance : null;
    return pf && typeof pf.now === 'function' ? pf.now() : Date.now(); }
  async function request(fetchImpl, url, init, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = null, tick = null, timedOut = false, fire = null;
    var t0 = monoNow(), ev = root && typeof root.addEventListener === 'function' && typeof root.removeEventListener === 'function' ? root : null;
    var opts = Object.assign({}, init || {}); if (ctl) opts.signal = ctl.signal;
    var guard = new Promise(function (_, reject) {
      fire = function () { if (timedOut) return; timedOut = true; if (ctl) { try { ctl.abort(); } catch (_) {} } var e = new Error('timeout'); e.timeout = true; reject(e); };
      timer = setTimeout(fire, ms);
      tick = setInterval(function () { if (monoNow() - t0 >= ms) fire(); }, Math.max(50, Math.min(1000, ms)));
    });
    guard.catch(function () {});
    function wake() { if (monoNow() - t0 >= ms) fire(); }
    if (ev) REQ_WAKE.forEach(function (n) { try { ev.addEventListener(n, wake); } catch (_) {} });
    try {
      var r = await Promise.race([fetchImpl(url, opts), guard]);
      var data = {}, bad = false; try { data = await Promise.race([r.json(), guard]); } catch (e) { if (e && e.timeout) throw e; data = {}; bad = true; }
      if (!bad && (data === null || typeof data !== 'object')) bad = true; // «null», «3», «"x"»: tampoco es la respuesta
      var res = { status: r.status, ok: !!r.ok, data: data && typeof data === 'object' ? data : {} }; if (bad) res.bodyError = true;
      return res;
    } catch (e) { if (timedOut || (e && e.name === 'AbortError')) { var t = new Error('timeout'); t.timeout = true; throw t; } throw e; }
    finally { clearTimeout(timer); clearInterval(tick); if (ev) REQ_WAKE.forEach(function (n) { try { ev.removeEventListener(n, wake); } catch (_) {} }); }
  }
  // ---------- Respuesta en partes (chat) ----------
  // Tiempos (Bot 3): primer trozo ~10 s (si no llega nada, «Reintentar»); después, 30 s contados desde el ÚLTIMO trozo, no desde el inicio.
  // Los avisos «status» (el servidor está buscando datos) también cuentan como trozo. Tope total: 90 s por respuesta, pase lo que pase.
  // Foto en 3G lento (Bot 3): el reloj del primer trozo y el tope total suman el tiempo de SUBIR el cuerpo (uploadBps bytes/s, como
  // mucho uploadMaxMs), así los 10 s cuentan desde que la foto terminó de subir y el servidor la leyó, no desde que se tocó Enviar.
  // paintBatch: lo que llega de golpe se pinta en tandas de ~48 caracteres (cortadas en espacio), no en un bloque grande.
  var STREAM = { firstMs: 10000, idleMs: 30000, maxMs: 90000, paintMs: 100, uploadBps: 12000, uploadMaxMs: 120000, paintBatch: 48 };
  function uploadMs(body) { var n = typeof body === 'string' ? body.length : body && typeof body.byteLength === 'number' ? body.byteLength : body && typeof body.size === 'number' ? body.size : 0;
    return Math.min(STREAM.uploadMaxMs, Math.ceil(n / STREAM.uploadBps * 1000)); }
  // Lee «event: x / data: {...}» separados por línea en blanco. Un bloque a medias espera al siguiente trozo; un data roto se ignora.
  function createSseParser(onEvent) {
    var buf = '';
    return { feed: function (chunk) {
      buf = (buf + String(chunk || '')).replace(/\r\n/g, '\n'); var k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        var block = buf.slice(0, k), ev = 'message', data = ''; buf = buf.slice(k + 2);
        block.split('\n').forEach(function (l) { if (l.indexOf('event:') === 0) ev = l.slice(6).trim(); else if (l.indexOf('data:') === 0) data += (data ? '\n' : '') + l.slice(5).replace(/^ /, ''); });
        if (!data) continue; var j; try { j = JSON.parse(data); } catch (e) { continue; } onEvent(ev, j);
      }
    } };
  }
  // Pinta por tandas (cada ~100 ms con requestAnimationFrame), nunca letra por letra. finish() pinta lo que quede, sin perder ni repetir.
  function createTextPainter(write, o) {
    o = o || {}; var min = o.minMs == null ? STREAM.paintMs : o.minMs, now = o.now || function () { return Date.now(); };
    var sched = o.schedule || function (cb, wait) { setTimeout(function () { if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb); else cb(); }, wait); };
    var pending = '', last = -Infinity, armed = false, paints = 0, gen = 0;
    var batch = o.batch == null ? STREAM.paintBatch : o.batch;
    // Una tanda: todo si es poco; si llegó mucho de golpe, ~batch caracteres (o un cuarto, si se va quedando atrás) y el resto después.
    function take(all) { if (all || !batch || pending.length <= batch * 1.5) return pending.length;
      var n = Math.max(batch, Math.ceil(pending.length / 4)), sp = pending.lastIndexOf(' ', n); return sp > batch / 2 ? sp + 1 : n; }
    function flush(g, all) { if (g !== undefined && g !== gen) return; armed = false; if (!pending) return; var n = take(all), t = pending.slice(0, n); pending = pending.slice(n); last = now(); paints++; write(t);
      if (pending && !all) { armed = true; var g2 = gen; sched(function () { flush(g2); }, min); } }
    return {
      push: function (t) { if (!t) return; pending += t; if (armed) return; armed = true; var g = gen; sched(function () { flush(g); }, Math.max(0, min - (now() - last))); },
      finish: function () { flush(undefined, true); },
      reset: function () { gen++; pending = ''; armed = false; },
      paints: function () { return paints; }
    };
  }
  // Respuesta con tablas (Bot 4/3/5): el texto YA viene filtrado por el servidor (costos tapados); aquí solo se le da forma, nunca se agrega nada.
  // Solo createElement + textContent (nunca innerHTML ni texto del modelo en atributos). En partes: cada fila se dibuja al cerrar su línea,
  // el estado se guarda (no se relee el mensaje entero). Una línea que empieza con «|» espera hasta su salto; la cabecera espera además la
  // línea siguiente (si es «|---|» es tabla; si no, vuelve como texto). El resto del texto se pinta enseguida, como antes.
  var MASK_LABEL = '[dato del Admin]', MASK_NOTE = 'Montos ocultos para empleado';
  var CUR_SP_RE = /(S\/\.?|US\$|PEN)[ \t](?=-?\d)/g;
  // (Bot 4 sobre 84a49517 / Bot 2 sobre 58200f60) solo al pintar: la serie de un comprobante («B001-00000123») no se parte en el guion a 360.
  // El guion sigue siendo el ASCII «-» (copiar y pegar da el mismo texto): la serie va entera en un <span class="na-asst-code"> (nowrap por CSS),
  // armado SOLO con createElement + textContent (el texto viene del modelo: nunca innerHTML ni plantillas).
  var DOC_CODE_RE = /\b(?:[FBET][A-Z0-9]{3}|0\d{3})-\d{1,8}\b/g;
  function nbsp(v) { return v.replace(CUR_SP_RE, '$1\u00a0'); }
  function codeSpan(doc, v) { var s = doc.createElement('span'); s.className = 'na-asst-code'; s.textContent = v; return s; }
  // (Bots 3/4 sobre d72b7601, lo acordado) DENTRO de una celda de tabla la serie solo puede bajar de renglón justo después del guion:
  // <span class="na-asst-code na-asst-cc"><span class="na-asst-cs">F001-</span><wbr><span class="na-asst-cn">00012345</span></span>, cada parte
  // nowrap y a 14 px (CSS). Nunca se parte entre dígitos; copiar da «F001-00012345» con el guion ASCII (wbr no agrega texto). Solo
  // createElement/textContent. En la burbuja (texto) y en la nota de la tarjeta la serie sigue entera en una sola span nowrap (codeSpan).
  function cellCodeSpan(doc, v) {
    var k = v.indexOf('-'), s = doc.createElement('span'); s.className = 'na-asst-code na-asst-cc';
    var a = doc.createElement('span'); a.className = 'na-asst-cs'; a.textContent = v.slice(0, k + 1);
    var b = doc.createElement('span'); b.className = 'na-asst-cn'; b.textContent = v.slice(k + 1);
    s.appendChild(a); s.appendChild(doc.createElement('wbr')); s.appendChild(b); return s;
  }
  // Texto ya completo (celdas, tarjetas): trozos de texto + una span por serie (cell: la forma partible tras el guion).
  function appendCoded(doc, parent, v, cell) {
    // (Bot 5 sobre 5646a4c9) sin U+202E/U+2066…: lo que se ve es lo que hay
    v = fmtClean(v); var re = new RegExp(DOC_CODE_RE.source, 'g'), m, at = 0, n = 0;
    while ((m = re.exec(v))) { if (m.index > at) parent.appendChild(doc.createTextNode(v.slice(at, m.index))); parent.appendChild(cell ? cellCodeSpan(doc, m[0]) : codeSpan(doc, m[0])); at = m.index + m[0].length; n++; }
    if (at < v.length) parent.appendChild(doc.createTextNode(v.slice(at)));
    return n;
  }
  var AMOUNT_RE = /(?:S\/\.?|PEN|US\$|\$)\s?-?\d|\d[.,]\d{1,2}(?!\d)|\d\s?%/i; // monto visible en una celda (para la nota)
  var TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$|^\s*\|\s*:?-{3,}:?\s*\|\s*$/;
  function tableCells(line) {
    var t = line.trim(); if (t.charAt(0) === '|') t = t.slice(1); if (t.charAt(t.length - 1) === '|' && t.charAt(t.length - 2) !== '\\') t = t.slice(0, -1);
    var out = [], cur = '';
    for (var i = 0; i < t.length; i++) { var c = t.charAt(i); if (c === '\\' && t.charAt(i + 1) === '|') { cur += '|'; i++; } else if (c === '|') { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur);
    return out.map(function (x) { return x.trim().replace(/^(\*\*|__)(.*)\1$/, '$2'); });
  }
  // (Bots 4/5/3 sobre f773911f) SOLO EN PANTALLA, en el aparato, después del filtro del servidor: las etiquetas de formato escritas como texto
  // (<code> <strong> <b> <em> <i> <u> <mark> <kbd> <pre> y sus cierres, sin atributos) y las vallas ``` (con su lenguaje: «```text⏎») se quitan
  // del texto que se ve; lo de dentro queda como texto plano. Nunca se interpreta HTML: el resultado va por textContent (como el texto escapado
  // por esc(): «&lt;code&gt;» se ve y se quita igual; nada se vuelve etiqueta). El servidor no cambia (sigue tapando igual).
  // En partes solo se espera una etiqueta/valla INCOMPLETA al final (a lo sumo «</strong» o «```» + 15 letras de lenguaje): lo que se ve al final
  // es lo mismo que con el texto entero, se corte donde se corte.
  var STRIP_TAG_RE = /^<\/?(?:code|strong|b|em|i|u|mark|kbd|pre)>/i, STRIP_TAG_NAMES = ['code', 'strong', 'b', 'em', 'i', 'u', 'mark', 'kbd', 'pre'];
  function stripTagPrefix(t) { var m = /^<(\/?)([A-Za-z]*)$/.exec(t); if (!m) return false; var n = m[2].toLowerCase(); return STRIP_TAG_NAMES.some(function (x) { return x.indexOf(n) === 0; }); }
  // (22-10) Markdown simple, también solo en pantalla y con la misma regla de partes: «**» y «__» se quitan (lo de dentro queda), y una línea
  // que empieza con «- » o «* » (con o sin sangría) se ve como «• ». Una «*» o «_» sola queda como está. En partes solo se espera una «*»/«_»
  // al final o el inicio de línea todavía sin decidir (sangría, «-», «*»): lo que se ve al final es igual que con el texto entero.
  function createDisplayStripper() {
    var pend = '', bol = true;
    function run(fin) {
      var out = '', i = 0;
      while (i < pend.length) {
        if (bol) {
          var rb = pend.slice(i), ind = /^[ \t]*/.exec(rb)[0], aft = rb.slice(ind.length);
          if (!fin && aft.length < 2 && /^[-*]?$/.test(aft)) break; // inicio de línea sin decidir: espera
          bol = false;
          if (/^[-*][ \t]/.test(aft)) { out += ind + '\u2022 '; i += ind.length + 2; continue; }
        }
        var c = pend.charAt(i);
        if (c === '\n') { out += c; i++; bol = true; continue; }
        if (c === '*' || c === '_') {
          if (i + 1 >= pend.length && !fin) break; // puede ser «**» / «__»
          if (pend.charAt(i + 1) === c) { i += 2; continue; }
          out += c; i++; continue;
        }
        if (c !== '<' && c !== '`') { var j = i; while (j < pend.length && '<`*_\n'.indexOf(pend.charAt(j)) < 0) j++; out += pend.slice(i, j); i = j; continue; }
        var rest = pend.slice(i);
        if (c === '<') {
          var tm = STRIP_TAG_RE.exec(rest); if (tm) { i += tm[0].length; continue; }
          if (!fin && rest.length <= 8 && stripTagPrefix(rest)) break; // puede ser una etiqueta que sigue en el trozo siguiente
          out += '<'; i++; continue;
        }
        var r = /^`+/.exec(rest)[0];
        if (r.length === rest.length && !fin) break; // la racha de «`» puede seguir
        if (r.length < 3) { out += r; i += r.length; continue; } // `código` suelto: queda como está
        var lang = /^[A-Za-z0-9_+.#-]{0,15}/.exec(rest.slice(r.length))[0], after = r.length + lang.length;
        if (after >= rest.length && !fin && lang.length < 15) break; // ¿sigue el lenguaje o llega el salto?
        if (rest.charAt(after) === '\n') { i += after + 1; bol = true; continue; } // «```text⏎»: la línea de la valla entera
        if (after >= rest.length && lang) { i += after; continue; } // «```text» al final del texto
        i += r.length; // «```perro azul```»: solo las marcas
      }
      pend = pend.slice(i); return out;
    }
    return { push: function (t) { pend += String(t || ''); return run(false); }, flush: function () { var o = run(true); pend = ''; bol = true; return o; } };
  }
  function stripDisplay(t) { var d = createDisplayStripper(); return d.push(t) + d.flush(); }
  // opts.labels (Bot 4/5): cabecera de la tabla de la burbuja ANTERIOR (cortada), tomada de lo que esa burbuja ya pintó (texto filtrado por el
  // servidor), nunca de otros datos. Solo sirve para filas sueltas al inicio de la continuación («sigue»), con el mismo número de columnas.
  function createReplyRenderer(doc, append, opts) {
    var raw = '', line = '', mode = 'start', liveText = null, liveScan = 0, head = null, table = null, tbody = null, labels = null, rows = 0, lastLabels = null, tables = 0;
    var wrap = null, tblEl = null, note = null, nMask = 0, nAmt = 0; // (Bot 4 sobre 25ffde10) montos tapados / visibles de la tabla actual
    var strip = createDisplayStripper();
    var reuse = opts && Array.isArray(opts.labels) && opts.labels.length > 1 ? opts.labels.map(function (x) { return String(x); }) : null;
    // texto suelto: se va sumando al mismo nodo de texto mientras no aparezca una tabla
    // (Bot 4 sobre 25ffde10) solo en pantalla: «S/», «US$», «PEN» y su monto van unidos con un espacio que no se parte (la respuesta no cambia).
    // En partes se arregla solo la cola del nodo (los últimos 6 caracteres + lo nuevo): igual que hacerlo sobre el texto entero.
    // Series en partes: una serie que llega cortada entre trozos queda como texto hasta saber dónde termina (el carácter siguiente o el final);
    // recién ahí se separa en su span. Así una serie nunca se parte en dos spans ni lleva otro guion.
    function codes(fin) {
      if (!liveText) return; var d = liveText.data, re = new RegExp(DOC_CODE_RE.source, 'g'), m; re.lastIndex = Math.max(0, liveScan);
      while ((m = re.exec(d))) { var end = m.index + m[0].length; if (end === d.length && !fin) break; // puede seguir creciendo: espera
        var node = liveText; node.data = d.slice(0, m.index); append(codeSpan(doc, m[0])); liveText = doc.createTextNode(d.slice(end)); append(liveText); d = liveText.data; re.lastIndex = 0; liveScan = 0; }
      liveScan = Math.max(0, d.length - 14); }
    function closeText() { codes(true); liveText = null; liveScan = 0; }
    function text(t) { if (!t) return; if (liveText) { var d = liveText.data, k = Math.max(0, d.length - 6); liveText.data = d.slice(0, k) + nbsp(d.slice(k) + t); } else { liveText = doc.createTextNode(nbsp(t)); liveScan = 0; append(liveText); } codes(false); }
    function cellInto(cellEl, value) { // «[dato del dueño]» en un span que no se parte
      var parts = String(value).split(MASK_LABEL), codes = 0;
      for (var i = 0; i < parts.length; i++) {
        if (parts[i]) codes += appendCoded(doc, cellEl, nbsp(parts[i]), true);
        if (i < parts.length - 1) { var m = doc.createElement('span'); m.className = 'na-asst-mask'; m.textContent = MASK_LABEL; cellEl.appendChild(m); }
      }
      return codes;
    }
    // (Bot 4/3 sobre 25ffde10) la tabla se crea con su PRIMERA fila: una cabecera seguida de un párrafo ya no deja una tabla vacía en pantalla.
    // Sin etiquetas (filas sueltas sin cabecera) no lleva thead.
    function startTable(hdrLine) {
      closeText(); labels = Array.isArray(hdrLine) ? hdrLine.slice() : tableCells(hdrLine); rows = 0; lastLabels = labels.slice(); tables++;
      table = true; wrap = tblEl = tbody = note = null; nMask = 0; nAmt = 0;
    }
    function buildTable() {
      closeText(); wrap = doc.createElement('div'); wrap.className = 'na-asst-tbl'; tblEl = doc.createElement('table');
      if (labels.some(function (h) { return h !== ''; })) { var thead = doc.createElement('thead'), tr = doc.createElement('tr');
        labels.forEach(function (h) { var th = doc.createElement('th'); th.setAttribute('scope', 'col'); cellInto(th, h); tr.appendChild(th); }); thead.appendChild(tr); tblEl.appendChild(thead); }
      tbody = doc.createElement('tbody'); tblEl.appendChild(tbody); wrap.appendChild(tblEl); append(wrap);
    }
    // (Bot 4 sobre 25ffde10) una fila con OTRA cantidad de columnas (la tabla del dueño sigue abierta en el servidor hasta el final) se dibuja
    // igual como fila: faltan celdas, quedan vacías; sobran, se juntan en la última con « · ». Nunca texto con «|».
    // Si TODOS los montos de la tabla están tapados: las máscaras se ven cortas («•••», por CSS; el texto sigue siendo «[dato del dueño]»)
    // y va UNA nota bajo la tabla («Montos ocultos para empleado»). Si aparece un monto visible, vuelve a la vista normal.
    function fitCells(cells) { var n = labels.length; if (n < 2 || cells.length <= n) return cells; var c = cells.slice(0, n - 1); c.push(cells.slice(n - 1).filter(function (x) { return x !== ''; }).join(' · ')); return c; }
    function countCell(v) { v = String(v); if (v.indexOf(MASK_LABEL) >= 0) nMask++; if (AMOUNT_RE.test(v.split(MASK_LABEL).join(' '))) nAmt++; }
    function updateNote() { if (!wrap) return; var all = nMask > 0 && nAmt === 0;
      if (all && !note) { note = doc.createElement('div'); note.textContent = MASK_NOTE; if (wrap.parentNode && wrap.parentNode.insertBefore) wrap.parentNode.insertBefore(note, wrap.nextSibling || null); else append(note); }
      if (note) note.className = all ? 'na-asst-tnote' : 'na-asst-tnote na-asst-off'; // se apaga (no se borra) si aparece un monto visible
      tblEl.className = all ? 'na-asst-allmask' : ''; }
    function addRow(l) {
      if (!tbody) buildTable();
      var cells = fitCells(tableCells(l)), tr = doc.createElement('tr'), n = Math.max(cells.length, labels.length);
      for (var i = 0; i < n; i++) { countCell(cells[i] == null ? '' : cells[i]);
        var td = doc.createElement('td');
        if (labels[i]) { var lab = doc.createElement('span'); lab.className = 'na-asst-tl'; lab.setAttribute('aria-hidden', 'true'); lab.textContent = labels[i]; td.appendChild(lab); }
        var v = doc.createElement('span'); v.className = 'na-asst-tv'; if (cellInto(v, cells[i] == null ? '' : cells[i])) v.className = 'na-asst-tv na-asst-tvc'; td.appendChild(v); tr.appendChild(td);
      }
      tbody.appendChild(tr); rows++; updateNote();
    }
    function endTable() { table = tbody = labels = null; if (note) closeText(); wrap = tblEl = note = null; }
    function isPipe(l) { return /^\s*\|/.test(l); }
    // fila suelta al inicio de la continuación: usa la cabecera anterior (solo antes de la primera tabla de esta burbuja y si cuadran las columnas).
    // (Bot 4 sobre a6d1d76e) Fila suelta DESPUÉS de una tabla de esta burbuja (p. ej. tras un párrafo: el servidor la sigue tratando como de esa
    // tabla): se dibuja como fila con la cabecera ya pintada (texto filtrado), si cuadran las columnas; nunca como texto con «|».
    // (Bot 4 sobre 25ffde10) también con otra cantidad de columnas (fitCells): el servidor ya tapó sus montos.
    function reused(h) { var lab = tables ? lastLabels : reuse; if (!lab || TABLE_SEP_RE.test(h) || tableCells(h).length < 2) return false; startTable(lab); addRow(h); return true; }
    // una línea COMPLETA (con su salto, si lo tiene)
    function full(l, nl) {
      if (table) { if (isPipe(l) && !TABLE_SEP_RE.test(l)) { addRow(l); return; } if (isPipe(l)) return; endTable(); }
      if (head != null) { var h = head; head = null; if (TABLE_SEP_RE.test(l)) { startTable(h); return; } if (reused(h)) return full(l, nl);
        // (Bot 4 sobre 25ffde10) 2+ filas seguidas sin cabecera con las mismas columnas: tabla sin etiquetas (tarjetas a 480), nunca texto con «|»
        var hc = tableCells(h).length; if (hc >= 2 && isPipe(l) && !TABLE_SEP_RE.test(l) && tableCells(l).length === hc) { startTable(tableCells(h).map(function () { return ''; })); addRow(h); addRow(l); return; }
        text(h + '\n'); }
      if (isPipe(l) && nl) { head = l; return; } // ¿cabecera? espera la línea siguiente
      text(l + (nl ? '\n' : ''));
    }
    var api = {
      push: function (t) { t = String(t || ''); if (!t) return; raw += t; api.pushShown(strip.push(t)); },
      pushShown: function (t) { // texto ya sin etiquetas/vallas (ver createDisplayStripper)
        if (!t) return; var i = 0;
        while (i < t.length) {
          var k = t.indexOf('\n', i);
          if (k < 0) { // trozo de línea sin salto
            var piece = t.slice(i);
            if (mode === 'text') { text(piece); line = ''; break; } // ya se sabe que es texto: sale enseguida
            line += piece; var fc = (/\S/.exec(line) || [''])[0];
            // espera solo si puede ser fila («|») o la línea «---|---» que sigue a una cabecera; si no, es texto y sale ya
            if (fc && fc !== '|' && !(head != null && (fc === '-' || fc === ':'))) {
              if (table) endTable(); if (head != null) { var h0 = head; head = null; if (reused(h0)) endTable(); else text(h0 + '\n'); }
              mode = 'text'; text(line); line = '';
            }
            break;
          }
          var l = (mode === 'text' ? '' : line) + t.slice(i, k);
          if (mode === 'text') text(t.slice(i, k) + '\n'); else full(l, true);
          line = ''; mode = 'start'; i = k + 1;
        }
      },
      finish: function () { var tl = strip.flush(); if (tl) api.pushShown(tl); if (line) { if (head != null || table) full(line, false); else if (!(isPipe(line) && reused(line))) text(line); line = ''; } if (head != null) { var h = head; head = null; if (!reused(h)) text(h); } endTable(); closeText(); mode = 'start'; },
      raw: function () { return raw; },
      labels: function () { return lastLabels ? lastLabels.slice() : null; }, // cabecera de la última tabla pintada (para la continuación)
      rows: function () { return rows; }
    };
    return api;
  }
  // Pide el chat en partes. Si el navegador o el servidor no lo soportan, vuelve el JSON de siempre (kind:'json').
  // Resultado en partes: { kind:'stream', final, error, cut, timeout:'first'|'idle'|'max'|null, text } — las tarjetas SOLO salen de final.
  async function streamChat(fetchImpl, url, init, o) {
    o = o || {}; var up = uploadMs(init && init.body), firstMs = (o.firstMs || STREAM.firstMs) + up, idleMs = o.idleMs || STREAM.idleMs, maxMs = (o.maxMs || STREAM.maxMs) + up;
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = null, timedOut = null, text = '', reader = null, giveUp = null, capTimer = null;
    var opts = Object.assign({}, init || {}); if (ctl) opts.signal = ctl.signal;
    var res = { kind: 'stream', final: null, error: null, cut: false, timeout: null, text: '' };
    function stop(kind) { if (timedOut) return; timedOut = kind; if (ctl) ctl.abort(); if (giveUp) giveUp(new Error('timeout')); if (reader) { try { reader.cancel().catch(function () {}); } catch (e) { /* ya cortado */ } } }
    function arm(ms, kind) { clearTimeout(timer); timer = setTimeout(function () { stop(kind); }, ms); }
    function clear() { clearTimeout(timer); clearTimeout(capTimer); }
    arm(firstMs, 'first');
    // Tope duro: a los 90 s se corta aunque sigan llegando trozos o avisos; lo recibido queda como «Respuesta incompleta».
    capTimer = setTimeout(function () { stop('max'); }, maxMs);
    var r;
    // Aunque el fetch no respete la señal, a los firstMs se deja de esperar.
    try { r = await Promise.race([fetchImpl(url, opts), new Promise(function (_, rej) { giveUp = rej; })]); giveUp = null; }
    catch (e) { clear(); var t = new Error(timedOut ? 'timeout' : 'network'); t.timeout = !!timedOut; t.stage = timedOut; throw t; }
    var ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '');
    if (!/text\/event-stream/.test(ct) || !r.body || typeof r.body.getReader !== 'function') {
      // Respuesta JSON (puertas de rol, foto, cupo… o servidor sin partes): el tiempo sigue corriendo hasta tener el cuerpo.
      try { var data = await r.json(); clear(); return { kind: 'json', status: r.status, ok: !!r.ok, data: data || {} }; }
      catch (e2) { clear(); if (timedOut) { var t2 = new Error('timeout'); t2.timeout = true; t2.stage = timedOut; throw t2; } return { kind: 'json', status: r.status, ok: !!r.ok, data: {} }; }
    }
    reader = r.body.getReader(); var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
    var parser = createSseParser(function (ev, d) {
      if (ev === 'text') { if (d.reset) { text = ''; if (o.onReset) o.onReset(); } else if (typeof d.t === 'string') { text += d.t; if (o.onText) o.onText(d.t); } }
      else if (ev === 'status') { if (o.onStatus) o.onStatus(d); } // «buscando en su inventario»: sin texto, solo aviso
      else if (ev === 'final') res.final = d; else if (ev === 'error') res.error = d;
    });
    // Cada trozo (incluido el «open» que el servidor manda enseguida y los «status») vuelve a armar el reloj: 30 s desde el último.
    if (timedOut) { clear(); res.cut = true; res.timeout = timedOut; res.text = text; return res; }
    try {
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        if (timedOut) break; // tope de 90 s: lo que llegue después ya no se pinta
        arm(idleMs, 'idle');
        parser.feed(dec ? dec.decode(step.value, { stream: true }) : String(step.value));
      }
      if (dec) parser.feed(dec.decode());
    } catch (e3) { /* corte de red o tiempo agotado: queda lo recibido */ }
    clear();
    if (timedOut) res.timeout = timedOut;
    res.cut = !res.final && !res.error; res.text = text;
    return res;
  }
  var TIMEOUTS = { chat: 30000, confirm: 12000, approval: 15000 };
  // Errores en palabras simples (pedido del dueño): la persona NUNCA ve un código (403, 409, 429, 503, assistant_off, forbidden_document…).
  // Cada código conocido tiene su frase; uno desconocido o «HTTP_xxx» cae en la frase general. retry=true: se muestra «Reintentar».
  var CONFIG_CONFLICT_MSG = 'Otro aparato cambió la Configuración mientras tanto. Pide la tarjeta de nuevo.',
    CONFIG_LOST_MSG = 'Esta sesión ya no tiene permiso para cambiar la Configuración. Pídeselo al Admin.';
  var MSG = {
    owner: 'Eso solo lo puede hacer el Admin.',
    offline: 'Sin conexión. Toca «Reintentar» cuando vuelva el internet.',
    wait: 'Espera un momento e intenta de nuevo.',
    slow: 'Está tardando mucho. Toca «Reintentar».',
    again: 'No se pudo completar. Toca «Reintentar».',
    expired: 'Esta propuesta venció. Pídela otra vez.',
    changed: 'La propuesta cambió. Pídela otra vez.'
  };
  var FRIENDLY = {
    forbidden_role: [MSG.owner], admin_only: [MSG.owner], image_owner_only: [MSG.owner], owner_approval_required: [MSG.owner], forbidden: [MSG.owner], HTTP_403: [MSG.owner],
    assistant_off: ['El asistente está apagado en este aparato.'], unauthorized: ['Este aparato no tiene sesión. Entra de nuevo al sistema.'], HTTP_401: ['Este aparato no tiene sesión. Entra de nuevo al sistema.'],
    forbidden_document: ['Ese documento es solo para el Admin. Puedes pedir la lista de precios o la lista de pedido.'],
    query_admin_only: ['Esa consulta es solo para el Admin.'],
    review_admin_only: ['La revisión del punto de venta es solo para el Admin.'],
    query_admin_only: ['Esa consulta es solo para el Admin.'],
    below_cost_admin_only: ['Las alertas de venta bajo costo son solo para el Admin.'],
    summary_admin_only: ['Los resúmenes del día y del mes son solo para el Admin.'],
    boleta_admin_only: ['Leer boletas con IA es solo para el Admin.'],
    producto_foto_admin_only: ['La foto de producto es solo para el Admin.'],
    boleta_unreadable: ['No pude leer esa boleta. Tome la foto de frente, con buena luz y sin mover.'],
    boleta_timeout: ['La lectura tardó más de 90 s. Pruebe con una foto más nítida o recortada.'],
    rate_limited: [MSG.wait, true], HTTP_429: [MSG.wait, true], upstream_busy: [MSG.wait, true],
    daily_limit: ['Por hoy ya no quedan preguntas en este aparato. Mañana sigue.'], monthly_cap: ['El asistente llegó a su tope del mes. Avisa al Admin.'],
    network: [MSG.offline, true], offline: [MSG.offline, true], timeout: [MSG.slow, true], upstream_timeout: [MSG.slow, true],
    upstream_error: [MSG.again, true], stock_check_unavailable: ['No pude revisar el inventario ahora. Toca «Reintentar» en un momento.', true], HTTP_503: [MSG.again, true], HTTP_502: [MSG.again, true], HTTP_500: [MSG.again, true],
    confirm_expired: [MSG.expired], HTTP_410: [MSG.expired], proposal_changed: [MSG.changed], proposal_id_mismatch: [MSG.changed], HTTP_409: [MSG.changed],
    product_missing: ['Ese producto ya no está en el inventario.'], sin_control_stock: ['Ese producto no lleva control de stock.'],
    review_required: ['Revisa este dato en las filas marcadas y vuelve a confirmar.'], fields_required: ['Complete los datos marcados y vuelva a confirmar.'], manual_not_allowed: ['Esa tarjeta no se puede cambiar así. Toque «Pedir de nuevo».'], over_limit: ['Fuera del límite: corrige la factura o quita la fila.'],
    empty_after_review: ['Quitaste todas las filas. Pide la compra de nuevo.'], other_device: ['Esta propuesta es de otro aparato. Pídela aquí otra vez.'],
    image_unsupported: ['Leer fotos no está disponible por ahora.'], assistant_not_configured: ['El asistente no está disponible por ahora.'],
    image_too_large: ['La foto es muy grande. Toma otra más cerca.'], bad_image: ['No pude leer esa foto. Toma otra con más luz.'],
    not_found: ['El asistente no está disponible por ahora.'], HTTP_404: ['El asistente no está disponible por ahora.'], bad_request: [MSG.again, true], bad_token: [MSG.changed],
    // (Bots 3/4/5 sobre d72b7601) 409 already_confirmed = OTRA sesión dueño (el mismo aparato y sesión recibe already_confirmed_same_session);
    // «otro aparato» solo con 403 other_device (+ confirmed)
    already_confirmed: ['Esta compra ya se confirmó en otra sesión.'],
    // (#967 teléfono) Configuración con destino servidor
    revision_conflict: [CONFIG_CONFLICT_MSG], config_sin_datos: ['Ese ajuste todavía no está guardado en el servidor. Ábrelo una vez en Configuración.'],
    config_invalid: ['Ese valor no es válido. Pide la tarjeta de nuevo.'], config_forbidden: [CONFIG_LOST_MSG], save_failed: [MSG.again, true]
  };
  var NO_LINK_MSG = 'Sin conexión. Toca Reintentar', RECONNECT_MSG = 'Reconectando…', SAME_SESSION_MSG = 'Esta compra ya se confirmó. Corrige los datos en Nueva compra.', OTHER_DEVICE_DONE_MSG = 'Ya se confirmó en otro aparato.';
  // ¿El texto trae algo que parece código? (palabra_con_guion_bajo, «HTTP», «error 403», «Error:»). Entonces no se muestra tal cual.
  function looksTechnical(t) { return /[a-z0-9]+_[a-z0-9_]+|\berror\b|HTTP|\b(error|status|code)\b\s*:?\s*\d{3}\b|^\s*[45]\d\d\b|undefined|null|NaN|Exception|TypeError/i.test(String(t || '')); }
  function friendlyError(code, serverMsg) {
    var f = FRIENDLY[code];
    if (!f && /^HTTP_5/.test(String(code))) f = [MSG.again, true];
    if (!f && /^HTTP_4/.test(String(code))) f = [MSG.again, true];
    // Los motivos que ya vienen en palabras del servidor (tope, inventario) se usan solo si no traen nada técnico.
    var msg = serverMsg && typeof serverMsg === 'string' && !looksTechnical(serverMsg) ? serverMsg : (f ? f[0] : MSG.again);
    return { msg: msg, retry: !!(f ? f[1] : true) };
  }
  // Reintentos AUTOMÁTICOS de red al confirmar: tope fijo (1 envío + 1 reintento). Después decide la persona con «Volver a intentar».
  // Reenviar es seguro: mismo token y operation_id; si el servidor ya lo guardó responde already_confirmed y no se repite.
  var CONFIRM_ATTEMPTS = 2;
  // Qué muestra la tarjeta cuando confirm no pasa. Una tarjeta NUNCA queda trabada con «Confirmar»:
  //  - 422 review_required: filas en rojo «Revisa este dato»; se reenvía la MISMA tarjeta (un toque, sin PIN).
  //  - 429: «Espera un momento y vuelve a intentar» + «Volver a intentar» (misma tarjeta).
  //  - Siempre: «Pedir de nuevo» = propuesta NUEVA (token y operation_id nuevos).
  // (Bot 4 sobre 58200f60) opts.editable: campos que esta tarjeta deja escribir; opts.type: tipo de tarjeta. Un 422 sin nada que se pueda
  // arreglar en la tarjeta (un campo que no es de la tarjeta, o fuera del límite sin filas para quitar) → kind 'blocked': aviso claro y solo «Cancelar».
  var BLOCKED_MSG = { compra: 'No se puede confirmar esta compra desde el asistente. Ábrala en Nueva compra.' };
  function confirmFailureView(r, opts) {
    if (!r || r.ok) return null;
    var code = r.code || (r.retry ? 'network' : 'error'), editable = opts && Array.isArray(opts.editable) ? opts.editable : ['proveedor', 'documento'], type = (opts && opts.type) || 'compra';
    var blocked = function (msg) { return { kind: 'blocked', rows: [], fields: [], button: null, again: false, cancelOnly: true, msg: msg || BLOCKED_MSG[type] || 'No se puede confirmar este cambio desde el asistente. Hágalo desde su pantalla.' }; };
    if (code === 'review_required') return { kind: 'review', rows: (r.rows || []).filter(function (n) { return Number.isInteger(n) && n >= 0; }), button: 'Confirmar', again: true, msg: 'Revisa este dato en las filas marcadas y vuelve a confirmar.' };
    if (code === 'fields_required') { var fl = (Array.isArray(r.fields) ? r.fields : []).filter(function (n) { return typeof n === 'string' && n.length <= 40; });
      var own = fl.every(function (n) { return editable.indexOf(n) >= 0; }); if (!fl.length || !own) return blocked();
      // Configuración (RUC): el aviso del servidor («El RUC debe tener 11 dígitos»…) se muestra tal cual si viene en palabras
      return { kind: 'fields', rows: [], fields: fl, button: 'Confirmar', again: true, msg: type === 'configuracion' && r.msg && !looksTechnical(r.msg) ? r.msg : 'Complete los datos marcados y vuelva a confirmar.' }; }
    if (code === 'over_limit' && !(r.rows || []).some(function (n) { return Number.isInteger(n) && n >= 0; })) return blocked(type === 'compra' ? null : (r.msg && !looksTechnical(r.msg) ? r.msg : null));
    if (code === 'over_limit') return { kind: 'limit', rows: (r.rows || []).filter(function (n) { return Number.isInteger(n) && n >= 0; }), button: 'Confirmar', again: true, msg: r.msg || 'Fuera del límite: corrige la factura o quita la fila.' };
    if (code === 'revision_conflict' || code === 'config_sin_datos' || code === 'config_invalid' || code === 'config_forbidden') return { kind: 'config', rows: [], button: null, again: true, msg: r.msg || friendlyError(code).msg };
    if (code === 'already_confirmed') return { kind: 'elsewhere', rows: [], button: 'Confirmar', again: true, msg: r.msg && !looksTechnical(r.msg) ? r.msg : FRIENDLY.already_confirmed[0] };
    if (code === 'rate_limited' || code === 'HTTP_429') return { kind: 'wait', rows: [], button: 'Reintentar', again: true, msg: MSG.wait };
    if (code === 'other_device') return { kind: 'elsewhere', rows: [], button: null, again: true, msg: r.msg || FRIENDLY.other_device[0] };
    if (code === 'network' && r.locked) return { kind: 'network', locked: true, rows: [], button: 'Reintentar', again: false, msg: NO_LINK_MSG };
    if (code === 'network') return { kind: 'network', rows: [], button: 'Reintentar', again: true, msg: r.msg && !looksTechnical(r.msg) ? r.msg : friendlyError('network').msg };
    return { kind: 'other', rows: [], button: 'Confirmar', again: true, msg: r.msg && !looksTechnical(r.msg) ? r.msg : friendlyError(code).msg };
  }

  // Preparar una ficha desde una fila de compra nunca recibe las unidades compradas
  // como stock inicial. Se revisa el catálogo ACTUAL antes de abrir Nuevo producto.
  function purchaseProductDraft(line, products) {
    var key = function (v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
    var name = String(line && line.nombre || '').trim();
    if (!name || maskLeft(name)) return null;
    var hits = (products || []).filter(function (p) { return key(p.nombre || p.name) === key(name); });
    if (hits.length > 1) return { ambiguous: true };
    if (hits.length === 1) return { product_id: String(hits[0].id), nombre: hits[0].nombre || hits[0].name };
    var cost = line.costo_unitario;
    return { nombre: name, precio: null, costo: cost != null && Number.isFinite(Number(cost)) && Number(cost) >= 0 ? Number(cost) : null, stock_inicial: 0 };
  }

  // Contexto chico (~2 KB): primero los productos que coinciden con lo escrito, después el resto hasta el tope.
  function capContext(ctx, maxBytes, maxItems) {
    var out = [], size = 40;
    for (var i = 0; i < ctx.products.length && out.length < (maxItems || 25); i++) {
      var n = JSON.stringify(ctx.products[i]).length + 1; if (size + n > (maxBytes || 2000)) break; out.push(ctx.products[i]); size += n;
    }
    return { screen: ctx.screen, products: out };
  }

  // Mismo criterio que el POS (Inicio/Kardex): sin control = controlInventario/trackStock/track_stock/tracks_inventory en falso, o servicio.
  function tracksStock(p) {
    if (!p) return false;
    if (p.controlInventario === false || p.trackStock === false || p.track_stock === false || p.tracks_inventory === false || p.tracks_inventory === 0) return false;
    return ![p.tipo, p.type, p.unidad, p.cat].some(function (v) { return /^(servicio|service)$/i.test(String(v || '')); });
  }
  // Revisión ANTES de enviar y de gastar la tarjeta: si el POS no puede abrir la pantalla, se dice por qué y no se gasta nada.
  var PRECHECK = {
    ajuste: function (p, d) {
      var prod = (d.productos() || []).find(function (x) { return String(x.id) === String(p.product_id); });
      if (!prod) return 'Ese producto ya no está en el inventario.';
      if (!tracksStock(prod)) return '«' + pname(prod) + '» no lleva control de stock, así que no se puede registrar un movimiento. Si debe llevarlo, actívalo en su ficha.';
      var why = d.stockMoveReady ? d.stockMoveReady(prod.id) : null;
      return why || null;
    },
    compra: function (p, d) {
      var list = d.productos() || [], bad = [];
      (p.lineas || []).forEach(function (l) { if (!l.product_id) return; var prod = list.find(function (x) { return String(x.id) === String(l.product_id); }); if (prod && !tracksStock(prod)) bad.push(pname(prod)); });
      return bad.length ? 'No controlan inventario: ' + bad.map(function (n) { return '«' + n + '»'; }).join(', ') + '. Quítalos de la compra o pide la compra de nuevo.' : null;
    }
  };
  function precheck(p, d) { var f = PRECHECK[p && p.type]; try { return f ? f(p, d) : null; } catch (_) { return 'No se pudo revisar la tarjeta en este aparato.'; } }
  var ROLE_LOST_MSG = 'Esta sesión ya no es de Admin. Vuelva a entrar como Admin y pida la compra de nuevo.';
  // borra lo escrito a mano (sin dejar copia) y suelta la propuesta
  function wipeManual(p) { var m = p && p._manual; if (m && typeof m === 'object') Object.keys(m).forEach(function (k) { m[k] = ''; delete m[k]; }); if (p) { try { delete p._manual; } catch (_) {} } }
  var CARD_TIPOS = ['configuracion', 'compra', 'precio', 'costo', 'ajuste', 'producto'];
  // Total de cada fila (cantidad × costo unitario) y total de la compra, en céntimos para no arrastrar decimales. Fila sin costo: sin total.
  function purchaseTotals(p) {
    var rows = [], cents = 0, sinCosto = 0;
    ((p && p.lineas) || []).forEach(function (l) {
      var q = Number(l && l.cantidad), c = l && l.costo_unitario != null ? Number(l.costo_unitario) : NaN;
      if (!isFinite(q) || q <= 0 || !isFinite(c) || c < 0) { rows.push(null); sinCosto++; return; }
      var t = Math.round(q * c * 100); rows.push(t / 100); cents += t;
    });
    return { filas: rows, total: Math.round(cents) / 100, sinCosto: sinCosto };
  }
  function createGate(deps) {
    var items = Object.create(null);
    function forget(it) { if (!it) return; wipeManual(it.p); wipeManual(it.applied); if (it.sent && it.sent.manual && typeof it.sent.manual === 'object') Object.keys(it.sent.manual).forEach(function (k) { delete it.sent.manual[k]; }); delete items[it.key]; it.state = 'forgotten'; it.p = null; it.applied = null; it.review = null; it.sent = null; it.onRetry = null; }
    async function run(it) {
      var perm = canExecute(deps.roles(), it.p);
      if (!perm.ok) { it.state = 'denied'; return perm; }
      if (it.p.needsConfirm && deps.online && !deps.online()) { it.state = 'pending'; return { ok: false, msg: 'Asistente no disponible sin internet.' }; }
      if (it.p.needsConfirm) {
        var pre = precheck(it.p, deps); if (pre) { it.state = 'pending'; return { ok: false, code: 'precheck', msg: pre }; }
        if (!it.p.confirm_token) { it.state = 'denied'; return { ok: false, msg: 'Esta propuesta no se puede confirmar. Pídela otra vez.' }; }
        var c;
        // sin respuesta (corte o tiempo): la tarjeta sigue editable; confirmar no crea registros, así que reintentar es seguro (Bot 3)
        // (Bots 3/4/5 sobre d72b7601) sin respuesta: NO se invita a editar. La puerta guarda el cuerpo EXACTO que se mandó (it.sent) y «Reintentar»
        // reenvía ese mismo cuerpo; los campos siguen bloqueados (locked) hasta un 200 o un 4xx real. Un 5xx también deja el cuerpo guardado.
        try { c = await deps.confirm(it.p, it.review || null, { body: it.sent || null, onRetry: it.onRetry || null }); }
        catch (e) { it.state = 'pending'; if (e && e.sentBody) it.sent = e.sentBody; return { ok: false, retry: true, locked: true, code: 'network', msg: NO_LINK_MSG }; }
        if (c && !c.ok && Number(c.status) >= 500) { it.state = 'pending'; if (c.sentBody) it.sent = c.sentBody; return { ok: false, retry: true, locked: true, code: 'network', msg: NO_LINK_MSG }; }
        var sentNow = (c && c.sentBody) || it.sent || null; it.sent = null; // 200 o 4xx real: se puede volver a editar
        // MISMO aparato y MISMA sesión dueño, otro «manual»: el servidor devuelve la propuesta firmada (sin lo escrito); «Nueva compra» se abre
        // con ella + lo que este celular mandó, y la nota «Esta compra ya se confirmó. Corrige los datos en Nueva compra.»
        if (c && !c.ok && c.error === 'already_confirmed_same_session') {
          if (!c.proposal || c.proposal.id !== it.p.id || c.proposal.type !== it.p.type) { it.state = 'denied'; return { ok: false, code: 'already_confirmed_same_session', msg: SAME_SESSION_MSG }; }
          it.operationId = c.operation_id; it.applied = c.proposal;
          var km = sentNow && sentNow.manual && typeof sentNow.manual === 'object' ? sentNow.manual : null;
          if (km) { try { Object.defineProperty(it.applied, '_manual', { value: km, enumerable: false, configurable: true }); } catch (_) {} }
          if (it.executed) { it.state = 'done'; return { ok: true, code: 'already_confirmed_same_session', msg: SAME_SESSION_MSG }; }
          try { var rs = await EXECUTORS[it.p.type](it.applied, deps, it.operationId); if (rs.ok) it.executed = true; it.state = rs.ok ? 'done' : 'denied';
            return rs.ok ? { ok: true, code: 'already_confirmed_same_session', msg: SAME_SESSION_MSG } : rs; }
          catch (e2) { it.state = 'denied'; return { ok: false, code: 'already_confirmed_same_session', msg: SAME_SESSION_MSG }; }
        }
        // (Bots 3/5 sobre 58200f60) 409 already_confirmed: la tarjeta la usó otra sesión (u otros datos). Nota corta, sin error crudo ni propuesta.
        // (Bots 4/5 sobre 58200f60) 403 forbidden_role al confirmar: manda el rol del SERVIDOR (no se mira el rol guardado en el aparato).
        // La propuesta y lo escrito a mano salen de la memoria del celular (la tarjeta sale de la pantalla en la UI); sin reintento automático.
        if (c && !c.ok && c.error === 'forbidden_role') { var lostMsg = it.p.type === 'configuracion' ? CONFIG_LOST_MSG : ROLE_LOST_MSG; forget(it); return { ok: false, code: 'forbidden_role', dropped: true, msg: lostMsg }; }
        // (#967 teléfono) Configuración del servidor que no se puede guardar así (otro aparato la cambió, fila que no existe, valor inválido):
        // la tarjeta NO queda aplicada ni se puede reenviar igual; se pide de nuevo. Se vuelve a leer la del servidor. El RUC escrito que el
        // servidor rechaza (fields_required / ruc_invalid…) sigue editable con el aviso del servidor.
        if (c && !c.ok && isRucCard(it.p) && needNames(it.p).length && c.error !== 'manual_not_allowed' && c.status >= 400 && c.status < 500 && c.status !== 409 && c.status !== 403 && c.status !== 429 && c.status !== 410) {
          it.state = 'pending'; var rf = needNames(it.p); // un solo campo en la tarjeta: el aviso va a ese campo aunque el servidor lo nombre distinto
          return { ok: false, code: 'fields_required', fields: rf, msg: c.message && !looksTechnical(c.message) ? c.message : 'Escribe los 11 dígitos del RUC y vuelve a confirmar.' }; }
        if (c && !c.ok && isServerConfig(it.p) && ['revision_conflict', 'config_sin_datos', 'config_invalid', 'config_forbidden'].indexOf(c.error) >= 0) {
          it.state = 'denied'; if (c.error === 'revision_conflict' && deps.reloadSettings) { try { Promise.resolve(deps.reloadSettings(it.p)).catch(function () {}); } catch (_) {} }
          return { ok: false, code: c.error, msg: c.error === 'revision_conflict' ? CONFIG_CONFLICT_MSG : friendlyError(c.error, c.message).msg }; }
        if (c && !c.ok && c.error === 'already_confirmed') { it.state = 'denied'; return { ok: false, code: 'already_confirmed', msg: it.p.type === 'compra' ? FRIENDLY.already_confirmed[0] : 'Este cambio ya se confirmó en otra sesión.' }; }
        if (c && !c.ok && c.error === 'other_device') { it.state = 'denied'; return { ok: false, code: 'other_device', msg: c.confirmed ? OTHER_DEVICE_DONE_MSG : FRIENDLY.other_device[0] }; }
        if (!c || !c.ok) { it.state = (c && (c.error === 'confirm_expired' || c.error === 'forbidden_role' || c.error === 'admin_only' || c.error === 'proposal_changed' || c.error === 'sin_control_stock')) ? 'denied' : 'pending';
          return { ok: false, code: (c && c.error) || 'error', rows: c && Array.isArray(c.rows) ? c.rows : null, fields: c && Array.isArray(c.fields) ? c.fields : null, retry_after_s: c && c.retry_after_s || null, msg: friendlyError((c && c.error) || 'error', c && ['over_limit', 'sin_control_stock', 'stock_check_unavailable', 'product_missing'].indexOf(c.error) >= 0 ? c.message : null).msg }; }
        it.operationId = c.operation_id;
        // Se aplica la propuesta que el servidor verificó para ESTE token, nunca otra que esté en memoria.
        if (c.proposal) { if (c.proposal.id !== it.p.id || c.proposal.type !== it.p.type) { it.state = 'denied'; return { ok: false, msg: 'La propuesta no coincide. Pídela otra vez.' }; } it.applied = c.proposal;
          // (Bot 4 sobre 84a49517) lo escrito a mano sigue con la propuesta que devolvió el servidor: «Nueva compra» abre con Proveedor/Documento
          // (Bot 5 sobre 3ee80c18, INFO) lo que ENTRA a «Nueva compra» es lo que se MANDÓ (sentNow.manual, el cuerpo guardado), no lo que haya en vivo
          // en los campos (bloqueados, pero se podrían forzar por consola). Sin cuerpo guardado (puerta sin confirmRemote), lo escrito como antes.
          var km2 = sentNow ? (sentNow.manual && typeof sentNow.manual === 'object' ? sentNow.manual : null) : (it.p._manual || null);
          if (km2 && it.applied && typeof it.applied === 'object') { try { Object.defineProperty(it.applied, '_manual', { value: km2, enumerable: false, configurable: true }); } catch (_) {} } }
        if (c.already_confirmed && it.executed) { it.state = 'done'; return { ok: true, msg: 'Ya se hizo. No se repitió.' }; }
      }
      if (it.executed) { it.state = 'done'; return { ok: true, msg: 'Ya se hizo. No se repitió.' }; }
      try {
        var r = await EXECUTORS[it.p.type](it.applied || it.p, deps, it.operationId);
        if (r.ok) it.executed = true;
        if (r.ok && isRucCard(it.p)) { wipeManual(it.p); wipeManual(it.applied); } // el RUC escrito no queda en la memoria del teléfono
        it.state = r.ok ? 'done' : 'pending'; return r;
      } catch (e) { it.state = 'pending'; return { ok: false, msg: 'No se pudo completar. Inténtalo otra vez.' }; }
    }
    return {
      // Cada tarjeta tiene su propia entrada (clave = id firmado por el servidor). Si llegara un id repetido con OTRO token,
      // se le da una clave nueva: nunca se reutiliza la propuesta de otra tarjeta.
      add: function (p) {
        if (!p || !p.id) return null;
        var key = String(p.id), n = 1;
        while (items[key] && items[key].p.confirm_token !== p.confirm_token) key = p.id + '#' + (++n);
        if (!items[key]) items[key] = { p: p, key: key, state: 'pending', executed: false, operationId: null, inflight: null, applied: null, review: null };
        return key;
      },
      proposal: function (key) { return items[key] ? items[key].p : null; },
      state: function (id) { return items[id] ? items[id].state : null; },
      operationId: function (id) { return items[id] ? items[id].operationId : null; },
      cancel: function (id, why) { if (items[id] && items[id].state === 'pending') { items[id].state = 'cancelled'; items[id].why = why === 'vencida' ? 'vencida' : null; } },
      // (fix/asist-compras-borrador) estado de las tarjetas que viaja con el próximo mensaje: solo tipo y estado. Así el asistente sabe que
      // una compra cancelada o vencida ya no existe y no la vuelve a dar por pendiente. Las olvidadas (forget) ya no están.
      summary: function () {
        var map = { pending: 'pendiente', running: 'pendiente', done: 'confirmada', denied: 'no_permitida' }, out = [];
        Object.keys(items).forEach(function (k) { var it = items[k]; if (!it || !it.p || !it.p.needsConfirm || out.length >= 10) return;
          if (CARD_TIPOS.indexOf(it.p.type) < 0) return;
          out.push({ tipo: it.p.type, estado: it.state === 'cancelled' ? (it.why === 'vencida' ? 'vencida' : 'cancelada') : (map[it.state] || 'cancelada') }); });
        return out;
      },
      forget: function (id) { forget(items[id]); },
      // (Bots 3/4/5 sobre d72b7601) ¿hay un cuerpo guardado tras un corte? (los campos siguen bloqueados y «Reintentar» lo reenvía igual)
      locked: function (id) { return !!(items[id] && items[id].sent); },
      // (Bot 5 sobre d72b7601) 403 forbidden_role: TODAS las propuestas (y lo escrito a mano) salen de la memoria, no solo la del 403
      forgetAll: function () { Object.keys(items).forEach(function (k) { forget(items[k]); }); },
      size: function () { return Object.keys(items).length; },
      execute: function (id, opts) {
        var it = items[id];
        if (!it) return Promise.resolve({ ok: false, msg: 'Propuesta no encontrada.' });
        if (!opts || opts.confirmed !== true) return Promise.resolve({ ok: false, msg: 'Falta confirmar.' });
        if (it.inflight) return it.inflight;
        if (it.state === 'done') return Promise.resolve({ ok: true, msg: 'Ya se hizo. No se repitió.' });
        if (it.state !== 'pending') return Promise.resolve({ ok: false, msg: it.state === 'cancelled' ? 'Se canceló.' : 'No permitido.' });
        if (opts.review && !it.sent) it.review = opts.review; // con un cuerpo guardado (corte) se reenvía ese, igual
        it.onRetry = typeof opts.onRetry === 'function' ? opts.onRetry : null;
        it.state = 'running';
        it.inflight = run(it).finally(function () { it.inflight = null; });
        return it.inflight;
      }
    };
  }

  // Relleno bajo la burbuja (cuenta pura, sin DOM): cuántos px taparía la burbuja a la última opción con todo desplazado abajo.
  // limit = borde de arriba de la burbuja - 12. Contenedor interno: visBottom (su borde visible de abajo) y rest (lo que le queda por desplazar).
  // Documento: vh, sy (desplazado), sh (alto total) y collapse (lo que la cabecera del POS todavía puede achicarse al desplazar).
  // Lo de debajo de la fila (sh - sy - rowBottom) no cambia al desplazar; si lo que sobra para desplazar es menor que lo que se achica
  // la cabecera, la página rebota arriba: entonces debe sobrar collapse + 24 px.
  function padOverlap(o) {
    if (o.sc) { if (o.sc.visBottom <= o.limit) return 0; return Math.max(0, o.rowBottom - o.sc.rest - o.limit); }
    var tail = o.sh - o.sy - o.rowBottom, over = (o.vh - o.limit) - tail, C = Math.max(0, o.collapse || 0);
    if (o.rowBottom + o.sy > o.limit && o.sh - o.vh < C + 24) over = Math.max(over, C + 24 - (o.sh - o.vh));
    return Math.max(0, over);
  }

  // ---------- Clientes en el mensaje (auditoría de privacidad 2026-10-22) ----------
  // Antes de mandar el mensaje del chat, los nombres de clientes que este aparato YA conoce (lista de Clientes del POS) se cambian por
  // «cliente #código» y sus direcciones por «[dirección oculta]». El nombre nunca sale del aparato: la respuesta se pinta con el nombre
  // buscado aquí (linkCustomers). Coincide sin tildes ni mayúsculas y solo palabras enteras: el nombre COMPLETO, dos palabras seguidas de un
  // nombre de 3+ palabras («Rosa Quispe» de «Rosa Quispe Mamani») y también un nombre o apellido SUELTO («Juan», «Pérez» de «Juan Pérez»;
  // regla de privacidad: el nombre de un cliente nunca llega a la IA). Excepciones (pedido del jefe 22-10: «Distribuidora San Juan» salía
  // «Distribuidora cliente #c4»): nunca dentro del nombre de un producto o proveedor que este aparato conoce (lista de productos, su
  // campo proveedor y los proveedores de los movimientos de compra), y tampoco en
  // contexto de empresa («Distribuidora …», «Comercial …», «proveedor …», «… S.A.C.»; para la palabra suelta también con palabras en
  // mayúscula en medio: «Distribuidora San Juan», «San Juan S.A.C.»). Si varios clientes comparten el nombre, se mandan sus códigos (hasta 3)
  // o «un cliente».
  var CLI_CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var NAME_STOP = { de: 1, del: 1, la: 1, las: 1, los: 1, el: 1, y: 1, e: 1, san: 1, santa: 1, sr: 1, sra: 1, don: 1, dona: 1 };
  // palabras de clientes genéricos («Cliente Varios», «Público General», «SIN DOC»): sueltas no son un nombre y no se tapan
  var SINGLE_STOP = { cliente: 1, clientes: 1, varios: 1, varias: 1, general: 1, publico: 1, consumidor: 1, final: 1, sin: 1, doc: 1, documento: 1, nombre: 1, otro: 1, otros: 1, casa: 1, tienda: 1 };
  // formas comunes que coinciden con el plural/diminutivo de un nombre y no se tapan (comida, cosas, moneda)
  var INFLECT_STOP = { juanes: 1, flores: 1, luces: 1, cruces: 1, soles: 1, mares: 1, reyes: 1, santos: 1, angeles: 1, leones: 1, palomas: 1, palomitas: 1, pascuas: 1, rocios: 1, angelitos: 1, reinas: 1 };
  // plural y diminutivo simples de una palabra de nombre (4+ letras, sin números): rosa -> rosas, rosita(s); juan -> juanes, juancito(s);
  // perez -> perezes/pereces; pilar -> pilares. Los nombres que ya terminan en s (Marcos) no cambian.
  function nameForms(w) {
    if (!w || w.length < 4 || /\d/.test(w) || /s$/.test(w)) return [];
    var out = [], last = w.slice(-1);
    if (/[aeiou]/.test(last)) { out.push(w + 's'); if (/[ao]/.test(last)) { var st = w.slice(0, -1), d = last === 'a' ? 'ita' : 'ito'; out.push(st + d, st + d + 's'); } }
    else { out.push(w + 'es'); if (last === 'z') out.push(w.slice(0, -1) + 'ces'); if (/[nr]/.test(last)) out.push(w + 'cito', w + 'cita', w + 'citos', w + 'citas'); }
    return out;
  }
  function foldCh(ch) { return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function foldStr(v) { return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function nameTokens(v) { return foldStr(v).split(/[^a-z0-9ñ]+/).filter(Boolean); }
  function customerRef(c) {
    var id = c && c.id != null ? String(c.id) : '', r = 'cliente #' + id;
    if (!CLI_CODE_RE.test(id) || id === String(c.dni || '') || id === String(c.tel || c.telefono || '')) return null;
    return redactText(r) === r ? r : null; // un código que el redactor taparía (8 dígitos…) no sirve: «un cliente»
  }
  var ADDRESS_RE = /\b(?:av(?:da|enida)?|jr|jir[oó]n|calle|psje|pje|pasaje|prol(?:ongaci[oó]n)?|mz|manzana|urb(?:anizaci[oó]n)?|asoc(?:iaci[oó]n)?|aa\.?\s?hh)\.?\s+(?:[A-Za-zÁÉÍÓÚÑáéíóúñü.'°ºª-]+\s+){0,5}?(?:n[°ºo]?\.?\s*)?\d{1,5}[A-Za-z]?\b(?:\s*,?\s*(?:mz|lt|lote|int|dpto|of)\.?\s*[A-Za-z0-9]{1,4}\b)*/gi;
  // Palabras de empresa JUSTO antes o después: «Distribuidora San Juan», «Comercial Rosa Quispe», «San Juan S.A.C.» son proveedores o
  // negocios, no clientes. Con algo en medio («la bodega de Rosa Quispe», «farmacia y Rosa Quispe») el nombre se tapa igual.
  var BIZ_WORDS = 'distribuidora|distribuciones|distribuidor|comercial|comercializadora|corporacion|corp|inversiones|importadora|importaciones|botica|boticas|farmacia|farmacias|drogueria|laboratorio|laboratorios|bodega|minimarket|market|supermercado|almacen|negociaciones|grupo|proveedor|proveedora|proveedores|industrias|representaciones|multiservicios|agroveterinaria|veterinaria|libreria|ferreteria|panificadora|panaderia|transportes';
  var BIZ_BEFORE_RE = new RegExp('(?:^|[^a-z0-9ñ])(?:' + BIZ_WORDS + ')[^a-z0-9ñ]{1,3}$'), BIZ_WORD = {}; BIZ_WORDS.split('|').forEach(function (w) { BIZ_WORD[w] = 1; });
  var BIZ_AFTER_RE = /^[^a-z0-9ñ]{0,3}(?:s[^a-z0-9ñ]?a[^a-z0-9ñ]?c|s[^a-z0-9ñ]?a[^a-z0-9ñ]?a|e[^a-z0-9ñ]?i[^a-z0-9ñ]?r[^a-z0-9ñ]?l|s[^a-z0-9ñ]?r[^a-z0-9ñ]?l|s[^a-z0-9ñ]?a|sociedad|hermanos|hnos|e hijos|import|export)(?![a-z0-9ñ])/;
  function bizName(f, a, b) { return BIZ_BEFORE_RE.test(f.slice(Math.max(0, a - 40), a)) || BIZ_AFTER_RE.test(f.slice(b, b + 24)); }
  // Palabra suelta: contexto de empresa también con hasta 3 palabras en Mayúscula (o «de/san…») en medio: «Distribuidora San Juan» -> «Juan»,
  // «San Juan S.A.C.» -> «San». «el proveedor me dijo que Juan…» SÍ se tapa (en medio hay palabras en minúscula).
  function bizWide(f, src, map, a, b) {
    if (bizName(f, a, b)) return true;
    var isW = function (ch) { return /[a-z0-9ñ]/.test(ch || ''); }, cap = function (x) { var ch = src[map[x]]; return !!ch && ch !== ch.toLowerCase(); };
    var pos = a, k, n, e, w;
    for (k = 0; k < 4; k++) { n = 0; while (pos > 0 && !isW(f[pos - 1]) && n < 3) { pos--; n++; } if (!n || pos === 0) break; e = pos; while (pos > 0 && isW(f[pos - 1])) pos--;
      w = f.slice(pos, e); if (BIZ_WORD[w]) return true; if (!cap(pos) && !NAME_STOP[w]) break; }
    pos = b;
    for (k = 0; k < 4; k++) { if (BIZ_AFTER_RE.test(f.slice(pos, pos + 24))) return true; n = 0; while (pos < f.length && !isW(f[pos]) && n < 3) { pos++; n++; } if (!n || pos >= f.length) break;
      e = pos; while (pos < f.length && isW(f[pos])) pos++; w = f.slice(e, pos); if (!cap(e) && !NAME_STOP[w]) break; }
    return false;
  }
  function maskCustomers(text, clientes, productos, proveedores) {
    var src = String(text == null ? '' : text).normalize('NFC'), codes = [];
    var list = Array.isArray(clientes) ? clientes.slice(0, 5000) : [];
    if (!src) return { text: src, codes: codes };
    // texto plegado con mapa de posiciones (una tilde de más o de menos no rompe el mapa)
    var f = '', map = [];
    for (var i = 0; i < src.length; i++) { var fc = foldCh(src[i]); for (var k = 0; k < fc.length; k++) { f += fc[k]; map.push(i); } }
    map.push(src.length);
    // pares de palabras seguidas de un producto/proveedor («leche gloria» de «Leche Gloria 400g»): una palabra suelta junto a su pareja no se tapa
    var prodPairs = {}, pairsOf = function (pt) { for (var q = 0; q + 1 < pt.length; q++) prodPairs[pt[q] + ' ' + pt[q + 1]] = 1; };
    var prodWords = {}, prodNames = {}; (Array.isArray(productos) ? productos.slice(0, 5000) : []).forEach(function (p) { var pt = nameTokens(p && (p.nombre || p.name)); pt.forEach(function (w) { prodWords[w] = 1; }); pairsOf(pt);
      if (pt.length > 1 || (pt.length === 1 && pt[0].length >= 4)) prodNames[pt.join(' ')] = 1; });
    // proveedores que el aparato conoce (lista + campo proveedor de cada producto): su nombre queda reservado como el de un producto
    (Array.isArray(proveedores) ? proveedores.slice(0, 2000) : []).concat((Array.isArray(productos) ? productos.slice(0, 5000) : []).map(function (p) { return p && (p.proveedor || p.supplier); }))
      .forEach(function (v) { var st = nameTokens(typeof v === 'string' ? v : v && (v.nombre || v.name)); pairsOf(st); if (st.length > 1 || (st.length === 1 && st[0].length >= 4)) prodNames[st.join(' ')] = 1; });
    var phrases = {}; // frase plegada -> { refs, addr }
    function add1(ph, ref, addr, single) { if (!ph) return; var o = phrases[ph] || (phrases[ph] = { refs: [], addr: !!addr, single: !!single }); if (!single) o.single = false; if (ref !== undefined && o.refs.indexOf(ref) < 0) o.refs.push(ref); }
    // (auditoría 500, CLI-030: «hay dos rosas» llegó al modelo) también el plural y el diminutivo de la ÚLTIMA palabra del nombre; nunca
    // si esa forma es una palabra de producto/proveedor o una palabra común («juanes», «flores», «luces», «soles»…)
    function add(ph, ref, addr, single) { add1(ph, ref, addr, single); if (!ph || addr) return;
      var cut = ph.lastIndexOf(' '), head = ph.slice(0, cut + 1); nameForms(ph.slice(cut + 1)).forEach(function (v) { if (!prodWords[v] && !INFLECT_STOP[v]) add1(head + v, ref, false, single); }); }
    function inPair(a, b) { var w = f.slice(a, b), pm = /([a-z0-9ñ]+)[^a-z0-9ñ]{1,3}$/.exec(f.slice(Math.max(0, a - 40), a)), nm = /^[^a-z0-9ñ]{1,3}([a-z0-9ñ]+)/.exec(f.slice(b, b + 40));
      return !!((pm && prodPairs[pm[1] + ' ' + w]) || (nm && prodPairs[w + ' ' + nm[1]])); }
    list.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var ref = customerRef(c), t = nameTokens(c.nombre || c.name);
      if (t.length) {
        var full = t.join(' '); if (full.replace(/ /g, '').length >= 4 && !(t.length === 1 && prodWords[full])) add(full, ref);
        // nombre de 3+ palabras: también dos palabras SEGUIDAS de ese nombre («Rosa Quispe», «Quispe Mamani»), sin «de/san…» ni palabras de producto
        if (t.length >= 3) for (var j = 0; j + 1 < t.length; j++) { var w1 = t[j], w2 = t[j + 1];
          if (!NAME_STOP[w1] && !NAME_STOP[w2] && !(prodWords[w1] && prodWords[w2]) && (w1 + w2).length >= 6) add(w1 + ' ' + w2, ref); }
        // nombre o apellido SUELTO: se tapa salvo «de/san…», 1-2 letras o números (dentro de un producto/proveedor ya está reservado arriba)
        if (t.length >= 2) t.forEach(function (w) { if (!NAME_STOP[w] && !SINGLE_STOP[w] && w.length >= 3 && !/^\d+$/.test(w)) add(w, ref, false, true); });
      }
      var dir = nameTokens(c.dir || c.direccion || c.address); if (dir.length && dir.join('').length >= 6) add(dir.join(' '), undefined, true);
    });
    var keys = Object.keys(phrases).filter(function (ph) { return f.indexOf(ph.split(' ')[0]) >= 0; }).sort(function (a, b) { return b.length - a.length; });
    var taken = new Array(f.length).fill(0), hits = [];
    function phraseRe(ph) { return new RegExp('(?<![a-z0-9ñ])' + ph.split(' ').map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('[^a-z0-9ñ]{1,3}') + '(?![a-z0-9ñ])', 'g'); }
    // 0) CÓDIGOS (prueba en CANON 22-10: «cliente SIN-DOC-MISAEL» salía «cliente #SIN-DOC-un cliente»): nunca se tapa dentro de «#código»,
    // de un código en MAYÚSCULAS/números con guion o guion bajo («SIN-DOC-MISAEL», «CLI_0042») ni de un código de cliente de la lista
    var ids = {}; list.forEach(function (c) { if (c && c.id != null && String(c.id).length >= 2) ids[String(c.id).toLowerCase()] = 1; });
    var codeRe = /#[A-Za-z0-9_-]+|[A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+(?:[-_][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]+)+/g, cm;
    while ((cm = codeRe.exec(src))) { var cw = cm[0], ca = cm.index, cb = ca + cw.length;
      if (cw[0] === '#' || ids[cw.toLowerCase()] || /\d/.test(cw) || cw === cw.toUpperCase()) for (var fx = 0; fx < f.length; fx++) if (map[fx] >= ca && map[fx] < cb) taken[fx] = 2; }
    ids = null;
    // 1) nombres de producto que están en el texto: ese tramo queda reservado (un cliente nunca se tapa dentro de un producto)
    Object.keys(prodNames).filter(function (ph) { return f.indexOf(ph.split(' ')[0]) >= 0; }).sort(function (a, b) { return b.length - a.length; }).forEach(function (ph) {
      var re = phraseRe(ph), m; while ((m = re.exec(f))) { for (var x = m.index; x < m.index + m[0].length; x++) taken[x] = 2; } });
    // 2) nombre COMPLETO del cliente (y direcciones), el más largo primero; no si es el nombre de una empresa («Distribuidora San Juan»)
    keys.forEach(function (ph) {
      var re = phraseRe(ph), m;
      while ((m = re.exec(f))) { var a = m.index, b = a + m[0].length, free = true; for (var x = a; x < b; x++) if (taken[x]) { free = false; break; }
        if (!free || (!phrases[ph].addr && (phrases[ph].single ? (bizWide(f, src, map, a, b) || inPair(a, b)) : bizName(f, a, b)))) continue; for (x = a; x < b; x++) taken[x] = 1; hits.push([a, b, phrases[ph]]); }
    });
    hits.sort(function (p, q) { return p[0] - q[0]; });
    var out = '', last = 0;
    hits.forEach(function (h) {
      var o = h[2], refs = o.refs.filter(Boolean), rep;
      if (o.addr) rep = '[dirección oculta]';
      else if (o.refs.length === 1 && refs.length === 1) rep = refs[0];
      else if (refs.length === o.refs.length && refs.length <= 3) rep = refs.join(' o ');
      else rep = 'un cliente';
      refs.forEach(function (r) { var id = r.slice(9); if (codes.indexOf(id) < 0 && rep.indexOf(r) >= 0) codes.push(id); });
      out += src.slice(last, map[h[0]]) + rep; last = map[h[1]];
    });
    out += src.slice(last);
    return { text: out.replace(ADDRESS_RE, '[dirección oculta]'), codes: codes };
  }
  // códigos «cliente #…» de una respuesta que existen en la lista local (para pintarlos con su nombre)
  function customerCodesIn(text, clientes) {
    var have = {}; (Array.isArray(clientes) ? clientes : []).forEach(function (c) { if (c && c.id != null) have[String(c.id)] = 1; });
    var out = [], re = /cliente #([A-Za-z0-9_-]{1,40})/g, m; 
    while ((m = re.exec(String(text == null ? '' : text)))) if (have[m[1]] && out.indexOf(m[1]) < 0) out.push(m[1]);
    return out;
  }

  // ---------- «Revisión del punto de venta»: tamaño del envío (2026-10-22) ----------
  // Con las listas llenas (200 errores, 200 lentos, 300 contadores) el envío pasaba el tope del servidor (96 KB) y se rechazaba (413).
  // Se manda lo más importante dentro de REVIEW_BUDGET (bien debajo del tope): errores por veces y lo más reciente, lentos por cuelgue y
  // tiempo total, contadores por veces; textos cortos. Si aún no entra, cada lista se recorta a la mitad (se quedan los primeros).
  var REVIEW_BUDGET = 64 * 1024, REVIEW_CAPS = { errors: 120, slow: 100, usage: 200, msg: 120, src: 80, name: 80, cli: 40, accion: 30 };
  function jsonBytes(o) { var js = JSON.stringify(o); try { return new TextEncoder().encode(js).length; } catch (_) { return js.length * 3; } }
  function revCut(v, n) { return v == null ? v : String(v).slice(0, n); }
  function compactReview(data, budget) {
    budget = budget || REVIEW_BUDGET; var d = data && typeof data === 'object' ? data : {};
    var errs = (Array.isArray(d.errors) ? d.errors.slice() : []).filter(function (x) { return x && typeof x === 'object'; })
      .sort(function (a, b) { return (Number(b.count) || 0) - (Number(a.count) || 0) || String(b.last || '').localeCompare(String(a.last || '')); })
      .slice(0, REVIEW_CAPS.errors).map(function (x) { var o = { kind: x.kind, msg: revCut(x.msg, REVIEW_CAPS.msg), src: revCut(x.src, REVIEW_CAPS.src), status: x.status, count: x.count, first: x.first, last: x.last };
        if (x.cli != null) { o.cli = revCut(x.cli, REVIEW_CAPS.cli); o.accion = revCut(x.accion, REVIEW_CAPS.accion); } return o; });
    var slow = (Array.isArray(d.slow) ? d.slow.slice() : []).filter(function (x) { return x && typeof x === 'object'; })
      .sort(function (a, b) { return (b.kind === 'cuelgue') - (a.kind === 'cuelgue') || (Number(b.count) || 0) * (Number(b.ms_avg) || 0) - (Number(a.count) || 0) * (Number(a.ms_avg) || 0); })
      .slice(0, REVIEW_CAPS.slow).map(function (x) { var o = { kind: x.kind, name: revCut(x.name, REVIEW_CAPS.name), count: x.count, ms_avg: x.ms_avg, ms_max: x.ms_max, last: x.last };
        if (x.cli != null) { o.cli = revCut(x.cli, REVIEW_CAPS.cli); o.accion = revCut(x.accion, REVIEW_CAPS.accion); } return o; });
    var u = d.usage && typeof d.usage === 'object' && !Array.isArray(d.usage) ? d.usage : {};
    var keys = Object.keys(u).filter(function (k) { return k.length <= 120; }).sort(function (a, b) { return (Number(u[b]) || 0) - (Number(u[a]) || 0) || (a < b ? -1 : 1); });
    var out = { errors: errs, usage: {}, slow: slow, ocr: d.ocr || null }, kept = keys.slice(0, REVIEW_CAPS.usage);
    function fill() { out.usage = {}; kept.forEach(function (k) { out.usage[k] = u[k]; }); }
    fill();
    for (var guard = 0; guard < 20 && jsonBytes(out) > budget; guard++) {
      var se = jsonBytes(out.errors), ss = jsonBytes(out.slow), su = jsonBytes(out.usage);
      if (se >= ss && se >= su && out.errors.length) out.errors = out.errors.slice(0, Math.floor(out.errors.length / 2));
      else if (ss >= su && out.slow.length) out.slow = out.slow.slice(0, Math.floor(out.slow.length / 2));
      else if (kept.length) { kept = kept.slice(0, Math.floor(kept.length / 2)); fill(); }
      else break;
    }
    return out;
  }

  // ---------- Memoria de la charla en el aparato (contrato de #946) ----------
  // El celular guarda la charla SOLO en memoria (nunca localStorage/sessionStorage) hasta «Nueva conversación», un cambio de rol o recargar.
  // Lo que se manda: los turnos más nuevos que entran en memoria.max_bytes del servidor (menos un margen) y en max_turnos (40). Las notas de
  // foto («[Foto leída] …», solo Admin) quedan fijas. Lo que ya no entra:
  // - Admin: se pasa a un resumen corto armado aquí (mismo formato que el servidor) que va en «resumen» (el servidor acepta su texto suelto).
  // - Empleado: su resumen debe venir FIRMADO por el servidor; se mandan hasta 2 pares viejos de más para que el servidor los recorte y
  //   devuelva resumen_sugerido firmado; al llegar, esos pares se quitan de aquí. Cuerpo del empleado: bajo 64 KB (tope del servidor).
  // Servidor viejo (sin «memoria» en la respuesta): como antes, los últimos 8 turnos.
  var MEMORY = Object.freeze({ maxTurns: 40, defaultBytes: 24000, ownerBytes: 48000, margin: 1024, spillPairs: 2, employeeBodyCap: 60000, oldTurns: 8,
    pinnedMax: 3, notaPrefix: '[Foto leída]', notaTurnPrefix: '[nota]', resumenChars: 2000, resumenLineChars: 160, notaChars: 400, resumenMaxAgeMs: 24 * 60 * 60 * 1000,
    notice: 'Resumí la charla para seguir más rápido', fallbackName: 'Nuevo Amanecer' });
  function utf8Len(v) { var s = String(v == null ? '' : v); if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s + '').length;
    var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c < 0xdc00) ? (i++, 4) : 3; } return n; }
  // Nombre del negocio: el de Configuración (appConfig.business.nombre); sin él, «Nuevo Amanecer». Nunca «Botica» fijo.
  function businessName(cfg) { var n = cfg && cfg.business && typeof cfg.business.nombre === 'string' ? cfg.business.nombre.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    return n ? n.slice(0, 80) : MEMORY.fallbackName; }
  function memNew() { return { resumen: null, maxBytes: null, maxTurns: null, legacy: false, notified: false }; }
  function isPinned(pair) { var c = pair && pair[0] && typeof pair[0].content === 'string' ? pair[0].content : ''; return c.indexOf(MEMORY.notaPrefix) >= 0 || c.indexOf(MEMORY.notaTurnPrefix) === 0; }
  // pares (usuario, asistente) en orden; un turno suelto (no debería haber) se descarta
  function memPairs(history) { var h = Array.isArray(history) ? history : [], out = [];
    for (var i = 0; i + 1 < h.length; i += 2) { if (h[i] && h[i].role === 'user' && h[i + 1] && h[i + 1].role === 'assistant') out.push([h[i], h[i + 1]]); else { i -= 1; } }
    return out; }
  function pairBytes(p) { return utf8Len(p[0].content) + utf8Len(p[1].content); }
  function wireTurn(m) { var o = { role: m.role, content: String(m.content == null ? '' : m.content) };
    if (typeof m.sig === 'string') o.sig = m.sig; if (typeof m.n === 'number') o.n = m.n; if (typeof m.iat === 'number') o.iat = m.iat; if (m.cut === true) o.cut = true; return o; }
  // par del empleado que el servidor acepta: firmado, mismo sig/n/iat en los dos turnos y con menos de 24 h (hora del servidor)
  function employeePairOk(p, now) { var a = p[0], b = p[1]; return typeof a.sig === 'string' && a.sig === b.sig && typeof a.n === 'number' && a.n === b.n && typeof a.iat === 'number' && a.iat === b.iat &&
    (now == null || now - a.iat < MEMORY.resumenMaxAgeMs - 5 * 60 * 1000); }
  function clip(t, max) { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > max ? t.slice(0, max - 1) + '…' : t; }
  // resumen del Admin (mismo formato que buildResumen del servidor): lo anterior + una línea corta por turno; notas de foto enteras
  function memFold(prev, pairs) {
    var lines = prev ? String(prev).split('\n').filter(Boolean) : [];
    pairs.forEach(function (p) { p.forEach(function (m) { var c = redactOwnerContext(String(m.content || '')).replace(/\s+/g, ' ').trim(); if (!c) return;
      var note = c.indexOf(MEMORY.notaPrefix) >= 0 || c.indexOf(MEMORY.notaTurnPrefix) === 0;
      lines.push((m.role === 'assistant' ? 'Asistente: ' : 'Persona: ') + clip(c, note ? MEMORY.notaChars : MEMORY.resumenLineChars)); }); });
    while (lines.length > 1 && lines.join('\n').length > MEMORY.resumenChars) lines.shift();
    var out = lines.join('\n'); return out.length > MEMORY.resumenChars ? out.slice(out.length - MEMORY.resumenChars) : out;
  }
  function resumenText(r) { return r && typeof r === 'object' ? String(r.texto || '') : typeof r === 'string' ? r : ''; }
  // Arma history/resumen del pedido. Puede QUITAR de «history» (en el sitio) lo que ya pasó al resumen del Admin o lo que el servidor ya no
  // acepta (pares del empleado sin firma o de más de 24 h). Devuelve { history, resumen, folded } (folded: turnos que pasaron al resumen aquí).
  // opts: { role, now (hora del servidor), bodyBase (cuerpo sin history/resumen, para medir el del empleado) }
  function memRequest(history, mem, opts) {
    opts = opts || {}; mem = mem || memNew();
    var owner = opts.role === 'owner', now = typeof opts.now === 'number' ? opts.now : null, h = Array.isArray(history) ? history : [];
    if (mem.legacy) { var lt = h.slice(-MEMORY.oldTurns); return { history: lt.map(wireTurn), refs: lt.slice(), resumen: null, folded: 0 }; }
    var pairs = memPairs(h);
    if (!owner) pairs = pairs.filter(function (p) { return employeePairOk(p, now); });
    // resumen del empleado: solo firmado y de menos de 24 h; si no, se suelta
    if (!owner && mem.resumen && !(typeof mem.resumen === 'object' && mem.resumen.sig && typeof mem.resumen.iat === 'number' && (now == null || now - mem.resumen.iat < MEMORY.resumenMaxAgeMs - 5 * 60 * 1000))) mem.resumen = null;
    var maxBytes = Math.max(2048, (typeof mem.maxBytes === 'number' && mem.maxBytes > 0 ? mem.maxBytes : MEMORY.defaultBytes) - MEMORY.margin);
    var maxTurns = Math.min(MEMORY.maxTurns, typeof mem.maxTurns === 'number' && mem.maxTurns > 0 ? mem.maxTurns : MEMORY.maxTurns);
    var spillTurns = owner ? 0 : MEMORY.spillPairs * 2;
    var keep = [], bytes = 0, turns = 0, i;
    // 1) notas de foto (Admin): las más nuevas, hasta pinnedMax y la mitad del tope
    if (owner) { var pinned = 0; for (i = pairs.length - 1; i >= 0; i--) { if (!isPinned(pairs[i]) || pinned >= MEMORY.pinnedMax) continue; var pb = pairBytes(pairs[i]);
      if (bytes + pb > maxBytes / 2 || turns + 2 > maxTurns) continue; keep.push(pairs[i]); bytes += pb; turns += 2; pinned++; } }
    // 2) lo más nuevo que entra
    var stop = false;
    for (i = pairs.length - 1; i >= 0; i--) { if (keep.indexOf(pairs[i]) >= 0) continue; var b = pairBytes(pairs[i]);
      if (stop || bytes + b > maxBytes || turns + 2 > maxTurns - spillTurns) { stop = true; continue; } keep.push(pairs[i]); bytes += b; turns += 2; }
    var out = pairs.filter(function (p) { return keep.indexOf(p) >= 0; }), rest = pairs.filter(function (p) { return keep.indexOf(p) < 0; }), folded = 0;
    if (owner && rest.length) { mem.resumen = memFold(resumenText(mem.resumen), rest); folded = rest.length * 2; }
    // empleado: los 2 pares MÁS NUEVOS de los que no entran van primero (pegados a lo demás); el servidor los recorta y los resume firmado.
    // Lo más viejo que eso ya no se puede mandar (el servidor no acepta un resumen sin su firma): sale.
    if (!owner && rest.length) out = rest.slice(-MEMORY.spillPairs).concat(out);
    h.length = 0; pairs.forEach(function (p) { if (out.indexOf(p) >= 0) h.push(p[0], p[1]); });
    var refs = [], wire = [], res = mem.resumen && resumenText(mem.resumen) ? mem.resumen : null;
    out.forEach(function (p) { refs.push(p[0], p[1]); wire.push(wireTurn(p[0]), wireTurn(p[1])); });
    if (owner) wire.forEach(function (m) { m.content = redactOwnerContext(m.content); });
    // tope del cuerpo del empleado (64 KB en el servidor): sale lo más viejo; al final, el resumen
    if (!owner) { var base = opts.bodyBase || {};
      var size = function () { var o = {}; for (var k in base) o[k] = base[k]; o.history = wire; if (res) o.resumen = res; return utf8Len(JSON.stringify(o)); };
      while (wire.length && size() > MEMORY.employeeBodyCap) { wire.splice(0, 2); refs.splice(0, 2); }
      if (res && size() > MEMORY.employeeBodyCap) res = null; }
    return { history: wire, refs: refs, resumen: res ? (typeof res === 'object' ? { texto: String(res.texto || ''), iat: res.iat, sig: res.sig } : String(res)) : null, folded: folded };
  }
  // Después de la respuesta: guarda el tope del servidor, el resumen_sugerido y quita lo que el servidor ya resumió.
  // Devuelve { notice: true } la PRIMERA vez (por conversación) que un resumen reemplaza turnos viejos.
  function memAfter(history, mem, d, req) {
    mem = mem || memNew(); req = req || {}; d = d || {}; var h = Array.isArray(history) ? history : [], replaced = req.folded > 0;
    var m = d.memoria && typeof d.memoria === 'object' ? d.memoria : null;
    if (!m) { mem.legacy = true; return { notice: false }; }
    mem.legacy = false;
    if (typeof m.max_bytes === 'number' && m.max_bytes > 0) mem.maxBytes = Math.min(m.max_bytes, MEMORY.ownerBytes);
    if (typeof m.max_turnos === 'number' && m.max_turnos > 0) mem.maxTurns = Math.min(m.max_turnos, MEMORY.maxTurns);
    var rs = d.resumen_sugerido;
    if (rs && typeof rs === 'object' && typeof rs.texto === 'string' && rs.texto.trim()) {
      mem.resumen = { texto: rs.texto.slice(0, MEMORY.resumenChars * 2), iat: typeof rs.iat === 'number' ? rs.iat : null, sig: typeof rs.sig === 'string' ? rs.sig : null };
      // el servidor quitó los «recortados» turnos más viejos de los que se mandaron: aquí también (ya están en el resumen)
      var sent = Array.isArray(req.refs) ? req.refs : [], k = Math.min(typeof m.recortados === 'number' ? m.recortados : 0, sent.length);
      for (var i = 0; i < k; i++) { var j = h.indexOf(sent[i]); if (j >= 0) h.splice(j, 1); }
      while (h.length && h[0].role !== 'user') h.shift();
      if (k > 0) replaced = true;
    }
    if (replaced && !mem.notified) { mem.notified = true; return { notice: true }; }
    return { notice: false };
  }
  // Guarda el turno como se va a mandar después: el del Admin, limpio (redactOwnerContext); el del empleado, tal cual (firmado) o nada si
  // el limpiador lo cambiaría (no se puede tocar sin romper la firma). nota: lo leído de la foto, si el servidor no la puso en el turno.
  function memStore(history, role, nota) {
    var h = Array.isArray(history) ? history : []; if (h.length < 2) return;
    var u = h[h.length - 2], a = h[h.length - 1];
    if (role === 'owner') {
      if (typeof nota === 'string' && nota && String(u.content || '').indexOf(MEMORY.notaPrefix) < 0 && !u.sig) u.content = (u.content && u.content !== 'Foto' ? u.content + ' ' : '') + nota;
      u.content = redactOwnerContext(u.content); a.content = redactOwnerContext(a.content);
    } else if (redactText(u.content) !== u.content || redactText(a.content) !== a.content || !u.sig) h.splice(h.length - 2, 2);
  }

  function configurationIntent(text, previous) {
    var t = String(text || '').trim().toLowerCase();
    if (/\b(?:color(?:es)?|azul|celeste|naranja|esmeralda|verde|simple)\b|configur|aparien|interfa[sz]|tema|modo|nocturn|oscur|letra|tamañ|boton|stock.*m[ií]n|m[ií]n.*stock|imprim|impres|lector|sonido|escane|avis|alert/.test(t)) return true;
    return !!previous && /^(?:s[ií]|no|hazlo|apl[ií]calo|normal|chico|grande|muy grande|azul|verde|naranja|celeste|simple|claro|noche|auto|\d{1,6}%?)[.!]?$/i.test(t);
  }
  var api = { configurationIntent: configurationIntent, MEMORY: MEMORY, utf8Len: utf8Len, businessName: businessName, memNew: memNew, memPairs: memPairs, memRequest: memRequest, memAfter: memAfter, memStore: memStore, memFold: memFold, compactReview: compactReview, REVIEW_BUDGET: REVIEW_BUDGET, maskCustomers: maskCustomers, customerCodesIn: customerCodesIn, fmtClean: fmtClean, inputClean: inputClean, normManual: normManual, manualBad: manualBad, BLOCKED_MSG: BLOCKED_MSG, ROLE_LOST_MSG: ROLE_LOST_MSG, NO_LINK_MSG: NO_LINK_MSG, RECONNECT_MSG: RECONNECT_MSG, SAME_SESSION_MSG: SAME_SESSION_MSG, OTHER_DEVICE_DONE_MSG: OTHER_DEVICE_DONE_MSG, wipeManual: wipeManual, createReplyRenderer: createReplyRenderer, createDisplayStripper: createDisplayStripper, stripDisplay: stripDisplay, appendCoded: appendCoded, DOC_CODE_RE: DOC_CODE_RE, tableCells: tableCells, MASK_LABEL: MASK_LABEL, MASK_NOTE: MASK_NOTE, STREAM: STREAM, uploadMs: uploadMs, createSseParser: createSseParser, createTextPainter: createTextPainter, streamChat: streamChat, friendlyError: friendlyError, looksTechnical: looksTechnical, FRIENDLY: FRIENDLY, padOverlap: padOverlap, tracksStock: tracksStock, precheck: precheck, request: request, TIMEOUTS: TIMEOUTS, CONFIRM_ATTEMPTS: CONFIRM_ATTEMPTS, confirmFailureView: confirmFailureView, purchaseProductDraft: purchaseProductDraft, capContext: capContext, redactText: redactText, redactOwnerContext: redactOwnerContext, maskLeft: maskLeft, needFields: needFields, fillValues: fillValues, isServerConfig: isServerConfig, isRucCard: isRucCard, SERVER_CONFIG_KEYS: SERVER_CONFIG_KEYS, CONFIG_CONFLICT_MSG: CONFIG_CONFLICT_MSG, CONFIG_LOST_MSG: CONFIG_LOST_MSG, purchaseValue: purchaseValue, purchaseTotals: purchaseTotals, buildContext: buildContext, canExecute: canExecute, createGate: createGate, buildDocument: buildDocument, maskDoc: maskDoc, EXECUTORS: EXECUTORS, soles: soles, esc: esc };
  root.NA_ASISTENTE_CORE = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
