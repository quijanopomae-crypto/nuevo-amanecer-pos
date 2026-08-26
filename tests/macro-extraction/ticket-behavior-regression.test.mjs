import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const moduleSource = name => fs.readFileSync(path.join(ROOT, 'POS', 'js', 'modules', 'ticket', name), 'utf8');

test('ticket macro extraction preserves final formatting and override winners', () => {
  const context = vm.createContext({
    appConfig: {
      igvActive: false,
      ticket: {
        ancho: '58mm',
        layoutMode: 'auto',
        pie: 'GRACIAS POR SU COMPRA',
        showLogo: true,
        showNum: true,
        showOperation: true,
        showIGV: false,
        showCurrency: true,
        showUnitPrice: true,
        showPayment: true,
        showReceived: true,
        showSep: true,
      },
      printer: {},
    },
    _naDefaults: { ticket: {} },
    _naSaveTicketSettings() {},
    _naHydrateTicket() {},
    _naGetBusiness: () => ({ nombre: 'NUEVO AMANECER', ruc: '12345678', direccion: 'Huánuco', telefono: '' }),
    obtenerHoy: () => '2026-08-26',
    nowT: () => '10:30',
    totalV: sale => (sale.items || []).reduce((sum, item) => sum + Number(item.qty) * Number(item.precio), 0),
    desglosarIGV: total => ({ subtotal: total / 1.18, igv: total - total / 1.18 }),
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; },
    },
    navigator: { userAgent: '', serial: null },
    console,
  });

  for (const name of ['legacy.js', 'overrides.js', 'zones.js', 'secure-print.js']) {
    new vm.Script(moduleSource(name), { filename: name }).runInContext(context);
  }

  const result = JSON.parse(vm.runInContext(`JSON.stringify(_naBuildThermalTicket({
    id: 'V-42',
    operation: '00000042',
    fecha: '2026-08-26',
    hora: '10:30',
    cajero: 'Eliser',
    metodo: 'efectivo',
    recibido: 20,
    vuelto: 3,
    items: [{ name: 'Arroz superior', qty: 2, precio: 8.5 }]
  }, false))`, context));

  assert.equal(result.width, 29);
  assert.match(result.text, /NUEVO AMANECER/);
  assert.match(result.text, /Arroz superior/);
  assert.match(result.text, /TOTAL\s*:/);
  assert.match(result.text, /EFECTIVO/);
  assert.equal(vm.runInContext("String(_naBuildThermalTicket).includes('_naF11ComposeZones')", context), true);
  assert.equal(vm.runInContext("String(imprimirTicketSistema).includes('replaceChildren')", context), true);
  assert.equal(vm.runInContext('typeof renderTicketPreview', context), 'function');
  assert.equal(vm.runInContext('typeof verTicket', context), 'function');
});
