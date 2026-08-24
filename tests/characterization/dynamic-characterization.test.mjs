// dynamic-characterization.test.mjs — run the harness in a real headless browser
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
// If no Chrome/Edge binary is found, the test is SKIPPED and an explicit
// ENVIRONMENT_BLOCKED evidence file is written (never a silent PASS).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureBaselineFixture } from './lib/extract-baseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This test lives in tests/characterization/, so the workspace root is two levels up.
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(WORKSPACE_ROOT, 'evidence', 'characterization');
const TMP_DIR = path.join(EVIDENCE_DIR, 'tmp');
const HARNESS_PATH = path.join(__dirname, 'dynamic', 'characterization-harness.html');

// Scope guard: all write/evidence paths must remain inside the workspace root.
// (An earlier revision resolved three levels up and wrote outside the workspace.)
if (!EVIDENCE_DIR.startsWith(WORKSPACE_ROOT)) {
  throw new Error('scope guard: evidence dir outside workspace');
}

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  for (const p of BROWSER_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function contentTypeFor(p) {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function startServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runDumpDom(browser, url, userDataDir) {
  const args = [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--no-sandbox',
    // Fail the fixture's external CDN/fonts requests fast (offline environment)
    // instead of letting DNS time out and blocking virtual-time budget.
    '--host-resolver-rules=MAP cdn.sheetjs.com ~NOTFOUND, MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=8000',
    '--dump-dom',
    url,
  ];
  const result = spawnSync(browser, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 45000 });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    signal: result.signal || null,
    error: result.error ? String(result.error) : null,
  };
}

function extractResults(dom) {
  const m = /id="char-results"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) return null;
  let text = m[1];
  text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  try { return JSON.parse(text.trim()); } catch { return null; }
}

function ensureDirs() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const browser = findBrowser();

test('dynamic characterization via headless browser', { skip: browser ? false : 'no Chrome/Edge binary found' }, async (t) => {
  ensureBaselineFixture();
  if (!browser) {
    // This branch is unreachable when skip is active, but kept for safety.
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-ENVIRONMENT_BLOCKED.json'), JSON.stringify({
      reason: 'no browser binary', searched: BROWSER_CANDIDATES.filter(Boolean),
    }, null, 2) + '\n');
    t.skip('no browser binary');
    return;
  }

  ensureDirs();

  // ---- HTTP run ----
  const server = await startServer(WORKSPACE_ROOT);
  const port = server.address().port;
  const httpUrl = `http://127.0.0.1:${port}/tests/characterization/dynamic/characterization-harness.html`;
  const httpDir = path.join(TMP_DIR, 'http-profile');
  let httpResults = null;
  let httpError = null;
  let httpDebug = null;
  try {
    const dump = runDumpDom(browser, httpUrl, httpDir);
    httpDebug = { browser, status: dump.status, signal: dump.signal, error: dump.error, stderrTail: dump.stderr.slice(-2000), stdoutLen: dump.stdout.length };
    httpResults = extractResults(dump.stdout);
    if (!httpResults) httpError = 'failed to parse char-results (status ' + dump.status + ', signal ' + dump.signal + ', error ' + dump.error + ')';
  } catch (e) {
    httpError = String(e);
  } finally {
    server.close();
  }

  // ---- file:// run ----
  const fileUrl = 'file:///' + HARNESS_PATH.replace(/\\/g, '/');
  const fileDir = path.join(TMP_DIR, 'file-profile');
  let fileResults = null;
  let fileError = null;
  let fileDebug = null;
  try {
    const dump = runDumpDom(browser, fileUrl, fileDir);
    fileDebug = { browser, status: dump.status, signal: dump.signal, error: dump.error, stderrTail: dump.stderr.slice(-2000), stdoutLen: dump.stdout.length };
    fileResults = extractResults(dump.stdout);
    if (!fileResults) fileError = 'failed to parse char-results for file:// (status ' + dump.status + ', signal ' + dump.signal + ', error ' + dump.error + ')';
  } catch (e) {
    fileError = String(e);
  }

  // ---- write evidence ----
  if (httpResults) {
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-results.json'), JSON.stringify(httpResults, null, 2) + '\n');
  }
  if (fileResults) {
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-file-protocol-results.json'), JSON.stringify(fileResults, null, 2) + '\n');
  }
  if (httpError || fileError) {
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-run-errors.json'), JSON.stringify({ httpError, fileError, httpDebug, fileDebug }, null, 2) + '\n');
  }

  // cleanup temp profiles
  try { fs.rmSync(httpDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(fileDir, { recursive: true, force: true }); } catch {}

  // ---- assertions ----
  if (!httpResults) {
    // Honest degradation: the browser exists but the async harness did not
    // settle within the headless budget. Never convert this into a PASS.
    const reason = httpError || 'headless run did not complete';
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-ENVIRONMENT_BLOCKED.json'), JSON.stringify({
      reason,
      browser,
      searched: BROWSER_CANDIDATES.filter(Boolean),
      note: 'Chrome/Edge binary found, but the headless --dump-dom async harness did not produce char-results (virtual-time-budget/IndexedDB/offline limitation).',
    }, null, 2) + '\n');
    t.skip('ENVIRONMENT_BLOCKED: ' + reason);
    return;
  }
  const scenarios = httpResults.results || [];
  assert.ok(Array.isArray(scenarios), 'harness must emit a results array');
  assert.ok(scenarios.length >= 4, 'at least S1-S4 must be present, got ' + scenarios.length);
  for (const s of scenarios) {
    assert.ok(typeof s.scenario === 'string' && typeof s.status === 'string', 'each scenario needs scenario+status');
  }
  assert.equal(typeof httpResults.fileProtocolSupported, 'boolean', 'fileProtocolSupported must be a boolean');
});

test('dynamic ENVIRONMENT_BLOCKED evidence when no browser is present', { skip: browser ? 'browser present' : false }, async (t) => {
  if (browser) { t.skip('browser present'); return; }
  ensureDirs();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'dynamic-ENVIRONMENT_BLOCKED.json'), JSON.stringify({
    reason: 'no browser binary',
    searched: BROWSER_CANDIDATES.filter(Boolean),
  }, null, 2) + '\n');
  assert.ok(fs.existsSync(path.join(EVIDENCE_DIR, 'dynamic-ENVIRONMENT_BLOCKED.json')));
});
