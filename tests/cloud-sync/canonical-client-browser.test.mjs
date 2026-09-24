import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Adapted (not imported: those files register their own tests) from
// tools/cloudflare-lab/test/pwa-browser.test.mjs and
// tests/ui-polish/full-page-chrome-real-browser.test.mjs.
// Run only after POS/js/sync/canonical-client.js exists:
// node --test tests/cloud-sync/canonical-client-browser.test.mjs
// No CLI/environment endpoint or credentials; stdout only, no screenshots/files.
// Module geometry is not a claim of physical Android or manual Chrome coverage.
// Contract assumptions intentionally asserted (not inferred from implementation):
// binding contains the non-secret configure fields; tokens survive reload in
// sessionStorage; snapshot rows retain A6 public column names; history shows source
// payment IDs and ISO dates/timestamp. POS checks startup/viewport, not menu wiring.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CONTRACT = 'a6-gate-c-v1';
const BINDING_KEY = 'na_canonical_binding';
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1366, 1920];
const APPROVED_TEMP = 'C:\\Users\\ELISER~1\\AppData\\Local\\Temp\\opencode';
const MODULE = path.join(REPO, 'POS', 'js', 'sync', 'canonical-client.js');
const INERT_MARKUP = '<img src=x onerror="window.__gateCXss=1">';
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const CHROME = CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'],
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(fixture) {
  const requests = [];
  const errors = [];
  const state = { fault: null, faultHits: 0, moduleServed: false, holdReads: false, releaseReads: null };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      requests.push({ method: req.method, path: url.pathname, search: url.search });
      if (url.pathname === '/gate-c-module.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gate C</title><div id="credits"></div><script type="module" src="/POS/js/sync/canonical-client.js"></script>`);
        return;
      }
      if (url.pathname === '/gate-c-bootstrap.html') {
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end('<!doctype html><title>Gate C bootstrap (no SUT)</title>');
        return;
      }
      if (url.pathname.startsWith('/fixture/')) {
        // Browser may read only. Fixture setup commands never pass this bridge.
        if (!['GET', 'OPTIONS'].includes(req.method) || !/^\/fixture\/read\/canonical\/(products|customers|credits|credit-payments|status)$/.test(url.pathname)) {
          res.writeHead(403).end('Gate C bridge is read-only');
          return;
        }
        if (state.holdReads) await new Promise(resolve => { state.releaseReads = resolve; });
        if (state.fault && url.pathname.endsWith('/credit-payments')) {
          state.faultHits++;
          if (state.fault === '503') {
            res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"gate_c_injected_read_failure"}');
          } else {
            res.writeHead(200, { 'content-type': 'application/json' }).end('{broken-json');
          }
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const upstream = await fixture.fetch(`http://localhost${url.pathname.slice('/fixture'.length)}${url.search}`, {
          method: req.method,
          headers: req.headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
        });
        res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      const absolute = path.resolve(REPO, `.${decodeURIComponent(url.pathname)}`);
      const posRoot = `${path.join(REPO, 'POS')}${path.sep}`;
      if (!absolute.startsWith(posRoot) || !existsSync(absolute) || !statSync(absolute).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      if (absolute === MODULE) state.moduleServed = true;
      res.writeHead(200, { 'content-type': MIME.get(path.extname(absolute).toLowerCase()) || 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(absolute).pipe(res);
    } catch (error) {
      errors.push(String(error));
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'local_fixture_failure', detail: String(error) }));
    }
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  return { server, port: server.address().port, requests, errors, state };
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HARNESS_FAILURE: CDP connect timeout')), 10000);
      this.socket.onopen = () => { clearTimeout(timer); resolve(); };
      this.socket.onerror = () => { clearTimeout(timer); reject(new Error('HARNESS_FAILURE: Chrome CDP connection failed')); };
      this.socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        if (!message.id) {
          for (const handler of this.handlers.get(message.method) || []) handler(message.params);
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      };
      this.socket.onclose = () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('HARNESS_FAILURE: CDP connection closed'));
        }
        this.pending.clear();
      };
    });
  }
  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`HARNESS_FAILURE: CDP timeout ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket?.close(); } catch {} }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Page evaluation failed');
  return result.result?.value;
}

async function waitFor(client, expression, message, attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { if (await evaluate(client, expression)) return; } catch (error) {
      if (String(error).includes('HARNESS_FAILURE')) throw error;
    }
    await sleep(100);
  }
  throw new Error(message);
}

async function navigate(client, url) {
  // Set a per-document marker before navigation; polling the old realm must not
  // yield a false reload PASS just because its readyState is already complete.
  await evaluate(client, 'window.__gateCOldDocument=true');
  await client.send('Page.navigate', { url });
  await waitFor(client, `!window.__gateCOldDocument && location.href===${JSON.stringify(url)} && document.readyState==='complete'`, 'new document did not complete navigation');
}

async function reload(client) {
  await evaluate(client, 'window.__gateCOldDocument=true');
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `!window.__gateCOldDocument && document.readyState==='complete'`, 'new document did not complete reload');
}

function forbiddenApi(request) {
  if (/\.(?:js|css|html|json|png|svg|webmanifest)$/i.test(request.path)) return false;
  return /\/read\/(?!canonical\/)|\/sync\/|\/imports?\/|\/commands\/|\/staging(?:\/|$)/i.test(request.path);
}

async function pageTarget(debugPort) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const target = targets.find((entry) => entry.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await sleep(100);
  }
  throw new Error('Chrome did not expose a page target');
}

function browserCall(source) {
  return `(async()=>{try{return {ok:true,value:await (${source})};}catch(error){return {ok:false,name:error?.name,message:String(error?.message||error)}}})()`;
}

function binding(endpoint, control) {
  return {
    endpoint,
    deviceId: 'gate-c-browser-device',
    promotion_id: control.active_promotion_id,
    authority_epoch: Number(control.authority_epoch),
    revision: Number(control.revision),
  };
}

test('Gate C browser: cliente canónico aislado, fail-closed e integrado al arranque POS', { timeout: 180000 }, async (t) => {
  const cases = [
    ['C00', 'fixture + Chrome CDP', 'module exists; fresh approved TEMP', 'synthetic A6 freeze/promote', 'read-only fixture and connected Chrome'],
    ['C01', 'module', 'binding preseeded; no tokens durable', CONTRACT, 'contract exposed; enabled; configure succeeds'],
    ['C02', 'module', 'public canonical endpoints', 'refresh four canonical routes', '28 products, 1 customer, 1 credit, 3 payments; exact dates/centavos'],
    ['C03', 'module', 'snapshot loaded', 'renderCredits twice', 'visible complete history, unknown date, text-safe and no duplicate history'],
    ...WIDTHS.map(w => [`C04-${w}`, 'module', 'credits rendered', { width: w }, 'visible history; no horizontal document overflow']),
    ['C05', 'module', 'read-only authority', 'unsupported/invalid actions and sale.create twice', 'every call throws synchronously; zero writes'],
    ['C06', 'module', 'successful snapshot', 'two simultaneous refresh calls', 'same snapshot, unique rows; no writes'],
    ['C07', 'module', 'valid binding except older epoch', 'configure + refresh', 'stale binding rejected; sale blocked'],
    ['C08', 'module', 'valid binding, CDP network offline', 'refresh', 'rejection; no writable fallback; recovery after reconnect'],
    ['C09', 'module', 'successful snapshot', '503 then malformed JSON in payments read', 'reject incomplete refresh; no mixed rows; retry recovers'],
    ['C10', 'module', 'configured client', 'reload without reseeding', 'binding survives; no tokens in localStorage or public snapshot'],
    ['C11', 'POS index', 'existing nonsecret binding, session credentials', 'normal navigation (no manual import or refresh)', 'canonical startup reads; no legacy/staging requests'],
    ...WIDTHS.map(w => [`C12-${w}`, 'POS index', 'normal canonical startup', { width: w }, 'no horizontal overflow; canonical state retained']),
    ['C13', 'two tabs', 'shared localStorage, independent session', 'new target bootstrap then module navigation', 'binding restored; no copied secrets; writer denied in both tabs'],
    ['C15', 'POS persistent storage', 'clean canonical cache', 'remote load then reload while canonical reads are held', 'remote snapshot persists and renders from local storage before revalidation completes'],
    ['C14', 'fixture/browser', 'all scenarios complete', 'inspect network, console and financial tables', 'no legacy/staging fallback; no writes; no uncaught JS errors'],
  ].map(([ID, scope, precondition, input, expected]) => ({ ID, environment: `Chrome headless / CDP / ${scope} / local SQLite`, precondition, input, expected, observed: 'not executed', status: 'PENDING', evidence: null }));
  cases.push(...[
    ['C-FIN', 'financial success, double-submit sale and financial rollback', 'BLOCKED: no writable authority in this run'],
    ['C-REST', 'process restart, localStorage quota failure, empty dataset, extreme overflow amounts, physical Android/manual Chrome', 'not implemented by this focused browser harness'],
  ].map(([ID, input, observed]) => ({ ID, environment: 'not executed', precondition: 'additional authorization/harness needed', input, expected: 'separate verification', observed, status: 'PENDING', evidence: null })));
  let current = cases[0];
  let fixture, local, browser, client, profile, secondClient, secondId;
  let classification = 'PENDING', cleanup = 'not needed';
  const blocked = [], network = [], consoleErrors = [], harnessErrors = [];
  const begin = (id) => { current = cases.find(c => c.ID === id); };
  const passed = (observed) => { current.observed = observed; current.status = 'PASS'; current.evidence = 'measured by CDP/fixture in this run'; };
  const expectDenied = async (action, tab = client) => {
    const result = await evaluate(tab, `(()=>{try{window.NuevoAmanecerCanonical.assertAction(${JSON.stringify(action)});return {threw:false};}catch(e){return {threw:true,name:e.name,message:String(e.message)}}})()`);
    assert.equal(result.threw, true, `assertAction must throw synchronously: ${String(action)}`);
    return result;
  };
  async function instrument(tab) {
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Network.enable');
    await tab.send('Network.setCacheDisabled', { cacheDisabled: true });
    await tab.send('Network.setBypassServiceWorker', { bypass: true });
    tab.on('Runtime.exceptionThrown', e => consoleErrors.push(e.exceptionDetails.exception?.description || e.exceptionDetails.text));
    tab.on('Fetch.requestPaused', ({ requestId, request }) => {
      (async () => {
        const url = new URL(request.url);
        // Do not log credential-bearing query strings/headers.
        network.push({ method: request.method, origin: url.origin, path: url.pathname });
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
          blocked.push({ origin: url.origin, path: url.pathname });
          await tab.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        } else await tab.send('Fetch.continueRequest', { requestId });
      })().catch(error => harnessErrors.push(String(error)));
    });
    await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  }
  try {
    if (!existsSync(MODULE)) {
      current.observed = 'BLOCKED: planned canonical-client.js does not exist; no browser or fixture started';
      t.skip(current.observed);
      return;
    }
    assert.ok(CHROME, `HARNESS_FAILURE: local Google Chrome is required: ${JSON.stringify(CHROME_CANDIDATES)}`);
    assert.equal(typeof WebSocket, 'function', 'HARNESS_FAILURE: Node with global WebSocket and node:sqlite required');
    assert.ok(existsSync(APPROVED_TEMP) && statSync(APPROVED_TEMP).isDirectory(), 'HARNESS_FAILURE: approved TEMP unavailable');
    const { a6Fixture, response, READER, syntheticRows } = await import('./a6-fixture.mjs');
    // a6Fixture uses workerFixture + real SQLite :memory:; never a deployment.
    const rows = syntheticRows();
    rows.find(r => r.entity_type === 'customers').payload.nombre += ` ${INERT_MARKUP}`;
    fixture = await a6Fixture(t, { rows });
    await response(await fixture.freeze('gate-c-freeze'), 201);
    await response(await fixture.promote(), 201);
    const control = fixture.control();
    assert.equal(control.mode, 'CANONICAL_READ_ONLY');
    local = await startServer(fixture);
    const origin = `http://127.0.0.1:${local.port}`;
    const endpoint = `${origin}/fixture`;
    const expectedBinding = binding(endpoint, control);
    const credentials = { ...expectedBinding, token: 'gate-c-session-write-token' };
    const configure = () => evaluate(client, `window.NuevoAmanecerCanonical.configure(${JSON.stringify(credentials)})`);
    const debugPort = await freePort();
    profile = mkdtempSync(path.join(APPROVED_TEMP, 'na-gate-c-chrome-'));
    // The closed loopback proxy is a second, process-wide deny layer, including
    // workers/background requests not intercepted by this page's Fetch domain.
    // Port is reserved by a local server which immediately destroys sockets.
    const denyProxy = net.createServer(socket => socket.destroy());
    await new Promise((resolve, reject) => denyProxy.listen(0, '127.0.0.1', resolve).once('error', reject));
    t.after(() => new Promise(resolve => denyProxy.close(resolve)));
    browser = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-quic',
      '--disable-features=DnsOverHttps,MediaRouter', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      `--proxy-server=http://127.0.0.1:${denyProxy.address().port}`, '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', error => harnessErrors.push(String(error)));
    const target = await pageTarget(debugPort);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await instrument(client);
    await client.send('Page.navigate', { url: `${origin}/gate-c-bootstrap.html` });
    // Seed only the non-secret binding before navigating to either tested application page.
    await waitFor(client, `location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`, 'HARNESS_FAILURE: bootstrap did not load');
    assert.deepEqual(await evaluate(client, `({local:localStorage.length,session:sessionStorage.length})`), { local: 0, session: 0 });
    await evaluate(client, `localStorage.setItem(${JSON.stringify(BINDING_KEY)},${JSON.stringify(JSON.stringify(expectedBinding))});true`);
    passed({ mode: control.mode, counts: fixture.counts(), freshStorage: true, chrome: CHROME });
    begin('C01');
    await navigate(client, `${origin}/gate-c-module.html?seeded=1`);
    await waitFor(client, `document.readyState==='complete'&&!!window.NuevoAmanecerCanonical`, 'canonical client module did not initialize');

    assert.equal(await evaluate(client, `window.NuevoAmanecerCanonical.CONTRACT`), CONTRACT);
    assert.equal(await evaluate(client, `window.NuevoAmanecerCanonical.enabled()`), true);
    const configured = await evaluate(client, browserCall(`window.NuevoAmanecerCanonical.configure(${JSON.stringify(credentials)})`));
    assert.equal(configured.ok, true, configured.message);
    passed({ contract: CONTRACT, enabled: true, configure: configured.ok });

    begin('C02');
    const refreshed = await evaluate(client, browserCall('window.NuevoAmanecerCanonical.refresh()'));
    assert.equal(refreshed.ok, true, refreshed.message);
    const snapshot = await evaluate(client, `window.NuevoAmanecerCanonical.snapshot()`);
    assert.deepEqual({ authority: snapshot.authority, promotion_id: snapshot.promotion_id, authority_epoch: snapshot.authority_epoch, revision: snapshot.revision }, {
      authority: 'canonical', promotion_id: control.active_promotion_id, authority_epoch: Number(control.authority_epoch), revision: Number(control.revision),
    });
    assert.deepEqual([snapshot.products.length, snapshot.customers.length, snapshot.credits.length, snapshot.payments.length], [28, 1, 1, 3]);
    assert.deepEqual([...snapshot.payments].sort((a,b) => a.source_payment_id.localeCompare(b.source_payment_id)).map(p => [p.source_payment_id, p.amount_cents, p.payment_date, p.payment_timestamp, p.date_precision]), [
      ['PAY:0', 100, null, null, 'UNKNOWN'],
      ['PAY:1', 100, '2026-02-28', null, 'DATE'],
      ['PAY:2', 100, '2026-03-01', '2026-02-28T22:04:05.000-05:00', 'TIMESTAMP'],
    ]);
    const firstProduct = snapshot.products.find(p => p.product_id === '00000');
    assert.deepEqual([firstProduct.cost_cents, firstProduct.price_cents, firstProduct.current_stock_quantity], [29, 1234, -2.75]);
    assert.equal(snapshot.products.find(p => p.product_id === '00001').current_stock_quantity, 0);
    assert.equal(snapshot.credits[0].current_balance_cents, 700);

    const readPaths = local.requests.filter((entry) => entry.path.startsWith('/fixture/read/canonical/')).map((entry) => entry.path);
    for (const route of ['products', 'customers', 'credits', 'credit-payments']) assert.ok(readPaths.includes(`/fixture/read/canonical/${route}`), `missing canonical read: ${route}`);
    assert.equal(readPaths.some((route) => /legacy|staging/i.test(route)), false);
    assert.equal(local.requests.some((entry) => /\/sync\/operations|\/imports\//i.test(entry.path)), false, 'client must not call legacy sync or staging/import routes');
    passed({ authority: snapshot.authority, generation: snapshot.promotion_id, counts: [28, 1, 1, 3], payments: snapshot.payments.map(p => [p.source_payment_id, p.amount_cents, p.date_precision]), routes: [...new Set(readPaths)] });

    begin('C03');
    const rendered = await evaluate(client, `(()=>{const c=document.getElementById('credits');window.NuevoAmanecerCanonical.renderCredits(c);window.NuevoAmanecerCanonical.renderCredits(c);return {text:c.textContent,visibleText:c.innerText,html:c.innerHTML};})()`);
    for (const expected of ['Cliente sintético', 'PAY:0', 'PAY:1', 'PAY:2', '2026-02-28', '2026-03-01']) assert.match(rendered.text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(rendered.text, /No registrada|fecha desconocida|sin fecha/i, 'unknown payment date must remain visibly unknown');
    assert.match(rendered.visibleText, /No registrada|fecha desconocida|sin fecha/i);
    assert.ok(rendered.visibleText.includes('2026-02-28T22:04:05.000-05:00'), 'timestamp precision must remain visible');
    assert.doesNotMatch(rendered.html, /<script/i, 'synthetic source markup must not become executable markup');
    assert.ok(rendered.text.includes(INERT_MARKUP), 'customer markup must be literal text, not HTML');
    assert.equal(await evaluate(client, `!!window.__gateCXss || !!document.querySelector('#credits img')`), false);
    for (const id of ['PAY:0', 'PAY:1', 'PAY:2']) assert.equal(rendered.text.split(id).length - 1, 1, `${id} must render once after reentry`);
    passed({ visibleText: rendered.visibleText, paymentIdsOnce: true, scriptMarkup: false });

    for (const width of WIDTHS) {
      begin(`C04-${width}`);
      await client.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 844 : 900, deviceScaleFactor: 1, mobile: width <= 430 });
      const observed = await evaluate(client, `(()=>{const c=document.getElementById('credits'),r=c.getBoundingClientRect(),s=getComputedStyle(c);return {width:innerWidth,text:c.innerText.length,ids:['PAY:0','PAY:1','PAY:2'].every(id=>c.innerText.includes(id)),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,visible:r.height>0&&r.width>0&&s.visibility==='visible'&&Number(s.opacity)>0}})()`);
      assert.deepEqual({ width: observed.width, overflow: observed.overflow, visible: observed.visible }, { width, overflow: false, visible: true });
      assert.ok(observed.text > 0);
      assert.equal(observed.ids, true, 'all three histories must be rendered, not hidden DOM text');
      passed(observed);
    }

    begin('C05');
    for (const action of ['credit.create', 'payment.create', 'product.update', '', null]) {
      await expectDenied(action);
    }
    await expectDenied('sale.create');
    await expectDenied('sale.create');
    passed({ attempts: 7, allThrewSynchronously: true, traffic: fixture.count() });

    begin('C06');
    const beforeDuplicate = await evaluate(client, `window.NuevoAmanecerCanonical.snapshot()`);
    const duplicate = await evaluate(client, browserCall(`Promise.all([window.NuevoAmanecerCanonical.refresh(),window.NuevoAmanecerCanonical.refresh()]).then(()=>window.NuevoAmanecerCanonical.snapshot())`));
    assert.equal(duplicate.ok, true, duplicate.message);
    assert.deepEqual(duplicate.value, beforeDuplicate, 'duplicate/reentrant refresh must converge without duplicated rows');
    passed({ sameSnapshot: true, counts: [duplicate.value.products.length, duplicate.value.customers.length, duplicate.value.credits.length, duplicate.value.payments.length] });

    begin('C07');
    const staleConfig = { ...credentials, authority_epoch: expectedBinding.authority_epoch - 1 };
    const stale = await evaluate(client, browserCall(`Promise.resolve(window.NuevoAmanecerCanonical.configure(${JSON.stringify(staleConfig)})).then(()=>window.NuevoAmanecerCanonical.refresh())`));
    assert.equal(stale.ok, false, 'stale authority epoch must reject');
    assert.match(stale.message, /authority|epoch|stale|revision|binding/i);
    await expectDenied('sale.create');
    passed(stale);

    await configure();
    begin('C08');
    await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const offline = await evaluate(client, browserCall('window.NuevoAmanecerCanonical.refresh()'));
    assert.equal(offline.ok, false, 'offline refresh must reject rather than report stale data as refreshed');
    await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await expectDenied('sale.create');
    assert.equal((await evaluate(client, browserCall('window.NuevoAmanecerCanonical.refresh()'))).ok, true, 'online retry must recover');
    passed({ offlineRejected: true, writerDenied: true, onlineRetry: 'recovered' });

    begin('C09');
    const beforeFault = await evaluate(client, `window.NuevoAmanecerCanonical.snapshot()`);
    for (const fault of ['503', 'malformed']) {
      local.state.fault = fault;
      const beforeHits = local.state.faultHits;
      const failed = await evaluate(client, browserCall('window.NuevoAmanecerCanonical.refresh()'));
      assert.ok(local.state.faultHits > beforeHits, `HARNESS_FAILURE: ${fault} injection was not reached`);
      assert.equal(failed.ok, false, `${fault} must reject incomplete refresh`);
      assert.deepEqual(await evaluate(client, `window.NuevoAmanecerCanonical.snapshot()`), beforeFault, `${fault} must not publish a mixed snapshot`);
    }
    local.state.fault = null;
    assert.equal((await evaluate(client, browserCall('window.NuevoAmanecerCanonical.refresh()'))).ok, true);
    passed({ injectedFaults: local.state.faultHits, unchangedOnFailure: true, retry: 'recovered' });

    begin('C10');
    const storage = await evaluate(client, `({binding:JSON.parse(localStorage.getItem(${JSON.stringify(BINDING_KEY)})),local:{...localStorage},session:{...sessionStorage}})`);
    assert.deepEqual(storage.binding, expectedBinding);
    assert.doesNotMatch(JSON.stringify(storage.local), /fixture-read-token|gate-c-session-write-token/);
    assert.doesNotMatch(JSON.stringify(storage.session), /fixture-read-token/);
    assert.match(JSON.stringify(storage.session), /gate-c-session-write-token/);
    assert.doesNotMatch(JSON.stringify(snapshot), /fixture-read-token|gate-c-session-write-token/);

    await reload(client);
    await waitFor(client, `document.readyState==='complete'&&!!window.NuevoAmanecerCanonical`, 'module reload did not initialize');
    assert.equal(await evaluate(client, `window.NuevoAmanecerCanonical.enabled()`), true);
    const afterReload = await evaluate(client, browserCall('window.NuevoAmanecerCanonical.refresh()'));
    assert.equal(afterReload.ok, true, afterReload.message);
    assert.deepEqual(await evaluate(client, `JSON.parse(localStorage.getItem(${JSON.stringify(BINDING_KEY)}))`), expectedBinding);
    passed({ bindingAfterReload: expectedBinding, localSecrets: false, sessionSecrets: true, publicSnapshotSecrets: false });

    begin('C11');
    const posRequestStart = local.requests.length;
    await navigate(client, `${origin}/gate-c-bootstrap.html`);
    await waitFor(client, `document.readyState==='complete'&&location.origin===${JSON.stringify(origin)}`, 'POS cache seed origin unavailable');
    const seeded = await evaluate(client, `new Promise((resolve,reject)=>{const open=indexedDB.open('NuevoAmanecerPOS',1);open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('state'))open.result.createObjectStore('state')};open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put({version:9,updatedAt:'2026-01-01T00:00:00.000Z',appConfig:{},ui:{},locks:{},security:{},data:{productos:[],ventas:[],clientes:[],creditos:[],gastos:[],cajMovs:[],cajEstado:{},cashClosures:[],inventoryMovements:[]},cart:[],canonicalReplica:{schema_version:1,cached_at:'2026-01-01T00:00:00.000Z',promotion_id:${JSON.stringify(control.active_promotion_id)},authority_epoch:Number(${JSON.stringify(control.authority_epoch)}),revision:Number(${JSON.stringify(control.revision)})-1,financial_revision:0,mode:'CANONICAL_READ_ONLY',read_only:true,minimum_client_contract:'a6-gate-p-v1',products:[{product_id:'cache-only',name:'Cache visible',price_cents:500,current_stock_quantity:2}],customers:[],credits:[],credit_payments:[]}},'snapshot_v9');tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);
    assert.equal(seeded, true);
    local.state.holdReads = true;
    await navigate(client, `${origin}/POS/index.html?na-gate-c-browser=1`);
    await waitFor(client, `!!window.NuevoAmanecerCanonical`, 'canonical client unavailable in POS', 300);
    await waitFor(
      client,
      `window.NuevoAmanecerCanonical.sourceState().source==='cache'&&
        window.NuevoAmanecerCanonical.snapshot().products?.[0]?.name==='Cache visible'`,
      'canonical cache itself was not activated',
      300
    );

    const cacheDiag = await evaluate(client, `(()=>({
      source: window.NuevoAmanecerCanonical?.sourceState?.(),
      snapshot: window.NuevoAmanecerCanonical?.snapshot?.(),
      productCards: [...document.querySelectorAll('.product-card .p-name')].map(el=>el.textContent),
      legacyName: window.NuevoAmanecerCanonical?.legacySnapshot?.().products?.[0]?.name,
      posAreaText: document.getElementById('posArea')?.innerText || '',
      hasReadBridge: typeof window._naReadCanonicalReplica,
      hasWriteBridge: typeof window._naWriteCanonicalReplica
    }))()`);
    assert.equal(cacheDiag.source?.source, 'cache', 'C11 cache replica was not activated');
    assert.equal(cacheDiag.snapshot?.products?.length, 1, 'C11 cached product was not loaded');
    assert.equal(cacheDiag.snapshot?.products?.[0]?.name, 'Cache visible', 'C11 canonical name must be preserved');
    assert.equal(cacheDiag.legacyName, 'Cache visible', 'C11 legacy product name must match canonical name');
    assert.ok(cacheDiag.productCards.includes('CACHE VISIBLE'), 'C11 cached product was not rendered after normal POS name normalization');
    const cacheRenderedAt = Date.now();
    assert.equal(local.requests.slice(posRequestStart).some(entry => entry.path.startsWith('/fixture/read/canonical/')), true, 'background revalidation started');
    local.state.holdReads = false; local.state.releaseReads?.();
    await waitFor(client, `window.NuevoAmanecerCanonical.sourceState().source==='remote'&&window.NuevoAmanecerCanonical.snapshot().products.length===28`, 'remote canonical refresh did not replace cache', 300);
    const remoteRefreshCompletedAt = Date.now();
    assert.ok(cacheRenderedAt < remoteRefreshCompletedAt, `CACHE_RENDERED_AT=${cacheRenderedAt} must precede REMOTE_REFRESH_COMPLETED_AT=${remoteRefreshCompletedAt}`);
    const posSnapshot = await evaluate(client, `window.NuevoAmanecerCanonical.snapshot()`);
    assert.deepEqual([posSnapshot.products.length, posSnapshot.customers.length, posSnapshot.credits.length, posSnapshot.payments.length], [28, 1, 1, 3]);
    const posRequests = local.requests.slice(posRequestStart);
    assert.ok(posRequests.some((entry) => entry.path === '/fixture/read/canonical/products'), 'POS startup must perform canonical reads');
    assert.equal(posRequests.some((entry) => forbiddenApi(entry)), false, 'POS startup guard must not fall through to legacy/staging API paths');
    passed({ startupCounts: [28, 1, 1, 3], cacheRenderedAt, remoteRefreshCompletedAt, cacheBeforeRemote: cacheRenderedAt < remoteRefreshCompletedAt, canonicalRequests: posRequests.filter(x => x.path.startsWith('/fixture/read/canonical/')).map(x => x.path) });

    for (const width of WIDTHS) {
      begin(`C12-${width}`);
      await client.send('Emulation.setDeviceMetricsOverride', { width, height: width <= 430 ? 844 : 900, deviceScaleFactor: 1, mobile: width <= 430 });
      const observed = await evaluate(client, `(()=>{goPage('pageClientes');const snapshot=NuevoAmanecerCanonical.snapshot(),list=document.getElementById('cliList'),cards=[...list.querySelectorAll('.client-card')],card=cards[0],name=card?.querySelector('.c-name'),meta=card?.querySelector('.c-meta'),debt=card?.querySelector('.c-deuda'),status=card?.querySelector('.c-status'),visible=el=>{if(!el)return false;const style=getComputedStyle(el),rect=el.getBoundingClientRect();return style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0&&rect.width>0&&rect.height>0};return {width:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth>window.innerWidth,counts:[snapshot.products.length,snapshot.customers.length,snapshot.credits.length,snapshot.payments.length],canonicalLoaded:snapshot.customers.length===1&&snapshot.credits.length===1,listVisible:visible(list),cardCount:cards.length,cardVisible:visible(card),cardText:card?.innerText||'',cardHeight:card?.getBoundingClientRect().height||0,nameVisible:visible(name)&&!!name.innerText.trim(),documentVisible:visible(meta)&&!!meta.innerText.trim(),debtVisible:visible(debt)&&!!debt.innerText.trim(),statusVisible:visible(status)&&!!status.innerText.trim()}})()`);
      assert.equal(observed.width, width);
      assert.equal(observed.overflow, false);
      assert.deepEqual(observed.counts, [28, 1, 1, 3]);
      assert.equal(observed.canonicalLoaded, true, 'canonical customers and credits remain loaded');
      assert.equal(observed.listVisible, true, 'cliList must be visible');
      assert.ok(observed.cardCount > 0, 'cliList must render visible client cards');
      assert.equal(observed.cardVisible, true, 'first client card must be visible');
      assert.ok(observed.cardText.trim().length > 0, 'first client card must contain text');
      assert.ok(observed.cardHeight >= 48, `first client card must not collapse: ${observed.cardHeight}px`);
      for (const field of ['nameVisible', 'documentVisible', 'debtVisible', 'statusVisible']) assert.equal(observed[field], true, `${field} must remain visible`);
      passed(observed);
    }

    begin('C13');
    const created = await client.send('Target.createTarget', { url: `${origin}/gate-c-bootstrap.html` });
    secondId = created.targetId;
    let secondTarget;
    for (let attempt = 0; attempt < 100; attempt++) {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      secondTarget = targets.find(x => x.id === secondId);
      if (secondTarget?.webSocketDebuggerUrl) break;
      await sleep(50);
    }
    assert.ok(secondTarget?.webSocketDebuggerUrl, 'HARNESS_FAILURE: second tab target unavailable');
    secondClient = new CdpClient(secondTarget.webSocketDebuggerUrl);
    await secondClient.connect();
    await instrument(secondClient);
    await waitFor(secondClient, `document.readyState==='complete'&&location.origin===${JSON.stringify(origin)}`, 'HARNESS_FAILURE: second tab bootstrap unavailable');
    const secondStorage = await evaluate(secondClient, `({binding:JSON.parse(localStorage.getItem(${JSON.stringify(BINDING_KEY)})),session:{...sessionStorage}})`);
    assert.deepEqual(secondStorage.binding, expectedBinding);
    assert.doesNotMatch(JSON.stringify(secondStorage.session), /fixture-read-token|gate-c-session-write-token/);
    await navigate(secondClient, `${origin}/gate-c-module.html?tab=2`);
    await waitFor(secondClient, `document.readyState==='complete'&&!!NuevoAmanecerCanonical`, 'second tab module unavailable');
    assert.equal(await evaluate(secondClient, `NuevoAmanecerCanonical.enabled()`), true);
    await expectDenied('sale.create', secondClient);
    await expectDenied('sale.create', client);
    passed({ sharedBinding: true, copiedSessionSecrets: false, saleDeniedBothTabs: true });

    begin('C15');

    // Leave the POS page so its IndexedDB handles are released.
    await navigate(client, `${origin}/gate-c-bootstrap.html?c15-reset=1`);
    await waitFor(
      client,
      `document.readyState==='complete'&&location.origin===${JSON.stringify(origin)}`,
      'C15 reset origin unavailable'
    );

    // Remove only POS snapshots. Preserve canonical binding/configuration.
    const storageReset = await evaluate(client, `new Promise((resolve,reject)=>{
      try{
        localStorage.removeItem('na_snapshot_v9');
        sessionStorage.removeItem('na_snapshot_v9_session');
        const req=indexedDB.deleteDatabase('NuevoAmanecerPOS');
        req.onsuccess=()=>resolve(true);
        req.onerror=()=>reject(req.error||new Error('IDB_DELETE_FAILED'));
        req.onblocked=()=>reject(new Error('IDB_DELETE_BLOCKED'));
      }catch(e){reject(e)}
    })`);
    assert.equal(storageReset, true, 'C15 must start without a canonical snapshot');

    local.state.fault = null;
    local.state.holdReads = false;

    // First genuine online boot: remote authority must create the replica.
    const firstRemoteRequest = local.requests.length;
    await navigate(client, `${origin}/POS/index.html?na-gate-c-persist=1`);

    await waitFor(
      client,
      `window.NuevoAmanecerCanonical?.sourceState?.().source==='remote'&&
        window.NuevoAmanecerCanonical?.snapshot?.().products.length===28&&
        document.querySelectorAll('.product-card').length>0`,
      'C15 first remote boot did not complete',
      300
    );

    const persisted = await evaluate(client, `window._naReadCanonicalReplica().then(r=>({
      exists:!!r,
      promotion_id:r?.promotion_id||null,
      authority_epoch:r?.authority_epoch??null,
      revision:r?.revision??null,
      products:r?.products?.length??null,
      customers:r?.customers?.length??null,
      credits:r?.credits?.length??null,
      payments:r?.credit_payments?.length??null
    }))`);

    assert.equal(persisted.exists, true, 'C15 remote snapshot was not persisted');
    assert.equal(persisted.products, 28);
    assert.equal(persisted.customers, 1);
    assert.equal(persisted.credits, 1);
    assert.equal(persisted.payments, 3);

    assert.equal(
      local.requests.slice(firstRemoteRequest).some(r=>r.path==='/fixture/read/canonical/products'),
      true,
      'C15 first boot must really read remote canonical data'
    );

    // Second boot: keep remote reads pending. The persisted replica must appear first.
    local.state.holdReads = true;
    const reloadRequestStart = local.requests.length;

    await navigate(client, `${origin}/POS/index.html?na-gate-c-persist-reload=1`);

    await waitFor(
      client,
      `window.NuevoAmanecerCanonical?.sourceState?.().source==='cache'&&
        window.NuevoAmanecerCanonical?.snapshot?.().products.length===28&&
        document.querySelectorAll('.product-card').length>0`,
      'C15 persisted replica did not render before remote completion',
      300
    );

    const c15CacheRenderedAt = Date.now();

    assert.equal(
      local.requests.slice(reloadRequestStart).some(r=>r.path.startsWith('/fixture/read/canonical/')),
      true,
      'C15 background revalidation did not start'
    );

    assert.equal(
      local.requests.slice(reloadRequestStart).some(r=>!['GET','OPTIONS'].includes(r.method)),
      false,
      'C15 cache boot must perform no writes'
    );

    local.state.holdReads = false;
    local.state.releaseReads?.();

    await waitFor(
      client,
      `window.NuevoAmanecerCanonical?.sourceState?.().source==='remote'&&
        window.NuevoAmanecerCanonical?.snapshot?.().products.length===28`,
      'C15 reconnect did not revalidate canonical authority',
      300
    );

    const c15RemoteCompletedAt = Date.now();
    assert.ok(c15CacheRenderedAt < c15RemoteCompletedAt, 'C15 cache must render before remote revalidation');

    passed({
      persisted: true,
      counts: [persisted.products,persisted.customers,persisted.credits,persisted.payments],
      cacheBeforeRemote: c15CacheRenderedAt < c15RemoteCompletedAt,
      writesDuringOfflineFirstPaint: 0
    });

    begin('C14');
    assert.deepEqual(local.errors, [], 'local bridge must not fail before SUT');
    assert.deepEqual(harnessErrors, [], 'HARNESS_FAILURE: CDP interception failed');
    assert.deepEqual(consoleErrors, [], 'uncaught browser errors');
    // A blocked external font/CDN is not itself a sync fallback or a product
    // failure. Unexpected API calls are inspected even if interception blocked them.
    assert.deepEqual(network.filter(forbiddenApi), [], 'no legacy/staging/import/write API attempt, including blocked requests');
    assert.deepEqual(network.filter(r => r.path.includes('/read/canonical/') && r.origin !== origin), [], 'canonical reads must target this fixture only');
    const financial = Object.fromEntries(['sales', 'sale_items', 'cash_movements', 'inventory_movements', 'sync_operations'].map(table => [table, fixture.sql(`SELECT COUNT(*) n FROM ${table}`).n]));
    assert.deepEqual(financial, { sales: 0, sale_items: 0, cash_movements: 0, inventory_movements: 0, sync_operations: 0 });
    assert.equal(local.requests.some(forbiddenApi), false);
    assert.equal(local.state.moduleServed, true);
    passed({ blockedNonLoopback: blocked, uncaughtErrors: consoleErrors.length, financial, legacyOrStagingRequests: 0 });
    classification = 'PASS_WITH_PENDING_LIMITATIONS';
  } catch (error) {
    const harnessFailure = current.ID === 'C00' || !local?.state.moduleServed || harnessErrors.length || local.errors.length || /HARNESS_FAILURE/.test(String(error));
    classification = harnessFailure ? 'HARNESS_FAILURE' : 'PRODUCT_FAIL';
    current.status = 'FAIL';
    current.observed = String(error);
    current.evidence = { classification, requests: network, consoleErrors, bridgeErrors: local?.errors, harnessErrors };
    throw error;
  } finally {
    try {
      secondClient?.close();
      if (client && secondId) try { await client.send('Target.closeTarget', { targetId: secondId }); } catch {}
      if (client) try { await client.send('Browser.close'); } catch {}
      client?.close();
      for (let i = 0; browser?.exitCode === null && browser?.signalCode === null && i < 40; i++) await sleep(50);
      if (browser?.exitCode === null && browser?.signalCode === null) browser.kill();
      if (local) {
        local.server.closeAllConnections();
        await new Promise(resolve => local.server.close(resolve));
      }
      if (profile) {
        const absoluteProfile = path.resolve(profile);
        if (!absoluteProfile.startsWith(`${path.resolve(APPROVED_TEMP)}${path.sep}`) || !path.basename(absoluteProfile).startsWith('na-gate-c-chrome-')) throw new Error('unsafe temporary profile cleanup target');
        rmSync(absoluteProfile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        cleanup = 'approved temporary profile removed';
      }
    } catch (error) {
      cleanup = `HARNESS_FAILURE: ${String(error)}`;
      classification = 'HARNESS_FAILURE';
      throw error;
    } finally {
      console.log(JSON.stringify({ TEST_REPORT: { suite: 'Gate C canonical browser', browser: 'Chrome headless via CDP', contract: CONTRACT, classification, cases, falsePositivesDiscarded: [], policies: ['missing module skips before fixture/browser launch', 'harness failure is not product failure', 'blocked external assets are not sync regressions', 'financial success requires separate writable-authority verification'], isolation: { cleanup, storage: 'fresh origin/profile', persistence: 'SQLite :memory:', network: 'loopback-only by Chrome proxy/DNS and CDP Fetch', remote: false, output: 'stdout only' } } }));
    }
  }
});
