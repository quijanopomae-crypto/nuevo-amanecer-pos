import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const canonical=readFileSync(new URL('../../POS/js/sync/canonical-client.js',import.meta.url),'utf8');
const inline03=readFileSync(new URL('../../POS/js/legacy-inline/inline-03.js',import.meta.url),'utf8');
const layout=readFileSync(new URL('../../POS/css/layout.css',import.meta.url),'utf8');

test('CANON cold start mounts UI without awaiting the remote bootstrap',()=>{
  const start=inline03.indexOf("document.addEventListener('DOMContentLoaded'");
  assert.ok(start>=0);
  const block=inline03.slice(start);
  assert.match(block,/const canonicalEnabled=/);
  assert.match(block,/if\(canonicalEnabled\)\{productos=\[\];clientes=\[\];creditos=\[\];\}/);
  assert.match(block,/NuevoAmanecerCanonical\.startPOS\(\)\.catch/);
  assert.doesNotMatch(block,/try\{await NuevoAmanecerCanonical\.startPOS\(\)/);
  assert.match(block,/Conectando a CANON…/);
  assert.match(block,/posUpdateCart\(canonicalEnabled\?false:true\)/);
});

test('cold-start read failure exits pending and exposes retryable unavailable UI',()=>{
  assert.match(canonical,/data \? 'stale' : 'unavailable'/);
  assert.match(canonical,/notifyReplicaUpdate\(\); throw error/);
  assert.match(inline03,/if\(state\.source==='none'\)/);
  assert.match(inline03,/Canónico no disponible · reintenta/);
  assert.match(inline03,/Autoridad canónica no validada/);
});

test('canonical read requests are bounded without changing command write transport',()=>{
  assert.match(canonical,/var READ_TIMEOUT_MS = 8000/);
  assert.match(canonical,/function readFetch\(url, options\)/);
  assert.match(canonical,/reject\(new Error\('CANONICAL_READ_TIMEOUT'\)\)/);
  assert.match(canonical,/await readFetch\(endpoint \+ '\/read\/canonical\/status'/);
  assert.match(canonical,/await readFetch\(endpoint \+ '\/read\/canonical\/' \+ route/);
  const sendPending=canonical.slice(canonical.indexOf('async function sendPending'),canonical.indexOf('async function createSale'));
  assert.doesNotMatch(sendPending,/readFetch\(/);
  assert.match(sendPending,/root\.fetch\(expected\.endpoint \+ record\.route/);
});

test('commerce remains fail closed until CANON is ready and ACTIVE',()=>{
  assert.match(canonical,/\(!ready && !confirmedPaymentView\) \|\| changed \|\| !data \|\| data\.read_only !== false \|\| data\.mode !== 'ACTIVE'/);
  assert.match(canonical,/confirmedPaymentView = action === 'payment.create' && replicaState.validation === 'receipt-patched'/);
  assert.match(canonical,/fail\('CANONICAL_COMMERCE_CLOSED'\)/);
});


test('CANON core bootstrap is parallel and visible before financial completion',()=>{
  assert.match(canonical,/source === 'cache' \|\| source === 'bootstrap'/);
  assert.match(canonical,/Promise\.all\(coreEntries\.map\(readEntry\)\)/);
  assert.match(canonical,/publishReplica\(bootstrapReplica, 'bootstrap'\); notifyReplicaUpdate\(\)/);
  assert.match(canonical,/mode: provisional \? 'CANONICAL_READ_ONLY'/);
  assert.match(canonical,/read_only: provisional \|\| replica\.read_only !== false/);
  assert.match(canonical,/Promise\.all\(\[\['cash-sessions', 'cashSessions'\], \['financial-events', 'financialEvents'\],[\s\S]*?\['cash-movements','cashMovements'\]\]\.map\(readEntry\)\)/);
  const bootstrapPos=canonical.indexOf("publishReplica(bootstrapReplica, 'bootstrap')");
  const financialPos=canonical.indexOf("['cash-sessions', 'cashSessions']");
  assert.ok(bootstrapPos>=0 && financialPos>bootstrapPos,'bootstrap must publish before financial routes finish');
});

test('mobile status shows runtime CANON state instead of a hardcoded Local label',()=>{
  assert.doesNotMatch(layout,/content:'Local'/);
  assert.match(layout,/\.g-status span\{font-size:10px/);
  assert.match(inline03,/CANON · validando/);
  assert.match(inline03,/CANON validado/);
});
