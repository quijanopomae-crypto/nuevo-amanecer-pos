import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKTREE = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function log(msg) { process.stderr.write('[runner] ' + msg + '\n'); }

/* ── static HTTP server ── */
function createServer(root) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let filePath = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath));
      if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found: ' + urlPath); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/* ── CDP client ── */
class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.ws = null; }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', (e) => rej(new Error('ws error')), { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws && this.ws.close(); } catch (e) {} }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error('evaluate exception: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
  return r.result ? r.result.value : undefined;
}

async function poll(fn, timeoutMs, intervalMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== null && v !== undefined && v !== '') return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/* ── chrome helpers ── */
function getFreePort() { return new Promise((res) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }

async function waitHttp(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('timeout waiting for ' + url);
}

async function getPageWs(debugPort) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  return page.webSocketDebuggerUrl;
}

/* ── run a harness page and return its JSON report ── */
async function runHarnessPage(debugPort, wsUrl, url, opts) {
  const cdp = new Cdp(wsUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  // wait for document complete
  await poll(async () => {
    try { const s = await evaluate(cdp, 'document.readyState'); return s === 'complete' ? s : null; } catch (e) { return null; }
  }, 15000, 200);
  await new Promise((r) => setTimeout(r, 500));
  if (opts.clickRun) {
    await evaluate(cdp, "(function(){var b=document.getElementById('run');if(b)b.click();return !!b;})()");
  }
  const raw = await poll(async () => {
    try { return await evaluate(cdp, opts.doneExpression); } catch (e) { return null; }
  }, opts.timeout || 60000, 400);
  cdp.close();
  if (!raw) return { error: 'TIMEOUT_WAITING_REPORT', url };
  try { return JSON.parse(raw); } catch (e) { return { error: 'UNPARSEABLE_REPORT', raw: String(raw).slice(0, 2000), url }; }
}

const MY_DONE = "window.__TEST_REPORT ? JSON.stringify(window.__TEST_REPORT) : null";
const REGRESSION_DONE = "(function(){var el=document.getElementById('auto-result');if(!el)return null;var t=(el.textContent||'').trim();if(!t||t==='{\"status\":\"NOT_RUN\"}'||t==='{\"status\":\"RUNNING\"}')return null;try{var o=JSON.parse(t);if(o&&o.status&&(o.status==='PASS'||o.status==='FAIL'||o.status==='ERROR'))return t;}catch(e){}return null;})()";

test('v10 stock physical units + required V10 regressions (headless Chrome, CDP)', async () => {
  assert.ok(fs.existsSync(CHROME), 'Chrome not found at ' + CHROME);
  const server = createServer(WORKTREE);
  const port = await listen(server);
  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'na-v10-stock-'));
  const chromeArgs = [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--no-sandbox',
    '--disable-features=Translate,BackForwardCache,OptimizationHints',
    'about:blank'
  ];
  const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });
  let wsUrl = null;
  const out = { chrome: CHROME, port, debugPort, urlBase: `http://127.0.0.1:${port}` };
  try {
    await waitHttp(`http://127.0.0.1:${debugPort}/json/version`, 20000);
    wsUrl = await getPageWs(debugPort);

    // 1) my harness
    out.myHarness = await runHarnessPage(debugPort, wsUrl, `http://127.0.0.1:${port}/tests/v10-stock-physical-units.html?auto=1`, { doneExpression: MY_DONE, timeout: 90000 });
    // 2) core regression (needs click)
    out.coreRegression = await runHarnessPage(debugPort, wsUrl, `http://127.0.0.1:${port}/tests/persistence-v10-core-regression.html?v=${Date.now()}`, { clickRun: true, doneExpression: REGRESSION_DONE, timeout: 90000 });
    // 3) multitab engine regression (auto)
    out.multitabEngine = await runHarnessPage(debugPort, wsUrl, `http://127.0.0.1:${port}/tests/multitab-persistence-v10-engine.html?auto=1&v=${Date.now()}`, { doneExpression: REGRESSION_DONE, timeout: 120000 });
    // 4) Phase A recovery matrix
    out.phaseARecovery = await runHarnessPage(debugPort, wsUrl, `http://127.0.0.1:${port}/tests/persistence-v10-phase-a-recovery.html?v=${Date.now()}`, { clickRun: true, doneExpression: REGRESSION_DONE, timeout: 120000 });
    // 5) Phase A regression matrix
    out.phaseARegression = await runHarnessPage(debugPort, wsUrl, `http://127.0.0.1:${port}/tests/persistence-v10-phase-a-regression.html?v=${Date.now()}`, { clickRun: true, doneExpression: REGRESSION_DONE, timeout: 120000 });
  } catch (e) {
    out.fatal = { message: e.message || String(e), stack: (e.stack || '').slice(0, 1200) };
  } finally {
    try { chrome.kill(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { out.cleanupError = String(e); }
    server.close();
  }

  const summary = {
    myHarness: out.myHarness && out.myHarness.status !== undefined ? out.myHarness.status : (out.myHarness ? 'ERROR' : 'NOT_RUN'),
    coreRegression: out.coreRegression && out.coreRegression.status !== undefined ? out.coreRegression.status : (out.coreRegression ? 'ERROR' : 'NOT_RUN'),
    multitabEngine: out.multitabEngine && out.multitabEngine.status !== undefined ? out.multitabEngine.status : (out.multitabEngine ? 'ERROR' : 'NOT_RUN'),
    phaseARecovery: out.phaseARecovery && out.phaseARecovery.status !== undefined ? out.phaseARecovery.status : (out.phaseARecovery ? 'ERROR' : 'NOT_RUN'),
    phaseARegression: out.phaseARegression && out.phaseARegression.status !== undefined ? out.phaseARegression.status : (out.phaseARegression ? 'ERROR' : 'NOT_RUN'),
    fatal: out.fatal || null,
  };
  const finalJson = JSON.stringify({ runnerSummary: summary, detail: out });
  fs.writeFileSync(path.join(__dirname, 'v10-stock-run-results.json'), JSON.stringify(out, null, 2));
  process.stdout.write('\n===RUNNER_SUMMARY===\n' + JSON.stringify(summary, null, 2) + '\n===END_SUMMARY===\n');
  for (const [suite, status] of Object.entries(summary)) {
    if (suite === 'fatal') continue;
    assert.strictEqual(status, 'PASS', suite + ' did not pass: ' + JSON.stringify(out[suite] || out.fatal || {}));
  }
});
