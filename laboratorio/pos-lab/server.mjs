import http from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = realpathSync(resolve(here, '../..'));
const labRoot = realpathSync(resolve(root, 'laboratorio/pos-lab'));
const posRoot = realpathSync(resolve(root, 'POS'));
const portArg = process.argv.find(arg => arg.startsWith('--port='));
const port = portArg ? Number(portArg.slice(7)) : 8799;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.wasm': 'application/wasm'
};

function safeFile(base, relativePath) {
  const candidate = resolve(base, relativePath);
  if (candidate !== base && !candidate.startsWith(base + sep)) return null;
  try {
    const real = realpathSync(candidate);
    if (real !== base && !real.startsWith(base + sep)) return null;
    if (!statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-NA-Environment', 'LABORATORIO');

  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  if (pathname === '/') {
    response.writeHead(302, { Location: '/laboratorio/pos-lab/index.html' });
    response.end();
    return;
  }

  let file = null;
  if (pathname.startsWith('/laboratorio/pos-lab/')) {
    file = safeFile(labRoot, pathname.slice('/laboratorio/pos-lab/'.length));
  } else if (pathname.startsWith('/POS/')) {
    file = safeFile(posRoot, pathname.slice('/POS/'.length));
  }

  if (!file) {
    response.writeHead(404);
    response.end('LAB: archivo no permitido');
    return;
  }

  const bytes = readFileSync(file);
  response.writeHead(200, {
    'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': bytes.length
  });
  response.end(request.method === 'HEAD' ? undefined : bytes);
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? 'El puerto LAB 8799 ya está ocupado. Cierra la otra instancia LAB.'
    : 'No se pudo iniciar el POS LAB.');
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/laboratorio/pos-lab/index.html`;
  console.log(JSON.stringify({
    service: 'nuevo-amanecer-pos-lab',
    environment: 'LABORATORIO',
    url,
    isolatedOrigin: true,
    productionWritesBlocked: true
  }));
  console.log('LAB usa otro origen/puerto que el POS canónico. No usar datos reales.');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const browser = spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('Abre la URL LAB manualmente en Chrome o Edge.'));
    browser.unref();
  }
});