(function () {
  'use strict';
  if (!window.__NA_LAB__) return;

  var DEFAULT_ENDPOINT = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
  var LOCAL_KEY = 'na_lab_workspace_credentials_v1';
  var SESSION_KEY = 'na_lab_workspace_credentials_session_v1';
  var state = {
    revision: null,
    baselineId: null,
    sourceRef: null,
    remoteReady: false,
    suppressRemoteSave: false,
    saving: false,
    dirty: false,
    timer: null,
    credentials: null
  };

  var originalSaveAllData = typeof saveAllData === 'function' ? saveAllData : null;
  var originalSaveAppState = typeof saveAppState === 'function' ? saveAppState : null;
  var originalLoadAllData = typeof loadAllData === 'function' ? loadAllData : null;

  function parseStored(store, key) {
    try {
      var raw = store.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function loadCredentials() {
    var session = parseStored(sessionStorage, SESSION_KEY);
    var persistent = parseStored(localStorage, LOCAL_KEY);
    return session || persistent || {
      endpoint: DEFAULT_ENDPOINT,
      readToken: '',
      deviceId: '',
      syncToken: '',
      remember: false
    };
  }

  function cleanCredentials(raw) {
    return {
      endpoint: String(raw && raw.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, ''),
      readToken: String(raw && raw.readToken || '').trim(),
      deviceId: String(raw && raw.deviceId || '').trim(),
      syncToken: String(raw && raw.syncToken || '').trim(),
      remember: !!(raw && raw.remember)
    };
  }

  function storeCredentials(credentials) {
    var value = JSON.stringify(cleanCredentials(credentials));
    try {
      localStorage.removeItem(LOCAL_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      (credentials.remember ? localStorage : sessionStorage).setItem(
        credentials.remember ? LOCAL_KEY : SESSION_KEY,
        value
      );
    } catch {}
    state.credentials = cleanCredentials(credentials);
  }

  function clearCredentials() {
    try {
      localStorage.removeItem(LOCAL_KEY);
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    state.credentials = cleanCredentials({ endpoint: DEFAULT_ENDPOINT });
    state.remoteReady = false;
    state.revision = null;
    updateBadge('SIN CONEXIÓN');
    renderStatus('Credenciales LAB borradas.');
  }

  function hasReadAccess(credentials) {
    return !!(credentials.readToken || (credentials.deviceId && credentials.syncToken));
  }

  function hasWriterAccess(credentials) {
    return !!(credentials.deviceId && credentials.syncToken);
  }

  function headersFor(mode) {
    var c = state.credentials || loadCredentials();
    var headers = {};
    if (mode === 'write' || !c.readToken) {
      if (c.deviceId) headers['x-device-id'] = c.deviceId;
      if (c.syncToken) headers['x-sync-token'] = c.syncToken;
    } else if (c.readToken) {
      headers['x-read-token'] = c.readToken;
    }
    return headers;
  }

  async function api(path, options) {
    var c = state.credentials || loadCredentials();
    var opts = options || {};
    var mode = opts.mode || 'read';
    var headers = Object.assign({}, headersFor(mode), opts.headers || {});
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    return fetch(c.endpoint + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store'
    });
  }

  function updateBadge(label) {
    var badge = document.getElementById('naLabBadge');
    if (!badge) return;
    badge.style.pointerEvents = 'auto';
    badge.style.cursor = 'pointer';
    badge.textContent = '🧪 LAB · ' + label + ' · NO PRODUCCIÓN';
    badge.title = 'Abrir control de datos LAB';
  }

  function renderStatus(message, kind) {
    var node = document.getElementById('naLabWorkspaceStatus');
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind || 'info';
  }

  function refreshMetadata(payload) {
    state.revision = Number(payload.revision);
    state.baselineId = payload.baseline_id || null;
    state.sourceRef = payload.source_ref || null;
    state.remoteReady = true;
    updateBadge('D1 R' + state.revision);
    var meta = document.getElementById('naLabWorkspaceMeta');
    if (meta) {
      meta.textContent = 'Revisión ' + state.revision +
        (state.baselineId ? ' · ' + state.baselineId : '') +
        (state.sourceRef ? '\nFuente: ' + state.sourceRef : '');
    }
  }

  async function applyRemoteWorkspace(payload) {
    if (!payload || !payload.snapshot || typeof _naValidSnapshot !== 'function' || !_naValidSnapshot(payload.snapshot)) {
      throw new Error('El snapshot LAB recibido no es válido');
    }
    state.suppressRemoteSave = true;
    try {
      if (!_naApplySnapshot(payload.snapshot)) throw new Error('No se pudo aplicar el snapshot LAB');
      if (typeof _naNormalizeData === 'function') _naNormalizeData();
      if (originalSaveAllData) await originalSaveAllData();
      if (typeof renderCategorySelects === 'function') renderCategorySelects();
      if (typeof _naApplyConfigUI === 'function') _naApplyConfigUI();
      if (typeof posRender === 'function') posRender();
      if (typeof posUpdateCart === 'function') posUpdateCart();
      if (typeof invRender === 'function') invRender();
      if (typeof cliRender === 'function') cliRender();
      if (typeof ventasRender === 'function') ventasRender();
      if (typeof cajRender === 'function') cajRender();
      if (typeof gasRender === 'function') gasRender();
      if (typeof cfgUpdateStats === 'function') cfgUpdateStats();
      if (typeof updateDashboard === 'function') updateDashboard();
      refreshMetadata(payload);
    } finally {
      state.suppressRemoteSave = false;
    }
  }

  async function loadRemoteWorkspace(options) {
    var silent = options && options.silent;
    if (!hasReadAccess(state.credentials)) {
      state.remoteReady = false;
      updateBadge('SIN CONEXIÓN');
      if (!silent) renderStatus('Configura un READ_TOKEN o las credenciales del dispositivo LAB.');
      return false;
    }
    if (!silent) renderStatus('Cargando D1 LAB…');
    var response = await api('/lab/workspace', { mode: 'read' });
    if (response.status === 404) {
      state.remoteReady = false;
      updateBadge('D1 VACÍA');
      renderStatus('D1 LAB todavía no tiene baseline. Usa “Actualizar desde CANON”.');
      return false;
    }
    if (!response.ok) {
      state.remoteReady = false;
      updateBadge('ERROR DATOS');
      throw new Error('No se pudo leer D1 LAB (' + response.status + ')');
    }
    var payload = await response.json();
    await applyRemoteWorkspace(payload);
    renderStatus('Datos LAB cargados. Los cambios se guardan solo en D1 LAB.', 'ok');
    return true;
  }

  function snapshotForRemote() {
    if (typeof _naBuildSnapshot !== 'function') throw new Error('Snapshot local no disponible');
    var snapshot = _naBuildSnapshot();
    try { delete snapshot.cloudSync; } catch {}
    return snapshot;
  }

  function scheduleRemoteSave() {
    if (!state.remoteReady || state.suppressRemoteSave || !hasWriterAccess(state.credentials)) return;
    state.dirty = true;
    clearTimeout(state.timer);
    state.timer = setTimeout(flushRemoteSave, 1200);
  }

  async function flushRemoteSave() {
    if (state.saving || !state.dirty || !state.remoteReady || !hasWriterAccess(state.credentials)) return;
    state.saving = true;
    state.dirty = false;
    try {
      var body = {
        expected_revision: state.revision,
        operation_id: 'lab-save-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10),
        snapshot: snapshotForRemote()
      };
      var response = await api('/lab/workspace/save', { method: 'POST', mode: 'write', body: body });
      var payload = {};
      try { payload = await response.json(); } catch {}
      if (response.status === 409 && payload.error === 'revision_conflict') {
        state.remoteReady = false;
        updateBadge('CONFLICTO');
        renderStatus('Conflicto de revisión. Carga nuevamente D1 LAB antes de seguir.', 'error');
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'save_failed_' + response.status);
      state.revision = Number(payload.revision || state.revision);
      updateBadge('D1 R' + state.revision);
      renderStatus('Cambios guardados en D1 LAB · revisión ' + state.revision, 'ok');
    } catch (error) {
      state.dirty = true;
      updateBadge('PENDIENTE');
      renderStatus('No se pudo guardar D1 LAB: ' + error.message, 'error');
    } finally {
      state.saving = false;
      if (state.dirty && state.remoteReady) {
        clearTimeout(state.timer);
        state.timer = setTimeout(flushRemoteSave, 1800);
      }
    }
  }

  async function refreshFromCanon() {
    var actionUrl = 'https://github.com/quijanopomae-crypto/nuevo-amanecer-pos/actions/workflows/lab-data-refresh.yml';
    renderStatus('La copia CANON → LAB usa el backup SQL real. Ejecuta “Refresh LAB Data” en GitHub y luego pulsa “Cargar D1 LAB”.', 'info');
    try { window.open(actionUrl, '_blank', 'noopener'); } catch {}
  }

  async function resetToBaseline() {
    if (!hasWriterAccess(state.credentials) || !state.revision) {
      renderStatus('Conecta primero el workspace LAB con credenciales de escritura.', 'error');
      return;
    }
    if (!confirm('¿Descartar los cambios experimentales actuales y volver al baseline CANON de este LAB?')) return;
    var response = await api('/lab/workspace/reset', {
      method: 'POST',
      mode: 'write',
      body: { expected_revision: state.revision }
    });
    var payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      renderStatus('No se pudo restaurar baseline: ' + (payload.error || response.status), 'error');
      return;
    }
    renderStatus('Workspace restaurado al baseline.', 'ok');
    await loadRemoteWorkspace({ silent: false });
  }

  function panelMarkup() {
    return '<div id="naLabWorkspaceOverlay" style="display:none;position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.62);padding:16px;overflow:auto">' +
      '<div style="max-width:520px;margin:5vh auto;background:#fff;color:#111827;border-radius:18px;padding:18px;box-shadow:0 18px 60px rgba(0,0,0,.35);font-family:system-ui,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><div><strong style="font-size:18px">🧪 Datos POS-LAB</strong><div style="font-size:12px;color:#64748b;margin-top:4px">CANON → D1 LAB. Nunca LAB → CANON.</div></div><button id="naLabWorkspaceClose" type="button" style="border:0;background:#f1f5f9;border-radius:9px;padding:7px 10px">✕</button></div>' +
      '<div id="naLabWorkspaceStatus" style="margin:14px 0;padding:10px;border-radius:10px;background:#f8fafc;font-size:12px;font-weight:700">Configura la conexión LAB.</div>' +
      '<pre id="naLabWorkspaceMeta" style="white-space:pre-wrap;font-size:10px;color:#64748b;background:#f8fafc;border-radius:10px;padding:9px"></pre>' +
      '<label style="display:block;font-size:11px;font-weight:800;margin-top:10px">Worker LAB</label><input id="naLabEndpoint" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:9px" />' +
      '<label style="display:block;font-size:11px;font-weight:800;margin-top:10px">READ_TOKEN (opcional si usas dispositivo)</label><input id="naLabReadToken" type="password" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:9px" />' +
      '<label style="display:block;font-size:11px;font-weight:800;margin-top:10px">Device ID LAB</label><input id="naLabDeviceId" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:9px" />' +
      '<label style="display:block;font-size:11px;font-weight:800;margin-top:10px">SYNC_TOKEN LAB</label><input id="naLabSyncToken" type="password" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:9px" />' +
      '<label style="display:flex;gap:8px;align-items:center;margin:12px 0;font-size:12px"><input id="naLabRemember" type="checkbox"> Recordar credenciales en este dispositivo LAB</label>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
      '<button id="naLabSaveConfig" type="button" style="padding:10px;border:0;border-radius:10px;background:#0f766e;color:#fff;font-weight:800">Guardar conexión</button>' +
      '<button id="naLabLoad" type="button" style="padding:10px;border:0;border-radius:10px;background:#e2e8f0;font-weight:800">Cargar D1 LAB</button>' +
      '<button id="naLabRefreshCanon" type="button" style="padding:10px;border:0;border-radius:10px;background:#0ea5e9;color:#fff;font-weight:800">Actualizar CANON → LAB</button>' +
      '<button id="naLabResetBaseline" type="button" style="padding:10px;border:0;border-radius:10px;background:#f59e0b;color:#111827;font-weight:800">Restaurar baseline</button>' +
      '</div><button id="naLabClearCredentials" type="button" style="width:100%;margin-top:8px;padding:9px;border:0;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:800">Borrar credenciales de este navegador</button>' +
      '<p style="font-size:10px;line-height:1.45;color:#64748b;margin:12px 0 0">Los tokens nunca se incluyen en GitHub ni en el HTML. El refresh usa un token R2 de solo lectura guardado únicamente en el Worker LAB.</p>' +
      '</div></div>';
  }

  function setupPanel() {
    if (!document.body || document.getElementById('naLabWorkspaceOverlay')) return;
    document.body.insertAdjacentHTML('beforeend', panelMarkup());
    var overlay = document.getElementById('naLabWorkspaceOverlay');
    var badge = document.getElementById('naLabBadge');
    if (badge) {
      badge.style.pointerEvents = 'auto';
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', function () {
        fillPanel();
        overlay.style.display = 'block';
      });
    }
    document.getElementById('naLabWorkspaceClose').onclick = function () { overlay.style.display = 'none'; };
    document.getElementById('naLabSaveConfig').onclick = async function () {
      state.credentials = cleanCredentials({
        endpoint: document.getElementById('naLabEndpoint').value,
        readToken: document.getElementById('naLabReadToken').value,
        deviceId: document.getElementById('naLabDeviceId').value,
        syncToken: document.getElementById('naLabSyncToken').value,
        remember: document.getElementById('naLabRemember').checked
      });
      storeCredentials(state.credentials);
      renderStatus('Conexión LAB guardada en este navegador.', 'ok');
      try { await loadRemoteWorkspace({ silent: false }); } catch (error) { renderStatus(error.message, 'error'); }
    };
    document.getElementById('naLabLoad').onclick = function () {
      loadRemoteWorkspace({ silent: false }).catch(function (error) { renderStatus(error.message, 'error'); });
    };
    document.getElementById('naLabRefreshCanon').onclick = function () {
      refreshFromCanon().catch(function (error) { renderStatus(error.message, 'error'); });
    };
    document.getElementById('naLabResetBaseline').onclick = function () {
      resetToBaseline().catch(function (error) { renderStatus(error.message, 'error'); });
    };
    document.getElementById('naLabClearCredentials').onclick = clearCredentials;
  }

  function fillPanel() {
    var c = state.credentials || loadCredentials();
    document.getElementById('naLabEndpoint').value = c.endpoint || DEFAULT_ENDPOINT;
    document.getElementById('naLabReadToken').value = c.readToken || '';
    document.getElementById('naLabDeviceId').value = c.deviceId || '';
    document.getElementById('naLabSyncToken').value = c.syncToken || '';
    document.getElementById('naLabRemember').checked = !!c.remember;
    if (state.revision) refreshMetadata({
      revision: state.revision,
      baseline_id: state.baselineId,
      source_ref: state.sourceRef
    });
  }

  function persisted(result) {
    try {
      if (typeof _naWasPersisted === 'function') return _naWasPersisted(result);
    } catch {}
    return !!(result && (result.durable || result.ok));
  }

  if (originalSaveAllData) {
    saveAllData = async function () {
      var result = await originalSaveAllData.apply(this, arguments);
      if (persisted(result)) scheduleRemoteSave();
      return result;
    };
  }

  if (originalSaveAppState) {
    saveAppState = async function () {
      var result = await originalSaveAppState.apply(this, arguments);
      if (persisted(result)) scheduleRemoteSave();
      return result;
    };
  }

  state.credentials = cleanCredentials(loadCredentials());

  if (originalLoadAllData) {
    loadAllData = async function () {
      var result = await originalLoadAllData.apply(this, arguments);
      try {
        await loadRemoteWorkspace({ silent: true });
      } catch (error) {
        console.warn('[NA-LAB] No se pudo cargar D1 LAB.', error && error.message || error);
        updateBadge('LOCAL');
      }
      return result;
    };
  }

  setupPanel();
  updateBadge(hasReadAccess(state.credentials) ? 'CONECTANDO' : 'SIN CONEXIÓN');

  window.NuevoAmanecerLabWorkspace = {
    load: function () { return loadRemoteWorkspace({ silent: false }); },
    saveNow: flushRemoteSave,
    refreshFromCanon: refreshFromCanon,
    resetToBaseline: resetToBaseline,
    open: function () {
      var overlay = document.getElementById('naLabWorkspaceOverlay');
      if (overlay) { fillPanel(); overlay.style.display = 'block'; }
    },
    state: function () {
      return {
        revision: state.revision,
        baselineId: state.baselineId,
        sourceRef: state.sourceRef,
        remoteReady: state.remoteReady,
        writerConfigured: hasWriterAccess(state.credentials)
      };
    }
  };
})();
