// GATE 8 — V10 RETIRADO
//
// El núcleo transaccional V10 (inline-17.js / inline-18.js, ~117 KB, siempre dormante)
// se eliminó del repositorio. Este gate conserva la protección que importa y evita
// que el código muerto reaparezca por accidente:
//   - los archivos inline-17/18 ya no existen ni se cargan (index.html, sw.js, build-reader);
//   - ningún archivo del producto referencia símbolos _naV10* ni sus nombres de
//     almacenamiento (DB/lock/canal/clave V10), así que el arranque no puede abrir una DB V10;
//   - los winners de operación del release (gates 2-7) siguen definidos en archivos activos.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  POS_DIR, ROOT, localScriptOrder, allProductJsFiles, readProductText, scanDefinitions,
} from './lib/product.mjs';
import { writeEvidence } from './lib/evidence.mjs';

const facts = { checks: [], runtime: {} };
function check(id, description, pass, detail = '') {
  facts.checks.push({ id, description, result: pass ? 'PASS' : 'FAIL', detail });
  assert.ok(pass, `${id}: ${description}${detail ? ` — ${detail}` : ''}`);
}

const V10_FILES = ['js/legacy-inline/inline-17.js', 'js/legacy-inline/inline-18.js'];
const PRODUCT_FILES = allProductJsFiles();
const V10_STORAGE_NAMES = /_naV10|_NA_V10|nuevo-amanecer:(?:financial-write|persistence):v10|na_snapshot_v10|na_v10_outbox|snapshot_v10/;
const WINNERS = ['guardarCred', 'guardarMovInv', 'confirmarVenta', 'confirmarPago', 'anularV', 'guardarMovCaja', 'guardarGasto', '_naPaymentState'];

test('G8.1 — Estático: ningún archivo del producto referencia símbolos _naV10* ni nombres de almacenamiento V10', () => {
  for (const rel of PRODUCT_FILES) {
    check(`G8.1:${rel}`, 'sin referencias V10', !V10_STORAGE_NAMES.test(readProductText(rel)));
  }
  check('G8.1:index.html', 'index.html sin referencias V10', !V10_STORAGE_NAMES.test(readProductText('index.html')));
});

test('G8.2 — V10 retirado: sin archivos, sin tags <script>, sin entradas de precache ni de build', () => {
  for (const rel of V10_FILES) {
    check(`G8.2:${rel}:archivo`, 'el archivo ya no existe', !existsSync(path.join(POS_DIR, rel)));
    check(`G8.2:${rel}:index`, 'no está en el orden de carga de index.html', localScriptOrder().indexOf(rel) === -1);
    check(`G8.2:${rel}:sw`, 'no está en PRECACHE_URLS de sw.js', !readProductText('sw.js').includes(path.basename(rel)));
    check(`G8.2:${rel}:build`, 'build-reader no lo lista',
      !readFileSync(path.join(ROOT, 'tools', 'cloudflare-lab', 'scripts', 'build-reader.mjs'), 'utf8').includes(path.basename(rel)));
  }
  const order = localScriptOrder();
  const idx = (rel) => order.indexOf(rel);
  check('G8.2b', 'legacy-globals y app siguen cargando después del último inline',
    idx('js/legacy-inline/inline-16.js') > -1 && idx('js/legacy-inline/inline-16.js') < idx('js/compat/legacy-globals.js') && idx('js/compat/legacy-globals.js') < idx('js/app.js'));
});

test('G8.3 — Nada en el producto abre IndexedDB V10 durante la carga (el núcleo V10 ya no existe)', () => {
  const offenders = PRODUCT_FILES.filter((rel) => /nuevo-amanecer:persistence:v10|_NA_V10_DB_VERSION/.test(readProductText(rel)));
  check('G8.3a', 'ningún archivo del producto declara o abre la DB/lock/canal V10', offenders.length === 0, offenders.join(','));
  check('G8.3b', 'el núcleo de persistencia V9 (inline-02) opera sin V10', !/_naV10/.test(readProductText('js/legacy-inline/inline-02.js')));
});

test('G8.4 — Los winners de operación del release siguen definidos en archivos activos', () => {
  for (const w of WINNERS) {
    const defs = PRODUCT_FILES.filter((rel) => scanDefinitions(rel, w).length > 0);
    check(`G8.4:${w}`, 'definido al menos una vez en el producto', defs.length > 0);
  }
  facts.runtime.productFilesScanned = PRODUCT_FILES.length;
});

after(() => {
  writeEvidence('gate8-v10-dormancy.json', {
    gate: 'GATE 8 — V10 RETIRADO',
    verdict: facts.checks.every((c) => c.result === 'PASS') ? 'PASS' : 'FAIL',
    conclusion: 'Núcleo V10 (inline-17/18) eliminado del repositorio; ningún archivo del producto lo referencia',
    ...facts,
  });
});
