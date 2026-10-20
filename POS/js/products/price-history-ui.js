/* Vista de solo lectura del historial, dentro de la ficha del producto. */
(function (root) {
  'use strict';
  function localWhen(value) {
    var ms = Date.parse(value);
    if (!Number.isFinite(ms)) return 'Fecha no registrada';
    var d = new Date(ms);
    function pad(n) { return String(n).padStart(2, '0'); }
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function productId() {
    try { if (typeof invEditId !== 'undefined') return invEditId; }
    catch (_) {}
    return root.invEditId;
  }
  function render() {
    var doc = root.document;
    if (!doc) return;
    var host = doc.getElementById('pPriceHistory');
    var modal = doc.getElementById('mProd');
    var api = root.NA_PRICE_HISTORY;
    if (!host || !modal || !api) return;
    if (!modal.classList.contains('open')) { host.hidden = true; host.replaceChildren(); return; }
    host.hidden = false;
    host.replaceChildren();
    var title = doc.createElement('p');
    title.className = 'na-ph-title';
    title.textContent = 'Historial de precios';
    host.appendChild(title);
    var id = productId();
    if (id == null || id === '') {
      var pending = doc.createElement('p');
      pending.className = 'na-ph-empty';
      pending.textContent = 'El historial queda en la ficha después del primer cambio de precio.';
      host.appendChild(pending);
      return;
    }
    var rows = api.list(id);
    if (!rows.length) {
      var empty = doc.createElement('p');
      empty.className = 'na-ph-empty';
      empty.textContent = 'Todavía no hay cambios de precio en este producto.';
      host.appendChild(empty);
      return;
    }
    var list = doc.createElement('ol');
    list.className = 'na-ph-list';
    rows.forEach(function (row) {
      var item = doc.createElement('li');
      var when = doc.createElement('time');
      when.dateTime = row.at;
      when.textContent = localWhen(row.at);
      var change = doc.createElement('span');
      change.textContent = api.labels.type[row.type] + ': ' + api.money(row.before) + ' → ' + api.money(row.after);
      var meta = doc.createElement('small');
      meta.textContent = (row.user || 'Usuario') + (row.userId ? ' · ' + row.userId : '') + ' · ' + (api.labels.origin[row.origin] || row.origin);
      item.append(when, change, meta);
      list.appendChild(item);
    });
    host.appendChild(list);
  }
  function boot() {
    var modal = root.document && root.document.getElementById('mProd');
    if (!modal || typeof root.MutationObserver !== 'function') return;
    new root.MutationObserver(render).observe(modal, { attributes: true, attributeFilter: ['class'] });
    root.addEventListener('na:role', render);
    render();
  }
  if (!root.document) return;
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot);
  else boot();
  root.NA_PRICE_HISTORY_UI = Object.freeze({ render: render });
})(typeof globalThis !== 'undefined' ? globalThis : window);
