// SPEC-891 C1/C2: el único dato estable y validado por el servidor es el ROL de /auth/me (el principal cambia en
// cada activación, la etiqueta la escribe el dueño y el cajero lo manda el cliente). Criterio: MISMO ROL en el
// MISMO navegador → lo pendiente se reenvía solo, con el token nuevo y el MISMO cuerpo. Solo un cambio
// dueño ↔ empleado va a revisión. Lo de antes de la actualización (sin sello) lo adopta el rol activo si no hay
// rastro de otro rol (marca adopted_at_upgrade); si hay rastro, revisión. Un 403 nunca borra.
// Sesiones NUEVAS reales del Worker (/auth/activate y /auth/pair), no rotateSession. Datos sintéticos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon, device, storage } from './canon-browser-harness.mjs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const scripts = ['sync/canonical-sale-intent.js', 'sync/canonical-sale-projection.js', 'sync/canonical-sale-outbox.js', 'sync/canonical-status-banner.js'].map(p => [p, read('POS/js/' + p)]);
const banner = tab => tab.context.NuevoAmanecerStatusBanner.view(tab.context.NuevoAmanecerStatusBanner.compute());
const CRED = 'na_cloud_sync_credentials', JOURNAL = 'na_canonical_sale_journal';
const plain = v => JSON.parse(JSON.stringify(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const posts = (tab, path) => tab.fetchLog.filter(r => r.method === 'POST' && new URL(r.url).pathname === path);
const payments = f => f.sql("SELECT COUNT(*) n FROM canonical_financial_events WHERE event_type='PAYMENT'").n;
const salesByOp = (f, op) => f.sql('SELECT COUNT(*) n FROM sales WHERE operation_id=?', op).n;
const relogin = (ls, token) => ls.setItem(CRED, JSON.stringify({ endpoint: 'http://localhost', token }));
const heldList = tab => plain(tab.api.heldOperations()).entries.filter(e => e.status === 'HELD');
const quarantined = tab => plain(tab.context.NuevoAmanecerCanonicalSaleOutbox.quarantine()).entries.filter(e => e.status === 'QUARANTINED');
function saleInput(tab, id) {
  return tab.context.NuevoAmanecerCanonicalSaleIntent.build({ operation_id: id, sale_id: id, created_at: new Date().toISOString(), payment_method: 'yape',
    items: [{ product_id: '00003', quantity: 1, unit_price_cents: 1000 }] });
}
// NA_ROLES mínimo con el rol que devuelve /auth/me REAL para ese token (como pos-roles-client tras refresh()).
async function rolesFor(f, token) {
  const r = await f.fetch('http://localhost/auth/me', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(r.status, 200);
  const me = await r.json();
  let approvals = 0;
  return { confirmed: true, role: me.pos_role, label: me.label, sessionPrincipal: me.device_id, isOwner: () => me.pos_role === 'owner',
    confirmedFor: t => t === token, approve: async () => { approvals++; return 'apr'; }, get approvals() { return approvals; } };
}
async function newOwnerSession(f) { const a = await f.activate(); assert.equal(a.response.status, 200); return a.token; }
async function newEmployeeSession(f, ownerToken) {
  const call = (path, body, token) => f.fetch('http://localhost' + path, { method: 'POST', headers: { authorization: 'Bearer ' + (token || ''), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await call('/auth/owner-pin', { new_pin: '2468' }, ownerToken);
  const code = await (await call('/auth/pairing-code', { label: 'Caja 2', pin: '2468' }, ownerToken)).json();
  const paired = await (await call('/auth/pair', { code: code.code })).json();
  assert.equal(typeof paired.session_token, 'string');
  return paired.session_token;
}
const ROLE_MIGRATIONS = ['0024_pos_roles_owner_pin.sql'];
function loseFirst(path) { let lose = true; return async url => { if (lose && new URL(url).pathname === path) { lose = false; throw new TypeError('fetch failed'); } }; }

for (const withSale of [true, false]) {
  test(`C1 mismo rol (dueño), 401 y re-entrada con sesión NUEVA real${withSale ? ' con venta en cola' : ' sin venta en cola'}: abono${withSale ? ' y venta' : ''} se envían solos, una vez, mismo cuerpo, sin PIN`, async t => {
    const f = await activeCanon(t, { migrations: ROLE_MIGRATIONS }), ls = storage();
    const tokA = await newOwnerSession(f), rolesA = await rolesFor(f, tokA);
    const A = await device(f, { token: tokA, localStorage: ls, scripts, globals: { NA_ROLES: rolesA }, onFetch: loseFirst('/commands/payment.create') });
    await assert.rejects(A.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'ID-C1' }));
    const op = A.api.pendingSnapshot().payload.operation_id, firstBody = posts(A, '/commands/payment.create')[0].body;
    const sale = withSale ? plain(await A.context.NuevoAmanecerCanonicalSaleOutbox.enqueue(saleInput(A, 'id-sale-c1'))) : null;
    // La sesión A deja de valer (401 real del Worker).
    f.rotateSession(rolesA.sessionPrincipal.replace(/^session:/, ''), 'tok-muerto');
    if (withSale) {
      const r1 = plain(await A.context.NuevoAmanecerCanonicalSaleOutbox.sync());
      assert.match(String(r1.reason), /^SESSION_(unauthorized|session_revoked)/, JSON.stringify(r1));
      assert.doesNotMatch(String(r1.reason), /undefined/);
    } else await assert.rejects(A.api.retryPending());
    assert.equal(A.api.pendingSnapshot().last_status, 401);
    const b1 = banner(A);
    assert.match(b1.text, /Sesión vencida: vuelve a iniciar sesión/, 'franja: sesión vencida');
    assert.doesNotMatch(b1.text, /reintentando|rechazada/, 'no promete «reintentando» ni dice «rechazada»: ' + b1.text);
    // El dueño vuelve a activar el navegador: /auth/activate crea una sesión y un principal NUEVOS.
    const tokB = await newOwnerSession(f), rolesB = await rolesFor(f, tokB);
    assert.notEqual(rolesB.sessionPrincipal, rolesA.sessionPrincipal, 'principal nuevo (como en producción)');
    relogin(ls, tokB);
    const B = await device(f, { token: tokB, localStorage: ls, scripts, globals: { NA_ROLES: rolesB } });
    if (withSale) assert.equal((await B.context.NuevoAmanecerCanonicalSaleOutbox.sync()).status, 'DRAINED');
    else { B.context.dispatchEvent(new B.context.CustomEvent('na:role')); await B.api.resendAfterLogin(); await sleep(20); }
    assert.equal(payments(f), 1, 'el abono se aplicó una vez');
    const sent = posts(B, '/commands/payment.create');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body, firstBody, 'cuerpo byte a byte igual (mismo operation_id)');
    assert.equal(JSON.parse(sent[0].body).operation_id, op);
    if (withSale) assert.equal(salesByOp(f, sale.operation_id), 1);
    assert.equal(B.api.pendingSnapshot(), null, 'journal libre: la franja ya no dice «sesión vencida»');
    assert.equal(banner(B), null, 'franja limpia tras volver a entrar');
    assert.equal(quarantined(B).length, 0); assert.equal(heldList(B).length, 0, 'nada en revisión');
    assert.equal(rolesB.approvals, 0, 'sin PIN ni aprobación');
    // Un abono nuevo no tropieza con CANONICAL_FINANCIAL_PENDING.
    await B.api.refresh();
    await B.api.createPayment({ credit_id: 'CR:001', amount_cents: 50, payment_method: 'yape', reference: 'ID-C1-2' });
    assert.equal(payments(f), 2);
    if (withSale) { await B.context.NuevoAmanecerCanonicalSaleOutbox.sync(); assert.equal(salesByOp(f, sale.operation_id), 1); }
  });
}

for (const [label, firstRole] of [['dueño → empleado', 'owner'], ['empleado → dueño', 'empleado']]) {
  test(`C1 cambio de rol (${label}) con sesiones nuevas reales: venta y abono NO salen con el token del otro rol; quedan en revisión, sin borrarse`, async t => {
    const f = await activeCanon(t, { migrations: ROLE_MIGRATIONS }), ls = storage();
    const tokOwner = await newOwnerSession(f), tokEmp = await newEmployeeSession(f, tokOwner);
    const [tokFirst, tokSecond] = firstRole === 'owner' ? [tokOwner, tokEmp] : [tokEmp, tokOwner];
    const rolesFirst = await rolesFor(f, tokFirst), rolesSecond = await rolesFor(f, tokSecond);
    assert.equal(rolesFirst.role, firstRole);
    relogin(ls, tokFirst);
    const A = await device(f, { token: tokFirst, localStorage: ls, scripts, globals: { NA_ROLES: rolesFirst }, onFetch: loseFirst('/commands/payment.create') });
    await assert.rejects(A.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'ID-ROL' }));
    const op = A.api.pendingSnapshot().payload.operation_id;
    const sale = plain(await A.context.NuevoAmanecerCanonicalSaleOutbox.enqueue(saleInput(A, 'id-sale-rol')));
    relogin(ls, tokSecond);
    const B = await device(f, { token: tokSecond, localStorage: ls, scripts, globals: { NA_ROLES: rolesSecond } });
    await B.context.NuevoAmanecerCanonicalSaleOutbox.sync();
    await B.api.resendAfterLogin();
    await assert.rejects(B.api.retryPending(), /CANONICAL_IDENTITY_CHANGED/);
    assert.equal(posts(B, '/commands/payment.create').length, 0, 'nunca con el token del otro rol');
    assert.equal(posts(B, '/commands/sale.create').length, 0);
    assert.equal(payments(f), 0); assert.equal(salesByOp(f, sale.operation_id), 0);
    assert.deepEqual(quarantined(B).map(e => [e.intent.operation_id, e.reason]), [[sale.operation_id, 'identity_changed']]);
    const held = heldList(B);
    assert.equal(held.length, 1); assert.equal(held[0].record.payload.operation_id, op);
  });
}

// ---- C2: pendientes de ANTES de la actualización (sin sello) ----
function stripStamps(ls) {
  ls.removeItem('na_canonical_sale_outbox_v1_identity'); ls.removeItem('na_session_identity_v1');
  const j = ls.getItem(JOURNAL);
  if (j) { const r = JSON.parse(j); delete r.identity; delete r.identity_user; delete r.identity_principal; ls.setItem(JOURNAL, JSON.stringify(r)); }
}

test('C2 legado del MISMO rol (dueño, sin rastro de otro rol): se adopta al primer arranque (adopted_at_upgrade) y se envía normal', async t => {
  const f = await activeCanon(t, { migrations: ROLE_MIGRATIONS }), ls = storage();
  const tok = await newOwnerSession(f), roles = await rolesFor(f, tok);
  let saleDown = true;
  const A = await device(f, { token: tok, localStorage: ls, scripts, globals: { NA_ROLES: roles }, onFetch: loseFirst('/commands/payment.create') });
  await assert.rejects(A.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'ID-C2' }));
  const firstBody = posts(A, '/commands/payment.create')[0].body;
  const sale = plain(await A.context.NuevoAmanecerCanonicalSaleOutbox.enqueue(saleInput(A, 'id-sale-c2')));
  // Como lo dejó la versión anterior: sin sellos ni historial; solo el último rol guardado.
  stripStamps(ls); ls.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner', at: Date.now() }));
  const B = await device(f, { token: tok, localStorage: ls, scripts, globals: { NA_ROLES: roles },
    onFetch: async url => { if (saleDown && new URL(url).pathname === '/commands/sale.create') { saleDown = false; throw new TypeError('fetch failed'); } } });
  await B.context.NuevoAmanecerCanonicalSaleOutbox.sync().catch(() => null);
  const stamp = JSON.parse(ls.getItem('na_canonical_sale_outbox_v1_identity') || '{}');
  const own = Object.values(stamp.entries || stamp).find(x => x && typeof x === 'object' && x.adopted_at_upgrade);
  assert.ok(own, 'marca adopted_at_upgrade en la venta adoptada: ' + JSON.stringify(stamp));
  assert.equal(own.adopted_at_upgrade, JSON.parse(ls.getItem('na_session_identity_v1')).first.at);
  assert.equal((await B.context.NuevoAmanecerCanonicalSaleOutbox.sync()).status, 'DRAINED');
  assert.equal(salesByOp(f, sale.operation_id), 1);
  assert.equal(payments(f), 1);
  assert.equal(posts(B, '/commands/payment.create')[0].body, firstBody);
  assert.equal(quarantined(B).length, 0); assert.equal(heldList(B).length, 0);
  assert.equal(roles.approvals, 0);
});

test('C2 legado SOLO DEL DUEÑO (expense.void) y al actualizar entra un EMPLEADO: queda en revisión, no se envía ni se pierde', async t => {
  const f = await activeCanon(t, { migrations: [...ROLE_MIGRATIONS, '0032_canonical_expense_revisions.sql'] }), ls = storage();
  const tokOwner = await newOwnerSession(f), rolesOwner = await rolesFor(f, tokOwner);
  relogin(ls, tokOwner);
  const A = await device(f, { token: tokOwner, localStorage: ls, scripts, globals: { NA_ROLES: rolesOwner }, onFetch: loseFirst('/commands/expense.void') });
  await A.api.createExpense({ amount_cents: 1000, concept: 'Gasto sintético', category: 'Otro', payment_method: 'yape', expense_date: new Date().toISOString().slice(0, 10), note: '' });
  await A.api.refresh();
  const row = A.api.legacySnapshot().expenses[0];
  await assert.rejects(A.api.voidExpense({ expense_id: row.expenseId, expected_revision: row.revision }));
  const pending = plain(A.api.pendingSnapshot());
  assert.equal(pending.command, 'expense.void');
  stripStamps(ls); ls.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner', at: Date.now() }));
  // Se actualiza la web y el navegador queda vinculado como empleado.
  const tokEmp = await newEmployeeSession(f, tokOwner), rolesEmp = await rolesFor(f, tokEmp);
  relogin(ls, tokEmp); ls.setItem('na_pos_role_v1', JSON.stringify({ role: 'empleado', at: Date.now() }));
  const E = await device(f, { token: tokEmp, localStorage: ls, scripts, globals: { NA_ROLES: rolesEmp } });
  await E.context.NuevoAmanecerCanonicalSaleOutbox.sync().catch(() => null);
  await E.api.retryPending().catch(() => null);
  assert.equal(posts(E, '/commands/expense.void').length, 0, 'no sale con el token del empleado');
  const held = heldList(E);
  assert.equal(held.length, 1, 'visible en revisión');
  assert.equal(held[0].record.payload.operation_id, pending.payload.operation_id);
  assert.equal(JSON.stringify(held[0].record.payload), JSON.stringify(pending.payload), 'cuerpo intacto');
  assert.equal(f.sql('SELECT COUNT(*) n FROM canonical_expense_revisions').n, 0);
});

test('403 forbidden_role NUNCA borra: el comando queda en revisión visible con su cuerpo intacto', async t => {
  const f = await activeCanon(t, { migrations: ROLE_MIGRATIONS }), ls = storage();
  const tok = await newOwnerSession(f), roles = await rolesFor(f, tok);
  let deny = true;
  const A = await device(f, { token: tok, localStorage: ls, scripts, globals: { NA_ROLES: roles },
    onFetch: async url => { if (deny && new URL(url).pathname === '/commands/payment.create') { deny = false; return new Response(JSON.stringify({ error: 'forbidden_role', action: 'payment.create' }), { status: 403, headers: { 'content-type': 'application/json' } }); } } });
  await assert.rejects(A.api.createPayment({ credit_id: 'CR:001', amount_cents: 100, payment_method: 'yape', reference: 'ID-403' }));
  const body = JSON.parse(posts(A, '/commands/payment.create')[0].body);
  const held = heldList(A);
  assert.equal(held.length, 1, 'no se borró: queda en revisión');
  assert.equal(held[0].reason, 'forbidden_role');
  assert.equal(held[0].record.payload.operation_id, body.operation_id);
  assert.match(A.api.describeHeld(held[0]), /no se borró/);
  assert.equal(payments(f), 0);
  // El aparato sigue funcionando (journal libre) y lo retenido sigue ahí.
  await A.api.createPayment({ credit_id: 'CR:001', amount_cents: 50, payment_method: 'yape', reference: 'ID-403-2' });
  assert.equal(payments(f), 1); assert.equal(heldList(A).length, 1);
});

test('P1 rol confirmado de OTRO token (otra pestaña guardó la sesión del empleado): la pestaña del dueño no envía con el token nuevo', async t => {
  const f = await activeCanon(t, { migrations: ROLE_MIGRATIONS }), ls = storage();
  const tokOwner = await newOwnerSession(f), tokEmp = await newEmployeeSession(f, tokOwner);
  const rolesOwner = await rolesFor(f, tokOwner);
  relogin(ls, tokOwner);
  const A = await device(f, { token: tokOwner, localStorage: ls, scripts, globals: { NA_ROLES: rolesOwner } });
  const outbox = A.context.NuevoAmanecerCanonicalSaleOutbox;
  const sale = plain(await outbox.enqueue(saleInput(A, 'id-sale-p1')));
  relogin(ls, tokEmp); // otra pestaña vinculó el empleado; esta pestaña aún cree «dueño confirmado» (para tokOwner)
  await outbox.sync();
  assert.equal(posts(A, '/commands/sale.create').length, 0, 'nada sale con el token del empleado');
  assert.equal(salesByOp(f, sale.operation_id), 0);
  assert.equal(outbox.snapshot().intents.length + quarantined(A).length, 1, 'la venta sigue guardada');
});

test('P5 solo venta en cola y 401: la franja dice «Sesión vencida» (no «reintentando»); tras volver a entrar (sesión nueva, mismo rol) se envía sola y la franja se limpia', async t => {
  const f = await activeCanon(t, { migrations: ROLE_MIGRATIONS }), ls = storage();
  const tokA = await newOwnerSession(f), rolesA = await rolesFor(f, tokA);
  const A = await device(f, { token: tokA, localStorage: ls, scripts, globals: { NA_ROLES: rolesA } });
  const sale = plain(await A.context.NuevoAmanecerCanonicalSaleOutbox.enqueue(saleInput(A, 'id-sale-p5')));
  f.rotateSession(rolesA.sessionPrincipal.replace(/^session:/, ''), 'tok-muerto-p5');
  const r = plain(await A.context.NuevoAmanecerCanonicalSaleOutbox.sync());
  assert.match(String(r.reason), /^SESSION_/);
  const v = banner(A);
  assert.match(v.text, /Sesión vencida/); assert.doesNotMatch(v.text, /reintentando/);
  const tokB = await newOwnerSession(f), rolesB = await rolesFor(f, tokB);
  relogin(ls, tokB);
  const B = await device(f, { token: tokB, localStorage: ls, scripts, globals: { NA_ROLES: rolesB } });
  assert.equal((await B.context.NuevoAmanecerCanonicalSaleOutbox.sync()).status, 'DRAINED');
  assert.equal(salesByOp(f, sale.operation_id), 1);
  assert.equal(banner(B), null);
});
