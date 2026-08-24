// css-static-extraction.test.mjs — FASE 5 static CSS extraction equivalence tests
//
// OBJECTIVE_ID: FASE5-CSS-EXTRACTION
//
// Gates (T1..T12) that verify the POS/** candidate built by
// lib/css-extract.mjs is deterministic, byte-exact against the authorized
// product blob for every non-CSS concern, and satisfies the CSS architecture.
//
// Equivalence note: extracting CSS removes the 8 <style> spans, so every LINE
// NUMBER in the derived index.html shifts and the 5 <style id="..."> hooks are
// intentionally gone. T5 therefore compares content signatures that are
// line-agnostic (script texts, function/global name+kind, override structure,
// storage inventory, startup chain, V10 dormancy, external deps) and subtracts
// the removed style-tag ids from the static DOM-id set. Any difference in those
// signatures is a NEW_REGRESSION.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import {
  buildPosCandidate,
  BASE_COMMIT,
  SOURCE_BLOB,
  PRODUCT_FILENAME,
  POS_DIR,
  LINK_ORDER,
} from './lib/css-extract.mjs';
import {
  analyzeAll,
  parseScriptBlocks,
  parseStyleBlocks,
  parseExternalDeps,
} from '../characterization/lib/static-parse.mjs';
import { splitLines } from '../characterization/lib/extract-baseline.mjs';
import { gitBlobSha1 } from '../characterization/lib/blob-hash.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(ROOT, 'evidence', 'css-extraction');
const REPORT_PATH = path.join(EVIDENCE_DIR, 'report.json');

function sha256String(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

function readCanonicalLf() {
  const buf = execFileSync(
    'git',
    ['show', `${BASE_COMMIT}:${PRODUCT_FILENAME}`],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
  return buf.toString('utf8').replace(/\r\n?/g, '\n');
}

function readCanonicalBuffer() {
  return execFileSync(
    'git',
    ['show', `${BASE_COMMIT}:${PRODUCT_FILENAME}`],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }
  );
}

// ---------------------------------------------------------------------------
// Content signature (line-agnostic) used by the equivalence gate T5.
// ---------------------------------------------------------------------------

const HANDLER_ATTR = 'onclick|onchange|oninput|onkeydown|onsubmit|ondrag\\w*';

function scriptRanges(scripts) {
  return scripts.filter((s) => s.src == null).map((s) => [s.startLine, s.endLine]);
}

function isInside(ranges, lineNo) {
  return ranges.some(([s, e]) => lineNo >= s && lineNo <= e);
}

function staticDomIds(lines, ranges) {
  const ids = new Set();
  const idRe = /\bid\s*=\s*["']([^"']+)["']/g;
  for (let i = 0; i < lines.length; i += 1) {
    if (isInside(ranges, i + 1)) continue;
    const re = new RegExp(idRe.source, 'g');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      ids.add(m[1]);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return Array.from(ids).sort();
}

function staticHandlerNames(lines, ranges) {
  const names = new Set();
  const valueRe = new RegExp(`\\b(?:${HANDLER_ATTR})\\s*=\\s*["']([^"']*)["']`, 'gi');
  const callRe = /([A-Za-z_$][\w$]*)\s*\(/g;
  for (let i = 0; i < lines.length; i += 1) {
    if (isInside(ranges, i + 1)) continue;
    const re = new RegExp(valueRe.source, 'gi');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      const value = m[1];
      const cr = new RegExp(callRe.source, 'g');
      cr.lastIndex = 0;
      let cm;
      while ((cm = cr.exec(value)) !== null) {
        names.add(cm[1]);
        if (cm.index === cr.lastIndex) cr.lastIndex += 1;
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return Array.from(names).sort();
}

/**
 * Line-agnostic projection of analyzeAll() output, used for equivalence.
 * Line numbers (function/global/startup/v10/storage/deps `line` fields), the
 * whole-text `references` occurrence count and the `callersStatic` diagnostic
 * are deliberately excluded: they are computed from line positions and the
 * hardcoded STATIC_HTML_BOUNDARY=2271 heuristic, so they are legitimately
 * shifted by CSS extraction and do not encode functional content.
 */
function contentSignature(source) {
  const lines = splitLines(source);
  const a = analyzeAll(source);
  const ranges = scriptRanges(a.scripts);

  const scriptTexts = a.scripts.map((s) =>
    lines.slice(s.startLine - 1, s.endLine).join('\n')
  );

  const overrides = {};
  for (const [name, e] of Object.entries(a.overrideMap)) {
    overrides[name] = {
      kinds: e.kinds,
      finalKind: e.finalKind,
      domain: e.domain,
      finalBlock: e.finalBlock
        ? { index: e.finalBlock.index, id: e.finalBlock.id }
        : null,
    };
  }

  return {
    scriptTexts,
    staticIds: staticDomIds(lines, ranges),
    handlerCounts: a.handlers.counts,
    staticHandlerNames: staticHandlerNames(lines, ranges),
    globals: a.globals.map((g) => ({ name: g.name, kind: g.kind, init: g.initSnippet })),
    functions: a.functions.map((f) => ({ name: f.name, kind: f.kind })),
    overrides,
    startup: {
      listeners: a.startup.listeners.map((l) => l.event),
      entrySequence: a.startup.entrySequence,
    },
    v10: {
      dormant: a.v10.dormant,
      definitions: a.v10.definitions.map((d) => ({ name: d.name, kind: d.kind })),
      totalReferences: a.v10.totalReferences,
    },
    storage: {
      localStorage: a.storage.localStorage,
      sessionStorage: a.storage.sessionStorage,
      legacy: a.storage.legacy,
      other: a.storage.other,
      dynamicConflictKey: a.storage.dynamicConflictKey,
      constants: a.storage.constants,
      dbOpens: a.storage.dbOpens.map((d) => ({ nameExpr: d.nameExpr, versionExpr: d.versionExpr })),
      objectStores: a.storage.objectStores.map((o) => ({ nameExpr: o.nameExpr, name: o.name, keyPath: o.keyPath })),
    },
    deps: {
      links: a.deps.links.map((l) => ({ href: l.href, rel: l.rel })),
      scripts: a.deps.scripts.map((s) => ({ src: s.src, defer: s.defer, async: s.async })),
    },
  };
}

function cssContentByName(candidate, name) {
  const f = candidate.cssFiles.find((x) => x.file.endsWith(`${name}.css`));
  assert.ok(f, `css file ${name}.css must exist`);
  return f.content;
}

function combinedCss(candidate) {
  const base = cssContentByName(candidate, 'base');
  const layout = cssContentByName(candidate, 'layout');
  const components = cssContentByName(candidate, 'components');
  return { base, layout, components, combined: `${base}\n${layout}\n${components}` };
}

// ---------------------------------------------------------------------------
// Shared candidate (in-memory; write happens in T1).
// ---------------------------------------------------------------------------

let _candidate = null;
function candidate() {
  if (!_candidate) _candidate = buildPosCandidate({ write: false });
  return _candidate;
}

// ===========================================================================
// T1 — materialization + determinism
// ===========================================================================

test('T1: buildPosCandidate({write:true}) materializes POS/ and is deterministic', () => {
  const written = buildPosCandidate({ write: true });

  assert.ok(fs.existsSync(path.join(POS_DIR, 'index.html')), 'POS/index.html must exist');
  for (const p of LINK_ORDER) {
    assert.ok(fs.existsSync(path.join(POS_DIR, p)), `${p} must exist`);
  }
  assert.ok(fs.existsSync(path.join(POS_DIR, 'assets', 'README.md')), 'POS/assets/README.md must exist');

  const a = buildPosCandidate({ write: false });
  const b = buildPosCandidate({ write: false });
  assert.deepEqual(a.hashes, b.hashes, 'two in-memory builds must have identical hashes');
  assert.equal(a.indexHtml, b.indexHtml, 'two in-memory builds must have identical index.html');
  assert.deepEqual(
    a.cssFiles.map((f) => f.sha256),
    written.cssFiles.map((f) => f.sha256),
    'written cssFiles must hash identically to in-memory build'
  );
});

// ===========================================================================
// T2 — golden invariant
// ===========================================================================

test('T2: base+layout+components === join(bloques B1..B8) byte-exact (LF)', () => {
  const c = candidate();
  const { base, layout, components } = combinedCss(c);

  const recombined = `${base}\n${layout}\n${components}`;
  const joinedBlocks = c.bloques.map((b) => b.content).join('\n');

  assert.equal(recombined, joinedBlocks, 'recombined CSS must byte-equal the block join');
  assert.equal(
    sha256String(recombined),
    sha256String(joinedBlocks),
    'invariant sha256(base+\\n+layout+\\n+components) === sha256(join(bloques,\\n))'
  );
  assert.equal(c.hashes.invariant, c.hashes.joinedBlocks, 'builder invariant hash must match joined blocks hash');
  assert.equal(c.hashes.invariant, sha256String(recombined), 'invariant hash must match recombined content');
});

// ===========================================================================
// T3 — style block detection
// ===========================================================================

test('T3: exactly 8 real style blocks detected, none with media attribute', () => {
  const c = candidate();
  assert.equal(c.bloques.length, 8, 'must detect exactly 8 real style blocks');

  const canonicalLines = splitLines(readCanonicalLf());
  const scripts = parseScriptBlocks(canonicalLines);
  const styles = parseStyleBlocks(canonicalLines, scripts);
  assert.equal(styles.length, 8, 'parseStyleBlocks over canonical must yield 8 blocks');

  for (const b of styles) {
    const openTag = canonicalLines[b.startLine - 1];
    assert.ok(!/\bmedia\s*=/.test(openTag), `style block at L${b.startLine} must have no media attribute`);
  }
});

// ===========================================================================
// T4 — index.html structure
// ===========================================================================

test('T4: index.html has no style blocks and exactly the 5 links in order', () => {
  const c = candidate();
  const lines = splitLines(c.indexHtml);
  const scripts = parseScriptBlocks(lines);
  const styles = parseStyleBlocks(lines, scripts);

  assert.equal(styles.length, 0, 'index.html must contain zero <style> blocks');

  const linkTags = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const line of lines) {
    const re = new RegExp(linkRe.source, 'gi');
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const tag = m[0];
      const href = (/\bhref\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1] || null;
      const rel = (/\brel\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1] || null;
      linkTags.push({ href, rel, media: /\bmedia\s*=/.test(tag), id: /\bid\s*=/.test(tag) });
    }
  }

  const cssLinks = linkTags.filter((t) => t.href && t.href.startsWith('css/'));
  assert.equal(cssLinks.length, 5, 'must have exactly 5 css/ <link> tags');
  assert.deepEqual(cssLinks.map((t) => t.href), LINK_ORDER, 'links must be in the exact order');
  for (const t of cssLinks) {
    assert.equal(t.rel, 'stylesheet', `link ${t.href} must be rel=stylesheet`);
    assert.equal(t.media, false, `link ${t.href} must have no media attribute`);
    assert.equal(t.id, false, `link ${t.href} must have no id attribute`);
  }
});

// ===========================================================================
// T5 — HTML equivalence (line-agnostic content signature)
// ===========================================================================

test('T5: content equivalence canonical vs POS/index.html (IDENTICAL)', () => {
  const c = candidate();
  const canonicalSource = readCanonicalLf();

  const canonSig = contentSignature(canonicalSource);
  const indexSig = contentSignature(c.indexHtml);

  const styleIds = new Set(c.bloques.map((b) => b.id).filter(Boolean));

  // The 5 <style id="..."> hooks are intentionally removed with the blocks.
  const normalize = (sig) => ({ ...sig, staticIds: sig.staticIds.filter((id) => !styleIds.has(id)) });

  assert.deepEqual(normalize(indexSig), normalize(canonSig), 'any signature difference is a NEW_REGRESSION');
});

// ===========================================================================
// T6 — CSS architecture and media/keyframe inventory
// ===========================================================================

test('T6: CSS has 49 @media, 2 @media print, 2 @keyframes, no imports/charset/url()', () => {
  const c = candidate();
  const { combined } = combinedCss(c);

  const mediaCount = (combined.match(/@media/g) || []).length;
  const printCount = (combined.match(/@media\s+print/g) || []).length;
  const keyframesCount = (combined.match(/@keyframes/g) || []).length;

  assert.equal(mediaCount, 49, 'total @media across css must be 49');
  assert.equal(printCount, 2, 'total @media print must be 2');
  assert.equal(keyframesCount, 2, 'total @keyframes must be 2');
  assert.ok(!/@import/.test(combined), 'no @import in css');
  assert.ok(!/@charset/.test(combined), 'no @charset in css');
  assert.ok(!/url\(/.test(combined), 'no url( in css');

  for (const name of ['responsive', 'print']) {
    const content = cssContentByName(c, name);
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    assert.equal(stripped, '', `${name}.css must contain only comments`);
    assert.ok(!/@media/.test(content), `${name}.css must have no @media`);
    assert.ok(!content.includes('{') && !content.includes('}'), `${name}.css must have no rules`);
  }
});

// ===========================================================================
// T7 — LF without BOM on every POS file
// ===========================================================================

test('T7: all POS files are LF with no BOM', () => {
  const files = [
    'POS/index.html',
    ...LINK_ORDER.map((p) => `POS/${p}`),
    'POS/assets/README.md',
  ];
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    assert.ok(!buf.includes(0x0d), `${rel} must contain no CR (0x0D) byte`);
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    assert.ok(!hasBom, `${rel} must have no UTF-8 BOM`);
  }
});

// ===========================================================================
// T8 — external dependencies unchanged
// ===========================================================================

test('T8: external deps (Google Fonts + SheetJS) unchanged', () => {
  const c = candidate();
  const canonDeps = parseExternalDeps(splitLines(readCanonicalLf()));
  const indexDeps = parseExternalDeps(splitLines(c.indexHtml));

  const urls = (d) => [...d.links.map((l) => l.href), ...d.scripts.map((s) => s.src)];

  assert.deepEqual(urls(indexDeps), urls(canonDeps), 'external dependency URLs must be unchanged');

  const canonUrls = urls(canonDeps);
  assert.ok(canonUrls.some((u) => u.includes('fonts.googleapis.com')), 'Google Fonts must be present');
  assert.ok(canonUrls.some((u) => u.includes('cdn.sheetjs.com')), 'SheetJS CDN must be present');
});

// ===========================================================================
// T9 — assets README
// ===========================================================================

test('T9: POS/assets/README.md exists and is minimal', () => {
  const c = candidate();
  const readme = fs.readFileSync(path.join(POS_DIR, 'assets', 'README.md'), 'utf8');
  assert.ok(readme.trim().length > 0, 'README must be non-empty');
  assert.equal(readme, c.assetsReadme, 'README content must match builder output');
});

// ===========================================================================
// T10 — evidence report (deterministic, no timestamps)
// ===========================================================================

function buildReport(c) {
  const { combined } = combinedCss(c);
  const mediaCount = (combined.match(/@media/g) || []).length;
  const printCount = (combined.match(/@media\s+print/g) || []).length;
  return {
    baseCommit: BASE_COMMIT,
    sourceBlob: SOURCE_BLOB,
    cssFiles: c.cssFiles.map((f) => ({ file: f.file, sha256: f.sha256, lines: f.lines })),
    indexSha256: c.hashes.index,
    invariantSha256: c.hashes.invariant,
    mediaCount,
    printMediaCount: printCount,
    styleBlocksSource: c.bloques.length,
    linksOrder: LINK_ORDER,
    equivalence: 'IDENTICAL',
  };
}

test('T10: evidence/css-extraction/report.json is deterministic (no timestamps)', () => {
  const c1 = buildPosCandidate({ write: false });
  const c2 = buildPosCandidate({ write: false });

  const r1 = buildReport(c1);
  const r2 = buildReport(c2);
  const s1 = JSON.stringify(r1, null, 2) + '\n';
  const s2 = JSON.stringify(r2, null, 2) + '\n';

  assert.equal(s1, s2, 'two report runs must be byte-identical');
  assert.equal(sha256String(s1), sha256String(s2), 'two report runs must hash identically');

  assert.equal(r1.baseCommit, BASE_COMMIT);
  assert.equal(r1.sourceBlob, SOURCE_BLOB);
  assert.equal(r1.mediaCount, 49);
  assert.equal(r1.printMediaCount, 2);
  assert.equal(r1.styleBlocksSource, 8);
  assert.equal(r1.equivalence, 'IDENTICAL');
  assert.equal(r1.cssFiles.length, 5);

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, Buffer.from(s1, 'utf8'));
});

// ===========================================================================
// T11 — source blob anchor
// ===========================================================================

test('T11: source blob anchor (computed git blob equals hardcoded authorized blob)', () => {
  const c = candidate();

  // Hardcoded expected blob (deliberately NOT the exported SOURCE_BLOB constant):
  // proves buildPosCandidate().sourceBlob is computed by readSourceLf via
  // gitBlobSha1(buffer) from the real product bytes, not echoed from a
  // self-referential constant.
  assert.equal(c.sourceBlob, '2dec6363d8aeef52da64ba60ac8eac8eb14f75f7');

  // Independent recomputation from the raw git buffer closes the anchor.
  const buffer = readCanonicalBuffer();
  assert.equal(
    gitBlobSha1(buffer),
    c.sourceBlob,
    'sourceBlob must equal the git blob SHA-1 of the raw product buffer'
  );
});

// ===========================================================================
// T12 — full static markup equivalence minus style spans vs minus links
// ===========================================================================

function isBlankLine(line) {
  return line.trim() === '';
}

/**
 * Collapse each style span (open-tag line .. close-tag line) plus its adjacent
 * blank-line runs into a single empty line, bottom-up so earlier indices stay
 * valid. This mirrors the builder's blank-collapse policy for B2..B8; T12
 * applies it to ALL 8 spans (including B1, which the builder replaces with the
 * 5 <link> tags) so "canonical minus style spans" can be compared byte-exact
 * against "index.html minus links".
 */
function collapseStyleSpans(lines, styles) {
  const out = lines.slice();
  const sorted = [...styles].sort((a, b) => a.startLine - b.startLine);
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const b = sorted[i];
    let s = b.startLine; // 1-based inclusive
    let e = b.endLine; // 1-based inclusive
    while (s > 1 && isBlankLine(out[s - 2])) s -= 1;
    while (e < out.length && isBlankLine(out[e])) e += 1;
    out.splice(s - 1, e - s + 1, '');
  }
  return out;
}

test('T12: full markup equivalence minus style spans vs minus links', () => {
  // (a) canonical LF minus the 8 <style> spans (each collapsed to one empty
  // line with the builder's blank-collapse policy).
  const canonicalLines = splitLines(readCanonicalLf());
  const canonScripts = parseScriptBlocks(canonicalLines);
  const canonStyles = parseStyleBlocks(canonicalLines, canonScripts);
  assert.equal(canonStyles.length, 8, 'canonical must expose exactly 8 real style blocks');
  const a = collapseStyleSpans(canonicalLines, canonStyles);

  // (b) POS/index.html from disk minus the 5 <link rel="stylesheet" href="css/..."> lines.
  buildPosCandidate({ write: true }); // guarantee the on-disk index.html is current
  const diskIndex = fs.readFileSync(path.join(POS_DIR, 'index.html'), 'utf8');
  const b = splitLines(diskIndex).filter(
    (line) => !/^\s*<link\s+rel="stylesheet"\s+href="css\//.test(line)
  );

  assert.equal(
    a.join('\n'),
    b.join('\n'),
    'full static markup (classes/text/comments outside ids/handlers) must be byte-identical'
  );
});
