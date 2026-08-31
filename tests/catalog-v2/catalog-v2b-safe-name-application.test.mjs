// CATALOG V2B — aplicación segura de los 3 nombres aprobados por el owner.
// El contrato es fail-closed por id + expectedCurrentName y solo cambia product.name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPosSandbox, json } from './lib/sandbox.mjs';

const APPROVED = [
  { id: 133, expectedCurrentName: 'GOMITAS TRULULU SABORES 90 GR', canonicalName: 'TRULULU SABORES 90GR' },
  { id: 136, expectedCurrentName: 'GOMITAS TRULULU GUSANOS ÁCIDOS 80 GR', canonicalName: 'TRULULU GUSANOS ACIDOS 80GR' },
  { id: 137, expectedCurrentName: 'GOMAS TRULULU DINOSS 90G*', canonicalName: 'TRULULU DINOS 90GR' },
];

const byId = new Map(APPROVED.map((entry) => [String(entry.id), entry]));
const withoutName = ({ name, ...rest }) => rest;

function settleV1Baseline(sb) {
  sb.run(`
    _naNormalizeData();
    productos=productos.map(p=>p&&typeof p.name==='string'?{...p,name:_naNormCatalogName(p.name)}:p);
  `);
}

function richProduct(entry, index) {
  return {
    id: entry.id,
    name: entry.expectedCurrentName,
    descripcion: `Producto de prueba ${entry.id}`,
    sku: `SAFE-${entry.id}`,
    barcode: `7750000000${index + 1}`,
    codigosAlternativos: [`ALT-${entry.id}`],
    codigoAlternativo: `ALT-${entry.id}`,
    cat: 'snacks',
    icon: '🍬',
    imagen: null,
    costo: 1.54 + index,
    precio: 2.5 + index,
    precioCaja: 30 + index,
    unidCaja: 12,
    stock: 10 + index,
    stockMin: 2,
    venc: '2027-12-31',
    marca: 'Trululu',
    unidad: 'unidad',
    unidadCompra: 'caja',
    factorCompra: 12,
    incluyeIGV: index !== 1,
    tipoImpuesto: index === 1 ? 'exonerado' : 'gravado',
    impuestoComplementario: '',
    controlInventario: true,
  };
}

test('SAFE_ALLOWLIST — aplica exactamente los 3 pares id + expectedCurrentName', () => {
  const sb = createPosSandbox();
  assert.deepEqual(json(sb, 'Object.keys(_NA_CATALOG_V2B_SAFE_NAMES).sort()'), ['133', '136', '137']);
  for (const entry of APPROVED) {
    assert.equal(
      sb.run(`_naCatalogV2BSafeName(${entry.id},${JSON.stringify(entry.expectedCurrentName)})`),
      entry.canonicalName,
      `ID ${entry.id}`
    );
  }
});

test('FAIL_CLOSED — nombre inesperado, id incorrecto y canónico son no-op', () => {
  const sb = createPosSandbox();
  assert.equal(sb.run("_naCatalogV2BSafeName(133,'NOMBRE MANUAL VERIFICADO')"), 'NOMBRE MANUAL VERIFICADO');
  assert.equal(sb.run("_naCatalogV2BSafeName(133,'  gomitas trululu sabores 90 gr  ')"), '  gomitas trululu sabores 90 gr  ');
  assert.equal(sb.run("_naCatalogV2BSafeName(999,'GOMITAS TRULULU SABORES 90 GR')"), 'GOMITAS TRULULU SABORES 90 GR');
  assert.equal(sb.run("_naCatalogV2BSafeName(133,'TRULULU SABORES 90GR')"), 'TRULULU SABORES 90GR');

  sb.seed();
  sb.seedData('productos', [richProduct({ ...APPROVED[0], expectedCurrentName: '  gomitas trululu sabores 90 gr  ' }, 0)]);
  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  assert.equal(json(sb, 'productos[0].name'), 'gomitas trululu sabores 90 gr', 'el trim base puede operar, pero V2B no lo convierte en canónico');
  const once = sb.memoryState();
  sb.run('_naNormalizeData()');
  assert.deepEqual(sb.memoryState(), once, 'el mismatch sigue fail-closed en pasadas posteriores');
});

test('FRESH_SEED — el arranque real normaliza los 408 productos y aplica los 3 nombres', async () => {
  const sb = createPosSandbox();
  sb.run('_naInstallCatalogNameNorm()');
  await sb.run('loadAllData()');
  assert.equal(json(sb, 'productos.length'), 408);
  for (const entry of APPROVED) {
    assert.equal(
      sb.run(`productos.find(p=>String(p.id)===${JSON.stringify(String(entry.id))}).name`),
      entry.canonicalName,
      `seed ID ${entry.id}`
    );
  }
});

test('PERSISTED_SNAPSHOT — loadAllData aplica V2B después de recuperar el snapshot V9', async () => {
  const sb = createPosSandbox();
  sb.seed();
  sb.seedData('productos', APPROVED.map(richProduct));
  sb.seedData('ventas', [{
    id: 'V-SAFE-1', fecha: '2026-08-30', timestamp: '2026-08-30T10:00:00.000Z',
    total: 5, metodo: 'efectivo', items: [{ id: 133, productoId: 133, name: 'NOMBRE HISTÓRICO', nombre: 'NOMBRE HISTÓRICO', qty: 2, cantidad: 2, precio: 2.5, precioUnitario: 2.5, subtotal: 5 }],
  }]);
  sb.seedData('inventoryMovements', [{
    id: 'IM-SAFE-1', productId: 133, type: 'ENTRADA', before: 0, delta: 10, after: 10,
    reason: 'carga inicial', source: 'INVENTORY_MOVE', referenceId: null,
    timestamp: '2026-08-30T09:00:00.000Z', fecha: '2026-08-30',
  }]);
  sb.run('_naNormalizeData()');
  const before = sb.memoryState();
  const persisted = json(sb, '_naBuildSnapshot()');
  sb.stores.localStorage.setItem('na_snapshot_v9', JSON.stringify(persisted));

  sb.seed();
  sb.run('_naInstallCatalogNameNorm()');
  await sb.run('loadAllData()');
  const after = sb.memoryState();

  for (const entry of APPROVED) {
    assert.equal(after.productos.find((p) => String(p.id) === String(entry.id)).name, entry.canonicalName);
  }
  assert.deepEqual(after.ventas, before.ventas, 'historial persistido intacto');
  assert.deepEqual(after.inventoryMovements, before.inventoryMovements, 'ledger persistido intacto');
  for (let i = 0; i < before.productos.length; i++) {
    assert.deepEqual(withoutName(after.productos[i]), withoutName(before.productos[i]), `ID ${before.productos[i].id}: solo name puede cambiar`);
  }
});

test('INTEGRITY_408 — cambian 3 names; los otros 405 productos quedan deep-equal', () => {
  const sb = createPosSandbox();
  settleV1Baseline(sb);
  const before = sb.memoryState();
  assert.equal(before.productos.length, 408);
  for (const entry of APPROVED) {
    assert.equal(before.productos.find((p) => String(p.id) === String(entry.id)).name, entry.expectedCurrentName, `before ID ${entry.id}`);
  }

  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  const after = sb.memoryState();
  const changed = after.productos.filter((product, index) => product.name !== before.productos[index].name);
  assert.deepEqual(changed.map((p) => p.id), [133, 136, 137]);
  assert.equal(changed.length, 3);

  let unchanged = 0;
  for (let i = 0; i < before.productos.length; i++) {
    const prior = before.productos[i];
    const current = after.productos[i];
    const approved = byId.get(String(prior.id));
    assert.equal(current.id, prior.id, `ID estable en índice ${i}`);
    if (approved) {
      assert.equal(current.name, approved.canonicalName, `after ID ${prior.id}`);
      assert.deepEqual(withoutName(current), withoutName(prior), `ID ${prior.id}: solo name difiere`);
    } else {
      assert.deepEqual(current, prior, `ID ${prior.id}: producto completo intacto`);
      unchanged++;
    }
  }
  assert.equal(unchanged, 405);
  assert.deepEqual(after.ventas, before.ventas, 'historial y sus items intactos');
  assert.deepEqual(after.inventoryMovements, before.inventoryMovements, 'ledger intacto');
  assert.deepEqual(after.clientes, before.clientes, 'clientes intactos');
  assert.deepEqual(after.creditos, before.creditos, 'créditos intactos');
  assert.deepEqual(after.gastos, before.gastos, 'gastos intactos');
  assert.deepEqual(after.cajMovs, before.cajMovs, 'caja intacta');
  assert.deepEqual(after.cashClosures, before.cashClosures, 'cierres intactos');
});

test('FIELDS_UNCHANGED — códigos, stock, precio/costo e impuestos permanecen byte-equivalentes', () => {
  const sb = createPosSandbox();
  settleV1Baseline(sb);
  const before = sb.memoryState().productos;
  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  const after = sb.memoryState().productos;
  const protectedFields = [
    'id', 'sku', 'barcode', 'codigosAlternativos', 'codigoAlternativo',
    'stock', 'stockMin', 'precio', 'costo', 'precioCaja',
    'unidad', 'unidadCompra', 'factorCompra', 'marca', 'cat', 'venc',
    'incluyeIGV', 'tipoImpuesto', 'impuestoComplementario',
  ];
  for (const field of protectedFields) {
    assert.deepEqual(after.map((p) => p[field]), before.map((p) => p[field]), field);
  }
});

test('IDEMPOTENT — la segunda pasada completa es no-op', () => {
  const sb = createPosSandbox();
  sb.run('_naInstallCatalogNameNorm();_naNormalizeData();');
  const once = sb.memoryState();
  sb.run('_naNormalizeData()');
  assert.deepEqual(sb.memoryState(), once);
});
