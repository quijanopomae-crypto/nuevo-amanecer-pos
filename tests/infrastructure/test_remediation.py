from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from orchestrator.contracts import RiskLevel  # noqa: E402
from orchestrator.evidence import (  # noqa: E402
    EvidencePack,
    TrustVerificationError,
    sign_run_artifacts,
    verify_run_artifacts,
)
from orchestrator.evidence.trust import _verify_run_artifacts_with_anchor  # noqa: E402
from orchestrator.gates import RegressionClassification, compare_cash_baseline  # noqa: E402
from orchestrator.io_atomic import atomic_write_bytes, atomic_write_json, canonical_json_bytes  # noqa: E402
from orchestrator.schemas.validate_manifest import (  # noqa: E402
    ManifestValidationError,
    compute_manifest_digest,
    load_manifest,
    validate_manifest,
)
from orchestrator.shadow_mode import (  # noqa: E402
    GitIdentity,
    ShadowOrchestrator,
    _routing,
    load_scenarios,
)
from orchestrator.source_regression import (  # noqa: E402
    SourceRegressionError,
    verify_source_provenance,
)
from orchestrator.state.durable_state import (  # noqa: E402
    DurableEvent,
    StateSnapshot,
    validate_event_log,
)


SOURCE_COMMIT = "93c7bd73a6553b3aede655eea1204861264dfc22"


def digest(label: str) -> str:
    return "sha256:" + hashlib.sha256(label.encode("utf-8")).hexdigest()


class RemediationGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(prefix="remediation-suite-", dir=ROOT / "evidence")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.key_temporary = tempfile.TemporaryDirectory(prefix="remediation-signing-key-")
        cls.addClassCleanup(cls.key_temporary.cleanup)
        cls.temp = Path(cls.temporary.name)
        cls.key = Path(cls.key_temporary.name) / "ephemeral-ed25519"
        generated = subprocess.run(
            ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(cls.key)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if generated.returncode != 0:
            raise RuntimeError(generated.stderr)
        public = Path(str(cls.key) + ".pub").read_text(encoding="utf-8").split()
        cls.allowed = cls.temp / "allowed_signers"
        cls.allowed.write_text(
            f"nuevo-amanecer-pos-shadow {public[0]} {public[1]}\n",
            encoding="utf-8",
        )
        cls.manifest = load_manifest(ROOT / "MANIFEST.yaml")
        cls.snapshot_digest = json.loads(
            (ROOT / "infra" / "stable" / "SNAPSHOT.json").read_text(encoding="utf-8")
        )["snapshot_digest"]
        identity = GitIdentity(
            repo=str(ROOT),
            branch="codex/infra-shadow-remediation",
            head=SOURCE_COMMIT,
            worktree=str(ROOT),
            wip_fingerprint=digest("remediation-test"),
        )
        runner = ShadowOrchestrator(
            ROOT,
            cls.manifest,
            identity,
            signing_key=cls.key,
            snapshot_digest=cls.snapshot_digest,
        )
        scenario = load_scenarios(ROOT / "fixtures" / "shadow" / "scenarios.json")["cash-high"]
        cls.original = runner.run(scenario, cls.temp, run_id="signed-original").evidence_path.parent
        baseline = json.loads(
            (ROOT / "infra" / "stable" / "baselines" / "cash-v10-migration-base.json").read_text(encoding="utf-8")
        )
        cls.cash_candidate = json.loads(
            (ROOT / "tests" / "cash-v10-regression.report.json").read_text(encoding="utf-8")
        )
        product_bytes = (ROOT / next(iter(baseline["product_blobs"]))).read_bytes()
        source = {
            "hash": "sha256:" + hashlib.sha256(product_bytes).hexdigest(),
            "length": len(product_bytes.decode("utf-8").encode("utf-16-le")) // 2,
        }
        for item in cls.cash_candidate:
            item["report"]["source"] = source
        cls.cash_candidate_path = cls.temp / "cash-candidate.json"
        atomic_write_json(cls.cash_candidate_path, cls.cash_candidate)

    def copy_run(self, name: str) -> Path:
        target = self.temp / name
        shutil.copytree(self.original, target)
        return target

    def assert_rejected(self, run_dir: Path) -> None:
        with self.assertRaises(TrustVerificationError):
            _verify_run_artifacts_with_anchor(
                run_dir,
                self.allowed,
                expected_snapshot_digest=self.snapshot_digest,
            )

    def test_01_original_detached_signature_passes(self) -> None:
        pack = _verify_run_artifacts_with_anchor(
            self.original,
            self.allowed,
            expected_snapshot_digest=self.snapshot_digest,
        )
        self.assertEqual("READY_FOR_CODEX_REVIEW", pack.payload["verdict"])
        with self.assertRaisesRegex(TrustVerificationError, "outside the repository"):
            sign_run_artifacts(
                ROOT,
                self.original,
                self.original / "EVIDENCE_PACK.json",
                self.snapshot_digest,
            )

    def test_02_verdict_tamper_and_recomputed_digest_is_rejected(self) -> None:
        run = self.copy_run("tamper-verdict")
        path = run / "EVIDENCE_PACK.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        value["verdict"] = "APPROVED"
        value["evidence_digest"] = EvidencePack.compute_digest(value)
        atomic_write_json(path, value)
        self.assert_rejected(run)
        with self.assertRaises(TrustVerificationError):
            verify_run_artifacts(ROOT, run)

    def test_03_state_and_complete_event_chain_rewrite_is_rejected(self) -> None:
        run = self.copy_run("tamper-chain")
        log_path = run / "state" / "events.jsonl"
        events = validate_event_log(log_path)
        rewritten = []
        previous = "GENESIS"
        for event in events:
            record = replace(event.record, next_action=f"forged-{event.sequence}")
            updated = DurableEvent.create(event.sequence, previous, record)
            rewritten.append(updated)
            previous = updated.digest
        atomic_write_bytes(
            log_path,
            b"".join(canonical_json_bytes(event.to_dict()) + b"\n" for event in rewritten),
        )
        atomic_write_json(
            run / "state" / "STATE.json",
            StateSnapshot(rewritten[-1].record, rewritten[-1].sequence, rewritten[-1].digest).to_dict(),
        )
        pack_path = run / "EVIDENCE_PACK.json"
        pack = json.loads(pack_path.read_text(encoding="utf-8"))
        pack["state_history"] = [event.to_dict() for event in rewritten]
        pack["next_action"] = rewritten[-1].record.next_action
        pack["evidence_digest"] = EvidencePack.compute_digest(pack)
        atomic_write_json(pack_path, pack)
        self.assert_rejected(run)

    def test_04_chain_truncation_with_rewritten_state_and_pack_is_rejected(self) -> None:
        run = self.copy_run("tamper-truncate")
        log_path = run / "state" / "events.jsonl"
        events = validate_event_log(log_path)[:-1]
        atomic_write_bytes(
            log_path,
            b"".join(canonical_json_bytes(event.to_dict()) + b"\n" for event in events),
        )
        atomic_write_json(
            run / "state" / "STATE.json",
            StateSnapshot(events[-1].record, events[-1].sequence, events[-1].digest).to_dict(),
        )
        pack_path = run / "EVIDENCE_PACK.json"
        pack = json.loads(pack_path.read_text(encoding="utf-8"))
        pack["state_history"] = [event.to_dict() for event in events]
        pack["verdict"] = events[-1].record.state.value
        pack["next_action"] = events[-1].record.next_action
        pack["evidence_digest"] = EvidencePack.compute_digest(pack)
        atomic_write_json(pack_path, pack)
        self.assert_rejected(run)

    def test_05_event_reordering_is_rejected(self) -> None:
        run = self.copy_run("tamper-reorder")
        log_path = run / "state" / "events.jsonl"
        events = list(validate_event_log(log_path))
        events[1], events[2] = events[2], events[1]
        atomic_write_bytes(
            log_path,
            b"".join(canonical_json_bytes(event.to_dict()) + b"\n" for event in events),
        )
        self.assert_rejected(run)

    def test_06_source_bundle_provenance_is_exhaustive(self) -> None:
        metadata = verify_source_provenance(ROOT)
        self.assertEqual(SOURCE_COMMIT, metadata["source_commit"])
        self.assertEqual(93, metadata["methods"])
        omitted = copy.deepcopy(metadata)
        omitted["promoted_blobs"].pop(next(iter(omitted["promoted_blobs"])))
        path = self.temp / "omitted-promotion.json"
        atomic_write_json(path, omitted)
        with self.assertRaises(SourceRegressionError):
            verify_source_provenance(ROOT, path)

    def test_07_nonexistent_source_commit_fails(self) -> None:
        metadata = json.loads(
            (ROOT / "infra" / "stable" / "source" / "SOURCE_REGRESSION.json").read_text(encoding="utf-8")
        )
        metadata["source_commit"] = "0" * 40
        path = self.temp / "missing-source.json"
        atomic_write_json(path, metadata)
        with self.assertRaises(SourceRegressionError):
            verify_source_provenance(ROOT, path)

    def test_08_manifest_model_mutation_changes_runtime_routing(self) -> None:
        altered = copy.deepcopy(self.manifest)
        altered["models"]["primary-implementation"]["model_id"] = "fixture/primary-v2"
        altered["models"]["conditional-second-engineer"]["model_id"] = "fixture/reviewer-v2"
        scenario = load_scenarios(ROOT / "fixtures" / "shadow" / "scenarios.json")["cash-high"]
        routing, _, _ = _routing(scenario, RiskLevel.HIGH, altered)
        self.assertEqual("fixture/primary-v2", routing["primary"])
        self.assertEqual("fixture/reviewer-v2:reasoning=max", routing["conditional_review"])
        altered["routing"]["second_engineer"]["risks"] = []
        altered["routing"]["critical_reviewer"]["risks"] = []
        routing_without_triggers, _, _ = _routing(scenario, RiskLevel.HIGH, altered)
        self.assertIsNone(routing_without_triggers["conditional_review"])
        self.assertEqual("NOT_REQUIRED", routing_without_triggers["codex"])
        critical = copy.deepcopy(self.manifest)
        critical["models"]["external-forensic"]["model_id"] = "fixture/critical-v2"
        critical_routing, _, _ = _routing(scenario, RiskLevel.HIGH, critical)
        self.assertEqual("fixture/critical-v2:high-critical-release", critical_routing["critical_reviewer"])
        wrong_worktree = load_scenarios(ROOT / "fixtures" / "shadow" / "scenarios.json")["wrong-worktree"]
        blocked_routing, _, _ = _routing(wrong_worktree, RiskLevel.CRITICAL, self.manifest)
        self.assertIsNone(blocked_routing["primary"])
        self.assertIsNone(blocked_routing["conditional_review"])
        self.assertIsNone(blocked_routing["critical_reviewer"])
        self.assertEqual("DENY", blocked_routing["codex"])

    def test_09_opencode_resolves_four_project_specific_agents(self) -> None:
        opencode = shutil.which("opencode")
        if opencode is None:
            self.fail("OpenCode 1.18.18 executable is unavailable")
        version = subprocess.run(
            [opencode, "--version"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
        )
        self.assertEqual("1.18.18", version.stdout.strip())
        for role, policy in self.manifest["roles"].items():
            agent_id = policy["runtime_agent_id"]
            resolved = subprocess.run(
                [opencode, "debug", "agent", agent_id],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            with self.subTest(role=role, agent=agent_id):
                self.assertEqual(0, resolved.returncode, resolved.stderr)
                value = json.loads(resolved.stdout)
                descriptor = (ROOT / ".opencode" / "agents" / f"{agent_id}.md").read_text(encoding="utf-8")
                self.assertEqual(agent_id, value["name"])
                self.assertIn(value["description"], descriptor)
                self.assertIn(value["prompt"].replace("\r\n", "\n"), descriptor.replace("\r\n", "\n"))
                self.assertNotIn("model", value)

    def test_10_tools_manifest_is_coherent(self) -> None:
        self.assertNotIn("tools", self.manifest["paths"])
        self.assertFalse((ROOT / ".opencode" / "tools").exists())
        for mutate in (
            lambda value: value["shadow_write_policy"].__setitem__("writable_path_ref", "tests"),
            lambda value: value["paths"].__setitem__("evidence", "tests/infrastructure"),
        ):
            altered = copy.deepcopy(self.manifest)
            mutate(altered)
            altered["integrity"]["manifest_sha256"] = compute_manifest_digest(altered)
            with self.assertRaises(ManifestValidationError):
                validate_manifest(altered, ROOT)

    def test_11_cash_matches_versioned_baseline(self) -> None:
        result = compare_cash_baseline(ROOT, self.cash_candidate_path)
        self.assertEqual(RegressionClassification.BASELINE_EXPECTED, result.classification)
        self.assertEqual((11, 2, 13), (result.pass_count, result.fail_count, result.total_count))

    def test_12_cash_changed_failure_is_new_regression(self) -> None:
        baseline = json.loads(
            (ROOT / "infra" / "stable" / "baselines" / "cash-v10-migration-base.json").read_text(encoding="utf-8")
        )
        report = copy.deepcopy(self.cash_candidate)
        report[0]["report"]["cases"][6]["detail"]["result"]["error"]["code"] = "CHANGED"
        report_path = self.temp / "cash-changed.json"
        atomic_write_bytes(report_path, json.dumps(report).encode("utf-8"))
        baseline_path = self.temp / "cash-changed-baseline.json"
        atomic_write_json(baseline_path, baseline)
        result = compare_cash_baseline(ROOT, report_path, baseline_path)
        self.assertEqual(RegressionClassification.NEW_REGRESSION, result.classification)

    def test_13_clean_explicit_baseline_classifies_pass(self) -> None:
        baseline = json.loads(
            (ROOT / "infra" / "stable" / "baselines" / "cash-v10-migration-base.json").read_text(encoding="utf-8")
        )
        report = copy.deepcopy(self.cash_candidate)
        for item in report:
            for case in item["report"]["cases"]:
                case["status"] = "PASS"
            item["report"]["pass"] = 13
            item["report"]["fail"] = 0
            item["report"]["total"] = 13
            item["report"]["status"] = "PASS"
        report_path = self.temp / "cash-clean.json"
        atomic_write_bytes(report_path, json.dumps(report).encode("utf-8"))
        baseline["expected"] = {"pass": 13, "fail": 0, "total": 13, "failures": []}
        baseline_path = self.temp / "cash-clean-baseline.json"
        atomic_write_json(baseline_path, baseline)
        result = compare_cash_baseline(ROOT, report_path, baseline_path)
        self.assertEqual(RegressionClassification.PASS, result.classification)

    def test_14_missing_report_classifies_blocked(self) -> None:
        baseline = json.loads(
            (ROOT / "infra" / "stable" / "baselines" / "cash-v10-migration-base.json").read_text(encoding="utf-8")
        )
        baseline_path = self.temp / "cash-blocked-baseline.json"
        atomic_write_json(baseline_path, baseline)
        result = compare_cash_baseline(ROOT, self.temp / "does-not-exist.json", baseline_path)
        self.assertEqual(RegressionClassification.BLOCKED, result.classification)
        stale = compare_cash_baseline(ROOT, ROOT / "tests" / "cash-v10-regression.report.json")
        self.assertEqual(RegressionClassification.BLOCKED, stale.classification)
        invalid_base = copy.deepcopy(baseline)
        invalid_base["base_commit"] = "0" * 40
        invalid_path = self.temp / "cash-invalid-base.json"
        atomic_write_json(invalid_path, invalid_base)
        invalid = compare_cash_baseline(ROOT, self.cash_candidate_path, invalid_path)
        self.assertEqual(RegressionClassification.BLOCKED, invalid.classification)


if __name__ == "__main__":
    unittest.main()
