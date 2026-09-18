// Local launcher. Serve only release-listed files plus the explicit PWA shell assets.
import http from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const manifest = JSON.parse(readFileSync(resolve(root, 'evidence/v1.2/production-package-files.json'), 'utf8'));
const allowed = new Map();
const setupFiles = new Set(['tools/pos-local/setup.html', 'tools/pos-local/setup.js']);
const pwaFiles = ['POS/manifest.webmanifest', 'POS/sw.js', 'POS/assets/icons/icon-192.png', 'POS/assets/icons/icon-512.png'];
for (const entry of [...manifest.files.filter(name => name.startsWith('POS/') || setupFiles.has(name)), ...pwaFiles]) {
  if (entry.includes('\\') || entry.split('/').includes('..')) throw new Error('Invalid release path');
  const path = realpathSync(resolve(root, entry));
  if (!path.startsWith(root + sep) || !statSync(path).isFile()) throw new Error('Invalid release file');
  allowed.set('/' + entry, path);
}
if (!allowed.has('/POS/index.html')) throw new Error('Missing POS entry point');
// Local serving needs a concrete generation too; the historical release list stays intact.
const buildHash = createHash('sha256');
for (const [url, path] of allowed) {
  if (url.startsWith('/POS/')) buildHash.update(url).update(readFileSync(path));
}
const generation = buildHash.digest('hex').slice(0, 16);
const portArg = process.argv.find(arg => arg.startsWith('--port='));
const port = portArg ? Number(portArg.slice(7)) : 8788;
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.gz': 'application/gzip', '.json': 'application/json', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const activePort = server.address().port;
  if (request.headers.host !== `127.0.0.1:${activePort}`) { response.writeHead(403); response.end(); return; }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${activePort}`).pathname); }
  catch { response.writeHead(400); response.end(); return; }
  if (pathname === '/') { response.writeHead(302, { Location: '/POS/index.html' }); response.end(); return; }
  const path = allowed.get(pathname);
  if (!path) { response.writeHead(404); response.end(); return; }
  try {
    if (realpathSync(path) !== path) throw new Error('Changed release path');
    const source = readFileSync(path);
    const bytes = pathname === '/POS/sw.js'
      ? Buffer.from(source.toString('utf8').replace('__BUILD_HASH__', generation))
      : source;
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(500); response.end(); }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'El puerto local esta ocupado. Cierre la otra instancia antes de iniciar.' : 'No se pudo iniciar el POS local.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/POS/index.html`;
  console.log(JSON.stringify({ service: 'nuevo-amanecer-pos-local', url, files: allowed.size, localOnly: true }));
  console.log('Mantenga esta ventana abierta. Use una sola pestana para registrar ventas.');
  console.log('Para detener el servidor local: Ctrl+C.');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const browser = spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.log('Abra la direccion indicada en Chrome o Edge.'));
    browser.unref();
  }
});
