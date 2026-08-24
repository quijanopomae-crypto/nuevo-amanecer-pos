// evidence.mjs — deterministic static evidence + manifest builder
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
// Produces the JSON files written under evidence/characterization/ with NO
// timestamps. Rebuilding with the same authorized blob yields byte-identical
// output (verified by the generate-evidence test).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAll } from './static-parse.mjs';
import { fingerprint } from './fingerprint.mjs';
import { BASE_COMMIT, PRODUCT_BLOB } from './extract-baseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// tests/characterization/lib -> ../../../ = workspace root
export const EVIDENCE_DIR = path.resolve(__dirname, '..', '..', '..', 'evidence', 'characterization');

export const KNOWN_BASELINES = {
  CASH: '11/13',
  cashNotes: ['HISTORICAL_COMMIT_UNVERIFIED x2'],
  CREDITS: '21/22',
  creditsNotes: ['criterion/criterio'],
  saleTransaction: 'baseline pendiente',
  INVENTORY: 'A_PLUS_B cerrado; 2 P1 + 1 P2 pendientes',
};

function isV10Name(name) {
  return /^_naV10/.test(name) || name === '_naRunCriticalOperation' || name === '_naNewOperationId';
}

function isV10StorageKey(key) {
  return /^na_snapshot_v10/.test(key) || key === 'na_v10_outbox';
}

/**
 * Build the full static evidence object and manifest (pure, deterministic).
 * @param {string} source
 * @returns {{ files: Record<string, object>, manifest: object }}
 */
export function buildEvidence(source) {
  const a = analyzeAll(source);

  const structural = {
    lineCount: a.lineCount,
    scriptCount: a.scripts.length,
    inlineScriptCount: a.scripts.filter((s) => s.src == null).length,
    externalScriptCount: a.scripts.filter((s) => s.src != null).length,
    scripts: a.scripts,
    styleCount: a.styles.length,
    styles: a.styles,
    typeModuleCount: a.typeModuleCount,
    formsCount: a.formsCount,
    buttons: a.buttons,
    innerHtml: a.innerHtml,
  };
  const overrides = a.overrideMap;
  const globals = a.globals.map((g) => ({ name: g.name, kind: g.kind, initSnippet: g.initSnippet, line: g.line }));
  const storageStatic = a.storage;
  const startup = a.startup;
  const v10Dormancy = a.v10;
  const domIds = a.domIds;
  const inlineHandlers = a.handlers;
  const externalDeps = a.deps;

  // ---- fingerprints -------------------------------------------------------
  const globalApi = globals.map((g) => ({ name: g.name, kind: g.kind, line: g.line }))
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

  const v9Overrides = {};
  for (const [name, entry] of Object.entries(overrides)) {
    if (!isV10Name(name)) v9Overrides[name] = entry;
  }
  const v9Globals = globalApi.filter((g) => !isV10Name(g.name));
  const v9Storage = {
    localStorage: storageStatic.localStorage.filter((k) => !isV10StorageKey(k)),
    sessionStorage: storageStatic.sessionStorage.filter((k) => !isV10StorageKey(k)),
    legacy: storageStatic.legacy,
  };
  const v9Baseline = {
    overrides: v9Overrides,
    globals: v9Globals,
    storage: v9Storage,
    startup: { entrySequence: startup.entrySequence, listeners: startup.listeners },
  };

  const manifest = {
    productBlob: PRODUCT_BLOB,
    baseCommit: BASE_COMMIT,
    fingerprints: {
      domFingerprint: { value: fingerprint(domIds), source: 'sha256(canonical dom-ids.json: static ids + dynamic template id count)' },
      globalApiFingerprint: { value: fingerprint(globalApi), source: 'sha256(canonical sorted global declarations (name/kind/line))' },
      overrideMapFingerprint: { value: fingerprint(overrides), source: 'sha256(canonical overrideMap: all functions with >1 definition)' },
      storageFingerprint: { value: fingerprint(storageStatic), source: 'sha256(canonical storage-static.json inventory)' },
      v9BaselineFingerprint: { value: fingerprint(v9Baseline), source: 'sha256(canonical V9-only overrides + globals + storage + startup)' },
      v10BaselineFingerprint: { value: fingerprint(v10Dormancy), source: 'sha256(canonical v10-dormancy.json)' },
      knownFailuresFingerprint: { value: fingerprint(KNOWN_BASELINES), source: 'sha256(canonical known_baselines block)' },
    },
  };

  const wrap = (data) => ({ productBlob: PRODUCT_BLOB, baseCommit: BASE_COMMIT, data });

  const files = {
    'structural.json': wrap(structural),
    'overrides.json': wrap(overrides),
    'globals.json': wrap(globals),
    'storage-static.json': wrap(storageStatic),
    'startup.json': wrap(startup),
    'v10-dormancy.json': wrap(v10Dormancy),
    'dom-ids.json': wrap(domIds),
    'inline-handlers.json': wrap(inlineHandlers),
    'external-deps.json': wrap(externalDeps),
  };

  return { files, manifest };
}

export default { EVIDENCE_DIR, KNOWN_BASELINES, buildEvidence };
