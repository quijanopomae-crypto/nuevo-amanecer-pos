// La cabecera #saveStatus no dice «Guardado en la nube» mientras haya operaciones en las colas canónicas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const inline = readFileSync('POS/js/legacy-inline/inline-03.js', 'utf8');
const banner = readFileSync('POS/js/sync/canonical-status-banner.js', 'utf8');

function helpers() {
  const start = inline.indexOf('let _naSaveStatusCloud=false;');
  const end = inline.indexOf("window.addEventListener('na:canonical-updated'", start);
  assert.ok(start > 0 && end > start, 'bloque de ayuda presente antes del listener');
  return inline.slice(start, end);
}

function run({ intents = 0, pending = null, quarantined = 0, useBanner = true }) {
  const el = { textContent: 'Conectando…', dataset: {} };
  const outbox = { snapshot: () => ({ intents: Array.from({ length: intents }, (_, i) => ({ operation_id: 'op' + i })) }),
    quarantine: () => ({ entries: Array.from({ length: quarantined }, () => ({ status: 'QUARANTINED' })) }) };
  const canonical = { enabled: () => true, pendingSnapshot: () => pending, snapshot: () => null };
  const window = { NuevoAmanecerCanonicalSaleOutbox: outbox, NuevoAmanecerCanonical: canonical, navigator: { onLine: false } };
  window.NA_ICON_TEXT = (node, icon, msg) => { node.textContent = msg; node.icon = icon; };
  const ctx = vm.createContext({ window, globalThis: window, NuevoAmanecerCanonical: canonical, NA_ICON_TEXT: window.NA_ICON_TEXT,
    document: { getElementById: (id) => (id === 'saveStatus' ? el : null), readyState: 'complete' } });
  if (useBanner) vm.runInNewContext(banner.replace('})(globalThis);', '})(window);'), { window, document: undefined });
  vm.runInContext(helpers() + '\n_naSaveStatusCloud=true;_naRenderCanonicalSaveStatus(true);', ctx);
  return el;
}

test('sin pendientes: «Guardado en la nube»', () => {
  assert.equal(run({}).textContent, 'Guardado en la nube');
});
test('venta en cola (canonical-sale-outbox): «1 pendiente de enviar»', () => {
  const el = run({ intents: 1 });
  assert.equal(el.textContent, '1 pendiente de enviar'); assert.equal(el.icon, 'save');
  const icons = readFileSync('POS/js/ui/na-line-icons.js', 'utf8');
  const P = icons.slice(icons.indexOf('var P = {'), icons.indexOf('};', icons.indexOf('var P = {')));
  for (const name of ['save', 'alert', 'cloud']) assert.match(P, new RegExp('\\b' + name + ":"), 'NA_ICON_TEXT conoce ' + name);
});
test('abono en el diario (canonical-client) + venta: «2 pendientes de enviar», igual que la franja', () => {
  assert.equal(run({ intents: 1, pending: { command: 'payment.create' } }).textContent, '2 pendientes de enviar');
  assert.equal(run({ intents: 1, pending: { command: 'payment.create' }, useBanner: false }).textContent, '2 pendientes de enviar');
});
test('solo ventas en revisión: no dice «Guardado en la nube»', () => {
  assert.equal(run({ quarantined: 1 }).textContent, '1 por revisar');
});
test('la franja refresca la cabecera en cada render', () => {
  assert.match(banner, /root\._naRenderCanonicalSaveStatus\(\)/);
  assert.doesNotMatch(inline, /NA_ICON_TEXT\(saveStatus,'cloud','Guardado en la nube'\)/);
});
