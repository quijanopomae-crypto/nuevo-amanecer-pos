import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client=readFileSync(new URL('../../POS/js/sync/canonical-client.js',import.meta.url),'utf8');
const inline03=readFileSync(new URL('../../POS/js/legacy-inline/inline-03.js',import.meta.url),'utf8');
const integration=readFileSync(new URL('../../POS/js/sync/canonical-sale-integration.js',import.meta.url),'utf8');
const outbox=readFileSync(new URL('../../POS/js/sync/canonical-sale-outbox.js',import.meta.url),'utf8');

test('runtime remains local-first: cached canonical replica is published before remote refresh',()=>{
  const start=client.slice(client.indexOf('async function startPOS()'),client.indexOf('function legacySnapshot()'));
  const read=start.indexOf('await localReplica()');
  const publish=start.indexOf("publishReplica(cached, 'cache')");
  const refresh=start.indexOf('refresh().catch');
  assert.ok(read>=0 && publish>read && refresh>publish);
});

test('transport verification is not the READY/green signal',()=>{
  const connected=inline03.slice(inline03.indexOf("window.addEventListener('na:canonical-connected'"),inline03.indexOf('let _naCanonicalLoadError'));
  assert.match(connected,/_naSetHeaderConnectionState\('update','Sincronizando CANON…'\)/);
  assert.doesNotMatch(connected,/_naSetHeaderConnectionState\('connected'/);
  assert.match(inline03,/const connectionReady=state\.validation==='current',connectionSyncing=state\.validation==='validating'/);
  assert.match(inline03,/connectionReady\?'connected':connectionSyncing\?'update':'disconnected'/);
});

test('new sale cannot enter outbox until CANON is current ACTIVE and no previous critical operation remains',()=>{
  assert.match(integration,/function canonicalSaleGate\(\)/);
  assert.match(integration,/state\.validation !== 'current'/);
  assert.match(integration,/snapshot\.mode !== 'ACTIVE'/);
  assert.match(integration,/snapshot\.read_only !== false/);
  assert.match(integration,/canonical\.pendingSnapshot\(\)/);
  assert.match(integration,/outbox\.snapshot\(\)\.intents\.length/);
  const capture=integration.slice(integration.indexOf('async function capture()'),integration.indexOf('function wrappedConfirm()'));
  const gate=capture.indexOf('canonicalSaleGate()');
  const enqueue=capture.indexOf('outbox.enqueue(intent)');
  assert.ok(gate>=0 && enqueue>gate,'readiness gate must run before durable enqueue');
});

test('startup outbox waits for current replica instead of racing bootstrap',()=>{
  const resume=outbox.slice(outbox.indexOf('async function resume()'),outbox.indexOf('resumeOutbox = resume'));
  const current=resume.indexOf("state.validation !== 'current'");
  const queue=resume.indexOf("snapshot().intents.length");
  const sync=resume.indexOf('await sync()');
  assert.ok(current>=0 && queue>current && sync>queue);
});

test('online recovery refreshes authority first when runtime is not current',()=>{
  const listeners=outbox.slice(outbox.indexOf("root.addEventListener('online'"),outbox.indexOf("root.addEventListener('na:canonical-updated'"));
  assert.match(listeners,/state\.validation !== 'current'/);
  assert.match(listeners,/canonical\.refresh\(\)/);
});
