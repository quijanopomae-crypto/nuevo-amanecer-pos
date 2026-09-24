(function () {
  'use strict';

  window.__NA_LAB__ = true;
  window.__NA_LAB_SOURCE__ = "f2462f72953ce26c0ab79f2bd39f84f8b3ac8a7d";
  window.__NA_LAB_WRITE_BLOCKED__ = true;

  // Evita que el menú principal aparezca un instante antes de restaurar
  // el módulo que estaba abierto al recargar el LAB.
  var LAB_ROUTE_RESTORE_CLASS = 'lab-route-restoring';
  var LAB_LOCAL_SNAPSHOT_KEY = 'na_snapshot_v9';
  var LAB_SESSION_SNAPSHOT_KEY = 'na_snapshot_v9_session';

  function readInitialLabPage() {
    var raw = null;
    try { raw = localStorage.getItem(LAB_LOCAL_SNAPSHOT_KEY); } catch {}
    if (!raw) {
      try { raw = sessionStorage.getItem(LAB_SESSION_SNAPSHOT_KEY) || sessionStorage.getItem(LAB_LOCAL_SNAPSHOT_KEY); } catch {}
    }
    if (!raw) {
      try {
        var legacy = JSON.parse(localStorage.getItem('na_app_state') || '{}');
        return typeof legacy.currentPage === 'string' ? legacy.currentPage : '';
      } catch {
        return '';
      }
    }
    try {
      var snapshot = JSON.parse(raw);
      var page = snapshot && snapshot.ui && snapshot.ui.currentPage;
      return typeof page === 'string' ? page : '';
    } catch {
      return '';
    }
  }

  var initialLabPage = readInitialLabPage();
  if (initialLabPage && initialLabPage !== 'pageMenu' && /^page[\w-]+$/.test(initialLabPage)) {
    document.documentElement.classList.add(LAB_ROUTE_RESTORE_CLASS);
    document.documentElement.setAttribute('data-lab-restore-page', initialLabPage);
  }

  // El guard corre en <head>. Cuando el DOM termina de parsearse, activa de
  // inmediato la página persistida antes de que la carga asíncrona de datos
  // pueda dejar una pantalla blanca durante varios segundos.
  if (document.documentElement.classList.contains(LAB_ROUTE_RESTORE_CLASS)) {
    document.addEventListener('DOMContentLoaded', function restoreLabPageShell() {
      var pageId = document.documentElement.getAttribute('data-lab-restore-page');
      var target = pageId ? document.getElementById(pageId) : null;
      if (!target) return;
      document.querySelectorAll('.page.active').forEach(function (page) {
        page.classList.remove('active');
      });
      target.classList.add('active');
      var back = document.getElementById('backBtn');
      if (back) back.style.display = 'block';
    }, { once: true });
  }

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
      if (url && method !== 'GET' && method !== 'HEAD') {
        var allowedLabWorkspaceWrite = blockedHosts.has(url.hostname) && url.pathname.startsWith('/lab/workspace/');
        var crossOriginWrite = url.origin !== location.origin;
        if (crossOriginWrite && !allowedLabWorkspaceWrite) {
          console.warn('[NA-LAB] Escritura externa fuera de workspace bloqueada:', method, url.href);
          return Promise.reject(new Error('NA_LAB_EXTERNAL_WRITE_BLOCKED'));
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