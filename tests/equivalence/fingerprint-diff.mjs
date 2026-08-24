// fingerprint-diff.mjs — compare two analyzeAll() outputs by name universe
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
// Pure, deterministic comparison of static analyses. The universe of names is
// built from function definitions (functionDefs), the override map (for the
// effective/final implementation) and top-level global declarations.

import { canonicalJson } from '../characterization/lib/fingerprint.mjs';

/**
 * Build a canonical per-name signature map from an analyzeAll() result.
 * Each entry captures:
 *   functionDefs      -> sorted definition line numbers (from `functions`)
 *   finalImplementation -> effective (last) definition line (from `overrideMap`)
 *   globalLines       -> sorted top-level declaration line numbers (from `globals`)
 * @param {object} analysis result of analyzeAll()
 * @returns {Record<string, {functionDefs:number[], finalImplementation:(number|null), globalLines:number[]}>}
 */
export function collectNames(analysis) {
  const names = new Map();
  const ensure = (name) => {
    if (!names.has(name)) {
      names.set(name, { functionDefs: [], finalImplementation: null, globalLines: [] });
    }
    return names.get(name);
  };

  for (const f of analysis.functions || []) {
    if (f && typeof f.name === 'string' && typeof f.line === 'number') {
      ensure(f.name).functionDefs.push(f.line);
    }
  }
  for (const [name, entry] of Object.entries(analysis.overrideMap || {})) {
    if (entry && typeof entry.finalImplementation === 'number') {
      ensure(name).finalImplementation = entry.finalImplementation;
    }
  }
  for (const g of analysis.globals || []) {
    if (g && typeof g.name === 'string' && typeof g.line === 'number') {
      ensure(g.name).globalLines.push(g.line);
    }
  }

  const out = {};
  for (const [name, entry] of names) {
    out[name] = {
      functionDefs: Array.from(new Set(entry.functionDefs)).sort((x, y) => x - y),
      finalImplementation: entry.finalImplementation,
      globalLines: Array.from(new Set(entry.globalLines)).sort((x, y) => x - y),
    };
  }
  return out;
}

/**
 * Diff two analyses by name universe.
 * @param {object} a analysis A (baseline/reference)
 * @param {object} b analysis B
 * @returns {{added:string[], removed:string[], changed:string[]}}
 *   added   -> names present only in b
 *   removed -> names present only in a
 *   changed -> names in both whose definition/global signature differs
 */
export function diffFingerprints(a, b) {
  const na = collectNames(a);
  const nb = collectNames(b);
  const keysA = Object.keys(na);
  const keysB = Object.keys(nb);
  const inB = new Set(keysB);

  const added = keysB.filter((n) => !(n in na)).sort();
  const removed = keysA.filter((n) => !(n in nb)).sort();
  const changed = keysA.filter((n) => inB.has(n) && canonicalJson(na[n]) !== canonicalJson(nb[n])).sort();

  return { added, removed, changed };
}

export default { collectNames, diffFingerprints };
