# Remediation Phase 9 — branch and historical artifact classification

Date: 2026-09-24.

This phase classifies repository history without deleting unique work. GitHub is the source of truth.

## Branch result

There are 26 visible branches at the start of this phase.

### ACTIVE

- `feature/v1.3-mobile-cloud` — default/active integration branch.

### UNMERGED_WORK — preserve

- `checkpoint/v1.3-pc-20260923`
  - tip: `051d38fb851dc5886a1e5c313285ce09f8199439`
  - comparison against active main at Phase 9: 5 commits ahead / 97 behind;
  - contains unique checkpoint work across POS, cloud-sync tests and Cloudflare files;
  - previously classified in Phase 5 for selective integration;
  - **do not delete and do not blindly merge/cherry-pick**.

### MERGED / recoverable branch refs

The following branch heads are proven integrated by merged PR or by having zero commits ahead of current main. Their remote refs are no longer needed as sources of unique work.

| Branch | Proof |
| --- | --- |
| `lab/bootstrap-laboratorio` | PR #1 merged; head `bd893be2...` |
| `lab/pos-html-sandbox` | PR #2 merged; head `1f5cbae4...` |
| `lab/modular-ui-foundation` | PR #3 merged; head `475e85a9...` |
| `lab/mobile-static-access` | PR #4 merged; head `ed28e78b...` |
| `lab/canon-mirror-workspace` | PR #5 merged; head `8617f4f4...` |
| `lab/sql-backup-mirror-fix` | PR #6 merged; head `9f56b699...` |
| `lab/fix-deploy-order` | PR #7 merged; head `8bf71da6...` |
| `lab/register-deploy-workflow-v2` | PR #8 merged; head `793fd0ea...` |
| `lab/fix-deploy-yaml` | PR #9 merged; head `76a9f1b7...` |
| `lab/fix-d1-trigger-parser` | PR #10 merged; head `1e0d3691...` |
| `lab/fix-import-signature-order` | PR #11 merged; head `55f96013...` |
| `lab/provision-mobile-writer` | PR #12 merged; head `fd94d5a3...` |
| `lab/mobile-token-copy-ui` | PR #13 merged; head `4b21f44d...` |
| `lab/demo-credit-fixtures` | 0 commits ahead; tip `6f5e0280...` is already behind current main |
| `remediation/phase1-policy-sources` | PR #14 merged; exact head `a65099ca...` |
| `remediation/phase2-import-safety` | PR #15 merged; exact head `1d46b8aa...` |
| `remediation/phase3-workspace-recovery` | PR #16 merged; exact head `44751499...` |
| `remediation/phase4a-task-guards` | PR #17 merged; exact head `aa1aedb7...` |
| `remediation/phase4b-canon-critical-ci` | PR #18 merged; 0 commits ahead |
| `remediation/phase5a-backup-recovery-code` | PR #19 merged; 0 commits ahead |
| `remediation/phase5b-dormant-canon-schema` | PR #20 merged; 0 commits ahead |
| `remediation/phase6-agent-role-clarity` | PR #21 merged; 0 commits ahead |
| `remediation/phase7-security-infra` | PR #22 merged; 0 commits ahead |
| `remediation/phase8-repo-map-docs` | PR #23 merged; 0 commits ahead |

Some older merged PR branches compare as `diverged` because their head commits are not ancestors in the current history shape. The merged PR record with the exact head SHA is the integration proof; a raw ahead/behind result alone is not used to call them unmerged.

These 24 merged refs are **safe branch-ref deletion candidates** because no unique required work depends on them and each can be recreated from its recorded commit/PR. This connected GitHub toolset does not expose a branch-ref deletion action, so the refs are classified but intentionally left untouched.

## Historical and duplicate-file result

### Active runtime — not deletable

`POS/index.html` directly loads:

- `POS/js/legacy-inline/inline-01.js` through `inline-18.js`;
- `POS/js/compat/legacy-globals.js`.

Therefore the legacy-inline tree and compatibility globals are current runtime dependencies, regardless of their names.

### Preserve until separate proof exists

- `CVV1.1.html`
- `CVV2.4_backup_antes_demo-1.html`
- `nuevo-amanecer-pos-engineer.zip`

Their names suggest historical/backup material, but naming is not deletion proof. Phase 9 does not delete them.

### Historical evidence — preserve

- `evidence/`
- gate-specific remediation and V1.2/V1.3 documents already identified by `REPO_MAP.yaml`.

Evidence may be stale as current-state documentation but remains useful for provenance.

## Deletion counters

- demonstrated safe file deletions: **0**
- file deletions performed: **0**
- unique checkpoint branches preserved: **1**
- active branches preserved: **1**
- merged/recoverable branch refs classified: **24**
- branch refs deleted by this session: **0** (no branch-delete action is exposed by the connected GitHub tool)

This phase treats classification as the required safety result. It does not convert uncertainty into deletion.
