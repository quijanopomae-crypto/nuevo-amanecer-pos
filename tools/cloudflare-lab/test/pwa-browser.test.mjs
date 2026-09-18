import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = () => reject(new Error('Chrome CDP connection failed'));
      this.socket.onmessage = ({ data }) => {
        const message = JSON.parse(data);
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
      };
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Page evaluation failed');
  return result.result.value;
}

async function waitFor(client, expression, message) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if (await evaluate(client, expression)) return; } catch {}
    await sleep(100);
  }
  throw new Error(message);
}

test('Chrome installs, controls and reloads the complete PWA shell offline', { timeout: 60000 }, async (t) => {
  assert.ok(chrome, 'Chrome or Edge is required');
  const server = spawn(process.execPath, ['tools/pos-local/server.mjs', '--port=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  let client;
  let profile;
  try {
    const info = await new Promise((resolve, reject) => {
      let text = '';
      server.stdout.on('data', (data) => {
        text += data;
        if (text.includes('\n')) {
          try { resolve(JSON.parse(text.split('\n')[0])); } catch (error) { reject(error); }
        }
      });
      server.once('error', reject);
      server.once('exit', (code) => reject(new Error(`Local server exited: ${code}`)));
    });
    const debugPort = await freePort();
    profile = mkdtempSync(path.join(tmpdir(), 'na-pwa-chrome-'));
    browser = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, info.url
    ], { windowsHide: true, stdio: 'ignore' });

    let target;
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        target = targets.find((item) => item.type === 'page' && item.url.startsWith(info.url));
        if (target) break;
      } catch {}
      await sleep(100);
    }
    assert.ok(target?.webSocketDebuggerUrl, 'Chrome did not expose the POS page');
    client = new Cdp(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await waitFor(client, `navigator.serviceWorker.ready.then(()=>true)`, 'Service worker did not become ready');
    await evaluate(client, `location.reload(); true`);
    await waitFor(client, `document.readyState==='complete' && !!navigator.serviceWorker.controller`, 'Service worker did not control the reload');

    const cache = await evaluate(client, `(async()=>{const names=await caches.keys();const shell=names.find(n=>n.startsWith('nuevo-amanecer-pos-shell-'));const entries=shell?await (await caches.open(shell)).keys():[];return {names,shell,urls:entries.map(e=>e.url)};})()`);
    assert.match(cache.shell, /^nuevo-amanecer-pos-shell-[a-f0-9]{16}$/);
    assert.equal(cache.urls.length, 49);
    assert.ok(cache.urls.some((url) => url.endsWith('/POS/index.html')));
    assert.ok(cache.urls.some((url) => url.endsWith('/POS/js/app.js')));

    await client.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await evaluate(client, `location.reload(); true`);
    await waitFor(client, `document.readyState==='complete' && !!navigator.serviceWorker.controller`, 'Offline shell reload did not complete');
    assert.equal(await evaluate(client, `document.title`), 'Nuevo Amanecer — ERP & POS v4.0 · CVV1.4');
    t.diagnostic(JSON.stringify({ browser: chrome, cache: cache.shell, cachedShellFiles: cache.urls.length, offlineReload: 'PASS' }));
  } finally {
    client?.close();
    if (browser?.exitCode === null) browser.kill();
    if (server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; }
    await sleep(200);
    if (profile) rmSync(profile, { recursive: true, force: true });
  }
});
