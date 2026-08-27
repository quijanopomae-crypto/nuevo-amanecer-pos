// evidence.mjs — escritura de evidencia del Release Invariants Pack bajo evidence/.
// Única escritura autorizada por el alcance (evidence/), contenido determinista
// por gate: hechos verificados + resultado, sin modificar producto.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT, RELEASE_BASE, RELEASE_BRANCH } from './product.mjs';

export const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'release-invariants');

export function writeEvidence(filename, payload) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const body = {
    base: RELEASE_BASE,
    branch: RELEASE_BRANCH,
    generatedAt: new Date().toISOString(),
    ...payload,
  };
  const full = path.join(EVIDENCE_DIR, filename);
  writeFileSync(full, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return full;
}

export function writeEvidenceText(filename, text) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const full = path.join(EVIDENCE_DIR, filename);
  writeFileSync(full, text, 'utf8');
  return full;
}
