// Guarda B2 (#886): canonical_product_revisions.cost_cents puede contener un 0 de relleno (revisión
// cost_kept_null). Ningún lector del Worker puede leer esa columna cruda: debe usar REVISION_COST_SQL
// (a6-products.js). Única excepción: la lectura de productos de a6-canonical.js, que aplica el marcador.
// Análisis estático del texto de src/: sigue alias SQL ligados a la tabla (y a CTE que la seleccionan),
// no números de línea. Las excepciones están listadas y deben seguir existiendo (no quedan obsoletas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../tools/cloudflare-lab/src/', import.meta.url));
const TABLE = 'canonical_product_revisions';
const KEYWORDS = new Set(['where', 'on', 'set', 'values', 'order', 'group', 'limit', 'join', 'left', 'inner', 'cross', 'union', 'and', 'or', 'as', 'using', 'natural', 'select', 'from', 'having', 'window', 'except', 'intersect']);

function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(m?js|ts)$/.test(name) ? [path] : [];
  });
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Fin del paréntesis que abre en `open` (texto SQL; suficiente para CTE).
function closeParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) { if (text[i] === '(') depth++; else if (text[i] === ')' && --depth === 0) return i; }
  return text.length;
}

// Devuelve [{line, kind, snippet}] de lecturas crudas del costo de revisiones en `text`.
export function rawRevisionCostReads(source) {
  if (!source.includes(TABLE)) return [];
  // Comentarios fuera (líneas // y bloques /* */), conservando la numeración de líneas.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' ')).replace(/^[ \t]*\/\/.*$/gm, '');
  const sets = new Set([TABLE]);
  // CTE que seleccionan de la tabla: `name AS ( ... FROM canonical_product_revisions ... )`.
  for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s+AS\s*\(\s*SELECT\b/gi)) {
    const open = m.index + m[0].indexOf('(');
    if (text.slice(open, closeParen(text, open)).includes(TABLE)) sets.add(m[1]);
  }
  const aliases = new Set();
  for (const name of sets) {
    if (name !== TABLE) aliases.add(name);
    for (const m of text.matchAll(new RegExp(`\\b${esc(name)}\\s+(?:AS\\s+)?([A-Za-z_]\\w*)\\b`, 'gi')))
      if (!KEYWORDS.has(m[1].toLowerCase())) aliases.add(m[1]);
  }
  const hits = [];
  const add = (index, kind) => hits.push({ line: lineOf(text, index), kind, snippet: text.split('\n')[lineOf(text, index) - 1].trim().slice(0, 200) });
  for (const a of aliases) {
    const p = esc(a);
    for (const m of text.matchAll(new RegExp(`(?<![\\w.$])${p}\\.cost_cents\\b`, 'g'))) add(m.index, `${a}.cost_cents`);
    for (const m of text.matchAll(new RegExp(`(?<![\\w.$])${p}\\.\\$\\{`, 'g'))) add(m.index, `${a}.\${…} (columna dinámica)`);
    for (const m of text.matchAll(new RegExp(`(?<![\\w.$])${p}\\.\\*`, 'g'))) add(m.index, `${a}.*`);
  }
  // Sin alias: SELECT <columnas> FROM canonical_product_revisions, con cost_cents o * en las columnas.
  for (const m of text.matchAll(new RegExp(`\\bFROM\\s+${TABLE}\\b`, 'gi'))) {
    const head = text.slice(0, m.index);
    const select = Math.max(head.lastIndexOf('SELECT'), head.lastIndexOf('select'));
    if (select < 0) continue;
    const cols = head.slice(select + 6);
    if (/(?<![\w.$])cost_cents\b/.test(cols)) add(m.index, 'SELECT cost_cents FROM tabla');
    if (/(^|[\s,])\*(\s|,|$)/.test(cols)) add(m.index, 'SELECT * FROM tabla');
  }
  return hits;
}

// Excepciones justificadas. Cada una debe coincidir con al menos un hallazgo (si no, está obsoleta).
const ALLOWED = [
  { file: 'a6-canonical.js', kind: /^r\.cost_cents$/, snippet: /cost_kept_null'\)=1 THEN .*ELSE r\.cost_cents/, why: 'lectura de productos: aplica el marcador cost_kept_null' },
  { file: 'a6-canonical.js', kind: /^r\.\$\{/, snippet: /PRODUCT_REVISION_FIELDS\.includes\(column\)/, why: 'overlay genérico; cost_cents se resuelve antes en su rama propia (ver test de orden)' },
  { file: 'a6-products.js', kind: /^r\.\*$/, snippet: /SELECT r\.\* FROM canonical_product_revisions r WHERE r\.promotion_id=\?1/, why: 'CTE latest de CODE_OWNER_SQL; sus lectores (alias l) se revisan aparte' },
  { file: 'pos-roles.js', kind: /^r\.\$\{/, snippet: /SELECT r\.\$\{col\} FROM canonical_product_revisions r/, why: 'flagSaleDiscount: solo price_cents/box_price_cents/name (ver test)' },
];

test('ningún lector de src/ lee cost_cents crudo de canonical_product_revisions fuera de las excepciones', () => {
  const used = new Set(), bad = [];
  for (const path of sources(SRC)) {
    const file = relative(SRC, path).replaceAll('\\', '/');
    for (const hit of rawRevisionCostReads(readFileSync(path, 'utf8'))) {
      const i = ALLOWED.findIndex(a => a.file === file && a.kind.test(hit.kind) && a.snippet.test(hit.snippet));
      if (i >= 0) used.add(i); else bad.push(`${file}:${hit.line} ${hit.kind} → ${hit.snippet}`);
    }
  }
  assert.deepEqual(bad, [], 'Usa REVISION_COST_SQL(alias) de a6-products.js en vez de la columna cruda:\n' + bad.join('\n'));
  assert.deepEqual(ALLOWED.map((a, i) => used.has(i) ? null : `${a.file}: ${a.why}`).filter(Boolean), [], 'excepción obsoleta: quítala de ALLOWED');
});

test('las excepciones dinámicas no pueden llegar a cost_cents', () => {
  const canon = readFileSync(join(SRC, 'a6-canonical.js'), 'utf8');
  const costBranch = canon.indexOf("column==='cost_cents'?");
  const generic = canon.indexOf('PRODUCT_REVISION_FIELDS.includes(column)?');
  assert.ok(costBranch > 0 && generic > costBranch, 'en el overlay, la rama de cost_cents va antes de la genérica');
  const roles = readFileSync(join(SRC, 'pos-roles.js'), 'utf8');
  const cols = [...roles.matchAll(/\bfield\(\s*'([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(cols.length > 0);
  assert.ok(!cols.includes('cost_cents') && !/\bfield\(\s*[^'\s]/.test(roles), `flagSaleDiscount solo con columnas literales sin costo: ${cols}`);
  assert.match(readFileSync(join(SRC, 'a6-products.js'), 'utf8'), /REVISION_COST_SQL\('r'\)\} FROM canonical_product_revisions r/, 'el costo vigente usa REVISION_COST_SQL');
});

test('la guarda detecta lectores crudos (autoprueba)', () => {
  const caught = sql => rawRevisionCostReads(sql).map(h => h.kind);
  assert.deepEqual(caught('SELECT r.cost_cents FROM canonical_product_revisions r WHERE 1'), ['r.cost_cents']);
  assert.deepEqual(caught('LEFT JOIN canonical_product_revisions AS rev ON rev.product_id=p.product_id SELECT rev.cost_cents'), ['rev.cost_cents']);
  assert.deepEqual(caught("db.prepare('SELECT cost_cents,price_cents FROM canonical_product_revisions WHERE product_id=?1')"), ['SELECT cost_cents FROM tabla']);
  assert.deepEqual(caught('SELECT * FROM canonical_product_revisions WHERE x'), ['SELECT * FROM tabla']);
  assert.deepEqual(caught('WITH last AS (SELECT x.product_id,x.cost_cents FROM canonical_product_revisions x) SELECT l.cost_cents FROM last l').sort(), ['l.cost_cents', 'x.cost_cents']);
  assert.deepEqual(caught('WITH last AS (SELECT q.* FROM canonical_product_revisions q) SELECT last.cost_cents FROM last').sort(), ['last.cost_cents', 'q.*']);
  assert.deepEqual(caught('SELECT r.${col} FROM canonical_product_revisions r'), ['r.${…} (columna dinámica)']);
  // Correctos: REVISION_COST_SQL, INSERT con lista de columnas, otras tablas, conteos.
  assert.deepEqual(caught("SELECT ${REVISION_COST_SQL('r')} FROM canonical_product_revisions r WHERE r.product_id=?2"), []);
  assert.deepEqual(caught('INSERT INTO canonical_product_revisions\n (operation_id,cost_cents,price_cents) VALUES(?1,?2,?3)'), []);
  assert.deepEqual(caught('SELECT p.cost_cents FROM products p; SELECT COUNT(*) n FROM canonical_product_revisions WHERE promotion_id=?1'), []);
  assert.deepEqual(caught('SELECT request_hash,result_json FROM canonical_product_revisions WHERE operation_id=?1'), []);
});
