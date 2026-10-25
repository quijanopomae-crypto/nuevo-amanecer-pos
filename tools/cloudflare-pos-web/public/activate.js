(() => {
  'use strict';

  const CONFIG = globalThis.NA_HOSTED_CONFIG || null;
  const API = CONFIG && typeof CONFIG.apiOrigin === 'string' ? CONFIG.apiOrigin.replace(/\/+$/, '') : '';
  const ENVIRONMENT = CONFIG && CONFIG.environment;
  const HOSTED_HOST = CONFIG && CONFIG.hostedHost;
  const BINDING_KEY = 'na_canonical_binding';
  const CREDENTIALS_KEY = 'na_cloud_sync_credentials';
  const status = document.getElementById('status');
  const panel = document.getElementById('activatePanel');
  const input = document.getElementById('activationSecret');
  const activateButton = document.getElementById('activateButton');
  const openPos = document.getElementById('openPos');
  const retryButton = document.getElementById('retryButton');
  const pairPanel = document.getElementById('pairPanel');
  const pairCode = document.getElementById('pairCode');
  const pairButton = document.getElementById('pairButton');

  async function refreshShellOnly() {
    panel.hidden = true;
    openPos.hidden = true;
    retryButton.hidden = true;
    setStatus('Actualizando la interfaz del POS…');

    try {
      if ('serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations
          .filter(registration => typeof registration.scope === 'string' &&
            registration.scope.startsWith(window.location.origin + '/app/'))
          .map(registration => registration.unregister()));
      }

      // Unregistering does not release workers controlling other open tabs.
      // Keep their shell files until the replacement worker activates safely.

      setStatus('Interfaz actualizada. Abriendo el POS con archivos nuevos…', 'ok');
      const nonce = Date.now().toString(36);
      window.location.replace('/app/?shell_refresh=' + encodeURIComponent(nonce));
    } catch (error) {
      console.warn('No se pudo refrescar el shell del POS.', error);
      setStatus('No se pudo actualizar la interfaz automáticamente. Vuelve a intentarlo.', 'error');
      retryButton.hidden = false;
    }
  }

  function validRuntimeConfig() {
    if (!CONFIG || !['production', 'staging'].includes(ENVIRONMENT) || typeof HOSTED_HOST !== 'string' || HOSTED_HOST !== window.location.hostname) return false;
    try {
      const url = new URL(API);
      return url.protocol === 'https:' && url.origin === API && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }

  function environmentName() {
    return ENVIRONMENT === 'staging' ? 'STAGING CANON' : 'CANON producción';
  }

  function setStatus(message, state = '') {
    status.textContent = message;
    status.dataset.state = state;
  }

  // T-47: identidad de la sesión guardada (huella no reversible del token, la misma que calcula
  // POS/js/sync/canonical-client.js). La app reenvía sola lo pendiente del MISMO rol (dueño o
  // empleado, validado por /auth/me) con la sesión nueva, y aparta lo de otro rol. Aquí solo se anota
  // la sesión saliente ANTES de borrarla y la entrante al guardarla (nunca clearSession tras saveSession).
  const IDENTITY_KEY = 'na_session_identity_v1';
  function identityHash(text) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ('00000000' + (h2 >>> 0).toString(16)).slice(-8) + ('00000000' + (h1 >>> 0).toString(16)).slice(-8);
  }
  function noteIdentity(endpoint, token) {
    try {
      if (typeof token !== 'string' || !token) return;
      const key = 'sid:' + identityHash(String(endpoint || '').replace(/\/+$/, '') + '\n' + token);
      let h = null; try { h = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null'); } catch { h = null; }
      // Primera vez (misma regla que la app): la sesión activa y el último rol guardado adoptan lo pendiente antiguo.
      if (!h || h.version !== 1 || !Array.isArray(h.history)) {
        let user = null;
        try { const c = JSON.parse(localStorage.getItem('na_pos_role_v1') || 'null'); if (c && (c.role === 'owner' || c.role === 'empleado')) user = c.role; } catch {}
        h = { version: 1, history: [], first: { at: new Date().toISOString(), key, user } };
      }
      if (h.current === key) return;
      h.current = key; h.history = h.history.concat([{ key, since: new Date().toISOString() }]).slice(-20);
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(h));
    } catch {}
  }
  function noteSavedIdentity() {
    try { const saved = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) || 'null'); if (saved) noteIdentity(saved.endpoint, saved.token); } catch {}
  }

  // Solo se borra la sesión (vínculo, credencial, rol en caché). Lo pendiente NO se borra:
  // na_canonical_sale_outbox_v1 (+ _quarantine, _identity), na_canonical_sale_journal,
  // na_canonical_identity_held_v1, na_sale_note_queue_v1 y na_pos_settings_pending_v1 quedan para
  // revisarse; la app no los envía con otra sesión (los aparta en «Ventas en revisión»).
  function clearSession() {
    noteSavedIdentity();
    localStorage.removeItem(BINDING_KEY);
    localStorage.removeItem(CREDENTIALS_KEY);
    localStorage.removeItem('na_pos_role_v1');
  }

  // T-47 S3 (caché por identidad): con el token nuevo ya guardado, purga la réplica en caché
  // del usuario anterior usando el mismo helper que la app (/app/js/sync/cache-identity-guard.js).
  // Separado de clearSession a propósito. Si no carga, la app purga igual al arrancar.
  function purgePreviousIdentityCache() {
    // El aviso «aparato desconectado» (pos-roles-client.js:74) es de la sesión anterior, no de la recién guardada.
    try { localStorage.removeItem('na_device_revoked_v1'); } catch {}
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      const done = () => { clearTimeout(timer); resolve(); };
      const run = () => {
        try { Promise.resolve(globalThis.NuevoAmanecerCacheIdentity.check('activation')).then(done, done); } catch { done(); }
      };
      if (globalThis.NuevoAmanecerCacheIdentity) { run(); return; }
      const script = document.createElement('script');
      script.src = '/app/js/sync/cache-identity-guard.js';
      script.onload = run;
      script.onerror = done;
      document.head.appendChild(script);
    });
  }

  function showActivation(message) {
    setStatus(message, message.includes('incorrecta') || message.includes('falló') ? 'error' : '');
    panel.hidden = false;
    if (pairPanel) pairPanel.hidden = false;
    openPos.hidden = true;
    retryButton.hidden = false;
    input.focus();
  }

  function saveSession(token, authority) {
    const binding = {
      endpoint: API,
      promotion_id: authority.promotion_id,
      authority_epoch: authority.authority_epoch,
      revision: authority.revision,
    };
    noteSavedIdentity();
    localStorage.setItem(BINDING_KEY, JSON.stringify(binding));
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ endpoint: API, token }));
    noteIdentity(API, token);
  }

  async function fetchAuthority(token) {
    const sessionResponse = await fetch(API + '/auth/session', {
      headers: { authorization: 'Bearer ' + token },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!sessionResponse.ok) {
      const invalid = new Error('SESSION_INVALID');
      invalid.status = sessionResponse.status;
      throw invalid;
    }

    const response = await fetch(API + '/read/canonical/status', {
      headers: { authorization: 'Bearer ' + token },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      const denied = new Error('SESSION_REJECTED');
      denied.status = response.status;
      throw denied;
    }
    if (!response.ok || body.authority !== 'canonical' || body.mode !== 'ACTIVE' ||
        typeof body.promotion_id !== 'string' || !body.promotion_id ||
        !Number.isSafeInteger(body.authority_epoch) || !Number.isSafeInteger(body.revision)) {
      throw new Error('AUTHORITY_NOT_READY');
    }
    return body;
  }

  async function checkExisting() {
    panel.hidden = true;
    if (pairPanel) pairPanel.hidden = true;
    openPos.hidden = true;
    retryButton.hidden = true;
    setStatus('Comprobando sesión de este navegador…');

    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (!saved || saved.endpoint !== API || typeof saved.token !== 'string' || !saved.token) {
      clearSession();
      showActivation('Este navegador todavía no está activado.');
      return;
    }

    try {
      const authority = await fetchAuthority(saved.token);
      saveSession(saved.token, authority);
      setStatus(environmentName() + ' está activo. Puedes abrir el punto de venta.', 'ok');
      openPos.hidden = false;
    } catch (error) {
      // SPEC-891: solo un 401/403 real del servidor invalida la sesión guardada. Un fallo de red, un tiempo
      // de espera o CANON aún no listo la conservan (borrarla dejaba lo pendiente sin poder reenviarse solo).
      if (error && (error.status === 401 || error.status === 403)) {
        clearSession();
        showActivation('La sesión guardada ya no es válida. Activa este navegador nuevamente.');
        return;
      }
      setStatus('No se pudo comprobar la sesión ahora (sin conexión o CANON no responde). La sesión guardada se conserva; vuelve a intentarlo.', 'error');
      retryButton.hidden = false;
    }
  }

  async function activate() {
    const secret = input.value;
    if (!secret || /[\r\n]/.test(secret)) {
      showActivation('Ingresa una clave de activación válida.');
      return;
    }
    activateButton.disabled = true;
    input.disabled = true;
    setStatus('Activando sesión segura…');
    try {
      const response = await fetch(API + '/auth/activate', {
        method: 'POST',
        headers: { 'x-activation-secret': secret },
        credentials: 'omit',
        redirect: 'error',
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        showActivation('La clave de activación es incorrecta.');
        return;
      }
      if (!response.ok || typeof body.session_token !== 'string' || !body.session_token) {
        showActivation('La activación falló. Vuelve a intentarlo.');
        return;
      }
      const authority = await fetchAuthority(body.session_token);
      saveSession(body.session_token, authority);
      localStorage.removeItem('na_pos_role_v1');
      await purgePreviousIdentityCache();
      input.value = '';
      panel.hidden = true;
      retryButton.hidden = true;
      setStatus('Activación correcta. ' + environmentName() + ' está listo.', 'ok');
      openPos.hidden = false;
    } catch {
      showActivation('No se pudo conectar con ' + environmentName() + '. Comprueba internet y vuelve a intentar.');
    } finally {
      activateButton.disabled = false;
      input.disabled = false;
      input.value = '';
    }
  }

  // Etapa 2 (G): un aparato de empleado se vincula con un código de un solo uso creado por el dueño.
  async function pair() {
    const code = String(pairCode.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 10) { showActivation('Escribe el código completo (10 letras y números).'); return; }
    pairButton.disabled = true; pairCode.disabled = true;
    setStatus('Vinculando este aparato…');
    try {
      const response = await fetch(API + '/auth/pair', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', redirect: 'error',
        body: JSON.stringify({ code }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) { showActivation('El código es incorrecto o ya venció. Pide uno nuevo al dueño.'); return; }
      if (!response.ok || typeof body.session_token !== 'string' || !body.session_token) { showActivation('La vinculación falló. Vuelve a intentarlo.'); return; }
      const authority = await fetchAuthority(body.session_token);
      saveSession(body.session_token, authority);
      try { localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'empleado', at: Date.now() })); } catch {}
      await purgePreviousIdentityCache();
      panel.hidden = true; if (pairPanel) pairPanel.hidden = true; retryButton.hidden = true;
      setStatus('Aparato de empleado vinculado. ' + environmentName() + ' está listo.', 'ok');
      openPos.hidden = false;
    } catch {
      showActivation('No se pudo conectar con ' + environmentName() + '. Comprueba internet y vuelve a intentar.');
    } finally {
      pairButton.disabled = false; pairCode.disabled = false; pairCode.value = '';
    }
  }
  if (pairButton) {
    pairButton.addEventListener('click', pair);
    pairCode.addEventListener('keydown', event => { if (event.key === 'Enter') pair(); });
  }
  activateButton.addEventListener('click', activate);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') activate();
  });
  retryButton.addEventListener('click', checkExisting);
  const params = new URLSearchParams(window.location.search);
  if (!validRuntimeConfig()) {
    clearSession();
    panel.hidden = true;
    openPos.hidden = true;
    retryButton.hidden = true;
    input.disabled = true;
    activateButton.disabled = true;
    setStatus('Configuración segura del entorno no disponible. El POS permanece bloqueado.', 'error');
  } else if (params.get('refresh-shell') === '1') refreshShellOnly();
  else checkExisting();
})();
