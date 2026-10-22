// (22-10, fix/asist-filtro-partes) el filtro por partes da EXACTAMENTE lo mismo que el filtro del texto entero, para cualquier forma de
// cortar: ni fugas («clave abc123» a la vista) ni tapado de más («mS/» tapado de menos/de más). Causa: la regla de la etiqueta no tapa el
// valor si ya hay un «[oculto]» cerca, SALVO que después venga otra etiqueta con su propio «[oculto]»; esa segunda etiqueta (y su valor)
// aún no había llegado cuando se soltó la primera parte. Este archivo no lee otras pruebas: sus casos son propios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextEmitter, redactFor, capReply } from '../../tools/cloudflare-lab/src/pos-assistant.js';

const EMP = 'empleado:consultas';
const ROLES = ['owner', EMP];
const clean = (t) => t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, ' ');
const whole = (text, role) => capReply(redactFor(role)(clean(text)));
// pieces: lista de trozos ya cortados
function streamPieces(pieces, role) {
  let o = ''; const e = createTextEmitter((d) => { if (d.reset) o += '«RESET»'; if (d.t) o += d.t; }, 1200, redactFor(role)); // un reset (lo soltado no era prefijo) también falla
  for (const p of pieces) e.push(p);
  e.flush(); return o;
}
const cutAt = (t, cuts) => { const out = []; let a = 0; for (const c of cuts) { out.push(t.slice(a, c)); a = c; } out.push(t.slice(a)); return out; };

const FIXED = [
  ['clave abc123 1.1s m clave el wifi:ga)', 'clave [oculto] [oculto]s m clave el wifi:[oculto]'],
  ['clave mS/ 1.1 Lima, clave el wifi:ga)', 'clave [oculto] [oculto] Lima, clave el wifi:[oculto]'],
  ['clave es abc123 lo compré a S/ 1.10Distribuidora Inversiones Lima, clave del wifi: (tortuga)', null]
];

test('equivalencia: casos fijos (fuga «clave abc123», tapado de más «mS/» y el caso original) de una vez, letra por letra y con cada corte', () => {
  for (const [t, ownerExp] of FIXED) for (const role of ROLES) {
    const w = whole(t, role);
    if (ownerExp && role === 'owner') assert.equal(w, ownerExp);
    assert.ok(!/abc123/.test(w), role + ': el texto entero tapa la clave: ' + w);
    assert.equal(streamPieces([t], role), w, role + ' de una vez');
    assert.equal(streamPieces([...t], role), w, role + ' letra por letra');
    for (let i = 1; i < t.length; i++) assert.equal(streamPieces(cutAt(t, [i]), role), w, role + ' corte en ' + i + ': ' + JSON.stringify(cutAt(t, [i])));
  }
});

test('equivalencia: casos fijos cortos con cada par de cortes', () => {
  for (const [t] of FIXED.slice(0, 2)) for (const role of ROLES) {
    const w = whole(t, role);
    for (let i = 1; i < t.length; i++) for (let j = i + 1; j < t.length; j++) assert.equal(streamPieces(cutAt(t, [i, j]), role), w, role + ' cortes ' + i + ',' + j);
  }
});

// generador propio con semilla fija (no depende de Math.random ni de otros archivos)
function prng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const TOKENS = ['clave', 'clave es', 'clave del wifi:', 'clave el wifi:', 'contraseña', 'contraseña:', 'wifi', 'wifi:', 'pin', 'pin:', 'api key', 'token =', 'password',
  'abc123', 'ga)', '(tortuga)', 'Gatito', 'mS/', 'Zq9xK2mPw7', '4321', '1.1', '1.1s', '"abc"', 'RUC N°', 'RUC', '20123456789', 'DNI', 'DNI:', '12345678', '12.345.678',
  'S/ 1.10', 'S/ 4.50', 'S/ 1.80', 'S/', '987 654 321', '+51 987-654-321', 'juan.perez+1@gmail.com', 'ventas@botica-na.com.pe', 'Distribuidora Inversiones Lima', 'Lima',
  'lo compré a', 'costo', 'precio de venta', 'm', 'el', 'es', 'de', 'y', ' ', ' ', ' ', ',', '.', ':', ';', '(', ')', '\n', '-', '/'];
for (const seed of [20261022, 944, 7, 123456789]) {
  test('equivalencia: al azar con semilla ' + seed + ' (tokens de clave/contraseña/wifi/RUC/DNI/montos/teléfonos/correos y cortes al azar): en partes = texto entero, dueño y empleado', () => {
    const rnd = prng(seed), pick = (a) => a[Math.floor(rnd() * a.length)];
    let cases = 0;
    for (let i = 0; i < 400; i++) {
      let t = ''; const n = 3 + Math.floor(rnd() * 22);
      for (let j = 0; j < n; j++) t += pick(TOKENS) + (rnd() < 0.6 ? ' ' : '');
      for (const role of ROLES) {
        const w = whole(t, role), mode = rnd(), pieces = []; let a = 0;
        while (a < t.length) { const k = mode < 0.3 ? 1 : mode < 0.6 ? 1 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 40); pieces.push(t.slice(a, a + k)); a += k; }
        assert.equal(streamPieces(pieces, role), w, role + ' ' + JSON.stringify(pieces)); cases++;
      }
    }
    assert.equal(cases, 800);
  });
}

// Casos encontrados por la búsqueda al azar (más semillas): varias etiquetas y valores mezclados sin espacios.
const STRESS = [
  "** 12345678cód. m gmailganancia DNI ga) arroba contraseña: 12.345.678 `api key producto claveclave del wifi: margen ; precioclave del wifi:ga)RUC (tortuga) contraseña 1.1s clave del wifi:Distribuidora Inversiones LimamS/ cód. 20123456789 S/ contraseña: clave es gananciaelLima proveedores S/ 1.10 1.1código ",
  "987 654 321 12.345.678; abc123 m códigoproveedor ` caja ganancia wifi: Distribuidora Inversiones Lima ganancia gmail mS/ proveedorproveedor m clave es es api key 1.1Gatito cód. token =  12345678 clave es passwordclave es 4321 gmailmargen cajaS/ 1.10"
];
test('equivalencia: casos de la búsqueda al azar, de una vez, letra por letra y en partes de 2 a 13', () => {
  for (const t of STRESS) for (const role of ROLES) {
    const w = whole(t, role);
    assert.equal(streamPieces([t], role), w, role + ' de una vez');
    assert.equal(streamPieces([...t], role), w, role + ' letra por letra');
    for (let k = 2; k <= 13; k++) { const p = []; for (let a = 0; a < t.length; a += k) p.push(t.slice(a, a + k)); assert.equal(streamPieces(p, role), w, role + ' partes de ' + k); }
  }
});

test('equivalencia: texto largo («pin » repetido, cruza la ventana de revisión) letra por letra = texto entero', () => {
  for (const t of ['pin '.repeat(450), 'clave "abc" y '.repeat(130), 'pin '.repeat(200) + 'clave abc123 ' + 'S/ 1.10 Lima '.repeat(120)]) for (const role of ROLES) {
    const w = whole(t, role);
    assert.equal(streamPieces([...t], role), w, role + ' letra por letra (' + t.length + ')');
    assert.equal(streamPieces(cutAt(t, [700, 1501]), role), w, role + ' dos cortes');
  }
});
