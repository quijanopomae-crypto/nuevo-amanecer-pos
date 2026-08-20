import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function spawnT(args, timeoutMs){
  return new Promise((resolve) => {
    let stdout = '', stderr = '', code = null, signal = null;
    let child;
    try { child = spawn(args[0], args.slice(1), { windowsHide: true }); }
    catch (e){ return resolve({ spawnError: e.message, spawnErrorCode: e.code, args, stdout: '', stderr: '' }); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e){} resolve({ timedOut: true, stdout, stderr, code, signal, args }); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => { clearTimeout(timer); resolve({ spawnError: e.message, spawnErrorCode: e.code, stdout, stderr, code, signal, args }); });
    child.on('close', (c, s) => { clearTimeout(timer); resolve({ code: c, signal: s, stdout, stderr, args }); });
  });
}

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

function extractStatus(dom){
  const m = dom.match(/id="auto-result">([\s\S]*?)<\/pre>/);
  if (!m) return { extracted: false };
  try { const r = JSON.parse(m[1]); return { extracted: true, status: r.status, pass: r.pass, total: r.total }; }
  catch (e){ return { extracted: false, parseError: e.message, raw: m[1].slice(0, 300) }; }
}

test('diagnóstico de arranque de Chrome (una variable por experimento)', async () => {
  console.log('CHROME_PATH=' + (chromePath || 'NONE'));
  if (!chromePath) return;

  const server = spawn('python', ['-m', 'http.server', '8123'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  const url = 'http://127.0.0.1:8123/tests/cash-v10-regression.html?autorun=1';
  try {
    await waitForServer('http://127.0.0.1:8123/tests/cash-v10-regression.html');
    console.log('SERVER_UP=1');

    const mkTmp = () => mkdtempSync(path.join(tmpdir(), 'cash-diag-'));

    // una variable por experimento
    const variants = [
      { name: 'V1-new-basico',        build: (t) => ['--headless=new', '--disable-gpu', '--dump-dom', url] },
      { name: 'V2-new-vtb',           build: (t) => ['--headless=new', '--disable-gpu', '--virtual-time-budget=45000', '--dump-dom', url] },
      { name: 'V3-new-udd',           build: (t) => ['--headless=new', '--disable-gpu', '--dump-dom', '--user-data-dir=' + t, url] },
      { name: 'V4-new-vtb-udd',       build: (t) => ['--headless=new', '--disable-gpu', '--virtual-time-budget=45000', '--dump-dom', '--user-data-dir=' + t, url] },
      { name: 'V5-old-vtb-udd',       build: (t) => ['--headless=old', '--disable-gpu', '--virtual-time-budget=45000', '--dump-dom', '--user-data-dir=' + t, url] }
    ];

    for (const v of variants){
      const t = mkTmp();
      const args = v.build(t);
      const res = await spawnT(args, 90000);
      const status = extractStatus(res.stdout);
      const summary = {
        name: v.name,
        spawnError: res.spawnError || null,
        spawnErrorCode: res.spawnErrorCode || null,
        code: res.code ?? null,
        signal: res.signal ?? null,
        timedOut: res.timedOut || false,
        stdoutLen: (res.stdout || '').length,
        stderrTail: (res.stderr || '').slice(-400),
        reportStatus: status
      };
      console.log('VARIANT=' + JSON.stringify(summary));
      try { rmSync(t, { recursive: true, force: true }); } catch (e){}
    }
  } finally {
    try { server.kill(); } catch (e){}
  }
});
