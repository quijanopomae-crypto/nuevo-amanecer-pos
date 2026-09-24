import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('laboratorio/pos-lab/js/lab-workspace.js', 'utf8');
const contract = JSON.parse(readFileSync('laboratorio/pos-lab/tasks/LAB-INSTANT-CACHE-001.json', 'utf8'));

test('LAB paints a valid local snapshot before awaiting canonical durable load', () => {
  const fast = source.indexOf('hydrateFastLocalSnapshot();');
  const durable = source.indexOf('await originalLoadAllData.apply(this, arguments);');
  assert.ok(fast >= 0, 'fast local hydrate must exist');
  assert.ok(durable > fast, 'fast local hydrate must run before durable load await');
  assert.match(source, /_naReadLocalSnapshot/);
  assert.match(source, /_naReadSessionSnapshot/);
  assert.match(source, /renderFastLocalPage/);
});

test('instant cache keeps canonical recovery path intact and LAB-only', () => {
  assert.match(source, /await originalLoadAllData\.apply\(this, arguments\)/);
  assert.equal(contract.environment, 'LABORATORIO');
  assert.equal(contract.canon_writes, false);
  assert.ok(contract.forbidden_files.includes('POS/**'));
});
