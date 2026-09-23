import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lab = join(root, 'laboratorio', 'pos-lab');

const files = {
  menu: 'menu.html',
  'punto-venta': 'punto-venta.html',
  inventario: 'inventario.html',
  clientes: 'clientes.html',
  caja: 'caja.html',
  ventas: 'ventas.html',
  gastos: 'gastos.html',
  configuracion: 'configuracion.html'
};

test('index LAB se reconstruye exactamente desde secciones', () => {
  let generated = readFileSync(join(lab, 'index.template.html'), 'utf8');
  for (const [key, file] of Object.entries(files)) {
    const marker = `<!-- @LAB_SECTION:${key} -->`;
    assert.equal(generated.split(marker).length - 1, 1, 'marker ' + key);
    const section = readFileSync(join(lab, 'sections', file), 'utf8').replace(/\n$/, '');
    generated = generated.replace(marker, section);
  }
  assert.equal(generated, readFileSync(join(lab, 'index.html'), 'utf8'));
});

test('secciones LAB conservan sus DOM IDs canónicos', () => {
  const expected = {
    menu: 'pageMenu',
    'punto-venta': 'pagePOS',
    inventario: 'pageInventario',
    clientes: 'pageClientes',
    caja: 'pageCaja',
    ventas: 'pageVentas',
    gastos: 'pageGastos',
    configuracion: 'pageConfig'
  };
  for (const [key,id] of Object.entries(expected)) {
    const section=readFileSync(join(lab,'sections',files[key]),'utf8');
    assert.match(section,new RegExp('id="' + id + '"'));
  }
});
