/* #40 Yape/Plin con QR mostrado al cliente.
 * Solo muestra: no toca Pagar/Cobrar, TOTAL ni formatos de monto.
 * El QR se guarda en este dispositivo (localStorage); no usa el Worker ni la base.
 * Visible solo si NA_PERMISSIONS.featureLocked('cobro-qr-yape-plin') === false. */
(function (root) {
  'use strict';
  var FEATURE_ID = 'cobro-qr-yape-plin';
  var STORE_KEY = 'na_cobro_qr_v1';
  var WALLETS = { yape: 'Yape', plin: 'Plin' };
  var MAX_BYTES = 3 * 1024 * 1024, MAX_SIDE = 900;
  var doc = root.document;

  function enabled() {
    try { var p = root.NA_PERMISSIONS; return !!(p && typeof p.featureLocked === 'function' && p.featureLocked(FEATURE_ID) === false); } catch (_) { return false; }
  }
  function isOwner() {
    try { var r = root.NA_ROLES; return !!(r && typeof r.isOwner === 'function' && r.isOwner() === true); } catch (_) { return false; }
  }
  function validImage(v) { return typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v); }
  function load() {
    try { var d = JSON.parse(root.localStorage.getItem(STORE_KEY) || '{}'), out = {}; Object.keys(WALLETS).forEach(function (k) { if (validImage(d[k])) out[k] = d[k]; }); return out; } catch (_) { return {}; }
  }
  function save(data) { root.localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  function getQr(wallet) { return Object.prototype.hasOwnProperty.call(WALLETS, wallet) ? (load()[wallet] || '') : ''; }
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg, type) { try { if (typeof root.toast === 'function') root.toast(msg, type); } catch (_) {} }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Usa una imagen PNG, JPG o WEBP.'));
      if (file.size > MAX_BYTES) return reject(new Error('La imagen pesa más de 3 MB.'));
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('No se pudo leer la imagen.')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('La imagen no es válida.')); };
        img.onload = function () {
          var s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          var c = doc.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
          var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
          var url = c.toDataURL('image/png'); validImage(url) ? resolve(url) : reject(new Error('La imagen no es válida.'));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- Configuración (solo dueño) ---------- */
  function renderConfigCard(host) {
    var card = el('section', 'na-qr-cfg'); card.id = 'naQrCfgCard';
    card.appendChild(el('h4', 'na-qr-cfg-title', 'QR de Yape y Plin'));
    card.appendChild(el('p', 'na-qr-cfg-help', 'Sube la imagen de tu QR. Al cobrar con Yape o Plin aparecerá el botón «Mostrar QR» para enseñárselo al cliente. Se guarda solo en este dispositivo.'));
    var data = load();
    Object.keys(WALLETS).forEach(function (w) {
      var row = el('div', 'na-qr-cfg-row'); row.dataset.wallet = w;
      row.appendChild(el('strong', 'na-qr-cfg-name', WALLETS[w]));
      var prev = el('img', 'na-qr-cfg-prev'); prev.alt = 'QR de ' + WALLETS[w];
      if (data[w]) prev.src = data[w]; else prev.hidden = true;
      var status = el('span', 'na-qr-cfg-status', data[w] ? 'QR guardado' : 'Sin QR');
      var input = el('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true; input.dataset.qrInput = w;
      var up = el('button', 'na-qr-cfg-btn', data[w] ? 'Cambiar QR' : 'Subir QR'); up.type = 'button'; up.dataset.qrUpload = w;
      var del = el('button', 'na-qr-cfg-btn', 'Quitar'); del.type = 'button'; del.dataset.qrRemove = w; del.hidden = !data[w];
      up.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var f = input.files && input.files[0]; input.value = '';
        if (!f) return;
        readFile(f).then(function (url) { var d = load(); d[w] = url; save(d); refreshCfg(); toast('QR de ' + WALLETS[w] + ' guardado', 'success'); })
          .catch(function (e) { toast(e.message || 'No se pudo guardar el QR', 'error'); });
      });
      del.addEventListener('click', function () { var d = load(); delete d[w]; save(d); refreshCfg(); toast('QR de ' + WALLETS[w] + ' quitado', 'success'); });
      var actions = el('div', 'na-qr-cfg-actions'); actions.appendChild(up); actions.appendChild(del);
      row.appendChild(prev); row.appendChild(status); row.appendChild(actions); row.appendChild(input);
      card.appendChild(row);
    });
    host.appendChild(card);
  }
  // Configuración v9: «Ventas y cobros» › «Punto de venta» (data-sec="pv").
  function cfgHost() { return doc.querySelector('#naCfgV9 #na9Main .na9-bd[data-sec="pv"]'); }
  function wantCfg() { return enabled() && isOwner() && !!cfgHost(); }
  function refreshCfg() {
    var old = doc.getElementById('naQrCfgCard'); if (old) old.remove();
    var host = cfgHost(); if (host && wantCfg()) renderConfigCard(host);
  }
  var cfgPending = false;
  function scheduleCfg() {
    if (cfgPending) return; cfgPending = true;
    root.setTimeout(function () {
      cfgPending = false;
      var card = doc.getElementById('naQrCfgCard'), host = cfgHost(), want = wantCfg();
      if (want ? !(card && host && host.contains(card)) : !!card) refreshCfg();
    }, 0);
  }

  /* ---------- Cobro: botón y ventana ---------- */
  function currentWallet() {
    var sec = doc.getElementById('mDigitalSection'); if (!sec || sec.style.display === 'none') return '';
    var b = sec.querySelector('.digital-channel-btn.active'); var w = b ? b.dataset.digitalMethod : '';
    return Object.prototype.hasOwnProperty.call(WALLETS, w) ? w : '';
  }
  function ensureButton() {
    var sec = doc.getElementById('mDigitalSection'); if (!sec) return null;
    var btn = doc.getElementById('naQrShowBtn');
    if (!btn) {
      btn = el('button', 'na-qr-show-btn', 'Mostrar QR'); btn.type = 'button'; btn.id = 'naQrShowBtn'; btn.hidden = true;
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); var w = currentWallet(); if (w) openOverlay(w); });
      var list = doc.getElementById('mDigitalChannels');
      if (list && list.nextSibling) sec.insertBefore(btn, list.nextSibling); else sec.appendChild(btn);
    }
    return btn;
  }
  function refreshButton() {
    if (!enabled()) { var b0 = doc.getElementById('naQrShowBtn'); if (b0) b0.hidden = true; return; }
    var btn = ensureButton(); if (!btn) return;
    var w = currentWallet(), has = !!(w && getQr(w));
    btn.hidden = !has;
    if (has) btn.textContent = 'Mostrar QR de ' + WALLETS[w];
  }
  function amountText() { var t = doc.getElementById('mCobroTotal'); return t ? String(t.textContent || '').trim() : ''; }
  function closeOverlay() { var o = doc.getElementById('naQrOverlay'); if (o) o.remove(); doc.removeEventListener('keydown', onKey, true); }
  // Con el QR a la vista, Enter NO debe confirmar el cobro (el cobro escucha Enter en document).
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeOverlay(); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); closeOverlay(); }
  }
  function openOverlay(wallet) {
    var url = getQr(wallet); if (!url) return;
    closeOverlay();
    var ov = el('div', 'na-qr-overlay'); ov.id = 'naQrOverlay'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'QR de ' + WALLETS[wallet]);
    var box = el('div', 'na-qr-box');
    box.appendChild(el('div', 'na-qr-title', 'Paga con ' + WALLETS[wallet]));
    var img = el('img', 'na-qr-img'); img.alt = 'Código QR de ' + WALLETS[wallet]; img.src = url; box.appendChild(img);
    box.appendChild(el('div', 'na-qr-amount-label', 'Monto a pagar'));
    var amt = el('div', 'na-qr-amount', amountText()); amt.id = 'naQrAmount'; box.appendChild(amt);
    var close = el('button', 'na-qr-close', 'Cerrar'); close.type = 'button'; close.id = 'naQrClose';
    close.addEventListener('click', function (e) { e.stopPropagation(); closeOverlay(); });
    box.appendChild(close);
    ov.addEventListener('click', function (e) { e.stopPropagation(); if (e.target === ov) closeOverlay(); });
    ov.appendChild(box); doc.body.appendChild(ov);
    doc.addEventListener('keydown', onKey, true);
    close.focus();
  }

  function init() {
    if (!enabled()) return;
    var sec = doc.getElementById('mDigitalSection'), modal = doc.getElementById('mCobro') || (sec && sec.closest('.overlay, .modal-overlay, .modal'));
    var target = modal || sec;
    if (target && root.MutationObserver) new MutationObserver(refreshButton).observe(target, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] });
    refreshButton();
    var cfgPage = doc.getElementById('pageConfig');
    if (cfgPage && root.MutationObserver) new MutationObserver(scheduleCfg).observe(cfgPage, { childList: true, subtree: true });
    scheduleCfg();
    root.addEventListener('storage', function (e) { if (e.key === STORE_KEY) refreshButton(); });
  }
  root.NA_COBRO_QR = Object.freeze({ FEATURE_ID: FEATURE_ID, STORE_KEY: STORE_KEY, enabled: enabled, getQr: getQr, validImage: validImage, open: openOverlay, close: closeOverlay, refresh: refreshButton });
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(globalThis);
