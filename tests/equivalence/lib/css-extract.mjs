// css-extract.mjs — FASE 5 static CSS extraction (deterministic builder)
//
// OBJECTIVE_ID: FASE5-CSS-EXTRACTION
//
// Builds the POS/** candidate from the AUTHORIZED product blob (git) without
// touching the canonical product file. The builder is pure and deterministic:
//   - source is read from `git show <BASE_COMMIT>:<PRODUCT_FILENAME>` as a raw
//     Buffer (never via shell redirection), normalized to LF;
//   - the 8 real <style> blocks are located with the characterization parser
//     (parseStyleBlocks already excludes the JS template-string false positives
//     at L3000 / L3712);
//   - CSS contents are split per architecture (base = B1, layout = B2,
//     components = B3..B8, responsive/print = empty by design);
//   - index.html is the source with the 8 style spans replaced: B1 -> 5 <link>
//     tags, B2..B8 -> a single empty line, with adjacent blank-line runs
//     collapsed (localized to each block's extended span, never entering a
//     <script> region).
//
// No timestamps, no randomness, no I/O beyond the requested `write`.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseScriptBlocks, parseStyleBlocks } from '../../characterization/lib/static-parse.mjs';
import { splitLines, countLines } from '../../characterization/lib/extract-baseline.mjs';
import { gitBlobSha1 } from '../../characterization/lib/blob-hash.mjs';

export const BASE_COMMIT = 'd0125183918a2f6f710d4d234005c3ac8757c1a6';
export const SOURCE_BLOB = '2dec6363d8aeef52da64ba60ac8eac8eb14f75f7';
export const PRODUCT_FILENAME = 'CVV2.4_backup_antes_demo-1.html';
export const EXPECTED_STYLE_BLOCKS = 8;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// tests/equivalence/lib -> ../../.. = workspace root
export const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
export const POS_DIR = path.resolve(ROOT_DIR, 'POS');

export const LINK_ORDER = [
  'css/base.css',
  'css/layout.css',
  'css/components.css',
  'css/responsive.css',
  'css/print.css',
];

const EMPTY_CSS_COMMENT =
  '/* FASE 5 — reservado: sin selectores ni reglas. El invariante byte-exacto ' +
  '(base + layout + components === B1..B8) exige este archivo vacío en esta fase. */';

function sha256String(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function isBlank(line) {
  return line.trim() === '';
}

/**
 * Read the authorized product source as a single LF string.
 * @returns {{ source: string, buffer: Buffer, blob: string }}
 */
function readSourceLf() {
  const buffer = execFileSync(
    'git',
    ['show', `${BASE_COMMIT}:${PRODUCT_FILENAME}`],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  const blob = gitBlobSha1(buffer);
  const source = buffer.toString('utf8').replace(/\r\n?/g, '\n');
  return { source, buffer, blob };
}

/**
 * Build the POS/** candidate deterministically.
 *
 * @param {{ write?: boolean }} opts if `write` is true, materialize POS/** on disk.
 * @returns {{ sourceBlob: string, bloques: object[], cssFiles: object[],
 *            cssPaths: string[], indexHtml: string, assetsReadme: string,
 *            hashes: object }}
 */
export function buildPosCandidate({ write = false } = {}) {
  const { source, blob } = readSourceLf();
  const lines = splitLines(source);

  const scripts = parseScriptBlocks(lines);
  const styles = parseStyleBlocks(lines, scripts);

  if (styles.length !== EXPECTED_STYLE_BLOCKS) {
    throw new Error(
      `css-extract: expected ${EXPECTED_STYLE_BLOCKS} real style blocks, found ${styles.length}`
    );
  }

  // Per-block raw CSS content (the lines between <style> and </style>).
  const bloques = styles.map((b, index) => {
    const content = lines.slice(b.startLine, b.endLine - 1).join('\n');
    return {
      index,
      startLine: b.startLine,
      endLine: b.endLine,
      id: b.id,
      content,
    };
  });

  const baseContent = bloques[0].content; // B1
  const layoutContent = bloques[1].content; // B2
  const componentsContent = bloques.slice(2).map((b) => b.content).join('\n'); // B3..B8

  const invariantContent = `${baseContent}\n${layoutContent}\n${componentsContent}`;
  const joinedBlocks = bloques.map((b) => b.content).join('\n');

  // ---- index.html ---------------------------------------------------------
  // Replace block spans bottom-up so earlier line indices stay valid.
  const out = lines.slice();
  const sorted = [...styles].sort((a, b) => a.startLine - b.startLine);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const b = sorted[i];
    let s = b.startLine; // 1-based inclusive
    let e = b.endLine; // 1-based inclusive

    let replacement;
    if (i === 0) {
      // B1 -> the 5 <link> tags (no blank extension: it is replaced, not collapsed).
      replacement = LINK_ORDER.map((href) => `    <link rel="stylesheet" href="${href}">`);
    } else {
      // B2..B8 -> single empty line; extend across adjacent blank lines and
      // collapse the whole (block + separator blanks) span to one empty line.
      while (s > 1 && isBlank(out[s - 2])) s -= 1;
      while (e < out.length && isBlank(out[e])) e += 1;
      replacement = [''];
    }

    out.splice(s - 1, e - s + 1, ...replacement);
  }
  const indexHtml = `${out.join('\n')}\n`;

  const assetsReadme = 'Reservado para assets estáticos futuros (imágenes, fuentes, íconos).\n';

  // ---- CSS files (content + single trailing LF) ---------------------------
  const cssSpecs = [
    { file: 'POS/css/base.css', content: baseContent },
    { file: 'POS/css/layout.css', content: layoutContent },
    { file: 'POS/css/components.css', content: componentsContent },
    { file: 'POS/css/responsive.css', content: EMPTY_CSS_COMMENT },
    { file: 'POS/css/print.css', content: EMPTY_CSS_COMMENT },
  ];

  const cssFiles = cssSpecs.map((spec) => {
    const fileBytes = Buffer.from(`${spec.content}\n`, 'utf8');
    return {
      file: spec.file,
      absPath: path.join(ROOT_DIR, spec.file),
      content: spec.content,
      bytes: fileBytes,
      sha256: sha256Buffer(fileBytes),
      lines: countLines(fileBytes.toString('utf8')),
    };
  });

  const hashes = {
    base: sha256String(baseContent),
    layout: sha256String(layoutContent),
    components: sha256String(componentsContent),
    invariant: sha256String(invariantContent),
    joinedBlocks: sha256String(joinedBlocks),
    index: sha256String(indexHtml),
    files: Object.fromEntries(cssFiles.map((f) => [f.file, f.sha256])),
  };

  const result = {
    baseCommit: BASE_COMMIT,
    sourceBlob: blob,
    bloques,
    cssFiles,
    cssPaths: cssFiles.map((f) => f.file),
    indexHtml,
    assetsReadme,
    hashes,
  };

  if (write) {
    fs.mkdirSync(path.join(POS_DIR, 'css'), { recursive: true });
    fs.mkdirSync(path.join(POS_DIR, 'assets'), { recursive: true });

    // Self-healing: an earlier revision of this builder wrote the css files to
    // POS/ root (using path.basename) instead of POS/css/. Remove those stale
    // files so POS/ stays clean and the build is deterministic.
    for (const spec of cssSpecs) {
      const stalePath = path.join(POS_DIR, path.basename(spec.file));
      if (stalePath !== path.join(ROOT_DIR, spec.file) && fs.existsSync(stalePath)) {
        fs.rmSync(stalePath, { force: true });
      }
    }

    for (const f of cssFiles) {
      fs.writeFileSync(f.absPath, f.bytes);
    }
    fs.writeFileSync(path.join(POS_DIR, 'index.html'), Buffer.from(indexHtml, 'utf8'));
    fs.writeFileSync(path.join(POS_DIR, 'assets', 'README.md'), Buffer.from(assetsReadme, 'utf8'));
  }

  return result;
}

export default { buildPosCandidate, BASE_COMMIT, SOURCE_BLOB, PRODUCT_FILENAME, POS_DIR, LINK_ORDER };
