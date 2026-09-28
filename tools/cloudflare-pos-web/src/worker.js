function withNoStore(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
  headers.set('Pragma', 'no-cache');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function runtimeConfig(request, env) {
  const environment = String(env.HOSTED_ENVIRONMENT || '');
  const apiOrigin = String(env.CANON_API_ORIGIN || '').replace(/\/+$/, '');
  let api;
  try { api = new URL(apiOrigin); } catch { api = null; }
  const valid = ['production', 'staging'].includes(environment) &&
    api && api.protocol === 'https:' && api.origin === apiOrigin &&
    !api.username && !api.password && !api.search && !api.hash;

  if (!valid) {
    return withNoStore(new Response(
      "throw new Error('NA_HOSTED_CONFIG_INVALID');\n",
      { status: 503, headers: { 'Content-Type': 'application/javascript; charset=utf-8' } }
    ));
  }

  const hostedHost = new URL(request.url).hostname;
  const body = 'globalThis.NA_HOSTED_CONFIG=Object.freeze(' +
    JSON.stringify({ environment, apiOrigin, hostedHost }) + ');\n';
  return withNoStore(new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/runtime-config.js') return runtimeConfig(request, env);
    if (url.pathname === '/') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/index.html';
      return withNoStore(await env.ASSETS.fetch(new Request(assetUrl, request)));
    }
    if (url.pathname === '/app' || url.pathname === '/app/') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/app/index.html';
      return withNoStore(await env.ASSETS.fetch(new Request(assetUrl, request)));
    }
    const response = await env.ASSETS.fetch(request);
    return (url.pathname.startsWith('/app/') || url.pathname === '/activate.js' || url.pathname === '/index.html')
      ? withNoStore(response)
      : response;
  },
};
