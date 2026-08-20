// run-pos-harness.mjs — driver efímero de pruebas dinámicas del POS Nuevo Amanecer.
// SOLO para testing. NO es producto, NO se commitea, NO se añade a Git.
// Sin dependencias externas: solo node:builtin + WebSocket global (Node >= 22).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = 'C:\\Users\\eliser rusbel quijan\\OneDrive\\Documentos\\POS-WT-CREDITS';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const BROWSER_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let pathname;
        try {
          pathname = decodeURIComponent((req.url || '/').split('?')[0]);
        } catch {
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }
        if (pathname === '/') pathname = '/index.html';
        const filePath = normalize(join(ROOT, pathname));
        if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        try {
          const data = await readFile(filePath);
          res.writeHead(200, {
            'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
          });
          res.end(data);
        } catch {
          res.writeHead(404);
          res.end('Not Found');
        }
      } catch {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function findBrowser() {
  for (const c of BROWSER_CANDIDATES) {
    if (existsSync(c)) return c;
  }
  return null;
}

function launchBrowser(exe, profile) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    child.stderr.on('data', (c) => {
      stderr += c.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) done(null, { child, wsUrl: m[1] });
    });
    child.stdout.on('data', () => {});
    child.on('error', (err) => done(err));
    child.on('exit', (code) => done(new Error('BROWSER_EXITED: ' + code + ' | ' + stderr.slice(-400))));

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill(); } catch {}
        reject(new Error('DEVTOOLS_NOT_FOUND: ' + stderr.slice(-400)));
      }
    }, 30000);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.sendQueue = [];
    this.opened = false;
    this.ws.onopen = () => {
      this.opened = true;
      const q = this.sendQueue;
      this.sendQueue = [];
      for (const p of q) this.ws.send(p);
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const hs = this.handlers.get(msg.method) || [];
        for (const h of hs) h(msg.params, msg.sessionId);
      }
    };
    this.ws.onerror = () => {};
  }
  send(method, params, sessionId) {
    const id = ++this.nextId;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    const payload = JSON.stringify(msg);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.opened) this.ws.send(payload);
      else this.sendQueue.push(payload);
    });
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }
  close() { try { this.ws.close(); } catch {} }
}

// EXTRACTOR GENÉRICO (credits, multitab, phase-a) — expresión exacta, una línea.
const GENERIC_EXTRACTOR = `(function(){var el=document.getElementById('auto-result');var phase=(document.getElementById('status')||{}).textContent||'';if(!el)return JSON.stringify({status:'NO_ELEMENT',phase:phase});var txt=el.textContent.trim();if(!txt)return JSON.stringify({status:'EMPTY',phase:phase});try{var r=JSON.parse(txt);var out={status:r.status,phase:phase};if(typeof r.pass==='number')out.pass=r.pass;if(typeof r.fail==='number')out.fail=r.fail;if(typeof r.total==='number')out.total=r.total;if(r.stats)out.stats=r.stats;var list=r.cases||r.results||[];out.cases=list.map(function(c){return{name:String(c.name||c.n||c.key||c.id),status:(typeof c.status==='string'?c.status:(c.passed?'PASS':'FAIL'))};});if(r.error)out.error=r.error;if(r.isolation){out.isolation={namespaceClean:r.isolation.namespaceClean,realDataUntouched:(r.isolation.realDataUntouched!==undefined?r.isolation.realDataUntouched:r.isolation.realStorageUntouched),cleanupOk:r.isolation.cleanupOk};}return JSON.stringify(out);}catch(e){return JSON.stringify({status:'PARSE_ERROR',phase:phase,head:txt.slice(0,120)});}})()`;

// EXTRACTOR SALE — expresión exacta, una línea.
const SALE_EXTRACTOR = `(function(){var s=(document.getElementById('status')||{}).textContent||'';var t=s.trim();if(t==='APROBADO'||t==='FALLIDO'){var rows=[].slice.call(document.querySelectorAll('#results tr')).map(function(tr){var c=tr.children;return{name:(c[0]||{}).textContent||'',outcome:((c[1]||{}).textContent||'').trim()};});return JSON.stringify({status:(t==='APROBADO'?'PASS':'FAIL'),phase:t,cases:rows});}return JSON.stringify({status:'RUNNING',phase:t});})()`;

async function runHarness(name, path, timeoutMs, extractor, saleMode) {
  const { server, port } = await startServer();
  let profile = null;
  let child = null;
  let cdp = null;
  let targetId = null;
  try {
    const base = 'http://localhost:' + port;
    const url = base + path + '?ts=' + Date.now();
    const exe = findBrowser();
    if (!exe) {
      assert.fail('BROWSER_NOT_FOUND: ' + BROWSER_CANDIDATES.join(' | '));
    }
    console.log('=== ' + name + ' BROWSER ===\n' + exe + '\nurl=' + url);

    profile = mkdtempSync(join(tmpdir(), 'pos-harness-'));
    const launched = await launchBrowser(exe, profile);
    child = launched.child;
    cdp = new Cdp(launched.wsUrl);

    const created = await cdp.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;

    const attached = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached.sessionId;

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    const consoleErrors = [];

    cdp.on('Runtime.exceptionThrown', (p, sid) => {
      if (sid && sid !== sessionId) return;
      const ed = p && p.exceptionDetails;
      const desc = (ed && ((ed.exception && ed.exception.description) || ed.text)) || '';
      if (consoleErrors.length < 80) consoleErrors.push('exception: ' + desc);
    });
    cdp.on('Runtime.consoleAPICalled', (p, sid) => {
      if (sid && sid !== sessionId) return;
      if (p && p.type === 'error') {
        const txt = (p.args || []).map((a) => (a.value !== undefined ? a.value : (a.description || ''))).join(' ');
        if (consoleErrors.length < 80) consoleErrors.push('console.error: ' + txt);
      }
    });

    // Navegar y esperar loadEventFired.
    let navigated = false;
    const loadFired = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('LOAD_TIMEOUT_45S')), 45000);
      cdp.on('Page.loadEventFired', () => {
        if (!navigated) return;
        clearTimeout(t);
        resolve();
      });
    });
    navigated = true;
    await cdp.send('Page.navigate', { url }, sessionId);
    await loadFired;

    // Esperar botón #run.
    const btnStart = Date.now();
    let runReady = false;
    while (Date.now() - btnStart < 30000) {
      const r = await cdp.send('Runtime.evaluate', { expression: '!!document.getElementById("run")', returnByValue: true }, sessionId);
      if (r && r.result && r.result.value === true) { runReady = true; break; }
      await sleep(300);
    }
    if (!runReady) {
      assert.fail('RUN_BUTTON_NOT_FOUND: ' + name + ' | ' + url);
    }

    // Click en #run y verificar disabled.
    const clickExpr = 'document.getElementById("run").click()';
    await cdp.send('Runtime.evaluate', { expression: clickExpr, returnByValue: true }, sessionId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = await cdp.send('Runtime.evaluate', { expression: 'document.getElementById("run").disabled===true', returnByValue: true }, sessionId);
      if (d && d.result && d.result.value === true) break;
      if (attempt < 2) {
        await sleep(500);
        await cdp.send('Runtime.evaluate', { expression: clickExpr, returnByValue: true }, sessionId);
      }
    }

    // Sondear resultado.
    const pollStart = Date.now();
    let last = null;
    let terminal = false;
    while (Date.now() - pollStart < timeoutMs) {
      const r = await cdp.send('Runtime.evaluate', { expression: extractor, returnByValue: true }, sessionId);
      const raw = r && r.result ? r.result.value : undefined;
      let parsed = null;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { parsed = { status: 'PARSE_ERROR', phase: '', raw }; }
      } else {
        parsed = { status: 'PARSE_ERROR', phase: '', raw: String(raw) };
      }
      last = parsed;
      if (parsed.status === 'PASS' || parsed.status === 'FAIL' || parsed.status === 'ERROR') {
        terminal = true;
        break;
      }
      await sleep(1500);
    }

    if (!terminal) {
      assert.fail('TIMEOUT: ' + name + ' | ' + JSON.stringify(last || {}) + ' | fase=' + ((last && last.phase) || ''));
    }

    const status = last.status;
    let pass, fail, total, cases, isolation = last.isolation || null;

    if (saleMode) {
      cases = (last.cases || []).map((c) => ({ name: c.name, status: c.outcome }));
      pass = cases.filter((c) => c.status === 'APROBADO').length;
      fail = cases.filter((c) => c.status === 'FALLIDO').length;
      total = cases.length;
    } else {
      cases = last.cases || [];
      if (last.stats) {
        pass = last.stats.pass;
        fail = last.stats.fail;
        total = last.stats.total;
      } else {
        pass = last.pass;
        fail = last.fail;
        total = last.total;
      }
    }

    let rawText;
    if (saleMode) {
      rawText = JSON.stringify(last);
    } else {
      const full = await cdp.send('Runtime.evaluate', { expression: 'document.getElementById("auto-result").textContent', returnByValue: true }, sessionId);
      const fullRaw = full && full.result ? full.result.value : '';
      let parsedFull = null;
      try { parsedFull = JSON.parse(fullRaw); } catch {}
      rawText = parsedFull ? JSON.stringify(parsedFull) : String(fullRaw || '');
    }

    const summary = { name, status, pass, fail, total, cases, isolation, consoleErrorCount: consoleErrors.length };

    console.log('=== ' + name + ' SUMMARY ===');
    console.log(JSON.stringify(summary));
    console.log('=== ' + name + ' CASES ===');
    for (const c of cases) {
      console.log(c.name + ' :: ' + c.status);
    }
    console.log('=== ' + name + ' RAW ===');
    console.log(rawText);

    assert.ok(
      status === 'PASS',
      'HARNESS ' + name + ' → ' + status + ' | ' + JSON.stringify(summary) +
        (consoleErrors.length ? (' | consoleErrors[0..11]: ' + JSON.stringify(consoleErrors.slice(0, 12))) : '')
    );
  } finally {
    try { if (cdp && targetId) { cdp.send('Target.closeTarget', { targetId }).catch(() => {}); } } catch {}
    try { if (cdp) cdp.close(); } catch {}
    try { if (child && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); } catch {}
    await sleep(400);
    try { if (profile) rmSync(profile, { recursive: true, force: true }); } catch {}
    try { server.close(); } catch {}
  }
}

test('credits-payments-v10', { timeout: 300000 + 120000 }, async () => {
  await runHarness('credits-payments-v10', '/tests/v10-credits-payments-engine.html', 300000, GENERIC_EXTRACTOR, false);
});

test('multitab-v10-engine', { timeout: 240000 + 120000 }, async () => {
  await runHarness('multitab-v10-engine', '/tests/multitab-persistence-v10-engine.html', 240000, GENERIC_EXTRACTOR, false);
});

test('phase-a-regression', { timeout: 300000 + 120000 }, async () => {
  await runHarness('phase-a-regression', '/tests/persistence-v10-phase-a-regression.html', 300000, GENERIC_EXTRACTOR, false);
});

test('sale-transaction-regression', { timeout: 180000 + 120000 }, async () => {
  await runHarness('sale-transaction-regression', '/tests/sale-transaction-regression.html', 180000, SALE_EXTRACTOR, true);
});
