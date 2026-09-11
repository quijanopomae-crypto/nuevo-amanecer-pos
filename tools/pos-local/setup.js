(() => {
  'use strict';
  const endpoint = 'https://nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev';
  const form = document.getElementById('setupForm');
  const input = document.getElementById('syncToken');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    const token = input.value;
    if (!token || /[\r\n]/.test(token)) { status.textContent = 'Introduce una clave válida.'; return; }
    save.disabled = true;
    status.textContent = 'Comprobando la conexión…';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(endpoint + '/sync/operations/setup-' + crypto.randomUUID(), {
        method: 'GET', headers: { 'x-sync-token': token }, credentials: 'omit', redirect: 'error', signal: abort.signal
      });
      if (response.status === 401) { status.textContent = 'La clave no fue aceptada. Usa el SYNC_TOKEN vigente.'; return; }
      const body = await response.json();
      if (response.status !== 404 || body.error !== 'not_found') { status.textContent = 'No se pudo verificar la conexión. No se guardó la clave.'; return; }
      const result = NuevoAmanecerOutbox.configure({ endpoint, token, remember: true });
      status.textContent = result.configured && result.remembered
        ? 'Conexión verificada y guardada. Ya puedes abrir el POS.'
        : 'La clave es válida, pero el navegador no pudo guardarla. Revisa su almacenamiento.';
    } catch {
      status.textContent = 'No se pudo conectar con la nube. Comprueba internet y vuelve a intentar.';
    } finally {
      clearTimeout(timer); input.value = ''; save.disabled = false;
    }
  });
})();
