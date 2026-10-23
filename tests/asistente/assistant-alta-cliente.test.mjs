// (fix/asist-alta-cliente-local) «agrega cliente …» en el teléfono: atajo LOCAL. Abre el formulario EXISTENTE «Nuevo cliente» (#mCli)
// lleno con nombre / teléfono / DNI; la persona toca Guardar. Si el cliente ya existe en el aparato, lo dice con su nombre real (Admin y
// empleado) y su código. Nada sale del aparato: ni fetch, ni modelo, ni historial.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');

const P = (nombre, tel = '', dni = '') => ({ nombre, tel, dni });

test('customerIntent: positivos (cliente + verbo de alta; nombre, celular de 9 y DNI de 8)', () => {
  assert.equal(typeof C.customerIntent, 'function', 'customerIntent exportado por el núcleo');
  const ok = [
    ['agrega cliente Rosa Quispe 987654321', P('Rosa Quispe', '987654321')],
    ['Agrega al cliente Rosa Quispe', P('Rosa Quispe')],
    ['nuevo cliente: doña Carmen Salas, DNI 45678912, cel 912345678', P('Carmen Salas', '912345678', '45678912')],
    ['registra al cliente señor Juan Pérez', P('Juan Pérez')],
    ['da de alta al cliente Ana Torres dni 12345678', P('Ana Torres', '', '12345678')],
    ['añade a don Luis Rojas como cliente nuevo 998877665', P('Luis Rojas', '998877665')],
    ['crea cliente Pedro de la Cruz teléfono 955 444 333', P('Pedro de la Cruz', '955444333')],
    ['cliente nuevo señora María Huamán 41234567 987111222', P('María Huamán', '987111222', '41234567')],
    ['registra cliente rosa quispe', P('Rosa Quispe')]
  ];
  for (const [t, want] of ok) assert.deepEqual({ ...C.customerIntent(t) }, want, t);
});

test('customerIntent: negativos (preguntas, códigos, productos, sin nombre)', () => {
  for (const t of ['cuánto debe el cliente Rosa Quispe', 'cliente #5 lleva Gloria', '¿qué cliente nuevo compró más?', 'cuál es el cliente nuevo',
    'cuántos clientes nuevos hay este mes', 'agrega 2 arroz Costeño', 'nuevo producto Leche Gloria', 'agrega cliente', 'nuevo cliente 987654321',
    'ventas del cliente Rosa Quispe', 'agrega a Rosa Quispe', 'quién es el cliente nuevo', 'registra la venta del cliente #12'])
    assert.equal(C.customerIntent(t), null, t);
});

const CLIENTES = [
  { id: 12, nombre: 'Rosa Quispe', tel: '987654321', dni: '45678912' },
  { id: 15, nombre: 'ROSA  QUISPE', tel: '', dni: '' },
  { id: 20, nombre: 'Juan Pérez', tel: '', dni: '11112222' }
];

test('findCustomers: mismo nombre (sin tildes ni mayúsculas) o mismo DNI', () => {
  assert.deepEqual(C.findCustomers(CLIENTES, P('rosa quispe')).map((c) => c.id), [12, 15]);
  assert.deepEqual(C.findCustomers(CLIENTES, P('Juan Perez')).map((c) => c.id), [20]);
  assert.deepEqual(C.findCustomers(CLIENTES, P('Otro Nombre', '', '11112222')).map((c) => c.id), [20]);
  assert.deepEqual(C.findCustomers(CLIENTES, P('Ana Torres')), []);
  assert.deepEqual(C.findCustomers(null, P('Ana Torres')), []);
});

test('customerExistsReply: nombre real y código; varios = lista por nombre', () => {
  assert.equal(C.customerExistsReply([CLIENTES[2]]), 'Ya existe el cliente Juan Pérez (#20)');
  const many = C.customerExistsReply(CLIENTES.slice(0, 2));
  assert.match(many, /^Ya existen 2 clientes con ese nombre:/);
  assert.match(many, /Rosa Quispe \(#12\)/); assert.match(many, /ROSA QUISPE \(#15\)/);
});

// ---------- Teléfono: customerShortcut + openNewCustomer REALES (recortados del archivo), DOM mínimo, sin red ----------
function sliceFn(src, start, end) { const a = src.indexOf(start), b = src.indexOf(end, a + 1); assert.ok(a >= 0 && b > a, start); return src.slice(a, b); }
function field(id) { return { id, tagName: 'INPUT', value: '', style: {}, events: [], dispatchEvent(e) { this.events.push(e.type); }, focus() {} }; }
function phone({ owner, clientes = CLIENTES, open = true } = {}) {
  const els = { cNombre: field('cNombre'), cTel: field('cTel'), cDni: field('cDni'), cDir: field('cDir'),
    mCli: { cls: new Set(), get classList() { const s = this.cls; return { add: (c) => s.add(c), contains: (c) => s.has(c) }; } } };
  const msgs = [], fetches = [], history = [], opened = [], closed = [];
  const ctx = vm.createContext({
    C, Event: class { constructor(t) { this.type = t; } }, history, msgs, fetches, CL: clientes,
    doc: { getElementById: (id) => els[id] || null },
    fetch: (...a) => { fetches.push(a); throw new Error('red prohibida'); },
    inputEl: { value: 'x' },
    isOwnerAccess: () => !!owner, isAdmin: () => true,
    addMsg: (k, t) => { msgs.push([k, String(t)]); return {}; },
    mark: () => {}, closePanel: () => closed.push(1),
    g: (n) => n === 'abrirModalCli' ? () => { opened.push(1); ['cNombre', 'cTel', 'cDni', 'cDir'].forEach((k) => { els[k].value = ''; }); if (open) els.mCli.cls.add('open'); } : undefined
  });
  vm.runInContext(sliceFn(UI, '  function openNewCustomer(p) {', '\n  }\n') + '\n  }\n', ctx);
  vm.runInContext('var deps = { clientes: function () { return CL; }, openNewCustomer: openNewCustomer };', ctx);
  vm.runInContext(sliceFn(UI, '  function customerShortcut(text) {', '\n  }\n') + '\n  }\n', ctx);
  return { ctx, els, msgs, fetches, history, opened, closed };
}

test('nuevo: abre «Nuevo cliente» (#mCli) lleno; sin fetch, sin historial; la persona guarda', () => {
  for (const owner of [true, false]) {
    const p = phone({ owner });
    assert.equal(p.ctx.customerShortcut('nuevo cliente doña Ana Torres dni 12345678 cel 912345678'), true);
    assert.equal(p.opened.length, 1, 'usa abrirModalCli del POS');
    assert.equal(p.els.mCli.classList.contains('open'), true);
    assert.equal(p.els.cNombre.value, 'Ana Torres'); assert.equal(p.els.cTel.value, '912345678'); assert.equal(p.els.cDni.value, '12345678');
    assert.deepEqual(p.els.cNombre.events, ['input', 'change']);
    assert.equal(p.fetches.length, 0); assert.equal(p.history.length, 0); assert.equal(p.ctx.inputEl.value, '');
    assert.deepEqual(p.msgs.map((m) => m[0]), ['u', 'a']);
    assert.match(p.msgs[1][1], /Nuevo cliente/); assert.match(p.msgs[1][1], /Guardar/);
    assert.equal(p.closed.length, 1, 'el panel se cierra para ver el formulario');
  }
});

test('el nombre se escribe ANTES que el DNI (así el buscador de DNI del POS no consulta en la red)', () => {
  const src = sliceFn(UI, '  function openNewCustomer(p) {', '\n  }\n');
  assert.ok(src.indexOf("'cNombre'") < src.indexOf("'cDni'"));
});

test('ya existe (Admin y empleado): nombre real + código, no abre el formulario, sin fetch ni historial', () => {
  for (const owner of [true, false]) {
    const one = phone({ owner });
    assert.equal(one.ctx.customerShortcut('agrega cliente Juan Perez'), true);
    assert.equal(one.msgs[1][1], 'Ya existe el cliente Juan Pérez (#20)', owner ? 'Admin' : 'empleado');
    assert.equal(one.opened.length, 0); assert.equal(one.fetches.length, 0); assert.equal(one.history.length, 0); assert.equal(one.closed.length, 0);
    const two = phone({ owner });
    two.ctx.customerShortcut('registra al cliente señora Rosa Quispe');
    assert.match(two.msgs[1][1], /^Ya existen 2 clientes con ese nombre:/); assert.match(two.msgs[1][1], /Rosa Quispe \(#12\)/); assert.match(two.msgs[1][1], /ROSA QUISPE \(#15\)/);
    assert.equal(two.opened.length, 0); assert.equal(two.fetches.length, 0); assert.equal(two.history.length, 0);
  }
});

test('no es alta de cliente: el atajo no hace nada (sigue el camino normal)', () => {
  const p = phone({ owner: true });
  assert.equal(p.ctx.customerShortcut('cuánto debe el cliente Rosa Quispe'), false);
  assert.equal(p.msgs.length, 0); assert.equal(p.opened.length, 0);
});

test('si el POS no abre el formulario (permiso/bloqueo), se avisa en local', () => {
  const p = phone({ owner: false, open: false });
  assert.equal(p.ctx.customerShortcut('agrega cliente Ana Torres'), true);
  assert.match(p.msgs[1][1], /No se pudo abrir «Nuevo cliente»/); assert.equal(p.fetches.length, 0);
});

test('send(): el atajo va ANTES de la red, de maskCustomers y del historial', () => {
  const s = sliceFn(UI, '  async function send(text, image) {', '\n  }\n');
  const i = s.indexOf('customerShortcut(text)');
  assert.ok(i > 0, 'send() llama al atajo');
  for (const later of ['root.navigator.onLine === false', 'C.maskCustomers', 'history.push', 'post(']) { const j = s.indexOf(later); if (j >= 0) assert.ok(i < j, later); }
  const f = sliceFn(UI, '  function customerShortcut(text) {', '\n  }\n');
  assert.doesNotMatch(f, /history|fetch|post\(|mem/);
});

test.todo('Admin: «Nuevo cliente» se abre sin pedir PIN (pendiente #993)');

// ---------- Revisión #1015 (BLOCK): el atajo solo toma «<verbo> cliente <nombre>» al INICIO; lo demás va al asistente (tapado) ----------
const NO_ALTA = (x) => [
  `crea el estado de cuenta del cliente ${x}`,
  `dime cuánto debe el cliente nuevo ${x}`,
  `registra el pago del cliente ${x}`,
  `agrega 2 arroz al cliente ${x}`,
  `registra que el cliente ${x} pagó 50`
];

test('revisión #1015: órdenes que mencionan «cliente» no son alta; van al asistente con el nombre tapado', () => {
  for (const x of ['Rosa Quispe', 'Juan Pérez', 'Ana Torres']) for (const t of NO_ALTA(x)) {
    assert.equal(C.customerIntent(t), null, t);
    for (const owner of [true, false]) {
      const p = phone({ owner });
      assert.equal(p.ctx.customerShortcut(t), false, t);
      assert.equal(p.msgs.length, 0, t); assert.equal(p.opened.length, 0, t); assert.equal(p.closed.length, 0, t);
      assert.equal(p.ctx.inputEl.value, 'x', 'no borra lo escrito: ' + t);
    }
  }
  // camino normal: maskCustomers tapa el nombre del cliente que el aparato conoce antes de cualquier envío
  for (const x of ['Rosa Quispe', 'Juan Pérez']) for (const t of NO_ALTA(x)) {
    const out = C.maskCustomers(t, CLIENTES, [], []).text;
    assert.doesNotMatch(out, /rosa|quispe|juan|p[eé]rez/i, t + ' -> ' + out);
  }
});

test('revisión #1015: las altas válidas siguen funcionando', () => {
  const ok = [
    ['agrega cliente Rosa Quispe 987654321', P('Rosa Quispe', '987654321')],
    ['nuevo cliente Rosa Quispe', P('Rosa Quispe')],
    ['registra al cliente Juan Pérez DNI 12345678', P('Juan Pérez', '', '12345678')],
    ['agrega un cliente nuevo Rosa Quispe', P('Rosa Quispe')],
    ['Añade una clienta nueva: Ana Torres', P('Ana Torres')],
    ['da de alta al cliente Ana Torres', P('Ana Torres')]
  ];
  for (const [t, want] of ok) assert.deepEqual({ ...C.customerIntent(t) }, want, t);
  const p = phone({ owner: false });
  assert.equal(p.ctx.customerShortcut('nuevo cliente Ana Torres'), true);
  assert.equal(p.els.cNombre.value, 'Ana Torres');
});

test('revisión #1015: el nombre se corta en verbos, conectores y números que no son celular ni DNI', () => {
  const ok = [
    ['nuevo cliente Ana Torres pagó 50', P('Ana Torres')],
    ['agrega cliente Ana Torres que debe 20 soles', P('Ana Torres')],
    ['agrega cliente Ana Torres debe 20', P('Ana Torres')],
    ['agrega cliente Ana Torres paga los viernes', P('Ana Torres')],
    ['agrega cliente Ana Torres por 30 soles', P('Ana Torres')],
    ['crea cliente Ana Torres con celular 912345678', P('Ana Torres', '912345678')],
    ['agrega cliente Ana Torres compró arroz', P('Ana Torres')],
    ['nuevo cliente Ana Torres llevó 2 panes', P('Ana Torres')],
    ['agrega cliente Ana Torres a la cuenta', P('Ana Torres')],
    ['agrega cliente Ana Torres al fiado', P('Ana Torres')],
    ['agrega cliente Ana Torres venta de 20', P('Ana Torres')],
    ['agrega cliente Ana Torres 20 soles', P('Ana Torres')],
    ['crea cliente Pedro de la Cruz 955 444 333', P('Pedro de la Cruz', '955444333')]
  ];
  for (const [t, want] of ok) assert.deepEqual({ ...C.customerIntent(t) }, want, t);
});

test('revisión #1015: si coincide solo por DNI, no dice «con ese nombre»', () => {
  const byDni = [{ id: 30, nombre: 'Luis Rojas', dni: '11112222' }, { id: 31, nombre: 'Luis R.', dni: '11112222' }];
  const p = P('Otro Nombre', '', '11112222');
  assert.match(C.customerExistsReply(byDni, p), /^Ya existen 2 clientes con ese DNI:/);
  assert.match(C.customerExistsReply(CLIENTES.slice(0, 2), P('Rosa Quispe')), /^Ya existen 2 clientes con ese nombre:/);
});
