import { test, expect } from '@playwright/test';

// Ticket térmico con montos de 6 cifras y separador de miles (S/ 111,110.00).
const sale = { id: 1, fecha: '2026-10-21', hora: '14:30', items: [{ name: 'Producto prueba', qty: 1, precio: 111110 }], total: 111110, metodo: 'efectivo', recibido: 112345.5, vuelto: 1235.5 };

test.beforeEach(async ({ page }) => {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.goto('/index.html');
});

for (const zones of [true, false]) {
  for (const [mm, cols] of [['50', 24], ['58', 29], ['80', 42]] as const) {
    test(`ticket ${mm} mm (${cols} col, zonas ${zones ? 'sí' : 'no'}): TOTAL, importe, Recibido y Vuelto completos y alineados`, async ({ page }) => {
      const t = await page.evaluate(([mm, zones, sale]) => {
        const w = window as any;
        w.eval(`appConfig.ticket={...(appConfig.ticket||{}),ancho:'${mm}',layoutMode:'auto',paymentAlign:'split'}; _naF11ReceiptZonesEnabled=${zones}`);
        const out = w._naBuildThermalTicket(sale, false);
        return { width: out.width, lines: out.lines as string[] };
      }, [mm, zones, sale] as const);
      expect(t.width).toBe(cols);
      for (const line of t.lines) expect(line.length, line).toBeLessThanOrEqual(cols);
      const compact = cols < 30;
      const labels = compact ? { total: 'TOTAL', rec: 'Rec', vto: 'Vto' } : { total: 'TOTAL A PAGAR', rec: 'Recibido', vto: 'Vuelto' };
      const row = (label: string, amount: string) => {
        const line = t.lines.find(l => l.startsWith(label + ' :'));
        expect(line, label).toBeTruthy();
        expect(line!.endsWith(amount), line).toBe(true); // importe completo, alineado a la derecha
        expect(line!.length).toBe(cols);
      };
      row(labels.total, 'S/ 111,110.00');
      row(labels.rec, 'S/ 112,345.50');
      row(labels.vto, 'S/ 1,235.50');
      // Importe de la línea: nunca recortado (antes salía «1,110.00»).
      const text = t.lines.join('\n');
      expect(text).toMatch(/(^|\s)(S\/ )?111,110\.00$/m);
      expect(text).not.toMatch(/(^|[^\d,])1,110\.00/);
      expect(text).not.toMatch(/(^|[^\d,])0,000\.00/);
    });
  }
}

test('a 32 columnas, TOTAL A PAGAR / Importe / Recibido / Vuelto no se cortan con S/ 111,110.00', async ({ page }) => {
  const lines = await page.evaluate(() => {
    const w = window as any, L = w._naTkLabels(32, 'auto');
    return [[L.total, 'S/ 111,110.00'], [L.amount, 'S/ 111,110.00'], [L.received, 'S/ 112,345.50'], [L.change, 'S/ 1,235.50']]
      .map(([label, value]) => ({ label, line: w._naTkField(label, value, 32, 'split') as string }));
  });
  for (const { label, line } of lines) {
    expect(line.length).toBe(32);
    expect(line.startsWith(label + ' :'), line).toBe(true);
    expect(line).toMatch(/S\/ [\d,]+\.\d\d$/);
  }
});
