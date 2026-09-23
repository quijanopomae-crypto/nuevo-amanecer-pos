(function () {
  'use strict';

  window.__NA_LAB__ = true;
  window.__NA_LAB_SOURCE__ = "f2462f72953ce26c0ab79f2bd39f84f8b3ac8a7d";
  window.__NA_LAB_WRITE_BLOCKED__ = true;

  var blockedHosts = new Set([
    'nuevo-amanecer-sync-lab.nuevo-amanecer-pos.workers.dev'
  ]);
  var originalFetch = window.fetch ? window.fetch.bind(window) : null;

  function methodOf(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (typeof Request !== 'undefined' && input instanceof Request) return String(input.method || 'GET').toUpperCase();
    return 'GET';
  }

  function urlOf(input) {
    try {
      if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url, location.href);
      return new URL(String(input), location.href);
    } catch {
      return null;
    }
  }

  if (originalFetch) {
    window.fetch = function (input, init) {
      var url = urlOf(input);
      var method = methodOf(input, init);
      if (url && blockedHosts.has(url.hostname) && method !== 'GET' && method !== 'HEAD') {
        var allowedLabWorkspaceWrite = url.pathname.startsWith('/lab/workspace/');
        if (!allowedLabWorkspaceWrite) {
          console.warn('[NA-LAB] Escritura cloud fuera de workspace bloqueada:', method, url.href);
          return Promise.reject(new Error('NA_LAB_NON_WORKSPACE_WRITE_BLOCKED'));
        }
      }
      return originalFetch(input, init);
    };
  }

  try {
    localStorage.removeItem('na_cloud_sync_credentials');
  } catch {}

  console.info('[NA-LAB] Entorno aislado activo. Fuente CANON:', window.__NA_LAB_SOURCE__);
})();