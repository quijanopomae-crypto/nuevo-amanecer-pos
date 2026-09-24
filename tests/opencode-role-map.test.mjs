import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

const agents = {
  canon: '.opencode/agents/pos-canon-implementer.md',
  lab: '.opencode/agents/pos-lab-implementer.md',
  shadow: '.opencode/agents/pos-implementer.md',
  planner: '.opencode/agents/pos-planner.md',
  reviewer: '.opencode/agents/pos-reviewer.md',
  tester: '.opencode/agents/pos-tester.md',
};

test('OpenCode exposes one explicit role for every working zone', () => {
  for (const [role, path] of Object.entries(agents)) {
    assert.equal(existsSync(path), true, role + ': ' + path);
  }
  assert.match(read('.opencode/ROLE_MAP.md'), /CANON[\s\S]*LAB[\s\S]*SHADOW[\s\S]*PLANNER[\s\S]*REVIEWER[\s\S]*TESTER/);
});

test('CANON implementer cannot silently deploy or write LAB', () => {
  const value = read(agents.canon);
  assert.match(value, /CANON_WRITE_LOCAL_ONLY/);
  assert.doesNotMatch(value, /"laboratorio\/\*\*": allow/);
  assert.doesNotMatch(value, /wrangler.*--remote.*allow/i);
  assert.doesNotMatch(value, /wrangler deploy.*allow/i);
});

test('LAB and SHADOW writers are fenced from CANON product writes', () => {
  const lab = read(agents.lab);
  assert.match(lab, /LAB_ONLY_ROLE/);
  assert.match(lab, /No escribas `POS\/\*\*`/);
  assert.match(lab, /No escribas [\s\S]*`tools\/cloudflare-lab\/\*\*`/);

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
    assert.match(value, /LAB/);
    assert.match(value, /SHADOW/);
  }
});

test('legacy generic commands require explicit SHADOW invocation', () => {
  for (const name of ['preflight', 'validate', 'feature-spec', 'orchestrate', 'resume']) {
    const value = read(`.opencode/commands/${name}.md`);
    assert.match(value, /SHADOW_EXPLICIT_ONLY/, name);
  }
});

test('CANON and LAB have unambiguous command entrypoints', () => {
  for (const name of ['canon-preflight', 'canon-validate', 'lab-preflight', 'lab-validate']) {
    assert.equal(existsSync(`.opencode/commands/${name}.md`), true, name);
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

test('skills have a single canonical source and role map classifies sensitive skills', () => {
  assert.equal(existsSync('.opencode/skills'), false);
  const roleMap = read('.opencode/ROLE_MAP.md');
  for (const skill of ['lab-scope-guard', 'lab-ui-edit', 'lab-animation-edit', 'lab-feature-edit', 'canon-promotion']) {
    assert.match(roleMap, new RegExp(skill));
  }
});
