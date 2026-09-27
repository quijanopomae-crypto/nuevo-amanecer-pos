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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
