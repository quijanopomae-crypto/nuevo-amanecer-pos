// Marca «na-work-pre» (sin parpadeo del Inicio viejo antes de WORK): solo en el dominio publicado, con tope corto, liberada si
// work-host.js no carga, y con el fondo del tema oscuro cuando ese es el tema guardado. La cabecera real se extrae de POS/index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html = readFileSync('POS/index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const headScript = scripts.find(s => s.includes('na-work-pre'));
const style = (html.match(/<style>([^<]*na-work-pre[^<]*)<\/style>/) || [])[1] || '';

function run({host = 'nuevo-amanecer-pos-web.nuevo-amanecer-pos.workers.dev', path = '/app/index.html', search = '', env = 'production', online = true, creds = {token: 't'}, mode, dark = false} = {}) {
  const set = new Set(), timers = [], dcl = [];
  const html = {classList: {add: c => set.add(c), remove: (...c) => c.forEach(x => set.delete(x)), contains: c => set.has(c)}};
  const store = {};
  if (creds !== null) store.na_cloud_sync_credentials = JSON.stringify(creds);
  if (mode !== undefined) store.na_v9_appearance = JSON.stringify({theme: 'verde', mode});
  const win = {
    NA_HOSTED_CONFIG: env ? {environment: env} : undefined,
    setTimeout: (fn, ms) => { timers.push({fn, ms}); return timers.length; },
    matchMedia: q => ({matches: dark && /dark/.test(q)}),
  };
  const ctx = {
    window: win, location: {hostname: host, pathname: path, search}, navigator: {onLine: online}, URLSearchParams,
    localStorage: {getItem: k => (k in store ? store[k] : null)}, JSON,
    document: {documentElement: html, addEventListener: (e, fn) => { if (e === 'DOMContentLoaded') dcl.push(fn); }},
  };
  ctx.window.document = ctx.document; ctx.window.location = ctx.location;
  vm.runInNewContext(headScript, Object.assign(ctx, {setTimeout: win.setTimeout}));
  return {set, timers, win, fireDcl: () => dcl.forEach(f => f()), advance: ms => timers.filter(t => t.ms <= ms).forEach(t => t.fn())};
}

test('la cabecera existe y el CSS oculta el body con fondo claro o, en tema oscuro, el fondo oscuro', () => {
  assert.ok(headScript, 'falta el script de na-work-pre en POS/index.html');
  assert.match(style, /html\.na-work-pre\{background:#f7fbff\}/);
  assert.match(style, /na-work-pre-dk\{background:#0f172a\}/);
  assert.match(style, /html\.na-work-pre body\{visibility:hidden\}/);
});

test('caso feliz: se marca, y el tope duro es corto (<= 6 s) y no menor a 3,5 s', () => {
  const r = run();
  assert.ok(r.set.has('na-work-pre'));
  const caps = r.timers.map(t => t.ms);
  assert.ok(caps.length >= 1 && Math.max(...caps) <= 6000, 'tope duro mayor a 6 s: ' + caps);
  assert.ok(Math.max(...caps) >= 3500, 'tope demasiado corto: dejaría ver el Inicio viejo en equipos lentos: ' + caps);
  r.timers.forEach(t => t.fn());
  assert.equal(r.set.has('na-work-pre'), false);
});

test('si work-host.js no cargó, la marca se libera al terminar de cargar la página (sin esperar el tope)', () => {
  const r = run();
  assert.ok(r.set.has('na-work-pre'));
  r.fireDcl();
  assert.equal(r.set.has('na-work-pre'), false, 'el Inicio viejo quedaría oculto hasta el tope');
});

test('si work-host.js sí cargó, al terminar de cargar la marca se mantiene (WORK la quita al abrir)', () => {
  const r = run();
  r.win.NA_WORK_HOST = {open() {}};
  r.fireDcl();
  assert.ok(r.set.has('na-work-pre'));
  r.timers.forEach(t => t.fn());
  assert.equal(r.set.has('na-work-pre'), false);
});

test('tema oscuro guardado (noche, o auto con el sistema oscuro): fondo oscuro; claro o auto claro: sin marca de oscuro', () => {
  assert.ok(run({mode: 'noche'}).set.has('na-work-pre-dk'));
  assert.ok(run({mode: 'auto', dark: true}).set.has('na-work-pre-dk'));
  assert.equal(run({mode: 'auto', dark: false}).set.has('na-work-pre-dk'), false);
  assert.equal(run({mode: 'claro', dark: true}).set.has('na-work-pre-dk'), false);
  assert.equal(run({}).set.has('na-work-pre-dk'), false);
});

test('al liberar se quitan las dos marcas (claro y oscuro)', () => {
  const r = run({mode: 'noche'});
  assert.deepEqual([...r.set].sort(), ['na-work-pre', 'na-work-pre-dk']);
  r.fireDcl();
  assert.equal(r.set.size, 0);
  const wh = readFileSync('POS/js/work-host.js', 'utf8');
  assert.match(wh, /classList\.remove\('na-work-pre', 'na-work-pre-dk'\)/);
});

test('sin marca: ?work=0, sin internet, sin sesión, sin token, otro dominio, fuera de /app, config no productiva', () => {
  for (const o of [{search: '?work=0'}, {online: false}, {creds: null}, {creds: {}}, {creds: {token: ''}},
    {host: 'localhost'}, {host: 'x.evil.workers.dev'}, {host: 'nuevo-amanecer-pos.workers.dev.evil.com'}, {path: '/otra'}, {env: 'staging'}, {env: ''}]) {
    assert.equal(run(o).set.size, 0, JSON.stringify(o));
  }
  assert.ok(run({search: '?work=1'}).set.has('na-work-pre'));
});
