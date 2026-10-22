// «Subir archivo» en el asistente (fix/asistente-subir-archivo): sin «capture» (cámara, galería o archivos), fotos y PDF.
// El PDF se pasa a imagen EN EL APARATO con el pdf.js que ya trae el POS y sigue el camino de siempre (chat o «Leer boleta con IA»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = globalThis;
const P = require('../../POS/js/modules/asistente/asistente-pdf.js');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const PDF_SRC = readFileSync('POS/js/modules/asistente/asistente-pdf.js', 'utf8');
const SW = readFileSync('POS/sw.js', 'utf8');
const uiKind = new Function(UI.match(/  function fileKind\(f\) \{[\s\S]*?\n  \}\n/)[0] + 'return fileKind;')();

const CASES = [
  [{ name: 'boleta.jpg', type: 'image/jpeg' }, 'image'], [{ name: 'IMG_0001.HEIC', type: '' }, 'image'], [{ name: 'foto', type: 'image/png' }, 'image'],
  [{ name: 'factura.pdf', type: 'application/pdf' }, 'pdf'], [{ name: 'FACTURA.PDF', type: '' }, 'pdf'], [{ name: 'x', type: 'application/pdf' }, 'pdf'],
  [{ name: 'pedido.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, 'doc'], [{ name: 'lista.xlsx', type: '' }, 'doc'],
  [{ name: 'lista.xls', type: 'application/vnd.ms-excel' }, 'doc'], [{ name: 'datos.csv', type: 'text/csv' }, 'doc'], [{ name: 'nota.txt', type: 'text/plain' }, 'doc'],
  [{ name: 'app.apk', type: 'application/vnd.android.package-archive' }, 'other'], [{ name: 'musica.mp3', type: 'audio/mpeg' }, 'other'],
];

test('el botón ya no obliga a la cámara: acepta fotos y PDF, el teléfono ofrece cámara, galería o archivos', () => {
  const inp = UI.match(/<input type="file"[^>]*>/g); assert.equal(inp.length, 1);
  assert.equal(inp[0], '<input type="file" accept="image/*,application/pdf,.pdf" hidden>');
  assert.ok(!/capture="environment"/.test(UI));
  assert.match(UI, /class="na-asst-photo" aria-label="Enviar foto o PDF"/);
  // mismo botón y mismo lugar: el diseño del teléfono no cambia; el empleado sigue sin botón
  assert.match(UI, /if \(photoBtn\) photoBtn\.hidden = !canPhoto\(\); \/\/ empleado o proveedor sin fotos: sin botón/);
});

test('tipo de archivo: igual en la UI y en el módulo PDF', () => {
  for (const [f, k] of CASES) { assert.equal(uiKind(f), k, f.name); assert.equal(P.kind(f), k, f.name); }
});

test('Word/Excel y otros: aviso claro, no se manda nada; PDF solo Admin', () => {
  const ch = UI.slice(UI.indexOf('fileEl.onchange = function'), UI.indexOf("panelEl.querySelector('.na-asst-chips').addEventListener"));
  assert.match(ch, /if \(k === 'doc'\) \{ addMsg\('a', 'Por ahora leo fotos y PDF\. Si es Word o Excel, guárdelo como PDF o tómele una foto y súbalo\.'\); return; \}/);
  assert.match(ch, /if \(k === 'other'\) \{ addMsg\('a', 'Ese archivo no lo puedo leer\. Suba una foto o un PDF\.'\); return; \}/);
  assert.match(ch, /if \(k === 'pdf' && !isOwnerAccess\(\)\) \{ errMsg\('image_owner_only'\); return; \}/);
  assert.match(ch, /if \(mode === 'boleta'\) \{ if \(isOwnerAccess\(\)\) got\.then\(function \(r\) \{ boletaStart\(r\.blob\); \}/);
  assert.match(ch, /compress\(r\.blob\)\.then\(function \(img\) \{ send\(inputEl\.value \|\| 'Lee esta factura de compra', img\); \}/);
  assert.match(UI, /sc\.src = 'js\/modules\/asistente\/asistente-pdf\.js'/);
});

test('el PDF usa el pdf.js que ya trae el POS (ya en caché sin conexión), sin scripts ni eval', () => {
  assert.match(PDF_SRC, /var BASE = 'js\/ocr\/vendor\/pdfjs-6\.4\.299\/';/);
  assert.ok(SW.includes("'./js/ocr/vendor/pdfjs-6.4.299/pdf.min.mjs'") && SW.includes("'./js/ocr/vendor/pdfjs-6.4.299/pdf.worker.min.mjs'"));
  assert.match(PDF_SRC, /isEvalSupported: false, enableXfa: false/);
  assert.ok(!/innerHTML|fetch\(/.test(PDF_SRC), 'el PDF no se sube ni se inyecta');
});

test('inkBox recorta los márgenes en blanco; página en blanco = null', () => {
  const w = 100, h = 80, data = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(P.inkBox(data, w, h), null);
  for (let y = 30; y <= 40; y++) for (let x = 20; x <= 60; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  const b = P.inkBox(data, w, h); assert.deepEqual(b, { x: 4, y: 14, w: 74, h: 44 });
  const s = P.stack([{ w: 100, h: 50 }, { w: 60, h: 30 }]); assert.deepEqual(s, { w: 100, h: 104, at: [{ x: 0, y: 0 }, { x: 20, y: 74 }] });
});

function fakeDoc() {
  const made = [];
  return { made, createElement: () => { const cv = { width: 0, height: 0, draws: [], getContext: () => ({ fillRect() {}, set fillStyle(v) {}, drawImage: (...a) => cv.draws.push(a),
    getImageData: (x, y, w, h) => { const d = new Uint8ClampedArray(w * h * 4).fill(255); for (let i = 0; i < 4 * 50; i += 4) d[(10 * w * 4) + 40 + i] = 0; return { data: d }; } }),
    toBlob: (cb, type) => cb({ type, size: 1234 }) }; made.push(cv); return cv; } };
}
function fakeLib(numPages, opts = {}) {
  const st = { got: [], destroyed: 0, args: null };
  const pdf = { numPages, destroy() { st.destroyed++; }, getPage: async (n) => { st.got.push(n); return { getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: () => ({ promise: Promise.resolve() }), cleanup() {} }; } };
  return { st, lib: { getDocument: (a) => { st.args = a; return { promise: opts.fail ? Promise.reject(opts.fail) : Promise.resolve(pdf), destroy() { st.destroyed++; } }; } } };
}
const pdfFile = (body = '%PDF-1.7 ...', size) => ({ name: 'f.pdf', type: 'application/pdf', size: size ?? body.length, arrayBuffer: async () => new TextEncoder().encode(body).buffer });
globalThis.document = { baseURI: 'https://pos.test/app/' };

test('PDF de 5 páginas: se leen solo las 3 primeras, una sola imagen JPEG, y se cierra el PDF', async () => {
  const { st, lib } = fakeLib(5), doc = fakeDoc();
  const r = await P.toImage(pdfFile(), { doc, lib });
  assert.equal(r.pages, 3); assert.equal(r.total, 5); assert.deepEqual(st.got, [1, 2, 3]); assert.equal(r.blob.type, 'image/jpeg');
  assert.equal(st.destroyed, 1); assert.equal(st.args.isEvalSupported, false); assert.equal(st.args.enableXfa, false);
  const out = doc.made[doc.made.length - 1]; assert.equal(out.draws.length, 3, 'las 3 páginas apiladas en una imagen');
});

test('PDF con contraseña, dañado o muy grande: error claro y nada se manda', async () => {
  const pw = Object.assign(new Error('x'), { name: 'PasswordException' });
  await assert.rejects(P.toImage(pdfFile(), { doc: fakeDoc(), lib: fakeLib(1, { fail: pw }).lib }), (e) => e.code === 'pdf_password');
  await assert.rejects(P.toImage(pdfFile(), { doc: fakeDoc(), lib: fakeLib(1, { fail: new Error('bad') }).lib }), (e) => e.code === 'pdf_bad');
  await assert.rejects(P.toImage(pdfFile('<html>no'), { doc: fakeDoc(), lib: fakeLib(1).lib }), (e) => e.code === 'pdf_bad');
  await assert.rejects(P.toImage(pdfFile('%PDF-', 16 * 1024 * 1024), { doc: fakeDoc(), lib: fakeLib(1).lib }), (e) => e.code === 'pdf_too_large');
  assert.equal(P.message('pdf_password'), 'El PDF tiene contraseña. Suba una copia sin contraseña.');
  assert.equal(P.message('otro'), 'No pude abrir ese PDF.');
});
