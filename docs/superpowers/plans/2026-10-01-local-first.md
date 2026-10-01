# Local-first implementation plan

Spec: docs/LOCAL_FIRST_POS_V13_SPEC.md. Base: f865ae53a3330ed9cbf71fe9141f64a3fc0ac165.
Single code writer; owner approved execution. No deploy, merge, production writes or secret changes.

1. Contract/preflight before POS edits.
2. V10 local store: baseline + ledger + projection + checkpoint in one transaction. Real IndexedDB durability, failure, concurrency and reconstruction tests first.
3. Deterministic canonical reducers: sale/payment/batch/cash/expenses/customers/products/inventory/policies/accounts/compensation. Preserve per-resource revisions and exact integer money/physical units.
4. Client integration and bootstrap: local valid wins; remote work never in visible commit. Migration preserves unknown pending as NEEDS_REVIEW.
5. Bridges: commit local, close modal, immediate shared projection, no foreign-pending block. Both sale buttons share capture.
6. Replica: immutable envelopes, causal order, bounded backoff, ACK durable, sequence/hash metadata and existing Worker validation in atomic batches.
7. Authority/recovery: explicit owner grant, single writer under current promotion/epoch; ACK-loss evidence detection; no auto restore; staged verified cloud→local generation and owner-authorized replay/recovery synthetic only.
8. Final review, metrics, regressions, commits and PR. No merge or deploy.

Review focus: quota/crash; stale cash revisions; same-ID changed payload; unknown pre-migration ACK; offline writer promotion.
Each stage requires a failing behavioral regression followed by focal PASS and a reversible commit.
