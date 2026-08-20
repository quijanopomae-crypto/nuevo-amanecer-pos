import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if (!existsSync(chromePath)) throw new Error('no chrome');

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function spawnT(args, timeoutMs){
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    let child;
    try { child = spawn(args[0], args.slice(1), { windowsHide: true }); }
    catch (e){ return resolve({ spawnError: e.message, args, stdout: '', stderr: '' }); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e){} resolve({ timedOut: true, stdout, stderr }); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => { clearTimeout(timer); resolve({ spawnError: e.message, stdout, stderr }); });
    child.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
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
  throw new Error('server no respondió');
}

test('captura y diagnostica el DOM volcado', async () => {
  const server = spawn('python', ['-m', 'http.server', '8123'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  try {
    await waitForServer('http://127.0.0.1:8123/tests/cash-v10-regression.html');
    const url = 'http://127.0.0.1:8123/tests/cash-v10-regression.html?autorun=1';
    const t = mkdtempSync(path.join(tmpdir(), 'cash-cap-'));
    const args = [chromePath, '--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=45000', '--dump-dom', '--user-data-dir=' + t, url];
    const res = await spawnT(args, 120000);
    writeFileSync(path.join(here, 'cash-dump-capture.html'), res.stdout);
    console.log('STDOUT_LEN=' + res.stdout.length);
    console.log('STDERR_TAIL=' + res.stderr.slice(-300));
    const grab = (re) => { const m = res.stdout.match(re); return m ? m[1] : null; };
    console.log('AUTO_RESULT=' + grab(/id="auto-result">([\s\S]*?)<\/pre>/));
    console.log('STATUS=' + grab(/id="status"[^>]*>([\s\S]*?)<\/span>/));
    console.log('SUMMARY=' + grab(/id="summary"[^>]*>([\s\S]*?)<\/div>/));
    console.log('INIT_DIAG=' + grab(/id="init-diag">([\s\S]*?)<\/pre>/));
    console.log('WORKER_ERROR=' + grab(/id="worker-error">([\s\S]*?)<\/pre>/));
    console.log('RESULT_ROWS=' + (res.stdout.match(/<tr>/g) || []).length);
    console.log('HAS_RUNNING=' + res.stdout.includes('RUNNING'));
    console.log('HAS_NOT_RUN=' + res.stdout.includes('NOT_RUN'));
    try { rmSync(t, { recursive: true, force: true }); } catch (e){}
  } finally {
    try { server.kill(); } catch (e){}
  }
});
