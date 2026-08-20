from __future__ import annotations

import json
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch


LAB_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(LAB_ROOT))

from orchestrator.contracts import (  # noqa: E402
    DependencyMap,
    FeatureSpec,
    ImpactAnalysis,
    RiskClassifier,
    RiskLevel,
)
from orchestrator.contracts.dependency_map import DependencyMapError  # noqa: E402
from orchestrator.contracts.feature_spec import FeatureSpecError  # noqa: E402
from orchestrator.contracts.impact_analysis import ImpactAnalysisError  # noqa: E402
from orchestrator.evidence import EvidencePack, EvidencePackError  # noqa: E402
from orchestrator.gates import CodexAdmissionContext, CodexAdmissionGate, CodexDecision  # noqa: E402
from orchestrator.handoff import CodexHandoffError, write_codex_escalation_report  # noqa: E402
from orchestrator.io_atomic import atomic_write_json, canonical_json_bytes, sha256_digest  # noqa: E402
from orchestrator.metrics import MetricRecord, MetricsLedger, ModelFit, classify_model  # noqa: E402
from orchestrator.schemas.validate_manifest import load_manifest  # noqa: E402
from orchestrator.state.anti_loop import (  # noqa: E402
    ActionKind,
    AntiLoopGuard,
    CycleDecision,
    CycleOutcome,
    DuplicateCorrectiveAttempt,
)
from orchestrator.state.durable_state import (  # noqa: E402
    DurableEvent,
    DurableIllegalTransition,
    DurableStateCorruption,
    DurableStateRecord,
    DurableStateStore,
    DurableTerminalState,
    RecoveryStatus,
    SimulatedCrash,
    StateSnapshot,
    utc_now,
    validate_event_log,
)
from orchestrator.state.failure_taxonomy import FAILURE_CLASSIFICATIONS, FailureCode  # noqa: E402
from orchestrator.state.resource_check import (  # noqa: E402
    RESOURCE_NAMES,
    ProbeStatus,
    RealisticResourceCheck,
    ResourceMode,
    ResourceRequirement,
)
from orchestrator.state.state_machine import State  # noqa: E402


def digest(label: str) -> str:
    return sha256_digest({"label": label})


def admission_policy() -> dict[str, object]:
    return dict(load_manifest(LAB_ROOT / "MANIFEST.yaml")["routing"]["critical_reviewer"])


def initial_record() -> DurableStateRecord:
    return DurableStateRecord(
        run_id="run-stable",
        cycle_id=1,
        task_id="task-stable",
        state=State.RECEIVED,
        previous_state=None,
        timestamp=utc_now(),
        model="synthetic-model",
        attempt=0,
        risk="HIGH",
        failure_class=None,
        repo="synthetic/repo",
        branch="synthetic-branch",
        head="a" * 40,
        worktree="fixtures/synthetic-repo",
        wip_fingerprint=digest("wip"),
        manifest_digest=digest("manifest"),
        evidence_digest=digest("evidence-0"),
        next_action="run preflight",
    )


FLOW = (
    State.PREFLIGHT_RUNNING,
    State.PREFLIGHT_PASSED,
    State.RESOURCE_CHECK,
    State.RESOURCE_READY,
    State.SCOPED,
    State.INVESTIGATING,
    State.CAUSE_CONFIRMED,
    State.CONTRACT_READY,
    State.IMPLEMENTING,
    State.IMPLEMENTED,
    State.TESTING,
    State.REVIEWING,
    State.VERIFYING,
    State.APPROVED,
)


def advance(store: DurableStateStore, target: State, *, crash_at_target: bool = False) -> None:
    for index, state in enumerate(FLOW, start=1):
        store.transition(
            state,
            next_action=f"continue after {state.value}",
            attempt=1 if state is State.IMPLEMENTING else None,
            evidence_digest=digest(f"evidence-{index}"),
            simulate_crash_after_log=crash_at_target and state is target,
        )
        if state is target:
            return
    raise AssertionError(f"target not in flow: {target}")


def feature_spec(**overrides: object) -> FeatureSpec:
    value = {
        "objective": "Validate synthetic orchestration",
        "in_scope": ["orchestrator contracts"],
        "out_of_scope": ["POS product"],
        "acceptance_criteria": ["deterministic PASS"],
        "invariants": ["no product access"],
        "expected_files": ["orchestrator/state/durable_state.py"],
        "forbidden_files": ["product/pos.html"],
    }
    value.update(overrides)
    return FeatureSpec.from_dict(value)


def impact(**overrides: list[str]) -> ImpactAnalysis:
    value = {
        "reads": ["synthetic manifest"],
        "writes": [],
        "dom_affected": [],
        "state_affected": [],
        "storage_affected": [],
        "domain_invariants": [],
        "cross_module_impact": [],
    }
    value.update(overrides)
    return ImpactAnalysis.from_dict(value)


def dependency_map() -> DependencyMap:
    return DependencyMap.from_dict(
        {
            "modules": [
                {
                    "module": "state",
                    "depends_on": [],
                    "read_dependencies": ["manifest"],
                    "write_dependencies": ["evidence"],
                    "shared_globals": [],
                    "storage": ["STATE.json"],
                    "dom": [],
                    "tests": ["test_stabilization"],
                },
                {
                    "module": "gate",
                    "depends_on": ["state"],
                    "read_dependencies": ["evidence"],
                    "write_dependencies": [],
                    "shared_globals": [],
                    "storage": [],
                    "dom": [],
                    "tests": ["test_stabilization"],
                },
            ]
        }
    )


def resource_probes(**statuses: ProbeStatus) -> tuple[ResourceRequirement, ...]:
    optional = {"browser", "ports"}
    result = []
    for name in RESOURCE_NAMES:
        status = statuses.get(name, ProbeStatus.NOT_REQUIRED if name in optional else ProbeStatus.READY)
        failure_class = "RESOURCE_LIMIT" if status is ProbeStatus.UNAVAILABLE else None
        result.append(
            ResourceRequirement(
                name=name,
                required=name not in optional,
                status=status,
                detail=f"synthetic:{status.value.lower()}",
                failure_class=failure_class,
            )
        )
    return tuple(result)


def evidence_pack() -> EvidencePack:
    spec = feature_spec()
    analysis = impact(writes=["persistencia sintética"], storage_affected=["durable state"])
    risk = RiskClassifier.classify(spec, analysis)
    return EvidencePack.create(
        run_id="run-evidence",
        cycle_id=1,
        task_id="task-evidence",
        repo="synthetic/repo",
        branch="synthetic-branch",
        head="b" * 40,
        worktree="fixtures/synthetic-repo",
        wip_fingerprint=digest("evidence-wip"),
        manifest_digest=digest("evidence-manifest"),
        feature_spec=spec.to_dict(),
        risk_class=risk.level.value,
        impact_analysis=analysis.to_dict(),
        dependency_map=dependency_map().to_dict(),
        preflight={"status": "PASS"},
        resource_check={"mode": "READY"},
        state_history=[{"state": "RECEIVED", "sequence": 1}],
        commands_executed=["python -B -m unittest"],
        tests_executed=["test_stabilization"],
        results=[{"name": "synthetic", "status": "PASS"}],
        changed_files=["orchestrator/state/durable_state.py"],
        diff_patch="synthetic patch",
        failures=[{"code": "F10", "classification": "REVIEW_OR_VERIFY_REJECTION"}],
        confirmed_facts=["state log valid"],
        discarded_hypotheses=["server required"],
        unknowns=["real provider state"],
        verdict="READY_FOR_CODEX_REVIEW",
        residual_risks=["synthetic adapters only"],
        next_action="manual Codex handoff",
    )


class TemporaryCase(unittest.TestCase):
    def temporary(self) -> Path:
        evidence_root = LAB_ROOT / "evidence"
        evidence_root.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix="stabilization-", dir=evidence_root)
        self.addCleanup(temporary.cleanup)
        return Path(temporary.name)


class DurableStateTests(TemporaryCase):
    def store(self) -> DurableStateStore:
        store = DurableStateStore(self.temporary())
        store.initialize(initial_record())
        return store

    def test_01_state_persists_across_restart(self) -> None:
        store = self.store()
        advance(store, State.PREFLIGHT_PASSED)
        reopened = DurableStateStore(store.root).recover()
        self.assertEqual(RecoveryStatus.RECOVERABLE, reopened.status)
        self.assertEqual(State.PREFLIGHT_PASSED, reopened.record.state)
        self.assertEqual("continue after PREFLIGHT_PASSED", reopened.record.next_action)

    def test_02_atomic_write_preserves_previous_file_on_replace_failure(self) -> None:
        target = self.temporary() / "atomic.json"
        atomic_write_json(target, {"version": 1})
        before = target.read_bytes()
        with patch("orchestrator.io_atomic.os.replace", side_effect=OSError("synthetic replace failure")):
            with self.assertRaises(OSError):
                atomic_write_json(target, {"version": 2})
        self.assertEqual(before, target.read_bytes())
        self.assertEqual([], list(target.parent.glob(".atomic.json.*.tmp")))

    def test_03_manual_event_edit_is_detected(self) -> None:
        store = self.store()
        advance(store, State.PREFLIGHT_RUNNING)
        lines = store.log_path.read_text(encoding="utf-8").splitlines()
        changed = json.loads(lines[1])
        changed["record"]["next_action"] = "tampered"
        lines[1] = json.dumps(changed, separators=(",", ":"))
        store.log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        with self.assertRaises(DurableStateCorruption):
            validate_event_log(store.log_path)

    def test_04_event_reordering_is_detected(self) -> None:
        store = self.store()
        advance(store, State.PREFLIGHT_PASSED)
        lines = store.log_path.read_bytes().splitlines()
        store.log_path.write_bytes(b"\n".join((lines[0], lines[2], lines[1])) + b"\n")
        with self.assertRaises(DurableStateCorruption):
            validate_event_log(store.log_path)

    def test_05_log_truncation_against_state_is_blocked(self) -> None:
        store = self.store()
        advance(store, State.PREFLIGHT_RUNNING)
        first = store.log_path.read_bytes().splitlines()[0]
        store.log_path.write_bytes(first + b"\n")
        result = store.recover()
        self.assertEqual(RecoveryStatus.BLOCKED, result.status)
        self.assertIn("ahead", result.reason)

    def test_06_partial_event_is_detected(self) -> None:
        store = self.store()
        store.log_path.write_bytes(store.log_path.read_bytes() + b'{"sequence":2')
        with self.assertRaises(DurableStateCorruption):
            validate_event_log(store.log_path)

    def test_07_inconsistent_run_with_valid_digest_is_detected(self) -> None:
        store = self.store()
        first = validate_event_log(store.log_path)[0]
        changed = replace(
            first.record,
            run_id="other-run",
            state=State.PREFLIGHT_RUNNING,
            previous_state=State.RECEIVED,
        )
        event = DurableEvent.create(2, first.digest, changed)
        with store.log_path.open("ab") as stream:
            stream.write(canonical_json_bytes(event.to_dict()) + b"\n")
        with self.assertRaises(DurableStateCorruption):
            validate_event_log(store.log_path)

    def test_08_crash_after_preflight_recovers_next_action(self) -> None:
        store = self.store()
        store.transition(State.PREFLIGHT_RUNNING, next_action="complete preflight")
        with self.assertRaises(SimulatedCrash):
            store.transition(
                State.PREFLIGHT_PASSED,
                next_action="run resource check",
                simulate_crash_after_log=True,
            )
        result = DurableStateStore(store.root).recover()
        self.assertEqual(State.PREFLIGHT_PASSED, result.record.state)
        self.assertEqual("run resource check", result.record.next_action)
        self.assertTrue(result.repaired)

    def test_09_crash_during_model_attempt_is_recoverable(self) -> None:
        store = self.store()
        with self.assertRaises(SimulatedCrash):
            advance(store, State.IMPLEMENTING, crash_at_target=True)
        result = DurableStateStore(store.root).recover()
        self.assertEqual(RecoveryStatus.RECOVERABLE, result.status)
        self.assertEqual(State.IMPLEMENTING, result.record.state)
        self.assertEqual(1, result.record.attempt)

    def test_10_crash_after_test_gate_is_recoverable(self) -> None:
        store = self.store()
        with self.assertRaises(SimulatedCrash):
            advance(store, State.REVIEWING, crash_at_target=True)
        result = DurableStateStore(store.root).recover()
        self.assertEqual(State.REVIEWING, result.record.state)
        self.assertEqual("continue after REVIEWING", result.record.next_action)

    def test_11_crash_before_handoff_is_recoverable(self) -> None:
        store = self.store()
        advance(store, State.REVIEWING)
        with self.assertRaises(SimulatedCrash):
            store.transition(
                State.READY_FOR_CODEX_REVIEW,
                next_action="generate manual Codex handoff",
                simulate_crash_after_log=True,
            )
        result = DurableStateStore(store.root).recover()
        self.assertEqual(State.READY_FOR_CODEX_REVIEW, result.record.state)
        self.assertEqual("generate manual Codex handoff", result.record.next_action)

    def test_12_partially_written_state_is_rebuilt_from_log(self) -> None:
        store = self.store()
        advance(store, State.PREFLIGHT_RUNNING)
        store.state_path.write_text('{"record":', encoding="utf-8")
        result = store.recover()
        self.assertEqual(RecoveryStatus.RECOVERABLE, result.status)
        self.assertTrue(result.repaired)
        self.assertEqual(State.PREFLIGHT_RUNNING, DurableStateStore(store.root).recover().record.state)

    def test_13_valid_log_and_corrupt_state_is_recoverable(self) -> None:
        store = self.store()
        advance(store, State.RESOURCE_READY)
        store.state_path.write_text("not-json", encoding="utf-8")
        result = store.recover()
        self.assertEqual(RecoveryStatus.RECOVERABLE, result.status)
        self.assertEqual(State.RESOURCE_READY, result.record.state)

    def test_14_valid_state_and_contradictory_log_is_blocked(self) -> None:
        store = self.store()
        snapshot = store._read_snapshot()
        contradictory = StateSnapshot(
            replace(snapshot.record, next_action="contradictory action"),
            snapshot.event_sequence,
            snapshot.event_digest,
        )
        atomic_write_json(store.state_path, contradictory.to_dict())
        result = store.recover()
        self.assertEqual(RecoveryStatus.BLOCKED, result.status)
        self.assertIn("contradicts", result.reason)

    def test_15_terminal_state_is_immutable_durably(self) -> None:
        store = self.store()
        advance(store, State.APPROVED)
        with self.assertRaises(DurableTerminalState):
            store.transition(State.TESTING, next_action="forbidden")

    def test_16_illegal_transition_is_rejected_before_append(self) -> None:
        store = self.store()
        before = store.log_path.read_bytes()
        with self.assertRaises(DurableIllegalTransition):
            store.transition(State.APPROVED, next_action="illegal jump")
        self.assertEqual(before, store.log_path.read_bytes())

    def test_17_invalid_record_is_rejected_before_append(self) -> None:
        store = self.store()
        before = store.log_path.read_bytes()
        with self.assertRaises(DurableStateCorruption):
            store.transition(
                State.PREFLIGHT_RUNNING,
                next_action="must not persist",
                attempt=-1,
            )
        self.assertEqual(before, store.log_path.read_bytes())


class ContractTests(unittest.TestCase):
    def test_17_feature_spec_round_trip(self) -> None:
        spec = feature_spec()
        self.assertEqual(spec, FeatureSpec.from_dict(spec.to_dict()))

    def test_18_feature_spec_rejects_unknown_field(self) -> None:
        value = feature_spec().to_dict()
        value["unknown"] = True
        with self.assertRaises(FeatureSpecError):
            FeatureSpec.from_dict(value)

    def test_19_feature_spec_rejects_scope_and_file_overlap(self) -> None:
        value = feature_spec().to_dict()
        value["out_of_scope"] = list(value["in_scope"])
        with self.assertRaises(FeatureSpecError):
            FeatureSpec.from_dict(value)

    def test_20_impact_analysis_round_trip(self) -> None:
        analysis = impact(writes=["synthetic state"], cross_module_impact=["gate"])
        self.assertEqual(analysis, ImpactAnalysis.from_dict(analysis.to_dict()))

    def test_21_impact_analysis_rejects_duplicates(self) -> None:
        with self.assertRaises(ImpactAnalysisError):
            impact(reads=["same", "same"])

    def test_22_dependency_map_round_trip(self) -> None:
        mapping = dependency_map()
        self.assertEqual(mapping, DependencyMap.from_dict(mapping.to_dict()))

    def test_23_dependency_map_rejects_unknown_dependency(self) -> None:
        value = dependency_map().to_dict()
        value["modules"][1]["depends_on"] = ["missing"]
        with self.assertRaises(DependencyMapError):
            DependencyMap.from_dict(value)

    def test_24_risk_classifier_low(self) -> None:
        self.assertEqual(
            RiskLevel.LOW,
            RiskClassifier.classify(feature_spec(expected_files=[]), impact()).level,
        )

    def test_25_risk_classifier_medium(self) -> None:
        self.assertEqual(
            RiskLevel.MEDIUM,
            RiskClassifier.classify(feature_spec(), impact(writes=["synthetic config"])).level,
        )

    def test_26_risk_classifier_high_for_critical_read(self) -> None:
        self.assertEqual(
            RiskLevel.HIGH,
            RiskClassifier.classify(feature_spec(), impact(reads=["ventas"])).level,
        )

    def test_27_risk_classifier_critical_for_durable_write(self) -> None:
        assessment = RiskClassifier.classify(
            feature_spec(), impact(writes=["caja"], storage_affected=["datos durables"])
        )
        self.assertEqual(RiskLevel.CRITICAL, assessment.level)
        self.assertTrue(assessment.codex_review_required)


class ResourceAndAntiLoopTests(TemporaryCase):
    def test_28_resource_ready_without_browser_or_port(self) -> None:
        result = RealisticResourceCheck.evaluate(resource_probes())
        self.assertEqual(ResourceMode.READY, result.mode)
        self.assertNotIn("memory", RESOURCE_NAMES)

    def test_29_optional_browser_failure_is_degraded(self) -> None:
        result = RealisticResourceCheck.evaluate(resource_probes(browser=ProbeStatus.UNAVAILABLE))
        self.assertEqual(ResourceMode.DEGRADED, result.mode)
        self.assertEqual(("browser",), result.degraded)

    def test_30_required_disk_failure_is_resource_blocked(self) -> None:
        result = RealisticResourceCheck.evaluate(resource_probes(disk_space=ProbeStatus.UNAVAILABLE))
        self.assertEqual(ResourceMode.RESOURCE_BLOCKED, result.mode)
        self.assertEqual(("disk_space",), result.blockers)

    def test_31_provider_failure_is_not_model_limit(self) -> None:
        probes = list(resource_probes())
        index = [item.name for item in probes].index("provider_auth")
        probes[index] = ResourceRequirement(
            "provider_auth", True, ProbeStatus.UNAVAILABLE, "synthetic provider down", "PROVIDER_FAILURE"
        )
        result = RealisticResourceCheck.evaluate(probes)
        self.assertEqual(ResourceMode.RESOURCE_BLOCKED, result.mode)
        self.assertEqual("PROVIDER_FAILURE", probes[index].failure_class)

    def test_32_anti_loop_attempt_survives_restart(self) -> None:
        guard = AntiLoopGuard()
        cycle = guard.start_cycle(
            run_id="run-loop-durable",
            cycle_id=1,
            hypothesis_id="hypothesis",
            session_id="session-1",
            evidence_refs=("evidence-1",),
        )
        guard.register_action(
            cycle,
            model_id="model-a",
            corrective_role="implementer",
            action_kind=ActionKind.CORRECTIVE,
        )
        path = self.temporary() / "anti-loop.json"
        guard.save(path)
        reopened = AntiLoopGuard.load(path)
        with self.assertRaises(DuplicateCorrectiveAttempt):
            reopened.register_action(
                cycle,
                model_id="model-a",
                corrective_role="implementer",
                action_kind=ActionKind.CORRECTIVE,
            )

    def test_33_anti_loop_new_cycle_after_restart_requires_new_evidence(self) -> None:
        guard = AntiLoopGuard()
        cycle = guard.start_cycle(
            run_id="run-loop-retry",
            cycle_id=1,
            hypothesis_id="hypothesis",
            session_id="session-1",
            evidence_refs=("evidence-1",),
        )
        guard.finish_cycle(cycle, CycleOutcome.FAILED)
        path = self.temporary() / "anti-loop.json"
        guard.save(path)
        reopened = AntiLoopGuard.load(path)
        cycle_two = reopened.start_cycle(
            run_id="run-loop-retry",
            cycle_id=2,
            hypothesis_id="hypothesis",
            session_id="session-2",
            evidence_refs=("evidence-2",),
        )
        self.assertEqual(2, cycle_two.cycle_id)

    def test_34_unknown_or_contradiction_escalates_immediately(self) -> None:
        guard = AntiLoopGuard()
        cycle = guard.start_cycle(
            run_id="run-unknown",
            cycle_id=1,
            hypothesis_id="hypothesis",
            session_id="session",
        )
        self.assertEqual(CycleDecision.ESCALATED, guard.finish_cycle(cycle, CycleOutcome.UNKNOWN))

    def test_35_provider_and_tool_checks_do_not_consume_attempt(self) -> None:
        guard = AntiLoopGuard()
        cycle = guard.start_cycle(
            run_id="run-provider",
            cycle_id=1,
            hypothesis_id="hypothesis",
            session_id="session",
        )
        receipt = guard.register_action(
            cycle,
            model_id="model-a",
            corrective_role="resource-checker",
            action_kind=ActionKind.PROVIDER_CHECK,
        )
        decision = guard.finish_cycle(cycle, CycleOutcome.PROVIDER_FAILURE)
        self.assertFalse(receipt.corrective_attempt_consumed)
        self.assertEqual(0, guard.corrective_attempt_count)
        self.assertEqual(CycleDecision.NOT_EVALUABLE, decision)

    def test_36_f1_f11_taxonomy_remains_complete(self) -> None:
        self.assertEqual({f"F{index}" for index in range(1, 12)}, {code.value for code in FailureCode})
        self.assertEqual(set(FailureCode), set(FAILURE_CLASSIFICATIONS))


class EvidenceCodexAndMetricsTests(TemporaryCase):
    def test_37_evidence_pack_generation_and_round_trip(self) -> None:
        pack = evidence_pack()
        path = self.temporary() / "evidence-pack.json"
        pack.write(path)
        loaded = EvidencePack.from_dict(json.loads(path.read_text(encoding="utf-8")))
        self.assertEqual(pack.digest, loaded.digest)
        self.assertEqual("manual Codex handoff", loaded.payload["next_action"])

    def test_38_evidence_digest_tampering_is_detected(self) -> None:
        value = evidence_pack().to_dict()
        value["verdict"] = "TAMPERED"
        with self.assertRaises(EvidencePackError):
            EvidencePack.from_dict(value)

    def test_39_codex_admits_high_or_critical_review(self) -> None:
        result = CodexAdmissionGate.decide(
            CodexAdmissionContext(risk=RiskLevel.HIGH, failure_class="F10"),
            admission_policy(),
        )
        self.assertEqual(CodexDecision.ADMIT, result.decision)

    def test_40_codex_admits_exhausted_high_value_code_failure(self) -> None:
        result = CodexAdmissionGate.decide(
            CodexAdmissionContext(
                risk=RiskLevel.MEDIUM,
                failure_class="F7",
                prior_engineering_review_exhausted=True,
                high_value_code_failure=True,
            ),
            admission_policy(),
        )
        self.assertEqual(CodexDecision.ADMIT, result.decision)

    def test_41_codex_denies_resource_provider_and_external_failures(self) -> None:
        for failure in (
            "RESOURCE_LIMIT",
            "PROVIDER_FAILURE",
            "EXTERNAL_DEPENDENCY",
            "TOOL_FAILURE",
        ):
            with self.subTest(failure=failure):
                result = CodexAdmissionGate.decide(
                    CodexAdmissionContext(risk=RiskLevel.CRITICAL, failure_class=failure),
                    admission_policy(),
                )
                self.assertEqual(CodexDecision.DENY, result.decision)

    def test_42_codex_not_required_for_evaluable_low_risk(self) -> None:
        result = CodexAdmissionGate.decide(
            CodexAdmissionContext(risk=RiskLevel.LOW, failure_class=None),
            admission_policy(),
        )
        self.assertEqual(CodexDecision.NOT_REQUIRED, result.decision)

    def test_43_codex_handoff_contains_required_manual_contract(self) -> None:
        pack = evidence_pack()
        admission = CodexAdmissionGate.decide(
            CodexAdmissionContext(risk=RiskLevel.CRITICAL, failure_class="F10"),
            admission_policy(),
        )
        path = self.temporary() / "CODEX_ESCALATION_REPORT.md"
        write_codex_escalation_report(
            path,
            evidence=pack,
            admission=admission,
            requested_codex_action="independent forensic review",
        )
        text = path.read_text(encoding="utf-8")
        self.assertIn(pack.digest, text)
        self.assertIn("MANUAL_USER_HANDOFF_TO_CODEX_APP", text)
        self.assertIn("independent forensic review", text)

    def test_44_codex_handoff_refuses_non_admitted_context(self) -> None:
        denied = CodexAdmissionGate.decide(
            CodexAdmissionContext(risk=RiskLevel.LOW, failure_class="RESOURCE_LIMIT"),
            admission_policy(),
        )
        with self.assertRaises(CodexHandoffError):
            write_codex_escalation_report(
                self.temporary() / "CODEX_ESCALATION_REPORT.md",
                evidence=evidence_pack(),
                admission=denied,
                requested_codex_action="review",
            )

    def test_45_metrics_round_trip_exact_schema(self) -> None:
        path = self.temporary() / "metrics.jsonl"
        ledger = MetricsLedger(path)
        record = MetricRecord("FIX", "model-a", "PASS", True, True, False, None, 1.5, None, 1, True)
        ledger.append(record)
        self.assertEqual((record,), ledger.load())
        self.assertEqual(
            {
                "TASK_TYPE",
                "MODEL",
                "RESULT",
                "ROOT_CAUSE_FOUND",
                "TEST_PASS",
                "REGRESSION",
                "ESCALATED_TO",
                "DURATION",
                "FAILURE_CLASS",
                "CYCLES",
                "RESUMED_AFTER_CRASH",
            },
            set(record.to_dict()),
        )

    def test_46_resource_provider_external_metrics_are_not_evaluable(self) -> None:
        for failure in ("RESOURCE_LIMIT", "PROVIDER_FAILURE", "EXTERNAL_DEPENDENCY"):
            with self.subTest(failure=failure):
                record = MetricRecord("FIX", "model-a", "BLOCKED", False, False, False, None, 1, failure, 1, False)
                self.assertEqual(ModelFit.NOT_EVALUABLE, record.evaluation)

    def test_47_model_classification_requires_data_then_classifies(self) -> None:
        one = MetricRecord("FIX", "model-a", "PASS", True, True, False, None, 1, None, 1, False)
        self.assertEqual(ModelFit.INSUFFICIENT_DATA, classify_model([one]))
        self.assertEqual(ModelFit.EFFICIENT, classify_model([one, one, one]))

    def test_48_metrics_reject_non_boolean_schema_values(self) -> None:
        value = MetricRecord(
            "FIX", "model-a", "PASS", True, True, False, None, 1, None, 1, False
        ).to_dict()
        value["TEST_PASS"] = 1
        with self.assertRaises(ValueError):
            MetricRecord.from_dict(value)


if __name__ == "__main__":
    unittest.main()
