import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const agents = {
  canon: '.opencode/agents/pos-canon-implementer.md',
  shadow: '.opencode/agents/pos-implementer.md',
  planner: '.opencode/agents/pos-planner.md',
  reviewer: '.opencode/agents/pos-reviewer.md',
  tester: '.opencode/agents/pos-tester.md',
};

test('OpenCode exposes one explicit role for every working zone', () => {
  for (const [role, path] of Object.entries(agents)) {
    assert.equal(existsSync(path), true, role + ': ' + path);
  }
  assert.match(read('.opencode/ROLE_MAP.md'), /CANON[\s\S]*Preview[\s\S]*SHADOW[\s\S]*PLANNER[\s\S]*REVIEWER[\s\S]*TESTER/i);
});

test('CANON implementer cannot silently deploy or write LAB', () => {
  const value = read(agents.canon);
  assert.match(value, /CANON_WRITE_LOCAL_ONLY/);
  assert.doesNotMatch(value, /"laboratorio\/\*\*": allow/);
  assert.doesNotMatch(value, /wrangler.*--remote.*allow/i);
  assert.doesNotMatch(value, /wrangler deploy.*allow/i);
});

test('retired LAB writer is absent and SHADOW remains fenced from CANON product writes', () => {
  assert.equal(existsSync('.opencode/agents/pos-lab-implementer.md'), false);
  const shadow = read(agents.shadow);
  assert.match(shadow, /SHADOW_ONLY_LEGACY_FILENAME/);
  assert.match(shadow, /PRODUCT_WRITE = DENIED/);
  assert.match(shadow, /pos-canon-implementer/);
});

test('planner reviewer tester remain non-writers and zone-aware', () => {
  for (const role of ['planner', 'reviewer', 'tester']) {
    const value = read(agents[role]);
    assert.match(value, /edit: deny/);
    assert.match(value, /CANON/);
    assert.match(value, /PREVIEW/);
    assert.match(value, /SHADOW/);
  }
});

test('legacy generic commands require explicit SHADOW invocation', () => {
  for (const name of ['preflight', 'validate', 'feature-spec', 'orchestrate', 'resume']) {
    const value = read(`.opencode/commands/${name}.md`);
    assert.match(value, /SHADOW_EXPLICIT_ONLY/, name);
  }
});

test('CANON commands remain active and retired LAB commands are absent', () => {
  for (const name of ['canon-preflight', 'canon-validate']) {
    assert.equal(existsSync(`.opencode/commands/${name}.md`), true, name);
  }
  for (const name of ['lab-preflight', 'lab-validate']) {
    assert.equal(existsSync(`.opencode/commands/${name}.md`), false, name);
  }
  assert.match(read('.opencode/commands/canon-preflight.md'), /CANON_COMMAND/);
  assert.match(read('.opencode/commands/canon-validate.md'), /CANON_COMMAND/);
});

test('legacy shadow manifest remains explicitly shadow and keeps compatibility alias', () => {
  const manifest = read('MANIFEST.yaml');
  assert.match(manifest, /environment:\s*shadow/);
  assert.match(manifest, /runtime_agent_id:\s*pos-implementer/);
  assert.doesNotMatch(manifest, /runtime_agent_id:\s*pos-canon-implementer/);
});

test('retired LAB skills are absent from active tooling', () => {
  assert.equal(existsSync('.opencode/skills'), false);
  for (const skill of ['lab-scope-guard', 'lab-ui-edit', 'lab-animation-edit', 'lab-feature-edit']) {
    assert.equal(existsSync(`.agents/skills/${skill}`), false, skill);
  }
  assert.match(read('.opencode/ROLE_MAP.md'), /skills LAB antiguas quedan retiradas/);
});
