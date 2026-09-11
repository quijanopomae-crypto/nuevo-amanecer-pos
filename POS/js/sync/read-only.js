(function () {
  'use strict';

  var STORAGE_KEY = 'na_read_only_session';
  var currentView = 'status';
  var cursors = [null];
  var page = 0;
  var nextCursor = null;
  var lastSales = [];

  function element(id) { return document.getElementById(id); }

  function config() {
    return {
      endpoint: element('endpoint').value.trim().replace(/\/+$/, ''),
      token: element('readToken').value,
    };
  }

  function saveSession() {
    var value = config();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }

  function restoreSession() {
    try {
      var value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (value && typeof value.endpoint === 'string') element('endpoint').value = value.endpoint;
      if (value && typeof value.token === 'string') element('readToken').value = value.token;
    } catch (error) {}
  }

  async function get(path) {
    var value = config();
    if (!value.token) throw new Error('Ingresa el token de lectura.');
    var response = await fetch(value.endpoint + path, {
      method: 'GET', credentials: 'omit', redirect: 'error',
      headers: { 'x-read-token': value.token },
    });
    var body = null;
    try { body = await response.json(); } catch (error) {}
    if (!response.ok) throw new Error(response.status === 401 ? 'Acceso de lectura no autorizado.' : 'No se pudo completar la consulta (' + response.status + ').');
    return body;
  }

  function text(value) { return value === null || value === undefined ? '' : String(value); }

  function renderStatus(data) {
    var counts = data.counts || {};
    element('content').replaceChildren();
    var title = document.createElement('h2'); title.textContent = 'Estado de sincronización';
    var body = document.createElement('div');
    body.className = 'payload';
    body.textContent = 'Ventas: ' + (counts.sales || 0) + '\nLíneas: ' + (counts.sale_items || 0) +
      '\nMovimientos de inventario: ' + (counts.inventory_movements || 0) +
      '\nÚltima recepción: ' + (data.last_received_at || 'Sin datos');
    element('content').append(title, body);
  }

  function appendItem(container, item, onOpen) {
    var row = document.createElement('article'); row.className = 'item';
    var heading = document.createElement('strong'); heading.textContent = text(item.entity_id);
    var meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = text(item.received_at) + ' · dispositivo ' + text(item.device_id) + ' · secuencia ' + text(item.device_sequence);
    var payload = document.createElement('pre'); payload.className = 'payload'; payload.textContent = JSON.stringify(item.payload, null, 2);
    row.append(heading, meta, payload);
    if (onOpen) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = 'Ver líneas';
      button.addEventListener('click', function () { onOpen(item.entity_id); });
      row.append(button);
    }
    container.append(row);
  }

  function renderList(titleText, items, allowLines) {
    var content = element('content'); content.replaceChildren();
    var title = document.createElement('h2'); title.textContent = titleText;
    content.append(title);
    if (!items.length) { var empty=document.createElement('p');empty.textContent='Sin registros sincronizados.';content.append(empty);return; }
    items.forEach(function (item) { appendItem(content, item, allowLines ? openSaleItems : null); });
  }

  async function openSaleItems(saleId) {
    setStatus('Consultando líneas…');
    try {
      var data = await get('/read/sales/' + encodeURIComponent(saleId) + '/items?limit=100');
      renderList('Líneas de ' + saleId, data.items || [], false);
      element('previous').disabled = true; element('next').disabled = true;
      setStatus('Consulta actualizada.');
    } catch (error) { setStatus(error.message, true); }
  }

  function setStatus(message, error) {
    var status = element('connectionStatus');
    status.textContent = message; status.style.color = error ? '#b42318' : '#16675d';
  }

  async function load(reset) {
    if (reset) { cursors = [null]; page = 0; nextCursor = null; }
    setStatus('Consultando…');
    try {
      saveSession();
      if (currentView === 'status') {
        renderStatus(await get('/read/status'));
        nextCursor = null;
      } else {
        var cursor = cursors[page];
        var query = '?limit=25' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
        var data = await get('/read/' + currentView + query);
        nextCursor = data.next_cursor || null;
        if (currentView === 'sales') lastSales = data.items || [];
        renderList(currentView === 'sales' ? 'Ventas sincronizadas' : 'Movimientos de inventario', data.items || [], currentView === 'sales');
      }
      element('previous').disabled = page === 0;
      element('next').disabled = !nextCursor;
      setStatus('Consulta actualizada.');
    } catch (error) { setStatus(error.message, true); }
  }

  document.querySelectorAll('[data-view]').forEach(function (button) {
    button.addEventListener('click', function () {
      currentView = button.dataset.view;
      document.querySelectorAll('[data-view]').forEach(function (item) { item.setAttribute('aria-selected', item === button ? 'true' : 'false'); });
      load(true);
    });
  });
  element('connect').addEventListener('click', function () { load(true); });
  element('previous').addEventListener('click', function () { if (page > 0) { page -= 1; load(false); } });
  element('next').addEventListener('click', function () { if (nextCursor) { cursors[page + 1] = nextCursor; page += 1; load(false); } });
  restoreSession();
  document.querySelector('[data-view="status"]').setAttribute('aria-selected', 'true');
})();
