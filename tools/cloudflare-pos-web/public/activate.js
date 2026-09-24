(() => {
  'use strict';

  const API = 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
  const BINDING_KEY = 'na_canonical_binding';
  const CREDENTIALS_KEY = 'na_cloud_sync_credentials';
  const status = document.getElementById('status');
  const panel = document.getElementById('activatePanel');
  const input = document.getElementById('activationSecret');
  const activateButton = document.getElementById('activateButton');
  const openPos = document.getElementById('openPos');
  const retryButton = document.getElementById('retryButton');

  function setStatus(message, state = '') {
    status.textContent = message;
    status.dataset.state = state;
  }

  function clearSession() {
    localStorage.removeItem(BINDING_KEY);
    localStorage.removeItem(CREDENTIALS_KEY);
  }

  function showActivation(message) {
    setStatus(message, message.includes('incorrecta') || message.includes('falló') ? 'error' : '');
    panel.hidden = false;
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
    localStorage.setItem(BINDING_KEY, JSON.stringify(binding));
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify({ endpoint: API, token }));
  }

  async function fetchAuthority(token) {
    const sessionResponse = await fetch(API + '/auth/session', {
      headers: { authorization: 'Bearer ' + token },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    if (!sessionResponse.ok) throw new Error('SESSION_INVALID');

    const response = await fetch(API + '/read/canonical/status', {
      headers: { authorization: 'Bearer ' + token },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.authority !== 'canonical' || body.mode !== 'ACTIVE' ||
        typeof body.promotion_id !== 'string' || !body.promotion_id ||
        !Number.isSafeInteger(body.authority_epoch) || !Number.isSafeInteger(body.revision)) {
      throw new Error('AUTHORITY_NOT_READY');
    }
    return body;
  }

  async function checkExisting() {
    panel.hidden = true;
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
      setStatus('CANON producción está activo. Puedes abrir el punto de venta.', 'ok');
      openPos.hidden = false;
    } catch {
      clearSession();
      showActivation('La sesión guardada ya no es válida. Activa este navegador nuevamente.');
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
      input.value = '';
      panel.hidden = true;
      retryButton.hidden = true;
      setStatus('Activación correcta. CANON producción está listo.', 'ok');
      openPos.hidden = false;
    } catch {
      showActivation('No se pudo conectar con producción. Comprueba internet y vuelve a intentar.');
    } finally {
      activateButton.disabled = false;
      input.disabled = false;
      input.value = '';
    }
  }

  activateButton.addEventListener('click', activate);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') activate();
  });
  retryButton.addEventListener('click', checkExisting);
  checkExisting();
})();
