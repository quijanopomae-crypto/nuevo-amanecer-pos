// (22-10) «Revisión del POS», nivel 3: pantallas por tipo de aparato (texto o menú cortado, botón chico, pantalla lenta).
// asistente-pantallas.js mide; asistente-loader.js guarda (máx. 60) y lo entrega dentro de «slow»; asistente-ui.js NO cambia; el servidor agrupa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { assistantReviewRoute, sanitizeReview, buildReviewSummary, parseLayoutName, layoutByDevice, LAYOUT_KINDS, REVIEW_PATH, REVIEW_DENIED, REVIEW_LIMITS } from '../../tools/cloudflare-lab/src/pos-assistant-review.js';
import { createMemoryUsageStore } from '../../tools/cloudflare-lab/src/pos-assistant.js';
const require = createRequire(import.meta.url);
const P = require('../../POS/js/modules/asistente/asistente-pantallas.js');
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const LOADER = readFileSync('POS/js/modules/asistente/asistente-loader.js', 'utf8');
const PANT = readFileSync('POS/js/modules/asistente/asistente-pantallas.js', 'utf8');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const jsonR = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const UA = { android: 'Mozilla/5.0 (Linux; Android 13; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Edg/124.0',
  samsung: 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36' };
const J = (x) => JSON.parse(JSON.stringify(x));
const SECRET = ['Rosa', 'Quispe', '45678912', '987654321', '1729550000000', 'S/ 25.50'];

// ---------- funciones puras ----------
test('tipo de aparato: celular / tableta / computadora por el ancho, táctil o mouse, orientación y sistema/navegador cortos (sin ids únicos)', () => {
  assert.equal(P.deviceKey({ width: 390, height: 844, touch: true, ua: UA.android }), 'tel,tactil,vert,Android,Chrome');
  assert.equal(P.deviceKey({ width: 599, height: 300, touch: true, ua: UA.samsung }), 'tel,tactil,horiz,Android,Samsung');
  assert.equal(P.deviceKey({ width: 600, height: 900, touch: true, ua: UA.android }).split(',')[0], 'tableta');
  assert.equal(P.deviceKey({ width: 1023, height: 768, touch: true, ua: UA.ipad }), 'tableta,tactil,horiz,iOS,Safari', 'iPad se presenta como Mac + táctil');
  assert.equal(P.deviceKey({ width: 1024, height: 768, touch: false, ua: UA.ipad }), 'pc,raton,horiz,Mac,Safari');
  assert.equal(P.deviceKey({ width: 1920, height: 1080, touch: false, ua: UA.win }), 'pc,raton,horiz,Windows,Edge');
  assert.equal(P.deviceKey({}), 'tel,raton,vert,otro,otro');
  assert.ok(P.deviceKey({ width: 390, height: 844, touch: true, ua: UA.android + ' build/XYZ123 id=abc' }).split(',').every((x) => /^[A-Za-z]+$/.test(x)));
});

test('etiqueta del elemento: solo etiqueta, id o una clase corta y la función del botón; números -> #; nunca su texto', () => {
  assert.equal(P.elLabel({ tag: 'BUTTON', id: 'btnCobrar', text: 'Rosa Quispe' }), 'button#btnCobrar');
  assert.equal(P.elLabel({ tag: 'DIV', cls: 'active menu-item', onclick: "goPage('pageCaja')" }), 'div.menu-item(goPage)');
  assert.equal(P.elLabel({ tag: 'A', id: 'cli-1729550000000' }), 'a#cli-#');
  assert.equal(P.elLabel({ tag: 'SPAN', role: 'button' }), 'span[button]');
  assert.equal(P.elLabel({ tag: 'BUTTON', id: '123', cls: '9x' }), 'button', 'id o clase que no empieza con letra: fuera');
  assert.equal(P.elLabel({ tag: 'BUTTON', onclick: 'abrirModalNuevoProductoDesdeCompra(5)' }), 'button', 'función de más de 20: fuera (el redactor la taparía)');
  assert.ok(P.elLabel({ tag: 'BUTTON', id: 'x'.repeat(60), onclick: 'f()' }).length <= 44);
});

test('botón chico (< 40 px, solo táctil), texto o menú cortado y página que se sale de lado', () => {
  assert.equal(P.smallTarget({ width: 30, height: 30 }, true), 30);
  assert.equal(P.smallTarget({ width: 120, height: 32.4 }, true), 32);
  assert.equal(P.smallTarget({ width: 44, height: 44 }, true), 0);
  assert.equal(P.smallTarget({ width: 40, height: 40 }, true), 0, '40 x 40 alcanza');
  assert.equal(P.smallTarget({ width: 20, height: 20 }, false), 0, 'con mouse no cuenta');
  assert.equal(P.smallTarget({ width: 0, height: 0 }, true), 0, 'escondido no cuenta');
  const box = { overflowX: 'hidden', overflowY: 'visible', scrollWidth: 180, clientWidth: 120, scrollHeight: 20, clientHeight: 20, rect: { left: 10, right: 130, width: 120, height: 20 } };
  assert.equal(P.clipped(box, 390), 60);
  assert.equal(P.clipped({ ...box, overflowX: 'auto' }, 390), 0, 'se puede deslizar: no está cortado');
  assert.equal(P.clipped({ ...box, overflowX: 'visible', textOverflow: 'ellipsis' }, 390), 60, 'con «…» también');
  assert.equal(P.clipped({ ...box, scrollWidth: 121 }, 390), 0, 'tolerancia de 2 px');
  assert.equal(P.clipped({ ...box, overflowX: 'visible', overflowY: 'hidden', scrollHeight: 64, clientHeight: 40 }, 390), 24);
  assert.equal(P.clipped({ overflowX: 'visible', rect: { left: 300, right: 470, width: 170, height: 30 } }, 390), 80, 'menú que se sale del borde');
  assert.equal(P.clipped({ overflowX: 'visible', rect: { left: 300, right: 470, width: 170, height: 30 }, inScroller: true }, 390), 0, 'dentro de una fila deslizable: normal');
  assert.equal(P.pageOverflow(430, 390), 40); assert.equal(P.pageOverflow(391, 390), 0); assert.equal(P.pageOverflow(500, 0), 0);
  assert.equal(P.findingName('tel,tactil,vert,Android,Chrome', 'pageReporteProductosVencer', 'button#x'), 'tel,tactil,vert,Android,Chrome|pageReporteProductosVen|button#x', 'pantalla cortada a 23');
});

// ---------- en el navegador (DOM falso): cargador + módulo juntos ----------
function fakeEl({ tag = 'button', id = '', cls = '', onclick = null, role = null, type = null, rect, cs = {}, sw, cw, sh, ch, parent = null, labels }) {
  const reads = [];
  const e = { tagName: tag.toUpperCase(), id, className: cls, parentElement: parent, _rect: rect, _cs: { overflowX: 'visible', overflowY: 'visible', textOverflow: 'clip', ...cs },
    scrollWidth: sw ?? rect.width, clientWidth: cw ?? rect.width, scrollHeight: sh ?? rect.height, clientHeight: ch ?? rect.height, reads,
    getAttribute: (n) => (n === 'onclick' ? onclick : n === 'role' ? role : n === 'type' ? type : null), labels, getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }),
    matches: (sel) => /^(button|a|input|select|textarea|summary)$/i.test(tag) || onclick != null || role === 'button',
    closest: (sel) => { if (sel.includes('naAsst')) return /^naAsst/.test(id) || /na-asst/.test(cls) ? e : null; if (sel.includes('goPage')) return onclick && /goPage/.test(onclick) ? e : null;
      if (sel.startsWith('label,button')) { for (let x = e; x; x = x.parentElement) if (/^(LABEL|BUTTON|A)$/.test(x.tagName) || x.getAttribute('onclick') != null) return x; } return null; } };
  for (const k of ['innerText', 'textContent', 'value', 'innerHTML', 'outerHTML', 'title', 'ariaLabel']) Object.defineProperty(e, k, { get() { reads.push(k); return 'Rosa Quispe 45678912 S/ 25.50'; } });
  return e;
}
function browser({ width = 390, height = 844, touch = true, ua = UA.android, acc = 'owner', els = [], docWidth = 390, forLabels = {} } = {}) {
  const store = new Map([['na_asistente_acc', acc]]); const L = {}, D = {}, later = [], scripts = [];
  let now = Date.parse('2026-10-22T10:00:00Z');
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const on = (o) => (n, f) => { (o[n] = o[n] || []).push(f); };
  const page = { id: 'pagePOS', querySelectorAll: () => els };
  const document = { readyState: 'complete', hidden: false, documentElement: { classList: { add() {}, remove() {} }, scrollWidth: docWidth }, getElementById: () => null,
    createElement: (t) => ({ tag: t, set src(v) { scripts.push(v); } }), querySelector: (s) => { if (s === '.page.active') return page; const m = /^label\[for="([\w-]+)"\]$/.exec(s); return m ? forLabels[m[1]] || null : null; }, querySelectorAll: () => [],
    head: { appendChild() {} }, body: { appendChild() {} }, addEventListener: on(D) };
  const window = { location: { search: '', href: 'https://pos.example/index.html', origin: 'https://pos.example' }, document, innerWidth: width, innerHeight: height,
    navigator: { onLine: true, userAgent: ua, maxTouchPoints: touch ? 5 : 0 }, matchMedia: () => ({ matches: touch }), getComputedStyle: (e) => e._cs || { overflowX: 'visible' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    requestIdleCallback: (f) => f({ timeRemaining: () => 50, didTimeout: false }), requestAnimationFrame: (f) => f(), addEventListener: on(L), AbortController,
    fetch: async () => ({ status: 200, json: async () => ({ ok: true, role: acc === 'owner' ? 'owner' : 'empleado:consultas' }) }),
    setInterval: () => 1, setTimeout: (f) => { later.push(f); return later.length; } };
  const ctx = { window, URLSearchParams, URL, setTimeout: window.setTimeout, clearTimeout: () => {}, Date: FakeDate, JSON, String, Object, Number, Math, Array, Set };
  vm.runInNewContext(LOADER, ctx);
  const run = () => { for (let i = 0; i < 50 && later.length; i++) later.splice(0).forEach((f) => f()); };
  return { window, store, page, scripts, setEls: (x) => { els.length = 0; els.push(...x); }, L, D, run, ctx, tick: (ms) => { now += ms; }, R: window.NA_ASISTENTE_REVISION,
    loadModule: () => vm.runInNewContext(PANT, ctx), saved: () => { (L.pagehide || []).forEach((f) => f()); return JSON.parse(store.get('na_asst_rev') || 'null'); } };
}

test('Admin: el cargador baja asistente-pantallas.js recién en un momento libre (no al abrir); empleado: nunca', () => {
  const o = browser(); assert.deepEqual(o.scripts, [], 'nada al abrir'); o.run(); assert.ok(o.scripts.includes('js/modules/asistente/asistente-pantallas.js'));
  assert.equal(o.scripts.filter((s) => /pantallas/.test(s)).length, 1, 'una sola vez');
  const e = browser({ acc: 'on' }); e.run(); assert.ok(!e.scripts.some((s) => /pantallas/.test(s)));
  assert.match(LOADER, /PANT_DELAY_MS = 5000/);
});

test('celular táctil: detecta botón chico, texto cortado y página que se sale de lado; nunca lee el texto de la pantalla', () => {
  const asst = fakeEl({ id: 'naAsstFab', rect: { left: 0, top: 0, width: 20, height: 20 } }); // el propio asistente no cuenta
  const els = [fakeEl({ id: 'btnMas', rect: { left: 10, top: 10, width: 28, height: 28 } }),
    fakeEl({ tag: 'label', cls: 'prod-name', rect: { left: 10, top: 50, width: 120, height: 20 }, cs: { overflowX: 'hidden' }, sw: 200 }),
    fakeEl({ tag: 'button', id: 'btnCobrar', rect: { left: 10, top: 90, width: 300, height: 56 } }), // bien
    fakeEl({ tag: 'button', id: 'cli-1729550000000', rect: { left: 10, top: 160, width: 30, height: 60 } }),
    fakeEl({ tag: 'div', cls: 'hidden-x', rect: { left: 0, top: 0, width: 0, height: 0 } }), asst];
  const b = browser({ els, docWidth: 430 }); b.run(); b.loadModule(); b.run();
  const s = b.saved(); const k = s.l.map((x) => [x.kind, x.name, x.worst]);
  const dev = 'tel,tactil,vert,Android,Chrome';
  assert.deepEqual(J(k), [['desborde', dev + '|pagePOS|pagina', 40], ['boton_chico', dev + '|pagePOS|button#btnMas', 28], ['corte', dev + '|pagePOS|label.prod-name', 80], ['boton_chico', dev + '|pagePOS|button#cli-#', 30]]);
  assert.ok(s.l.every((x) => x.count === 1), 'un elemento por hallazgo');
  for (const e of els) assert.equal(e.reads.length, 0, 'no se leyó texto: ' + e.id);
  const all = JSON.stringify(s) + JSON.stringify(b.R.data()); for (const bad of SECRET) assert.ok(!all.includes(bad), bad);
  assert.equal(b.R.newErrors(), 0, 'sin avisos: los problemas de pantalla no cuentan como novedad');
  // la misma pantalla no se vuelve a revisar enseguida (máx. 1 vez cada 10 min por pantalla y aparato)
  b.window.NA_ASISTENTE_PANTALLAS && b.run(); b.tick(1000); (b.L.resize || []).forEach((f) => f()); b.run();
  assert.equal(b.saved().l.find((x) => x.kind === 'boton_chico').last, '2026-10-22T10:00:00.000Z');
  b.tick(11 * 60000); (b.L.resize || []).forEach((f) => f()); b.run();
  const again = b.saved().l.find((x) => x.kind === 'boton_chico');
  assert.deepEqual([again.count, again.last, again.first], [1, '2026-10-22T10:11:01.000Z', '2026-10-22T10:00:00.000Z'], 'pasados 10 min se revisa otra vez: se REEMPLAZA (count sigue en 1) y se conserva desde cuándo');
});

test('computadora con mouse: sin botones chicos; tope de 15 hallazgos por revisión y 300 elementos por pantalla', () => {
  const small = Array.from({ length: 30 }, (_, i) => fakeEl({ id: 'b' + 'abcdefghijklmnopqrstuvwxyzABCD'[i], rect: { left: 0, top: i * 30, width: 20, height: 20 } }));
  const pc = browser({ width: 1440, height: 900, touch: false, ua: UA.win, els: small, docWidth: 1440 }); pc.run(); pc.loadModule(); pc.run();
  assert.equal((pc.saved()?.l || []).length, 0);
  const t = browser({ els: small }); t.run(); t.loadModule(); t.run();
  assert.equal(t.saved().l.length, P.MAX_FIND);
  const many = Array.from({ length: 1000 }, () => fakeEl({ tag: 'div', rect: { left: 0, top: 0, width: 100, height: 50 } }));
  let looked = 0; many.forEach((e) => { const g = e.getBoundingClientRect; e.getBoundingClientRect = () => { looked++; return g(); }; });
  const m = browser({ els: many }); m.run(); m.loadModule(); m.run(); assert.ok(looked <= P.MAX_EL, 'miró ' + looked);
});

test('pantalla lenta: el cambio de pantalla de 1,5 s o más queda por aparato; uno rápido no', () => {
  const b = browser(); b.run(); b.loadModule(); b.run();
  const nav = (to, ms) => { const btn = fakeEl({ onclick: "goPage('" + to + "')", rect: { left: 0, top: 0, width: 80, height: 48 } });
    (b.D.click || []).forEach((f) => f({ target: btn })); b.tick(ms); b.page.id = to; b.run(); };
  nav('pageInventario', 2300); nav('pageCaja', 200); nav('pageInventario', 1700);
  const l = b.saved().l.filter((x) => x.kind === 'lenta');
  assert.deepEqual(J(l.map((x) => [x.name, x.count, x.worst])), [['tel,tactil,vert,Android,Chrome|pageInventario|pantalla', 2, 2300]]);
});

test('cargador: máx. 60 hallazgos; en botón chico queda el lado MÁS chico; solo «lenta» entra suelta; salen al final de «slow» sin pasar de 200', () => {
  const b = browser(); b.run(); const D = 'tel,tactil,vert,Android,Chrome|';
  for (let i = 0; i < 9; i++) b.R._test.layoutScan(D + 'pag' + 'ABCDEFGHI'[i] + '|', Array.from({ length: 10 }, (_, j) => ({ kind: 'corte', name: D + 'pag' + 'ABCDEFGHI'[i] + '|div.c' + 'abcdefghij'[j], count: 1, sum: 10, worst: 10 })));
  b.R._test.layoutScan(D + 'pagePOS|', [{ kind: 'boton_chico', name: D + 'pagePOS|button#a', count: 2, sum: 52, worst: 22 }, { kind: 'boton_chico', name: 'tel,tactil,vert,Android,Chrome|pageCaja|button#x', count: 1, sum: 1, worst: 1 }, { kind: 'raro', name: D + 'pagePOS|x', count: 1 }]);
  b.R._test.layout('corte', D + 'pagePOS|div.suelto', 5); b.R._test.layout('raro', 'a|b|c', 1); b.R._test.layout('lenta', 'sin barras', 1);
  b.R._test.layout('lenta', D + 'pageCaja|pantalla', 1600); b.R._test.layout('lenta', D + 'pageCaja|pantalla', 2400);
  const s = b.saved(); assert.equal(s.l.length, 60); const bc = s.l.find((x) => x.kind === 'boton_chico'); assert.deepEqual([bc.count, bc.worst], [2, 22]);
  assert.ok(!s.l.some((x) => x.kind === 'raro' || /pageCaja\|button|suelto|sin barras/.test(x.name)), 'otra pantalla, otro tipo o suelto: no entra');
  const le = s.l.find((x) => x.kind === 'lenta'); assert.deepEqual([le.count, le.worst, le.sum], [2, 2400, 4000]);
  for (let i = 0; i < 250; i++) b.R._test.slow('api', 'w.example/r' + 'abcdefghij'[i % 10] + i, 4000);
  const d = b.R.data(); assert.equal(d.slow.length, 200); assert.equal(d.slow.slice(-60).filter((x) => x.kind === 'api').length, 0);
  assert.equal(d.slow.at(-1).kind, 'lenta'); assert.equal(d.slow.find((x) => x.kind === 'boton_chico').ms_max, 22);
});

test('arreglo 1: lo ya arreglado sale del informe (cada revisión de pantalla + aparato reemplaza la anterior) y lo que no se ve en 7 días vence', () => {
  const big = { width: 300, height: 48 };
  const btn = fakeEl({ id: 'btnMas', rect: { left: 10, top: 10, width: 28, height: 28 } });
  const lab = fakeEl({ tag: 'label', cls: 'prod-name', rect: { left: 10, top: 50, width: 120, height: 20 }, cs: { overflowX: 'hidden' }, sw: 200 });
  const b = browser({ els: [btn, lab] }); b.run(); b.loadModule(); b.run();
  assert.deepEqual(J(b.saved().l.map((x) => x.kind)), ['boton_chico', 'corte']);
  b.R._test.layoutScan('tel,tactil,vert,Android,Chrome|pageCaja|', [{ kind: 'corte', name: 'tel,tactil,vert,Android,Chrome|pageCaja|th.total', count: 1, sum: 9, worst: 9 }]); // otra pantalla
  b.setEls([fakeEl({ id: 'btnMas', rect: { left: 10, top: 10, ...big } }), lab]); // se agrandó el botón
  b.tick(11 * 60000); b.window.NA_ASISTENTE_PANTALLAS.scanNow(); b.run();
  assert.deepEqual(J(b.saved().l.map((x) => [x.kind, x.name.split('|')[1]])), [['corte', 'pageCaja'], ['corte', 'pagePOS']], 'el botón arreglado ya no está; la otra pantalla sigue');
  b.setEls([]); b.tick(11 * 60000); b.window.NA_ASISTENTE_PANTALLAS.scanNow(); b.run();
  assert.deepEqual(J(b.saved().l.map((x) => x.name.split('|')[1])), ['pageCaja'], 'revisión sin problemas: la pantalla queda limpia');
  b.R._test.layout('lenta', 'tel,tactil,vert,Android,Chrome|pageKardex|pantalla', 2000);
  b.tick(8 * 864e5); assert.equal(b.R.data().slow.length, 0, 'a los 7 días sin volver a verse, todo vence (también «lenta»)');
});

test('arreglo 2: «count» = elementos distintos con el problema, no revisiones; el informe dice «N elementos»', () => {
  const qty = () => Array.from({ length: 3 }, (_, i) => fakeEl({ cls: 'btn-qty', rect: { left: 10, top: i * 40, width: 26, height: 26 } }));
  const b = browser({ els: qty() }); b.run(); b.loadModule(); b.run();
  for (let k = 0; k < 4; k++) { b.tick(11 * 60000); b.window.NA_ASISTENTE_PANTALLAS.scanNow(); b.run(); }
  const l = b.saved().l; assert.equal(l.length, 1); assert.deepEqual([l[0].count, l[0].worst], [3, 26], '3 botones, revisado 5 veces: sigue en 3');
  const sent = uiReviewData()({ NA_ASISTENTE_REVISION: b.R }, C)();
  const t = buildReviewSummary(sanitizeReview(sent));
  assert.match(t, /• Celular táctil vertical \(Android, Chrome\): 3 botones chicos\./); assert.match(t, /Vender: botón chico button\.btn-qty \(26 px; mínimo 40\), 3 elementos/);
  assert.doesNotMatch(t, /veces/);
  assert.deepEqual(J(P.groupFindings([{ kind: 'corte', name: 'a', v: 5 }, { kind: 'corte', name: 'a', v: 9 }, { kind: 'boton_chico', name: 'a', v: 30 }, { kind: 'boton_chico', name: 'a', v: 20 }])),
    [{ kind: 'corte', name: 'a', count: 2, sum: 14, worst: 9 }, { kind: 'boton_chico', name: 'a', count: 2, sum: 50, worst: 20 }]);
});

test('arreglo 3: se mide lo que de verdad se toca (label que envuelve, label con for=, botón que contiene); campos de texto con 32 px', () => {
  const lbl = fakeEl({ tag: 'label', cls: 'na9-sw', rect: { left: 0, top: 0, width: 300, height: 48 } });
  const inLabel = fakeEl({ tag: 'input', type: 'checkbox', id: 'swA', rect: { left: 5, top: 15, width: 18, height: 18 }, parent: lbl });
  const forLab = fakeEl({ tag: 'label', rect: { left: 0, top: 60, width: 220, height: 44 } });
  const byFor = fakeEl({ tag: 'input', type: 'radio', id: 'opB', rect: { left: 5, top: 70, width: 18, height: 18 } });
  const viaLabels = fakeEl({ tag: 'input', type: 'checkbox', id: 'opC', rect: { left: 5, top: 120, width: 18, height: 18 }, labels: [fakeEl({ tag: 'label', rect: { left: 0, top: 110, width: 200, height: 44 } })] });
  const wrapBtn = fakeEl({ tag: 'div', onclick: 'toggleX()', rect: { left: 0, top: 170, width: 200, height: 52 } });
  const inBtn = fakeEl({ tag: 'span', role: 'button', rect: { left: 5, top: 180, width: 20, height: 20 }, parent: wrapBtn });
  const alone = fakeEl({ tag: 'input', type: 'checkbox', id: 'solo', rect: { left: 5, top: 240, width: 18, height: 18 } });
  const tinyLabel = fakeEl({ tag: 'label', rect: { left: 0, top: 280, width: 30, height: 22 } });
  const inTiny = fakeEl({ tag: 'input', type: 'checkbox', id: 'chico', rect: { left: 5, top: 282, width: 18, height: 18 }, parent: tinyLabel });
  const text36 = fakeEl({ tag: 'input', type: 'text', id: 'buscar', rect: { left: 0, top: 320, width: 300, height: 36 } });
  const text28 = fakeEl({ tag: 'input', id: 'precio', rect: { left: 0, top: 370, width: 120, height: 28 } });
  const sel34 = fakeEl({ tag: 'select', id: 'unidad', rect: { left: 0, top: 410, width: 140, height: 34 } });
  const b = browser({ els: [inLabel, byFor, viaLabels, inBtn, alone, inTiny, text36, text28, sel34], forLabels: { opB: forLab } }); b.run(); b.loadModule(); b.run();
  assert.deepEqual(J(b.saved().l.map((x) => [x.name.split('|')[2], x.worst])), [['input#solo', 18], ['input#chico', 22], ['input#precio', 28]]);
  for (const e of [inLabel, byFor, viaLabels, inBtn, lbl, forLab, wrapBtn]) assert.equal(e.reads.length, 0, 'sin leer texto');
  assert.equal(P.fieldMin('INPUT', 'text'), 32); assert.equal(P.fieldMin('input', null), 32); assert.equal(P.fieldMin('TEXTAREA'), 32); assert.equal(P.fieldMin('input', 'checkbox'), 40); assert.equal(P.fieldMin('BUTTON'), 40);
  assert.deepEqual(P.tapRect({ width: 18, height: 18 }, [{ width: 300, height: 48 }, { width: 30, height: 22 }]), { width: 300, height: 48 });
  assert.equal(P.smallTarget({ width: 300, height: 34 }, true, 32), 0); assert.equal(P.smallTarget({ width: 300, height: 30 }, true, 32), 30);
});

test('menor: no es «se sale del borde» si un padre lo esconde a propósito (overflow hidden/clip, transform) o el elemento está movido', () => {
  const off = (parent, cs = {}) => fakeEl({ tag: 'nav', cls: 'drawer', rect: { left: -280, top: 0, width: 280, height: 600 }, parent, cs });
  const clipP = fakeEl({ tag: 'div', rect: { left: 0, top: 0, width: 390, height: 600 }, cs: { overflow: 'hidden', overflowX: 'hidden' } });
  const trP = fakeEl({ tag: 'div', rect: { left: 0, top: 0, width: 390, height: 600 }, cs: { transform: 'matrix(1, 0, 0, 1, -280, 0)' } });
  const plainP = fakeEl({ tag: 'div', rect: { left: 0, top: 0, width: 390, height: 600 } });
  const b = browser({ els: [off(clipP), off(trP), off(null, { transform: 'translateX(-100%)' }), off(null, { visibility: 'hidden' }), fakeEl({ tag: 'div', cls: 'menu', rect: { left: 300, top: 0, width: 170, height: 40 }, parent: plainP })] });
  b.run(); b.loadModule(); b.run();
  assert.deepEqual(J(b.saved().l.map((x) => [x.kind, x.name.split('|')[2], x.worst])), [['corte', 'div.menu', 80]]);
});

// ---------- asistente-ui.js SIN cambios: lo que arma hoy ya lleva los hallazgos ----------
function uiReviewData() {
  const a = UI.indexOf('  var CLI_RE = '), b = UI.indexOf('  // «cliente #código» del informe');
  return new Function('root', 'C', UI.slice(a, b) + '\nreturn reviewData;');
}
test('la UI de hoy (reviewData) y el redactor dejan pasar los hallazgos tal cual; con compactReview (si existe) siguen bajo 64 KB', () => {
  const b = browser(); b.run();
  b.R._test.layoutScan('tel,tactil,vert,Android,Chrome|pagePOS|', [{ kind: 'boton_chico', name: 'tel,tactil,vert,Android,Chrome|pagePOS|button#btnMas(sumar)', count: 1, sum: 28, worst: 28 }]);
  b.R._test.layoutScan('tableta,tactil,horiz,iOS,Safari|pageInventario|', [{ kind: 'corte', name: 'tableta,tactil,horiz,iOS,Safari|pageInventario|th.col-nombre', count: 1, sum: 64, worst: 64 }]);
  b.R._test.layout('lenta', 'pc,raton,horiz,Windows,Edge|pageKardex|pantalla', 2400);
  const sent = uiReviewData()({ NA_ASISTENTE_REVISION: b.R }, C)();
  assert.deepEqual(J(sent.slow.map((x) => [x.kind, x.name])), [['boton_chico', 'tel,tactil,vert,Android,Chrome|pagePOS|button#btnMas(sumar)'], ['corte', 'tableta,tactil,horiz,iOS,Safari|pageInventario|th.col-nombre'], ['lenta', 'pc,raton,horiz,Windows,Edge|pageKardex|pantalla']]);
  if (typeof C.compactReview === 'function') assert.equal(C.compactReview(sent).slow.length, 3, 'con pocos lentos, compactReview (#934) los deja pasar');
  const d = sanitizeReview(sent); assert.equal(d.layout.length, 3); assert.equal(d.slow.length, 0, 'no se mezclan con la lentitud de siempre');
  // peor caso: 200 errores, 300 contadores, 140 lentos y 60 hallazgos con nombres al tope
  for (let i = 0; i < 200; i++) b.R._test.slow('api', 'w.example/' + 'r'.repeat(60) + i, 4000);
  for (let p = 0; p < 4; p++) { const pre = 'tableta,tactil,horiz,ChromeOS,Samsung|pageReporteProductos' + 'ABCD'[p] + '|';
    b.R._test.layoutScan(pre, Array.from({ length: 15 }, (_, i) => ({ kind: 'corte', name: (pre + 'div.' + 'k'.repeat(15) + String.fromCharCode(97 + i)).slice(0, 80), count: 999, sum: 999e3, worst: 999 }))); }
  const big = uiReviewData()({ NA_ASISTENTE_REVISION: { data: () => ({ ...b.R.data(), errors: Array.from({ length: 200 }, (_, i) => ({ kind: 'error', msg: 'TypeError ' + 'm'.repeat(150) + i, src: 'js/' + 'f'.repeat(70) + '.js:1', count: 1 })),
    usage: Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['pagePOS:accion' + i, i + 1])) }) } }, C)();
  const lay = JSON.stringify(big.slow.filter((x) => LAYOUT_KINDS.includes(x.kind))); assert.equal(big.slow.filter((x) => LAYOUT_KINDS.includes(x.kind)).length, 60, "tope de 60");
  assert.ok(Buffer.byteLength(lay) < 16 * 1024, 'los 60 hallazgos pesan ' + Buffer.byteLength(lay));
  if (typeof C.compactReview === 'function') { // llega con #934: recorta a 64 KB
    const c = C.compactReview(big); assert.ok(Buffer.byteLength(JSON.stringify(c)) <= (C.REVIEW_BUDGET || 65536));
  } else assert.ok(Buffer.byteLength(JSON.stringify(big)) < REVIEW_LIMITS.maxBodyBytes, 'sin compactReview el cuerpo entra igual bajo el tope del servidor: ' + Buffer.byteLength(JSON.stringify(big)));
});

// ---------- servidor ----------
const DEV = 'tel,tactil,vert,Android,Chrome', TAB = 'tableta,tactil,horiz,iOS,Safari';
const LAYOUT_BODY = { errors: [], usage: {}, slow: [
  { kind: 'boton_chico', name: DEV + '|pagePOS|button#btnMas', count: 7, ms_avg: 28, ms_max: 26 },
  { kind: 'corte', name: DEV + '|pagePOS|label.prod-name', count: 3, ms_avg: 60, ms_max: 80 },
  { kind: 'desborde', name: DEV + '|pageClientes|pagina', count: 2, ms_avg: 40, ms_max: 40 },
  { kind: 'lenta', name: TAB + '|pageInventario|pantalla', count: 2, ms_avg: 2000, ms_max: 2300 },
  { kind: 'corte', name: DEV + '|pagePOS|Rosa Quispe 45678912', count: 1, ms_avg: 5, ms_max: 5 }, // texto: no es un elemento válido
  { kind: 'corte', name: 'iPhone de Rosa,tactil,vert,iOS,Safari|pagePOS|button#a', count: 1, ms_avg: 5, ms_max: 5 }, // aparato fuera de la lista
  { kind: 'corte', name: DEV + '|pagePOS|button#pin-1234', count: 1, ms_avg: 5, ms_max: 5 },
  { kind: 'cuelgue', name: 'pageCaja', count: 1, ms_avg: 7000, ms_max: 7000 }] };
async function route(body, { role = 'owner', posRole = 'owner' } = {}) {
  const r = await assistantReviewRoute(new Request('https://w.test' + REVIEW_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { ASSISTANT_ENABLED: '1' }, { principalId: 'session:x', posRole }, jsonR, { store: createMemoryUsageStore(), resolveRole: async () => role, fetch: async () => { throw new Error('sin modelo'); } });
  return { r, d: await r.json() };
}
test('servidor: solo partes válidas (aparato de la lista, pantalla, elemento sin texto); agrupa por tipo de aparato con conteos', () => {
  assert.deepEqual(parseLayoutName(DEV + '|pagePOS|button#btnMas'), { device: DEV, screen: 'pagePOS', el: 'button#btnMas' });
  assert.equal(parseLayoutName(DEV + '|pagePOS|Rosa Quispe').el, 'elemento');
  assert.equal(parseLayoutName(DEV + '|pagePOS 45678912|x').screen, 'otro');
  assert.equal(parseLayoutName('tel,tactil,vert,Android|pagePOS|x'), null); assert.equal(parseLayoutName('a|b'), null);
  const d = sanitizeReview(LAYOUT_BODY);
  assert.deepEqual(d.slow.map((x) => x.kind), ['cuelgue'], 'la lentitud de siempre sigue aparte');
  assert.ok(!JSON.stringify(d).includes('Rosa') && !JSON.stringify(d).includes('45678912') && !JSON.stringify(d).includes('1234'));
  const g = layoutByDevice(d.layout);
  assert.deepEqual(g.map((x) => [x.label, x.total]), [['Celular táctil vertical (Android, Chrome)', 13], ['Tableta táctil horizontal (iOS, Safari)', 1]]);
  assert.deepEqual(J(g[0].kinds), { corte: 5, desborde: 1, boton_chico: 7, lenta: 0 }, 'cuenta elementos afectados, no revisiones');
  assert.equal(d.layout.find((x) => x.el === 'elemento').count, 2, 'texto suelto y «pin-1234» (el redactor lo cambiaría) quedan como «elemento»');
  const t = buildReviewSummary(d);
  assert.match(t, /Pantallas por tipo de aparato: 14 problemas en 2 tipos de aparato\./);
  assert.match(t, /• Celular táctil vertical \(Android, Chrome\): 5 textos o menús cortados, 1 pantalla que se sale de lado, 7 botones chicos\./);
  assert.match(t, /  • Vender: botón chico button#btnMas \(26 px; mínimo 40\), 7 elementos/);
  assert.match(t, /  • Clientes: la pantalla se sale 40 px de lado\n/);
  assert.match(t, /  • Inventario: pantalla lenta, hasta 2,3 s, 2 veces/);
  assert.match(t, /Sugerencias:[\s\S]*Agrandar los botones chicos de Vender en Celular táctil vertical/);
  assert.doesNotMatch(buildReviewSummary(sanitizeReview({ errors: [], usage: {}, slow: [] })), /Pantallas/, 'sin datos, el informe de siempre');
  // menor: una pantalla lenta medida por aparato no sale dos veces (ni en «Lentitud» como «pantalla»)
  const dup = buildReviewSummary(sanitizeReview({ ...LAYOUT_BODY, slow: [...LAYOUT_BODY.slow, { kind: 'pantalla', name: 'pageInventario', count: 2, ms_avg: 2000, ms_max: 2300 }, { kind: 'pantalla', name: 'pageCaja', count: 1, ms_avg: 1800, ms_max: 1800 }] }));
  assert.doesNotMatch(dup, /Pantalla lenta al abrir Inventario/); assert.match(dup, /Pantalla lenta al abrir Caja/); assert.equal(dup.match(/Inventario: pantalla lenta/g).length, 1);
});

test('servidor: el Admin recibe los grupos por aparato; empleado y aparato sin rol siguen en 403 review_admin_only', async () => {
  const o = await route(LAYOUT_BODY); assert.equal(o.r.status, 200); assert.equal(o.d.source, 'resumen');
  assert.equal(o.d.layout.length, 2); assert.equal(o.d.layout[0].device, DEV); assert.ok(o.d.layout[0].items.some((x) => x.el === 'button#btnMas' && x.count === 7));
  assert.match(o.d.report, /Pantallas por tipo de aparato/);
  for (const bad of SECRET) assert.ok(!JSON.stringify(o.d).includes(bad), bad);
  const e = await route(LAYOUT_BODY, { role: 'empleado:consultas', posRole: 'empleado' }); assert.equal(e.r.status, 403); assert.deepEqual(e.d, REVIEW_DENIED);
  const n = await route(LAYOUT_BODY, { role: null, posRole: null }); assert.equal(n.r.status, 403);
  const big = { errors: [], usage: {}, slow: Array.from({ length: 500 }, (_, i) => ({ kind: 'corte', name: DEV + '|pagePOS|div.c' + i.toString(36).replace(/\d/g, 'q'), count: 1, ms_avg: 5, ms_max: 5 })) };
  const x = await route(big); assert.equal(x.r.status, 200); assert.ok(sanitizeReview(big).layout.length <= 60);
});
