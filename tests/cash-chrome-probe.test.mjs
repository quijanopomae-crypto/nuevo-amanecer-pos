import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];
const chromePath = CHROME_CANDIDATES.find(p => p && existsSync(p));

function spawnT(args, timeoutMs){
  return new Promise((resolve) => {
    let stdout = '', stderr = '';
    let child;
    try { child = spawn(args[0], args.slice(1), { windowsHide: true }); }
    catch (e){ return resolve({ spawnError: e.message }); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e){} resolve({ timedOut: true, stdout, stderr }); }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', e => { clearTimeout(timer); resolve({ spawnError: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

test('probe chrome', async () => {
  console.log('CANDIDATES=' + JSON.stringify(CHROME_CANDIDATES));
  console.log('CHROME_FOUND=' + (chromePath || 'NONE'));
  assert.ok(chromePath, 'no chrome');
  const ver = await spawnT([chromePath, '--version'], 8000);
  console.log('VERSION_PROBE=' + JSON.stringify({ code: ver.code, stdout: ver.stdout.trim(), timedOut: ver.timedOut, spawnError: ver.spawnError }));
  const blank = await spawnT([chromePath, '--headless=new', '--disable-gpu', '--dump-dom', 'about:blank'], 30000);
  console.log('BLANK_DUMP=' + JSON.stringify({ code: blank.code, len: blank.stdout.length, head: blank.stdout.slice(0, 120), timedOut: blank.timedOut, spawnError: blank.spawnError, stderrTail: blank.stderr.slice(-200) }));
});
