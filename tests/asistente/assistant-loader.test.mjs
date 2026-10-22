// El cargador no baja NADA del asistente (ni JS ni CSS) si el servidor dice que el aparato no lo tiene (empleado en Apagado).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../POS/js/modules/asistente/asistente-loader.js', import.meta.url), 'utf8');
function run({ status, body, online = true, cache = {}, search = '', creds = true, fail = false, slot0 = false }) {
  const store = new Map(Object.entries(cache)); if (creds) store.set('na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://w.example', token: 't0k' }));
  const added = [], calls = [], listeners = {};
  const mk = (tag) => ({ tag, set src(v) { this._src = v; added.push(v); }, get src() { return this._src; }, set href(v) { this._href = v; added.push(v); }, get href() { return this._href; } });
  const slot = { removed: false, remove() { this.removed = true; delete ids.naAsstHero; } };
  const ids = slot0 ? { naAsstHero: slot } : {};
  const cls = new Set();
  const document = { readyState: 'complete', hidden: false, documentElement: { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }, createElement: mk, getElementById: (id) => ids[id] || null, head: { appendChild: (e) => { if (e.id) ids[e.id] = e; return e; } }, body: { appendChild: (e) => { if (e.onload) e.onload(); return e; } }, addEventListener: () => {} };
  const window = {
    location: { search }, document, navigator: { onLine: online },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    requestIdleCallback: (f) => f(), addEventListener: (n, f) => { listeners[n] = f; }, AbortController,
    fetch: async (url, init) => { calls.push({ url, init }); if (fail) throw new Error('red'); return { status, json: async () => body }; },
  };
  vm.runInNewContext(SRC, { window, URLSearchParams, setTimeout, clearTimeout, Date, JSON, String });
  return { added, calls, store, window, slot };
}
const tick = () => new Promise((r) => setTimeout(r, 10));
const ASSETS = ['css/asistente.css', 'js/modules/asistente/asistente-core.js', 'js/modules/asistente/asistente-ui.js'];

test('empleado en Apagado: 1 ping (~14 bytes de cuerpo, sin modelo) y 0 archivos del asistente', async () => {
  const r = run({ status: 403, body: { error: 'assistant_off' } }); await tick();
  assert.equal(r.calls.length, 1); assert.equal(r.calls[0].url, 'https://w.example/auth/assistant/chat');
  assert.equal(r.calls[0].init.body, '{"ping":true}'); assert.equal(r.calls[0].init.headers.authorization, 'Bearer t0k'); assert.equal(r.calls[0].init.credentials, 'omit');
  assert.deepEqual(r.added, [], 'no se carga ni JS ni CSS del asistente');
  assert.equal(r.store.get('na_asistente_acc'), undefined);
});

test('dueño: carga css + core + ui y recuerda el rol; empleado con nivel: también (solo burbuja)', async () => {
  const o = run({ status: 200, body: { ok: true, role: 'owner', level: null } }); await tick();
  assert.deepEqual(o.added, ASSETS); assert.equal(o.store.get('na_asistente_acc'), 'owner');
  const e = run({ status: 200, body: { ok: true, role: 'empleado:consultas', level: 'consultas' } }); await tick();
  assert.deepEqual(e.added, ASSETS); assert.equal(e.store.get('na_asistente_acc'), 'on');
});

test('aparato sin rol (403 reason sin_rol): carga para mostrar «Registrar este teléfono como Admin»', async () => {
  const r = run({ status: 403, body: { error: 'admin_only', reason: 'sin_rol' } }); await tick();
  assert.deepEqual(r.added, ASSETS);
});

test('revocado: si antes era «on» y ahora el servidor dice 403, se borra lo guardado y no se carga', async () => {
  const r = run({ status: 403, body: { error: 'assistant_off' }, cache: { na_asistente_acc: 'on' } }); await tick();
  assert.deepEqual(r.added, []); assert.equal(r.store.has('na_asistente_acc'), false);
});

test('sin internet: solo el último dueño confirmado carga (para «Asistente no disponible sin internet»); empleado nada', async () => {
  const o = run({ status: 0, body: {}, online: false, cache: { na_asistente_acc: 'owner' } }); await tick();
  assert.deepEqual(o.added, ASSETS); assert.equal(o.calls.length, 0);
  const e = run({ status: 0, body: {}, online: false, cache: { na_asistente_acc: 'on' } }); await tick();
  assert.deepEqual(e.added, []);
  const n = run({ status: 0, body: {}, fail: true }); await tick();
  assert.deepEqual(n.added, [], 'red caída y sin rol guardado: nada');
});

test('encendido por defecto: sin ?asistente=1 igual pregunta al servidor (el servidor decide); la marca vieja del prototipo se borra', async () => {
  const r = run({ status: 200, body: { ok: true, role: 'owner' }, cache: { na_asistente_proto: '1' } }); await tick();
  assert.equal(r.calls.length, 1); assert.deepEqual(r.added, ASSETS); assert.equal(r.store.has('na_asistente_proto'), false);
  assert.equal(r.window.NA_ASISTENTE_LOADER.enabled(), true); assert.equal(r.window.NA_ASISTENTE_LOADER.state(), 'owner');
});

test('?asistente=0 apaga ESTE aparato (queda guardado): ni ping ni archivos; ?asistente=1 lo vuelve a encender', async () => {
  const r = run({ status: 200, body: { ok: true, role: 'owner' }, search: '?asistente=0', cache: { na_asistente_acc: 'owner' } }); await tick();
  assert.equal(r.calls.length, 0); assert.deepEqual(r.added, []); assert.equal(r.store.get('na_asistente_off'), '1'); assert.equal(r.store.has('na_asistente_acc'), false);
  const again = run({ status: 200, body: { ok: true, role: 'owner' }, cache: { na_asistente_off: '1' } }); await tick();
  assert.equal(again.calls.length, 0, 'sigue apagado al volver a abrir'); assert.deepEqual(again.added, []);
  const on = run({ status: 200, body: { ok: true, role: 'owner' }, search: '?asistente=1', cache: { na_asistente_off: '1' } }); await tick();
  assert.equal(on.calls.length, 1); assert.deepEqual(on.added, ASSETS); assert.equal(on.store.has('na_asistente_off'), false);
});

test('interruptor de Configuración: apagar quita el hueco y no pregunta; encender pregunta y carga sin recargar la página', async () => {
  const r = run({ status: 200, body: { ok: true, role: 'owner' }, cache: { na_asistente_off: '1', na_asistente_acc: 'owner' }, slot0: true }); await tick();
  assert.equal(r.calls.length, 0); assert.deepEqual(r.added, []);
  const L = r.window.NA_ASISTENTE_LOADER;
  assert.equal(L.setEnabled(true), true); await tick();
  assert.equal(r.calls.length, 1); assert.deepEqual(r.added, ASSETS, 'se carga en el momento'); assert.equal(r.store.has('na_asistente_off'), false);
  let suspended = 0; r.window.NA_ASISTENTE = { suspend() { suspended++; }, resume() {} };
  assert.equal(L.setEnabled(false), false);
  assert.equal(suspended, 1, 'la interfaz ya cargada se esconde'); assert.equal(r.store.get('na_asistente_off'), '1'); assert.equal(r.store.has('na_asistente_acc'), false);
  L.ask(); await tick(); assert.equal(r.calls.length, 1, 'apagado: no se vuelve a preguntar');
});

test('el interruptor se pone junto a la lista de aparatos SOLO en modo Admin, una vez, y refleja lo que dijo el servidor', async () => {
  const mkEl = (tag) => { const e = { tag, children: [], parentElement: null, className: '', textContent: '', attrs: {}, listeners: {}, checked: false,
    appendChild(c) { c.parentElement = e; e.children.push(c); return c; }, insertBefore(c, ref) { c.parentElement = e; const i = e.children.indexOf(ref); if (i < 0) e.children.push(c); else e.children.splice(i, 0, c); return c; },
    setAttribute(k, v) { e.attrs[k] = v; }, addEventListener(n, f) { e.listeners[n] = f; },
    querySelector(sel) { const all = []; const walk = (n) => n.children.forEach((c) => { all.push(c); walk(c); }); walk(e);
      if (sel === '.na-asst-sw') return all.find((c) => /\bna-asst-sw\b/.test(c.className)) || null; if (sel === 'input') return all.find((c) => c.tag === 'input') || null; if (sel === 'small') return all.find((c) => c.tag === 'small') || null; return null; } };
    return e; };
  const host = mkEl('div'), list = mkEl('div'); list.id = 'naDevList'; host.appendChild(list);
  const r = run({ status: 403, body: { error: 'admin_only', reason: 'sin_rol' } });
  const d = r.window.document; d.createTextNode = (t) => ({ tag: '#text', textContent: t, children: [] });
  d.createElement = mkEl; d.querySelectorAll = (sel) => sel === '#naDevList' ? [list] : sel === '.na-asst-sw' ? host.children.filter((c) => /na-asst-sw/.test(c.className)) : [];
  const L = r.window.NA_ASISTENTE_LOADER;
  r.window.NA_ROLES = { isOwner: () => false }; L.cfgSwitch(); assert.equal(host.children.length, 1, 'empleado: no aparece');
  r.window.NA_ROLES = { isOwner: () => true }; L.cfgSwitch(); L.cfgSwitch();
  assert.equal(host.children.length, 2, 'Admin: aparece una sola vez'); const row = host.children[1];
  assert.match(row.className, /na9-row na9-row-sw na-asst-sw/); assert.equal(row.querySelector('input').checked, true, 'encendido por defecto');
  await tick(); assert.equal(L.state(), 'sin_rol'); assert.match(row.querySelector('small').textContent, /todavía no está habilitado como Admin del asistente/);
  const cb = row.querySelector('input'); cb.checked = false; cb.listeners.change();
  assert.equal(r.store.get('na_asistente_off'), '1'); assert.match(row.querySelector('small').textContent, /^Apagado/);
});

test('hueco de la tarjeta: si el último ping decía dueño y ahora dice empleado o apagado, el hueco se quita enseguida', async () => {
  const e = run({ status: 403, body: { error: 'assistant_off' }, cache: { na_asistente_acc: 'owner' }, slot0: true }); await tick();
  assert.equal(e.slot.removed, true); assert.deepEqual(e.added, []);
  const on = run({ status: 200, body: { ok: true, role: 'empleado:consultas', level: 'consultas' }, cache: { na_asistente_acc: 'owner' }, slot0: true }); await tick();
  assert.equal(on.slot.removed, true, 'empleado encendido: solo burbuja, sin tarjeta');
  const o = run({ status: 200, body: { ok: true, role: 'owner' }, cache: { na_asistente_acc: 'owner' }, slot0: true }); await tick();
  assert.equal(o.slot.removed, false, 'dueño: el hueco queda para la tarjeta');
});

test('hueco desde el primer pintado: <head> reserva el mismo alto que el hueco real (alto + márgenes + gap de 12 px) solo con dueño guardado', async () => {
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../../POS/index.html', import.meta.url), 'utf8');
  const loader = fs.readFileSync(new URL('../../POS/js/modules/asistente/asistente-loader.js', import.meta.url), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /localStorage\.getItem\('na_asistente_off'\)!=='1'&&localStorage\.getItem\('na_asistente_acc'\)==='owner'/);
  // 272+4+16+12 (<380, Bot 4 sobre 25ffde10: texto corto también a 360), 272+4+16+12 (380-699, Bot 4), 364+4+18+12, 280+4+18+12 (alto real de la tarjeta por tramo)
  for (const [px, q] of [[304, ''], [304, '@media (min-width:380px) and (max-width:699px)'], [398, '@media (min-width:700px)'], [314, '@media (min-width:1100px)']]) assert.ok(head.includes((q ? q + '{' : '') + 'html.na-asst-pre #pageMenu .main-scroll>.quick-stats{margin-top:' + px + 'px}'), String(px));
  assert.match(loader, /height:272px;margin:4px 0 16px/); assert.match(loader, /@media \(min-width:380px\) and \(max-width:699px\)\{#naAsstHero\{height:272px\}\}@media \(min-width:700px\)\{#naAsstHero\{height:364px;margin:4px 0 18px\}\}@media \(min-width:1100px\)\{#naAsstHero\{height:280px\}\}/);
  assert.match(loader, /classList\.remove\('na-asst-pre'\)/, 'el hueco real reemplaza al margen');
  assert.match(loader, /function release\(\)[^\n]*classList\.remove\('na-asst-owner', 'na-asst-pre'\)/, 'al liberar se quita todo');
  assert.equal((html.match(/asistente-loader\.js" defer/g) || []).length, 1);
});

// DOM mínimo para probar el aviso neutro (sin librerías).
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.parent = null; const self = this;
    this.classList = { set: new Set(), add(...c) { c.forEach((x) => this.set.add(x)); self.attrs.class = [...this.set].join(' '); }, remove(...c) { c.forEach((x) => this.set.delete(x)); self.attrs.class = [...this.set].join(' '); }, contains(c) { return this.set.has(c); } }; }
  get firstChild() { return this.children[0] || null; }
  get attributes() { return Object.keys(this.attrs).map((name) => ({ name })); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); this.attrs.class = v; } get className() { return this.attrs.class || ''; }
  set id(v) { this.attrs.id = v; } get id() { return this.attrs.id; }
  set textContent(v) { this.children = []; this._text = String(v); } get textContent() { return (this._text || '') + this.children.map((c) => c.textContent).join(''); }
  setAttribute(k, v) { if (k === 'class') this.className = v; else this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; if (k === 'class') this.classList.set = new Set(); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; } removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parent = null; return c; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
}
function domRun({ status, body }) {
  const store = new Map([['na_asistente_proto', '1'], ['na_asistente_acc', 'owner'], ['na_cloud_sync_credentials', JSON.stringify({ endpoint: 'https://w.example', token: 't' })]]);
  const html = new El('html'), head = new El('head'), bodyEl = new El('body'), menu = new El('section'); menu.id = 'pageMenu'; menu.classList.add('page', 'active');
  const scroll = new El('div'); scroll.className = 'main-scroll'; const qs = new El('div'); qs.className = 'quick-stats'; menu.appendChild(scroll); scroll.appendChild(qs); bodyEl.appendChild(menu);
  const observers = [];
  const byId = (id) => [head, bodyEl, ...head.all(), ...bodyEl.all()].find((e) => e.id === id) || null;
  scroll.querySelector = () => qs; scroll.insertBefore = (n, ref) => { n.parent = scroll; scroll.children.splice(Math.max(0, scroll.children.indexOf(ref)), 0, n); return n; };
  menu.querySelector = () => scroll;
  const document = { readyState: 'complete', hidden: false, documentElement: html, head, body: bodyEl, createElement: (t) => new El(t), getElementById: byId, addEventListener() {} };
  const window = { location: { search: '?asistente=1' }, document, navigator: { onLine: true }, performance: { mark() {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    requestIdleCallback: () => {}, addEventListener() {}, AbortController,
    MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.off = true; } },
    fetch: async () => ({ status, json: async () => body }) };
  vm.runInNewContext(SRC, { window, URLSearchParams, setTimeout, clearTimeout, Date, JSON, String, Array });
  return { window, document, menu, html, store, observers, byId };
}

test('servidor dice «no dueño» con la tarjeta puesta: TODO su contenido sale del DOM al instante; queda un aviso del mismo alto sin datos ni botones; se libera al salir de Inicio', async () => {
  const r = domRun({ status: 200, body: { ok: true, role: 'empleado:consultas', level: 'consultas' } });
  const slot = r.byId('naAsstHero'); assert.ok(slot, 'hueco reservado por el rol guardado');
  // la UI ya había pintado la tarjeta del dueño: título, datos, campo y atajos
  for (const [tag, txt] of [['h2', 'Asistente Nuevo Amanecer'], ['p', 'Hola Carlos, dueño · S/ 1,234.50 en caja'], ['input', ''], ['button', '¿Qué falta reponer?'], ['a', 'Ver ventas']]) { const e = new El(tag); e.textContent = txt; slot.appendChild(e); }
  slot.setAttribute('data-mode', 'owner'); slot.setAttribute('aria-label', 'Asistente');
  r.window.NA_ASISTENTE_SLOT.unreserve(); // lo mismo que hace el cargador al recibir el ping
  const same = r.byId('naAsstHero');
  assert.equal(same, slot, 'el hueco sigue (mismo alto: no mueve la pantalla)');
  assert.deepEqual(slot.all().map((e) => e.tagName), ['P'], 'solo el aviso; ningún botón, enlace ni campo');
  assert.equal(slot.textContent, 'El asistente no está disponible en este aparato.');
  assert.ok(!/Carlos|1,234|reponer|ventas|Asistente Nuevo/.test(slot.textContent), 'sin datos del dueño');
  assert.deepEqual(Object.keys(slot.attrs).sort(), ['class', 'id', 'role'], 'sin data-mode ni otros restos');
  assert.equal(slot.className, 'na-asst-gone');
  // al salir de Inicio se libera
  r.menu.classList.remove('active'); r.observers.forEach((o) => !o.off && o.cb());
  assert.equal(r.byId('naAsstHero'), null); assert.equal(r.html.classList.contains('na-asst-owner'), false);
});

test('el aviso neutro tiene el MISMO alto que la tarjeta (regla #naAsstHero) y la UI vacía la tarjeta por el cargador', () => {
  assert.match(SRC, /#naAsstHero\.na-asst-gone\{display:flex/); assert.ok(!/#naAsstHero\.na-asst-gone\{[^}]*height/.test(SRC), 'no cambia el alto');
  const ui = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /if \(Sx && Sx\.unreserve\) Sx\.unreserve\(\)/);
  assert.match(ui, /var IDLE_MS = 9000/); assert.match(ui, /root\.addEventListener\('scroll', function \(e\) \{ var t = e && e\.target; if \(t && t\.nodeType === 1 && panelEl && panelEl\.contains\(t\)\) return; hold\(\); \}, \{ passive: true, capture: true \}\)/);
  assert.match(ui, /thinking\.remove\(\); wake\(\);/);
});

test('revisión Bot 4 sobre 1b87710d: relleno del contenedor que se desplaza, pausa propia de la tarjeta y del panel, primera visita sin salto, textos', () => {
  const ui = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../POS/css/asistente.css', import.meta.url), 'utf8');
  // 1) Clientes: se rellena también el contenedor interno que se desplaza (#cliList o el que esté bajo la burbuja)
  // (50b6716b: reemplazado por el relleno MEDIDO del contenedor que desplaza la última fila; ver assistant-live-access.test.mjs)
  assert.match(ui, /function scrollerOf\(n, pg\)/); assert.match(ui, /function lastTappable\(pg, br\)/);
  // 2) la tarjeta de Inicio usa SU IntersectionObserver (no el de la burbuja)
  assert.match(ui, /function watchHero\(\)/); assert.match(ui, /var hp = doc\.hidden \|\| heroOff/); assert.doesNotMatch(ui, /var hp = [^;]*offscreen/);
  // 3) la cara del panel abierto no depende de la burbuja oculta: wake() la despierta
  assert.match(ui, /var pp = doc\.hidden \|\| !panelEl \|\| panelEl\.hidden \|\| rest/); assert.match(ui, /panelEl\.contains\(c\) \? pp/);
  // 4) primera visita con Inicio a la vista: no se inserta arriba (se espera a salir de Inicio o al próximo arranque)
  assert.match(ui, /menu\.classList\.contains\('active'\) && menu\.offsetParent !== null\) \{ heroDeferred = true; return; \}/);
  assert.match(ui, /else if \(heroDeferred\) renderHero\(\)/);
  // 5) textos: singular/plural, tarjeta hecha sin «Vence en»; sin PIN en la tarjeta (pedido del dueño: un toque de la sesión dueño)
  assert.match(ui, /' Te queda 1 intento\.'/); assert.match(css, /\.na-asst-card\[data-st="done"\] \.meta\{display:none\}/);
  assert.ok(!/pinBox|na-asst-pin/.test(ui)); assert.ok(!/\.na-asst-pin/.test(css));
  // 6) menos de 700 (también 360): atajos en una fila con texto corto
  assert.match(css, /@media \(max-width:699px\)\{#naAsstHero \.h-chips\{flex-wrap:nowrap/); assert.match(css, /@media \(max-width:379px\)\{#naAsstHero \.h-chips\{gap:6px\}#naAsstHero \.h-chip\{padding:8px 10px\}\}/);
});

test('interfaz: apagado en este aparato = sin burbuja, sin tarjeta, sin cuadros en Configuración; encender pregunta de nuevo', () => {
  const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
  assert.match(UI, /function offHere\(\) \{ try \{ return root\.localStorage\.getItem\('na_asistente_off'\) === '1'/);
  assert.match(UI, /function suspend\(\) \{\s*dropUi\(\);/); assert.match(UI, /\.na-asst-acc, \.na-asst-prov, \.na-asst-own, \.na-asst-reg/);
  assert.match(UI, /function refreshAccess\(opts\) \{\s*if \(offHere\(\)\) \{ suspend\(\); return Promise\.resolve\(null\); \}/);
  assert.match(UI, /function mount\(\) \{\s*if \(offHere\(\)\) return;/);
  assert.match(UI, /root\.NA_ASISTENTE = \{ suspend: suspend, resume: resume,/);
  const LOADER = readFileSync(new URL('../../POS/js/modules/asistente/asistente-loader.js', import.meta.url), 'utf8');
  assert.ok(!/Dueño|—/.test(LOADER.slice(LOADER.indexOf('function cfgText'), LOADER.indexOf('function cfgPaint'))), 'textos: Admin, sin rayas largas');
});
