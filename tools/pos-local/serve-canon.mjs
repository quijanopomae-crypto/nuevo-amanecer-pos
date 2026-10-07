// Lab/Path-C local static server: serves POS tree so canonical-*.js are not 404.
// Candidate/lab only. Binds 127.0.0.1. Does not touch prod/CANON hosted.
import http from 'node:http';
import { readFileSync, realpathSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, sep, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv.find(a => a.startsWith('--root='));
const root = realpathSync(rootArg ? resolve(rootArg.slice(7)) : resolve(scriptDir, '../..'));
const portArg = process.argv.find(a => a.startsWith('--port='));
const port = portArg ? Number(portArg.slice(7)) : 8792;
const labelArg = process.argv.find(a => a.startsWith('--label='));
const label = labelArg ? labelArg.slice(8) : 'canon-local';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const RUNTIME_STUB = `/* lab Path-C stub: not hosted; hosted-canonical-guard no-ops off workers.dev */
(function (root) {
  'use strict';
  root.NA_HOSTED_CONFIG = null;
  root.NA_LAB_CANON = Object.freeze({
    endpoint: 'http://127.0.0.1:8787',
    environment: 'lab',
    path: ${JSON.stringify(label)}
  });
})(globalThis);
`;

function underRoot(abs) {
  const base = root + sep;
  return abs === root || abs.startsWith(base);
}

function resolveSafe(pathname) {
  if (!pathname || pathname.includes('\0') || pathname.includes('\\')) return null;
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes('..')) return null;
  const rel = decoded.replace(/^\/+/, '');
  if (!rel) return null;
  // Only POS/, tools/pos-local/, and synthetic runtime-config
  if (rel === 'runtime-config.js') return { kind: 'runtime' };
  if (!(rel.startsWith('POS/') || rel.startsWith('tools/pos-local/'))) return null;
  const abs = realpathSync(resolve(root, rel));
  if (!underRoot(abs) || !statSync(abs).isFile()) return null;
  return { kind: 'file', abs, rel };
}

// Build generation from POS index + key sync scripts when present
function generation() {
  const hash = createHash('sha256');
  hash.update(label);
  for (const rel of ['POS/index.html', 'POS/js/sync/canonical-client.js', 'POS/js/perf/cash-perf-probe.js']) {
    const p = join(root, rel);
    if (existsSync(p)) hash.update(rel).update(readFileSync(p));
  }
  return hash.digest('hex').slice(0, 16);
}
const gen = generation();

const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-NA-Serve', label);
  const activePort = server.address().port;
  if (request.headers.host !== `127.0.0.1:${activePort}`) {
    response.writeHead(403); response.end(); return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${activePort}`).pathname);
  } catch {
    response.writeHead(400); response.end(); return;
  }
  if (pathname === '/') {
    response.writeHead(302, { Location: '/POS/index.html?perf=1' });
    response.end();
    return;
  }
  if (pathname === '/runtime-config.js') {
    const bytes = Buffer.from(RUNTIME_STUB);
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
    return;
  }
  let target;
  try { target = resolveSafe(pathname); } catch { target = null; }
  if (!target) { response.writeHead(404); response.end(); return; }
  try {
    let bytes;
    let type;
    if (target.kind === 'file') {
      const source = readFileSync(target.abs);
      bytes = target.rel === 'POS/sw.js'
        ? Buffer.from(source.toString('utf8').replace('__BUILD_HASH__', gen))
        : source;
      type = mime[extname(target.abs)] || 'application/octet-stream';
    } else {
      bytes = Buffer.from(RUNTIME_STUB);
      type = 'text/javascript; charset=utf-8';
    }
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(500); response.end();
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} busy. Stop the other instance first.`
    : 'Failed to start serve-canon.');
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/POS/index.html?perf=1`;
  const setup = `http://127.0.0.1:${server.address().port}/tools/pos-local/setup-lab.html`;
  console.log(JSON.stringify({
    service: 'nuevo-amanecer-pos-canon-local',
    label,
    root,
    url,
    setup,
    worker: 'http://127.0.0.1:8787',
    localOnly: true,
  }));
});
