(() => {
  'use strict';
  const endpoint = 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev';
  const form = document.getElementById('setupForm');
  const input = document.getElementById('activationSecret');
  const status = document.getElementById('status');
  const save = document.getElementById('save');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;

    const secret = input.value;
    if (!secret || /[\r\n]/.test(secret)) {
      status.textContent = 'Introduce una clave de activación válida.';
      return;
    }

    save.disabled = true;
    status.textContent = 'Activando sesión V1.3…';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20000);

    try {
      const activation = await fetch(endpoint + '/auth/activate', {
        method: 'POST',
        headers: { 'x-activation-secret': secret },
        credentials: 'omit',
        redirect: 'error',
        signal: abort.signal,
      });
      const activationBody = await activation.json().catch(() => ({}));
      if (activation.status === 401) {
        status.textContent = 'La clave de activación no fue aceptada.';
        return;
      }
      if (!activation.ok || typeof activationBody.session_token !== 'string' || !activationBody.session_token) {
        status.textContent = 'No se pudo crear la sesión V1.3.';
        return;
      }

      const token = activationBody.session_token;
      const authorityResponse = await fetch(endpoint + '/read/canonical/status', {
        method: 'GET',
        headers: { authorization: 'Bearer ' + token },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: abort.signal,
      });
      const authority = await authorityResponse.json().catch(() => ({}));
      if (!authorityResponse.ok || authority.authority !== 'canonical' || authority.mode !== 'ACTIVE' ||
          typeof authority.promotion_id !== 'string' || !authority.promotion_id ||
          !Number.isSafeInteger(authority.authority_epoch) || !Number.isSafeInteger(authority.revision)) {
        status.textContent = 'La sesión abrió, pero la autoridad CANON de producción no está lista.';
        return;
      }

      await NuevoAmanecerCanonical.configure({
        endpoint,
        token,
        promotion_id: authority.promotion_id,
        authority_epoch: authority.authority_epoch,
        revision: authority.revision,
      });
      await NuevoAmanecerCanonical.refresh();

      status.textContent = 'V1.3 activada y conectada a CANON. Ya puedes abrir el POS.';
    } catch {
      status.textContent = 'No se pudo conectar con producción. Comprueba internet y vuelve a intentar.';
    } finally {
      clearTimeout(timer);
      input.value = '';
      save.disabled = false;
    }
  });
})();
