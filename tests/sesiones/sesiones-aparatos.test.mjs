import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('POS/js/modules/sesiones-aparatos.js', 'utf8');
const permissionsSource = readFileSync('POS/js/config/pos-permissions.js', 'utf8');
function realPermissions() { const c = vm.createContext({ module: { exports: {} } }); vm.runInContext(permissionsSource, c); return c.NA_PERMISSIONS; }
function load(extra = {}) { const c = vm.createContext({ module: { exports: {} }, ...extra }); vm.runInContext(source, c); return c.module.exports; }
const P = realPermissions();
const OPEN = { ...P, featureLocked: id => (id === 'sesion-unica-usuario' ? false : P.featureLocked(id)) };
const owner = { isOwner: () => true };

test('candado sigue cerrado en pos-permissions y la pantalla es solo del dueño', () => {
  assert.equal(P.FEATURE_LOCKS['sesion-unica-usuario'], true);
  assert.equal(P.canAccessScreen('owner', 'pageSesionesAparatos'), true);
  assert.equal(P.canAccessScreen('empleado', 'pageSesionesAparatos'), false);
  assert.equal(P.canAccessScreen('', 'pageSesionesAparatos'), false);
});

test('falla cerrado: candado, permisos y rol', () => {
  assert.equal(load({ NA_PERMISSIONS: P, NA_ROLES: owner }).allowed(), false, 'candado cerrado');
  assert.equal(load({ NA_ROLES: owner }).allowed(), false, 'sin permisos');
  assert.equal(load({ NA_PERMISSIONS: { featureLocked() { throw new Error('x'); } }, NA_ROLES: owner }).allowed(), false);
  assert.equal(load({ NA_PERMISSIONS: OPEN, NA_ROLES: owner }).allowed(), true);
  for (const roles of [undefined, {}, { isOwner: true }, { isOwner: () => 'true' }, { isOwner: () => false }, { isOwner() { throw new Error('x'); } }])
    assert.equal(load({ NA_PERMISSIONS: OPEN, NA_ROLES: roles }).allowed(), false, JSON.stringify(roles));
});

test('normaliza la respuesta de /auth/devices: solo activas, la actual primero', () => {
  const S = load();
  const rows = S.normalize({ devices: [
    { device_id: 'session:a', status: 'active', created_at: '2026-10-01T03:00:00.000Z', last_seen_at: '2026-10-20T10:00:00.000Z', pos_role: 'empleado', label: 'Caja 2', current: false },
    { device_id: 'session:b', status: 'revoked', pos_role: 'empleado', current: false },
    { device_id: 'session:me', status: 'active', created_at: '2026-09-01T12:00:00.000Z', last_seen_at: null, pos_role: 'owner', label: null, current: true },
    { device_id: 'session:c', status: 'active', created_at: 'x', last_seen_at: '2026-10-21T10:00:00.000Z', pos_role: 'raro', label: '', current: 'true' },
    { device_id: 'malo', status: 'active' }, null
  ] });
  assert.deepEqual(rows.map(r => r.id), ['session:me', 'session:c', 'session:a']);
  assert.equal(rows[0].current, true); assert.equal(rows[0].label, 'Aparato del dueño'); assert.equal(rows[0].seen, '—');
  assert.equal(rows[1].current, false); assert.equal(rows[1].role, 'owner');
  assert.equal(rows[2].label, 'Caja 2'); assert.equal(rows[2].since, '30/09/2026 22:00');
  assert.equal(S.normalize(null).length, 0); assert.equal(S.normalize({ devices: 'x' }).length, 0);
});

test('horas en Lima', () => {
  const S = load();
  assert.equal(S.fmtLima('2026-01-01T04:59:00Z'), '31/12/2025 23:59');
  assert.equal(S.fmtLima('2026-10-21 15:00:00'), '21/10/2026 10:00');
  assert.equal(S.fmtLima(''), '—'); assert.equal(S.fmtLima('basura'), '—');
});

test('revoke: nunca el aparato actual, pide confirmación y manda device_id + pin', async () => {
  const calls = []; let confirmAnswer = false;
  const roles = { isOwner: () => true, pinSet: false, api: async (p, b) => { calls.push([p, b]); return p === '/auth/devices' ? { devices: [] } : { status: 'revoked' }; }, message: e => e.message };
  const page = { classList: { contains: () => false }, querySelector: () => null };
  const doc = { readyState: 'complete', getElementById: () => ({ ...page, querySelector: sel => sel === '[data-sa-list]' ? { replaceChildren() {} } : sel === '[data-sa-status]' ? { textContent: '' } : null }), createElement: () => ({ setAttribute() {}, appendChild() {} }) };
  const S = load({ NA_PERMISSIONS: OPEN, NA_ROLES: roles, document: doc, _naConfirmAction: async () => confirmAnswer });
  assert.equal(await S.revoke({ id: 'session:me', label: 'Yo', current: true }), false);
  assert.equal(await S.revoke({ id: 'session:a', label: 'Caja', current: false }), false, 'cancelado');
  assert.deepEqual(calls.filter(c => c[0] === '/auth/devices/revoke'), []);
  confirmAnswer = true;
  assert.equal(await S.revoke({ id: 'session:a', label: 'Caja', current: false }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c => c[0] === '/auth/devices/revoke'))), ['/auth/devices/revoke', { device_id: 'session:a' }]);
  const S2 = load({ NA_PERMISSIONS: P, NA_ROLES: roles, document: doc, _naConfirmAction: async () => true });
  calls.length = 0;
  assert.equal(await S2.revoke({ id: 'session:a', label: 'Caja', current: false }), false, 'candado cerrado');
  assert.equal(calls.length, 0);
});

test('solo textContent y sin almacenamiento propio', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
});
