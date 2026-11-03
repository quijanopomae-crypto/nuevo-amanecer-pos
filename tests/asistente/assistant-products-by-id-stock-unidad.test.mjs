// productsById (lector canónico por id) devuelve a la vez el stock (#983: 409 de stock cambiado en la tarjeta de conteo) y la unidad
// (#997: unidades 037/067). Base SQLite en memoria con filas inventadas; lectura pura (cualquier escritura falla).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { canonicalReader } from '../../tools/cloudflare-lab/src/pos-assistant-queries.js';

function fakeD1(mode) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE canonical_control(id INTEGER PRIMARY KEY, active_promotion_id TEXT, mode TEXT);
    CREATE TABLE products(product_id TEXT, promotion_id TEXT, name TEXT, tracks_inventory INTEGER, current_stock_quantity REAL, unit TEXT);
    CREATE TABLE canonical_live_products(product_id TEXT, promotion_id TEXT, name TEXT, tracks_inventory INTEGER, current_stock_quantity REAL, unit TEXT);
    INSERT INTO canonical_control VALUES(1,'P1','${mode}');
    INSERT INTO products VALUES('1','P1','Arroz Costeño 5kg',1,12,'unidad');
    INSERT INTO products VALUES('2','P1','Azúcar a granel',1,7.5,'kg');
    INSERT INTO products VALUES('3','P1','Bolsa',0,NULL,NULL);
    INSERT INTO canonical_live_products VALUES('4','P1','Queso fresco',1,2.25,'kg');`);
  return { prepare(sql) { const st = db.prepare(sql); let args = [];
    const o = { bind(...a) { args = a; return o; }, async first() { return st.get(...args) ?? null; }, async all() { return { results: st.all(...args) }; }, async run() { throw new Error('escritura prohibida'); } };
    return o; } };
}

for (const mode of ['ACTIVE', 'CANONICAL_READ_ONLY']) {
  test(`productsById (${mode}) devuelve stock y unidad; unidad null si falta`, async () => {
    const m = await canonicalReader(fakeD1(mode)).productsById(['1', '2', '3', '4']);
    assert.deepEqual(m.get('1'), { id: '1', nombre: 'Arroz Costeño 5kg', controla: true, stock: 12, unidad: 'unidad' });
    assert.deepEqual(m.get('2'), { id: '2', nombre: 'Azúcar a granel', controla: true, stock: 7.5, unidad: 'kg' });
    assert.deepEqual(m.get('3'), { id: '3', nombre: 'Bolsa', controla: false, stock: null, unidad: null });
    if (mode === 'ACTIVE') assert.deepEqual(m.get('4'), { id: '4', nombre: 'Queso fresco', controla: true, stock: 2.25, unidad: 'kg' });
    else assert.equal(m.has('4'), false, 'sin promoción activa no se leen los creados en vivo');
  });
}
