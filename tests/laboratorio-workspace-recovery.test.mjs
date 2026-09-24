import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const source = readFileSync('laboratorio/pos-lab/js/lab-workspace.js', 'utf8');
const CREDENTIAL_KEY = 'na_lab_workspace_auth_v2';
const PENDING_KEY = 'na_lab_workspace_pending_v1';

function snapshot(label) {
  return {
    version: 9,
    updatedAt: '2026-09-24T10:00:00.000Z',
    appConfig: {},
    ui: { currentPage: 'pageMenu' },
    locks: { master: false, readOnly: false, modules: {} },
    data: {
      productos: [{ id: label, nombre: label }],
      ventas: [],
      clientes: [],
      creditos: [],
      gastos: [],
      cajMovs: [],
      cashClosures: [],
      inventoryMovements: []
    },
    cart: [],
    draft: null
  };
}

function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    dump(key) { return map.get(key); }
  };
}

function makeHarness({ local, remote, pending = null, onFetch }) {
  const timers = [];
  const persistent = storage({
    [CREDENTIAL_KEY]: JSON.stringify({
      endpoint: 'https://lab.example',
      readToken: '',
      sessionToken: 'a'.repeat(64)
    }),
    ...(pending ? { [PENDING_KEY]: JSON.stringify(pending) } : {})
  });
  const session = storage();
  let current = structuredClone(local);
  const applied = [];

  const context = {
    console,
    crypto: webcrypto,
    Response,
    Request,
    URL,
    TextEncoder,
    TextDecoder,
    structuredClone,
    localStorage: persistent,
    sessionStorage: session,
    confirm: () => true,
    document: {
      body: null,
      getElementById: () => null,
      querySelector: () => null
    },
    window: { __NA_LAB__: true, open() {} },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    fetch: async (url, options = {}) => onFetch(url, options),
    _naBuildSnapshot: () => structuredClone(current),
    _naReadLocalSnapshot: () => structuredClone(current),
    _naReadSessionSnapshot: () => null,
    _naValidSnapshot: () => true,
    _naApplySnapshot: (next) => {
      applied.push(structuredClone(next));
      current = structuredClone(next);
      return true;
    },
    _naNormalizeData() {},
    _naReconcileCart: (cart) => ({ cart }),
    renderCategorySelects() {},
    _naApplyConfigUI() {},
    posRender() {},
    posUpdateCart() {},
    invRender() {},
    invBadges() {},
    cliRender() {},
    ventasRender() {},
    cajRender() {},
    gasRender() {},
    cfgUpdateStats() {},
    updateDashboard() {},
    saveAllData: async () => ({ durable: true }),
    saveAppState: async () => ({ durable: true }),
    loadAllData: async () => ({ durable: true })
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);

  return {
    context,
    timers,
    persistent,
    applied,
    get current() { return current; },
    set current(value) { current = structuredClone(value); },
    async runOneTimer() {
      const fn = timers.shift();
      if (!fn) return false;
      const value = fn();
      if (value && typeof value.then === 'function') await value;
      await new Promise((resolve) => setImmediate(resolve));
      return true;
    }
  };
}

test('ACK perdido reintenta exactamente el mismo operation_id durable', async () => {
  const posts = [];
  let saveAttempts = 0;
  const remote = snapshot('REMOTE');
  const h = makeHarness({
    local: snapshot('LOCAL'),
    remote,
    async onFetch(url, options) {
      if (url.endsWith('/lab/workspace') && (!options.method || options.method === 'GET')) {
        return Response.json({ revision: 1, baseline_id: 'B1', source_ref: 'r2://canon', snapshot: remote });
      }
      if (url.endsWith('/lab/workspace/save')) {
        const body = JSON.parse(options.body);
        posts.push(body);
        saveAttempts += 1;
        if (saveAttempts === 1) throw new TypeError('ACK lost');
        return Response.json({ status: 'already_saved', revision: 2, snapshot_hash: 'x' });
      }
      throw new Error('unexpected fetch ' + url);
    }
  });

  await h.context.window.NuevoAmanecerLabWorkspace.load();
  h.current = snapshot('EDITED');
  await h.context.saveAllData();
  await h.context.window.NuevoAmanecerLabWorkspace.saveNow();
  assert.equal(posts.length, 1);
  assert.ok(h.persistent.dump(PENDING_KEY), 'pending operation must survive the lost ACK');

  await h.context.window.NuevoAmanecerLabWorkspace.saveNow();
  assert.equal(posts.length, 2);
  assert.equal(posts[0].operation_id, posts[1].operation_id);
  assert.deepEqual(posts[0].snapshot, posts[1].snapshot);
  assert.equal(h.persistent.dump(PENDING_KEY), undefined);
});

test('recarga no aplica D1 encima de una operación local pendiente', async () => {
  const edited = snapshot('EDITED');
  const remote = snapshot('REMOTE-OLD');
  const pending = { expected_revision: 4, operation_id: 'op-pending', snapshot: edited };
  const h = makeHarness({
    local: edited,
    remote,
    pending,
    async onFetch(url, options) {
      if (url.endsWith('/lab/workspace') && (!options.method || options.method === 'GET')) {
        return Response.json({ revision: 4, baseline_id: 'B1', source_ref: 'r2://canon', snapshot: remote });
      }
      if (url.endsWith('/lab/workspace/save')) throw new TypeError('offline');
      throw new Error('unexpected fetch ' + url);
    }
  });

  await h.context.loadAllData();
  await h.runOneTimer();
  assert.equal(h.current.data.productos[0].id, 'EDITED');
  assert.ok(h.persistent.dump(PENDING_KEY));
  assert.equal(h.context.window.NuevoAmanecerLabWorkspace.state().pendingOperationId, 'op-pending');
});

test('edición temprana antes de D1 se conserva y se guarda tras conocer la revisión', async () => {
  const edited = snapshot('EARLY-EDIT');
  const remote = snapshot('REMOTE-OLD');
  const posts = [];
  const h = makeHarness({
    local: edited,
    remote,
    async onFetch(url, options) {
      if (url.endsWith('/lab/workspace') && (!options.method || options.method === 'GET')) {
        return Response.json({ revision: 7, baseline_id: 'B1', source_ref: 'r2://canon', snapshot: remote });
      }
      if (url.endsWith('/lab/workspace/save')) {
        const body = JSON.parse(options.body);
        posts.push(body);
        return Response.json({ status: 'saved', revision: 8, snapshot_hash: 'x' });
      }
      throw new Error('unexpected fetch ' + url);
    }
  });

  await h.context.saveAllData();
  assert.equal(h.context.window.NuevoAmanecerLabWorkspace.state().dirty, true);
  await h.context.loadAllData();
  await h.runOneTimer();

  assert.equal(posts.length, 1);
  assert.equal(posts[0].expected_revision, 7);
  assert.equal(posts[0].snapshot.data.productos[0].id, 'EARLY-EDIT');
  assert.equal(h.current.data.productos[0].id, 'EARLY-EDIT');
});
