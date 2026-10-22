import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { settlePersistence } from './helpers/persistence';

// Rasterizado por CPU: con raster por GPU el antialias de un ícono en media fila de píxel (y=11.5) varía entre cargas
// de la MISMA página; así la comparación byte a byte de Venta/Inicio solo puede fallar por un cambio real.
test.use({ launchOptions: { args: ['--disable-gpu', '--disable-gpu-rasterization', '--disable-partial-raster', '--force-color-profile=srgb'] } });

// Sufijo para distinguir vendedores con el mismo nombre (NA_SELLER_LABELS, POS/js/core/seller-labels.js).
// Solo datos sintéticos locales; ningún Pagar/Guardar/Cobrar ni backend real.
async function localPage(page: Page, opts: { withoutLabels?: boolean } = {}) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (opts.withoutLabels && url.pathname.endsWith('/js/core/seller-labels.js')) return route.abort();
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.waitForFunction(() => (window as any).NA_ROLES?.isOwner() && typeof (window as any).goPage === 'function');
}
// Igual que los demás specs de reportes del dueño: rol simulado en un host ficticio.
async function ownerPage(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(
      url.pathname === '/auth/me' ? { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'vmn-test-device' } : {}) });
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'vmn-synthetic' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed);
}
// Dos «Ana» (CAJ-001, CAJ-002) y un «Luis» único. Como si vinieran de un respaldo/otro aparato: el alta normal no deja repetir nombres.
async function seed(page: Page, { openCash = false } = {}) {
  await page.evaluate(openCash => {
    (0, eval)(`
      appConfig.cashiers=[{id:'CAJ-001',nombre:'Ana',activo:true},{id:'CAJ-002',nombre:'Ana',activo:true},{id:'CAJ-003',nombre:'Luis',activo:true}];
      appConfig.activeCashierId='CAJ-002';appConfig.business=Object.assign({},appConfig.business,{cajero:'Ana'});
      productos=[{id:9101,name:'PRODUCTO VMN',cat:'farmacia',costo:1,stock:50,precio:5}];
      clientes=[{id:'vmn-c1',nombre:'Cliente vmn',dni:'00000011'}];
      ventas=[
        {id:'V-vmn-a1',fecha:NALimaTime.today(),hora:'10:00',hora24:'10:00',timestamp:new Date(NALimaTime.today()+'T10:00:00-05:00').toISOString(),total:10,metodo:'efectivo',clienteId:'vmn-c1',cajeroId:'CAJ-001',cajeroNombre:'Ana',items:[{id:9101,name:'PRODUCTO VMN',precio:10,qty:1,costo:1}]},
        {id:'V-vmn-a2',fecha:NALimaTime.today(),hora:'10:05',hora24:'10:05',timestamp:new Date(NALimaTime.today()+'T10:05:00-05:00').toISOString(),total:5,metodo:'yape',clienteId:'vmn-c1',cajeroId:'CAJ-002',cajeroNombre:'Ana',items:[{id:9101,name:'PRODUCTO VMN',precio:5,qty:1,costo:1}]},
        {id:'V-vmn-a3',fecha:NALimaTime.today(),hora:'10:06',hora24:'10:06',timestamp:new Date(NALimaTime.today()+'T10:06:00-05:00').toISOString(),total:7,metodo:'efectivo',clienteId:'vmn-c1',cajeroId:'CAJ-002',cajeroNombre:'Ana',items:[{id:9101,name:'PRODUCTO VMN',precio:7,qty:1,costo:1}]},
        {id:'V-vmn-l1',fecha:NALimaTime.today(),hora:'10:10',hora24:'10:10',timestamp:new Date(NALimaTime.today()+'T10:10:00-05:00').toISOString(),total:3,metodo:'efectivo',clienteId:'vmn-c1',cajeroId:'CAJ-003',cajeroNombre:'Luis',items:[{id:9101,name:'PRODUCTO VMN',precio:3,qty:1,costo:1}]}];
      gastos=[];creditos=[];cajMovs=[];
      cashClosures=[{id:'C-vmn-1',sessionId:'S-vmn-1',fechaApertura:NALimaTime.today(),hora24:'08:00',fechaCierre:NALimaTime.today(),horaCierre24:'09:00',cajeroId:'CAJ-001',cajeroNombre:'Ana',fondo:0,esperado:0,contado:0,diferencia:0},
        {id:'C-vmn-2',sessionId:'S-vmn-2',fechaApertura:NALimaTime.today(),hora24:'09:30',fechaCierre:NALimaTime.today(),horaCierre24:'09:45',cajeroId:'CAJ-003',cajeroNombre:'Luis',fondo:0,esperado:0,contado:0,diferencia:0}];
      if(${openCash})cajEstado=Object.assign({},cajEstado,{abierta:true,cerrada:false,fondo:50,cajero:'Ana',cajeroNombre:'Ana',cajeroId:'CAJ-002',hora:'08:00',hora24:'08:00',fechaApertura:obtenerHoy(),sessionId:'S-vmn-open'});
    `);
  }, openCash);
}
async function reportRows(page: Page) {
  return page.evaluate(() => {
    const section = [...document.querySelectorAll('#ventasContent .report-section')].find(s => (s.textContent || '').includes('Ventas por cajero'));
    return section ? [...section.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(td => (td.textContent || '').trim())) : null;
  });
}
async function openReports(page: Page) {
  await page.evaluate(() => (window as any).goPage('pageVentas'));
  await page.locator('#pageVentas .tab').filter({ hasText: 'Reportes' }).click();
  await page.locator('#salesReportPeriod').selectOption('today');
}
const EXPECTED_REPORT = [
  ['Ana · CAJ-002', '2', 'S/ 12.00', '2'],
  ['Ana · CAJ-001', '1', 'S/ 10.00', '1'],
  ['Luis', '1', 'S/ 3.00', '1'],
];

for (const width of [390, 1366]) test(`${width}px: Reportes por cajero separa a las dos «Ana» con totales propios; Luis sin sufijo`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await localPage(page); await seed(page);
  await openReports(page);
  await expect.poll(() => reportRows(page), { message: 'Ventas por cajero' }).toEqual(EXPECTED_REPORT);
  // Exportación: misma etiqueta que la tabla.
  const exported = await page.evaluate(() => { const w = window as any, today = w.NALimaTime.today(); return w._naF8ExportRows(w._naF8BuildReport({ from: today, to: today })).Cajeros.map((r: any) => r.Cajero); });
  expect(exported).toEqual(['Ana · CAJ-002', 'Ana · CAJ-001', 'Luis']);
});

test('ticket y caja: la «Ana» del comprobante y del turno abierto lleva su id; Luis queda igual', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await localPage(page); await seed(page, { openCash: true });
  const ticketCashier = (saleId: string) => page.evaluate(id => {
    (0, eval)(`tkCurrentVenta=ventas.find(v=>v.id===${JSON.stringify(id)})`);
    return ((window as any)._naCrearTicketTexto() as string).split('\n').filter(line => /Cajero/i.test(line)).map(line => line.replace(/\s+/g, ' ').trim());
  }, saleId);
  await expect.poll(() => ticketCashier('V-vmn-a1')).toEqual([expect.stringMatching(/Cajero: Ana\W+CAJ-001$/)]);
  await expect.poll(() => ticketCashier('V-vmn-a2')).toEqual([expect.stringMatching(/Cajero: Ana\W+CAJ-002$/)]);
  await expect.poll(() => ticketCashier('V-vmn-l1')).toEqual(['Cajero: Luis']);
  await page.evaluate(() => (window as any).goPage('pageCaja'));
  await expect(page.locator('#pageCaja')).toContainText('Cajero: Ana · CAJ-002');
  // Historial de cierres local: «Abrió» distingue a Ana; Luis sin sufijo.
  await page.evaluate(() => { (window as any).NuevoAmanecerCanonical = Object.assign({}, (window as any).NuevoAmanecerCanonical, { enabled: () => false }); });
  await page.locator('#pageCaja .tab').filter({ hasText: 'Movimientos' }).click();
  await page.locator('[data-na-cash-history-tab]').click();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect.poll(() => page.locator('.na-cash-hist-card .cv-close-toggle').evaluateAll(nodes => nodes.map(n => (n.textContent || '').replace(/\s+/g, ' '))))
    .toEqual([expect.stringContaining('AbrióLuisCerró'), expect.stringContaining('AbrióAna · CAJ-001Cerró')]);
});

// Comprobante compartido (WhatsApp texto/imagen/PDF, CANON_WHATSAPP_RECEIPTS): sale del mismo generador que el ticket
// impreso pero NO lleva sufijo; debe ser idéntico al de la base (página sin seller-labels.js).
const SHARED_IDS = ['V-vmn-a1', 'V-vmn-a2', 'V-vmn-l1'];
async function sharedReceipts(page: Page) {
  return page.evaluate(async ids => {
    const w = window as any, list = (0, eval)('ventas') as any[], out: Record<string, any> = {};
    for (const id of ids) {
      // Copia fija de la venta sembrada: la app normaliza «hora24» en segundo plano y no debe volver inestable la comparación.
      const seeded = list.find(v => v.id === id), sale = { ...JSON.parse(JSON.stringify(seeded)), hora: '10:00', hora24: '10:00' }, receipt = w.NAReceiptShare.build({ kind: 'sale', sale, customer: { nombre: 'Cliente vmn', tel: '987654321' } });
      const pdf = await w.NAReceiptShare.fileFor(receipt, 'pdf'), bytes = new Uint8Array(await pdf.arrayBuffer());
      out[id] = { lines: receipt.lines, text: receipt.text, whatsapp: w.NAReceiptShare.whatsappText(receipt), pdf: Array.from(bytes).join(',') };
    }
    return out;
  }, SHARED_IDS);
}
test('comprobante compartido: sin sufijo e idéntico a la base; el ticket impreso de la misma venta sí lo lleva', async ({ browser }) => {
  const run = async (withoutLabels: boolean) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.clock.setFixedTime(new Date('2026-10-20T15:00:00-05:00'));
    await localPage(page, { withoutLabels }); await seed(page);
    const shared = await sharedReceipts(page);
    const printed = await page.evaluate(() => { (0, eval)(`tkCurrentVenta=ventas.find(v=>v.id==='V-vmn-a1')`); return ((window as any)._naCrearTicketTexto() as string).split('\n').filter(l => /Cajero/i.test(l)).map(l => l.replace(/\s+/g, ' ').trim()); });
    await page.close(); return { shared, printed };
  };
  const head = await run(false), base = await run(true);
  for (const id of SHARED_IDS) {
    const cashier = head.shared[id].lines.filter((l: string) => /Cajero/i.test(l)).map((l: string) => l.replace(/\s+/g, ' ').trim());
    expect(cashier, id).toEqual([id === 'V-vmn-l1' ? 'Cajero: Luis' : 'Cajero: Ana']);
    expect(head.shared[id].whatsapp, id).not.toContain(' · ');
    expect(head.shared[id], `${id}: igual a la base`).toEqual(base.shared[id]);
  }
  expect(head.printed).toEqual([expect.stringMatching(/Cajero: Ana\W+CAJ-001$/)]);
  expect(base.printed).toEqual(['Cajero: Ana']);
});

test('venta antigua sin nombre ni id: el ticket cae al cajero activo sin sufijo (generador de zonas y legacy)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await localPage(page); await seed(page);
  const cashierLines = await page.evaluate(async () => {
    const src = await (await fetch('/js/modules/ticket/legacy.js')).text();
    const start = src.indexOf('function _naBuildThermalTicket('), end = src.indexOf('\nfunction _baseRenderTicketPreview');
    (0, eval)(src.slice(start, end).replace('function _naBuildThermalTicket(', 'function _vmnLegacyBuild('));
    const w = window as any, pick = (text: string) => text.split('\n').filter(l => /Cajero/i.test(l)).map(l => l.replace(/\s+/g, ' ').trim());
    const old = { id: 'V-vmn-old', fecha: w.NALimaTime.today(), hora: '09:00', metodo: 'efectivo', items: [{ name: 'PRODUCTO VMN', precio: 5, qty: 1 }] };
    const a1 = (0, eval)('ventas').find((v: any) => v.id === 'V-vmn-a1');
    return {
      zonesOld: pick(w._naBuildThermalTicket(old, false).text), legacyOld: pick(w._vmnLegacyBuild(old, false).text),
      legacyPrinted: pick(w._vmnLegacyBuild(a1, false).text), legacyShared: pick(w._vmnLegacyBuild({ ...a1, _naReceiptContext: { kind: 'sale' } }, false).text),
    };
  });
  expect(cashierLines.zonesOld).toEqual(['Cajero: Ana']);
  expect(cashierLines.legacyOld).toEqual(['Cajero: Ana']);
  expect(cashierLines.legacyPrinted).toEqual([expect.stringMatching(/Cajero: Ana\W+CAJ-001$/)]);
  expect(cashierLines.legacyShared).toEqual(['Cajero: Ana']);
});

test('Historial del cliente: el filtro Vendedor muestra dos «Ana» distintas y cada una filtra sus ventas', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await ownerPage(page); await seed(page);
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  await page.locator('#pageProximamente [data-feature-id="cliente-historial-compras"]').click();
  const screen = page.locator('#pageClienteHistorial');
  await screen.getByRole('searchbox', { name: 'Buscar por nombre o DNI' }).fill('00000011');
  await screen.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption('vmn-c1');
  const seller = screen.getByRole('combobox', { name: 'Vendedor' });
  await expect.poll(() => seller.locator('option').allTextContents()).toEqual(['Todos', 'Ana · CAJ-001', 'Ana · CAJ-002', 'Luis']);
  await seller.selectOption({ label: 'Ana · CAJ-002' });
  await expect(screen.locator('[data-ch-table="sales"] tbody tr')).toHaveCount(2);
  await seller.selectOption({ label: 'Ana · CAJ-001' });
  await expect(screen.locator('[data-ch-table="sales"] tbody tr')).toHaveCount(1);
});

// Select «Vendedor» angosto (768/900 px): con dos «María Fernanda Quispe» de ids largos, el texto visible acorta el
// NOMBRE (nunca el id) para que el sufijo se vea dentro del select cerrado; la etiqueta completa queda en el title.
// Sin Intl.Segmenter (navegadores viejos): el corte cae a Array.from y el filtro funciona igual.
// «fuente ancha»: solo en la prueba, el select a 15 px imita una fuente de CI más ancha (#837: 128 px de 125); el corte
// se mide con la fuente real, así que igual entra.
for (const [width, noSegmenter, wideFont] of [[768, false, false], [900, false, false], [768, true, false], [768, false, true]] as const) test(`${width}px${noSegmenter ? ' sin Intl.Segmenter' : ''}${wideFont ? ' fuente ancha' : ''}: Historial del cliente, nombre largo repetido: el sufijo cabe en el select cerrado y cada una filtra`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  if (noSegmenter) await page.addInitScript(() => { delete (Intl as any).Segmenter; });
  await ownerPage(page); await seed(page);
  expect(await page.evaluate(() => typeof (Intl as any).Segmenter)).toBe(noSegmenter ? 'undefined' : 'function');
  if (wideFont) await page.addStyleTag({ content: '#pageClienteHistorial [data-ch-seller]{font-size:15px}' });
  const IDS = ['a1b2c3d4-0000-4000-8000-000000000001', 'a1b2d5e6-0000-4000-8000-000000000002'];
  await page.evaluate(ids => (0, eval)(`
    ventas.push({id:'V-vmn-mfx',fecha:NALimaTime.today(),hora:'11:05',hora24:'11:05',timestamp:new Date(NALimaTime.today()+'T11:05:00-05:00').toISOString(),total:9,metodo:'efectivo',clienteId:'vmn-c1',cajeroNombre:'María Fernanda Quispe',items:[{id:9101,name:'PRODUCTO VMN',precio:9,qty:1,costo:1}]});
    ventas.push(...${JSON.stringify(ids)}.map((id,i)=>({id:'V-vmn-mf'+i,fecha:NALimaTime.today(),hora:'11:0'+i,hora24:'11:0'+i,timestamp:new Date(NALimaTime.today()+'T11:0'+i+':00-05:00').toISOString(),total:4+i,metodo:'efectivo',clienteId:'vmn-c1',cajeroId:id,cajeroNombre:'María Fernanda Quispe',items:[{id:9101,name:'PRODUCTO VMN',precio:4+i,qty:1,costo:1}]})));
  `), IDS);
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  await page.locator('#pageProximamente [data-feature-id="cliente-historial-compras"]').click();
  const screen = page.locator('#pageClienteHistorial');
  await screen.getByRole('searchbox', { name: 'Buscar por nombre o DNI' }).fill('00000011');
  await screen.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption('vmn-c1');
  const seller = screen.getByRole('combobox', { name: 'Vendedor' });
  await expect.poll(() => seller.locator('option').count()).toBe(7);
  // Dos ids largos y una venta antigua solo con el nombre: « (sin id)» también se conserva entero.
  for (const [value, short] of [['id:' + IDS[0], ' · a1b2c'], ['id:' + IDS[1], ' · a1b2d'], ['name:maría fernanda quispe', ' (sin id)']]) {
    await seller.selectOption(value);
    const shown = await seller.evaluate((select: HTMLSelectElement) => {
      const option = select.selectedOptions[0], cs = getComputedStyle(select), ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = cs.font;
      // Texto visible = caja de contenido menos la flecha nativa del select (~20 px en Chromium: a 768 px se ve
      // «María Fernanda Qu», 124 px, de 145 px de contenido).
      const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20;
      return { text: option.text, title: option.title, value: option.value, textWidth: ctx.measureText(option.text).width, room };
    });
    expect(shown.value).toBe(value);
    // Corte medido con la fuente real (varía por equipo): «<prefijo del nombre>…<sufijo entero>».
    expect(shown.text.endsWith('…' + short), shown.text).toBe(true);
    const prefix = shown.text.slice(0, shown.text.length - short.length - 1);
    expect(prefix.length, shown.text).toBeGreaterThanOrEqual(1);
    expect('María Fernanda Quispe'.startsWith(prefix), shown.text).toBe(true);
    expect(shown.title).toBe(`María Fernanda Quispe${short}`);
    expect(shown.textWidth, `«${shown.text}» cabe en ${shown.room}px`).toBeLessThanOrEqual(shown.room);
    await expect(screen.locator('[data-ch-table="sales"] tbody tr')).toHaveCount(1);
    // El title de la opción no se ve con el select cerrado: el select mismo lleva la etiqueta completa.
    await expect(seller).toHaveAttribute('title', `María Fernanda Quispe${short}`);
  }
  // Todos y una opción sin acortar: el select no tiene title (igual que antes).
  for (const value of ['', 'id:CAJ-001']) {
    await seller.selectOption(value);
    await expect.poll(() => seller.evaluate(select => select.hasAttribute('title')), `sin title con «${value || 'Todos'}»`).toBe(false);
  }
  // Nombres cortos repetidos y únicos: igual que antes, sin title.
  const others = await seller.locator('option').evaluateAll(nodes => nodes.filter(n => !/^(id:a1b2|name:maría)/.test((n as HTMLOptionElement).value)).map(n => [n.textContent, (n as HTMLOptionElement).title]));
  expect(others).toEqual([['Todos', ''], ['Ana · CAJ-001', ''], ['Ana · CAJ-002', ''], ['Luis', '']]);
});

// #837: el corte medido se recalcula sin repintar al cambiar el ancho (resize) y al cargar fuentes (loadingdone).
// Si se quitan esos listeners, el select conserva el texto de la medición anterior y esta prueba falla.
test('Historial del cliente: el corte del Vendedor se recalcula al cambiar el ancho y al cargar fuentes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ownerPage(page); await seed(page);
  const ID = 'a1b2c3d4-0000-4000-8000-000000000001', FULL = 'María Fernanda Quispe · a1b2c';
  await page.evaluate(ids => (0, eval)(`
    ventas.push(...${JSON.stringify(ids)}.map((id,i)=>({id:'V-vmn-rz'+i,fecha:NALimaTime.today(),hora:'11:0'+i,hora24:'11:0'+i,timestamp:new Date(NALimaTime.today()+'T11:0'+i+':00-05:00').toISOString(),total:4+i,metodo:'efectivo',clienteId:'vmn-c1',cajeroId:id,cajeroNombre:'María Fernanda Quispe',items:[{id:9101,name:'PRODUCTO VMN',precio:4+i,qty:1,costo:1}]})));
  `), [ID, 'a1b2d5e6-0000-4000-8000-000000000002']);
  await page.evaluate(() => (window as any).goPage('pageProximamente'));
  await page.locator('#pageProximamente [data-feature-id="cliente-historial-compras"]').click();
  const screen = page.locator('#pageClienteHistorial');
  await screen.getByRole('searchbox', { name: 'Buscar por nombre o DNI' }).fill('00000011');
  await screen.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption('vmn-c1');
  const seller = screen.getByRole('combobox', { name: 'Vendedor' });
  await expect.poll(() => seller.locator('option').count()).toBe(6);
  await seller.selectOption('id:' + ID);
  // Estado visible del select: texto de la opción elegida, title de opción y select, y si entra en el ancho disponible.
  const state = () => seller.evaluate((select: HTMLSelectElement) => {
    const option = select.selectedOptions[0], cs = getComputedStyle(select), ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = cs.font;
    const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20;
    return { text: option.text, optionTitle: option.title, selectTitle: select.getAttribute('title'), fits: ctx.measureText(option.text).width <= room };
  });
  // 1280 px: la etiqueta completa entra; sin title.
  await expect.poll(state).toEqual({ text: FULL, optionTitle: '', selectTitle: null, fits: true });
  // 768 px (solo resize, sin repintar): nombre cortado, sufijo entero, title con la etiqueta completa.
  await page.setViewportSize({ width: 768, height: 900 });
  await expect.poll(async () => { const s = await state(); return s.text !== FULL && s.text.endsWith('… · a1b2c') && 'María Fernanda Quispe'.startsWith(s.text.slice(0, -'… · a1b2c'.length)) && s.fits; }, { message: 'cortado al pasar a 768 px' }).toBe(true);
  expect(await state()).toMatchObject({ optionTitle: FULL, selectTitle: FULL });
  const at768 = (await state()).text;
  // Fuente más ancha (solo en la prueba) + evento loadingdone: se vuelve a medir y sigue entrando.
  await page.addStyleTag({ content: '#pageClienteHistorial [data-ch-seller]{font-size:17px}' });
  expect((await state()).fits, 'con 17 px el texto anterior ya no entra').toBe(false);
  await page.evaluate(() => (document as any).fonts.dispatchEvent(new Event('loadingdone')));
  await expect.poll(async () => { const s = await state(); return s.fits && s.text.endsWith('… · a1b2c') && s.text.length < at768.length; }, { message: 'recalculado al cargar fuentes' }).toBe(true);
  expect(await state()).toMatchObject({ optionTitle: FULL, selectTitle: FULL });
  // De vuelta a 1280 px con la fuente normal: etiqueta completa y sin title.
  await page.evaluate(() => document.querySelectorAll('style').forEach(s => { if (s.textContent?.includes('font-size:17px')) s.remove(); }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(state, { message: 'restaurado a 1280 px' }).toEqual({ text: FULL, optionTitle: '', selectTitle: null, fits: true });
  // El valor y el filtro no cambian.
  expect(await seller.inputValue()).toBe('id:' + ID);
  await expect(screen.locator('[data-ch-table="sales"] tbody tr')).toHaveCount(1);
});

test('Arqueo: dos usuarios «Rosa» de la nube se distinguen por su id; «Dueño» único sin sufijo', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await ownerPage(page);
  await page.evaluate(() => {
    const win = window as any;
    const today = win.NALimaTime.today();
    const at = (time: string) => new Date(today + 'T' + time + ':00-05:00').toISOString();
    const session = (id: string, time: string, opened: [string, string], closed: [string, string]) => Object.freeze({ session_id: id, status: 'CLOSED',
      opened_at: at('08:00'), closed_at: at(time), expected_cents: 100, counted_cents: 100, difference_cents: 0,
      opened_by_user_id: opened[0], opened_by_name: opened[1], closed_by_user_id: closed[0], closed_by_name: closed[1] });
    const snapshot = Object.freeze({ cashSessions: Object.freeze([
      session('vmn-s1', '10:00', ['a1b2c3d4-0000-4000-8000-000000000001', 'Rosa'], ['session:9f8e7d6c5b4a', 'Dueño']),
      session('vmn-s2', '11:00', ['e5f6a7b8-0000-4000-8000-000000000002', 'Rosa'], ['e5f6a7b8-0000-4000-8000-000000000002', 'Rosa']),
    ]) });
    win.NuevoAmanecerCanonical = Object.assign({}, win.NuevoAmanecerCanonical, { snapshot: () => snapshot, refresh: () => { throw new Error('sin refresh'); } });
    win.goPage('pageProximamente');
  });
  await page.locator('[data-feature-id="reporte-arqueo"]').click();
  const rows = page.locator('#pageReporteArqueo tbody tr');
  await expect.poll(() => rows.evaluateAll(trs => trs.map(tr => [...tr.querySelectorAll('td')].slice(0, 2).map(td => td.textContent))))
    .toEqual([['Rosa · e5f6', 'Rosa · e5f6'], ['Rosa · a1b2', 'Dueño']]);
});

test('recarga: después de guardar y recargar, las mismas etiquetas', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await localPage(page); await seed(page);
  await openReports(page);
  await expect.poll(() => reportRows(page)).toEqual(EXPECTED_REPORT);
  // Guardado local de la app (este navegador de prueba); no hay servidor.
  await page.evaluate(() => (window as any).saveAppState());
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.isOwner() && typeof (window as any).goPage === 'function');
  await expect.poll(() => page.evaluate(() => (0, eval)('ventas.length + ":" + appConfig.cashiers.map(c => c.id + "=" + c.nombre).join(",")')))
    .toBe('4:CAJ-001=Ana,CAJ-002=Ana,CAJ-003=Luis');
  await openReports(page);
  await expect.poll(() => reportRows(page)).toEqual(EXPECTED_REPORT);
});

test('solo nombres únicos: Reportes queda igual que sin el módulo de sufijos', async ({ browser }) => {
  const rowsFor = async (withoutLabels: boolean) => {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await localPage(page, { withoutLabels }); await seed(page);
    await page.evaluate(() => (0, eval)(`appConfig.cashiers=appConfig.cashiers.filter(c=>c.id!=='CAJ-002');ventas=ventas.filter(v=>v.cajeroId!=='CAJ-002');`));
    await openReports(page);
    await expect.poll(() => reportRows(page)).toHaveLength(2);
    const rows = await reportRows(page); await page.close(); return rows;
  };
  const withLabels = await rowsFor(false);
  expect(withLabels).toEqual([['Ana', '1', 'S/ 10.00', '1'], ['Luis', '1', 'S/ 3.00', '1']]);
  expect(await rowsFor(true)).toEqual(withLabels);
});

// Venta e Inicio: idénticos píxel a píxel a la base (la página sin seller-labels.js se comporta como f9f7f7bb).
// Captura cuando la pantalla deja de cambiar: tres capturas seguidas idénticas (foco, nombres normalizados, iconos).
async function stableShot(page: Page) {
  let last: Buffer | null = null, same = 0;
  await expect.poll(async () => {
    const shot = await page.screenshot({ animations: 'disabled', caret: 'hide' });
    same = last && last.equals(shot) ? same + 1 : 0; last = shot; return same;
  }, { message: 'captura estable', timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  return last as unknown as Buffer;
}
for (const width of [390, 1366]) for (const dark of [false, true]) for (const screenId of ['pagePOS', 'pageMenu']) {
  test(`${screenId === 'pagePOS' ? 'Venta' : 'Inicio'} ${width}px ${dark ? 'Nocturno' : 'claro'}: píxel idéntico a la base con vendedores repetidos`, async ({ browser }, testInfo) => {
    const shoot = async (withoutLabels: boolean) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date('2026-10-20T15:00:00-05:00'));
      await localPage(page, { withoutLabels }); await seed(page, { openCash: true });
      await page.evaluate(dark => (window as any).NA_THEME.setMode(dark ? 'noche' : 'claro'), dark);
      await expect(page.locator('body')).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await page.evaluate(id => (id === 'pageMenu' ? (window as any).goMenu() : (window as any).goPage(id)), screenId);
      await expect(page.locator('#' + screenId)).toBeVisible();
      await page.waitForLoadState('networkidle');
      await settlePersistence(page);
      await page.evaluate(() => document.fonts.ready);
      const shot = await stableShot(page);
      await context.close();
      return shot;
    };
    const head = await shoot(false), base = await shoot(true);
    if (!head.equals(base)) {
      await testInfo.attach('head', { body: head, contentType: 'image/png' });
      await testInfo.attach('base', { body: base, contentType: 'image/png' });
      writeFileSync(testInfo.outputPath('head.png'), head); writeFileSync(testInfo.outputPath('base.png'), base);
    }
    expect(head.equals(base), 'captura idéntica byte a byte').toBe(true);
  });
}
