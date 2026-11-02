// M-1 (A2, fase 0): la clave de las lecciones del día debe caber en pos_settings.key (CHECK length BETWEEN 1 AND 60, migración 0024).
// Antes: 'internal:asst:taught:' + 40 hex = 61 caracteres -> el INSERT fallaba y saveLesson lo tragaba en silencio.
// SQLite real en memoria (node:sqlite, sin dependencias) con la tabla pos_settings REAL creada desde la migración 0024.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lessonsKey, readLessons, saveLesson, reserveUsage, createSettingsUsageStore, LESSONS_PREFIX, USAGE_PREFIX } from '../../tools/cloudflare-lab/src/pos-assistant.js';
import { levelKey } from '../../tools/cloudflare-lab/src/pos-assistant-access.js';
import { PROVIDER_CHOICE_KEY } from '../../tools/cloudflare-lab/src/pos-assistant-providers.js';
import { sha256Hex } from '../../tools/cloudflare-lab/src/a5-import-core.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* Node < 22.5 */ }
const MAX_KEY = 60;
const IDS = ['dev-1', 'session:dueno', 'x'.repeat(300), '', undefined, 'ñandú-ß-✓', 'a'.repeat(64), 'cc'];
const skip = !DatabaseSync && 'node:sqlite no disponible (Node 22.5+)';

// Réplica mínima de D1 sobre node:sqlite (prepare/bind/first/run): la misma forma que usa createSettingsUsageStore.
function d1(db) {
  return { prepare(sql) { const st = db.prepare(sql); let args = []; const o = {
    bind(...a) { args = a; return o; },
    async first() { return st.get(...args) ?? null; },
    async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
}
function realDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../infra/database/migrations/0024_pos_roles_owner_pin.sql', import.meta.url), 'utf8'));
  return db;
}
const keysOf = (db) => db.prepare('SELECT key FROM pos_settings ORDER BY key').all().map((r) => r.key);

test('lessonsKey: 53 caracteres (≤ 60 de pos_settings) para cualquier aparato, con el prefijo de siempre', async () => {
  const seen = new Set();
  for (const principalId of IDS) {
    const k = await lessonsKey({ principalId });
    assert.ok(k.startsWith(LESSONS_PREFIX) && LESSONS_PREFIX === USAGE_PREFIX + 'taught:', k);
    assert.equal(k.length, 53, k);
    assert.match(k.slice(LESSONS_PREFIX.length), /^[0-9a-f]{32}$/);
    seen.add(k);
  }
  assert.equal(await lessonsKey(null), await lessonsKey({ principalId: undefined }));
  assert.ok(seen.size >= IDS.length - 2, 'aparatos distintos -> claves distintas');
});

test('(1) SQLite real: la clave vieja (61) es rechazada; la nueva guarda y readLessons la relee', { skip }, async () => {
  const db = realDb(), store = createSettingsUsageStore(d1(db)), auth = { principalId: 'dev-1' }, now = Date.parse('2026-10-26T15:00:00Z');
  const legacy = LESSONS_PREFIX + (await sha256Hex('dev-1')).slice(0, 40); // lo que producía el código anterior
  assert.equal(legacy.length, 61);
  await assert.rejects(store.put(legacy, { d: '2026-10-26', items: ['x'] }, 0), /CHECK|constraint/i);
  assert.equal(await saveLesson(store, auth, now, 'la caja de gaseosa trae 12', [], []), true);
  const rows = db.prepare("SELECT key FROM pos_settings WHERE key LIKE 'internal:asst:taught:%'").all();
  assert.equal(rows.length, 1); assert.equal(rows[0].key, await lessonsKey(auth)); assert.ok(rows[0].key.length <= MAX_KEY);
  assert.deepEqual(await readLessons(store, auth, now), ['la caja de gaseosa trae 12']);
  assert.equal(await saveLesson(store, auth, now, 'el arroz trae 24 paquetes', [], []), true); // misma fila (revisión optimista)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pos_settings WHERE key LIKE 'internal:asst:taught:%'").get().n, 1);
  assert.equal((await readLessons(store, auth, now)).length, 2);
  assert.deepEqual(await readLessons(store, auth, now + 36 * 3600 * 1000), []);
  assert.deepEqual(await readLessons(store, { principalId: 'otro' }, now), []);
});

test('(2) todas las claves internal:* que escribe el asistente miden ≤ 60 en la tabla real', { skip }, async () => {
  const db = realDb(), store = createSettingsUsageStore(d1(db)), now = Date.parse('2026-10-26T15:00:00Z');
  for (const principalId of IDS) {
    const auth = { principalId };
    assert.equal(await saveLesson(store, auth, now, 'la caja de gaseosa trae 12', [], []), true);
    assert.deepEqual((await reserveUsage(store, auth, {}, now, false)).ok, true); // deviceKey (hash 40) + month
  }
  // claves de tarjeta usada (u:<24 hex>) y tope por minuto (w:<24 hex>) con su forma real
  const tokN = 'f'.repeat(24), tokD = (await sha256Hex('dev-1')).slice(0, 24);
  await store.put(USAGE_PREFIX + 'u:' + tokN, { op: 'AST-x' }, 0); await store.put(USAGE_PREFIX + 'w:' + tokD, { min: 1, n: 1 }, 0);
  await store.put(await levelKey('dev-1'), { level: 'off' }, 0);
  await store.put(PROVIDER_CHOICE_KEY, { id: 'x' }, 0);
  // prefijos con hash de 32 (provtest, provop, odev) en su peor caso
  for (const pre of ['internal:asst:provtest:', 'internal:asst:provop:', 'internal:asst:odev:']) await store.put(pre + 'f'.repeat(32), { x: 1 }, 0);
  const keys = keysOf(db);
  assert.ok(keys.length >= IDS.length + 7, keys.join('\n'));
  for (const k of keys) { assert.ok(k.startsWith('internal:'), k); assert.ok(k.length <= MAX_KEY, k.length + ' ' + k); }
});

test('(3) saveLesson ya no falla en silencio: avisa con tipo y código, sin claves ni datos', { skip }, async () => {
  const db = realDb(), auth = { principalId: 'dev-1' }, warns = [], orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    // tabla real con el CHECK, pero un store que reproduce la clave vieja de 61 caracteres
    const real = createSettingsUsageStore(d1(db)), legacy = LESSONS_PREFIX + (await sha256Hex('dev-1')).slice(0, 40);
    const store = { get: (k) => real.get(legacy), put: (k, v, r) => real.put(legacy, v, r) };
    assert.equal(await saveLesson(store, auth, Date.parse('2026-10-26T15:00:00Z'), 'la caja de gaseosa trae 12', [], []), false);
    assert.equal(warns.length, 1, warns.join('|'));
    assert.match(warns[0], /no se pudo guardar la lección/); assert.match(warns[0], /CHECK constraint failed/);
    assert.ok(!/internal:|gaseosa|dev-1/.test(warns[0]), warns[0]);
    // lección vacía/saneada a nada: false sin aviso (no es un fallo de escritura)
    warns.length = 0; assert.equal(await saveLesson(real, auth, 0, '', [], []), false); assert.equal(warns.length, 0);
  } finally { console.warn = orig; }
});
