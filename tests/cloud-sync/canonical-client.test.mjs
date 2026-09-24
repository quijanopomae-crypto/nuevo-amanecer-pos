import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// VM contract tests only: storage, fetch and Web Locks below are controlled fakes.
// node --test tests/cloud-sync/canonical-client.test.mjs
const source = readFileSync(new URL('../../POS/js/sync/canonical-client.js', import.meta.url), 'utf8');
const KEY = 'na_canonical_binding', JOURNAL = 'na_canonical_sale_journal';
const config = { endpoint: 'http://127.0.0.1:8787', deviceId: 'writer', promotion_id: 'promotion', authority_epoch: 3, revision: 3, readToken: 'read-secret', token: 'write-secret' };
const intent = { items: [{ product_id: 'product', quantity: 2 }], payment_method: 'efectivo' };
const json = value => JSON.parse(JSON.stringify(value));
function storage() {
  const values = new Map();
  return { values, fail: false, drop: false,
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { if (this.fail) throw Error('quota'); if (!this.drop) values.set(key, String(value)); }
  };
}

test('public reads carry no reader authorization and client exposes no reader prompt', async () => {
  const f = await fixture().setup();
  assert.ok(f.state.reads.length >= 4);
  assert.doesNotMatch(source, /prompt\s*\(/);
  assert.doesNotMatch(source, /na_canonical_device_id|deviceCredential|readToken/);
});
function locks() {
  let held = false;
  return { async request(name, options, work) {
    assert.equal(name, 'na-canonical-financial-writer');
    assert.deepEqual(json(options), { mode: 'exclusive', ifAvailable: true });
    if (held) return work(null);
    held = true;
    try { return await work({ name }); } finally { held = false; }
  } };
}
function fixture({ local = storage(), session = storage(), lock = locks() } = {}) {
  const state = { meta: { authority: 'canonical', promotion_id: 'promotion', authority_epoch: 3, revision: 3, financial_revision: 0, mode: 'ACTIVE', read_only: false, minimum_client_contract: 'a6-gate-c-v1' },
    products: [{ product_id: 'product', name: '<img src=x>', price_cents: 125, stock_revision: 0, current_stock_quantity: 20 }],
    customers: [{ customer_id: 'customer', name: 'Customer' }], credits: [], payments: [], 'cash-sessions': [], 'financial-events': [], posts: [], routes: [], reads: [], effects: new Map(), fault: null, hold: null, readHold: null };
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return json(body); } });
  const events = {};
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.textContent = ''; this.listeners = {}; this.value = ''; }
    append(...children) { this.children.push(...children); if (this.tagName === 'select' && this.children.length) this.value = this.children[0].value; }
    prepend(...children) { this.children.unshift(...children); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
  }
  const body = new Element('body');
  const context = vm.createContext({ URL, crypto: { randomUUID }, location: { hostname: 'localhost', origin: config.endpoint, protocol: 'http:' }, prompt: () => null, localStorage: local, sessionStorage: session,
    navigator: { onLine: true, locks: lock }, document: { body, getElementById: id => body.children.find(item => item.id === id), createElement: tag => new Element(tag) },
    addEventListener(name, callback) { events[name] = callback; },
    async fetch(url, options) {
      assert.ok(['localhost', '127.0.0.1', 'nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev'].includes(new URL(url).hostname));
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      if (options.method !== 'POST') {
        state.reads.push(url);
        assert.deepEqual(options.headers || {}, {});
        if (state.readHold) await state.readHold;
        if (state.readFault) throw Error('read failed');
        const route = new URL(url).pathname.split('/').at(-1);
        if (state.readPage) return response(state.readPage(route, new URL(url), state.reads.length));
        return response({ ...state.meta, items: route === 'credit-payments' ? state.payments : state[route] || [], next_cursor: null });
      }
      const command = new URL(url).pathname.split('/').at(-1);
      assert.ok(['sale.create', 'payment.create', 'cash.open', 'cash.close', 'adjustment.create', 'compensation.create'].includes(command));
      assert.equal(options.headers['x-device-id'], 'writer');
      assert.equal(options.headers['x-sync-token'], 'write-secret');
      const payload = JSON.parse(options.body), durable = JSON.parse(local.getItem(JOURNAL));
      assert.equal(durable.state, 'PENDING'); assert.deepEqual(durable.payload, payload, 'exact payload durable before POST');
      assert.equal(durable.command, command); assert.equal(durable.route, '/commands/' + command);
      state.posts.push(options.body);
      state.routes.push('/commands/' + command);
      if (state.hold) await state.hold;
      if (state.fault === 'hard') return response({ error: 'stale_stock' }, 409);
      if (state.fault === 'malformed') return { ok: true, status: 201, json() { throw Error('invalid JSON'); } };
      const existed = state.effects.has(payload.operation_id);
      if (existed) assert.equal(state.effects.get(payload.operation_id), options.body);
      state.effects.set(payload.operation_id, options.body);
      if (state.fault === 'lost') throw Error('lost ACK');
      if (state.fault === 'receipt-storage') local.fail = true;
      if (state.fault === 'replace') local.setItem(JOURNAL, JSON.stringify({ ...durable, last_error: 'foreign-change' }));
      const result = { status: existed ? 'already_processed' : 'created', operation_id: payload.operation_id,
        sale_id: state.fault === 'wrong-id' ? 'wrong' : payload.sale_id, idempotent: existed,
        promotion_id: payload.promotion_id, authority_epoch: payload.authority_epoch };
      if (command !== 'sale.create') Object.assign(result, { command, session_id: payload.session_id, credit_id: payload.credit_id, event_id: payload.operation_id,
        compensates_operation_id: payload.compensates_operation_id, ...durable.receipt_ids });
      if (state.receiptMutation) Object.assign(result, state.receiptMutation);
      return response(result, existed ? 200 : 201);
    }
  });
  vm.runInContext(source, context);
  return { api: context.NuevoAmanecerCanonical, state, local, session, lock, context, events, Element, body,
    async setup() { await this.api.configure(config); await this.api.refresh(); return this; } };
}

test('six payment methods use canonical cents/revisions and save only confirmed receipts', async t => {
  for (const method of ['efectivo', 'yape', 'plin', 'transferencia', 'credito', 'mixto']) await t.test(method, async () => {
    const f = await fixture().setup();
    const result = await f.api.createSale({ ...intent, payment_method: method, customer_id: 'customer', credit_due: '2026-10-01', cash_cents: 100, digital_method: 'yape' });
    assert.equal(result.status, 'created'); assert.equal(f.api.pendingSnapshot(), null);
    assert.deepEqual(json(f.api.receiptSnapshot()), json(result));
    const payload = JSON.parse(f.state.posts[0]);
    assert.match(payload.operation_id, /^[0-9a-f-]{36}$/); assert.notEqual(payload.operation_id, payload.sale_id);
    assert.deepEqual(payload.items, [{ product_id: 'product', quantity: 2, unit_price_cents: 125, line_total_cents: 250, expected_stock_revision: 0 }]);
    assert.equal(payload.total_cents, 250);
    assert.equal(payload.payment.cash_cents + payload.payment.digital_cents + payload.payment.credit_cents, 250);
    if (method === 'credito') assert.equal(payload.credit_due, '2026-10-01');
    assert.deepEqual([...f.local.values.keys()].sort(), [KEY, JOURNAL].sort());
    assert.doesNotMatch(JSON.stringify([...f.local.values]), /read-secret|write-secret/);
    assert.doesNotMatch(JSON.stringify(f.api.snapshot()), /read-secret|write-secret/);
    assert.throws(() => f.api.assertAction('sale.create'), /CLOSED/, 'refresh required after confirmation');
  });
});

test('lost ACK survives reload, keeps exact intent, retries without fresh products', async () => {
  const f = await fixture().setup(); f.state.fault = 'lost';
  await assert.rejects(f.api.createSale(intent), /PENDING/);
  const pending = json(f.api.pendingSnapshot()), bytes = f.state.posts[0];
  await assert.rejects(f.api.createSale(intent), /PENDING/);
  await assert.rejects(f.api.configure({ ...config, endpoint: 'http://localhost:9999' }), /PENDING/);
  assert.deepEqual(json(f.api.pendingSnapshot()), pending);
  const reloaded = fixture({ local: f.local, session: f.session, lock: f.lock });
  reloaded.state.effects = f.state.effects; reloaded.state.products = [];
  const receipt = await reloaded.api.retryPending();
  assert.equal(receipt.status, 'already_processed'); assert.equal(reloaded.state.posts[0], bytes);
  assert.equal(reloaded.state.effects.size, 1);
  assert.ok(reloaded.state.reads.every(url => url.endsWith('/status')));
  const again = fixture({ local: f.local, session: f.session, lock: f.lock });
  assert.equal(again.api.pendingSnapshot(), null); assert.equal(again.api.receiptSnapshot().sale_id, receipt.sale_id);
});

test('public canonical reads remain available when an old binding is stale; writer stays blocked', async () => {
  const f = await fixture().setup(); f.state.fault = 'lost';
  await assert.rejects(f.api.createSale(intent));
  const reload = fixture({ local: f.local, session: storage(), lock: f.lock });
  await assert.rejects(reload.api.retryPending(), /CLOSED/);
  await reload.api.configure(config); await reload.api.retryPending();
  for (const endpoint of ['https://remote.example', 'http://127.0.0.1:9999']) {
    const binding = JSON.parse(f.local.getItem(KEY)); binding.endpoint = endpoint; f.local.setItem(KEY, JSON.stringify(binding));
    const bad = fixture({ local: f.local, session: f.session });
    await bad.api.refresh(); assert.ok(bad.state.reads.length >= 4); assert.equal(bad.state.posts.length, 0);
    await assert.rejects(bad.api.createSale(intent), /CLOSED/);
  }
});

test('unwritable or silently failed storage prevents POST, including pending retry', async () => {
  for (const mode of ['fail', 'drop']) {
    const f = await fixture().setup(); f.local[mode] = true;
    await assert.rejects(f.api.createSale(intent)); assert.equal(f.state.posts.length, 0);
  }
  const f = await fixture().setup(); f.state.fault = 'lost';
  await assert.rejects(f.api.createSale(intent)); f.local.fail = true;
  await assert.rejects(f.api.retryPending(), /quota/); assert.equal(f.state.posts.length, 1);
});

test('failed receipt persistence retains pending and replay recovers', async () => {
  const f = await fixture().setup(); f.state.fault = 'receipt-storage';
  await assert.rejects(f.api.createSale(intent), /quota/); assert.ok(f.api.pendingSnapshot());
  f.local.fail = false; f.state.fault = null;
  assert.equal((await f.api.retryPending()).status, 'already_processed'); assert.equal(f.state.effects.size, 1);
});

test('hard failures, malformed receipts and mismatched IDs retain intent without automatic retries', async () => {
  for (const fault of ['hard', 'malformed', 'wrong-id']) {
    const f = await fixture().setup(); f.state.fault = fault;
    await assert.rejects(f.api.createSale(intent));
    assert.ok(f.api.pendingSnapshot()); assert.equal(f.state.posts.length, 1);
    if (fault === 'hard') assert.equal(f.api.pendingSnapshot().last_error, 'stale_stock');
    await assert.rejects(f.api.createSale(intent)); assert.equal(f.state.posts.length, 1);
  }
});

test('receipt cannot overwrite an externally changed pending record', async () => {
  const f = await fixture().setup(); f.state.fault = 'replace';
  await assert.rejects(f.api.createSale(intent), /PENDING_CHANGED/);
  assert.equal(f.api.pendingSnapshot().last_error, 'foreign-change');
});

test('ifAvailable rejects simultaneous calls and another tab, including configure', async () => {
  const f = await fixture().setup(); let release;
  f.state.hold = new Promise(resolve => { release = resolve; });
  const running = f.api.createSale(intent);
  while (!f.state.posts.length) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.api.createSale(intent), /WRITER_BUSY/);
  const tab = fixture({ local: f.local, session: f.session, lock: f.lock });
  await assert.rejects(tab.api.retryPending(), /WRITER_BUSY/);
  await assert.rejects(tab.api.configure(config), /WRITER_BUSY/);
  release(); await running; assert.equal(f.state.posts.length, 1);
});

test('read-only P, stale authority, offline and unsupported actions fail closed', async () => {
  const f = await fixture().setup();
  for (const action of ['credit.create', 'product.update', 'sale.cancel', '', null]) assert.throws(() => f.api.assertAction(action), /UNSUPPORTED/);
  f.state.meta.mode = 'CANONICAL_READ_ONLY'; f.state.meta.read_only = true; f.state.meta.minimum_client_contract = 'a6-gate-p-v1';
  await f.api.refresh(); assert.throws(() => f.api.assertAction('sale.create'), /CLOSED/);
  await assert.rejects(f.api.createSale(intent)); assert.equal(f.state.posts.length, 0);
  for (const mutation of [{ authority_epoch: 9 }, { minimum_client_contract: 'unknown' }, { mode: 'ACTIVE' }]) {
    Object.assign(f.state.meta, mutation); await assert.rejects(f.api.refresh(), /STALE/);
  }
  const active = await fixture().setup(); active.state.fault = 'lost'; await assert.rejects(active.api.createSale(intent));
  active.state.meta.authority_epoch++; await assert.rejects(active.api.retryPending(), /STALE/); assert.equal(active.state.posts.length, 1);
  active.context.navigator.onLine = false; await assert.rejects(active.api.retryPending(), /CLOSED/);
});

test('unsafe amounts, duplicate products, impossible credit dates and invalid mixed splits do not persist', async () => {
  const cases = [
    { ...intent, items: [intent.items[0], intent.items[0]] },
    { ...intent, items: [{ product_id: 'product', quantity: Number.MAX_SAFE_INTEGER }] },
    { ...intent, items: [{ product_id: 'product', quantity: -1 }] },
    { ...intent, payment_method: 'credito', customer_id: 'customer', credit_due: '2026-02-30' },
    { ...intent, payment_method: 'mixto', cash_cents: 250, digital_method: 'yape' },
    { ...intent, payment_method: 'credito', credit_due: '2026-10-01' }
  ];
  for (const input of cases) {
    const f = await fixture().setup(); await assert.rejects(f.api.createSale(input));
    assert.equal(f.state.posts.length, 0); assert.equal(f.api.pendingSnapshot(), null);
  }
});

test('incomplete refresh preserves snapshot; LIVE provenance is literal safe credit text', async () => {
  const f = fixture();
  f.state.credits = [{ credit_id: '<script>credit</script>', customer_id: 'customer', provenance: 'LIVE', current_balance_cents: 250 }];
  await f.setup(); const before = json(f.api.snapshot()); f.state.readFault = true;
  await assert.rejects(f.api.refresh()); assert.deepEqual(json(f.api.snapshot()), before);
  const container = new f.Element('section'); f.api.renderCredits(container); f.api.renderCredits(container);
  assert.equal(container.children.length, 1);
  assert.match(container.children[0].children[0].textContent, /<script>credit<\/script> \| LIVE/);
});

test('missing Web Locks blocks commands while corrupt binding falls back to public reads only', async () => {
  const noLocks = fixture({ lock: null }); await assert.rejects(noLocks.api.configure(config), /WEB_LOCKS/);
  const local = storage(); local.setItem(KEY, '{broken');
  const corrupt = fixture({ local }); assert.equal(corrupt.api.enabled(), true);
  await corrupt.api.refresh(); assert.ok(corrupt.state.reads.length >= 4); assert.equal(corrupt.state.posts.length, 0);
});

const financialCases = [
  ['payment.create', 'createPayment', { credit_id: 'import-credit', amount_cents: 100, payment_method: 'yape' }],
  ['cash.open', 'openCash', { session_id: 'new-till', opening_cents: 0 }],
  ['cash.close', 'closeCash', { counted_cents: 950 }],
  ['adjustment.create', 'createAdjustment', { amount_cents: -100, reason: 'Salida documentada' }],
  ['compensation.create', 'createCompensation', { compensates_operation_id: 'prior-payment', reason: 'Abono equivocado' }]
];
async function financialFixture(command, options) {
  const f = fixture(options);
  f.state.credits = ['IMPORT', 'LIVE'].map((provenance, i) => ({ credit_id: i ? 'live-credit' : 'import-credit', customer_id: 'customer', provenance, revision: 7, current_balance_cents: 500, opening_balance_cents: 1000 }));
  f.state['cash-sessions'] = command === 'cash.open' ? [] : [{ session_id: 'till', status: 'OPEN', revision: 4, expected_cents: 1000 }];
  f.state['financial-events'] = [{ operation_id: 'prior-payment', event_id: 'prior-payment', event_type: 'PAYMENT', credit_id: 'import-credit', credit_provenance: 'IMPORT', cash_delta_cents: 100, credit_delta_cents: -100 }];
  return f.setup();
}

test('financial commands bind exact authority, snapshots, IDs and routes; credentials remain session only', async t => {
  for (const [command, method, input] of financialCases) await t.test(command, async () => {
    const f = await financialFixture(command), receipt = await f.api[method](input), p = JSON.parse(f.state.posts[0]);
    assert.equal(receipt.command, command); assert.equal(receipt.operation_id, p.operation_id);
    assert.equal(f.state.routes[0], '/commands/' + command);
    assert.deepEqual([p.device_id, p.promotion_id, p.authority_epoch, p.expected_control_revision, p.client_contract], ['writer', 'promotion', 3, 3, 'a6-gate-c-v1']);
    assert.match(p.operation_id, /^[0-9a-f-]{36}$/); assert.ok(Number.isFinite(Date.parse(p.created_at)));
    if (['payment.create', 'compensation.create'].includes(command)) assert.equal(p.expected_credit_revision, 7);
    if (['cash.close', 'adjustment.create', 'compensation.create'].includes(command)) assert.deepEqual([p.session_id, p.expected_session_revision], ['till', 4]);
    assert.equal(f.api.pendingSnapshot(), null); assert.equal(f.api.receiptSnapshot().command, command);
    assert.doesNotMatch(JSON.stringify([...f.local.values]), /read-secret|write-secret/);
    assert.deepEqual([...f.local.values.keys()].sort(), [KEY, JOURNAL].sort());
    assert.throws(() => f.api.assertAction(command), /CLOSED/);
  });
});

test('abonos IMPORT/LIVE use current balance and revision, never source IDs or provenance in backend payload', async () => {
  for (const credit_id of ['import-credit', 'live-credit']) for (const payment_method of ['efectivo', 'yape', 'plin', 'transferencia']) {
    const f = await financialFixture('payment.create');
    await f.api.createPayment({ credit_id, payment_method, amount_cents: 500, expected_credit_revision: 0 });
    const p = JSON.parse(f.state.posts[0]);
    assert.equal(p.credit_id, credit_id); assert.equal(p.expected_credit_revision, 7); assert.equal(p.amount_cents, 500);
    assert.equal(p.session_id, payment_method === 'efectivo' ? 'till' : undefined);
    assert.equal(p.provenance, undefined); assert.equal(p.credit_provenance, undefined); assert.equal(p.current_balance_cents, undefined);
  }
});

test('each financial route: lost ACK, reload and hard failure keep exact bytes with only manual replay', async t => {
  for (const [command, method, input] of financialCases) for (const fault of ['lost', 'hard', 'receipt-storage']) await t.test(command + '/' + fault, async () => {
    const f = await financialFixture(command); f.state.fault = fault;
    await assert.rejects(f.api[method](input));
    const bytes = f.state.posts[0], pending = json(f.api.pendingSnapshot());
    assert.equal(f.state.posts.length, 1);
    assert.equal(pending.command, command); assert.equal(pending.route, '/commands/' + command);
    const reload = fixture({ local: f.local, session: f.session, lock: f.lock });
    reload.state.effects = f.state.effects; f.local.fail = false;
    const result = await reload.api.retryPending();
    assert.equal(reload.state.posts[0], bytes); assert.equal(reload.state.routes[0], '/commands/' + command);
    assert.equal(result.idempotent, fault !== 'hard'); assert.equal(reload.state.effects.size, 1);
    assert.ok(reload.state.reads.every(url => url.endsWith('/status')));
  });
});

test('pending is global across every action and tabs; configure and retry share the writer lock', async () => {
  const f = await financialFixture('payment.create'); f.state.fault = 'lost';
  await assert.rejects(f.api.createPayment(financialCases[0][2]));
  const saved = f.local.getItem(JOURNAL);
  const other = await financialFixture('payment.create', { local: f.local, session: f.session, lock: f.lock });
  for (const api of [f.api, other.api]) {
    for (const [, method, input] of financialCases) await assert.rejects(api[method](input), /PENDING/);
    await assert.rejects(api.createSale(intent), /PENDING/);
  }
  assert.equal(f.local.getItem(JOURNAL), saved); assert.equal(other.state.posts.length, 0);
  f.state.fault = null; let release; f.state.hold = new Promise(resolve => { release = resolve; });
  const running = f.api.retryPending();
  while (f.state.posts.length < 2) await new Promise(resolve => setImmediate(resolve));
  for (const [, method, input] of financialCases) await assert.rejects(other.api[method](input), /WRITER_BUSY/);
  await assert.rejects(other.api.createSale(intent), /WRITER_BUSY/);
  await assert.rejects(other.api.configure(config), /WRITER_BUSY/); await assert.rejects(other.api.retryPending(), /WRITER_BUSY/);
  release(); await running;
});

test('financial receipt command, idempotency and relevant identities must match before durable confirmation', async () => {
  for (const [command, method, input] of financialCases) {
    const changes = [{ command: 'sale.create' }, { operation_id: 'wrong' }, { idempotent: true }, { promotion_id: 'wrong' }];
    if (command !== 'payment.create') changes.push(command === 'compensation.create' ? { compensates_operation_id: 'wrong' } : { session_id: 'wrong' });
    if (['payment.create', 'compensation.create'].includes(command)) changes.push({ credit_id: 'wrong' }, { credit_provenance: 'wrong' });
    if (!command.startsWith('cash.')) changes.push({ event_id: 'wrong' });
    for (const mutation of changes) {
      const f = await financialFixture(command); f.state.receiptMutation = mutation;
      await assert.rejects(f.api[method](input), /PENDING/); assert.equal(f.api.receiptSnapshot(), null); assert.ok(f.api.pendingSnapshot());
    }
  }
});

test('all ACTIVE pages and collections must share financial_revision; failed refresh never publishes partial snapshot', async () => {
  for (const mismatch of ['products', 'customers', 'credits', 'credit-payments', 'cash-sessions', 'financial-events']) {
    const f = await financialFixture('payment.create'), before = json(f.api.snapshot());
    f.state.readPage = (route, url) => ({ ...f.state.meta, financial_revision: route === mismatch && (route !== 'products' || url.searchParams.has('cursor')) ? 1 : 0,
      items: f.state[route] || [], next_cursor: route === 'products' && !url.searchParams.has('cursor') ? 'next' : null });
    await assert.rejects(f.api.refresh(), /STALE/); assert.deepEqual(json(f.api.snapshot()), before);
    assert.throws(() => f.api.assertAction('payment.create'), /CLOSED/);
  }
  for (const invalid of [undefined, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture(); f.state.meta.financial_revision = invalid; await f.api.configure(config); await assert.rejects(f.api.refresh(), /STALE/);
  }
});

test('read-only needs no financial_revision, skips ACTIVE-only collections, blocks all commands and pending replay', async () => {
  const f = await financialFixture('payment.create'); f.state.fault = 'lost'; await assert.rejects(f.api.createPayment(financialCases[0][2]));
  Object.assign(f.state.meta, { mode: 'CANONICAL_READ_ONLY', read_only: true, minimum_client_contract: 'a6-gate-p-v1' }); delete f.state.meta.financial_revision;
  f.state.reads = []; await f.api.refresh();
  assert.ok(f.state.reads.every(url => !/cash-sessions|financial-events/.test(url)));
  for (const command of ['sale.create', ...financialCases.map(c => c[0])]) assert.throws(() => f.api.assertAction(command), /CLOSED/);
  await assert.rejects(f.api.retryPending(), /CLOSED/); assert.equal(f.state.posts.length, 1);
});

test('unsafe money, IDs, methods, reasons and stale/closed sessions do not persist an intent', async () => {
  const invalid = [
    ...[0, -1, 1.1, '1', Number.MAX_SAFE_INTEGER + 1, 501].map(amount_cents => ['createPayment', { ...financialCases[0][2], amount_cents }]),
    ['createPayment', { ...financialCases[0][2], payment_method: 'credito' }],
    ['createPayment', { ...financialCases[0][2], reference: '\n' }],
    ['createPayment', { ...financialCases[0][2], credit_id: 'missing' }],
    ['closeCash', { counted_cents: -1 }], ['closeCash', { counted_cents: 0, session_id: 'stale' }],
    ['createAdjustment', { amount_cents: -1001, reason: 'No fondos' }],
    ...['', ' ', '\n', 42].map(reason => ['createAdjustment', { amount_cents: 1, reason }]),
    ['createCompensation', { compensates_operation_id: 'missing', reason: 'Correccion' }]
  ];
  for (const [method, input] of invalid) {
    const f = await financialFixture('payment.create'); await assert.rejects(f.api[method](input)); assert.equal(f.local.getItem(JOURNAL), null); assert.equal(f.state.posts.length, 0);
  }
  for (const [, method, input] of financialCases.filter(c => c[0] !== 'cash.open')) {
    const f = await financialFixture('payment.create'); f.state['cash-sessions'][0].status = 'CLOSED'; await f.api.refresh();
    await assert.rejects(f.api[method](method === 'createPayment' ? { ...input, payment_method: 'efectivo' } : input)); assert.equal(f.state.posts.length, 0);
  }
});

test('digital payment compensation needs only credit CAS; adjustment compensation needs only session CAS', async () => {
  for (const kind of ['digital', 'adjustment']) {
    const f = await financialFixture('compensation.create'), event = f.state['financial-events'][0];
    if (kind === 'digital') event.cash_delta_cents = 0;
    else Object.assign(event, { event_type: 'ADJUSTMENT', credit_id: null, credit_provenance: null, credit_delta_cents: 0, cash_delta_cents: -100 });
    await f.api.refresh(); await f.api.createCompensation(financialCases[4][2]);
    const p = JSON.parse(f.state.posts[0]);
    assert.equal(p.expected_credit_revision, kind === 'digital' ? 7 : undefined);
    assert.equal(p.expected_session_revision, kind === 'adjustment' ? 4 : undefined);
  }
});

function descendants(element) { return [element, ...element.children.flatMap(descendants)]; }
test('first remote load persists a canonical replica without secrets', async () => {
  const f = fixture(); const writes = [];
  f.context._naReadCanonicalReplica = async () => null;
  f.context._naWriteCanonicalReplica = async value => { writes.push(json(value)); return { durable: true, verified: true }; };
  await f.api.configure(config); await f.api.refresh();
  assert.equal(writes.length, 1);
  assert.deepEqual([writes[0].schema_version, writes[0].promotion_id, writes[0].authority_epoch, writes[0].revision, writes[0].financial_revision], [1, 'promotion', 3, 3, 0]);
  assert.deepEqual([writes[0].products.length, writes[0].customers.length, writes[0].credits.length, writes[0].credit_payments.length], [1, 1, 0, 0]);
  assert.doesNotMatch(JSON.stringify(writes[0]), /read-secret|write-secret|token|password/i);
});

test('VERSION=1 intent keeps durable identity and economics while binding fresh authority and stock', async () => {
  const f = await fixture().setup(); f.state.products[0].stock_revision = 7;
  const saleIntent = { version: 1, operation_id: 'offline-operation-001', sale_id: 'offline-sale-001', created_at: '2026-09-20T12:34:56.000Z',
    payment_method: 'efectivo', total_cents: 200, payment: { cash_cents: 200, digital_cents: 0, credit_cents: 0 },
    items: [{ product_id: 'product', quantity: 2, unit_price_cents: 100, line_total_cents: 200 }],
    promotion_id: 'forged-promotion', authority_epoch: 99, expected_control_revision: 99, expected_stock_revision: 99,
    device_id: 'forged-device', token: 'intent-secret', credential: 'intent-secret' };
  await f.api.createSale(saleIntent);
  const payload = JSON.parse(f.state.posts[0]);
  assert.equal(payload.operation_id, saleIntent.operation_id); assert.equal(payload.sale_id, saleIntent.sale_id);
  assert.equal(payload.created_at, saleIntent.created_at); assert.equal(payload.items[0].unit_price_cents, 100);
  assert.equal(payload.items[0].line_total_cents, 200); assert.equal(payload.total_cents, 200);
  assert.equal(payload.items[0].expected_stock_revision, 7);
  assert.equal(payload.promotion_id, 'promotion'); assert.equal(payload.authority_epoch, 3); assert.equal(payload.expected_control_revision, 3);
  assert.equal(payload.device_id, 'writer');
  assert.doesNotMatch(JSON.stringify(payload), /intent-secret|write-secret|read-secret/);
});

test('invalid VERSION=1 economics fail before POST or pending journal', async () => {
  for (const changes of [{ items: [{ product_id: 'product', quantity: 2, unit_price_cents: 100, line_total_cents: 199 }] }, { total_cents: 201 }]) {
    const f = await fixture().setup();
    const saleIntent = { version: 1, operation_id: 'offline-operation-002', sale_id: 'offline-sale-002', created_at: '2026-09-20T12:34:56.000Z',
      payment_method: 'efectivo', total_cents: 200, payment: { cash_cents: 200, digital_cents: 0, credit_cents: 0 },
      items: [{ product_id: 'product', quantity: 2, unit_price_cents: 100, line_total_cents: 200 }], ...changes };
    await assert.rejects(f.api.createSale(saleIntent));
    assert.equal(f.state.posts.length, 0); assert.equal(f.api.pendingSnapshot(), null);
  }
});

test('valid local replica returns before remote GET completion and newer metadata replaces it', async () => {
  const f = fixture(); let cached = { schema_version: 1, cached_at: '2026-01-01T00:00:00.000Z', promotion_id: 'promotion', authority_epoch: 3,
    revision: 2, financial_revision: 0, mode: 'ACTIVE', read_only: false, minimum_client_contract: 'a6-gate-c-v1', products: [{ ...f.state.products[0], name: 'Cache' }],
    customers: f.state.customers, credits: [], credit_payments: [] };
  const writes = []; let release;
  f.context._naReadCanonicalReplica = async () => json(cached);
  f.context._naWriteCanonicalReplica = async value => { writes.push(json(value)); cached = json(value); return { durable: true, verified: true }; };
  await f.api.configure(config);
  f.state.readHold = new Promise(resolve => { release = resolve; });
  const cacheResult = await f.api.startPOS();
  assert.equal(cacheResult.products[0].name, 'Cache');
  assert.equal(f.api.sourceState().source, 'cache');
  assert.ok(f.state.reads.length > 0, 'background revalidation has started');
  const cacheRenderedAt = Date.now();
  const remotePromise = f.api.refresh();
  await new Promise(resolve => setTimeout(resolve, 3)); release(); await remotePromise;
  const remoteRefreshCompletedAt = Date.now();
  assert.ok(cacheRenderedAt < remoteRefreshCompletedAt, 'CACHE_RENDERED_AT < REMOTE_REFRESH_COMPLETED_AT');
  assert.equal(f.api.snapshot().products[0].name, '<img src=x>');
  assert.equal(writes.length, 1); assert.equal(writes[0].revision, 3);
});

test('equal replica is not rewritten; corrupt replica falls back to remote; offline valid cache stays readable and non-writable', async () => {
  const f = fixture(); let cached = { schema_version: 1, cached_at: '2026-01-01T00:00:00.000Z', promotion_id: 'promotion', authority_epoch: 3,
    revision: 3, financial_revision: 0, mode: 'ACTIVE', read_only: false, minimum_client_contract: 'a6-gate-c-v1', products: f.state.products,
    customers: f.state.customers, credits: [], credit_payments: [], cash_sessions: [], financial_events: [] };
  let writes = 0; f.context._naReadCanonicalReplica = async () => json(cached);
  f.context._naWriteCanonicalReplica = async value => { writes++; cached = json(value); return { durable: true, verified: true }; };
  await f.api.configure(config); await f.api.startPOS(); await f.api.refresh();
  assert.equal(writes, 0, 'equal canonical metadata and collections do not rewrite the snapshot');

  cached = { ...cached, products: [null] };
  const invalid = fixture(); invalid.context._naReadCanonicalReplica = async () => cached;
  const persisted = []; invalid.context._naWriteCanonicalReplica = async value => { persisted.push(json(value)); };
  await invalid.api.configure(config); await invalid.api.startPOS();
  assert.equal(invalid.api.sourceState().source, 'remote'); assert.equal(persisted.length, 1, 'corrupt cache ignored and remote becomes durable replica');

  const offline = fixture(); offline.context._naReadCanonicalReplica = async () => json({ ...cached, products: f.state.products });
  await offline.api.configure(config); offline.context.navigator.onLine = false;
  const local = await offline.api.startPOS();
  assert.equal(local.products[0].product_id, 'product'); assert.equal(offline.api.sourceState().source, 'cache');
  assert.throws(() => offline.api.assertAction('sale.create'), /CLOSED/);
  await assert.rejects(offline.api.refresh(), /AUTHORITY_UNAVAILABLE/);
  assert.equal(offline.api.snapshot().products[0].product_id, 'product');

  const newer = fixture(); const newerCache = { ...cached, revision: 4, products: [{ ...f.state.products[0], name: 'Revision 4' }] }; let staleWrites = 0;
  newer.context._naReadCanonicalReplica = async () => json(newerCache); newer.context._naWriteCanonicalReplica = async () => { staleWrites++; };
  await newer.api.configure(config); await newer.api.startPOS(); await newer.api.refresh();
  assert.equal(newer.api.snapshot().products[0].name, 'Revision 4'); assert.equal(staleWrites, 0, 'older remote revision must never replace newer local canonical data');
});

test('validated remote promotion replaces a different cached promotion at the same authority epoch', async () => {
  const f = fixture();
  const cached = {
    schema_version: 1,
    cached_at: '2026-01-01T00:00:00.000Z',
    promotion_id: 'old-promotion',
    authority_epoch: 3,
    revision: 99,
    financial_revision: 0,
    mode: 'ACTIVE',
    read_only: false,
    minimum_client_contract: 'a6-gate-c-v1',
    products: [{ ...f.state.products[0], name: 'STALE PROMOTION CACHE' }],
    customers: f.state.customers,
    credits: [],
    credit_payments: [],
    cash_sessions: [],
    financial_events: []
  };

  const writes = [];
  f.context._naReadCanonicalReplica = async () => json(cached);
  f.context._naWriteCanonicalReplica = async value => {
    writes.push(json(value));
    return { durable: true, verified: true };
  };

  await f.api.configure(config);
  await f.api.startPOS();
  await f.api.refresh();

  assert.equal(f.api.sourceState().source, 'remote');
  assert.equal(f.api.snapshot().promotion_id, 'promotion');
  assert.equal(f.api.snapshot().products[0].name, '<img src=x>');
  assert.equal(writes.length, 1, 'validated remote promotion must replace stale cache from another promotion');
});

test('canonical snapshot shows 31 customers, 313 credits and 131 payment histories', async () => {
  const f = fixture();
  f.state.meta.mode = 'CANONICAL_READ_ONLY'; f.state.meta.read_only = true;
  f.state.products = Array.from({ length: 408 }, (_, i) => ({ product_id: String(i), name: `Producto ${i}`, current_stock_quantity: i }));
  f.state.customers = Array.from({ length: 31 }, (_, i) => ({ customer_id: `C${i}`, name: `Cliente ${i}` }));
  f.state.credits = Array.from({ length: 313 }, (_, i) => ({ credit_id: `CR${i}`, customer_id: `C${i % 31}`, concept: `Cr?dito ${i}`, issued_value: '2026-01-01', due_value: '2026-12-31', original_amount_cents: 200, import_paid_cents: 100, current_balance_cents: 100 }));
  f.state.payments = Array.from({ length: 131 }, (_, i) => ({ payment_id: `P${i}`, source_payment_id: `P${i}`, credit_id: `CR${i}`, amount_cents: 25, payment_date: null, date_precision: 'UNKNOWN' }));
  await f.api.configure(config); await f.api.refresh();
  const snapshot = f.api.snapshot();
  assert.deepEqual([snapshot.products.length, snapshot.customers.length, snapshot.credits.length, snapshot.payments.length], [408, 31, 313, 131]);
  const container = new f.Element('section'); f.api.renderCredits(container);
  const rendered = descendants(container);
  assert.equal(rendered.filter(item => item.tagName === 'article').length, 313);
  assert.equal(rendered.filter(item => item.tagName === 'p' && item.textContent.includes('fecha desconocida')).length, 131);
  assert.ok(rendered.some(item => item.textContent.includes('Cliente 30')));
  const legacy=f.api.legacySnapshot();
  assert.deepEqual([legacy.customers.length,legacy.credits.length,legacy.payments.length],[31,313,131]);
  assert.equal(legacy.credits.reduce((sum,cr)=>sum+cr.monto-cr.pagado,0),313);
  assert.equal(legacy.credits.reduce((sum,cr)=>sum+cr.pagos.length,0),131);
});

test('PROD public bootstrap loads canonical data without reader credentials or replacing the existing POS', async () => {
  const f = fixture();
  Object.assign(f.context.location, { hostname: 'nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev', origin: 'https://nuevo-amanecer-pos-prod.nuevo-amanecer-pos.workers.dev', protocol: 'https:' });
  f.state.products = Array.from({ length: 408 }, (_, i) => ({ product_id: `product-${i}`, name: `Product ${i}`, price_cents: 100, current_stock_quantity: 5 }));
  f.state.customers = Array.from({ length: 31 }, (_, i) => ({ customer_id: `customer-${i}`, name: `Customer ${i}` }));
  f.state.credits = Array.from({ length: 313 }, (_, i) => ({ credit_id: `credit-${i}`, customer_id: `customer-${i % 31}`, original_amount_cents: 100, current_balance_cents: 100 }));
  f.state.payments = Array.from({ length: 131 }, (_, i) => ({ payment_id: `payment-${i}`, credit_id: `credit-${i % 313}`, amount_cents: 1 }));
  assert.equal(f.api.enabled(), true);
  await f.api.startPOS();
  assert.equal(f.body.children.length, 0, 'the adapter must not add a parallel full-screen panel');
  assert.ok(f.state.reads.length >= 5);
  assert.equal(f.state.posts.length, 0);
  const snapshot = f.api.legacySnapshot();
  assert.deepEqual([snapshot.products.length, snapshot.customers.length, snapshot.credits.length, snapshot.payments.length], [408, 31, 313, 131]);
});

test('POS canonical bootstrap refreshes read-only and leaves existing page DOM in place', async () => {
  const f = await financialFixture('payment.create');
  await f.api.startPOS();
  assert.equal(f.body.children.length, 0, 'existing POS markup remains the page');
  assert.ok(f.state.reads.length >= 4); assert.ok(f.state.reads.every(url => new URL(url).pathname.startsWith('/read/canonical/')));
  assert.equal(f.state.posts.length, 0);
  assert.doesNotMatch(source, /stopImmediatePropagation\(\)|canonicalPOS/);
});

test('client payloads and receipts interoperate with the real local Worker / SQLite financial commands', async t => {
  const { a6Fixture, response, WRITER, READER } = await import('./a6-fixture.mjs');
  const backend = await a6Fixture(t);
  await response(await backend.freeze(), 201); await response(await backend.promote(), 201);
  // Isolated in-memory test authority only; no deployment or configuration file.
  backend.database.exec('DROP TRIGGER canonical_control_no_legacy');
  backend.exec("UPDATE canonical_control SET mode='ACTIVE',revision=revision+1,authority_epoch=authority_epoch+1,minimum_client_contract='a6-gate-c-v1' WHERE id=1");
  backend.database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0007_canonical_commerce.sql', import.meta.url), 'utf8'));
  backend.database.exec(readFileSync(new URL('../../tools/cloudflare-lab/migrations/0008_canonical_financial.sql', import.meta.url), 'utf8'));
  const f = fixture(), c = backend.control(), requests = [];
  f.context.fetch = async (url, options) => {
    if (options.method === 'POST') {
      const record = JSON.parse(f.local.getItem(JOURNAL));
      assert.equal(record.state, 'PENDING'); assert.equal(JSON.stringify(record.payload), options.body);
      requests.push(new URL(url).pathname);
    }
    return backend.fetch(url, options);
  };
  await f.api.configure({ endpoint: 'http://localhost', deviceId: WRITER['x-device-id'], token: WRITER['x-sync-token'], readToken: READER['x-read-token'],
    promotion_id: c.active_promotion_id, authority_epoch: c.authority_epoch, revision: c.revision });
  await f.api.refresh();
  const open = await f.api.openCash({ session_id: 'client-till', opening_cents: 1000 });
  assert.equal(open.expected_cents, 1000); await f.api.refresh();
  const paid = await f.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'efectivo' });
  assert.equal(paid.current_balance_cents, 600); assert.equal(paid.credit_provenance, 'IMPORT'); await f.api.refresh();
  const undo = await f.api.createCompensation({ compensates_operation_id: paid.operation_id, reason: 'Correccion de prueba' });
  assert.equal(undo.current_balance_cents, 700); assert.equal(undo.expected_cents, 1000); await f.api.refresh();
  const adjust = await f.api.createAdjustment({ amount_cents: -100, reason: 'Salida de prueba' });
  assert.equal(adjust.expected_cents, 900); await f.api.refresh();
  const restored = await f.api.createCompensation({ compensates_operation_id: adjust.operation_id, reason: 'Reversion de salida' });
  assert.equal(restored.expected_cents, 1000); await f.api.refresh();
  const closed = await f.api.closeCash({ counted_cents: 999 });
  assert.equal(closed.difference_cents, -1); await f.api.refresh();
  assert.equal(f.api.snapshot().cashSessions[0].status, 'CLOSED');
  assert.equal(f.api.snapshot().financialEvents.length, 4);
  assert.equal(f.api.snapshot().financial_revision, 6);
  assert.deepEqual(requests, ['/commands/cash.open', '/commands/payment.create', '/commands/compensation.create', '/commands/adjustment.create', '/commands/compensation.create', '/commands/cash.close']);
  assert.deepEqual(backend.all('PRAGMA foreign_key_check'), []);
});
