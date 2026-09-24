const CACHE_PREFIX = 'nuevo-amanecer-pos-shell-';
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_HASH__`;
const PRECACHE_URLS = [
  './index.html',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/responsive.css',
  './css/print.css',
  './js/core/utils.js',
  './js/sync/outbox.js',
  './js/sync/canonical-client.js',
  './js/sync/canonical-sale-intent.js',
  './js/sync/canonical-sale-outbox.js',
  './js/sync/canonical-sale-projection.js',
  './js/sync/canonical-sale-integration.js',
  './js/sync/canonical-sale-view.js',
  './js/legacy-inline/inline-01.js',
  './js/modules/ticket/legacy.js',
  './js/legacy-inline/inline-02.js',
  './js/modules/ticket/overrides.js',
  './js/legacy-inline/inline-03.js',
  './js/core/state.js',
  './js/legacy-inline/inline-04.js',
  './js/legacy-inline/inline-05.js',
  './js/legacy-inline/inline-06.js',
  './js/legacy-inline/inline-07.js',
  './js/modules/ticket/zones.js',
  './js/legacy-inline/inline-08.js',
  './js/legacy-inline/inline-09.js',
  './js/legacy-inline/inline-10.js',
  './js/legacy-inline/inline-11.js',
  './js/legacy-inline/inline-12.js',
  './js/legacy-inline/inline-13.js',
  './js/modules/ticket/secure-print.js',
  './js/legacy-inline/inline-14.js',
  './js/legacy-inline/inline-15.js',
  './js/legacy-inline/inline-16.js',
  './js/legacy-inline/inline-17.js',
  './js/legacy-inline/inline-18.js',
  './js/compat/legacy-globals.js',
  './js/app.js',
  './js/ocr/vendor/tesseract-6.0.1/tesseract.min.js',
  './js/catalog/reference-catalog-data.js',
  './js/catalog/reference-catalog.js',
  './js/ocr/ocr-extract.js',
  './js/ocr/ocr-parse.js',
  './js/ocr/ocr-reference-matcher.js',
  './js/ocr/ocr-purchase-engine.js',
  './js/ocr/ocr-purchase-review.js',
  './js/ocr/ocr-purchase-apply.js',
  './js/ocr/ocr-purchase-integration.js',
  './js/ocr/vendor/tesseract-6.0.1/worker.min.js',
  './js/ocr/vendor/tesseract-6.0.1/tesseract-core-simd-lstm.wasm.js',
  './js/ocr/vendor/tesseract-6.0.1/lang/spa.traineddata.gz'
];
const PRECACHE_URLS_ABSOLUTE = new Set(PRECACHE_URLS.map((url) => new URL(url, self.registration.scope).href));
const START_URL = new URL('./index.html', self.registration.scope).href;
const START_PATH = new URL(START_URL).pathname;

function isExcluded(request, url) {
  return request.method !== 'GET'
    || url.origin !== self.location.origin
    || url.pathname === '/health'
    || url.pathname.startsWith('/sync/')
    || url.pathname.startsWith('/read/')
    || request.headers.has('authorization')
    || request.headers.has('x-sync-token')
    || request.headers.has('x-read-token')
    || (request.mode === 'navigate' ? url.pathname !== START_PATH : !PRECACHE_URLS_ABSOLUTE.has(url.href));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    [...PRECACHE_URLS_ABSOLUTE].map((url) => new Request(url, { cache: 'reload' }))
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    ))
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (isExcluded(request, url)) return;

  // Keep HTML and its dependencies pinned until the waiting worker can activate.
  // A missing entry must not pull a different generation from network/other caches.
  const key = request.mode === 'navigate' ? START_URL : request.url;
  event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(key)).then((cached) =>
    cached || new Response('Shell PWA incompleto. Cierre las pestanas del POS y vuelva a abrir con conexion.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    })
  ));
});
