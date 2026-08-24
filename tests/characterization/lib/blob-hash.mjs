// blob-hash.mjs — git blob SHA-1 helper (pure, deterministic)
//
// OBJECTIVE_ID: FASE4-CHARACTERIZATION-BASELINE
// A git blob's object id is: sha1("blob " + <byteLength> + "\0" + <content>)
// (using the length in bytes, not chars). This is used to verify that the
// extracted fixture matches the authorized product blob from the base commit.

import { createHash } from 'node:crypto';

/**
 * Compute the git blob SHA-1 for a Buffer of bytes.
 * @param {Buffer|Uint8Array} buffer raw file content
 * @returns {string} 40-char lowercase hex object id
 */
export function gitBlobSha1(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const header = Buffer.from(`blob ${buf.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(buf).digest('hex');
}

/**
 * Compute the git blob SHA-1 for a string, encoding it as UTF-8.
 * @param {string} content
 * @returns {string} 40-char lowercase hex object id
 */
export function gitBlobSha1String(content) {
  return gitBlobSha1(Buffer.from(content, 'utf8'));
}

export default { gitBlobSha1, gitBlobSha1String };
