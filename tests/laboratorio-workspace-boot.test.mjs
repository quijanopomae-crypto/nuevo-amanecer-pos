import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('laboratorio/pos-lab/js/lab-workspace.js', 'utf8');
const contract = JSON.parse(readFileSync('laboratorio/pos-lab/tasks/LAB-WORKSPACE-BOOT-001.json', 'utf8'));

function loadAllDataOverride() {
  const start = source.indexOf('loadAllData = async function () {');
  const end = source.indexOf('\n  setupPanel();', start);
  assert.ok(start >= 0 && end > start, 'loadAllData override must remain discoverable');
  return source.slice(start, end);
}

test('LAB workspace does not block first render on remote D1', () => {
  const boot = loadAllDataOverride();
  assert.match(boot, /setTimeout\(function \(\) \{[\s\S]*loadRemoteWorkspace\(\{ silent: true \}\)/);
  assert.doesNotMatch(boot, /await loadRemoteWorkspace\(\{ silent: true \}\)/);
});

test('one-time activation may await remote validation without changing boot semantics', () => {
  assert.match(source, /await activateWriter\(secretInput\.value\)/);
  assert.match(source, /sessionToken/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*activation/i);
});

test('LAB workspace preserves current local page when remote snapshot arrives', () => {
  assert.match(source, /var localPageId = document\.querySelector\('\.page\.active'\)\?\.id \|\| 'pageMenu'/);
  assert.match(source, /_naLoadedUIState\.currentPage = localPageId/);
});

test('workspace boot fix remains LAB-only', () => {
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});


test('LAB opens activation automatically when browser has no read/session credentials', () => {
  assert.match(source, /updateBadge\('ACTIVA PARA CARGAR DATOS'\)/);
  assert.match(source, /Activa este navegador para cargar productos y clientes desde D1 LAB/);
  assert.match(source, /overlay\.style\.display = 'block'/);
});

test('activation keeps panel open until D1 LAB data actually loads', () => {
  assert.match(source, /var loaded = await loadRemoteWorkspace\(\{ silent: false \}\)/);
  assert.match(source, /if \(loaded\) overlay\.style\.display = 'none'/);
  assert.doesNotMatch(source, /try \{ await loadRemoteWorkspace\(\{ silent: true \}\); \} catch \{\}/);
});

test('successful D1 load reports mirrored product and customer counts', () => {
  assert.match(source, /payload\.snapshot\?\.data\?\.productos/);
  assert.match(source, /payload\.snapshot\?\.data\?\.clientes/);
  assert.match(source, /Datos LAB cargados:/);
});
