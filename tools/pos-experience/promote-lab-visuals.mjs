import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visualAssets, canonicalVisualSource } from './visual-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
const wantsWrite = args.has('--write');
const wantsCheck = args.has('--check') || !wantsWrite;
const ownerApproved = args.has('--owner-approved');
const failures = [];

function fail(message) {
  failures.push(message);
}

function absolute(rel) {
  return resolve(root, rel);
}

function read(rel) {
  return readFileSync(absolute(rel), 'utf8');
}

function promotedSource(asset) {
  return canonicalVisualSource(asset, read(asset.lab));
}

function assertSafeMapping(asset) {
  if (!asset.lab.startsWith('laboratorio/pos-lab/')) fail('LAB path outside allowlist root: ' + asset.lab);
  if (!asset.canon.startsWith('POS/css/experience-v2/')) fail('CANON path outside allowlist root: ' + asset.canon);
  if (asset.lab.includes('..') || asset.canon.includes('..')) fail('Parent traversal forbidden: ' + JSON.stringify(asset));
}

const labPaths = new Set();
const canonPaths = new Set();
for (const asset of visualAssets) {
  assertSafeMapping(asset);
  if (labPaths.has(asset.lab)) fail('Duplicate LAB mapping: ' + asset.lab);
  if (canonPaths.has(asset.canon)) fail('Duplicate CANON mapping: ' + asset.canon);
  labPaths.add(asset.lab);
  canonPaths.add(asset.canon);
  if (!existsSync(absolute(asset.lab))) fail('Missing LAB source: ' + asset.lab);
}

if (visualAssets.length !== 23) fail('Expected 23 approved visual assets, found ' + visualAssets.length);

if (wantsWrite) {
  if (!ownerApproved) {
    fail('WRITE_DENIED: use --write --owner-approved only after explicit owner approval');
  } else if (!failures.length) {
    for (const asset of visualAssets) {
      const source = promotedSource(asset);
      const destination = absolute(asset.canon);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, source, 'utf8');
    }
  }
}

for (const asset of visualAssets) {
  if (!existsSync(absolute(asset.canon))) {
    fail('Missing CANON mirror: ' + asset.canon);
    continue;
  }
  if (read(asset.canon) !== promotedSource(asset)) {
    fail('Visual drift: ' + asset.canon + ' != promoted output from ' + asset.lab);
  }
}

const html = read('POS/index.html');
const links = [...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/gi)].map(match => match[1]);
const baseline = links.indexOf('css/client-credit-accounts-v2.css');
if (baseline < 0) fail('Missing CSS baseline: css/client-credit-accounts-v2.css');

let previous = baseline;
for (const asset of visualAssets) {
  const at = links.indexOf(asset.href);
  if (at <= previous) fail('Missing or wrong CSS order: ' + asset.href);
  previous = at;
}

if (/lab-overrides\.css/i.test(html)) fail('CANON must not load lab-overrides.css');
if (/laboratorio\/pos-lab\/(?:styles|animations)\//i.test(html)) {
  fail('CANON must not load LAB visual paths at runtime');
}

const sw = read('POS/sw.js');
for (const asset of visualAssets) {
  if (!sw.includes("'" + asset.precache + "'")) fail('Missing service-worker precache: ' + asset.precache);
}

if (failures.length) {
  console.error('LAB_CANON_VISUAL_PARITY_FAIL');
  for (const message of failures) console.error('- ' + message);
  process.exit(1);
}

const mode = wantsWrite ? 'WRITE' : (wantsCheck ? 'CHECK' : 'CHECK');
console.log('LAB_CANON_VISUAL_PARITY_PASS mode=' + mode + ' assets=' + visualAssets.length);
