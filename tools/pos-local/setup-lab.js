(() => {
  'use strict';
  const endpoint = 'http://127.0.0.1:8787';
  const form = document.getElementById('setupForm');
  const input = document.getElementById('activationSecret');
  const status = document.getElementById('status');
  const detail = document.getElementById('detail');
  const save = document.getElementById('save');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    const secret = input.value;
    if (!secret || /[\r\n]/.test(secret)) {
      status.textContent = 'Clave inválida.';
      status.className = 'err';
      return;
    }
    save.disabled = true;
    status.textContent = 'Activando contra lab Worker…';
    status.className = '';
    detail.textContent = '';
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
        status.textContent = 'Clave de activación rechazada.';
        status.className = 'err';
        return;
      }
      if (!activation.ok || typeof activationBody.session_token !== 'string' || !activationBody.session_token) {
        status.textContent = 'No se pudo crear la sesión lab.';
        status.className = 'err';
        detail.textContent = JSON.stringify(activationBody, null, 2);
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
        status.textContent = 'Sesión ok pero CANON lab no está ACTIVE.';
        status.className = 'err';
        detail.textContent = JSON.stringify(authority, null, 2);
        return;
      }
      if (typeof NuevoAmanecerCanonical === 'undefined' || typeof NuevoAmanecerCanonical.configure !== 'function') {
        status.textContent = 'canonical-client.js no cargó (revisa serve-canon).';
        status.className = 'err';
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
      status.textContent = 'Lab CANON ACTIVE. Binding en localStorage (na_canonical_binding). Abre el POS en esta origin.';
      status.className = 'ok';
      detail.textContent = JSON.stringify({
        endpoint,
        promotion_id: authority.promotion_id,
        authority_epoch: authority.authority_epoch,
        revision: authority.revision,
        mode: authority.mode,
        enabled: NuevoAmanecerCanonical.enabled(),
      }, null, 2);
    } catch (err) {
      status.textContent = 'Error de red / abort. ¿Worker en 8787?';
      status.className = 'err';
      detail.textContent = String(err && err.message || err);
    } finally {
      clearTimeout(timer);
      input.value = '';
      save.disabled = false;
    }
  });
})();
