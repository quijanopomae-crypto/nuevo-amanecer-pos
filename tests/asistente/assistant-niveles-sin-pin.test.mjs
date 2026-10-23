// Configuración > «Asistente en aparatos de empleado» (celular): cambiar el nivel de un empleado SIN PIN (pedido del dueño).
// Elegir el nivel muestra «Aplicar»; UN toque guarda por POST /auth/assistant/levels (solo Admin, bitácora existente, sin migración).
// Un empleado sigue sin poder cambiar niveles: el Worker responde 403 (forbidden_role en la puerta, admin_only en la ruta) y no guarda nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeCanon } from '../cloud-sync/canon-browser-harness.mjs';
import { LEVELS_PATH } from '../../tools/cloudflare-lab/src/pos-assistant-levels-route.js';

const UI = readFileSync(new URL('../../POS/js/modules/asistente/asistente-ui.js', import.meta.url), 'utf8');
const LEVELS_SRC = UI.match(/  var LEVELS = \[\[[^\n]*\n/)[0] + UI.match(/  var ACCESS_PATH = [^\n]*\n/)[0] + ((UI.match(/  var LEVELS_PATH = [^\n]*\n/) || [''])[0]);
const PAINT_SRC = UI.slice(UI.indexOf('  function paintAccess(box, d) {'), UI.indexOf('  async function get(path) {'));

// DOM mínimo: lo justo para la fila de un aparato (radios, estado, tarjeta con botones).
class El {
  constructor(tag, cls) { this.tag = tag; this.className = cls || ''; this.children = []; this.parent = null; this.dataset = {}; this.attrs = {}; this.textContent = ''; this.disabled = false; this.checked = false; this._html = ''; }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  focus() {}
  matches(sel) {
    let m;
    if ((m = sel.match(/^\.([\w-]+)$/))) return this.className.split(/\s+/).includes(m[1]);
    if ((m = sel.match(/^input\[value="([^"]*)"\]$/))) return this.tag === 'input' && this.value === m[1];
    if ((m = sel.match(/^\[data-act=(\w+)\]$/))) return this.dataset.act === m[1];
    if ((m = sel.match(/^(\w+)$/))) return this.tag === m[1];
    return false;
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel) { return this.all().find((c) => c.matches(sel)) || null; }
  closest(sel) { let n = this; while (n && !n.matches(sel)) n = n.parent; return n; }
  get text() { return [this.textContent, this._html, ...this.children.map((c) => c.text)].join(' '); }
}

function mountRow({ cur = 'off', askPin = true, reply = { ok: true, logged: true } } = {}) {
  const calls = { post: [], askPin: [], prompt: 0 };
  const box = new El('div', 'na-asst-acc'); const list = box.appendChild(new El('div', 'na-asst-acc-l'));
  const root = {
    crypto: { randomUUID: () => '11111111-2222-3333-4444-555555555555' },
    prompt: () => { calls.prompt++; return '1234'; },
    NA_ROLES: askPin ? { askPin: (title, detail, verify) => { calls.askPin.push([title, detail]); return verify('1234').then((r) => !!(r && r.ok)); } } : undefined,
  };
  const post = async (path, body, headers) => { calls.post.push({ path, body, headers }); return path === '/auth/owner-approval' ? { approval_id: 'APR-1' } : reply; };
  const C = { esc: (s) => String(s) };
  const el = (tag, cls, html) => { const e = new El(tag, cls); if (html != null) e.innerHTML = html; return e; };
  const paintAccess = new Function('LEVELS_UNUSED', 'C', 'el', 'post', 'root', 'creds', LEVELS_SRC + PAINT_SRC + '\nreturn paintAccess;')(null, C, el, post, root, () => ({ endpoint: 'https://w.test', token: 't' }));
  paintAccess(box, { devices: [{ device_id: 'session:emp', label: 'Caja 2', level: cur }] });
  // Fila como la que pinta paintAccess (el DOM falso no interpreta innerHTML).
  const row = list.appendChild(new El('div', 'na-asst-acc-r')); row.dataset.dev = 'session:emp'; row.dataset.cur = cur;
  const st = row.appendChild(new El('small', 'st'));
  const radios = {};
  for (const v of ['off', 'consultas', 'consultas_documentos']) { const r = row.appendChild(new El('input')); r.type = 'radio'; r.value = v; r.checked = v === cur; radios[v] = r; }
  const pick = (v) => { for (const k in radios) radios[k].checked = k === v; list.onchange({ target: radios[v] }); };
  return { calls, list, row, st, radios, pick };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('celular: elegir un nivel NO pide PIN; muestra «Aplicar» y un toque guarda en /auth/assistant/levels sin aprobación', async () => {
  const { calls, row, st, radios, pick } = mountRow();
  pick('consultas'); await tick();
  assert.equal(calls.askPin.length, 0, 'no se abre la ventana de PIN');
  assert.equal(calls.prompt, 0, 'no se pide PIN con prompt');
  assert.ok(!calls.post.some((c) => c.path === '/auth/owner-approval'), 'no se pide aprobación con PIN');
  assert.equal(calls.post.length, 0, 'elegir no guarda: espera «Aplicar»');
  const apply = row.querySelector('[data-act=apply]'); assert.ok(apply, 'aparece el botón «Aplicar»'); assert.equal(apply.textContent, 'Aplicar');
  assert.ok(row.querySelector('[data-act=cancel]'), 'y «Cancelar»');
  await apply.onclick(); await apply.onclick();
  assert.equal(calls.post.length, 1, 'un solo guardado aunque toque dos veces');
  const [c] = calls.post;
  assert.equal(c.path, LEVELS_PATH); assert.equal(c.headers, null, 'sin x-owner-approval');
  assert.deepEqual(c.body, { device_id: 'session:emp', level: 'consultas', operation_id: 'ACC-11111111-2222-3333-4444-555555555555' });
  assert.ok(!('pin' in c.body));
  assert.equal(row.dataset.cur, 'consultas'); assert.equal(st.textContent, 'Guardado'); assert.equal(radios.consultas.checked, true);
  assert.equal(row.querySelector('.na-asst-acc-c'), null, 'la tarjeta se cierra');
});

test('celular: «Cancelar» deja el nivel como estaba y no manda nada', async () => {
  const { calls, row, st, radios, pick } = mountRow({ cur: 'consultas' });
  pick('off'); row.querySelector('[data-act=cancel]').onclick(); await tick();
  assert.equal(calls.post.length, 0); assert.equal(radios.consultas.checked, true); assert.equal(row.dataset.cur, 'consultas');
  assert.equal(st.textContent, 'Sin cambios.'); assert.equal(row.querySelector('.na-asst-acc-c'), null);
});

// Empleado en nivel 3 («completo», puesto desde el chat): el celular no tiene ese botón, así que ninguna opción sale marcada.
// Si el Admin elige otra y cancela (o falla el guardado), no debe quedar marcada una opción que NO es la guardada.
test('celular: empleado en nivel 3 — «Cancelar» o un error no dejan marcada otra opción', async () => {
  const a = mountRow({ cur: 'completo' });
  a.pick('consultas'); a.row.querySelector('[data-act=cancel]').onclick(); await tick();
  assert.equal(a.calls.post.length, 0); assert.equal(a.row.dataset.cur, 'completo');
  assert.deepEqual(Object.values(a.radios).map((r) => r.checked), [false, false, false], 'ninguna marcada: sigue en nivel 3');
  assert.equal(a.st.textContent, 'Sin cambios.');
  const b = mountRow({ cur: 'completo', reply: { error: 'admin_only', status: 403 } });
  b.pick('off'); await b.row.querySelector('[data-act=apply]').onclick();
  assert.equal(b.row.dataset.cur, 'completo'); assert.equal(b.st.textContent, 'Solo el Admin puede cambiar esto.');
  assert.deepEqual(Object.values(b.radios).map((r) => r.checked), [false, false, false]);
  assert.equal(b.row.querySelector('.na-asst-acc-c'), null);
});

test('celular: si el servidor rechaza, vuelve al nivel anterior y lo dice', async () => {
  const { row, st, radios, pick } = mountRow({ cur: 'consultas', reply: { error: 'not_employee_device', status: 409 } });
  pick('off'); await row.querySelector('[data-act=apply]').onclick();
  assert.equal(row.dataset.cur, 'consultas'); assert.equal(radios.consultas.checked, true);
  assert.equal(st.textContent, 'Ese aparato ya no es de empleado.');
});

test('celular: el texto de la pantalla ya no habla de PIN', () => {
  const sec = UI.slice(UI.indexOf('// ---------- Configuración > Aparatos: nivel del asistente'), UI.indexOf('  var ACCESS_PATH ='));
  assert.ok(sec.length > 200);
  assert.ok(!/PIN/.test(sec.replace(/SIN PIN/g, '')), 'sin PIN en el bloque de niveles');
  assert.ok(!/askPin|owner-approval|x-owner-approval/.test(PAINT_SRC), 'paintAccess no pide PIN ni aprobación');
});

// ---------- Servidor: lo que manda el celular, con la base real del laboratorio (sin migraciones nuevas) ----------
const MIG = ['0024_pos_roles_owner_pin.sql', '0025_pos_reviews_pin_failures.sql'];
async function setup(t) {
  const f = await activeCanon(t, { migrations: MIG });
  Object.assign(f.env, { ASSISTANT_ENABLED: '1', ASSISTANT_CONFIRM_SECRET: 'secreto-de-prueba-0123456789abcdef', ASSISTANT_DEMO: '1' });
  f.addDevice('dueno', 'writer', 'active', 'tok-dueno');
  f.addDevice('emp', 'writer', 'active', 'tok-emp');
  f.addDevice('emp2', 'writer', 'active', 'tok-emp2');
  const at = new Date().toISOString();
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:dueno','owner','Dueño','test',?)", at);
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:emp','empleado','Caja 2','session:dueno',?)", at);
  f.exec("INSERT INTO pos_device_roles(device_id,pos_role,label,created_by,created_at) VALUES('session:emp2','empleado','Caja 3','session:dueno',?)", at);
  const call = async (tok, path, body, method = 'POST') => {
    const r = await f.fetch('http://localhost' + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    const raw = await r.text(); let b = null; try { b = JSON.parse(raw); } catch { b = raw; }
    return { status: r.status, body: b };
  };
  return { f, call };
}

test('servidor: el Admin cambia el nivel con el cuerpo del celular (nombre del nivel), sin PIN ni aprobación, y queda en la bitácora', async (t) => {
  const { f, call } = await setup(t);
  const tables0 = f.sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").n;
  const r = await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', level: 'consultas', operation_id: 'ACC-op-1' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); assert.equal(r.body.nivel, 1); assert.equal(r.body.logged, true);
  const r2 = await call('tok-dueno', LEVELS_PATH, { device_id: 'session:emp', level: 'off', operation_id: 'ACC-op-2' });
  assert.equal(r2.status, 200); assert.equal(r2.body.nivel, 0);
  const rows = (await call('tok-dueno', '/auth/assistant/audit?limit=500', null, 'GET')).body.entries.filter((e) => e.tool === 'asistente.nivel' && e.grupo === 'o');
  assert.deepEqual(rows.map((e) => e.outcome).sort(), ['nivel:0->1', 'nivel:1->0'].sort());
  for (const e of rows) { assert.equal(e.device_id, 'session:dueno'); assert.equal(e.card_id, 'session:emp'); }
  assert.equal(rows.find((e) => e.outcome === 'nivel:0->1').operation_id, 'ACC-op-1');
  assert.equal(f.sql("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").n, tables0, 'sin tablas nuevas (sin migración)');
});

test('servidor: un empleado NO puede cambiar niveles (ni el suyo ni el de otro): 403 y nada cambia', async (t) => {
  const { call } = await setup(t);
  for (const target of ['session:emp', 'session:emp2']) {
    const r = await call('tok-emp', LEVELS_PATH, { device_id: target, level: 'consultas_documentos', operation_id: 'ACC-x' });
    assert.equal(r.status, 403, target); assert.ok(['forbidden_role', 'admin_only'].includes(r.body.error), r.body.error);
  }
  const by = Object.fromEntries((await call('tok-dueno', LEVELS_PATH, null, 'GET')).body.personas.map((p) => [p.device_id, p.nivel]));
  assert.deepEqual([by['session:emp'], by['session:emp2']], [0, 0], 'siguen en «Sin permiso»');
});
