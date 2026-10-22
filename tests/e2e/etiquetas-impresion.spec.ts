import { test, expect, type Page } from '@playwright/test';

// Misión 1: impresión de etiquetas (@page, A4 por hojas, rollo), tema oscuro, sin precio, tope y fecha de Lima.
// Datos sintéticos; sin clientes reales.
const products = [
  { id: 990201, name: 'Arroz impresion', sku: 'ARROZ-02', barcode: 'ARROZ-02', precio: 4.5, costo: 2, stock: 10, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' },
  { id: 990202, name: 'Fideo sin precio', sku: 'FID-0', barcode: 'FID-0', precio: 0, costo: 1, stock: 3, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' },
  { id: 990203, name: 'Azucar impresion', sku: 'AZU-1', barcode: 'AZU-1', precio: 3.2, costo: 2, stock: 8, activo: true, cat: 'abarrotes', unidad: 'unidad', icon: '📦' }
];

async function open(page: Page, dark: boolean) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'permissions.test') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.pathname === '/auth/me' ? { pos_role: 'owner', owner_pin_set: true, roles_ready: true, device_id: 'etq-m1' } : {}) });
    return url.hostname === '127.0.0.1' && !['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.setItem('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://permissions.test', token: 'synthetic-test-only' }));
    localStorage.setItem('na_pos_role_v1', JSON.stringify({ role: 'owner' }));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).NA_ROLES?.role === 'owner' && (window as any).NA_ROLES.confirmed && !!(window as any).NA_ETIQUETAS_PRECIOS);
  // El arranque normaliza el catálogo (_naNormalizeData pone sku PROD-n a los que no tienen código) y enseguida llena
  // #invCat (renderCategorySelects). Se espera a eso antes de cargar los productos de prueba: si no, la normalización
  // tardía les daba código a los «sin código» (5 barras en vez de 3).
  await page.waitForFunction(() => (document.querySelectorAll('#invCat option').length > 0));
  await page.evaluate(items => { (0, eval)('productos = ' + JSON.stringify(items)); }, products);
  await page.evaluate(d => document.body.classList.toggle('dark', d), dark);
  await page.evaluate(() => (window as any).goPage('pageEtiquetasPrecios'));
  const root = page.locator('#pageEtiquetasPrecios');
  await expect(root).toHaveClass(/\bactive\b/);
  return { root, errors };
}

async function pick(root: any, query: string, id: number) {
  const search = root.locator('[data-etq-search]');
  await search.fill(query);
  await root.locator(`[data-etq-add="${id}"]`).click();
  // Al elegir, las sugerencias se cierran y el buscador queda vacío.
  await expect(root.locator('[data-etq-matches] [data-etq-add]')).toHaveCount(0);
  await expect(search).toHaveValue('');
}

// Contraste WCAG contra el primer fondo opaco hacia arriba.
async function contrast(el: any) {
  return el.evaluate((node: Element) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fg = parse(getComputedStyle(node).color);
    let bgNode: Element | null = node, bg = [255, 255, 255];
    while (bgNode) { const c = parse(getComputedStyle(bgNode).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) { bg = c; break; } bgNode = bgNode.parentElement; }
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

for (const dark of [false, true]) {
  for (const width of [390, 768, 1280]) {
    test(`impresión de etiquetas a ${width}px, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const { root, errors } = await open(page, dark);
      await pick(root, 'arroz', 990201);
      await pick(root, 'fideo', 990202);

      // Sin precio: aviso visible en la lista y la etiqueta no dice «S/ 0.00».
      await expect(root.locator('[data-etq-noprice-warn="990202"]')).toBeVisible();
      await expect(root.locator('[data-etq-noprice-warn="990201"]')).toHaveCount(0);
      const noPrice = root.locator('[data-etq-sheet] [data-etq-label]').filter({ hasText: 'Fideo sin precio' });
      await expect(noPrice.locator('.etq-price')).toHaveText('Sin precio');
      await expect(root.locator('[data-etq-sheet]')).not.toContainText('S/ 0.00');

      // Contraste ≥ 4.5:1 en buscador, selector, Quitar y notas.
      for (const sel of ['[data-etq-search]', '[data-etq-format]', '[data-etq-remove="990201"]', '.etq-note >> nth=0', '[data-etq-noprice-warn="990202"]']) {
        expect(await contrast(root.locator(sel)), `${sel} contraste`).toBeGreaterThanOrEqual(4.5);
      }
      if (dark) expect(await root.locator('[data-etq-search]').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');

      // Fecha de Lima: igual a la que calcula Intl con America/Lima.
      const lima = await page.evaluate(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()));
      await expect(root.locator('.etq-date').first()).toHaveText(lima);

      // Tope: 3 × 100 = 300 pedidas, la vista previa llega a 240 con aviso.
      await pick(root, 'azucar', 990203);
      for (const id of [990201, 990202, 990203]) { await root.locator(`[data-etq-qty="${id}"]`).fill('100'); await root.locator(`[data-etq-qty="${id}"]`).blur(); }
      const labels = root.locator('[data-etq-sheet] [data-etq-label]');
      await expect(labels).toHaveCount(240);
      await expect(root.locator('[data-etq-count]')).toHaveText('240 etiquetas (máximo)');
      await expect(root.locator('[data-etq-cap]')).toBeVisible();
      await expect(root.locator('[data-etq-cap]')).toContainText('240');

      // A4: 240 / 24 = 10 grids, cada uno 3 × 8.
      await root.locator('[data-etq-format]').selectOption('a4');
      const pages = root.locator('[data-etq-a4-page]');
      await expect(pages).toHaveCount(10);
      await expect(pages.first().locator('[data-etq-label]')).toHaveCount(24);
      expect(await pages.first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);

      const overflow = await root.evaluate(el => el.scrollWidth - el.clientWidth);
      expect(overflow, 'la página no se desborda').toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`etq-m1-${width}-${dark ? 'oscuro' : 'claro'}.png`) });

      // Imprimir con un producto sin precio pide confirmación; si se cancela, no imprime.
      await page.evaluate(() => { (window as any).__printed = 0; (window as any).__asked = ''; window.print = () => { (window as any).__printed++; }; window.confirm = (m?: string) => { (window as any).__asked = String(m); return false; }; });
      await root.locator('[data-etq-print]').click();
      expect(await page.evaluate(() => (window as any).__printed)).toBe(0);
      expect(await page.evaluate(() => (window as any).__asked)).toContain('Sin precio');

      // Confirmado: inserta @page A4 margen 0 y un salto de página entre grids.
      await page.evaluate(() => { window.confirm = () => true; });
      await root.locator('[data-etq-print]').click();
      expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
      await expect(page.locator('style[data-etq-page-style]')).toHaveJSProperty('textContent', '@page { size: A4; margin: 0; }');
      await page.emulateMedia({ media: 'print' });
      expect(await pages.nth(0).evaluate(el => getComputedStyle(el).breakAfter)).toBe('page');
      expect(await pages.nth(9).evaluate(el => getComputedStyle(el).breakAfter)).toBe('auto');
      // 8 × 37 mm = 296 mm: sin altura de 297 mm que por redondeo agregue una hoja en blanco.
      expect(await pages.nth(0).evaluate(el => Math.round(el.getBoundingClientRect().height / 96 * 25.4))).toBeLessThanOrEqual(296);
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await expect(page.locator('style[data-etq-page-style]')).toHaveCount(0);

      // Rollo chica: @page 38 × 25 mm y una etiqueta por página.
      await root.locator('[data-etq-format]').selectOption('chica');
      await root.locator('[data-etq-print]').click();
      await expect(page.locator('style[data-etq-page-style]')).toHaveJSProperty('textContent', '@page { size: 38mm 25mm; margin: 0; }');
      await page.emulateMedia({ media: 'print' });
      expect(await labels.first().evaluate(el => getComputedStyle(el).breakAfter)).toBe('page');
      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await root.locator('[data-etq-format]').selectOption('mediana');
      await root.locator('[data-etq-print]').click();
      await expect(page.locator('style[data-etq-page-style]')).toHaveJSProperty('textContent', '@page { size: 50mm 30mm; margin: 0; }');
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      expect(errors).toEqual([]);
    });
  }
}

// Tamaño real impreso (#852): en rollo, nada fuera de la etiqueta puede ensanchar la página, o Chromium encoge todo
// para que entre (antes la etiqueta salía al ~66 %). Se mide con el medio «print» y una ventana del ancho de la hoja,
// y se revisa el PDF (tamaño de hoja y cantidad de páginas).
const MM = 96 / 25.4;
function pdfInfo(pdf: Buffer) {
  const s = pdf.toString('latin1');
  const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const boxes = (s.match(/\/MediaBox\s*\[[^\]]*\]/g) || []).map(b => b.replace(/^\/MediaBox\s*\[\s*|\s*\]$/g, '').split(/\s+/).map(Number));
  const sizes = boxes.map(b => JSON.stringify([Math.round((b[2] - b[0]) / 72 * 25.4), Math.round((b[3] - b[1]) / 72 * 25.4)]));
  return { pages, sizesMm: Array.from(new Set(sizes)).map(x => JSON.parse(x)) };
}
// Barras del código en la página 1 del PDF, medidas en tinta (mm) rasterizando con pdftoppm (si está instalado).
function pdfBarsMm(pdfPath: string, cropMm: number): { width: number; height: number } | null {
  const { execFileSync } = require('child_process'), fs = require('fs');
  const DPI = 300, out = pdfPath.replace(/\.pdf$/, '-p1');
  try { execFileSync('pdftoppm', ['-r', String(DPI), '-gray', '-f', '1', '-l', '1', '-singlefile', pdfPath, out]); } catch { return null; }
  const d: Buffer = fs.readFileSync(out + '.pgm'); fs.unlinkSync(out + '.pgm');
  const m = /^P5\s+(\d+)\s+(\d+)\s+\d+\s/.exec(d.toString('latin1', 0, 40))!; const FW = +m[1], H = +m[2], all = d.subarray(m[0].length);
  // Solo la primera etiqueta (en A4, la primera columna).
  const W = Math.min(FW, Math.round(cropMm / 25.4 * DPI)), px = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) all.copy(px, y * W, y * FW, y * FW + W);
  // Barras = el tramo más largo de filas casi iguales con muchas transiciones (el texto cambia fila a fila).
  const rows = Array.from({ length: H }, (_, y) => { let t = 0, first = -1, last = -1, bits = '';
    for (let x = 0; x < W; x++) { const black = px[y * W + x] < 128; bits += black ? '1' : '0'; if (black) { if (first < 0) first = x; last = x; } if (x && black !== (px[y * W + x - 1] < 128)) t++; }
    return { t, first, last, bits }; });
  const same = (a: string, b: string) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 8) return false; return true; };
  let best = { from: 0, to: -1 }, from = -1;
  for (let y = 0; y <= H; y++) {
    const ok = y < H && rows[y].t >= 40 && (from < 0 || same(rows[y].bits, rows[from].bits));
    if (ok && from < 0) from = y;
    if (!ok && from >= 0) { if (y - 1 - from > best.to - best.from) best = { from, to: y - 1 }; from = y < H && rows[y].t >= 40 ? y : -1; }
  }
  let minX = W, maxX = -1; const minY = best.from, maxY = best.to;
  for (let y = minY; y <= maxY; y++) { minX = Math.min(minX, rows[y].first); maxX = Math.max(maxX, rows[y].last); }
  const mm = (p: number) => p / DPI * 25.4;
  return maxY < 0 ? { width: 0, height: 0 } : { width: mm(maxX - minX + 1), height: mm(maxY - minY + 1) };
}
for (const dark of [false, true]) for (const [fmt, w, h] of [['chica', 38, 25], ['mediana', 50, 30], ['a4', 210, 297]] as const) {
  test(`tamaño impreso real: ${fmt} ${w}×${h} mm, tema ${dark ? 'oscuro' : 'claro'}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const { root, errors } = await open(page, dark);
    await pick(root, 'arroz', 990201);
    await pick(root, 'azucar', 990203);
    const counts = fmt === 'a4' ? [20, 5] : [2, 1];
    for (const [i, id] of [990201, 990203].entries()) { await root.locator(`[data-etq-qty="${id}"]`).fill(String(counts[i])); await root.locator(`[data-etq-qty="${id}"]`).blur(); }
    const total = counts[0] + counts[1];
    await root.locator('[data-etq-format]').selectOption(fmt);
    await page.evaluate(() => { window.print = () => {}; window.confirm = () => true; });
    await root.locator('[data-etq-print]').click();
    // Barras a tamaño real (revisión visual #852, Arroz de prueba): chica 29.6×8, mediana 39.9×8, A4 57.1×8 mm.
    const barsW = ({ chica: 29.6, mediana: 39.9, a4: 57.1 } as const)[fmt];
    // PDF primero, como el diálogo real: ventana normal y medio «print» lo pone page.pdf. (Con emulateMedia('print')
    // o una ventana del tamaño de la etiqueta, Chromium dejaba en blanco las páginas de rollo del PDF.)
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pdfPath = testInfo.outputPath(`${fmt}-${dark ? 'oscuro' : 'claro'}.pdf`);
    require('fs').writeFileSync(pdfPath, pdf);
    // En el PDF mismo: con el encogido de Chromium la chica daba 19.6×5.3 mm (×0.665) y la mediana 26.6×5.3 (×0.667).
    const ink = pdfBarsMm(pdfPath, fmt === 'a4' ? 70 : w);
    if (ink) {
      expect(Math.abs(ink.width - barsW), `barras en el PDF ${ink.width.toFixed(2)}×${ink.height.toFixed(2)} mm ≈ ${barsW}×8`).toBeLessThanOrEqual(0.4);
      expect(Math.abs(ink.height - 8), `alto de barras en el PDF ${ink.height.toFixed(2)} mm`).toBeLessThanOrEqual(0.3);
    } else testInfo.annotations.push({ type: 'info', description: 'pdftoppm no disponible: se omite la medida en tinta del PDF' });
    const info = pdfInfo(pdf);
    expect(info.sizesMm).toEqual([[w, h]]);
    expect(info.pages).toBe(fmt === 'a4' ? 2 : total);
    // page.pdf dispara «afterprint»: la impresión se limpia sola.
    expect(await page.evaluate(() => document.querySelectorAll('style[data-etq-page-style], [data-etq-print-hide], [data-etq-print-path]').length), 'limpio tras page.pdf').toBe(0);
    // Diseño en medio «print» con la ventana del ancho de la hoja (se vuelve a pedir la impresión).
    await root.locator('[data-etq-print]').click();
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width: Math.round(w * MM), height: Math.round(h * MM) });
    const layout = await page.evaluate(() => {
      const label = document.querySelector('[data-etq-sheet] [data-etq-label]') as HTMLElement, r = label.getBoundingClientRect();
      // Borde derecho más lejano de todo lo que ocupa lugar en el diseño (también lo invisible): es lo que encoge el PDF.
      const laidOut = [...document.querySelectorAll('body *')].filter(e => (e as HTMLElement).getClientRects().length > 0);
      const widest = laidOut.map(e => [e.id || e.tagName, Math.round(e.getBoundingClientRect().right)] as const).sort((a, b) => b[1] - a[1])[0];
      const rects = [...label.querySelectorAll('svg.etq-bars rect')].map(e => e.getBoundingClientRect());
      const bars = { width: Math.max(...rects.map(b => b.right)) - Math.min(...rects.map(b => b.left)), height: Math.max(...rects.map(b => b.bottom)) - Math.min(...rects.map(b => b.top)) };
      return { bars, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, widest, left: r.left, top: r.top, width: r.width, height: r.height,
        visibleOutside: [...document.body.querySelectorAll('*')].filter(e => !e.closest('[data-etq-sheet]') && !e.contains(label) && (e as HTMLElement).getClientRects().length > 0).map(e => e.id || e.className || e.tagName).slice(0, 5) };
    });
    const pageWidth = Math.round(w * MM);
    expect(layout.scrollWidth, 'nada ensancha la página').toBeLessThanOrEqual(pageWidth + 1);
    expect(layout.bodyWidth).toBeLessThanOrEqual(pageWidth + 1);
    expect(layout.widest[1], `elemento más ancho: ${layout.widest.join(' → ')} px`).toBeLessThanOrEqual(pageWidth + 1);
    expect(layout.visibleOutside, 'fuera de la hoja no queda nada en el diseño').toEqual([]);
    expect(Math.abs(layout.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.top)).toBeLessThanOrEqual(1);
    const [lw, lh] = fmt === 'a4' ? [70, 37] : [w, h];
    expect(Math.abs(layout.width - lw * MM), `ancho ${layout.width}px ≈ ${lw} mm`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(layout.height - lh * MM), `alto ${layout.height}px ≈ ${lh} mm`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(layout.bars.width / MM - barsW), `barras ${(layout.bars.width / MM).toFixed(2)} mm ≈ ${barsW} mm`).toBeLessThanOrEqual(0.4);
    expect(Math.abs(layout.bars.height / MM - 8), `alto barras ${(layout.bars.height / MM).toFixed(2)} mm`).toBeLessThanOrEqual(0.3);
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('style[data-etq-page-style]')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('[data-etq-print-hide], [data-etq-print-path]').length), 'sin marcas tras imprimir').toBe(0);
    expect(errors).toEqual([]);
  });
}

// #852: la etiqueta usa el producto ACTUAL del catálogo (por id), no la copia de cuando se agregó.
test('precio actualizado en el catálogo: la vista previa y la impresión muestran el nuevo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { root, errors } = await open(page, false);
  await pick(root, 'arroz', 990201);
  const price = root.locator('[data-etq-sheet] [data-etq-label] .etq-price').first();
  await expect(price).toHaveText('S/ 4.50');
  // Recarga del catálogo (nuevo arreglo, objetos nuevos) con otro precio y otro nombre.
  await page.evaluate(items => { (0, eval)('productos = ' + JSON.stringify(items)); },
    products.map(p => p.id === 990201 ? { ...p, precio: 5.75, name: 'Arroz impresion extra' } : p));
  await page.evaluate(() => (window as any).goPage('pagePOS'));
  await page.evaluate(() => (window as any).goPage('pageEtiquetasPrecios'));
  await expect(price).toHaveText('S/ 5.75');
  await expect(root.locator('[data-etq-sheet] .etq-name').first()).toHaveText('Arroz impresion extra');
  // Sin volver a entrar: imprimir usa el precio del catálogo en ese momento.
  await page.evaluate(() => { (0, eval)('productos.find(p => p.id === 990201).precio = 6.2'); window.print = () => {}; window.confirm = () => true; });
  await root.locator('[data-etq-print]').click();
  await expect(price).toHaveText('S/ 6.20');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  // Pasa a no tener precio: aviso y confirmación al imprimir.
  await page.evaluate(() => { (0, eval)('productos.find(p => p.id === 990201).precio = 0'); (window as any).__asked = ''; window.confirm = (m?: string) => { (window as any).__asked = String(m); return false; }; });
  await root.locator('[data-etq-print]').click();
  expect(await page.evaluate(() => (window as any).__asked)).toContain('Sin precio');
  await expect(price).toHaveText('Sin precio');
  await expect(root.locator('[data-etq-noprice-warn="990201"]')).toBeVisible();
  expect(errors).toEqual([]);
});

// Aparato en UTC a las 22:00 de Lima (03:00 UTC del día siguiente): la etiqueta lleva la fecha de Lima, no la del aparato.
test.describe('fecha de Lima con el aparato en UTC', () => {
  test.use({ timezoneId: 'UTC' });
  test('la etiqueta impresa muestra 20/10/2026 aunque el aparato ya esté en el 21', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-21T03:00:00Z'));
    await page.setViewportSize({ width: 1280, height: 900 });
    const { root, errors } = await open(page, false);
    expect(await page.evaluate(() => new Date().getDate()), 'el aparato (UTC) ya está en el 21').toBe(21);
    await pick(root, 'arroz', 990201);
    await expect(root.locator('[data-etq-sheet] .etq-date').first()).toHaveText('20/10/2026');
    await page.evaluate(() => { window.print = () => {}; window.confirm = () => true; });
    await root.locator('[data-etq-print]').click();
    await expect(root.locator('[data-etq-sheet] .etq-date').first()).toHaveText('20/10/2026');
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdf.length).toBeGreaterThan(5000);
    expect(errors).toEqual([]);
  });
});

// Si «afterprint» nunca llega (algunos móviles), salir de Etiquetas o volver a la pestaña limpia la impresión:
// si no, un window.print() posterior (ticket, reporte) salía en blanco.
test('impresión sin «afterprint»: salir de Etiquetas o volver a la pestaña deja la app imprimible', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { root, errors } = await open(page, false);
  await pick(root, 'arroz', 990201);
  await page.evaluate(() => { window.print = () => {}; window.confirm = () => true; });
  const leftovers = () => page.evaluate(() => ({
    body: document.body.classList.contains('etq-printing'), html: document.documentElement.classList.contains('etq-printing-root'),
    style: document.querySelectorAll('style[data-etq-page-style]').length, marks: document.querySelectorAll('[data-etq-print-hide], [data-etq-print-path]').length }));
  const clean = { body: false, html: false, style: 0, marks: 0 };
  // 1) Salir de la pantalla sin «afterprint».
  await root.locator('[data-etq-print]').click();
  expect((await leftovers()).marks).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).goPage('pagePOS'));
  await expect.poll(leftovers).toEqual(clean);
  // Un window.print() de la app ya no sale en blanco: en medio «print» la Venta ocupa lugar.
  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('#pagePOS').evaluate(el => el.getClientRects().length > 0 && el.getBoundingClientRect().height > 50)).toBe(true);
  await page.emulateMedia({ media: 'screen' });
  // 2) Volver a la pestaña (visibilitychange → visible) estando aún en Etiquetas.
  await page.evaluate(() => (window as any).goPage('pageEtiquetasPrecios'));
  await root.locator('[data-etq-print]').click();
  expect((await leftovers()).body).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(leftovers).toEqual(clean);
  expect(errors).toEqual([]);
});

// Producto agregado y luego borrado del catálogo: aviso visible y entra en la confirmación; nunca el precio viejo.
test('producto borrado del catálogo: aviso en la vista previa y en la lista, confirmación antes de imprimir', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { root, errors } = await open(page, false);
  await pick(root, 'arroz', 990201);
  await pick(root, 'azucar', 990203);
  await page.evaluate(() => { (0, eval)('productos = productos.filter(p => p.id !== 990201)'); (window as any).__asked = []; (window as any).__printed = 0;
    window.confirm = (m?: string) => { (window as any).__asked.push(String(m)); return false; }; window.print = () => { (window as any).__printed++; }; });
  await root.locator('[data-etq-print]').click();
  const asked = await page.evaluate(() => (window as any).__asked);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('1 producto ya no está en el catálogo');
  expect(await page.evaluate(() => (window as any).__printed), 'sin confirmar no imprime').toBe(0);
  const gone = root.locator('[data-etq-sheet] [data-etq-label]').filter({ has: page.locator('[data-etq-missing]') });
  await expect(gone).toHaveCount(1);
  await expect(gone.locator('[data-etq-missing]')).toBeVisible();
  await expect(gone.locator('[data-etq-missing]')).toHaveText('Producto ya no está en el catálogo');
  await expect(gone.locator('.etq-price')).toHaveText('Sin precio');
  await expect(root.locator('[data-etq-missing-warn="990201"]')).toBeVisible();
  await expect(root.locator('[data-etq-sheet] .etq-price').filter({ hasText: 'S/ 4.50' })).toHaveCount(0);
  // El aviso entra en la etiqueta chica (38×25 mm) y en la mediana: nada se sale ni queda cortado.
  for (const fmt of ['chica', 'mediana']) {
    await root.locator('[data-etq-format]').selectOption(fmt);
    const fit = await gone.evaluate(label => {
      const lb = label.getBoundingClientRect(), pad = parseFloat(getComputedStyle(label).paddingBottom);
      return { label: [Math.round(lb.width), Math.round(lb.height)], kids: [...label.children].map(el => { const r = el.getBoundingClientRect(); return { cls: (el.className as any).baseVal ?? el.className, bottomOver: Math.round((r.bottom - (lb.bottom - pad)) * 10) / 10, rightOver: Math.round((r.right - lb.right) * 10) / 10, h: Math.round(r.height) }; }) };
    });
    for (const k of fit.kids) {
      expect(k.bottomOver, `${fmt}: ${k.cls} no se sale por abajo (${JSON.stringify(fit)})`).toBeLessThanOrEqual(0.5);
      expect(k.rightOver, `${fmt}: ${k.cls} no se sale por la derecha`).toBeLessThanOrEqual(0.5);
    }
    // El aviso va en una línea («…» si no entra) y las barras conservan sus 8 mm (en la chica, a 2 líneas se achicaban a ~7.4 mm).
    const bars = fit.kids.find(k => k.cls === 'etq-bars')!, warn = fit.kids.find(k => k.cls === 'etq-warn')!;
    expect(Math.abs(bars.h - 8 * 96 / 25.4), `${fmt}: barras ${bars.h}px ≈ 8 mm`).toBeLessThanOrEqual(1);
    expect(warn.h, `${fmt}: aviso en una línea`).toBeLessThanOrEqual(10);
    await expect(gone.locator('[data-etq-missing]')).toHaveAttribute('title', 'Producto ya no está en el catálogo');
    await expect(gone.locator('.etq-meta')).toBeVisible();
  }
  // Confirmando, imprime (como «Sin precio»).
  await page.evaluate(() => { window.confirm = () => true; });
  await root.locator('[data-etq-print]').click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  expect(errors).toEqual([]);
});

// Catálogo vacío un momento (recarga o sincronización): lo elegido no se marca como borrado, no hay aviso ni confirmación
// y se imprime con el precio que tenía.
test('catálogo vacío un momento: sin aviso de borrado ni confirmación, imprime con lo elegido', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { root, errors } = await open(page, false);
  await pick(root, 'arroz', 990201);
  await page.evaluate(() => { (0, eval)('productos = []'); (window as any).__asked = []; (window as any).__printed = 0;
    window.confirm = (m?: string) => { (window as any).__asked.push(String(m)); return true; }; window.print = () => { (window as any).__printed++; }; });
  await root.locator('[data-etq-print]').click();
  expect(await page.evaluate(() => (window as any).__asked), 'sin confirmación').toEqual([]);
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
  await expect(root.locator('[data-etq-sheet] [data-etq-missing]')).toHaveCount(0);
  await expect(root.locator('[data-etq-missing-warn]')).toHaveCount(0);
  await expect(root.locator('[data-etq-sheet] .etq-price').filter({ hasText: 'S/ 4.50' })).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  expect(errors).toEqual([]);
});

// Sin «afterprint» y con la única limpieza cayendo durante la impresión, quedan marcas viejas. Un Ctrl+P en Venta
// (otra impresión, no de Etiquetas) las limpia en «beforeprint»: el PDF de Venta no sale en blanco.
test('marcas viejas de Etiquetas y Ctrl+P en Venta: el PDF de Venta no sale en blanco', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { root, errors } = await open(page, false);
  await pick(root, 'arroz', 990201);
  // Como el navegador: window.print() dispara «beforeprint» (y aquí nunca «afterprint»).
  await page.evaluate(() => { window.confirm = () => true; window.print = () => { window.dispatchEvent(new Event('beforeprint')); }; });
  await root.locator('[data-etq-print]').click();
  const marks = () => page.evaluate(() => document.querySelectorAll('[data-etq-print-hide], [data-etq-print-path]').length + (document.body.classList.contains('etq-printing') ? 1 : 0));
  expect(await marks(), 'su propio «beforeprint» no limpia la hoja').toBeGreaterThan(0);
  // La salida de Etiquetas cae mientras el navegador dice que imprime (matchMedia('print') verdadero): la guarda no limpia.
  // (Se simula con matchMedia: emulateMedia('print') deja a Chromium con un page.pdf posterior en blanco.)
  await page.evaluate(() => { const real = window.matchMedia.bind(window); (window as any).__realMM = real;
    window.matchMedia = (q: string) => q === 'print' ? ({ matches: true, media: q } as any) : real(q); });
  await page.evaluate(() => (window as any).goPage('pagePOS'));
  await page.evaluate(() => { window.matchMedia = (window as any).__realMM; });
  // Venta ya dibujada (se renderiza después de goPage): el producto está en la grilla.
  await expect(page.locator('#pagePOS').getByText('Arroz impresion').first()).toBeVisible();
  // Y quieta: sin pedidos pendientes y dos cuadros dibujados (un page.pdf a mitad del render de Venta salía casi vacío).
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  // Y con la entrada de Venta terminada: «na-enter-fade» (240 ms, opacidad 0→1) arranca unos cuadros después de goPage
  // y un page.pdf a mitad del fundido salía casi vacío (1-4 de 10). Se espera a que la entrada exista (si hay Motion) y
  // a que ninguna animación de #pagePOS ni de sus hijos siga corriendo.
  await page.waitForFunction(() => {
    const el = document.getElementById('pagePOS');
    if (!el) return false;
    const anims = el.getAnimations({ subtree: true });
    const motion = (window as any).NA_MOTION, animated = !!motion?.core && !motion.core.reducedMotion() && window.innerWidth > 700;
    if (animated && !anims.some(a => (a as any).animationName === 'na-motion-fade-in' && a.playState === 'finished')) return false;
    return anims.every(a => a.playState !== 'running' && !a.pending);
  });
  expect(await marks(), 'quedan marcas viejas').toBeGreaterThan(0);
  // Ctrl+P en Venta (page.pdf dispara «beforeprint» y arma las páginas como el diálogo).
  const pdf = await page.pdf({ printBackground: true });
  const pdfPath = testInfo.outputPath('venta.pdf');
  require('fs').writeFileSync(pdfPath, pdf);
  expect(await marks(), 'limpio').toBe(0);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages).toBeGreaterThanOrEqual(1);
  let text = '';
  try { text = require('child_process').execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' }); } catch { testInfo.annotations.push({ type: 'info', description: 'pdftotext no disponible: solo se mide el tamaño del PDF' }); }
  if (text) expect(text.replace(/\s+/g, ' ').trim().length, 'el PDF de Venta tiene texto').toBeGreaterThan(20);
  expect(pdf.length, 'no es un PDF en blanco (~2 KB)').toBeGreaterThan(10000);
  expect(errors).toEqual([]);
});
