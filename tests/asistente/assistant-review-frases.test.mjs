// «Revisión del punto de venta» con preguntas naturales del Admin (fix/asistente-informe-frases).
// El Admin preguntó «que errores encontraste» y fue al chat normal, donde el modelo dijo que no tenía esa función.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
const pick = (re) => { const m = UI.match(re); assert.ok(m, String(re)); return m[0]; };
const src = [pick(/  var REVIEW_RE = \/.*\/i;\n/), pick(/  var REVIEW_ASK_RE = \/.*\/;\n/), pick(/  function reviewNorm\(t\) \{.*\n/), pick(/  var REVIEW_BIZ_RE = \/.*\/;\n/), pick(/  function isReview\(t\) \{.*\n/)].join('');
const isReview = new Function(src + 'return isReview;')();

const POSITIVOS = [
  'que errores encontraste', '¿Qué errores encontraste?', 'QUE ERRORES ENCONTRASTE', 'q erores encontraste', 'ke errores hay',
  'qué errores hay', 'que errores hubo hoy', 'hubo errores?', 'hubo fallas', 'hubo bugs', 'hay algún error', 'hay algun bug',
  'encontraste fallas', 'encontraste alguna falla?', 'detectaste errores', 'cuáles son los errores', 'dime los errores', 'muéstrame los últimos errores',
  'errores', 'Errores?', 'fallas', 'errores de hoy', 'errores encontrados', 'que fallo', '¿Qué falló?', 'algo falló?', 'falló algo',
  'que anda mal', 'qué está mal en el sistema', 'que encontraste', 'qué detectaste', 'que encontró el monitor',
  'hay algo lento', 'está lento', 'el pos anda muy lento', 'lentitud', 'se colgó', 'se colgo la app', 'se congeló', 'se trabó el sistema', 'está colgado',
  'como esta el pos', '¿Cómo está el sistema?', 'como va la app', 'cómo anda el punto de venta', 'el sistema está bien?',
  'revisa la app', 'revisa el sistema', 'revisame el sistema', 'chequea el pos', 'verifica la aplicacion',
  'informe de errores', 'reporte de errores', 'reporte de fallas', 'resumen de errores', 'reporte', 'el reporte', 'informe', 'dame el reporte', 'hazme un reporte',
  // errores del POS / sistema / app siguen abriendo la revisión
  'errores del sistema', 'hay errores en el sistema?', 'errores en la app', 'fallas del pos', 'hubo un error en el punto de venta',
  // las frases de siempre siguen funcionando
  'Revisión del punto de venta', 'revisa el POS', 'errores del punto de venta', 'hazme el informe', 'Hágame un informe', 'informe del POS',
];
const NEGATIVOS = [
  'cuánto vendí hoy', '¿Cuánto vendimos hoy?', 'stock de arroz', 'precio del aceite', 'cómo está la caja', 'como funciona el pos',
  'dame el reporte de ventas', 'reporte de ventas de hoy', 'informe de compras', 'productos de lenta rotación', 'qué productos se venden lento',
  'clientes con deuda', 'quién me debe', 'registra una venta de 2 arroz', 'que hago si sale error al imprimir', 'hola', 'gracias',
  'correcciones guardadas', 'lee una boleta', 'que paso con el pedido de ayer', 'error en la venta del cliente',
  // errores en DATOS del negocio: van al chat (revisión de PR #933)
  '¿algún error en los precios?', 'algun error en los precios', 'hay errores en el stock?', 'errores en el stock', 'falla en la caja', 'hay una falla en la caja',
  'hubo un error en la venta del cliente', 'error en el precio del arroz', 'errores en el inventario', 'hay errores en las ventas de hoy', 'error en la compra de ayer',
  'errores en los créditos', 'error en la boleta', 'algo anda mal en la caja', 'que esta mal en el stock', 'problemas con el proveedor', 'erores en los precios',
];

test('Admin: preguntas naturales sobre errores, fallas, lentitud y estado del sistema abren la revisión', () => {
  for (const t of POSITIVOS) assert.ok(isReview(t), 'debería abrir la revisión: ' + t);
});

test('Preguntas de negocio NO abren la revisión (van al chat de siempre)', () => {
  for (const t of NEGATIVOS) assert.ok(!isReview(t), 'no debería abrir la revisión: ' + t);
});

test('Solo para el Admin, como antes; «correcciones» sigue abriendo lo aprendido', () => {
  assert.match(UI, /if \(!image && isOwnerAccess\(\) && isReview\(text\)\) \{/);
  assert.match(UI, /if \(!image && isOwnerAccess\(\) && LEARNED_RE\.test\(text\) && !isReview\(text\)\) return learnedShow\(text\);/);
  assert.ok(!/REVIEW_RE\.test\(text\)/.test(UI), 'todo pasa por isReview');
});
