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

function log(msg) { process.stderr.write('[adv-runner] ' + msg + '\n'); }

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
      this.ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
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

const MY_DONE = "window.__TEST_REPORT ? JSON.stringify(window.__TEST_REPORT) : null";

test('v10 stock physical units ADVERSARIAL (headless Chrome, CDP)', async () => {
  const watchdog = setTimeout(() => { process.stderr.write('[adv-runner] WATCHDOG TIMEOUT — force exit\n'); process.exit(2); }, 150000);
  assert.ok(fs.existsSync(CHROME), 'Chrome not found at ' + CHROME);
  log('step: start');
  const server = createServer(WORKTREE);
  const port = await listen(server);
  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'na-v10-adv-'));
  log('step: chrome spawn, port=' + port + ' debug=' + debugPort);
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
    log('step: devtools up');
    wsUrl = await getPageWs(debugPort);
    const cdp = new Cdp(wsUrl);
    await cdp.connect();
    log('step: cdp connected');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/v10-stock-adversarial.html?auto=1` });
    log('step: navigated, waiting readyState');
    await poll(async () => {
      try { const s = await evaluate(cdp, 'document.readyState'); return s === 'complete' ? s : null; } catch (e) { return null; }
    }, 15000, 200);
    log('step: readyState complete (or poll timeout), waiting report');
    const raw = await poll(async () => {
      try { return await evaluate(cdp, MY_DONE); } catch (e) { return null; }
    }, 120000, 500);
    log('step: report poll finished, raw=' + (raw ? String(raw).length + ' chars' : 'null'));
    cdp.close();
    if (!raw) { out.error = 'TIMEOUT_WAITING_REPORT'; }
    else { try { out.report = JSON.parse(raw); } catch (e) { out.error = 'UNPARSEABLE_REPORT: ' + String(raw).slice(0, 2000); } }
  } catch (e) {
    out.fatal = { message: e.message || String(e), stack: (e.stack || '').slice(0, 1200) };
  } finally {
    try { chrome.kill(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { out.cleanupError = String(e); }
    server.close();
  }

  fs.writeFileSync(path.join(__dirname, 'v10-stock-adversarial-results.json'), JSON.stringify(out, null, 2));
  const report = out.report;
  const summary = report
    ? { status: report.status, pass: report.stats?.pass, fail: report.stats?.fail, hfail: report.stats?.hfail, v9Untouched: report.v9Untouched, cases: (report.cases || []).map((c) => ({ n: c.n, key: c.key, verdict: c.verdict })) }
    : null;
  process.stdout.write('\n===ADVERSARIAL_SUMMARY===\n' + JSON.stringify(summary || out, null, 2) + '\n===END_SUMMARY===\n');
  clearTimeout(watchdog);
  assert.ok(report, 'adversarial harness did not produce a report: ' + JSON.stringify(out.fatal || out.error || out));
  assert.strictEqual(report.status, 'PASS', 'adversarial harness reported failure: ' + JSON.stringify(summary));
  assert.strictEqual(report.stats?.pass, 10, 'adversarial pass count mismatch: ' + JSON.stringify(summary));
  assert.strictEqual(report.stats?.fail, 0, 'adversarial product failures detected: ' + JSON.stringify(summary));
  assert.strictEqual(report.stats?.hfail, 0, 'adversarial harness failures detected: ' + JSON.stringify(summary));
  assert.strictEqual(report.v9Untouched, true, 'adversarial harness touched V9: ' + JSON.stringify(summary));
});
