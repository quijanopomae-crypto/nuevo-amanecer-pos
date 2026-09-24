import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('laboratorio/pos-lab/js/lab-workspace.js', 'utf8');
const contract = JSON.parse(readFileSync('laboratorio/pos-lab/tasks/LAB-WORKSPACE-BOOT-001.json', 'utf8'));

test('LAB workspace does not block first render on remote D1', () => {
  assert.match(source, /setTimeout\(function \(\) \{[\s\S]*loadRemoteWorkspace\(\{ silent: true \}\)/);
  assert.doesNotMatch(source, /await loadRemoteWorkspace\(\{ silent: true \}\)/);
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
