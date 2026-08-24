// fingerprint.mjs — canonical JSON serialization + stable SHA-256 fingerprints
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
// Deterministic fingerprints are used across manifests and equivalence diffs so
// that regenerating evidence produces byte-identical files (no timestamps, no
// key-order drift, no whitespace).

import { createHash } from 'node:crypto';

/**
 * Deterministically order all object keys (recursively) and return the raw
 * string with NO whitespace. Arrays preserve order; primitives pass through.
 * @param {*} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return serialize(value);
}

function serialize(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (Number.isNaN(value)) return 'null';
    if (!Number.isFinite(value)) return 'null';
    return String(value);
  }
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(serialize).join(',') + ']';
  }
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(value[k])).join(',') + '}';
  }
  // functions, symbols, undefined → null (stable)
  return 'null';
}

/**
 * Full SHA-256 (64 hex chars) of the canonical JSON.
 * @param {*} value
 * @returns {string}
 */
export function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Short fingerprint: first 16 hex chars of the SHA-256 canonical.
 * @param {*} value
 * @returns {string}
 */
export function shortFingerprint(value) {
  return sha256Canonical(value).slice(0, 16);
}

/**
 * Full fingerprint object (alias of sha256Canonical for API clarity).
 * @param {*} value
 * @returns {string} 64-char hex
 */
export function fingerprint(value) {
  return sha256Canonical(value);
}

export default { canonicalJson, sha256Canonical, shortFingerprint, fingerprint };
