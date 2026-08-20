from __future__ import annotations

import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from orchestrator.evidence.pack import EvidencePack  # noqa: E402
from orchestrator.evidence.trust import _verify_run_artifacts_with_anchor  # noqa: E402
from orchestrator.project_validation import (  # noqa: E402
    EXPECTED_COMMANDS,
    EXPECTED_SKILLS,
    validate_project,
)
from orchestrator.schemas.validate_manifest import (  # noqa: E402
    compute_manifest_digest,
    load_manifest,
    validate_manifest_file,
)
from orchestrator.shadow_mode import (  # noqa: E402
    GitIdentity,
    ProductWriteDenied,
    ShadowOrchestrator,
    assert_shadow_write_allowed,
    load_scenarios,
)
from orchestrator.snapshot import (  # noqa: E402
    SnapshotValidationError,
    _sha256_file,
    validate_snapshot,
    validate_snapshot_payload,
)
from orchestrator.state.durable_state import validate_event_log  # noqa: E402
from orchestrator.state.state_machine import State  # noqa: E402


SOURCE_COMMIT = "93c7bd73a6553b3aede655eea1204861264dfc22"
BASE_COMMIT = "28b90db0308a1bdddd3024374d7461aa22acc520"
SCENARIO_IDS = {
    "cosmetic-low",
    "inventory-high",
    "cash-high",
    "credits-high",
    "harness-failure",
    "wrong-worktree",
    "resource-limit",
    "provider-failure",
    "unknown-critical",
}


def digest(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def repository_surface_hashes() -> dict[str, str]:
    result: dict[str, str] = {}
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT)
        if relative.parts[0] in {".git", "evidence"} or "__pycache__" in relative.parts:
            continue
        result[relative.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


class ShadowModeIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(prefix="shadow-suite-", dir=ROOT / "evidence")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.key_temporary = tempfile.TemporaryDirectory(prefix="shadow-signing-key-")
        cls.addClassCleanup(cls.key_temporary.cleanup)
        cls.output_root = Path(cls.temporary.name)
        cls.scenarios = load_scenarios(ROOT / "fixtures" / "shadow" / "scenarios.json")
        manifest = load_manifest(ROOT / "MANIFEST.yaml")
        cls.manifest = manifest
        cls.snapshot_digest = json.loads(
            (ROOT / "infra" / "stable" / "SNAPSHOT.json").read_text(encoding="utf-8")
        )["snapshot_digest"]
        cls.signing_key = Path(cls.key_temporary.name) / "test-ed25519"
        generated = subprocess.run(
            ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(cls.signing_key)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if generated.returncode != 0:
            raise RuntimeError(generated.stderr)
        public_key = Path(str(cls.signing_key) + ".pub").read_text(encoding="utf-8").split()
        cls.allowed_signers = cls.output_root / "allowed_signers"
        cls.allowed_signers.write_text(
            f"nuevo-amanecer-pos-shadow {public_key[0]} {public_key[1]}\n",
            encoding="utf-8",
        )
        identity = GitIdentity(
            repo=str(ROOT),
            branch="codex/infra-shadow-mode",
            head=BASE_COMMIT,
            worktree=str(ROOT),
            wip_fingerprint=digest("synthetic-wip"),
        )
        runner = ShadowOrchestrator(
            ROOT,
            manifest,
            identity,
            signing_key=cls.signing_key,
            snapshot_digest=cls.snapshot_digest,
        )
        cls.surface_before = repository_surface_hashes()
        cls.results = {
            scenario_id: runner.run(scenario, cls.output_root, run_id=scenario_id)
            for scenario_id, scenario in cls.scenarios.items()
        }
        cls.surface_after = repository_surface_hashes()

    def test_01_project_layout_validates(self) -> None:
        result = validate_project(ROOT)
        expected_agents = sorted(role["runtime_agent_id"] for role in self.manifest["roles"].values())
        self.assertEqual(expected_agents, result["agents"])
        self.assertEqual(sorted(EXPECTED_COMMANDS), result["commands"])
        self.assertEqual(sorted(EXPECTED_SKILLS), result["skills"])

    def test_02_manifest_shadow_is_strict_and_valid(self) -> None:
        value = validate_manifest_file(ROOT / "MANIFEST.yaml", ROOT)
        self.assertTrue(value["strict"])
        self.assertEqual("shadow", value["metadata"]["environment"])
        self.assertEqual(4, len(value["roles"]))

    def test_03_agents_are_exact_and_model_agnostic(self) -> None:
        agents = ROOT / ".opencode" / "agents"
        expected_agents = {role["runtime_agent_id"] for role in self.manifest["roles"].values()}
        self.assertEqual(expected_agents, {path.stem for path in agents.glob("*.md")})
        for path in agents.glob("*.md"):
            self.assertNotIn("\nmodel:", path.read_text(encoding="utf-8"))

    def test_04_skills_are_exact_and_canonical(self) -> None:
        root = ROOT / ".agents" / "skills"
        self.assertEqual(EXPECTED_SKILLS, {path.name for path in root.iterdir() if path.is_dir()})
        self.assertFalse((ROOT / ".opencode" / "skills").exists())

    def test_05_commands_are_exact(self) -> None:
        root = ROOT / ".opencode" / "commands"
        self.assertEqual(EXPECTED_COMMANDS, {path.stem for path in root.glob("*.md")})

    def test_06_v2_fallback_is_preserved(self) -> None:
        config = json.loads((ROOT / "opencode.json").read_text(encoding="utf-8"))
        self.assertIn("AGENTS_Nuevo_Amanecer.md", config["instructions"])
        self.assertTrue((ROOT / "AGENTS_Nuevo_Amanecer.md").is_file())

    def test_07_nine_required_scenarios_are_loaded(self) -> None:
        self.assertEqual(SCENARIO_IDS, set(self.scenarios))

    def test_08_each_scenario_produces_state_and_evidence(self) -> None:
        for scenario_id, result in self.results.items():
            with self.subTest(scenario=scenario_id):
                self.assertTrue(result.state_path.is_file())
                self.assertTrue(result.evidence_path.is_file())

    def test_09_risk_and_state_match_declared_expectations(self) -> None:
        for scenario_id, scenario in self.scenarios.items():
            with self.subTest(scenario=scenario_id):
                result = self.results[scenario_id]
                self.assertEqual(scenario.payload["expected_risk"], result.risk.value)
                self.assertEqual(scenario.payload["expected_state"], result.state.value)

    def test_10_high_and_critical_routing_is_conditional(self) -> None:
        for scenario_id in ("inventory-high", "cash-high", "credits-high", "unknown-critical"):
            with self.subTest(scenario=scenario_id):
                routing = self.results[scenario_id].routing
                primary_ref = self.manifest["routing"]["primary_implementer"]["model_ref"]
                second_ref = self.manifest["routing"]["second_engineer"]["model_ref"]
                primary = self.manifest["models"][primary_ref]
                second = self.manifest["models"][second_ref]
                self.assertEqual(primary["model_id"], routing["primary"])
                self.assertEqual(
                    f"{second['model_id']}:{second['variant']}",
                    routing["conditional_review"],
                )
                self.assertEqual("ADMIT", routing["codex"])

    def test_11_non_evaluable_failures_do_not_route_models(self) -> None:
        for scenario_id in ("resource-limit", "provider-failure"):
            with self.subTest(scenario=scenario_id):
                routing = self.results[scenario_id].routing
                self.assertIsNone(routing["primary"])
                self.assertIsNone(routing["conditional_review"])
                self.assertEqual("DENY", routing["codex"])

    def test_12_failure_classification_is_preserved_in_evidence(self) -> None:
        for scenario_id in ("harness-failure", "wrong-worktree", "resource-limit", "provider-failure", "unknown-critical"):
            with self.subTest(scenario=scenario_id):
                pack = _verify_run_artifacts_with_anchor(
                    self.results[scenario_id].evidence_path.parent,
                    self.allowed_signers,
                    expected_snapshot_digest=self.snapshot_digest,
                )
                self.assertEqual(self.scenarios[scenario_id].payload["failure_code"], pack.payload["failures"][0]["code"])
                self.assertEqual(self.scenarios[scenario_id].payload["failure_class"], pack.payload["failures"][0]["classification"])

    def test_13_event_logs_validate_for_every_run(self) -> None:
        for result in self.results.values():
            events = validate_event_log(result.state_path.parent / "events.jsonl")
            self.assertEqual(result.state, events[-1].record.state)
            self.assertEqual(result.next_action, events[-1].record.next_action)

    def test_14_evidence_pack_digests_validate(self) -> None:
        for result in self.results.values():
            pack = _verify_run_artifacts_with_anchor(
                result.evidence_path.parent,
                self.allowed_signers,
                expected_snapshot_digest=self.snapshot_digest,
            )
            self.assertTrue(pack.digest.startswith("sha256:"))

    def test_15_codex_handoffs_are_manual_and_only_when_admitted(self) -> None:
        for scenario_id, result in self.results.items():
            admitted = result.routing["codex"] == "ADMIT"
            self.assertEqual(admitted, result.handoff_path is not None, scenario_id)
            if result.handoff_path:
                self.assertIn("MANUAL_USER_HANDOFF_TO_CODEX_APP", result.handoff_path.read_text(encoding="utf-8"))

    def test_16_product_write_is_denied(self) -> None:
        with self.assertRaises(ProductWriteDenied):
            assert_shadow_write_allowed(ROOT, ROOT / "CVV2.4_backup_antes_demo-1.html", self.manifest)
        with self.assertRaises(ProductWriteDenied):
            assert_shadow_write_allowed(
                ROOT,
                ROOT / "tests" / "v10-credits-payments-engine.html",
                self.manifest,
            )

    def test_17_shadow_execution_changes_no_non_evidence_file(self) -> None:
        self.assertEqual(self.surface_before, self.surface_after)

    def test_18_resume_uses_a_second_process_and_recovers_next_action(self) -> None:
        state_root = Path(self.temporary.name) / "resume-state"
        relative = state_root.relative_to(ROOT).as_posix()
        start = subprocess.run(
            [sys.executable, "-B", "orchestrator/shadow_cli.py", "resume-start", relative],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(75, start.returncode, start.stderr)
        resumed = subprocess.run(
            [sys.executable, "-B", "orchestrator/shadow_cli.py", "resume", relative],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(0, resumed.returncode, resumed.stderr)
        payload = json.loads(resumed.stdout)
        self.assertEqual("RECOVERABLE", payload["status"])
        self.assertEqual("run Resource Check", payload["next_action"])

    def test_19_snapshot_and_all_file_digests_validate(self) -> None:
        snapshot = validate_snapshot(ROOT / "infra" / "stable" / "SNAPSHOT.json", ROOT)
        self.assertEqual(SOURCE_COMMIT, snapshot["source_commit"])
        self.assertEqual(BASE_COMMIT, snapshot["target_base_commit"])

    def test_20_snapshot_tampering_is_rejected(self) -> None:
        snapshot = validate_snapshot(ROOT / "infra" / "stable" / "SNAPSHOT.json", ROOT)
        altered = copy.deepcopy(snapshot)
        first = next(iter(altered["file_digests"]))
        altered["file_digests"][first] = digest("altered")
        with self.assertRaises(SnapshotValidationError):
            validate_snapshot_payload(altered, ROOT)

    def test_21_comparison_contains_every_required_dimension(self) -> None:
        value = json.loads((ROOT / "infra" / "stable" / "INFRA_V2_COMPARISON.json").read_text(encoding="utf-8"))
        self.assertEqual(
            {"scope", "risk", "preflight", "routing", "anti-loop", "failure_handling", "evidence", "resume_capability"},
            set(value["dimensions"]),
        )
        self.assertEqual("WORSE", value["dimensions"]["routing"]["rating"])

    def test_22_runtime_has_no_persistent_service_dependency(self) -> None:
        text = "\n".join(
            (ROOT / "orchestrator" / name).read_text(encoding="utf-8")
            for name in ("shadow_mode.py", "shadow_cli.py", "snapshot.py", "project_validation.py")
        )
        for forbidden in ("http.server", "socketserver", "multiprocessing", "start-process"):
            self.assertNotIn(forbidden, text.casefold())

    def test_23_snapshot_digests_are_line_ending_independent(self) -> None:
        lf = Path(self.temporary.name) / "lf.txt"
        crlf = Path(self.temporary.name) / "crlf.txt"
        lf.write_bytes(b"one\ntwo\n")
        crlf.write_bytes(b"one\r\ntwo\r\n")
        self.assertEqual(_sha256_file(lf), _sha256_file(crlf))


if __name__ == "__main__":
    unittest.main()
