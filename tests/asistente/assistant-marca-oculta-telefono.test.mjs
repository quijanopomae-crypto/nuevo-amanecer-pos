// Teléfono (mismo arreglo que #994 en el servidor): redactText / redactOwnerContext volvían a tapar a medias las marcas que ya venían
// tapadas: «la clave es [clave oculta]» → «la clave es [oculto] oculta]». Y memStore (empleado) borraba del historial todo turno que
// redactText cambiara, así que un turno que solo traía una marca se perdía. Las marcas enteras se respetan; una clave real al lado se tapa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../POS/js/modules/asistente/asistente-core.js');
const MARKS = ['[clave oculta]', '[nombre oculto]', '[correo oculto]', '[teléfono oculto]', '[imagen omitida]', '[mensaje anterior omitido]', '[texto largo omitido]', '[dato del dueño]', '[dato del Admin]'];

test('las marcas ya tapadas quedan enteras (redactText y redactOwnerContext)', () => {
  for (const f of [C.redactText, C.redactOwnerContext]) {
    assert.equal(f('la clave es [clave oculta]'), 'la clave es [clave oculta]');
    assert.equal(f('pin [clave oculta]'), 'pin [clave oculta]');
    assert.equal(f('la contraseña: [nombre oculto]'), 'la contraseña: [nombre oculto]');
    for (const m of MARKS) for (const pre of ['clave ', 'pin: ', 'token = ', 'password ', '']) assert.equal(f(pre + m + ' listo'), pre + m + ' listo', pre + m);
  }
});

test('una clave real junto a una marca se sigue tapando', () => {
  for (const f of [C.redactText, C.redactOwnerContext]) {
    const a = f('clave 1234 y antes [clave oculta]'); assert.doesNotMatch(a, /1234/); assert.match(a, /\[clave oculta\]/);
    const b = f('[clave oculta] y el pin 4821'); assert.doesNotMatch(b, /4821/); assert.match(b, /^\[clave oculta\] y el pin \[oculto\]/);
    const c = f('la clave es [clave oculta]secreto99'); assert.doesNotMatch(c, /secreto99/);
    const d = f('[correo oculto] y juan@mail.com'); assert.equal(d, '[correo oculto] y [correo oculto]');
  }
});

test('caracteres privados que vienen de afuera no fabrican marcas', () => {
  const s = C.redactText('hola \uF8E0 [oculto]\uF8E1 clave 777777');
  assert.doesNotMatch(s, /[\uF8E0-\uF8E9]/); assert.doesNotMatch(s, /777777/); assert.doesNotMatch(s, /\[nombre oculto\]/);
});

test('memStore (empleado): el turno con una marca no se pierde; uno con una clave real sí se quita', () => {
  const h = [{ role: 'user', content: 'mi clave es [clave oculta]', sig: 's1' }, { role: 'assistant', content: 'Listo, [nombre oculto] queda anotado.' }];
  C.memStore(h, 'employee'); assert.equal(h.length, 2, 'el turno con la marca sigue');
  assert.equal(h[0].content, 'mi clave es [clave oculta]');
  const h2 = [{ role: 'user', content: 'mi clave es 998877', sig: 's2' }, { role: 'assistant', content: 'Ok.' }];
  C.memStore(h2, 'employee'); assert.equal(h2.length, 0, 'una clave real no se guarda');
  const h3 = [{ role: 'user', content: 'la clave es [clave oculta]' }, { role: 'assistant', content: 'pin [clave oculta]' }];
  C.memStore(h3, 'owner'); assert.equal(h3[0].content, 'la clave es [clave oculta]'); assert.equal(h3[1].content, 'pin [clave oculta]');
});
