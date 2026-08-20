import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];
const chromePath = CHROME_CANDIDATES.find(p => p && existsSync(p));
const DEBUG_PORT = 9333;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function waitForServer(url, tries = 60){
  for (let i = 0; i < tries; i++){
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, res => { res.resume(); res.statusCode < 500 ? resolve() : reject(new Error('status ' + res.statusCode)); });
        req.on('error', reject);
        req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      return;
    } catch (e){ await sleep(300); }
  }
  throw new Error('server no respondió en ' + url);
}

async function fetchJson(url){
  const res = await fetch(url);
  return res.json();
}

class CdpClient {
  constructor(wsUrl){ this.wsUrl = wsUrl; this._id = 0; this._pending = new Map(); this.ws = null; }
  connect(){
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error('websocket error: ' + (e && e.message ? e.message : 'desconocido')));
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (e){ return; }
        if (msg && msg.id && this._pending.has(msg.id)){
          const p = this._pending.get(msg.id); this._pending.delete(msg.id); p.resolve(msg);
        }
      };
    });
  }
  send(method, params){
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close(){ try { this.ws && this.ws.close(); } catch (e){} }
}

async function evaluate(client, expression){
  try {
    const res = await client.send('Runtime.evaluate', { expression, returnByValue: true });
    if (res && res.result && res.result.exceptionDetails) return { error: 'EXCEPTION', details: res.result.exceptionDetails };
    if (res && res.result && res.result.result) return { value: res.result.result.value };
    return { error: 'NO_RESULT', raw: res };
  } catch (e){ return { error: e.message }; }
}

async function runOnce(url, chromeVersion){
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'cash-chrome-'));
  const chromeArgs = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + DEBUG_PORT, '--user-data-dir=' + userDataDir, url
  ];
  const child = spawn(chromePath, chromeArgs, { windowsHide: true });
  let client = null;
  try {
    let page = null;
    for (let i = 0; i < 100; i++){
      try {
        const targets = await fetchJson('http://127.0.0.1:' + DEBUG_PORT + '/json');
        page = targets.find(t => t.type === 'page' && typeof t.url === 'string' && t.url.includes('cash-v10-regression.html'));
        if (page && page.webSocketDebuggerUrl) break;
      } catch (e){}
      await sleep(300);
    }
    if (!page) throw new Error('no se encontró el target de página');

    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');

    let report = null;
    let diag = null;
    for (let i = 0; i < 240; i++){
      const r = await evaluate(client, 'window.__cashV10Report ? JSON.stringify(window.__cashV10Report) : null');
      if (r.value){
        try {
          const parsed = JSON.parse(r.value);
          if (parsed && typeof parsed.status === 'string' && parsed.status !== 'RUNNING' && parsed.status !== 'NOT_RUN'){
            report = parsed; break;
          }
        } catch (e){}
      }
      if (i % 20 === 19){
        const d = await evaluate(client, 'JSON.stringify({status:document.getElementById("status")&&document.getElementById("status").textContent,summary:document.getElementById("summary")&&document.getElementById("summary").textContent,auto:document.getElementById("auto-result")&&document.getElementById("auto-result").textContent,report:window.__cashV10Report?window.__cashV10Report.status:null})');
        diag = d.value;
      }
      await sleep(500);
    }
    if (!report){
      const d = await evaluate(client, 'JSON.stringify({status:document.getElementById("status")&&document.getElementById("status").textContent,summary:document.getElementById("summary")&&document.getElementById("summary").textContent,auto:document.getElementById("auto-result")&&document.getElementById("auto-result").textContent,report:window.__cashV10Report?window.__cashV10Report.status:null})');
      throw new Error('report no disponible. diag: ' + (d.value || JSON.stringify(diag)));
    }
    report.chromeVersion = chromeVersion;
    return { report, chromeArgs, diag };
  } finally {
    if (client) client.close();
    try { child.kill(); } catch (e){}
    await sleep(300);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch (e){}
  }
}

test('cash-v10 regression en Chrome headless real (CDP)', async () => {
  assert.ok(chromePath, 'No se encontró Chrome/Edge en: ' + JSON.stringify(CHROME_CANDIDATES));

  let version = 'unknown';
  try {
    const p = spawn(chromePath, ['--version'], { windowsHide: true });
    const verText = await new Promise((resolve) => {
      let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
      p.on('close', () => resolve(out.trim())); setTimeout(() => resolve(''), 8000);
    });
    if (verText) version = verText;
  } catch (e){}
  if (version === 'unknown'){
    const pw = spawn('powershell', ['-NoProfile', '-Command', '(Get-Item \'' + chromePath.replace(/\\/g, '\\\\') + '\').VersionInfo.ProductVersion'], { windowsHide: true });
    const pv = await new Promise((resolve) => { let out=''; pw.stdout.on('data', d => out += d); pw.on('close', () => resolve(out.trim())); setTimeout(() => resolve(''), 15000); });
    if (pv) version = pv;
  }
  console.log('CHROME_VERSION=' + version);
  console.log('CHROME_PATH=' + chromePath);

  const server = spawn('python', ['-m', 'http.server', '8123'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  const results = [];
  try {
    await waitForServer('http://127.0.0.1:8123/tests/cash-v10-regression.html');
    console.log('SERVER_UP=1');

    const url = 'http://127.0.0.1:8123/tests/cash-v10-regression.html?autorun=1&ts=' + Date.now();
    for (let run = 0; run < 2; run++){
      const r = await runOnce(url, version);
      results.push({ run, report: r.report, chromeArgs: r.chromeArgs, diag: r.diag });
      console.log('RUN' + run + ' status=' + r.report.status + ' pass=' + r.report.pass + '/' + r.report.total + ' fail=' + r.report.fail);
    }

    writeFileSync(path.join(here, 'cash-v10-regression.report.json'), JSON.stringify(results, null, 2));
    console.log('REPORT_WRITTEN=' + path.join(here, 'cash-v10-regression.report.json'));

    for (const r of results){
      assert.equal(r.report.status, 'PASS', 'corrida ' + r.run + ' no pasó: ' + JSON.stringify(r.report.cases));
    }
    const a = results[0].report, b = results[1].report;
    assert.deepEqual(a.cases.map(c => c.status), b.cases.map(c => c.status), 'determinismo de status por caso');
    assert.equal(a.pass, b.pass, 'determinismo de pass count');
    assert.ok(a.source && a.source.hash, 'firma de código servido ausente');
  } finally {
    try { server.kill(); } catch (e){}
  }
});
