import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '5f5bccb00ab871502212bc7babd0d99227ee203d';
const INDEX_PATH = path.join(ROOT, 'POS', 'index.html');
const MODULE_PATHS = {
  legacy: path.join(ROOT, 'POS', 'js', 'modules', 'ticket', 'legacy.js'),
  overrides: path.join(ROOT, 'POS', 'js', 'modules', 'ticket', 'overrides.js'),
  zones: path.join(ROOT, 'POS', 'js', 'modules', 'ticket', 'zones.js'),
  securePrint: path.join(ROOT, 'POS', 'js', 'modules', 'ticket', 'secure-print.js'),
};

const lf = value => String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const read = file => lf(fs.readFileSync(file, 'utf8'));
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const baseIndex = lf(git(['show', `${BASE}:POS/index.html`]));
const currentIndex = read(INDEX_PATH);
const modules = Object.fromEntries(Object.entries(MODULE_PATHS).map(([key, file]) => [key, read(file)]));

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

function scriptAround(source, marker) {
  const markerAt = source.indexOf(marker);
  assert.ok(markerAt >= 0, `missing script marker: ${marker}`);
  const open = source.lastIndexOf('<script', markerAt);
  const openEnd = source.indexOf('\n', open) + 1;
  const close = source.indexOf('</script>', markerAt);
  const closeEnd = source.indexOf('\n', close) + 1;
  assert.ok(open >= 0 && openEnd > open && close > markerAt && closeEnd > close, `invalid script around ${marker}`);
  return {
    whole: source.slice(open, closeEnd),
    content: source.slice(openEnd, close),
  };
}

function replaceOnce(source, original, replacement, label) {
  const first = source.indexOf(original);
  assert.ok(first >= 0, `missing replacement source: ${label}`);
  assert.equal(source.indexOf(original, first + original.length), -1, `replacement source is not unique: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + original.length);
}

const baseBlocks = {
  legacy: between(baseIndex, '// ===== TICKET =====', '// ===== GASTOS ====='),
  overrides: between(baseIndex, '// Ticket y catálogo', '// Gastos'),
  zones: scriptAround(baseIndex, '// NUEVO FASE 11 — EDITOR AVANZADO DE TICKET POR ZONAS'),
  securePrint: scriptAround(baseIndex, '<script id="na-security-ticket-print">'),
};

function expectedExtractedIndex() {
  let expected = baseIndex;
  expected = replaceOnce(
    expected,
    baseBlocks.legacy,
    '</script>\n<script src="js/modules/ticket/legacy.js"></script>\n<script>\n',
    'legacy ticket block',
  );
  expected = replaceOnce(
    expected,
    baseBlocks.overrides,
    '</script>\n<script src="js/modules/ticket/overrides.js"></script>\n<script>\n',
    'ticket overrides block',
  );
  expected = replaceOnce(
    expected,
    baseBlocks.zones.whole,
    '<script src="js/modules/ticket/zones.js"></script>\n',
    'ticket zones script',
  );
  expected = replaceOnce(
    expected,
    baseBlocks.securePrint.whole,
    '<script id="na-security-ticket-print" src="js/modules/ticket/secure-print.js"></script>\n',
    'secure ticket print script',
  );
  return expected;
}

function definitionNames(source) {
  const names = [];
  const patterns = [
    /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/g,
    /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.push(match[1]);
  }
  return names;
}

function countDefinitions(source, name) {
  return definitionNames(source).filter(candidate => candidate === name).length;
}

function assertGitUnchanged(paths) {
  execFileSync('git', ['diff', '--quiet', BASE, '--', ...paths], { cwd: ROOT });
}

test('T1 moved code is byte-equivalent to the four base blocks after LF normalization', () => {
  assert.equal(modules.legacy, baseBlocks.legacy);
  assert.equal(modules.overrides, baseBlocks.overrides);
  assert.equal(modules.zones, baseBlocks.zones.content);
  assert.equal(modules.securePrint, baseBlocks.securePrint.content);
});

test('T2 POS/index.html differs from the mandatory base only by the four loaders', () => {
  assert.equal(currentIndex, expectedExtractedIndex());
});

test('T3 all extracted files are valid classic JavaScript', () => {
  for (const [name, source] of Object.entries(modules)) {
    assert.doesNotThrow(() => new vm.Script(source, { filename: `${name}.js` }));
  }
});

test('T4 classic load order preserves every original execution point', () => {
  const tags = [
    '<script src="js/core/utils.js"></script>',
    '<script src="js/modules/ticket/legacy.js"></script>',
    '<script src="js/modules/ticket/overrides.js"></script>',
    '<script src="js/core/state.js"></script>',
    '<script src="js/modules/ticket/zones.js"></script>',
    '<script id="na-security-ticket-print" src="js/modules/ticket/secure-print.js"></script>',
    '<script src="js/compat/legacy-globals.js"></script>',
    '<script src="js/app.js"></script>',
  ];
  const positions = tags.map(tag => {
    assert.equal(currentIndex.split(tag).length - 1, 1, `${tag} must appear exactly once`);
    assert.ok(!/\b(?:async|defer|type\s*=\s*["']module)/i.test(tag), `${tag} must remain classic and synchronous`);
    return currentIndex.indexOf(tag);
  });
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('T5 extracted definition and override counts are unchanged from the base', () => {
  const moduleSource = Object.values(modules).join('\n');
  const currentExecutable = `${currentIndex}\n${moduleSource}`;
  const names = [...new Set(definitionNames(moduleSource))].sort();
  assert.ok(names.length >= 45, 'expected a substantial ticket API');
  for (const name of names) {
    assert.equal(countDefinitions(currentExecutable, name), countDefinitions(baseIndex, name), name);
  }
});

test('T6 ticket and printer handlers remain defined and connected', () => {
  const executable = `${currentIndex}\n${Object.values(modules).join('\n')}`;
  const handlers = [
    'toggleEditor', 'ticketWidthChanged', 'ticketPreviewSizeChanged', 'renderTicketPreview',
    'ticketZonePreset', 'ticketZoneReset', 'ticketZoneSet', 'ticketZoneMove',
    'ticketZoneDragStart', 'ticketZoneDragEnd', 'ticketZoneDragOver', 'ticketZoneDragLeave',
    'ticketZoneDrop', 'guardarAjustesImpresora', 'actualizarDispositivosBluetooth',
    'buscarImpresoraBluetooth', 'imprimirPorConexion', 'compartirTicketBluetooth',
    'imprimirTicketSistema', 'desconectarImpresora', 'imprimirTicket', 'verTicket',
  ];
  for (const handler of handlers) {
    assert.ok(countDefinitions(executable, handler) >= 1, `${handler} definition missing`);
    assert.ok(baseIndex.includes(`${handler}(`), `${handler} was not part of the base contract`);
  }
});

test('T7 shared classic globals and pure ticket behavior remain available', () => {
  const context = vm.createContext({
    appConfig: { ticket: {} },
    _naDefaults: { ticket: {} },
    _naSaveTicketSettings() {},
    _naHydrateTicket() {},
    document: { addEventListener() {} },
    navigator: { userAgent: '', serial: null },
    console,
  });
  new vm.Script(modules.legacy, { filename: 'legacy.js' }).runInContext(context);
  new vm.Script(modules.zones, { filename: 'zones.js' }).runInContext(context);
  assert.equal(vm.runInContext('_naTicketChars(58)', context), 29);
  assert.equal(vm.runInContext("_naTicketAscii('¡Árbol número 1!')", context), '!Arbol numero 1!');
  assert.equal(vm.runInContext("_naTkWrap('uno dos tres', 7).join('|')", context), 'uno dos|tres');
  assert.equal(vm.runInContext("_naF11ParseOrder('h,i,p,t,y,f').join(',')", context), 'h,i,p,t,y,f');
});

test('T8 canonical product fixture is untouched', () => {
  assertGitUnchanged(['CVV2.4_backup_antes_demo-1.html']);
});

test('T9 core/utils and core/state remain frozen', () => {
  assertGitUnchanged(['POS/js/core/utils.js', 'POS/js/core/state.js']);
});

test('T10 F6 and F7 tracked contracts remain frozen', () => {
  assertGitUnchanged([
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
  ]);
});

test('T11 V9 and dormant V10 contracts remain in the untouched index remainder', () => {
  for (const token of ['snapshot_v9', '_naV10ConfigureRuntime', '_naV10ReadCanonical', '_naV10InitializeCanonical']) {
    assert.equal(currentIndex.split(token).length, baseIndex.split(token).length, token);
  }
  assert.ok(currentIndex.includes('MODULO DE CAJA V10 — GASTOS / CASH_IN / CASH_OUT (DORMANTE, NO CONECTADO A V9)'));
});

test('T12 extracted code contains no critical persistence or financial mutation implementation', () => {
  const source = Object.values(modules).join('\n');
  const forbiddenDefinitions = [
    '_naV10ConfigureRuntime', '_naV10Commit', '_naV10InitializeCanonical',
    'confirmarCobro', 'anularV', 'guardarPago', 'guardarMovCaja', 'guardarGasto',
    'confirmarVenta', '_naRunCriticalOperation',
  ];
  for (const name of forbiddenDefinitions) assert.equal(countDefinitions(source, name), 0, name);
  assert.equal(/indexedDB\.open\s*\(/.test(source), false);
});

test('T13 extraction leaves the Git index empty', () => {
  assert.equal(git(['diff', '--cached', '--name-only']).trim(), '');
});
