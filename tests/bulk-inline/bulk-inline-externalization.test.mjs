import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '3c0fc3b6c352c2178b6a9caa0346ad3611d6c40f';
const INDEX_REL = 'POS/index.html';
const INDEX_PATH = path.join(ROOT, INDEX_REL);
const MANIFEST_PATH = path.join(ROOT, 'evidence', 'bulk-inline', 'manifest.json');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const gitBuffer = args => execFileSync('git', args, { cwd: ROOT, encoding: 'buffer' });
const gitText = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const normalizeLf = value => String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const baseBuffer = gitBuffer(['show', `${BASE}:${INDEX_REL}`]);
const baseIndex = baseBuffer.toString('utf8');
const candidateBuffer = fs.readFileSync(INDEX_PATH);
const candidateIndex = candidateBuffer.toString('utf8');
const manifestText = fs.readFileSync(MANIFEST_PATH, 'utf8');
const manifest = JSON.parse(manifestText);

function parseScripts(source) {
  const scripts = [];
  const pattern = /<script\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const openTag = match[0].slice(0, match[0].indexOf('>') + 1);
    const srcMatch = match.groups.attrs.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    const typeMatch = match.groups.attrs.match(/\btype\s*=\s*(["'])(.*?)\1/i);
    scripts.push({
      documentOrder: scripts.length + 1,
      openTag,
      attrs: match.groups.attrs,
      body: match.groups.body,
      src: srcMatch?.[2] || '',
      type: typeMatch?.[2] || '',
      full: match[0],
      start: match.index,
      end: pattern.lastIndex,
    });
  }
  return scripts;
}

function expectedExternalTag(entry) {
  const browserPath = entry.externalFile.replace(/^POS\//, '');
  return `${entry.originalOpenTag.slice(0, -1)} src="${browserPath}"></script>`;
}

function baseInlineScripts() {
  return parseScripts(baseIndex).filter(script => !script.src);
}

function externalBody(entry) {
  return fs.readFileSync(path.join(ROOT, ...entry.externalFile.split('/')));
}

function declarations(source) {
  const result = [];
  const patterns = [
    /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/g,
    /(?:^|\n)\s*(?:var|let|const|class)\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) result.push(match[1]);
  }
  return result;
}

function handlerNames(source) {
  const names = [];
  const attrs = /\bon(?:click|change|input|submit|keydown|keyup|dragstart|dragend|dragover|dragleave|drop)\s*=\s*(["'])(.*?)\1/gi;
  for (const match of source.matchAll(attrs)) {
    for (const call of match[2].matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) names.push(call[1]);
  }
  return names.sort();
}

function withoutScriptBodies(source) {
  return source.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, '$1</script>');
}

test('T1 manifest is deterministic, complete, and ordered', () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.baseCommit, BASE);
  assert.equal(manifest.sourceFile, INDEX_REL);
  assert.equal(manifest.inlineScriptsTotal, 18);
  assert.equal(manifest.safe, 18);
  assert.equal(manifest.hold, 0);
  assert.deepEqual(manifest.holdScripts, []);
  assert.equal(manifest.scripts.length, 18);
  assert.deepEqual(manifest.scripts.map(entry => entry.ordinal), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.deepEqual(
    manifest.scripts.map(entry => entry.externalFile),
    Array.from({ length: 18 }, (_, index) => `POS/js/legacy-inline/inline-${String(index + 1).padStart(2, '0')}.js`),
  );
  assert.ok(manifest.scripts.every(entry => entry.classification === 'SAFE'));
  assert.equal(/timestamp|createdAt|updatedAt/i.test(manifestText), false);
});

test('T2 every external file is the exact original body', () => {
  const inline = baseInlineScripts();
  assert.equal(inline.length, 18);
  for (const entry of manifest.scripts) {
    const original = inline[entry.ordinal - 1];
    const originalBuffer = Buffer.from(original.body, 'utf8');
    const external = externalBody(entry);
    assert.equal(original.documentOrder, entry.documentOrder, `documentOrder ${entry.ordinal}`);
    assert.equal(original.openTag, entry.originalOpenTag, `openTag ${entry.ordinal}`);
    assert.equal(originalBuffer.length, entry.originalBodyBytes, `body bytes ${entry.ordinal}`);
    assert.equal(sha256(originalBuffer), entry.originalBodySha256, `body SHA ${entry.ordinal}`);
    assert.equal(external.length, entry.originalBodyBytes, `external bytes ${entry.ordinal}`);
    assert.equal(sha256(external), entry.externalFileSha256, `external SHA ${entry.ordinal}`);
    assert.deepEqual(external, originalBuffer, `raw body ${entry.ordinal}`);
  }
});

test('T3 virtual reconstruction is byte-exact to the base index', () => {
  let reconstructed = candidateIndex;
  for (const entry of manifest.scripts) {
    const tag = expectedExternalTag(entry);
    assert.equal(reconstructed.split(tag).length - 1, 1, `candidate tag ${entry.ordinal}`);
    const replacement = `${entry.originalOpenTag}${externalBody(entry).toString('utf8')}</script>`;
    reconstructed = reconstructed.replace(tag, replacement);
  }
  const reconstructedBuffer = Buffer.from(reconstructed, 'utf8');
  assert.equal(sha256(reconstructedBuffer), sha256(baseBuffer));
  assert.deepEqual(reconstructedBuffer, baseBuffer);
});

test('T4 total script order and original attributes are preserved', () => {
  const baseScripts = parseScripts(baseIndex);
  const candidateScripts = parseScripts(candidateIndex);
  assert.equal(baseScripts.length, 27);
  assert.equal(candidateScripts.length, baseScripts.length);
  const byOrder = new Map(manifest.scripts.map(entry => [entry.documentOrder, entry]));
  for (let index = 0; index < baseScripts.length; index++) {
    const before = baseScripts[index];
    const after = candidateScripts[index];
    const entry = byOrder.get(index + 1);
    if (entry) {
      assert.equal(after.full, expectedExternalTag(entry), `externalized tag at ${index + 1}`);
      assert.equal(after.body, '', `empty external body at ${index + 1}`);
      assert.equal(after.type, '', `classic type at ${index + 1}`);
      assert.equal(/\b(?:async|defer)\b/i.test(after.attrs), false, `sync tag at ${index + 1}`);
    } else {
      assert.equal(after.full, before.full, `unchanged existing script at ${index + 1}`);
    }
  }
});

test('T5 no classic inline scripts remain and no module scope was introduced', () => {
  const scripts = parseScripts(candidateIndex);
  assert.equal(scripts.filter(script => !script.src).length, 0);
  for (const entry of manifest.scripts) {
    const script = scripts[entry.documentOrder - 1];
    assert.ok(script.src.startsWith('js/legacy-inline/inline-'));
    assert.equal(script.type, '');
    assert.equal(/\b(?:async|defer)\b/i.test(script.attrs), false);
  }
});

test('T6 top-level declarations, globals, and override definition order are identical', () => {
  const originalBodies = baseInlineScripts().map(script => script.body);
  const externalBodies = manifest.scripts.map(entry => externalBody(entry).toString('utf8'));
  assert.deepEqual(externalBodies, originalBodies);
  assert.deepEqual(declarations(externalBodies.join('\n')), declarations(originalBodies.join('\n')));
});

test('T7 inline handlers are unchanged and still have definitions in the executable sources', () => {
  const originalBodies = baseInlineScripts().map(script => script.body).join('\n');
  const externalBodies = manifest.scripts.map(entry => externalBody(entry).toString('utf8')).join('\n');
  assert.deepEqual(handlerNames(withoutScriptBodies(candidateIndex)), handlerNames(withoutScriptBodies(baseIndex)));
  assert.deepEqual(handlerNames(externalBodies), handlerNames(originalBodies));
  const definitionSet = new Set(declarations(externalBodies));
  const criticalHandlers = [
    'goPage', 'posRender', 'confirmarVenta', 'ventasRender', 'cajRender',
    'cliRender', 'renderCfgContent', '_naF8ExportReport', '_naF9Export',
  ];
  for (const name of criticalHandlers) assert.ok(definitionSet.has(name), `${name} definition`);
});

test('T8 all tracked frozen files remain identical to the base', () => {
  const changed = gitText(['diff', '--name-only', BASE, '--']).trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(changed, [INDEX_REL]);
  const frozen = [
    'CVV2.4_backup_antes_demo-1.html',
    'POS/js/core/utils.js',
    'POS/js/core/state.js',
    'POS/js/modules/ticket/legacy.js',
    'POS/js/modules/ticket/overrides.js',
    'POS/js/modules/ticket/zones.js',
    'POS/js/modules/ticket/secure-print.js',
    'POS/js/compat/legacy-globals.js',
    'POS/js/app.js',
    'tests/offline-compat/fase6-offline-compat.test.mjs',
    'tests/offline-compat/fase7-connection.test.mjs',
    'evidence/offline-compat/bootstrap-contract.json',
    'evidence/offline-compat/inventory.json',
    'evidence/offline-compat/override-winners.json',
    'evidence/offline-compat/report.json',
    'evidence/fase7-connection/report.json',
    'evidence/fase7-connection/dynamic-browser.json',
    'tests/macro-extraction/ticket-macro-extraction.test.mjs',
    'tests/macro-extraction/ticket-behavior-regression.test.mjs',
  ];
  execFileSync('git', ['diff', '--quiet', BASE, '--', ...frozen], { cwd: ROOT });
});

test('T9 V9, V10 dormancy, persistence, and finance bodies are textually unchanged', () => {
  const original = baseInlineScripts().map(script => script.body).join('\n');
  const moved = manifest.scripts.map(entry => externalBody(entry).toString('utf8')).join('\n');
  for (const token of [
    'snapshot_v9', '_naV10ConfigureRuntime', '_naV10ReadCanonical',
    '_naV10InitializeCanonical', '_naRunCriticalOperation', 'confirmarVenta',
  ]) {
    assert.equal(moved.split(token).length, original.split(token).length, token);
  }
  assert.ok(moved.includes('MODULO DE CAJA V10 — GASTOS / CASH_IN / CASH_OUT (DORMANTE, NO CONECTADO A V9)'));
});

test('T10 HEAD, staging, and tracked scope remain checkpoint-ready', () => {
  assert.equal(gitText(['rev-parse', 'HEAD']).trim(), BASE);
  assert.equal(gitText(['diff', '--cached', '--name-only']).trim(), '');
  execFileSync('git', ['diff', '--check'], { cwd: ROOT });
});
