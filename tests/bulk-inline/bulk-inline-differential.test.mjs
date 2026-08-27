import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '3c0fc3b6c352c2178b6a9caa0346ad3611d6c40f';
const POS_DIR = path.join(ROOT, 'POS');
const CANDIDATE_INDEX = path.join(POS_DIR, 'index.html');

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  return BROWSER_CANDIDATES.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function gitBuffer(revPath) {
  return execFileSync('git', ['show', revPath], {
    cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
  });
}

function createBaseSnapshot() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'na-bulk-inline-base-'));
  const tempPos = path.join(tempRoot, 'POS');
  fs.cpSync(POS_DIR, tempPos, { recursive: true });
  fs.writeFileSync(path.join(tempPos, 'index.html'), gitBuffer(BASE + ':POS/index.html'));
  return { tempRoot, tempPos };
}

function probeExpression() {
  return `JSON.stringify((function () {
    try {
      var boot = window._NA_BOOT || null;
      var verify = boot && boot.lastVerify ? boot.lastVerify : null;
      var posArea = document.getElementById('posArea');
      return {
        ready: document.readyState === 'complete' && !!(boot && boot.started)
          && !!verify && verify.ok === true && Array.isArray(productos)
          && !!posArea && posArea.children.length > 0,
        documentReadyState: document.readyState,
        boot: {
          present: !!boot,
          phase: boot ? boot.phase : null,
          connected: boot ? boot.connected === true : null,
          started: boot ? boot.started === true : null,
          verifyOk: verify ? verify.ok === true : null,
          verifyChecked: verify ? verify.checked : null,
          verifyMissing: verify ? verify.missing.length : null,
          requiredCount: window._NA_LEGACY_GLOBALS
            ? window._NA_LEGACY_GLOBALS.requiredGlobals.length : null
        },
        globals: {
          confirmarVenta: typeof confirmarVenta,
          saveAllData: typeof saveAllData,
          posRender: typeof posRender,
          invRender: typeof invRender,
          abrirCaja: typeof abrirCaja,
          guardarGasto: typeof guardarGasto,
          abrirEvaluacionCredito: typeof abrirEvaluacionCredito,
          securityUnlock: typeof securityUnlock
        },
        coreUtils: {
          fmt: typeof fmt,
          clone: typeof _naClone,
          esc: typeof _naEsc === 'function' ? _naEsc('<b>') : null,
          roundMoney: typeof _naRoundMoney === 'function' ? _naRoundMoney('3.145') : null
        },
        coreState: {
          topbar: !!document.querySelector('.g-topbar'),
          gestureApi: typeof window._naTopbarGesture,
          gestureThreshold: window._naTopbarGesture
            && typeof window._naTopbarGesture.getThreshold === 'function'
            ? window._naTopbarGesture.getThreshold() : null
        },
        ticket: {
          money: typeof _naTkMoney,
          moneyValue: typeof _naTkMoney === 'function' ? _naTkMoney(12.3) : null,
          state: typeof _naF11State,
          zoneDrop: typeof ticketZoneDrop,
          renderTicket: typeof generarTicket
        },
        startup: {
          arraysReady: Array.isArray(productos) && Array.isArray(ventas)
            && Array.isArray(clientes) && Array.isArray(creditos)
            && Array.isArray(gastos) && Array.isArray(cajMovs) && Array.isArray(cart),
          productCount: Array.isArray(productos) ? productos.length : null,
          posCards: posArea ? posArea.children.length : null,
          menuPageActive: !!document.querySelector('#pageMenu.page.active')
        },
        handlers: {
          goPage: typeof goPage,
          confirmarVenta: typeof confirmarVenta,
          abrirEvaluacionCredito: typeof abrirEvaluacionCredito,
          securityUnlock: typeof securityUnlock,
          ticketZoneDrop: typeof ticketZoneDrop
        },
        v9: {
          snapshotKey: typeof _NA_SNAPSHOT_KEY !== 'undefined' ? _NA_SNAPSHOT_KEY : null,
          buildSnapshot: typeof _naBuildSnapshot,
          loadAllData: typeof loadAllData,
          saveAllData: typeof saveAllData,
          snapshotPresent: localStorage.getItem('na_snapshot_v9') !== null
        },
        v10: {
          apiAvailable: typeof _naV10OpenDB,
          dbPromiseNull: typeof _naV10DbPromise !== 'undefined' && _naV10DbPromise === null,
          channelNull: typeof _naV10Channel !== 'undefined' && _naV10Channel === null
        }
      };
    } catch (error) {
      return { ready: false, probeError: String(error && error.stack || error) };
    }
  })())`;
}

async function cdpProbe(browserPath, url, label) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'na-bulk-inline-cdp-'));
  const proc = spawn(browserPath, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--no-sandbox',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanup = () => {
    try { proc.kill(); } catch { /* already closed */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  const browserWs = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ': CDP endpoint timeout')), 20000);
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = /ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/.exec(stderr);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    proc.on('exit', () => reject(new Error(label + ': browser exited before CDP')));
  });

  try {
    const port = new URL(browserWs).port;
    const targets = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:' + port + '/json/list', (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      }).on('error', reject);
    });
    const page = targets.find((target) => target.type === 'page') || targets[0];
    assert.ok(page && page.webSocketDebuggerUrl, label + ': page target');

    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timeout = setTimeout(() => reject(new Error(label + ': runtime timeout')), 90000);
      const pending = new Map();
      const exceptions = [];
      const scriptFailures = [];
      let seq = 0;
      let loadResolve;
      const loaded = new Promise((r) => { loadResolve = r; });
      const send = (method, params = {}) => new Promise((resolveCommand, rejectCommand) => {
        const id = ++seq;
        pending.set(id, { resolveCommand, rejectCommand });
        ws.send(JSON.stringify({ id, method, params }));
      });

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
          const entry = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) entry.rejectCommand(new Error(JSON.stringify(message.error)));
          else entry.resolveCommand(message.result || {});
          return;
        }
        if (message.method === 'Page.loadEventFired') loadResolve();
        if (message.method === 'Runtime.exceptionThrown') {
          const details = message.params.exceptionDetails || {};
          exceptions.push(details.exception?.description || details.text || 'unknown exception');
        }
        if (message.method === 'Network.loadingFailed' && message.params.type === 'Script') {
          scriptFailures.push(message.params.errorText || 'script loading failed');
        }
        if (message.method === 'Network.responseReceived'
          && message.params.type === 'Script' && message.params.response.status >= 400) {
          scriptFailures.push('HTTP ' + message.params.response.status + ' ' + message.params.response.url);
        }
      };
      ws.onerror = () => reject(new Error(label + ': websocket error'));
      ws.onopen = async () => {
        try {
          await send('Page.enable');
          await send('Runtime.enable');
          await send('Network.enable');
          await send('Page.navigate', { url });
          await Promise.race([loaded, new Promise((r) => setTimeout(r, 30000))]);

          let probe = null;
          for (let attempt = 0; attempt < 60; attempt += 1) {
            await new Promise((r) => setTimeout(r, 250));
            const evaluated = await send('Runtime.evaluate', {
              expression: probeExpression(), returnByValue: true, awaitPromise: true,
            });
            const value = evaluated.result && evaluated.result.value;
            if (typeof value === 'string') probe = JSON.parse(value);
            if (probe && probe.ready === true) break;
          }
          clearTimeout(timeout);
          ws.close();
          if (!probe) throw new Error(label + ': no probe result');
          resolve({ probe, exceptions, scriptFailures });
        } catch (error) {
          clearTimeout(timeout);
          try { ws.close(); } catch { /* already closed */ }
          reject(error);
        }
      };
    });
  } finally {
    cleanup();
  }
}

function assertHealthy(result, label) {
  assert.deepEqual(result.exceptions, [], label + ': no JavaScript exceptions');
  assert.deepEqual(result.scriptFailures, [], label + ': no script load failures');
  assert.equal(result.probe.probeError, undefined, label + ': no probe error');
  assert.equal(result.probe.ready, true, label + ': startup complete');
  assert.deepEqual(result.probe.boot, {
    present: true, phase: 'f6', connected: true, started: true,
    verifyOk: true, verifyChecked: 177, verifyMissing: 0, requiredCount: 177,
  });
  assert.ok(Object.values(result.probe.globals).every((value) => value === 'function'), label + ': main globals');
  assert.deepEqual(result.probe.coreUtils, {
    fmt: 'function', clone: 'function', esc: '&lt;b&gt;', roundMoney: 3.15,
  });
  assert.equal(result.probe.coreState.topbar, true, label + ': core/state topbar');
  assert.equal(result.probe.coreState.gestureApi, 'object', label + ': core/state gesture API');
  assert.equal(typeof result.probe.coreState.gestureThreshold, 'number', label + ': gesture threshold');
  assert.deepEqual(result.probe.ticket, {
    money: 'function', moneyValue: 'S/ 12.30', state: 'function',
    zoneDrop: 'function', renderTicket: 'undefined',
  });
  assert.equal(result.probe.startup.arraysReady, true, label + ': startup arrays');
  assert.ok(result.probe.startup.productCount > 0, label + ': products loaded');
  assert.ok(result.probe.startup.posCards > 0, label + ': POS rendered');
  assert.equal(result.probe.startup.menuPageActive, true, label + ': initial page');
  assert.ok(Object.values(result.probe.handlers).every((value) => value === 'function'), label + ': critical handlers');
  assert.deepEqual(result.probe.v9, {
    snapshotKey: 'snapshot_v9', buildSnapshot: 'function', loadAllData: 'function',
    saveAllData: 'function', snapshotPresent: true,
  });
  assert.deepEqual(result.probe.v10, {
    apiAvailable: 'function', dbPromiseNull: true, channelNull: true,
  });
}

function serveRoots(basePos) {
  const roots = { base: basePos, candidate: POS_DIR };
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    const match = /^\/(base|candidate)\/(.*)$/.exec(pathname);
    if (!match) { response.writeHead(404); response.end('not found'); return; }
    const root = roots[match[1]];
    const target = path.resolve(root, match[2] || 'index.html');
    if (target !== root && !target.startsWith(root + path.sep)) {
      response.writeHead(403); response.end('forbidden'); return;
    }
    fs.readFile(target, (error, data) => {
      if (error) { response.writeHead(404); response.end('not found'); return; }
      const contentTypes = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
      };
      response.writeHead(200, {
        'Content-Type': contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
      });
      response.end(data);
    });
  });
  return server;
}

test('differential runtime: base and externalized candidate are equivalent in file:// and http://', { timeout: 300000 }, async (t) => {
  const browser = findBrowser();
  if (!browser) {
    t.skip('ENVIRONMENT_BLOCKED: Chrome/Edge binary not found');
    return;
  }

  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), BASE);
  const snapshot = createBaseSnapshot();
  const server = serveRoots(snapshot.tempPos);
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const urls = {
      file: {
        base: pathToFileURL(path.join(snapshot.tempPos, 'index.html')).href + '?na-test=1',
        candidate: pathToFileURL(CANDIDATE_INDEX).href + '?na-test=1',
      },
      http: {
        base: 'http://127.0.0.1:' + port + '/base/index.html?na-test=1',
        candidate: 'http://127.0.0.1:' + port + '/candidate/index.html?na-test=1',
      },
    };

    for (const protocol of ['file', 'http']) {
      const baseResult = await cdpProbe(browser, urls[protocol].base, protocol + ' base');
      const candidateResult = await cdpProbe(browser, urls[protocol].candidate, protocol + ' candidate');
      assertHealthy(baseResult, protocol + ' base');
      assertHealthy(candidateResult, protocol + ' candidate');
      assert.deepEqual(candidateResult.probe, baseResult.probe, protocol + ': runtime invariants');
      assert.deepEqual(candidateResult.exceptions, baseResult.exceptions, protocol + ': JavaScript errors');
      assert.deepEqual(candidateResult.scriptFailures, baseResult.scriptFailures, protocol + ': script failures');
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(snapshot.tempRoot, { recursive: true, force: true });
  }
});
