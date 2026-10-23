// Casos de chat con imagen (assistantChatRoute ?image=1, como asistente-ui.js send()) y la cadena 014..018 con historial firmado + invoice_memory.
import { readFileSync, writeFileSync } from 'node:fs';
const OUT = '/workspace/_ocr_run/out', ONLY = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const img = (f) => 'data:image/jpeg;base64,' + readFileSync(f).toString('base64');
const I = (n) => img('/workspace/_ocr_run/img/' + n + '.jpg');
async function post(caso, path, body, { role = 'owner', session = caso } = {}) {
  const t0 = Date.now(); let r;
  for (let a = 0; a < 2; a++) { r = await fetch('http://127.0.0.1:8787' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-audit-case': caso, 'x-audit-role': role, 'x-audit-session': session }, body: JSON.stringify(body) });
    if (![502, 503, 504, 500].includes(r.status)) break; }
  const d = await r.json().catch(() => ({})); return { status: r.status, ms: Date.now() - t0, d };
}
const res = {};
const single = [['OCR-001', 'ocr001'], ['OCR-002', 'ocr002'], ['OCR-003', 'ocr003'], ['OCR-004', 'ocr004'], ['OCR-005', 'ocr005'], ['OCR-006', 'ocr006'], ['OCR-006b', 'ocr006b'],
  ['OCR-013', 'ocr013', 'registralo'], ['OCR-021', 'ocr021'], ['OCR-023', 'ocr023'], ['OCR-024', 'ocr024'], ['OCR-025', 'ocr025'],
  ['OCR-007', null, null, OUT + '/OCR-007_pdf.jpg'], ['OCR-022', null, 'actualiza todos mis precios con esto', OUT + '/OCR-022_pdf.jpg']];
const jobs = [];
for (const [id, n, text, file] of single) if (!ONLY || ONLY.has(id)) jobs.push(async () => {
  const r = await post(id, '/auth/assistant/chat?image=1', { raw_text: text || 'Lee esta factura de compra', image: file ? img(file) : I(n), history: [] });
  res[id] = { status: r.status, ms: r.ms, reply: r.d.reply, error: r.d.error, message: r.d.message, proposals: r.d.proposals, dropped: r.d.dropped };
  // OCR-006b: un segundo turno pidiendo "hazlo" para ver si la orden de la imagen se ejecuta desde la memoria de la factura
  if (id === 'OCR-006b' && r.d.invoice_memory) { const h = r.d.turns.map((t) => ({ role: t.role, content: t.content, sig: t.sig, n: t.n, iat: t.iat }));
    const r2 = await post(id + '-t2', '/auth/assistant/chat', { raw_text: 'ya, haz lo que dice la boleta', history: h, invoice_memory: r.d.invoice_memory }, { session: id });
    res[id].turno2 = { status: r2.status, ms: r2.ms, reply: r2.d.reply, proposals: r2.d.proposals, dropped: r2.d.dropped }; }
});
if (!ONLY || ONLY.has('OCR-014')) jobs.push(async () => {
  const S = 'cadena-014', steps = [['OCR-014-foto', null], ['OCR-014', 'la segunda fila son 16x6x32g, cuantos paquetes son'], ['OCR-015', 'UND en esa boleta es paquete'],
    ['OCR-016', 'cuanto cuesta cada pieza de esa fila'], ['OCR-017', 'registrala'], ['OCR-018', 'la fila 3 dice 12 pero son 24, corrigelo']];
  let hist = [], mem = null;
  for (const [id, text] of steps) {
    const body = id === 'OCR-014-foto' ? { raw_text: 'Lee esta factura de compra', image: I('ocr014'), history: [] } : { raw_text: text, history: hist.slice(-8), ...(mem ? { invoice_memory: mem } : {}) };
    const r = await post(id, id === 'OCR-014-foto' ? '/auth/assistant/chat?image=1' : '/auth/assistant/chat', body, { session: S });
    res[id] = { status: r.status, ms: r.ms, reply: r.d.reply, error: r.d.error, proposals: r.d.proposals, dropped: r.d.dropped, invoice_memory: !!r.d.invoice_memory };
    if (r.d.invoice_memory) mem = r.d.invoice_memory;
    if (Array.isArray(r.d.turns) && r.d.turns.length === 2) hist.push(...r.d.turns.map((t) => ({ role: t.role, content: t.content, sig: t.sig, n: t.n, iat: t.iat })));
  }
});
if (!ONLY || ONLY.has('OCR-020')) jobs.push(async () => {
  const a = await post('OCR-020-chat', '/auth/assistant/chat?image=1', { raw_text: 'Lee esta factura de compra', image: I('ocr014'), history: [] }, { role: 'employee' });
  const b = await post('OCR-020-boleta-directo', '/auth/assistant/boleta', { image: I('ocr014') }, { role: 'employee' });
  res['OCR-020'] = { chat: { status: a.status, ms: a.ms, d: a.d }, boleta: { status: b.status, ms: b.ms, d: b.d } };
});
if (!ONLY || ONLY.has('OCR-010')) for (const [id, n] of [['OCR-010', 'ocr010'], ['OCR-011', 'ocr011']]) jobs.push(async () => {
  const r = await post(id + '-ruta', '/auth/assistant/producto-foto', { image: I(n) }); res[id] = { status: r.status, ms: r.ms, d: r.d }; });
let i = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (i < jobs.length) await jobs[i++](); }));
writeFileSync(OUT + '/_chat' + (ONLY ? '-' + [...ONLY].join('_') : '') + '.json', JSON.stringify(res, null, 1));
console.error('fin');
