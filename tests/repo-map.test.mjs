import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const map = readFileSync('REPO_MAP.yaml', 'utf8');
const criticalWorkflow = readFileSync('.github/workflows/auto-dev-ci.yml', 'utf8');

function nodeTestPathsByStep(workflow) {
  const lines = workflow.split(/\r?\n/);
  const stepMarkers = lines
    .map((line, index) => {
      const match = line.match(/^(\s*)-\s+name:\s*(.+?)\s*$/);
      return match ? { indent: match[1].length, index, name: match[2] } : null;
    })
    .filter(Boolean);
  const paths = [];

  for (let stepIndex = 0; stepIndex < stepMarkers.length; stepIndex += 1) {
    const step = stepMarkers[stepIndex];
    const nextStep = stepMarkers
      .slice(stepIndex + 1)
      .find((candidate) => candidate.indent === step.indent);
    const stepLines = lines.slice(step.index + 1, nextStep?.index ?? lines.length);
    const runIndex = stepLines.findIndex((line) => /^\s*run:\s*/.test(line));
    if (runIndex === -1) continue;

    const runLine = stepLines[runIndex];
    const runIndent = runLine.match(/^\s*/)[0].length;
    const runValue = runLine.replace(/^\s*run:\s*/, '');
    let runScript = runValue === '|' || runValue === '>' ? '' : runValue;

    if (!runScript) {
      for (const line of stepLines.slice(runIndex + 1)) {
        if (line.trim() && line.match(/^\s*/)[0].length <= runIndent) break;
        runScript += `${line}\n`;
      }
    }

    const commands = runScript
      .replace(/\\\r?\n[ \t]*/g, ' ')
      .split(/\r?\n|&&|\|\||;/);
    for (const command of commands) {
      const testCommand = command.match(/(?:^|\s)node\s+--test(?:\s+|$)(.*)$/);
      if (!testCommand) continue;

      const tokens = [...testCommand[1].matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)]
        .map((match) => match[1] ?? match[2] ?? match[3]);
      for (const path of tokens) {
        if (
          path.startsWith('tests/') &&
          path.endsWith('.test.mjs') &&
          !/[*?\[\]]/.test(path)
        ) {
          paths.push({ path, step: step.name });
        }
      }
    }
  }

  return paths;
}

function assertWorkflowTestPathsExist(workflow, pathExists) {
  for (const { path, step } of nodeTestPathsByStep(workflow)) {
    assert.equal(
      pathExists(path),
      true,
      `CANON test workflow step "${step}" references missing test path: ${path}`,
    );
  }
}

test('REPO_MAP identifies current authority and release boundary', () => {
  assert.match(map, /active_branch: feature\/v1\.3-mobile-cloud/);
  assert.match(map, /production_baseline: v1\.2-production/);
  assert.match(map, /v1_3: ready_for_first_sale/);
  assert.match(map, /production_cutover: ready_for_first_sale/);
  assert.match(map, /authority_mode: ACTIVE/);
  assert.match(map, /ready_for_first_sale: true/);
  assert.match(map, /first_live_operation_id: null/);
  assert.match(map, /runtime_activation: production_active_ready_for_first_sale/);
  assert.match(map, /activation_migration_present: false/);
});

test('REPO_MAP canonical navigation paths exist', () => {
  const required = [
    'POS',
    'tools/cloudflare-lab/src/worker.js',
    'tools/cloudflare-lab/src/lab-workspace.js',
    'infra/database/migrations',
    'tools/cloudflare-backup',
    '.opencode/ROLE_MAP.md',
    '.opencode/agents/pos-canon-implementer.md',
    'docs/V1.3_STATUS.md',
    'docs/BRANCH_PREVIEW_WORKFLOW.md',
    'docs/LAB_RETIREMENT.md',
    'docs/REMEDIATION_PHASE9_BRANCH_CLASSIFICATION.md',
    'docs/REMEDIATION_FINAL_VERIFICATION.md',
    'tests/cloud-sync',
    'tests/product-fixes',
  ];
  for (const path of required) {
    assert.equal(existsSync(path), true, 'missing mapped path: ' + path);
  }
});

test('REPO_MAP preserves unrelated historical artifacts while retiring active POS-LAB', () => {
  for (const path of [
    'CVV2.4_backup_antes_demo-1.html',
    'nuevo-amanecer-pos-engineer.zip',
    'POS/js/legacy-inline',
    'POS/js/compat/legacy-globals.js',
    'evidence',
  ]) {
    assert.equal(existsSync(path), true, 'historical candidate disappeared before Phase 9 proof: ' + path);
  }
});

test('REPO_MAP records conservative branch hygiene', () => {
  assert.match(map, /checkpoint\/v1\.3-pc-20260923/);
  assert.match(map, /merged_recoverable_refs: 24/);
  assert.match(map, /safe_file_deletions_demonstrated: 0/);
  assert.match(map, /remote_branch_refs_deleted: false/);
});


test('REPO_MAP declares branch-preview as active development model and POS-LAB as historical', () => {
  assert.match(map, /retired_pos_lab:/);
  assert.match(map, /authority: removed_2026_10_24_recoverable_from_git_history/);
  assert.match(map, /branch_preview:/);
  assert.match(map, /source: exact_pr_sha/);
  assert.match(map, /preview_must_match_pr_sha: true/);
  assert.doesNotMatch(map, /lab_mirror:/);
  assert.doesNotMatch(map, /pages_lab:/);
});

test('AUTO-DEV critical job references existing literal Node test paths', () => {
  assertWorkflowTestPathsExist(criticalWorkflow, existsSync);
});

test('AUTO-DEV critical job path guard rejects missing literals and ignores globs', () => {
  const workflow = [
    'jobs:',
    '  tests:',
    '    steps:',
    '      - name: Synthetic CI regressions',
    '        run: |',
    '          node --test \\',
    '            tests/asistente/no-existe.test.mjs',
    '          node --test tests/work/*.test.mjs',
  ].join('\n');

  assert.throws(
    () => assertWorkflowTestPathsExist(workflow, () => false),
    /CANON test workflow step "Synthetic CI regressions" references missing test path: tests\/asistente\/no-existe\.test\.mjs/,
  );
  assert.deepEqual(
    nodeTestPathsByStep(workflow),
    [{ path: 'tests/asistente/no-existe.test.mjs', step: 'Synthetic CI regressions' }],
  );
});
