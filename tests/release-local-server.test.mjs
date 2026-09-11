import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';

test('local release server serves POS bytes and rejects unrelated files, writes and foreign hosts', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['tools/pos-local/server.mjs', '--port=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const info = await new Promise((resolve, reject) => {
      let text = '';
      child.stdout.on('data', data => {
        text += data;
        if (text.includes('\n')) {
          try { resolve(JSON.parse(text.split('\n')[0])); } catch (error) { reject(error); }
        }
      });
      child.once('error', reject);
      child.once('exit', code => reject(new Error('Server exited: ' + code)));
    });
    assert.equal(info.localOnly, true);
    const base = new URL(info.url).origin;
    const html = await fetch(info.url);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.equal(await html.text(), readFileSync('POS/index.html', 'utf8'));
    const script = await fetch(base + '/POS/js/sync/outbox.js');
    assert.equal(script.status, 200);
    assert.equal(await script.text(), readFileSync('POS/js/sync/outbox.js', 'utf8'));
    const ocr = await fetch(base + '/POS/js/ocr/vendor/tesseract-6.0.1/lang/spa.traineddata.gz');
    assert.equal(ocr.status, 200);
    assert.deepEqual(Buffer.from(await ocr.arrayBuffer()), readFileSync('POS/js/ocr/vendor/tesseract-6.0.1/lang/spa.traineddata.gz'));
    for (const path of ['/tools/cloudflare-lab/.dev.vars', '/tools/cloudflare-lab/src/worker.js', '/.git/config', '/POS/../docs/V1.2_STATUS.md', '/POS/%2e%2e%2f%2e%2e%2ftools/cloudflare-lab/.dev.vars']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(info.url, { method: 'POST', body: '{}' })).status, 405);
    const foreignHostStatus = await new Promise((resolve, reject) => {
      const probe = request(info.url, { headers: { Host: 'untrusted.example' } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      probe.on('error', reject); probe.end();
    });
    assert.equal(foreignHostStatus, 403);
    const head = await fetch(info.url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally {
    const ended = once(child, 'exit');
    if (child.exitCode === null) child.kill();
    if (child.exitCode === null) await ended;
  }
});
