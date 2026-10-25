import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Carga el módulo con un window mínimo (igual que purchase-op-fingerprint) y toma _findDuplicate.
const root = { document: { getElementById: () => null, querySelector: () => null }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
root.window = root;
vm.runInNewContext(readFileSync(new URL('../../POS/js/config/pos-purchases-client.js', import.meta.url), 'utf8'), { globalThis: root, window: root, ...root });
const find = root.NA_PURCHASES._findDuplicate;

const A = { id: 'p1', supplier: 'Distribuidora Sol', document_ref: 'F001-123' };
const B = { id: 'p2', supplier: 'Mayorista Luna', document_ref: 'F001-999' };

test('mismo proveedor y mismo número: la detecta', () => {
  assert.equal(find([B, A], { supplier: 'Distribuidora Sol', documentRef: 'F001-123' }), A);
});

test('mismo número con otro proveedor: no avisa', () => {
  assert.equal(find([A], { supplier: 'Mayorista Luna', documentRef: 'F001-123' }), null);
});

test('número distinto con el mismo proveedor: no avisa', () => {
  assert.equal(find([A], { supplier: 'Distribuidora Sol', documentRef: 'F001-124' }), null);
});

test('normaliza mayúsculas, espacios, puntos, guiones, barras, guion bajo y tildes', () => {
  for (const ref of ['f001-123', ' F001 123 ', 'F001.123', 'f001/123', 'F001_123', 'F001123']) {
    assert.equal(find([A], { supplier: 'distribuidora  sol', documentRef: ref }), A, ref);
  }
  const tilde = { supplier: 'Panadería Ñandú', document_ref: 'B-1' };
  assert.equal(find([tilde], { supplier: 'PANADERIA ÑANDU', documentRef: 'b1' }), tilde);
});

test('sin proveedor del servidor (empleado) o sin proveedor escrito: compara solo el documento', () => {
  const noSup = { id: 'p3', document_ref: 'F001-123' };
  assert.equal(find([noSup], { supplier: 'Otro', documentRef: 'F001-123' }), noSup);
  assert.equal(find([A], { documentRef: 'F001-123' }), A);
  assert.equal(find([A], { supplier: '', documentRef: 'F001-123' }), A);
  const emptySup = { supplier: '', document_ref: 'F001-123' };
  assert.equal(find([emptySup], { supplier: 'Otro', documentRef: 'F001-123' }), emptySup);
});

test('lista vacía, nula o con basura: null', () => {
  const m = { supplier: 'Distribuidora Sol', documentRef: 'F001-123' };
  assert.equal(find([], m), null);
  assert.equal(find(null, m), null);
  assert.equal(find(undefined, m), null);
  assert.equal(find({ purchases: [A] }, m), null);
  assert.equal(find([null, undefined, {}], m), null);
});

test('documento vacío o solo separadores: nunca avisa', () => {
  const blank = { supplier: 'Distribuidora Sol', document_ref: '' };
  for (const ref of ['', '   ', '-./_', null, undefined]) {
    assert.equal(find([A, blank], { supplier: 'Distribuidora Sol', documentRef: ref }), null, String(ref));
  }
  assert.equal(find([A], null), null);
});

test('devuelve la primera coincidencia de la lista', () => {
  const A2 = { ...A, id: 'p9' };
  assert.equal(find([A, A2], { supplier: 'Distribuidora Sol', documentRef: 'F001-123' }), A);
});

test('ignora compras anuladas o canceladas (estado o bandera) y sigue con la siguiente', () => {
  const meta = { supplier: 'Distribuidora Sol', documentRef: 'F001-123' };
  for (const extra of [{ status: 'anulada' }, { status: 'ANULADO' }, { estado: ' Cancelada ' }, { status: 'cancelled' }, { status: 'canceled' }, { status: 'voided' }, { status: 'void' }, { status: 'annulled' }, { anulado: true }, { anulada: true }, { voided: true }, { cancelled: true }]) {
    assert.equal(find([{ ...A, ...extra }], meta), null, JSON.stringify(extra));
    assert.equal(find([{ ...A, ...extra, id: 'x' }, A], meta), A, JSON.stringify(extra));
  }
});

test('estados reales del Worker y banderas no verdaderas siguen contando', () => {
  const meta = { supplier: 'Distribuidora Sol', documentRef: 'F001-123' };
  for (const extra of [{ status: 'en_curso' }, { status: 'aplicada' }, { status: 'cerrada_parcial' }, { status: 'no anulada' }, { status: 'anulacion_pendiente' }, { anulado: false }, { anulado: 'false' }, { voided: 0 }, { status: null }]) {
    const row = { ...A, ...extra };
    assert.equal(find([row], meta), row, JSON.stringify(extra));
  }
});
