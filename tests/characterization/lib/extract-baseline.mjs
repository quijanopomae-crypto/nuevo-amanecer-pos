// extract-baseline.mjs — regenerate the authorized baseline fixture from git
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
//
// The fixture is extracted from the AUTHORIZED base commit using
// `git show <BASE_COMMIT>:<file>` and written as a raw Buffer (never through
// PowerShell redirection, which corrupts encoding). The git blob SHA-1 is
// verified against the authorized product blob before the fixture is trusted.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitBlobSha1 } from './blob-hash.mjs';

export const BASE_COMMIT = 'b4003e2f0d84cdb832de9eff730f60dc946cbbbe';
export const PRODUCT_BLOB = '2dec6363d8aeef52da64ba60ac8eac8eb14f75f7';
export const PRODUCT_FILENAME = 'CVV2.4_backup_antes_demo-1.html';
export const FIXTURE_BASENAME = `${PRODUCT_FILENAME.replace(/\.html$/i, '')}.baseline.html`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// fixtures dir lives one level above lib/
export const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
export const FIXTURE_PATH = path.join(FIXTURES_DIR, FIXTURE_BASENAME);

// Legacy mis-named fixture produced by an early revision of this module.
// Self-healing cleanup keeps the fixtures dir free of stale artifacts.
export const LEGACY_FIXTURE_PATH = path.join(FIXTURES_DIR, `${PRODUCT_FILENAME}.baseline.html`);

/**
 * Count logical lines the way `wc -l` does (number of line terminators),
 * after normalizing CRLF/CR to LF. The authorized baseline ends with a
 * newline, so this yields 7164.
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  let count = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

/**
 * Split text into lines (no trailing empty element from a final newline).
 * `lines[n-1]` is line n (1-indexed), matching the documented line numbers.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  const parts = text.split(/\r\n|\r|\n/);
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Read the raw product bytes from the authorized base commit via `git show`.
 * Returns a Buffer. Never uses shell redirection.
 * @returns {Buffer}
 */
export function readAuthorizedBlob() {
  const out = execFileSync(
    'git',
    ['show', `${BASE_COMMIT}:${PRODUCT_FILENAME}`],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  return out;
}

/**
 * Read the fixture text (UTF-8) from disk.
 * @returns {string}
 */
export function readFixtureText() {
  return fs.readFileSync(FIXTURE_PATH, 'utf8');
}

/**
 * Ensure the baseline fixture exists and matches the authorized product blob.
 * If missing or corrupt, regenerate it from git and re-verify. Also removes any
 * stale legacy-named fixture.
 * @returns {{ path: string, blob: string, lines: number, regenerated: boolean }}
 */
export function ensureBaselineFixture() {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  // Self-healing cleanup of a stale legacy-named fixture.
  if (fs.existsSync(LEGACY_FIXTURE_PATH) && LEGACY_FIXTURE_PATH !== FIXTURE_PATH) {
    fs.rmSync(LEGACY_FIXTURE_PATH, { force: true });
  }

  let regenerated = false;
  if (fs.existsSync(FIXTURE_PATH)) {
    const existing = fs.readFileSync(FIXTURE_PATH);
    const existingBlob = gitBlobSha1(existing);
    if (existingBlob === PRODUCT_BLOB) {
      const lines = countLines(existing.toString('utf8'));
      return { path: FIXTURE_PATH, blob: existingBlob, lines, regenerated: false };
    }
  }

  // (Re)generate from git.
  const buffer = readAuthorizedBlob();
  const blob = gitBlobSha1(buffer);
  if (blob !== PRODUCT_BLOB) {
    throw new Error(
      `Baseline extraction mismatch: git show produced blob ${blob}, expected authorized ${PRODUCT_BLOB}`
    );
  }
  fs.writeFileSync(FIXTURE_PATH, buffer);
  regenerated = true;
  const lines = countLines(buffer.toString('utf8'));
  return { path: FIXTURE_PATH, blob, lines, regenerated };
}

export default {
  BASE_COMMIT,
  PRODUCT_BLOB,
  PRODUCT_FILENAME,
  FIXTURE_BASENAME,
  FIXTURES_DIR,
  FIXTURE_PATH,
  countLines,
  splitLines,
  readFixtureText,
  ensureBaselineFixture,
};
