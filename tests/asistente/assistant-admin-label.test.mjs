// «Admin» en vez de «dueño» en todo texto visible del asistente (22-10). Los roles internos ('owner') y la API no cambian.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const STR = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
function visibleStrings(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    const code = line.replace(/\/\/[^'"]*$/, '');
    for (const m of code.match(STR) || []) out.push(m);
  }
  return out;
}

test('Admin: ninguna cadena del asistente en el aparato dice «dueño»', () => {
  for (const f of ['POS/js/modules/asistente/asistente-ui.js', 'POS/js/modules/asistente/asistente-core.js']) {
    const bad = visibleStrings(f).filter((s) => /due[ñn]o/i.test(s));
    assert.deepEqual(bad, [], f);
  }
  const ui = readFileSync('POS/js/modules/asistente/asistente-ui.js', 'utf8');
  assert.match(ui, /'Gestión · Admin · prueba aislada'/);
  assert.match(ui, /Registrar este teléfono como Admin/);
  assert.match(ui, /<span class="pill">Solo Admin<\/span>/);
});

test('Admin: mensajes del servidor que ve la gente dicen «Admin»; roles y códigos internos iguales', async () => {
  const a = await import('../../tools/cloudflare-lab/src/pos-assistant.js');
  assert.equal(a.OWNER_DATA_LABEL, '[dato del Admin]');
  assert.equal(a.EMPLOYEE_CHANGE_TEXT, 'Eso solo lo puede hacer el Admin. Él lo hace desde su teléfono.');
  assert.equal(a.IMAGE_OWNER_ONLY.message, 'Eso solo lo puede hacer el Admin.');
  assert.equal(a.IMAGE_OWNER_ONLY.error, 'image_owner_only');
  const src = readFileSync('tools/cloudflare-lab/src/pos-assistant.js', 'utf8');
  assert.match(src, /'El Admin no activó el asistente en este aparato\.'/);
  assert.match(src, /'El asistente es solo para el Admin\.'/);
  assert.match(src, /role === 'owner'/);
  const dev = readFileSync('tools/cloudflare-lab/src/pos-owner-device.js', 'utf8');
  assert.match(dev, /teléfono del Admin/);
  assert.match(dev, /único aparato Admin/);
  assert.match(dev, /error: 'last_owner', code: 'last_owner'/);
});

test('migraciones del asistente renumeradas tras 0034_price_history (solo archivos, nada aplicado)', () => {
  const m = 'infra/database/migrations/';
  assert.ok(existsSync(m + '0035_pos_assistant_access_log.sql'));
  assert.ok(existsSync(m + '0036_pos_owner_device_log.sql'));
  assert.ok(!existsSync(m + '0034_pos_assistant_access_log.sql'));
  assert.ok(!existsSync(m + '0035_pos_owner_device_log.sql'));
});
