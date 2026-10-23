// Pasos del APARATO en Chromium real (módulos de la rama): PDF->imagen, Excel, flujo de boleta (giro, suma, duplicado, historial) y foto de producto.
import { createRequire } from 'node:module'; import { writeFileSync, readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('/workspace/nb-933-e2e/node_modules/playwright');
const STAGE = process.argv[2] || 'all', OUT = '/workspace/_ocr_run/out';
const br = await chromium.launch(); const pg = await br.newPage();
pg.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text().slice(0, 200)); });
await pg.goto('http://127.0.0.1:8787/_t/audit.html');
const PRODUCTOS = JSON.parse(readFileSync(OUT + '/_datos-simulados.json', 'utf8')).PRODUCTS.map((p) => ({ id: p.id, name: p.nombre, sku: null, barcode: null }));
await pg.evaluate((p) => { window.__productos = p; }, PRODUCTOS);
const res = {}; const save = () => writeFileSync(OUT + '/_device-' + STAGE + '.json', JSON.stringify(res, null, 1));
const fileIn = (url, name, type) => `fetch('${url}').then(r=>r.blob()).then(b=>new File([b], '${name}', {type:'${type}'}))`;

if (STAGE === 'pdf' || STAGE === 'all') {
  for (const [id, f] of [['OCR-007', 'ocr007_factura_2p.pdf'], ['OCR-008', 'ocr008_protegido.pdf'], ['OCR-022', 'ocr022_lista_40p.pdf']]) {
    const t0 = Date.now();
    const r = await pg.evaluate(async ([u, n]) => { const f = await fetch(u).then((r) => r.blob()).then((b) => new File([b], n, { type: 'application/pdf' }));
      const P = window.NA_ASISTENTE_PDF; try { const r = await P.toImage(f, { doc: document }); const img = await compress(r.blob);
        return { ok: true, kind: P.kind(f), pages: r.pages, total: r.total, aviso_ui: r.total > r.pages ? 'El PDF tiene ' + r.total + ' páginas: leo solo las primeras ' + r.pages + '.' : null, img };
      } catch (e) { return { ok: false, kind: P.kind(f), code: e && e.code, mensaje_ui: P.message(e && e.code) }; } }, ['/_t/pdf/' + f, f]);
    r.ms = Date.now() - t0; if (r.img) { writeFileSync(OUT + '/' + id + '_pdf.jpg', Buffer.from(r.img.split(',')[1], 'base64')); r.img_chars = r.img.length; delete r.img; }
    res[id] = r; console.error(id, JSON.stringify(r));
  }
  const k = await pg.evaluate(async () => { const f = new File([new Uint8Array([80, 75, 3, 4])], 'ocr009_lista.xlsm', { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
    return { kind_pdf_module: window.NA_ASISTENTE_PDF.kind(f) }; });
  res['OCR-009'] = k; console.error('OCR-009', JSON.stringify(k)); save();
}

async function boleta(caseId, img, { clear = false, confirm = false, edit = null, role = 'owner' } = {}) {
  const t0 = Date.now();
  const r = await pg.evaluate(async ([c, u, clear, confirm, edit, role]) => {
    if (clear) localStorage.clear(); window.__case = c; window.__role = role; window.__said = []; window.__filled = []; window.__posts = [];
    const chat = document.getElementById('chat'); chat.innerHTML = '';
    const f = await fetch(u).then((r) => r.blob()).then((b) => new File([b], u.split('/').pop(), { type: 'image/jpeg' }));
    await window.NA_ASISTENTE_BOLETA.start(f, host());
    const card = chat.querySelector('.na-asst-bol'); const out = { posts: window.__posts.length, hints_enviados: window.__posts.map((p) => p.hints), dijo: window.__said.slice() };
    if (!card) return out;
    const val = (s) => { const i = card.querySelector(s); return i ? i.value : null; };
    out.cabecera = [...card.querySelectorAll('.na-asst-bol-head input')].map((i) => i.value);
    out.filas = [...card.querySelectorAll('.na-asst-bol-row')].map((r) => [...r.querySelectorAll('input')].map((i) => i.value + (i.title ? ' {' + i.title + '}' : '')));
    out.aviso = card.querySelector('.na-asst-bol-warn').hidden ? '' : card.querySelector('.na-asst-bol-warn').textContent;
    out.marcas_historial = card.querySelectorAll('.na-asst-bol-learned').length;
    out.nota = (card.querySelector('.na-asst-note') || {}).textContent;
    if (edit) { const inp = card.querySelectorAll('.na-asst-bol-row')[edit.row].querySelector('.na-asst-bol-' + edit.field); out.editado = { de: inp.value, a: edit.value }; inp.value = edit.value; inp.dispatchEvent(new Event('input')); }
    if (confirm) { const ok = card.querySelector('.na-asst-ok'); ok.click(); out.tras_confirmar = { boton: ok.textContent, aviso: card.querySelector('.na-asst-bol-warn').textContent, dijo: window.__said.slice(), compra_prellenada: window.__filled.slice() }; }
    out.localStorage = Object.keys(localStorage);
    return out; }, [caseId, '/_t/img/' + img, clear, confirm, edit, role]);
  r.ms = Date.now() - t0; console.error(caseId, JSON.stringify(r).slice(0, 600)); return r;
}
if (STAGE === 'boleta' || STAGE === 'all') {
  for (const [id, img] of [['OCR-001', 'ocr001.jpg'], ['OCR-002', 'ocr002.jpg'], ['OCR-003', 'ocr003.jpg'], ['OCR-004', 'ocr004.jpg'], ['OCR-005', 'ocr005.jpg'], ['OCR-006', 'ocr006.jpg'], ['OCR-006b', 'ocr006b.jpg'], ['OCR-021', 'ocr021.jpg'], ['OCR-023', 'ocr023.jpg']])
    res[id] = await boleta(id + '-boleta', img, { clear: true });
  res['OCR-024'] = await boleta('OCR-024-boleta', 'ocr024.jpg', { clear: true, confirm: true });
  res['OCR-020'] = await boleta('OCR-020-boleta', 'ocr014.jpg', { clear: true, role: 'employee' });
  save();
}
if (STAGE === 'dup' || STAGE === 'all') {
  res['OCR-012'] = { primera: await boleta('OCR-012-a', 'ocr014.jpg', { clear: true, confirm: true }), segunda: await boleta('OCR-012-b', 'ocr014.jpg', { confirm: true }) };
  const a = await boleta('OCR-019-a', 'ocr014.jpg', { clear: true });
  // corrige la descripción de la fila 2 (lo que el modelo haya leído) a como la llama el negocio, y confirma: se aprende en el aparato
  res['OCR-019'] = { primera: await boleta('OCR-019-a2', 'ocr014.jpg', { clear: true, confirm: true, edit: { row: 1, field: 'descripcion', value: 'GALLETA CHOKO 6 X 32G' } }), lectura_sin_editar: a };
  res['OCR-019'].segunda = await boleta('OCR-019-b', 'ocr019.jpg', {});
  res['OCR-018'] = await boleta('OCR-018-boleta', 'ocr014.jpg', { clear: true, confirm: true, edit: { row: 2, field: 'cant', value: '24' } });
  save();
}
if (STAGE === 'prod' || STAGE === 'all') {
  for (const [id, img] of [['OCR-010', 'ocr010.jpg'], ['OCR-011', 'ocr011.jpg']]) {
    const t0 = Date.now();
    const r = await pg.evaluate(async ([c, u]) => { window.__case = c; window.__role = 'owner'; window.__said = []; window.__newprod = []; const chat = document.getElementById('chat'); chat.innerHTML = '';
      const img = await fetch(u).then((r) => r.blob()).then((b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); }));
      const card = await window.NA_ASISTENTE_PRODUCTO_FOTO.start(img, host()); if (!card) return { dijo: window.__said };
      const out = { texto_tarjeta: card.textContent, campos: [...card.querySelectorAll('input')].map((i) => ({ valor: i.value, placeholder: i.placeholder })) };
      card.querySelector('button').click(); out.nuevo_producto_prellenado = window.__newprod; out.dijo = window.__said; return out; }, [id, '/_t/img/' + img]);
    r.ms = Date.now() - t0; res[id] = r; console.error(id, JSON.stringify(r).slice(0, 600));
  }
  save();
}
await br.close();
